import type {
  ClassifierContext,
  ClassifierResult,
  ClassifierSlots,
  ClassifierTrigger,
  RouteType,
} from "./classification.types";

/**
 * Đầu vào/ra của router dùng chung cho Auto-Reply và Staff AI Suggestion.
 *
 * Router KHÔNG tự gọi LLM: nhánh AI trả `action: "llm"` kèm `llmRequest` để
 * caller quyết định gọi model (kèm timeout/lock riêng). Mọi nhánh còn lại
 * đều trả câu trả lời cố định hoặc handoff.
 */

export type AssistantRouteInput = {
  conversationId: string;
  customerId: string;
  messageId?: string;
  trigger: ClassifierTrigger;
  context: ClassifierContext;
  /** Thời điểm tin staff gần nhất, dùng để reset bộ đếm lặp. */
  lastStaffMessageAt?: Date | string | null;
  /**
   * `auto` (mặc định): auto-reply, có idempotency + repeat guard + mở handoff.
   * `suggestion`: staff bấm gợi ý thủ công. Chỉ đọc/route, KHÔNG tiêu
   * idempotency, KHÔNG đếm repeat guard và KHÔNG tự mở handoff.
   */
  mode?: "auto" | "suggestion";
};

export type AssistantHandoff = {
  reason: string;
  sensitive: boolean;
  /** Router vừa mở handoff và nên gửi đúng một câu tiếp nhận. */
  shouldAck: boolean;
  pendingCount?: number;
};

export type AssistantRouteOutput = {
  action: "reply" | "handoff" | "none" | "llm";
  route: RouteType;
  intent: string;
  reason: string;
  reply?: string;
  productIds?: string[];
  handoff?: AssistantHandoff;
  templateKey?: string;
  /** Câu hỏi lại đã dùng hết một lần hay chưa. */
  askAgain?: boolean;
  llmRequest?: string;
  /**
   * Intent AI gốc (`ai.sizing`, `ai.comparison`, ...). Caller dùng để chọn
   * cách tra cứu/prompt phù hợp thay vì coi mọi câu AI là "tìm sản phẩm".
   */
  llmIntent?: string;
  usedLlm: boolean;
  /** Tin đã được xử lý trước đó (idempotency). */
  idempotentSkip?: boolean;
  /** Key FAQ thiếu cấu hình (nếu có) để caller log/thống kê. */
  missingFaqKey?: string;
  classification: ClassifierResult;
};

export type AssistantEventRecord = {
  conversationId?: string | null;
  routeType: RouteType;
  intent?: string | null;
  reason?: string | null;
  handler?: string | null;
  llmCalled?: boolean;
  handoffReason?: string | null;
  tokenInput?: number | null;
  tokenOutput?: number | null;
  durationMs?: number | null;
};

export type DbHandlerInput = {
  conversationId?: string;
  customerId: string;
  bookingId?: string | null;
  intent: string;
  slots: ClassifierSlots;
  content: string;
};

export type DbHandlerResult =
  | { status: "reply"; reply: string; productIds?: string[] }
  | { status: "ask"; reply: string; askKey: string }
  | { status: "staff"; reason: string }
  | { status: "not_found" };
