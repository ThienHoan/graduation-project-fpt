import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { isHandoffExpired } from "./assistant-config";

export type HandoffContextValue = {
  open: boolean;
  reason: string | null;
  sensitive: boolean;
};

export type HandoffOpenResult = {
  opened: boolean;
  shouldAck: boolean;
  pendingCount: number;
};

/**
 * Handoff nhẹ: chỉ để nhắc staff và chống gửi lặp câu tiếp nhận.
 *
 * KHÔNG dùng để chặn FAQ/DB. Staff lock hiện có vẫn là nguồn duy nhất quyết
 * định AI có được chen vào hay không. Vì vậy service này chỉ ghi trạng thái
 * lên conversations, không bao giờ throw ra ngoài luồng trả lời.
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getContext(conversationId: string): Promise<HandoffContextValue> {
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: {
        handoff_state: true,
        handoff_reason: true,
        handoff_sensitive: true,
        handoff_opened_at: true,
      },
    });

    const sensitive = Boolean(conversation?.handoff_sensitive);
    const expired = isHandoffExpired(conversation?.handoff_opened_at, sensitive);

    return {
      open: conversation?.handoff_state === "open" && !expired,
      reason: expired ? null : conversation?.handoff_reason ?? null,
      sensitive: expired ? false : sensitive,
    };
  }

  /** Handoff thường 30 phút; handoff nhạy cảm 1440 phút (cấu hình env). */
  private hasExpired(
    openedAt: Date | null | undefined,
    sensitive: boolean,
    now = new Date(),
  ): boolean {
    return isHandoffExpired(openedAt, sensitive, now);
  }

  /**
   * Mở handoff nếu chưa mở. Nếu đã mở (kể cả lý do khác), chỉ tăng
   * pending_count và giữ nguyên cờ ack để không gửi lặp câu tiếp nhận.
   *
   * `triggerMessageId` là tin khách vừa gây ra lượt chuyển này. Chỉ ghi khi
   * thực sự mở handoff mới để UI đặt divider đúng chỗ; khi handoff đã mở sẵn
   * thì giữ nguyên tin gốc (staff cần thấy điểm bắt đầu, không phải tin lặp).
   */
  async open(
    conversationId: string,
    reason: string,
    sensitive: boolean,
    triggerMessageId?: string | null,
  ): Promise<HandoffOpenResult> {
    try {
      const now = new Date();
      const conversation = await this.prisma.conversations.findUnique({
        where: { id: conversationId },
        select: {
          handoff_state: true,
          handoff_reason: true,
          handoff_sensitive: true,
          handoff_opened_at: true,
          handoff_pending_count: true,
        },
      });

      if (!conversation) {
        return { opened: false, shouldAck: false, pendingCount: 0 };
      }

      if (
        conversation.handoff_state === "open" &&
        !this.hasExpired(
          conversation.handoff_opened_at,
          Boolean(conversation.handoff_sensitive),
          now,
        )
      ) {
        const pendingCount = (conversation.handoff_pending_count ?? 0) + 1;
        await this.prisma.conversations.update({
          where: { id: conversationId },
          data: {
            handoff_pending_count: { increment: 1 },
            handoff_last_customer_msg_at: now,
            handoff_sensitive: Boolean(conversation.handoff_sensitive) || sensitive,
            handoff_reason: conversation.handoff_reason ?? reason,
          },
        });
        return { opened: false, shouldAck: false, pendingCount };
      }

      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: {
          handoff_state: "open",
          handoff_reason: reason,
          handoff_sensitive: sensitive,
          handoff_opened_at: now,
          handoff_last_customer_msg_at: now,
          handoff_ack_sent_at: null,
          handoff_pending_count: 1,
          handoff_trigger_message_id: triggerMessageId ?? null,
        },
      });

      return { opened: true, shouldAck: true, pendingCount: 1 };
    } catch (error) {
      this.logger.warn(
        `Could not open handoff for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { opened: false, shouldAck: false, pendingCount: 0 };
    }
  }

  async markAckSent(conversationId: string): Promise<void> {
    try {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: { handoff_ack_sent_at: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `Could not mark handoff ack for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Staff đã trả lời: reset handoff và bộ đếm lặp của hội thoại. */
  async reset(conversationId: string): Promise<void> {
    try {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: {
          handoff_state: null,
          handoff_reason: null,
          handoff_sensitive: false,
          handoff_opened_at: null,
          handoff_ack_sent_at: null,
          handoff_last_customer_msg_at: null,
          handoff_pending_count: 0,
          handoff_trigger_message_id: null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not reset handoff for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
