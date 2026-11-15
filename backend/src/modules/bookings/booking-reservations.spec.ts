import { describe, expect, it, vi } from "vitest";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { assertAssetScheduleAvailable, cancelBookingTx, releaseBookingAssets, transitionBookingAssets } from "./booking-reservations";

const ID = "11111111-1111-4111-8111-111111111111";
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const booking = (id: string, status: BookingStatus, from = "2026-01-01", to = "2026-01-03") => ({
  id, status, rentalStartDate: day(from), rentalEndDate: day(to),
});
function client(overrides: Record<string, unknown> = {}) {
  return {
    garmentAsset: { findUnique: vi.fn().mockResolvedValue({ id: ID, garmentId: "g1", garment_size_id: "s1", status: AssetStatus.available }) },
    bookingItem: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    bookingChangeHold: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  } as any;
}

describe("booking reservation helper", () => {
  it("allows a scheduled assignment after the laundry buffer window", async () => {
    const tx = client({ bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") }]) } });
    // b1 trả ngày 03/01 + 1 ngày đệm giặt (04/01) => b2 bắt đầu 05/01 thành công
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-05"), endDay: day("2026-01-06") })).resolves.toBeUndefined();
  });

  it("rejects a scheduled assignment within the laundry buffer window", async () => {
    const tx = client({ bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") }]) } });
    // b1 trả ngày 03/01 + 1 ngày đệm giặt (04/01) => b2 bắt đầu 04/01 bị từ chối do trùng ngày đệm giặt
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-04"), endDay: day("2026-01-05") })).rejects.toThrow("trùng ngày");
  });

  it("allows a contiguous scheduled assignment when laundryBufferDays is explicitly 0", async () => {
    const tx = client({ bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") }]) } });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-04"), endDay: day("2026-01-05"), laundryBufferDays: 0 })).resolves.toBeUndefined();
  });

  it("rejects an inclusive same-day schedule conflict", async () => {
    const tx = client({ bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") }]) } });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-03"), endDay: day("2026-01-04") })).rejects.toThrow("trùng ngày");
  });

  it("rejects an asset held by another change request (§10)", async () => {
    const tx = client({
      bookingChangeHold: { findMany: vi.fn().mockResolvedValue([{ id: "h1", changeRequestId: "r2", bookingId: "b-other", garmentAssetId: ID, accessoryAssetId: null, startDay: day("2026-01-01"), endDay: day("2026-01-02") }]) },
    });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-01"), endDay: day("2026-01-02") })).rejects.toThrow("giữ chỗ");
  });

  it("ignores the hold of the change request being applied (§7.2)", async () => {
    const tx = client({
      bookingChangeHold: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-01"), endDay: day("2026-01-02"), excludeChangeRequestId: "r2" })).resolves.toBeUndefined();
    expect(tx.bookingChangeHold.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ changeRequestId: { not: "r2" } }),
    }));
  });

  it("fails closed for an overdue rented asset", async () => {
    const tx = client({
      garmentAsset: { findUnique: vi.fn().mockResolvedValue({ id: ID, garmentId: "g1", garment_size_id: "s1", status: AssetStatus.rented }) },
      bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.overdue, "2025-12-01", "2025-12-03") }]) },
    });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-04"), endDay: day("2026-01-05"), now: day("2026-01-06") })).rejects.toThrow();
  });

  it("does not release a reserved asset whose active owner is another booking", async () => {
    const tx = client({
      garmentAsset: { findUnique: vi.fn().mockResolvedValue({ id: ID, status: AssetStatus.reserved }) },
      bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "other", garmentAssetId: ID, booking: booking("other", BookingStatus.preparing) }]), findFirst: vi.fn().mockResolvedValue({ bookingId: "other" }) },
    });
    tx.garmentAsset.updateMany = vi.fn();
    await releaseBookingAssets(tx, "b1");
    expect(tx.garmentAsset.updateMany).not.toHaveBeenCalled();
  });

  it("quarantines reserved assets for a rejected handover without passing through rented", async () => {
    const tx = client({
      booking: { findUnique: vi.fn().mockResolvedValue({ id: "b1", status: BookingStatus.ready_for_pickup, handoverStatus: "REJECTED", items: [{ id: "i1", bookingId: "b1", garmentId: "g1", garment_size_id: "s1", garmentAssetId: ID }] }) },
      garmentAsset: { findUnique: vi.fn().mockResolvedValue({ id: ID, status: AssetStatus.reserved }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.ready_for_pickup) }]) },
    });
    await transitionBookingAssets(tx, "b1", AssetStatus.reserved, AssetStatus.damaged);
    expect(tx.garmentAsset.updateMany).toHaveBeenCalledWith({ where: { id: ID, status: AssetStatus.reserved }, data: { status: AssetStatus.damaged } });
  });

  it("rejects quarantine for a non-rejected handover", async () => {
    const tx = client({
      booking: { findUnique: vi.fn().mockResolvedValue({ id: "b1", status: BookingStatus.ready_for_pickup, handoverStatus: null, items: [{ id: "i1", bookingId: "b1", garmentId: "g1", garment_size_id: "s1", garmentAssetId: ID }] }) },
    });
    await expect(transitionBookingAssets(tx, "b1", AssetStatus.reserved, AssetStatus.damaged)).rejects.toThrow("bàn giao bị từ chối");
  });
});

