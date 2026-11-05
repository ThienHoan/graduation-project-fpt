import type { DamageFeeEntry } from "../admin/admin.constants";

/**
 * Tra cứu bảng định mức lỗi theo label và tính mức tiền phạt.
 * @param label Tên loại lỗi
 * @param table Bảng định mức từ system_settings
 * @param garmentValue Giá trị tham chiếu của đồ (VND)
 * @returns Số tiền phạt VND (hoặc undefined nếu không khớp định mức nào)
 */
export function resolvePenaltyFromTable(
  label: string,
  table: DamageFeeEntry[],
  garmentValue: number,
): number | undefined {
  const normalized = label.trim().toLowerCase();
  const entry = table.find((e) => e.label.trim().toLowerCase() === normalized);
  if (!entry) return undefined;

  if (entry.amount !== undefined && entry.amount !== null) {
    return Number(entry.amount);
  }

  if (entry.pct !== undefined && entry.pct !== null) {
    const raw = (garmentValue * Number(entry.pct)) / 100;
    return Math.round(raw / 1000) * 1000;
  }

  return 0;
}

/**
 * Lấy mức độ nghiêm trọng tương ứng từ định mức lỗi.
 */
export function entryToSeverity(label: string, table: DamageFeeEntry[]): string {
  const normalized = label.trim().toLowerCase();
  const entry = table.find((e) => e.label.trim().toLowerCase() === normalized);
  return entry?.severity ?? "low";
}

