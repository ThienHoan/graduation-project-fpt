/**
 * Logic chọn phạm vi áp dụng của "Lịch sự kiện".
 *
 * Một garment khớp nếu `apply_all = true` hoặc nằm trong danh sách sản phẩm
 * cụ thể (`target_garment_ids`). Các nhóm danh mục/dịp/từ khóa cũ đã được bỏ.
 */

export type CalendarTargetConfig = {
  applyAll: boolean;
  garmentIds: string[];
};

export type CalendarTargetGarment = {
  id: string;
};

/** Trim, bỏ rỗng và dedupe không phân biệt hoa thường (giữ giá trị đầu tiên). */
export function normalizeTargetList(
  values: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function hasAnyTargetSelection(config: CalendarTargetConfig): boolean {
  return config.applyAll || config.garmentIds.length > 0;
}

export function matchesCalendarTarget(
  garment: CalendarTargetGarment,
  config: CalendarTargetConfig,
): boolean {
  return config.applyAll || config.garmentIds.includes(garment.id);
}

export function targetConfigFromRow(row: {
  apply_all: boolean;
  target_garment_ids: string[];
}): CalendarTargetConfig {
  return {
    applyAll: row.apply_all,
    garmentIds: row.target_garment_ids,
  };
}
