import { describe, expect, it } from "vitest";
import {
  hasAnyTargetSelection,
  matchesCalendarTarget,
  normalizeTargetList,
  targetConfigFromRow,
  type CalendarTargetConfig,
} from "./price-calendar-targets";

function config(overrides: Partial<CalendarTargetConfig> = {}): CalendarTargetConfig {
  return {
    applyAll: false,
    garmentIds: [],
    ...overrides,
  };
}

describe("price-calendar-targets", () => {
  it("applyAll áp dụng cho mọi garment", () => {
    expect(
      matchesCalendarTarget({ id: "g1" }, config({ applyAll: true })),
    ).toBe(true);
  });

  it("khớp theo sản phẩm cụ thể", () => {
    const target = config({ garmentIds: ["g9"] });
    expect(matchesCalendarTarget({ id: "g9" }, target)).toBe(true);
    expect(matchesCalendarTarget({ id: "g1" }, target)).toBe(false);
  });

  it("chuẩn hóa danh sách: trim, bỏ rỗng, dedupe", () => {
    expect(normalizeTargetList([" g1 ", "G1", "", "g2"])).toEqual(["g1", "g2"]);
  });

  it("phát hiện chưa chọn phạm vi nào", () => {
    expect(hasAnyTargetSelection(config())).toBe(false);
    expect(hasAnyTargetSelection(config({ applyAll: true }))).toBe(true);
    expect(hasAnyTargetSelection(config({ garmentIds: ["g1"] }))).toBe(true);
  });

  it("map đúng cấu hình từ row DB", () => {
    expect(
      targetConfigFromRow({
        apply_all: false,
        target_garment_ids: ["g1"],
      }),
    ).toEqual({
      applyAll: false,
      garmentIds: ["g1"],
    });
  });
});
