/**
 * Kiểu dữ liệu tin nhắn đầu vào cho auto-reply và router.
 *
 * Controller, service và router dùng chung một định nghĩa trigger.
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
