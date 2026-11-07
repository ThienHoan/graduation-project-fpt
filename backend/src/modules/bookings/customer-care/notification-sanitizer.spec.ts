import { describe, expect, it } from "vitest";
import {
  isRetryableNotificationError,
  sanitizeNotificationError,
} from "./notification-sanitizer";

describe("NotificationSanitizer", () => {
  describe("sanitizeNotificationError", () => {
    it("trả về null nếu error là null hoặc undefined", () => {
      expect(sanitizeNotificationError(null)).toBeNull();
      expect(sanitizeNotificationError(undefined)).toBeNull();
    });

    it("loại bỏ Bearer tokens", () => {
      const raw = "HTTP 401 Unauthorized: Authorization Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123 failed";
      const sanitized = sanitizeNotificationError(raw);
      expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123");
      expect(sanitized).toContain("Bearer [REDACTED]");
    });

    it("loại bỏ Resend API keys", () => {
      const raw = "Failed to dispatch email with key re_1234567890abcdef123456: rate limited";
      const sanitized = sanitizeNotificationError(raw);
      expect(sanitized).not.toContain("re_1234567890abcdef123456");
      expect(sanitized).toContain("re_[REDACTED]");
    });

    it("loại bỏ Brevo API keys", () => {
      const raw = "Brevo API call failed: xkeysib-9876543210fedcba-invalid-call";
      const sanitized = sanitizeNotificationError(raw);
      expect(sanitized).not.toContain("xkeysib-9876543210fedcba-invalid-call");
      expect(sanitized).toContain("xkeysib-[REDACTED]");
    });

    it("loại bỏ password trong database URL", () => {
      const raw = "Connection failed: postgresql://postgres:super_secret_password_123@db.example.com:5432/cophuc";
      const sanitized = sanitizeNotificationError(raw);
      expect(sanitized).not.toContain("super_secret_password_123");
      expect(sanitized).toContain("postgresql://postgres:[REDACTED]@db.example.com:5432/cophuc");
    });
  });

  describe("isRetryableNotificationError", () => {
    it("cho phép retry khi lỗi là timeout hoặc network", () => {
      expect(isRetryableNotificationError("Connection timeout after 10000ms")).toBe(true);
      expect(isRetryableNotificationError("ECONNREFUSED 127.0.0.1:587")).toBe(true);
      expect(isRetryableNotificationError("HTTP 502 Bad Gateway")).toBe(true);
      expect(isRetryableNotificationError("HTTP 429 Too Many Requests")).toBe(true);
      expect(isRetryableNotificationError(null)).toBe(true);
    });

    it("từ chối retry khi lỗi là invalid email hoặc cú pháp hỏng", () => {
      expect(isRetryableNotificationError("Invalid email address syntax: test@@example")).toBe(false);
      expect(isRetryableNotificationError("Recipient address rejected by server")).toBe(false);
      expect(isRetryableNotificationError("Template not found: booking.unknown")).toBe(false);
      expect(isRetryableNotificationError("User has unsubscribed from all marketing")).toBe(false);
    });
  });
});

