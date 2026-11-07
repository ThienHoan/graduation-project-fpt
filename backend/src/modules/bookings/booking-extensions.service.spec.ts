import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reservations = vi.hoisted(() => ({
  assertAssetScheduleAvailable: vi.fn(),
  assertAccessoryAssetScheduleAvailable: vi.fn(),
}));
vi.mock("./booking-reservations", () => reservations);

import { ConflictException } from "@nestjs/common";
import { BookingExtensionsService, EXTENSION_HOLD_MS } from "./booking-extensions.service";

const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_CUSTOMER = "00000000-0000-4000-8000-000000000099";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const ASSET_ID = "00000000-0000-4000-8000-000000000006";
const SIZE_ID = "00000000-0000-4000-8000-000000000001";
const EXTENSION_ID = "00000000-0000-4000-8000-0000000000f1";
const PAYMENT_ID = "00000000-0000-4000-8000-0000000000f2";
const NOW = new Date("2026-10-11T03:00:00.000Z"); // 10h00 giờ VN ngày 11/10
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: "renting",
    rentalStartDate: day("2026-10-10"),
    rentalEndDate: day("2026-10-12"),
    rentalTotal: 300_000,
    items: [{
      id: ITEM_ID,
      garmentId: "garment-1",
      garment_size_id: SIZE_ID,
      garmentAssetId: ASSET_ID,
      dailyPrice: 100_000,
      garment_sizes: { size_label: "M", garments: { name: "Áo dài gấm" } },
    }],
    accessoryItems: [],
    ...overrides,
  };
}

