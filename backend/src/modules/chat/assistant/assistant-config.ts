/**
 * Cấu hình runtime cho chat CSKH.
 *
 * Đọc env tại thời điểm gọi (không cache ở module load) để test và vận hành
 * có thể đổi mà không cần sửa code.
 */

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

/**
 * Cho phép trả thông tin ngân hàng/STK từ cấu hình FAQ.
 * Mặc định tắt: mọi câu hỏi STK đều chuyển STAFF.
 */
export function isBankAccountAutoReplyEnabled(): boolean {
  return readBoolean("BANK_ACCOUNT_AUTO_REPLY", false);
}

export const DEFAULT_HANDOFF_TTL_MINUTES = 30;
export const DEFAULT_SENSITIVE_HANDOFF_TTL_MINUTES = 1440;

function readPositiveMinutes(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

/**
 * Handoff thường tự hết hạn sau 30 phút; handoff nhạy cảm (khiếu nại, hoàn
 * tiền, thanh toán...) giữ lâu hơn để bot không chen tư vấn bán hàng.
 */
export function getHandoffTtlMs(sensitive = false): number {
  const minutes = sensitive
    ? readPositiveMinutes(
        "CHAT_HANDOFF_SENSITIVE_TTL_MINUTES",
        DEFAULT_SENSITIVE_HANDOFF_TTL_MINUTES,
      )
    : readPositiveMinutes(
        "CHAT_HANDOFF_TTL_MINUTES",
        DEFAULT_HANDOFF_TTL_MINUTES,
      );
  return minutes * 60_000;
}

/** Dùng chung cho HandoffService và AssistantContextService. */
export function isHandoffExpired(
  openedAt: Date | null | undefined,
  sensitive = false,
  now = new Date(),
): boolean {
  if (!openedAt) return false;
  return now.getTime() - openedAt.getTime() >= getHandoffTtlMs(sensitive);
}
