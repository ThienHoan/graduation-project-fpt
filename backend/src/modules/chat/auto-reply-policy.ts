/**
 * Quyết định cách trả lời tự động cho một tin nhắn của khách.
 *
 * Tách khỏi ChatService để:
 * - Có một nơi duy nhất mô tả chính sách booking/complaint/media/product card.
 * - Test được toàn bộ quyết định mà không cần DB hay gọi model.
 *
 * Ba kết quả:
 * - skip: không trả lời (tin rỗng, emoji, câu xác nhận ngắn).
 * - canned: trả lời cố định, KHÔNG gọi model (card đơn hàng, khiếu nại, media).
 * - ai: gửi yêu cầu đã chuẩn hoá cho AI tư vấn sản phẩm.
 */

export type AutoReplyMessageType =
  | "text"
  | "product_card"
  | "booking_card"
  | "image"
  | "video"
  | (string & {});

export type AutoReplyTrigger = {
  content: string;
  messageType?: AutoReplyMessageType | null;
  metadata?: Record<string, unknown> | null;
  /** Id tin nhắn đang được trả lời (để loại khỏi history, tránh lặp context). */
  messageId?: string;
};

export type AutoReplyPlan =
  | { kind: "skip"; reason: string }
  | { kind: "canned"; reason: string; reply: string }
  | { kind: "ai"; request: string };

/** Câu xác nhận ngắn, không cần AI trả lời (tránh spam "Dạ em cảm ơn" mỗi tin). */
const ACK_ONLY =
  /^(ok|oke|okie|okey|okela|ok la|vâng|vâng ạ|dạ|dạ vâng|dạ vâng ạ|ừ|ừm|um|uhm|được|được ạ|rồi|rồi ạ|hiểu rồi|hiểu ạ)( (shop|bạn|ad|admin|nhé|ạ|nhiều|rất nhiều))*$/;

const HANDOFF_TOPICS = new Set(["booking_support", "complaint"]);

const ORDER_HANDOFF_REPLY =
  "Em đã ghi nhận vấn đề về đơn hàng/lịch hẹn. Nhân viên sẽ kiểm tra và phản hồi bạn trong ít phút ạ. Bạn để lại mã đơn (nếu có) giúp em xử lý nhanh hơn nhé.";
const COMPLAINT_HANDOFF_REPLY =
  "Em xin lỗi vì trải nghiệm chưa tốt. Em đã chuyển nội dung cho nhân viên phụ trách, nhân viên sẽ kiểm tra và liên hệ bạn trong ít phút ạ.";
const STORE_POLICY_HANDOFF_REPLY =
  "Vấn đề này cần nhân viên hỗ trợ trực tiếp. Em đã ghi nhận và chuyển cho nhân viên, bạn vui lòng đợi trong ít phút ạ.";

/**
 * Chủ đề bắt buộc chuyển staff. Dùng word-boundary thay vì contains trần
 * để "hủy" không khớp bừa trong các từ khác và ngược lại.
 *
 * "hủy"/"huỷ" chỉ được coi là yêu cầu hủy khi đi kèm đơn/lịch/booking,
 * hoặc đứng một mình — tránh việc tên "Huy" trong câu bị hiểu nhầm.
 * Khiếu nại được kiểm tra trước để câu "hủy đơn vì áo rách" nhận đúng
 * phản hồi xin lỗi thay vì phản hồi đơn hàng chung.
 */
const HANDOFF_RULES: Array<{ reason: string; patterns: RegExp[]; reply: string }> = [
  {
    reason: "complaint",
    patterns: [
      /(?:^|(?<=\s))(khiếu nại|phàn nàn|bồi thường|hư hỏng|hư đồ|rách|bẩn|mất đồ|thiếu đồ|sai hàng|giao trễ|trễ hạn|quá hạn|không hài lòng|dịch vụ kém|thái độ)(?=\s|$|[.,;:!?])/i,
    ],
    reply: COMPLAINT_HANDOFF_REPLY,
  },
  {
    reason: "order_support",
    patterns: [
      /(?:^|(?<=\s))(đơn hàng|đơn của|mã đơn|kiểm tra đơn|booking|cuộc hẹn|lịch hẹn|đặt lịch|đổi lịch|dời lịch|hoàn tiền|hoàn cọc|trả cọc|giao dịch)(?=\s|$|[.,;:!?])/i,
      /h[uủ][yỷ]\s+(đơn|lịch|booking|hợp đồng|dịch vụ|luôn|giúp|nhé|rồi|đi|với)/i,
      /(?:muốn|cần|phải|xin)\s+h[uủ][yỷ]/i,
      /^h[uủ][yỷ]$/i,
    ],
    reply: ORDER_HANDOFF_REPLY,
  },
  {
    reason: "store_policy",
    patterns: [
      /(?:^|(?<=\s))(giờ mở cửa|mấy giờ|ở đâu|địa chỉ|giao hàng|vận chuyển|thanh toán|chuyển khoản|đổi trả|bảo hành|chính sách)(?=\s|$|[.,;:!?])/i,
    ],
    reply: STORE_POLICY_HANDOFF_REPLY,
  },
];

