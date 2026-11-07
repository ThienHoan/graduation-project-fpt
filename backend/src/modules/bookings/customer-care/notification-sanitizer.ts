/**
 * Helper chuyên biệt cho Customer Care & Notification:
 * 1. Làm sạch lỗi (sanitization) loại bỏ credential, secret, API keys trước khi hiển thị cho manager/admin.
 * 2. Phân loại lỗi xem có đủ điều kiện thử lại (retryable) hay không.
 */

const SENSITIVE_PATTERNS = [
  // Bearer tokens & JWTs
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // Resend API keys
  /re_[A-Za-z0-9_-]+/gi,
  // Brevo API keys
  /xkeysib-[A-Za-z0-9_-]+/gi,
  // Database connection passwords: postgresql://user:pass@host...
  /:\/\/([^:]+):([^@]+)@/g,
  // Common key-value secrets
  /(password|token|key|secret|apiKey|smtp_password)\s*[:=]\s*["']?([^\s,"']+)["']?/gi,
];

const NON_RETRYABLE_PATTERNS = [
  /invalid\s+email/i,
  /invalid\s+recipient/i,
  /recipient\s+address\s+rejected/i,
  /syntax\s+error\s+in\s+parameters/i,
  /email\s+syntax/i,
  /template\s+not\s+found/i,
  /unsubscribed/i,
  /opted\s+out/i,
  /user\s+not\s+found/i,
  /booking\s+not\s+found/i,
];

/**
 * Loại bỏ toàn bộ credentials, secrets, API keys khỏi nội dung lỗi.
 */
export function sanitizeNotificationError(rawError?: unknown): string | null {
  if (rawError === null || rawError === undefined) {
    return null;
  }

  let text = typeof rawError === "string" ? rawError : String(rawError);

  text = text.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
  text = text.replace(/re_[A-Za-z0-9_-]+/gi, "re_[REDACTED]");
  text = text.replace(/xkeysib-[A-Za-z0-9_-]+/gi, "xkeysib-[REDACTED]");
  text = text.replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:[REDACTED]@");
  text = text.replace(
    /(password|token|key|secret|apiKey|smtp_password)\s*[:=]\s*["']?([^\s,"']+)["']?/gi,
    "$1=[REDACTED]",
  );

  return text.trim();
}

/**
 * Đánh giá lỗi có thể retry an toàn hay không.
 * Nếu lỗi do địa chỉ email sai định dạng hoặc template không tồn tại -> Không retry.
 */
export function isRetryableNotificationError(error?: string | null): boolean {
  if (!error) {
    // Nếu không có lỗi cụ thể mà trạng thái failed (ví dụ timeout im lặng) -> Cho phép retry
    return true;
  }

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(error)) {
      return false;
    }
  }

  return true;
}

