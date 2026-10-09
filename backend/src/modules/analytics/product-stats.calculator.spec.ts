import { describe, expect, it } from "vitest";
import { computeProductStats, overlapDays, type GarmentInfo, type ItemRow } from "./product-stats.calculator";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function garment(id: string, extra: Partial<GarmentInfo> = {}): GarmentInfo {
  return {
    id,
    name: id,
    isActive: true,
    createdAt: d("2026-01-01"),
    categoryId: null,
    categoryName: null,
    imageUrl: null,
    minDailyPrice: 100_000,
    assetCount: 2,
    ...extra,
  };
}

function item(garmentId: string, status: string, start: string, end: string, extra: Partial<ItemRow> = {}): ItemRow {
  return {
    garmentId,
    dailyPrice: 100_000,
    status,
    bookingCreatedAt: d(start),
    rentalStart: d(start),
    rentalEnd: d(end),
    bookingSubtotal: 0,
    bookingDiscount: 0,
    ...extra,
  };
}

const opts = { from: d("2026-09-01"), to: d("2026-09-30"), sortBy: "revenue" as const, hotLimit: 1, lowDemandMaxRentals: 0, minAgeDays: 30 };

describe("computeProductStats", () => {
  it("overlapDays tính cả 2 đầu", () => {
    expect(overlapDays(d("2026-09-01"), d("2026-09-03"), d("2026-09-02"), d("2026-09-10"))).toBe(2);
    expect(overlapDays(d("2026-09-01"), d("2026-09-01"), d("2026-09-02"), d("2026-09-10"))).toBe(0);
  });

  it("tính lượt thuê, doanh thu (trừ voucher), tỷ lệ huỷ, ngày trống", () => {
    const [a] = computeProductStats(
      [garment("a")],
      [
        item("a", "completed", "2026-09-05", "2026-09-06", { bookingSubtotal: 200_000, bookingDiscount: 20_000 }),
        item("a", "pending_confirmation", "2026-09-10", "2026-09-10"),
        item("a", "cancelled", "2026-09-12", "2026-09-12"),
      ],
      new Map([["a", 10]]),
      new Map([["a", 3]]),
      new Map([["a", { avg: 4.5, count: 2 }]]),
      opts,
    );
    expect(a.rentCount).toBe(2);
    expect(a.revenue).toBe(180_000); // chỉ đơn đã thanh toán, trừ 10% voucher
    expect(a.cancelRate).toBeCloseTo(1 / 3, 3);
    expect(a.bookedDays).toBe(3);
    expect(a.availableDays).toBe(60 - 3);
    expect(a.conversionRate).toBe(0.2);
    expect(a.tryons).toBe(3);
    expect(a.avgRating).toBe(4.5);
  });

  it("phân loại HOT / LOW_DEMAND / NEW và chỉ đề xuất, không xoá", () => {
    const stats = computeProductStats(
      [garment("hot"), garment("low"), garment("new", { createdAt: d("2026-09-20") })],
      [item("hot", "paid", "2026-09-05", "2026-09-06")],
      new Map([["low", 50]]),
      new Map(),
      new Map(),
      opts,
    );
    const by = Object.fromEntries(stats.map((s) => [s.garmentId, s]));
    expect(by.hot.classification).toBe("HOT");
    expect(by.hot.hotRank).toBe(1);
    expect(by.new.classification).toBe("NEW");
    expect(by.low.classification).toBe("LOW_DEMAND");
    expect(by.low.recommendations.map((r) => r.action)).toContain("discount");
    expect(stats).toHaveLength(3);
  });

  it("xếp HOT theo số booking khi sortBy = bookings", () => {
    const stats = computeProductStats(
      [garment("a"), garment("b")],
      [
        item("a", "paid", "2026-09-05", "2026-09-10"),
        item("b", "paid", "2026-09-05", "2026-09-05"),
        item("b", "paid", "2026-09-07", "2026-09-07"),
      ],
      new Map(),
      new Map(),
      new Map(),
      { ...opts, sortBy: "bookings" },
    );
    expect(stats.find((s) => s.classification === "HOT")!.garmentId).toBe("b");
  });
});
