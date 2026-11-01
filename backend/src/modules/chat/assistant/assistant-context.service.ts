import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import type { ClassifierContext, ProductCardContext } from "./classification.types";
import { isHandoffExpired } from "./assistant-config";

type HistoryRow = {
  id: string;
  sender_id: string;
  sender_type: string | null;
  content: string;
  message_type: string | null;
  metadata: unknown;
  created_at: Date;
};

export type AssistantContextResult = {
  context: ClassifierContext;
  lastStaffMessageAt: Date | null;
  conversationTopic: string | null;
};

function readProductCard(metadata: unknown): ProductCardContext | null {
  if (!metadata || typeof metadata !== "object") return null;
  const product = (metadata as Record<string, unknown>).product;
  if (!product || typeof product !== "object") return null;

  const record = product as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return null;

  const price = record.price;
  return {
    id,
    name: typeof record.name === "string" ? record.name : null,
    size: typeof record.size === "string" ? record.size : null,
    price: typeof price === "number" && Number.isFinite(price) ? price : null,
  };
}

/**
 * Gom ngữ cảnh tối thiểu cho classifier/router từ chính hội thoại:
 * - product card gần nhất,
 * - tin AI/staff ngay trước (để hiểu "dạ/ok/L/đen"),
 * - handoff đang mở,
 * - bookingId gắn hội thoại (không tra đơn bằng mã khách gõ).
 */
@Injectable()
export class AssistantContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    conversationId: string,
    customerId: string,
    currentMessageId?: string | null,
  ): Promise<AssistantContextResult> {
    // Tin được chọn làm mốc (tin khách mới nhất khi auto-reply, hoặc tin khách
    // mà staff chọn trả lời khi xin gợi ý). Ngữ cảnh chỉ lấy các tin TRƯỚC mốc
    // để không trộn nội dung phát sinh sau đó.
    const anchor = currentMessageId
      ? await this.prisma.messages.findUnique({
          where: { id: currentMessageId },
          select: { id: true, created_at: true },
        })
      : null;

    const [conversation, recent] = await Promise.all([
      this.prisma.conversations.findUnique({
        where: { id: conversationId },
        select: {
          booking_id: true,
          topic: true,
          handoff_state: true,
          handoff_reason: true,
          handoff_sensitive: true,
          handoff_opened_at: true,
        },
      }),
      this.prisma.messages.findMany({
        where: {
          conversation_id: conversationId,
          deleted_at: null,
          message_type: { in: ["text", "product_card", "booking_card", "image", "video"] },
          ...(anchor ? { created_at: { lt: anchor.created_at } } : {}),
        },
        orderBy: { created_at: "desc" },
        take: 15,
        select: {
          id: true,
          sender_id: true,
          sender_type: true,
          content: true,
          message_type: true,
          metadata: true,
          created_at: true,
        },
      }),
    ]);

    const history = (recent as HistoryRow[]).filter(
      (message) => !currentMessageId || message.id !== currentMessageId,
    );

    const lastProductCard =
      history
        .filter((message) => message.message_type === "product_card")
        .map((message) => readProductCard(message.metadata))
        .find((product): product is ProductCardContext => Boolean(product)) ?? null;

    const lastAssistant = history.find(
      (message) => message.sender_id !== customerId && message.message_type === "text",
    );
    const lastStaff = history.find(
      (message) => message.sender_id !== customerId && message.sender_type !== "ai",
    );

    const handoffSensitive = Boolean(conversation?.handoff_sensitive);
    const handoffExpired = isHandoffExpired(
      conversation?.handoff_opened_at,
      handoffSensitive,
    );
    const handoffOpen =
      conversation?.handoff_state === "open" && !handoffExpired;

    const context: ClassifierContext = {
      lastProductCard,
      previousAssistantMessage: lastAssistant
        ? {
            content: lastAssistant.content,
            senderType: lastAssistant.sender_type ?? "staff",
          }
        : null,
      conversationTopic: conversation?.topic ?? null,
      handoff: {
        open: handoffOpen,
        reason: handoffOpen ? conversation?.handoff_reason ?? null : null,
        sensitive: handoffOpen ? handoffSensitive : false,
      },
      bookingId: conversation?.booking_id ?? null,
    };

    return {
      context,
      lastStaffMessageAt: lastStaff?.created_at ?? null,
      conversationTopic: conversation?.topic ?? null,
    };
  }
}
