import { describe, expect, it, vi } from "vitest";
import { PriceRulesService } from "./price-rules.service";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function rule(overrides: Record<string, unknown>) {
  return {
    id: Math.random().toString(36).slice(2),
    name: "rule",
    rule_type: "holiday",
    start_date: null,
    end_date: null,
    recurring_yearly: false,
    days_of_week: [],
    percentage: null,
    fixed_amount: null,
    priority: 0,
    category_ids: [],
    garment_ids: [],
    is_active: true,
    note: null,
    created_at: new Date("2026-01-01"),
    updated_at: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeService(rules: unknown[]) {
  const prisma = { price_rules: { findMany: vi.fn().mockResolvedValue(rules) } };
  return new PriceRulesService(prisma as never);
}

const target = { sizeId: "s1", garmentId: "g1", categoryId: "c1", basePrice: 100_000 };

describe("PriceRulesService.quote", () => {
  it("áp rule ưu tiên cao nhất cho từng ngày (Tết > Lễ > Sale đôi > Cuối tuần)", async () => {
    const svc = makeService([
      rule({ name: "Cuối tuần", rule_type: "weekend", days_of_week: [0, 6], percentage: 10, priority: 40 }),
      rule({ name: "Sale 10/10", rule_type: "double_sale", start_date: d("2026-10-10"), end_date: d("2026-10-10"), recurring_yearly: true, percentage: -20, priority: 60 }),
    ]);
    // 2026-10-09 (T6) gốc, 10/10 (T7) sale đôi thắng cuối tuần, 11/10 (CN) cuối tuần
    const q = (await svc.quote([target], d("2026-10-09"), d("2026-10-11"))).get("s1")!;
    expect(q.breakdown.map((b) => b.price)).toEqual([100_000, 80_000, 110_000]);
    expect(q.rentalTotal).toBe(290_000);
    expect(q.basePrice).toBe(100_000);
  });

  it("rule lặp hằng năm vắt qua năm mới", async () => {
    const svc = makeService([
      rule({ start_date: d("2025-12-30"), end_date: d("2026-01-02"), recurring_yearly: true, percentage: 50, priority: 100 }),
    ]);
    const q = (await svc.quote([target], d("2027-01-01"), d("2027-01-03"))).get("s1")!;
    expect(q.breakdown.map((b) => b.price)).toEqual([150_000, 150_000, 100_000]);
  });

  it("chỉ áp rule cho nhóm sản phẩm được chọn", async () => {
    const svc = makeService([rule({ category_ids: ["other"], start_date: d("2026-10-01"), end_date: d("2026-10-31"), percentage: 30 })]);
    const q = (await svc.quote([target], d("2026-10-05"), d("2026-10-05"))).get("s1")!;
    expect(q.rentalTotal).toBe(100_000);
    expect(q.appliedPriceRule).toBeNull();
  });

  it("giá chốt thủ công (price_periods) thắng rule tự động", async () => {
    const svc = makeService([rule({ start_date: d("2026-10-01"), end_date: d("2026-10-31"), percentage: 30, priority: 100 })]);
    const q = (
      await svc.quote(
        [{ ...target, overrides: [{ from: d("2026-10-05"), to: d("2026-10-05"), price: 90_000 }] }],
        d("2026-10-05"),
        d("2026-10-06"),
      )
    ).get("s1")!;
    expect(q.breakdown.map((b) => b.price)).toEqual([90_000, 130_000]);
  });

  it("cộng số tiền cố định và không âm", async () => {
    const svc = makeService([rule({ start_date: d("2026-10-01"), end_date: d("2026-10-31"), fixed_amount: -500_000 })]);
    const q = (await svc.quote([target], d("2026-10-05"), d("2026-10-05"))).get("s1")!;
    expect(q.rentalTotal).toBe(0);
  });
});
