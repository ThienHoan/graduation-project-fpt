import { describe, expect, it, vi } from "vitest";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { assertAssetScheduleAvailable, releaseBookingAssets, transitionBookingAssets } from "./booking-reservations";

const ID = "11111111-1111-4111-8111-111111111111";
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const booking = (id: string, status: BookingStatus, from = "2026-01-01", to = "2026-01-03") => ({
  id, status, rentalStartDate: day(from), rentalEndDate: day(to),
});
function client(overrides: Record<string, unknown> = {}) {
  return {
    garmentAsset: { findUnique: vi.fn().mockResolvedValue({ id: ID, garmentId: "g1", garment_size_id: "s1", status: AssetStatus.available }) },
    bookingItem: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    ...overrides,
  } as any;
}

describe("booking reservation helper", () => {
  it("allows a non-overlapping scheduled assignment", async () => {
    const tx = client({ bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") }]) } });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-04"), endDay: day("2026-01-05") })).resolves.toBeUndefined();
  });

  it("rejects an inclusive same-day schedule conflict", async () => {
    const tx = client({ bookingItem: { findMany: vi.fn().mockResolvedValue([{ id: "i1", bookingId: "b1", garmentAssetId: ID, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") }]) } });
    await expect(assertAssetScheduleAvailable(tx, { assetId: ID, bookingId: "b2", startDay: day("2026-01-03"), endDay: day("2026-01-04") })).rejects.toThrow("trùng ngày");
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
