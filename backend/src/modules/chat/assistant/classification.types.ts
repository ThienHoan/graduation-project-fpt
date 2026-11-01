/**
 * Kiểu dữ liệu cho bộ phân loại tin nhắn chat CSKH.
 *
 * Thứ tự ưu tiên nghiệp vụ: STAFF > FAQ > DB > AI.
 * SKIP dành cho tin không cần phản hồi; UNKNOWN không bao giờ tự gọi LLM.
 * TEMPLATE là câu trả lời ngắn cố định (chào/hỏi lại), không gọi LLM.
 */

export type RouteType =
  | "STAFF"
  | "FAQ"
  | "DB"
  | "AI"
  | "SKIP"
  | "UNKNOWN"
  | "TEMPLATE";

export type ClassifierTrigger = {
  content: string;
  messageType?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Id tin nhắn đang được xử lý (idempotency/cache dùng ở router). */
  messageId?: string;
};

export type ProductCardContext = {
  id: string;
  name?: string | null;
  size?: string | null;
  price?: number | null;
};

export type HandoffContext = {
  open: boolean;
  reason?: string | null;
  sensitive?: boolean | null;
};

export type ClassifierContext = {
  /** Tin AI/staff ngay trước, dùng để nhận biết "ok/dạ" là câu trả lời. */
  previousAssistantMessage?: {
    content?: string | null;
    senderType?: string | null;
  } | null;
  /** Product card gần nhất trong hội thoại (nếu có). */
  lastProductCard?: ProductCardContext | null;
  conversationTopic?: string | null;
  handoff?: HandoffContext | null;
  /** bookingId gắn với hội thoại; tra đơn chỉ dùng giá trị này. */
  bookingId?: string | null;
};

export type ClassifierSlots = {
  productCode?: string;
  orderCode?: string;
  quantity?: number;
  size?: string;
  color?: string;
  dateMentioned?: boolean;
  orderId?: string;
  /** Giá thuê tối thiểu (VND/ngày) khi khách lọc theo khoảng giá. */
  priceMin?: number;
  /** Giá thuê tối đa (VND/ngày). */
  priceMax?: number;
  /** Nguồn tham chiếu sản phẩm đã nhận diện được. */
  productReference?: "last_card" | "demonstrative" | "named";
  lastProductCardId?: string;
  /** Danh mục khách chọn sau khi shop liệt kê danh mục. */
  categoryName?: string;
};

export type ClassifierResult = {
  route: RouteType;
  intent: string;
  reason: string;
  matchedRule: string;
  slots: ClassifierSlots;
  missingParams: string[];
  handoffReason?: string;
  sensitive: boolean;
  /** DB cần context sản phẩm (product card / tên / màu) mới trả lời được. */
  requiresProductContext: boolean;
  /** Key FAQ gợi ý; router sẽ kiểm tra cấu hình thật. */
  faqKey?: string;
  /** Nhiều chủ đề FAQ trong cùng một câu (ví dụ thời gian thuê + phí ship). */
  faqKeys?: string[];
  /** Key template ngắn cho route TEMPLATE (greeting/thanks/contextual_reask). */
  templateKey?: string;
  /** Nội dung gốc gửi cho LLM ở nhánh AI. */
  aiRequest?: string;
};