function createService(options: {
  booking?: Record<string, unknown>;
  loyaltyTier?: string;
  pendingExtension?: Record<string, unknown> | null;
  extension?: Record<string, unknown> | null;
  maxRentalDays?: number;
} = {}) {
  let booking = makeBooking(options.booking);
  let extension = options.extension ?? null;
  const tx = {
    booking: {
      findUnique: vi.fn().mockImplementation(async () => booking),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: { where: { rentalEndDate?: Date }; data: Record<string, unknown> }) => {
        if (where.rentalEndDate && +where.rentalEndDate !== +booking.rentalEndDate) return { count: 0 };
        booking = { ...booking, ...data };
        return { count: 1 };
      }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const next: Record<string, unknown> = { ...data };
        const increment = (data.rentalTotal as { increment?: number } | undefined)?.increment;
        if (increment !== undefined) next.rentalTotal = Number(booking.rentalTotal) + Number(increment);
        booking = { ...booking, ...next };
        return booking;
      }),
    },
    bookingExtension: {
      findFirst: vi.fn().mockResolvedValue(options.pendingExtension ?? null),
      findUnique: vi.fn().mockImplementation(async () => (extension ? { ...extension, booking } : null)),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: EXTENSION_ID, ...data })),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        extension = { ...extension!, ...data };
        return extension;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
        if (!extension || (where.status && extension.status !== where.status)) return { count: 0 };
        extension = { ...extension, ...data };
        return { count: 1 };
      }),
      findMany: vi.fn().mockImplementation(async () => (extension ? [extension] : [])),
      count: vi.fn().mockImplementation(async () => (extension ? 1 : 0)),
    },
    bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    userAccount: { findUnique: vi.fn().mockResolvedValue({ id: CUSTOMER_ID, loyaltyTier: options.loyaltyTier ?? "basic" }) },
    systemSetting: {
      findUnique: vi.fn().mockResolvedValue(
        options.maxRentalDays ? { key: "max_rental_days", value: { value: options.maxRentalDays } } : null,
      ),
    },
  };
  const prisma = {
    ...tx,
    runSerializable: vi.fn().mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const pricing = {
    quoteRental: vi.fn().mockImplementation(async (_ids: string[], start: Date, end: Date) => {
      const days = Math.round((+end - +start) / 86_400_000) + 1;
      return new Map([[SIZE_ID, { rentalTotal: 120_000 * days }]]);
    }),
  };
  const notifications = { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() };
  const realtime = { bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn() };
  const service = new BookingExtensionsService(prisma as never, pricing as never, notifications as never, realtime as never);
  return {
    service, prisma, tx, pricing, notifications, realtime,
    getBooking: () => booking,
    getExtension: () => extension,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  reservations.assertAssetScheduleAvailable.mockReset().mockResolvedValue(undefined);
  reservations.assertAccessoryAssetScheduleAvailable.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BookingExtensionsService.quote", () => {
  it("prices the extra days with the day-by-day price list and checks only the extra days", async () => {
    const { service, pricing } = createService();

    const result = await service.quote(CUSTOMER_ID, BOOKING_ID, 2);

    expect(pricing.quoteRental).toHaveBeenCalledWith([SIZE_ID], day("2026-10-13"), day("2026-10-14"));
    expect(reservations.assertAssetScheduleAvailable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      assetId: ASSET_ID,
      bookingId: BOOKING_ID,
      itemId: ITEM_ID,
      startDay: day("2026-10-13"),
      endDay: day("2026-10-14"),
    }));
    expect(result.data).toMatchObject({
      previousEndDate: "2026-10-12",
      newEndDate: "2026-10-14",
      extraDays: 2,
      amount: 240_000,
    });
  });

  it("applies the member tier discount like a new booking", async () => {
    const { service } = createService({ loyaltyTier: "premium" });

    const result = await service.quote(CUSTOMER_ID, BOOKING_ID, 1);

    expect(result.data).toMatchObject({ amount: 108_000, memberDiscount: 12_000 });
  });

  it("charges paid accessories for the extra days too", async () => {
    const { service } = createService({
      booking: {
        accessoryItems: [{
          id: "acc-row", accessoryId: "acc-1", accessoryAssetId: "acc-asset-1", unitPrice: 20_000, quantity: 1,
          accessory: { name: "Khăn vấn" },
        }],
      },
    });

    const result = await service.quote(CUSTOMER_ID, BOOKING_ID, 2);

    expect(result.data?.amount).toBe(240_000 + 40_000);
    expect(reservations.assertAccessoryAssetScheduleAvailable).toHaveBeenCalled();
  });

  it("tells the customer when someone else already booked the extra days", async () => {
    const { service } = createService();
    reservations.assertAssetScheduleAvailable.mockRejectedValueOnce(new ConflictException("Asset đã được đơn khác giữ"));

    await expect(service.quote(CUSTOMER_ID, BOOKING_ID, 3)).rejects.toThrow("Áo dài gấm đã có khách khác đặt");
  });

  it.each([
    [0, "từ 1 đến 7 ngày"],
    [8, "từ 1 đến 7 ngày"],
  ])("rejects %i days", async (days, message) => {
    const { service } = createService();

    await expect(service.quote(CUSTOMER_ID, BOOKING_ID, days)).rejects.toThrow(message);
  });

  it("rejects bookings that are already overdue", async () => {
    const { service } = createService({ booking: { rentalEndDate: day("2026-10-10") } });

    await expect(service.quote(CUSTOMER_ID, BOOKING_ID, 1)).rejects.toThrow("quá hạn trả");
  });

  it("rejects bookings that were already returned", async () => {
    const { service } = createService({ booking: { status: "returned" } });

    await expect(service.quote(CUSTOMER_ID, BOOKING_ID, 1)).rejects.toThrow("chưa trả đồ");
  });

  it("respects the maximum rental length set by the admin", async () => {
    const { service } = createService({ maxRentalDays: 4 });

    await expect(service.quote(CUSTOMER_ID, BOOKING_ID, 2)).rejects.toThrow("tối đa là 4 ngày");
  });

  it("does not let another customer extend the booking", async () => {
    const { service } = createService();

    await expect(service.quote(OTHER_CUSTOMER, BOOKING_ID, 1)).rejects.toThrow("không có quyền");
  });
});

