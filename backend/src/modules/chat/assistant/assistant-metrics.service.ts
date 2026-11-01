import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import type { AssistantEventRecord } from "./assistant.types";

const DEFAULT_RETENTION_DAYS = 90;

export function getChatEventsRetentionDays(): number {
  const configured = Number(process.env.CHAT_EVENTS_RETENTION_DAYS);
  if (Number.isFinite(configured) && configured >= 1) return Math.floor(configured);
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Log/metrics nhẹ cho router. Không ghi nội dung tin nhắn.
 */
@Injectable()
export class AssistantMetricsService {
  private readonly logger = new Logger(AssistantMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: AssistantEventRecord): Promise<void> {
    try {
      await this.prisma.chatAssistantEvent.create({
        data: {
          conversationId: event.conversationId ?? null,
          routeType: event.routeType,
          intent: event.intent ?? null,
          reason: event.reason ?? null,
          handler: event.handler ?? null,
          llmCalled: event.llmCalled ?? false,
          handoffReason: event.handoffReason ?? null,
          tokenInput: event.tokenInput ?? null,
          tokenOutput: event.tokenOutput ?? null,
          durationMs: event.durationMs ?? null,
        },
      });
    } catch (error) {
      // Metrics không được làm hỏng luồng chat.
      this.logger.warn(
        `Could not write chat_assistant_events: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async recordMissingFaqConfig(
    conversationId: string,
    faqKey: string,
    missingKey: string,
  ): Promise<void> {
    this.logger.warn(
      `faq_config_missing conversation=${conversationId} faq=${faqKey} missing=${missingKey}`,
    );
    await this.record({
      conversationId,
      routeType: "STAFF",
      intent: `faq.${faqKey}`,
      reason: "faq_config_missing",
      handler: `faq:${faqKey}`,
      llmCalled: false,
      handoffReason: "faq_config_missing",
    });
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const days = getChatEventsRetentionDays();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      const result = await this.prisma.chatAssistantEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return result.count;
    } catch (error) {
      this.logger.warn(
        `Could not clean chat_assistant_events: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }
}