describe("cancelBookingTx (§8.2/§8.3)", () => {
  function cancelClient() {
    const order: string[] = [];
    const tx = client({
      bookingAdjustment: {
        updateMany: vi.fn().mockImplementation(async () => {
          order.push("void-credit");
          return { count: 2 };
        }),
      },
      booking: {
        findUnique: vi.fn().mockResolvedValue({ id: "b1", status: BookingStatus.paid, items: [], payments: [], refunds: [] }),
        updateMany: vi.fn().mockImplementation(async () => {
          order.push("cancel");
          return { count: 1 };
        }),
      },
      refund: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          order.push("refund");
          return { id: "refund-1", ...data };
        }),
      },
      financialTransaction: { create: vi.fn().mockResolvedValue({}) },
      bookingIncident: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      bookingStatusHistory: {
        create: vi.fn().mockImplementation(async () => {
          order.push("history");
          return { id: "h1" };
        }),
      },
    });
    // ensureCancellationRefunds locks + đọc booking; trả 1 payment paid để tạo refund.
    tx.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: BookingStatus.paid,
      items: [],
      payments: [{ id: "p1", amount: 500, status: "paid", paymentMethod: "cash" }],
      refunds: [],
    });
    return { tx, order };
  }

  it("void credit TRƯỚC refund, rồi cancelled + history + release voucher", async () => {
    const { tx, order } = cancelClient();
    const vouchers = { releaseForBooking: vi.fn().mockResolvedValue(undefined) };

    const result = await cancelBookingTx(tx, {
      bookingId: "b1",
      fromStatus: BookingStatus.paid,
      actorId: "mgr-1",
      reason: "Sự cố",
      vouchers,
    });

    expect(result).toBe(true);
    expect(order.indexOf("void-credit")).toBeLessThan(order.indexOf("refund"));
    expect(order.indexOf("refund")).toBeLessThan(order.indexOf("cancel"));
    expect(order.indexOf("cancel")).toBeLessThan(order.indexOf("history"));
    expect(vouchers.releaseForBooking).toHaveBeenCalledWith(tx, "b1");
  });

  it("trả false khi booking không còn ở fromStatus (bị thao tác khác đổi)", async () => {
    const { tx } = cancelClient();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    const result = await cancelBookingTx(tx, {
      bookingId: "b1",
      fromStatus: BookingStatus.paid,
      reason: "Sự cố",
    });
    expect(result).toBe(false);
  });

  it("đóng mọi sự cố đang mở của đơn khi hủy (mọi đường hủy dùng chung)", async () => {
    const { tx } = cancelClient();
    tx.bookingIncident = { updateMany: vi.fn().mockResolvedValue({ count: 2 }) };

    const result = await cancelBookingTx(tx, {
      bookingId: "b1",
      fromStatus: BookingStatus.paid,
      actorId: "mgr-1",
      reason: "Khách tự hủy",
    });

    expect(result).toBe(true);
    expect(tx.bookingIncident.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b1", status: { in: ["open", "awaiting_customer", "needs_manager"] } },
      data: expect.objectContaining({
        status: "resolved",
        resolution: "booking_cancelled",
        resolvedAt: expect.any(Date),
        resolvedBy: "mgr-1",
        note: "Khách tự hủy",
      }),
    });
  });

  it("không đóng sự cố khi đơn không còn ở fromStatus (thao tác khác đã xử lý)", async () => {
    const { tx } = cancelClient();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    tx.bookingIncident = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };

    await cancelBookingTx(tx, { bookingId: "b1", fromStatus: BookingStatus.paid, reason: "Sự cố" });

    expect(tx.bookingIncident.updateMany).not.toHaveBeenCalled();
  });
});