describe("BookingExtensionsService.requestExtension", () => {
  it("holds the new dates immediately and records a pending extension for 30 minutes", async () => {
    const { service, tx, getBooking } = createService();

    const extension = await service.requestExtension(CUSTOMER_ID, BOOKING_ID, 2);

    expect(getBooking().rentalEndDate).toEqual(day("2026-10-14"));
    expect(tx.booking.updateMany.mock.calls[0][0].where).toMatchObject({ id: BOOKING_ID, rentalEndDate: day("2026-10-12") });
    expect(tx.bookingExtension.create.mock.calls[0][0].data).toMatchObject({
      bookingId: BOOKING_ID,
      requestedBy: CUSTOMER_ID,
      previousEndDate: day("2026-10-12"),
      newEndDate: day("2026-10-14"),
      extraDays: 2,
      amount: 240_000,
      status: "pending",
      expiresAt: new Date(NOW.getTime() + EXTENSION_HOLD_MS),
    });
    expect(extension.id).toBe(EXTENSION_ID);
  });

  it("refuses a second request while one is still waiting for payment", async () => {
    const { service, tx } = createService({ pendingExtension: { id: "older", status: "pending" } });

    await expect(service.requestExtension(CUSTOMER_ID, BOOKING_ID, 1)).rejects.toThrow("đang có một yêu cầu gia hạn");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });
});

