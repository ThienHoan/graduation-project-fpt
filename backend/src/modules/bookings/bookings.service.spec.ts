import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BookingsService } from "./bookings.service";

const SIZE_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";

function makeBooking(startDate: string, endDate: string, overrides?: { status?: string; penaltyTotal?: number }) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    customerId: CUSTOMER_ID,
    status: overrides?.status ?? "pending_confirmation",
    rentalStartDate: new Date(`${startDate}T00:00:00.000Z`),
    rentalEndDate: new Date(`${endDate}T00:00:00.000Z`),
    pickupMethod: "store_pickup",
    rentalTotal: 100,
    depositTotal: 50,
    penaltyTotal: overrides?.penaltyTotal ?? 0,
    shippingFee: 0,
    paymentMethod: "cash",
    note: null,
    deliveryAddressId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    items: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        garmentId: "00000000-0000-4000-8000-000000000005",
        garment_size_id: SIZE_ID,
        dailyPrice: 100,
        depositAmount: 50,
        garmentAssetId: null,
        garmentAsset: null,
        garment_sizes: {
          size_label: "M",
          garments: { name: "Áo dài mẫu" },
        },
      },
    ],
    deliveryAddress: null,
  };
}

function createService(options?: {
  committed?: number;
  capacity?: number;
  serializeTransactions?: boolean;
}) {
  const size = {
    id: SIZE_ID,
    garment_id: "00000000-0000-4000-8000-000000000005",
    size_label: "M",
    deposit_amount: 50,
    is_active: true,
    garments: { name: "Áo dài mẫu" },
  };
  const committed = options?.committed ?? 0;
  const capacity = options?.capacity ?? 1;
  let transactionQueue = Promise.resolve();
  let successfulTransactions = 0;

  const tx = {
    garmentAsset: {
      count: vi.fn().mockResolvedValue(capacity),
    },
    bookingItem: {
      count: vi.fn().mockImplementation(async () => committed + successfulTransactions),
    },
    booking: {
      create: vi.fn().mockImplementation(async () => {
        successfulTransactions += 1;
        return makeBooking("2026-10-10", "2026-10-12");
      }),
    },
  };

  const prisma = {
    userAccount: {
      findUnique: vi.fn().mockResolvedValue({ email: "customer@example.com", profile: { fullName: "Test Customer" } }),
    },
    garment_sizes: {
      findMany: vi.fn().mockResolvedValue([size]),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const run = async () => callback(tx);
      if (!options?.serializeTransactions) return run();

      const current = transactionQueue.then(run);
      transactionQueue = current.then(() => undefined, () => undefined);
      return current;
    }),
    runSerializable: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      return prisma.$transaction(callback);
    }),
  };

  const service = new BookingsService(
    prisma as never,
    { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
    {} as never,
    { effectiveDailyPrice: vi.fn().mockResolvedValue(100) } as never,
    { bookingChanged: vi.fn(), assetChanged: vi.fn(), inspectionChanged: vi.fn(), refundChanged: vi.fn(), laundryChanged: vi.fn(), maintenanceChanged: vi.fn(), notificationCreated: vi.fn() } as never,
  );

  return { service, prisma, tx };
}

const dto = (startDate: string, endDate: string) => ({
  garmentSizeIds: [SIZE_ID],
  startDate,
  endDate,
  pickupMethod: "store_pickup",
  paymentMethod: "cash",
});

describe("BookingsService.create availability", () => {
  it("rejects a booking whose dates overlap an existing booking", async () => {
    const { service, tx } = createService({ committed: 1, capacity: 1 });

    await expect(service.create(CUSTOMER_ID, dto("2026-10-11", "2026-10-13"))).rejects.toThrow(
      "không còn đủ sản phẩm khả dụng",
    );

    expect(tx.booking.create).not.toHaveBeenCalled();
    const countQuery = tx.bookingItem.count.mock.calls[0][0];
    expect(countQuery.where.booking.rentalStartDate).toEqual({ lt: new Date("2026-10-13T00:00:00.000Z") });
    expect(countQuery.where.booking.rentalEndDate).toEqual({ gt: new Date("2026-10-11T00:00:00.000Z") });
  });

  it("allows bookings that only touch at the checkout/pickup boundary", async () => {
    const { service, tx } = createService({ committed: 0, capacity: 1 });

    await expect(service.create(CUSTOMER_ID, dto("2026-10-12", "2026-10-14"))).resolves.toBeDefined();

    expect(tx.booking.create).toHaveBeenCalledTimes(1);
    const countQuery = tx.bookingItem.count.mock.calls[0][0];
    expect(countQuery.where.booking.rentalStartDate).toEqual({ lt: new Date("2026-10-14T00:00:00.000Z") });
    expect(countQuery.where.booking.rentalEndDate).toEqual({ gt: new Date("2026-10-12T00:00:00.000Z") });
  });

  it("allows only one of two concurrent bookings when one asset is available", async () => {
    const { service } = createService({ committed: 0, capacity: 1, serializeTransactions: true });

    const results = await Promise.allSettled([
      service.create(CUSTOMER_ID, dto("2026-11-10", "2026-11-12")),
      service.create("00000000-0000-4000-8000-000000000006", dto("2026-11-10", "2026-11-12")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});

describe("BookingsService overdue reporting", () => {
  type Serialized = { overdueDays: number; overdueAmount: number; overdueFeePerDay: number };

  function serializeWith(service: unknown, booking: unknown): Serialized {
    const spy = service as { serializeBooking(b: unknown): Serialized };
    return spy.serializeBooking(booking);
  }

  // today = 2026-10-07 theo giờ VN (vnTodayStr cộng VN_UTC_OFFSET_MS).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T05:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports how many days overdue a renting booking is", () => {
    const { service } = createService({ committed: 0, capacity: 5 });
    const serialized = serializeWith(service, makeBooking("2026-09-30", "2026-10-04", { status: "renting" }));

    expect(serialized.overdueDays).toBe(3);
    expect(serialized.overdueFeePerDay).toBe(10_000);
    expect(serialized.overdueAmount).toBe(30_000);
  });

  it("reports zero overdue days once the booking is no longer overdue", () => {
    const { service } = createService({ committed: 0, capacity: 5 });

    // Chưa tới hạn.
    expect(serializeWith(service, makeBooking("2026-10-10", "2026-10-12", { status: "renting" })).overdueDays).toBe(0);
    // Quá hạn nhưng khách đã trả đồ → ngày trễ không còn ý nghĩa.
    expect(serializeWith(service, makeBooking("2026-09-30", "2026-10-04", { status: "returned" })).overdueDays).toBe(0);
    // Đã hoàn tất → phí đã chốt, không nhân thêm.
    expect(serializeWith(service, makeBooking("2026-09-30", "2026-10-04", { status: "completed" })).overdueAmount).toBe(0);
  });
});
