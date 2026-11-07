import { describe, expect, it } from "vitest";
import {
  CustomerNotificationPreferencesPolicy,
  PROMOTIONAL_TEMPLATES,
  TRANSACTIONAL_TEMPLATES,
} from "./customer-notification-preferences.policy";

describe("CustomerNotificationPreferencesPolicy", () => {
  describe("Phân loại Template (Categorization)", () => {
    it("nhận diện đúng các template Transactional vận hành bắt buộc", () => {
      expect(CustomerNotificationPreferencesPolicy.isTransactional("booking.pickup_reminder")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isTransactional("booking.return_reminder")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isTransactional("booking.overdue")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isTransactional("booking.extension_applied")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isTransactional("booking.payment_received")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isTransactional("auth.password_reset")).toBe(true);
    });

    it("nhận diện đúng các template Promotional tiếp thị tùy chọn", () => {
      expect(CustomerNotificationPreferencesPolicy.isPromotional("booking.review_invite")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isPromotional("booking.thank_you_voucher")).toBe(true);
      expect(CustomerNotificationPreferencesPolicy.isPromotional("marketing.seasonal_campaign")).toBe(true);
    });

    it("mặc định gán các template chưa rõ hoặc lạ thành transactional để bảo vệ vận hành", () => {
      expect(CustomerNotificationPreferencesPolicy.categorize("unknown.custom_alert")).toBe("transactional");
    });
  });

  describe("Thẩm định quyền gửi (evaluateDispatch)", () => {
    it("LUÔN cho phép gửi Transactional ngay cả khi khách hàng yêu cầu tắt toàn bộ", () => {
      const decision = CustomerNotificationPreferencesPolicy.evaluateDispatch(
        "booking.return_reminder",
        {
          emailEnabled: false,
          inAppEnabled: false,
          promotionalOptOut: true,
        },
      );

      expect(decision.canSendEmail).toBe(true);
      expect(decision.canSendInApp).toBe(true);
      expect(decision.isMandatory).toBe(true);
      expect(decision.category).toBe("transactional");
      expect(decision.reason).toContain("bắt buộc");
    });

    it("cho phép gửi Promotional khi khách hàng chưa opt-out", () => {
      const decision = CustomerNotificationPreferencesPolicy.evaluateDispatch(
        "booking.thank_you_voucher",
        {
          emailEnabled: true,
          inAppEnabled: true,
          promotionalOptOut: false,
        },
      );

      expect(decision.canSendEmail).toBe(true);
      expect(decision.canSendInApp).toBe(true);
      expect(decision.isMandatory).toBe(false);
      expect(decision.category).toBe("promotional");
    });

    it("chặn gửi Promotional khi khách hàng đã opt-out", () => {
      const decision = CustomerNotificationPreferencesPolicy.evaluateDispatch(
        "booking.thank_you_voucher",
        {
          promotionalOptOut: true,
        },
      );

      expect(decision.canSendEmail).toBe(false);
      expect(decision.canSendInApp).toBe(false);
      expect(decision.isMandatory).toBe(false);
      expect(decision.category).toBe("promotional");
      expect(decision.reason).toContain("từ chối");
    });

    it("chặn kênh email nếu khách chỉ tắt email cho thông báo promotional", () => {
      const decision = CustomerNotificationPreferencesPolicy.evaluateDispatch(
        "booking.review_invite",
        {
          emailEnabled: false,
          inAppEnabled: true,
          promotionalOptOut: false,
        },
      );

      expect(decision.canSendEmail).toBe(false);
      expect(decision.canSendInApp).toBe(true);
    });
  });

  describe("Tóm tắt chính sách & báo cáo tình trạng (getPolicySummary)", () => {
    it("trả về thông tin trạng thái PARTIAL_BLOCKED_PENDING_SCHEMA_MIGRATION", () => {
      const summary = CustomerNotificationPreferencesPolicy.getPolicySummary();

      expect(summary.status).toBe("PARTIAL_BLOCKED_PENDING_SCHEMA_MIGRATION");
      expect(summary.transactionalTemplates).toEqual(expect.arrayContaining([...TRANSACTIONAL_TEMPLATES]));
      expect(summary.promotionalTemplates).toEqual(expect.arrayContaining([...PROMOTIONAL_TEMPLATES]));
      expect(summary.rules.transactionalMandatory).toBe(true);
    });
  });
});