function pendingExtension(overrides: Record<string, unknown> = {}) {
  return {
    id: EXTENSION_ID,
    bookingId: BOOKING_ID,
    previousEndDate: day("2026-10-12"),
    newEndDate: day("2026-10-14"),
    extraDays: 2,
    amount: 240_000,
    status: "pending",
    paymentId: PAYMENT_ID,
    expiresAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

describe("BookingExtensionsService payment handling", () => {
  it("applies a paid extension once and charges it to the booking", async () => {
    const { service, notifications, getBooking, getExtension } = createService({
      booking: { rentalEndDate: day("2026-10-14") },
      extension: pendingExtension(),
    });

    await expect(service.handlePaymentPaid(PAYMENT_ID)).resolves.toBe("applied");
    await expect(service.handlePaymentPaid(PAYMENT_ID)).resolves.toBe("applied");

    expect(getExtension()?.status).toBe("applied");
    expect(getBooking().rentalTotal).toBe(300_000 + 240_000);
    expect(notifications.sendBookingNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendBookingNotification).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: "booking.extension_applied",
      endDate: "2026-10-14",
    }));
  });

  it("ignores payments that are not extension fees", async () => {
    const { service, tx } = createService({ extension: null });

    await expect(service.handlePaymentPaid(PAYMENT_ID)).resolves.toBeNull();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("returns the old end date when the hold expires unpaid", async () => {
    const { service, prisma, notifications, getBooking, getExtension } = createService({
      booking: { rentalEndDate: day("2026-10-14") },
      extension: pendingExtension(),
    });
    prisma.bookingExtension.findMany.mockResolvedValueOnce([{ ...pendingExtension(), payment: { status: "pending" } }]);

    const result = await service.expirePendingExtensions(NOW);

    expect(result.data).toEqual({ applied: [], expired: [EXTENSION_ID] });
    expect(getBooking().rentalEndDate).toEqual(day("2026-10-12"));
    expect(getExtension()?.status).toBe("expired");
    expect(notifications.sendBookingNotification).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: "booking.extension_expired",
      endDate: "2026-10-12",
    }));
  });

  it("applies instead of expiring when the money already arrived but the webhook was missed", async () => {
    const { service, prisma, getBooking, getExtension } = createService({
      booking: { rentalEndDate: day("2026-10-14") },
      extension: pendingExtension(),
    });
    prisma.bookingExtension.findMany.mockResolvedValueOnce([{ ...pendingExtension(), payment: { status: "paid" } }]);

    const result = await service.expirePendingExtensions(NOW);

    expect(result.data).toEqual({ applied: [EXTENSION_ID], expired: [] });
    expect(getBooking().rentalEndDate).toEqual(day("2026-10-14"));
    expect(getExtension()?.status).toBe("applied");
  });

  it("still extends on a late payment when the extra days are free", async () => {
    const { service, getBooking, getExtension } = createService({
      extension: pendingExtension({ status: "expired" }),
    });

    await expect(service.handlePaymentPaid(PAYMENT_ID)).resolves.toBe("applied");
    expect(getBooking().rentalEndDate).toEqual(day("2026-10-14"));
    expect(getBooking().rentalTotal).toBe(540_000);
    expect(getExtension()?.status).toBe("applied");
  });

  it("asks the manager to refund a late payment when the extra days were taken", async () => {
    const { service, notifications, getBooking, getExtension } = createService({
      extension: pendingExtension({ status: "expired" }),
    });
    reservations.assertAssetScheduleAvailable.mockRejectedValueOnce(new ConflictException("taken"));

    await expect(service.handlePaymentPaid(PAYMENT_ID)).resolves.toBe("failed");
    expect(getBooking().rentalEndDate).toEqual(day("2026-10-12"));
    expect(getExtension()?.status).toBe("failed");
    expect(notifications.notifyStaffBooking).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: "booking.staff.extension_refund",
      amount: "240.000",
    }));
  });

  it("lets the customer cancel an unpaid request and restores the end date", async () => {
    const { service, prisma, getBooking, getExtension } = createService({
      booking: { rentalEndDate: day("2026-10-14") },
      extension: pendingExtension({ expiresAt: new Date(NOW.getTime() + 60_000) }),
    });
    prisma.bookingExtension.findFirst.mockResolvedValueOnce({ ...pendingExtension(), payment: { status: "pending" } });

    const result = await service.cancelPending(CUSTOMER_ID, BOOKING_ID);

    expect(result.data).toEqual({ extensionId: EXTENSION_ID, cancelled: true });
    expect(getBooking().rentalEndDate).toEqual(day("2026-10-12"));
    expect(getExtension()?.status).toBe("cancelled");
  });

  it("refuses to cancel a request that was already paid and applies it instead", async () => {
    const { service, prisma, getExtension } = createService({
      booking: { rentalEndDate: day("2026-10-14") },
      extension: pendingExtension(),
    });
    prisma.bookingExtension.findFirst.mockResolvedValueOnce({ ...pendingExtension(), payment: { status: "paid" } });

    await expect(service.cancelPending(CUSTOMER_ID, BOOKING_ID)).rejects.toThrow("đã được thanh toán");
    expect(getExtension()?.status).toBe("applied");
  });

  describe("listAllForCustomer (Workstream A - Lịch sử gia hạn khách hàng)", () => {
    it("trả về danh sách lịch sử gia hạn đầy đủ thông tin ngày trả cũ và mới", async () => {
      const { service, prisma } = createService({
        booking: { id: BOOKING_ID, customerId: CUSTOMER_ID },
      });

      prisma.bookingExtension.findMany = vi.fn().mockResolvedValue([
        {
          id: EXTENSION_ID,
          bookingId: BOOKING_ID,
          previousEndDate: day("2026-10-12"),
          newEndDate: day("2026-10-14"),
          extraDays: 2,
          amount: 240000,
          status: "applied",
          checkoutUrl: null,
          expiresAt: new Date(NOW.getTime() + 1800000),
          appliedAt: new Date(NOW.getTime() + 600000),
          note: null,
          createdAt: NOW,
          booking: {
            id: BOOKING_ID,
            customerId: CUSTOMER_ID,
            status: "renting",
            items: [
              {
                garment_sizes: {
                  garments: { name: "Nhật Bình Hoàng Gia" },
                },
              },
            ],
          },
          payment: {
            id: PAYMENT_ID,
            status: "paid",
            amount: 240000,
          },
        },
      ]);
      prisma.bookingExtension.count = vi.fn().mockResolvedValue(1);

      const res = await service.listAllForCustomer(CUSTOMER_ID, { page: 1, limit: 10 });

      expect(res.data?.items).toHaveLength(1);
      const item = res.data?.items[0];
      expect(item?.bookingId).toBe(BOOKING_ID);
      expect(item?.garmentName).toBe("Nhật Bình Hoàng Gia");
      expect(item?.previousEndDate).toBe("2026-10-12");
      expect(item?.newEndDate).toBe("2026-10-14");
      expect(item?.extraDays).toBe(2);
      expect(item?.amount).toBe(240000);
      expect(item?.status).toBe("applied");
      expect(item?.paymentStatus).toBe("paid");
      expect(item?.appliedAt).toBeDefined();
    });

    it("lọc theo status khi được yêu cầu", async () => {
      const { service, prisma } = createService();
      prisma.bookingExtension.findMany = vi.fn().mockResolvedValue([]);
      prisma.bookingExtension.count = vi.fn().mockResolvedValue(0);

      await service.listAllForCustomer(CUSTOMER_ID, { status: "pending" });

      expect(prisma.bookingExtension.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            booking: { customerId: CUSTOMER_ID },
            status: "pending",
          }),
        }),
      );
    });
  });
});
