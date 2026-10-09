import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { VouchersService } from "./vouchers.service";

function voucher(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    code: "SALE10",
    name: "Sale",
    description: null,
    discount_type: "percentage",
    discount_value: 10,
    max_discount_amount: null,
    min_order_value: 0,
    usage_limit: null,
    used_count: 0,
    per_user_limit: 1,
    start_at: new Date("2026-01-01"),
    end_at: new Date("2027-01-01"),
    category_ids: [],
    garment_ids: [],
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeDb(v: unknown, usedByUser = 0) {
  return {
    vouchers: { findUnique: vi.fn().mockResolvedValue(v) },
    voucher_usages: { count: vi.fn().mockResolvedValue(usedByUser) },
  };
}

const svc = new VouchersService({} as never, {} as never);
const now = new Date("2026-10-08");
const lines = [
  { garmentId: "g1", categoryId: "c1", amount: 300_000 },
  { garmentId: "g2", categoryId: "c2", amount: 200_000 },
];

describe("VouchersService.evaluate", () => {
  it("giảm % có mức tối đa", async () => {
    const r = await svc.evaluate(makeDb(voucher({ discount_value: 20, max_discount_amount: 50_000 })) as never, "sale10", "u1", lines, now);
    expect(r.discountAmount).toBe(50_000);
  });

  it("giảm số tiền cố định, không vượt giá trị đủ điều kiện", async () => {
    const r = await svc.evaluate(
      makeDb(voucher({ discount_type: "fixed", discount_value: 999_000, garment_ids: ["g2"] })) as never,
      "SALE10",
      "u1",
      lines,
      now,
    );
    expect(r.eligibleSubtotal).toBe(200_000);
    expect(r.discountAmount).toBe(200_000);
  });

  it("chỉ tính trên nhóm sản phẩm được áp dụng", async () => {
    const r = await svc.evaluate(makeDb(voucher({ category_ids: ["c1"] })) as never, "SALE10", "u1", lines, now);
    expect(r.discountAmount).toBe(30_000);
  });

  it.each([
    ["hết hạn", voucher({ end_at: new Date("2026-01-02") }), 0],
    ["chưa bắt đầu", voucher({ start_at: new Date("2026-12-01") }), 0],
    ["hết lượt", voucher({ usage_limit: 5, used_count: 5 }), 0],
    ["khách đã dùng đủ lượt", voucher({ per_user_limit: 1 }), 1],
    ["chưa đạt giá trị tối thiểu", voucher({ min_order_value: 1_000_000 }), 0],
    ["không áp dụng cho sản phẩm", voucher({ garment_ids: ["gX"] }), 0],
    ["bị vô hiệu hoá", voucher({ is_active: false }), 0],
  ])("từ chối khi %s", async (_label, v, used) => {
    await expect(svc.evaluate(makeDb(v, used as number) as never, "SALE10", "u1", lines, now)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
