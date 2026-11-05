import { describe, expect, it } from "vitest";
import { resolvePenaltyFromTable, entryToSeverity } from "./damage-fee";
import type { DamageFeeEntry } from "../admin/admin.constants";

const table: DamageFeeEntry[] = [
  { label: "Rách nhỏ / sờn vải nhẹ", amount: 50000, severity: "low" },
  { label: "Mất khuy / tuột chỉ", amount: 30000, severity: "low" },
  { label: "Vết bẩn không giặt sạch", amount: 80000, severity: "medium" },
  { label: "Rách to / mất phụ kiện đính", pct: 20, severity: "medium" },
  { label: "Biến dạng / ố vàng nghiêm trọng", pct: 40, severity: "high" },
  { label: "Hư hỏng không phục hồi / mất đồ", pct: 100, severity: "severe" },
];

describe("resolvePenaltyFromTable", () => {
  it("returns fixed amount directly when entry has amount", () => {
    expect(resolvePenaltyFromTable("Rách nhỏ / sờn vải nhẹ", table, 300000)).toBe(50000);
    expect(resolvePenaltyFromTable("Mất khuy / tuột chỉ", table, 1000000)).toBe(30000);
  });

  it("calculates percentage of garment value and rounds to nearest 1000", () => {
    // 20% of 500,000 = 100,000
    expect(resolvePenaltyFromTable("Rách to / mất phụ kiện đính", table, 500000)).toBe(100000);
    // 40% of 450,000 = 180,000
    expect(resolvePenaltyFromTable("Biến dạng / ố vàng nghiêm trọng", table, 450000)).toBe(180000);
    // 100% of 350,000 = 350,000
    expect(resolvePenaltyFromTable("Hư hỏng không phục hồi / mất đồ", table, 350000)).toBe(350000);
  });

  it("handles case-insensitivity and whitespace trimming", () => {
    expect(resolvePenaltyFromTable("  rách nhỏ / sờn vải nhẹ  ", table, 300000)).toBe(50000);
  });

  it("returns undefined when label does not exist in table", () => {
    expect(resolvePenaltyFromTable("Lỗi không xác định", table, 500000)).toBeUndefined();
  });

  it("returns 0 when garmentValue is 0 and pct is specified", () => {
    expect(resolvePenaltyFromTable("Rách to / mất phụ kiện đính", table, 0)).toBe(0);
  });
});

describe("entryToSeverity", () => {
  it("returns configured severity for matched entry", () => {
    expect(entryToSeverity("Rách nhỏ / sờn vải nhẹ", table)).toBe("low");
    expect(entryToSeverity("Vết bẩn không giặt sạch", table)).toBe("medium");
    expect(entryToSeverity("Biến dạng / ố vàng nghiêm trọng", table)).toBe("high");
    expect(entryToSeverity("Hư hỏng không phục hồi / mất đồ", table)).toBe("severe");
  });

  it("returns 'low' as fallback for unknown labels", () => {
    expect(entryToSeverity("Lỗi lạ", table)).toBe("low");
  });
});

