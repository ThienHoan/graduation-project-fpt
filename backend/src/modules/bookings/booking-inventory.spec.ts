import { describe, expect, it } from "vitest";
import {
  isUnreturnedOverdue,
  parseRentalDateRange,
  sizeAvailability,
  sizeAvailabilityCalendar,
  type SizeInventorySnapshot,
} from "./booking-inventory";
import { AssetStatus, BookingStatus } from "@prisma/client";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const asset = (id: string, status: AssetStatus = AssetStatus.available) => ({ id, status });
const booking = (id: string, status: BookingStatus, from: string, to: string) => ({
  id, status, rentalStartDate: day(from), rentalEndDate: day(to),
});
function snapshot(overrides: Partial<SizeInventorySnapshot> = {}): SizeInventorySnapshot {
  return {
    startDay: day("2026-01-01"), endDay: day("2026-01-10"), today: day("2026-01-05"),
    assets: [asset("a1"), asset("a2")], items: [], ...overrides,
  };
}

describe("booking inventory helper", () => {
  it("uses inclusive rental dates and rejects reversed dates", () => {
    expect(parseRentalDateRange("2026-01-01", "2026-01-01").days).toBe(1);
    expect(parseRentalDateRange("2026-01-01", "2026-01-03").days).toBe(3);
    expect(() => parseRentalDateRange("2026-01-03", "2026-01-01")).toThrow();
  });

  it("uses peak concurrent demand, not the sum of sequential spans", () => {
    const result = sizeAvailability(snapshot({
      items: [
        { garmentAssetId: null, booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03") },
        { garmentAssetId: null, booking: booking("b2", BookingStatus.confirmed, "2026-01-04", "2026-01-06") },
      ],
    }));
    expect(result).toEqual({ capacity: 2, committed: 1, available: 1 });
  });

  it("counts same-day ranges concurrently", () => {
    const result = sizeAvailability(snapshot({
      items: [
        { garmentAssetId: null, booking: booking("b1", BookingStatus.confirmed, "2026-01-02", "2026-01-04") },
        { garmentAssetId: null, booking: booking("b2", BookingStatus.confirmed, "2026-01-04", "2026-01-05") },
      ],
    }));
    expect(result.committed).toBe(2);
  });

  it("keeps an overdue unreturned rental unavailable without subtracting it twice", () => {
    const result = sizeAvailability(snapshot({
      assets: [asset("a1", AssetStatus.rented), asset("a2")],
      items: [{ garmentAssetId: "a1", booking: booking("b1", BookingStatus.overdue, "2025-12-20", "2026-01-02") }],
    }));
    expect(result).toEqual({ capacity: 2, committed: 1, available: 1 });
  });

  it("makes the calendar use the same occupancy model as range availability", () => {
    const data = snapshot({
      items: [{ garmentAssetId: null, booking: booking("b1", BookingStatus.confirmed, "2026-01-02", "2026-01-03") }],
    });
    const calendar = sizeAvailabilityCalendar(data);
    expect(calendar.find((row) => row.date === "2026-01-01")?.availableCount).toBe(2);
    expect(calendar.find((row) => row.date === "2026-01-02")?.availableCount).toBe(1);
    expect(calendar.find((row) => row.date === "2026-01-03")?.availableCount).toBe(1);
    expect(calendar.find((row) => row.date === "2026-01-04")?.availableCount).toBe(2);
  });

  it("does not call a completed or cancelled booking demand", () => {
    const result = sizeAvailability(snapshot({
      items: [{ garmentAssetId: null, booking: booking("b1", BookingStatus.cancelled, "2026-01-01", "2026-01-10") }],
    }));
    expect(result.committed).toBe(0);
  });

  it("recognizes only active renting/overdue bookings past their expected return", () => {
    expect(isUnreturnedOverdue(booking("b1", BookingStatus.renting, "2026-01-01", "2026-01-04"), day("2026-01-05"))).toBe(true);
    expect(isUnreturnedOverdue(booking("b2", BookingStatus.returned, "2026-01-01", "2026-01-04"), day("2026-01-05"))).toBe(false);
  });

  it("blocks laundry buffer days after rentalEndDate", () => {
    // 1 chiếc áo, 1 đơn kết thúc ngày 03.
    // Với buffer=1 ngày, ngày 04 vẫn bị khoá → available chỉ từ ngày 05.
    const result = sizeAvailability(
      snapshot({
        startDay: day("2026-01-04"),
        endDay: day("2026-01-04"),
        assets: [asset("a1")],
        items: [
          {
            garmentAssetId: null,
            booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03"),
          },
        ],
        laundryBufferDays: 1,
      }),
    );
    expect(result.available).toBe(0);
  });

  it("does not block when request starts after buffer window", () => {
    const result = sizeAvailability(
      snapshot({
        startDay: day("2026-01-05"),
        endDay: day("2026-01-05"),
        assets: [asset("a1")],
        items: [
          {
            garmentAssetId: null,
            booking: booking("b1", BookingStatus.confirmed, "2026-01-01", "2026-01-03"),
          },
        ],
        laundryBufferDays: 1,
      }),
    );
    expect(result.available).toBe(1);
  });

  it("does not apply buffer to INVENTORY_RELEASED_STATUSES that already exclude demand", () => {
    // completed đơn không tính demand — buffer không áp dụng
    const result = sizeAvailability(
      snapshot({
        startDay: day("2026-01-04"),
        endDay: day("2026-01-04"),
        assets: [asset("a1")],
        items: [
          {
            garmentAssetId: null,
            booking: booking("b1", BookingStatus.completed, "2026-01-01", "2026-01-03"),
          },
        ],
        laundryBufferDays: 1,
      }),
    );
    expect(result.available).toBe(1);
  });

  it("counts a change-request hold as +1 demand (§10)", () => {
    const result = sizeAvailability(
      snapshot({
        startDay: day("2026-01-02"),
        endDay: day("2026-01-03"),
        assets: [asset("a1"), asset("a2")],
        items: [],
        holds: [{ garmentAssetId: "a1", startDay: day("2026-01-02"), endDay: day("2026-01-03") }],
      }),
    );
    expect(result).toEqual({ capacity: 2, committed: 1, available: 1 });
  });

  it("does not double count a hold whose asset is already held by an item (§10)", () => {
    const result = sizeAvailability(
      snapshot({
        startDay: day("2026-01-02"),
        endDay: day("2026-01-03"),
        assets: [asset("a1")],
        items: [
          { garmentAssetId: "a1", booking: booking("b1", BookingStatus.confirmed, "2026-01-02", "2026-01-03") },
        ],
        holds: [{ garmentAssetId: "a1", startDay: day("2026-01-02"), endDay: day("2026-01-03") }],
      }),
    );
    expect(result.committed).toBe(1);
  });

  it("only counts one demand per asset across duplicate holds", () => {
    const result = sizeAvailability(
      snapshot({
        startDay: day("2026-01-02"),
        endDay: day("2026-01-03"),
        assets: [asset("a1"), asset("a2")],
        items: [],
        holds: [
          { garmentAssetId: "a1", startDay: day("2026-01-02"), endDay: day("2026-01-03") },
          { garmentAssetId: "a1", startDay: day("2026-01-02"), endDay: day("2026-01-03") },
        ],
      }),
    );
    expect(result.committed).toBe(1);
  });

  it("a hold does not reduce availability for its own booking but does for another (§10.1)", () => {
    const holds = [{ garmentAssetId: "a1", startDay: day("2026-01-02"), endDay: day("2026-01-03") }];
    // loadSizeInventory đã lọc hold theo excludeBookingId trước khi dựng snapshot:
    // tính cho chính đơn X ⇒ danh sách hold rỗng ⇒ available = 2.
    const ownView = sizeAvailability(
      snapshot({ startDay: day("2026-01-02"), endDay: day("2026-01-03"), assets: [asset("a1"), asset("a2")], items: [], holds: [] }),
    );
    expect(ownView.available).toBe(2);
    // Tính cho đơn khác ⇒ hold còn sống ⇒ giảm đúng 1.
    const otherView = sizeAvailability(
      snapshot({ startDay: day("2026-01-02"), endDay: day("2026-01-03"), assets: [asset("a1"), asset("a2")], items: [], holds }),
    );
    expect(otherView).toEqual({ capacity: 2, committed: 1, available: 1 });
  });

  it("expired holds are filtered upstream so they never add demand (§10.4)", () => {
    // loadSizeInventory/loadAccessoryInventory chỉ truyền hold còn sống (expiresAt > now
    // AND consumedAt IS NULL) vào snapshot; hold hết hạn ⇒ holds rỗng ⇒ không cộng demand.
    const result = sizeAvailability(
      snapshot({ startDay: day("2026-01-02"), endDay: day("2026-01-03"), assets: [asset("a1"), asset("a2")], items: [], holds: [] }),
    );
    expect(result).toEqual({ capacity: 2, committed: 0, available: 2 });
  });
});