export function normalizeTrigger(trigger: AutoReplyTrigger | string): AutoReplyTrigger {
  if (typeof trigger === "string") {
    return { content: trigger, messageType: "text" };
  }
  return {
    ...trigger,
    content: trigger.content ?? "",
    messageType: trigger.messageType ?? "text",
  };
}

function normalizeText(text: string): string {
  return (text ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[.!?,;:~…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasMeaningfulText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function readString(source: Record<string, unknown> | null | undefined, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(source: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = source?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function planProductCard(metadata: Record<string, unknown> | null | undefined): AutoReplyPlan {
  const product = (metadata?.product ?? null) as Record<string, unknown> | null;
  const name = readString(product, "name");
  if (!name) {
    return { kind: "ai", request: "Tôi muốn được tư vấn về sản phẩm vừa gửi." };
  }

  const size = readString(product, "size");
  const price = readNumber(product, "price");
  const details = [
    size ? `size ${size}` : "",
    price && price > 0 ? `giá ${price.toLocaleString("vi-VN")}đ/ngày` : "",
  ].filter(Boolean);

  return {
    kind: "ai",
    request: `Tôi đang quan tâm sản phẩm "${name}"${details.length > 0 ? ` (${details.join(", ")})` : ""}. Tư vấn giúp tôi sản phẩm này và các mẫu tương tự.`,
  };
}

function planBookingCard(metadata: Record<string, unknown> | null | undefined): AutoReplyPlan {
  const topic = readString(metadata, "topic");
  const booking = (metadata?.booking ?? null) as Record<string, unknown> | null;
  const code = readString(booking, "code");
  const status = readString(booking, "statusLabel");
  const orderRef = code ? ` đơn ${code}` : " đơn hàng";
  const statusNote = status ? ` (${status})` : "";

  if (topic === "complaint") {
    return {
      kind: "canned",
      reason: "complaint_handoff",
      reply: `Em rất xin lỗi vì trải nghiệm chưa tốt${orderRef}${statusNote}. Em đã chuyển thông tin cho nhân viên phụ trách, nhân viên sẽ kiểm tra và liên hệ bạn trong ít phút ạ.`,
    };
  }

  return {
    kind: "canned",
    reason: "booking_handoff",
    reply: `Em đã ghi nhận yêu cầu hỗ trợ${orderRef}${statusNote}. Nhân viên sẽ kiểm tra và phản hồi bạn trong ít phút ạ.`,
  };
}

function planMedia(trigger: AutoReplyTrigger, conversationTopic?: string | null): AutoReplyPlan {
  const kindLabel = trigger.messageType === "video" ? "video" : "hình ảnh";

  if (conversationTopic && HANDOFF_TOPICS.has(conversationTopic)) {
    return {
      kind: "canned",
      reason: "media_handoff",
      reply: `Em đã nhận được ${kindLabel} bạn gửi kèm vấn đề cần hỗ trợ. Nhân viên sẽ xem và phản hồi bạn sớm nhất ạ.`,
    };
  }

  return {
    kind: "canned",
    reason: "media_ack",
    reply: `Em đã nhận được ${kindLabel} bạn gửi. Bạn mô tả giúp em bạn đang tìm mẫu trang phục nào (loại, màu, size) hoặc vấn đề cần kiểm tra để em hỗ trợ chính xác hơn nhé.`,
  };
}

export function planAutoReply(
  input: AutoReplyTrigger | string,
  conversationTopic?: string | null,
): AutoReplyPlan {
  const trigger = normalizeTrigger(input);
  const messageType = trigger.messageType ?? "text";

  if (messageType === "product_card") {
    return planProductCard(trigger.metadata);
  }

  if (messageType === "booking_card") {
    return planBookingCard(trigger.metadata);
  }

  if (messageType === "image" || messageType === "video") {
    return planMedia(trigger, conversationTopic);
  }

  if (messageType !== "text") {
    return { kind: "skip", reason: "unsupported_message_type" };
  }

  const text = normalizeText(trigger.content);
  if (!text || !hasMeaningfulText(text)) {
    return { kind: "skip", reason: "no_content" };
  }

  if (ACK_ONLY.test(text)) {
    return { kind: "skip", reason: "acknowledgement" };
  }

  const handoff = HANDOFF_RULES.find(({ patterns }) => patterns.some((pattern) => pattern.test(text)));
  if (handoff) {
    return { kind: "canned", reason: handoff.reason, reply: handoff.reply };
  }

  return { kind: "ai", request: trigger.content.trim() };
}
