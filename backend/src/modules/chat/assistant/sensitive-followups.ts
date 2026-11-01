/**
 * Cấu hình các cụm follow-up nhạy cảm.
 *
 * Chỉ dùng khi hội thoại ĐANG có handoff mở: khách hỏi trực tiếp về kết quả
 * của vụ việc (đã hoàn cọc chưa, hủy được chưa...) thì không được trả lời
 * bằng FAQ/DB hay để LLM tự xác nhận.
 *
 * Danh sách cố ý để ngắn và rõ ràng; mỗi lần kích hoạt đều được log
 * (`sensitive_followup`) để bổ sung sau khi xem dữ liệu thật.
 */

export const SENSITIVE_FOLLOWUP_PHRASES: string[] = [
  "da hoan coc chua",
  "hoan coc chua",
  "hoan tien chua",
  "da hoan tien chua",
  "huy duoc chua",
  "da huy duoc chua",
  "da huy chua",
  "nhan tien chua",
  "da nhan tien chua",
  "doi lich duoc chua",
  "doi duoc chua",
];

/** Reason handoff khiến nhánh AI bị chặn (không tư vấn bán hàng). */
export const SENSITIVE_HANDOFF_REASONS = new Set([
  "complaint",
  "refund",
  "order_change",
  "payment",
]);

export function isSensitiveHandoff(reason?: string | null, sensitive?: boolean | null): boolean {
  if (sensitive) return true;
  return Boolean(reason && SENSITIVE_HANDOFF_REASONS.has(reason));
}
