/**
 * Nhãn tiếng Việt cho lý do handoff.
 *
 * Staff không đọc key thô (`unhandled_message`, `bank_account_manual`...).
 * Gom 12 lý do về 3 nhóm màu để nhìn hàng loạt trong danh sách hội thoại là
 * biết mức ưu tiên, còn lý do thật vẫn hiển thị đầy đủ trong tooltip.
 */
export type HandoffGroup = "complaint" | "payment" | "bot";

export type HandoffBadge = {
  /** Nhãn ngắn hiển thị trên badge, đã là tiếng Việt. */
  label: string;
  /** Nhóm quyết định màu badge. */
  group: HandoffGroup;
};

const REASON_BADGES: Record<string, HandoffBadge> = {
  // Khiếu nại: bot phải im, không được tư vấn bán hàng.
  complaint: { label: "Khiếu nại", group: "complaint" },
  booking_card_complaint: { label: "Khiếu nại đơn", group: "complaint" },
  sensitive_followup: { label: "Khiếu nại", group: "complaint" },
  // Tiền / cọc / khách sốt ruột: cần người thật xử lý ngay.
  refund: { label: "Hoàn cọc", group: "payment" },
  payment: { label: "Thanh toán", group: "payment" },
  bank_account_manual: { label: "Chuyển khoản", group: "payment" },
  price_negotiation: { label: "Thương lượng giá", group: "payment" },
  staff_request: { label: "Khách gọi nhân viên", group: "payment" },
  // Còn lại: bot không tự xử lý được, staff đọc để biết.
  unhandled_message: { label: "Bot chuyển", group: "bot" },
  assistant_error: { label: "Bot lỗi", group: "bot" },
  repeat_guard: { label: "Hỏi lặp", group: "bot" },
  faq_config_missing: { label: "Thiếu cấu hình FAQ", group: "bot" },
  product_lookup_unresolved: { label: "Cần kiểm tra sản phẩm", group: "bot" },
  catalog_empty: { label: "Cần kiểm tra sản phẩm", group: "bot" },
  availability_unverified: { label: "Cần kiểm tra lịch", group: "bot" },
  order_change: { label: "Cần xử lý đơn", group: "bot" },
  order_lookup_unresolved: { label: "Cần xử lý đơn", group: "bot" },
  order_lookup_denied: { label: "Cần xử lý đơn", group: "bot" },
  order_delivery_support: { label: "Cần xử lý đơn", group: "bot" },
  booking_card_support: { label: "Cần xử lý đơn", group: "bot" },
  urgent_rental: { label: "Cần xử lý đơn", group: "bot" },
  media_received: { label: "Khách gửi ảnh/video", group: "bot" },
  bulk_order: { label: "Đơn số lượng lớn", group: "bot" },
};

const DEFAULT_BADGE: HandoffBadge = { label: "Bot chuyển", group: "bot" };

export function handoffBadgeForReason(reason: string | null | undefined): HandoffBadge {
  if (!reason) return DEFAULT_BADGE;
  return REASON_BADGES[reason] ?? DEFAULT_BADGE;
}