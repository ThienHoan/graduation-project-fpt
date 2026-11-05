import { describe, expect, it, vi } from "vitest";
import { BookingAutomationService } from "./booking-automation.service";

const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const BROKEN_ASSET = "00000000-0000-4000-8000-0000000000e1";
const NOW = new Date("2026-10-08T03:00:00.000Z"); // 10h00 giờ VN ngày 08/10

function createReassignService(options: {
  bookingStatus?: string;
  assetStatus?: string;
  replacementFound?: boolean;
  voucherPercent?: number;
}) {
  const item = {
    id: ITEM_ID,
    bookingId: BOOKING_ID,
    garmentAssetId: BROKEN_ASSET,
    booking: { id: BOOKING_ID, status: options.bookingStatus ?? "paid" },
    garmentAsset: { id: BROKEN_ASSET, assetCode: "CP-009", status: options.assetStatus ?? "damaged" },
  };
  const tx = {
    bookingItem: {
      findUnique: vi.fn().mockResolvedValue(item),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
  };
  const prisma = {
    bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: ITEM_ID, garmentAssetId: BROKEN_ASSET }]) },
    bookingAccessoryItem: { findMany: vi.fn().mockResolvedValue([]) },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: BOOKING_ID,
        customerId: CUSTOMER_ID,
        rentalStartDate: new Date("2026-10-10T00:00:00.000Z"),
        rentalEndDate: new Date("2026-10-12T00:00:00.000Z"),
        items: [{
          garmentId: "garment-original",
          garmentAssetId: null,
          garment_sizes: { size_label: "M", garments: { name: "Áo dài mẫu" } },
        }],
      }),
    },
    garment_sizes: {
      findMany: vi.fn().mockResolvedValue([
        { id: "size-alt-1", garment_id: "garment-alt-1", size_label: "M" },
        { id: "size-alt-2", garment_id: "garment-alt-2", size_label: "M" },
      ]),
    },
    systemSetting: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { key: string } }) =>
        options.voucherPercent === undefined ? null : where.key === "asset_issue_voucher_percent"
          ? { key: where.key, value: { value: options.voucherPercent } }
          : null),
    },
    runSerializable: vi.fn().mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const bookings = {
    autoAssignAssets: vi.fn().mockResolvedValue({
      success: true,
      data: { complete: options.replacementFound ?? true, assigned: options.replacementFound === false ? [] : ["CP-010"] },
    }),
    // Mẫu thay thế 1 hết lịch, mẫu 2 còn trống.
    checkAvailability: vi.fn().mockImplementation(async ({ garmentSizeId }: { garmentSizeId: string }) => ({
      success: true,
      data: { available: garmentSizeId === "size-alt-2" },
    })),
  };
  const garments = {
    findSimilarGarments: vi.fn().mockResolvedValue({
      success: true,
      data: [
        { garmentId: "garment-alt-1", name: "Áo dài gấm đỏ" },
        { garmentId: "garment-alt-2", name: "Áo dài lụa hồng" },
      ],
    }),
  };
  const vouchers = { create: vi.fn().mockResolvedValue({ success: true }) };
  const notifications = { notifyStaffBooking: vi.fn(), notifyRoles: vi.fn(), sendBookingNotification: vi.fn() };
  const service = new BookingAutomationService(
    prisma as never,
    bookings as never,
    notifications as never,
    garments as never,
    vouchers as never,
  );
  return { service, prisma, tx, bookings, notifications, garments, vouchers };
}

