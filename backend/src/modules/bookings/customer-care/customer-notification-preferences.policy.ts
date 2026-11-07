/**
 * WORKSTREAM D: Chính Sách Phân Loại và Thẩm Định Notification Preferences Khách Hàng.
 *
 * TÌNH TRẠNG KỸ THUẬT: PARTIAL / BLOCKED
 * Lý do: `schema.prisma` hiện chưa có bảng `customer_notification_preferences` hoặc cột
 * `notification_preferences` trên bảng `UserAccount`.
 * Theo quy định bảo vệ mã nguồn dự án: Tuyệt đối không tự ý chạy migration hoặc chỉnh sửa
 * Prisma schema mà chưa có chỉ đạo từ Tech Lead/DBA.
 * Ngoài ra, việc dùng bảng toàn cục `system_settings` lưu key `notification:preferences:${userId}`
 * là vi phạm nguyên tắc thiết kế database cho multi-customer scale.
 *
 * Vì vậy, Policy này đóng vai trò Pure Domain Logic chuẩn mực, sẵn sàng áp dụng ngay khi
 * migration cơ sở dữ liệu được phê duyệt.
 */

export type NotificationCategory = "transactional" | "promotional";

export interface CustomerNotificationPreferences {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  promotionalOptOut?: boolean;
}

export interface NotificationDispatchDecision {
  canSendEmail: boolean;
  canSendInApp: boolean;
  category: NotificationCategory;
  isMandatory: boolean;
  reason: string;
}

export const TRANSACTIONAL_TEMPLATES = [
  "booking.pickup_reminder",
  "booking.return_reminder",
  "booking.created",
  "booking.status_changed",
  "booking.payment_received",
  "booking.cancelled",
  "booking.extension_applied",
  "booking.extension_expired",
  "booking.overdue",
  "booking.asset_issue",
  "auth.password_reset",
  "auth.email_verification",
] as const;

export const PROMOTIONAL_TEMPLATES = [
  "booking.review_invite",
  "booking.thank_you_voucher",
  "marketing.seasonal_campaign",
  "marketing.discount_voucher",
  "marketing.newsletter",
] as const;

export class CustomerNotificationPreferencesPolicy {
  /**
   * Kiểm tra template có thuộc nhóm Thông Báo Vận Hành Bắt Buộc (Transactional) hay không.
   * Các thông báo liên quan đến nghĩa vụ giao nhận trang phục, thời hạn hoàn trả,
   * quá hạn, thanh toán và bảo mật tài khoản KHÔNG CHO PHÉP khách hàng tắt.
   */
  static isTransactional(templateKey: string): boolean {
    return (TRANSACTIONAL_TEMPLATES as readonly string[]).includes(templateKey);
  }

  /**
   * Kiểm tra template có thuộc nhóm Tiếp Thị / Khuyến Mãi / Khảo Sát (Promotional) hay không.
   * Nhóm này khách hàng có quyền tùy chọn từ chối (Opt-Out).
   */
  static isPromotional(templateKey: string): boolean {
    return (PROMOTIONAL_TEMPLATES as readonly string[]).includes(templateKey);
  }

  /**
   * Phân loại danh mục của thông báo.
   */
  static categorize(templateKey: string): NotificationCategory {
    if (this.isPromotional(templateKey)) {
      return "promotional";
    }
    // Mọi thông báo vận hành hoặc không rõ ràng đều mặc định là Transactional để đảm bảo an toàn đơn hàng
    return "transactional";
  }

  /**
   * Thẩm định quyền phân phối (Dispatch Decision):
   * 1. Đối với Transactional: BẮT BUỘC gửi qua mọi kênh khả dụng, không cho phép Opt-out.
   * 2. Đối với Promotional: Tuân thủ tùy chọn của khách hàng (chặn gửi nếu khách đã Opt-Out).
   */
  static evaluateDispatch(
    templateKey: string,
    preferences?: CustomerNotificationPreferences | null,
  ): NotificationDispatchDecision {
    const category = this.categorize(templateKey);

    if (category === "transactional") {
      return {
        canSendEmail: true,
        canSendInApp: true,
        category: "transactional",
        isMandatory: true,
        reason:
          "Thông báo vận hành/nghiệp vụ bắt buộc liên quan đến quyền lợi, tài chính hoặc nghĩa vụ hoàn trả cổ phục.",
      };
    }

    // Promotional evaluation
    const isOptedOut = Boolean(preferences?.promotionalOptOut);
    const emailAllowed = preferences?.emailEnabled !== false && !isOptedOut;
    const inAppAllowed = preferences?.inAppEnabled !== false && !isOptedOut;

    return {
      canSendEmail: emailAllowed,
      canSendInApp: inAppAllowed,
      category: "promotional",
      isMandatory: false,
      reason: isOptedOut
        ? "Khách hàng đã từ chối nhận thông tin khuyến mãi/tiếp thị (Opt-out)."
        : "Thông báo tiếp thị/chăm sóc khách hàng hợp lệ theo tùy chọn của khách.",
    };
  }

  /**
   * Báo cáo cấu hình và tình trạng tích hợp cho Manager & System Audit.
   */
  static getPolicySummary() {
    return {
      status: "PARTIAL_BLOCKED_PENDING_SCHEMA_MIGRATION",
      note: "Hệ thống áp dụng Pure Domain Policy để phân định Transactional vs Promotional. Cơ chế lưu trữ tùy chọn cá nhân hóa khách hàng đang tạm hoãn do chưa có bảng chuyên biệt trong schema.prisma.",
      transactionalTemplates: [...TRANSACTIONAL_TEMPLATES],
      promotionalTemplates: [...PROMOTIONAL_TEMPLATES],
      rules: {
        transactionalMandatory: true,
        promotionalOptOutAllowed: true,
        defaultPromotionalAllowed: true,
      },
    };
  }
}