describe("BookingAutomationService.reassignUnavailableAssets", () => {
  it("only looks at bookings that have not physically claimed their assets yet", async () => {
    const { service, prisma } = createReassignService({});

    await service.reassignUnavailableAssets(NOW);

    const where = prisma.bookingItem.findMany.mock.calls[0][0].where;
    expect(where.booking).toEqual({ status: { in: ["confirmed", "awaiting_payment", "paid"] } });
    // Bảo trì chỉ đổi khi đơn bắt đầu trong 3 ngày tới (đến 11/10).
    expect(where.OR[1]).toEqual({
      garmentAsset: { status: "maintenance" },
      booking: { rentalStartDate: { lte: new Date("2026-10-11T00:00:00.000Z") } },
    });
  });

  it("swaps a damaged asset for another one of the same size", async () => {
    const { service, tx, bookings, notifications } = createReassignService({});

    const result = await service.reassignUnavailableAssets(NOW);

    expect(tx.bookingItem.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM_ID, garmentAssetId: BROKEN_ASSET },
      data: { garmentAssetId: null },
    });
    expect(tx.bookingStatusHistory.create.mock.calls[0][0].data.note).toContain("Hệ thống gỡ asset CP-009 (đang hư hỏng)");
    expect(bookings.autoAssignAssets).toHaveBeenCalledWith(BOOKING_ID);
    expect(result.data).toEqual({ releasedAssets: 1, replaced: [BOOKING_ID], needsManager: [] });
    expect(notifications.notifyStaffBooking).not.toHaveBeenCalled();
  });

  it("asks the manager to contact the customer when no replacement is left", async () => {
    const { service, notifications } = createReassignService({ replacementFound: false });

    const result = await service.reassignUnavailableAssets(NOW);

    expect(result.data?.needsManager).toEqual([BOOKING_ID]);
    expect(notifications.notifyStaffBooking).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: "booking.staff.asset_unavailable",
      bookingId: BOOKING_ID,
      assetCode: "CP-009 (hư hỏng)",
      startDate: "2026-10-10",
      note: "Mẫu tương tự còn trống: Áo dài lụa hồng (size M).",
    }));
  });

  it("apologises to the customer with free alternatives and a one-time voucher", async () => {
    const { service, notifications, vouchers, garments, prisma } = createReassignService({ replacementFound: false });

    await service.reassignUnavailableAssets(NOW);

    expect(garments.findSimilarGarments).toHaveBeenCalledWith("garment-original", 8);
    expect(prisma.garment_sizes.findMany.mock.calls[0][0].where.size_label).toEqual({ equals: "M", mode: "insensitive" });
    expect(vouchers.create).toHaveBeenCalledWith(expect.objectContaining({
      code: "XINLOI-00000000",
      discountType: "percentage",
      discountValue: 20,
      maxDiscountAmount: 200000,
      usageLimit: 1,
      perUserLimit: 1,
    }));
    expect(notifications.sendBookingNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      templateKey: "booking.asset_issue",
      note: "Mẫu tương tự còn trống: Áo dài lụa hồng (size M). Tặng bạn mã XINLOI-00000000 giảm giá cho lần thuê sau.",
    }));
  });

  it("skips the voucher when the admin set the apology percentage to 0", async () => {
    const { service, notifications, vouchers } = createReassignService({ replacementFound: false, voucherPercent: 0 });

    await service.reassignUnavailableAssets(NOW);

    expect(vouchers.create).not.toHaveBeenCalled();
    expect(notifications.sendBookingNotification.mock.calls[0][0].note).not.toContain("XINLOI");
  });

  it("reuses the same voucher code if one was already issued for the booking", async () => {
    const { service, notifications, vouchers } = createReassignService({ replacementFound: false });
    const { ConflictException } = await import("@nestjs/common");
    vouchers.create.mockRejectedValueOnce(new ConflictException("Mã voucher đã tồn tại."));

    await service.reassignUnavailableAssets(NOW);

    expect(notifications.sendBookingNotification.mock.calls[0][0].note).toContain("XINLOI-00000000");
  });

  it("leaves the booking alone if staff already moved it to preparing", async () => {
    const { service, tx, bookings } = createReassignService({ bookingStatus: "preparing" });

    const result = await service.reassignUnavailableAssets(NOW);

    expect(tx.bookingItem.updateMany).not.toHaveBeenCalled();
    expect(bookings.autoAssignAssets).not.toHaveBeenCalled();
    expect(result.data?.releasedAssets).toBe(0);
  });

  it("leaves the booking alone if the asset was repaired in the meantime", async () => {
    const { service, tx } = createReassignService({ assetStatus: "available" });

    await service.reassignUnavailableAssets(NOW);

    expect(tx.bookingItem.updateMany).not.toHaveBeenCalled();
  });
});

describe("BookingAutomationService.sendStaffDailyDigest", () => {
  function createDigestService(counts: number[]) {
    const prisma = { booking: { count: vi.fn() } };
    for (const value of counts) prisma.booking.count.mockResolvedValueOnce(value);
    const notifications = { notifyRoles: vi.fn(), notifyStaffBooking: vi.fn(), sendBookingNotification: vi.fn() };
    const service = new BookingAutomationService(prisma as never, {} as never, notifications as never);
    return { service, notifications };
  }

  it("stays quiet when there is nothing for humans to handle", async () => {
    const { service, notifications } = createDigestService([0, 0, 0, 0]);

    const result = await service.sendStaffDailyDigest(NOW);

    expect(result.data?.sent).toBe(false);
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });

  it("sends staff and managers the list of exceptions", async () => {
    const { service, notifications } = createDigestService([2, 1, 3, 0]);

    const result = await service.sendStaffDailyDigest(NOW);

    expect(result.data).toMatchObject({ sent: true, missingAssets: 2, notReady: 1, pendingConfirm: 3, overdue: 0 });
    expect(notifications.notifyRoles).toHaveBeenCalledWith({
      roles: ["staff", "manager_owner"],
      templateKey: "staff.daily_digest",
      data: { missingAssets: 2, notReady: 1, pendingConfirm: 3, overdue: 0, date: "2026-10-08" },
    });
  });
});

describe("BookingAutomationService.sendReviewInvitations", () => {
  it("invites customers whose booking completed in the last 24 hours and has no review", async () => {
    const completed = {
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
      rentalStartDate: new Date("2026-10-01T00:00:00.000Z"),
      rentalEndDate: new Date("2026-10-03T00:00:00.000Z"),
      items: [{ garment_sizes: { garments: { name: "Áo dài mẫu" } } }],
    };
    const prisma = { booking: { findMany: vi.fn().mockResolvedValue([completed]) } };
    const notifications = { sendBookingNotification: vi.fn(), notifyRoles: vi.fn(), notifyStaffBooking: vi.fn() };
    const service = new BookingAutomationService(prisma as never, {} as never, notifications as never);

    const result = await service.sendReviewInvitations(NOW);

    expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({
      status: "completed",
      reviews: { none: {} },
      statusHistory: {
        some: { toStatus: "completed", createdAt: { gte: new Date("2026-10-07T03:00:00.000Z"), lt: NOW } },
      },
    });
    expect(notifications.sendBookingNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      templateKey: "booking.review_invite",
      garmentName: "Áo dài mẫu",
    }));
    expect(result.data?.invitedCount).toBe(1);
  });
});
