import { Injectable, Logger } from "@nestjs/common";
import { classifyMessage } from "./message-classifier";
import type { ClassifierResult } from "./classification.types";
import type { AssistantRouteInput, AssistantRouteOutput } from "./assistant.types";
import { FaqService } from "./faq.service";
import { DbHandlersService } from "./db-handlers.service";
import { HandoffService } from "./handoff.service";
import { RepeatGuardService } from "./repeat-guard.service";
import type { RepeatGuardResult } from "./repeat-guard.service";
import { isBankAccountAutoReplyEnabled } from "./assistant-config";
import { IdempotencyService } from "./idempotency.service";
import { AssistantMetricsService } from "./assistant-metrics.service";
import { AssistantContextService } from "./assistant-context.service";
import { handoffAckForReason } from "./handoff-messages";

const TEMPLATE_REPLIES: Record<string, string> = {
  greeting: "Dạ em chào anh/chị ạ. Anh/chị cần em hỗ trợ gì không ạ?",
  thanks: "Dạ em cảm ơn anh/chị ạ.",
  contextual_reask:
    "Dạ anh/chị cho em biết rõ hơn mẫu, size hoặc màu mong muốn để em hỗ trợ đúng ạ.",
  decline: "Dạ em cảm ơn anh/chị. Khi cần hỗ trợ thêm, anh/chị nhắn shop bất cứ lúc nào ạ.",
};

const ASK_PRODUCT =
  "Dạ anh/chị cho em biết mẫu hoặc màu cụ thể đang quan tâm để em kiểm tra giúp ạ.";
const ASK_ORDER =
  "Dạ anh/chị cho em biết đơn đang cần kiểm tra (hoặc mở đúng hội thoại của đơn) để em xem giúp ạ.";

type NonStaffOutcome =
  | { kind: "reply"; reply: string; handler: string; productIds?: string[]; askAgain?: boolean }
  | { kind: "none"; handler: string }
  | {
      kind: "handoff";
      reason: string;
      sensitive: boolean;
      handler: string;
      missingFaqKey?: string;
    };

/**
 * Router dùng chung cho Auto-Reply và Staff AI Suggestion.
 *
 * Thứ tự: STAFF > FAQ > DB > AI (SKIP/UNKNOWN không trả lời, TEMPLATE trả
 * câu ngắn). Chỉ route AI mới trả `action: "llm"`; mọi route khác đều xử lý
 * bằng rule/DB/FAQ và không gọi model.
 */
@Injectable()
export class AssistantRouterService {
  private readonly logger = new Logger(AssistantRouterService.name);

  constructor(
    private readonly faqService: FaqService,
    private readonly dbHandlers: DbHandlersService,
    private readonly handoffService: HandoffService,
    private readonly repeatGuard: RepeatGuardService,
    private readonly idempotency: IdempotencyService,
    private readonly metrics: AssistantMetricsService,
    private readonly contextService: AssistantContextService,
  ) {}

  /** Dựng ngữ cảnh từ DB rồi route. Dùng cho auto-reply ở phase 4. */
  async routeConversation(
    input: Omit<AssistantRouteInput, "context">,
  ): Promise<AssistantRouteOutput> {
    const built = await this.contextService.build(
      input.conversationId,
      input.customerId,
      input.messageId,
    );
    return this.route({
      ...input,
      context: built.context,
      lastStaffMessageAt: input.lastStaffMessageAt ?? built.lastStaffMessageAt,
    });
  }

  /**
   * Staff vừa trả lời: đóng handoff nhẹ và reset bộ đếm chống lặp để lượt
   * auto-reply kế tiếp bắt đầu lại từ đầu.
   */
  async handleStaffReply(conversationId: string): Promise<void> {
    await this.handoffService.reset(conversationId);
    try {
      await this.repeatGuard.reset(conversationId);
    } catch (error) {
      this.logger.warn(
        `Could not reset repeat guard for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async route(input: AssistantRouteInput): Promise<AssistantRouteOutput> {
    const startedAt = Date.now();
    const isSuggestion = input.mode === "suggestion";
    const classification = classifyMessage(input.trigger, input.context);

    if (classification.route === "SKIP") {
      await this.logEvent(
        {
          action: "none",
          route: classification.route,
          intent: classification.intent,
          reason: classification.reason,
          usedLlm: false,
          classification,
        },
        input.conversationId,
        startedAt,
        classification.route.toLowerCase(),
      );
      return {
        action: "none",
        route: classification.route,
        intent: classification.intent,
        reason: classification.reason,
        usedLlm: false,
        classification,
      };
    }

    // Gợi ý thủ công không được "tiêu" messageId của auto-reply.
    if (!isSuggestion) {
      const fresh = await this.idempotency.begin(input.messageId);
      if (!fresh) {
        return {
          action: "none",
          route: classification.route,
          intent: classification.intent,
          reason: "duplicate_message",
          usedLlm: false,
          idempotentSkip: true,
          classification,
        };
      }
    }

    const signature = this.buildSignature(classification);

    // STAFF thắng tuyệt đối: mở handoff, không gọi LLM.
    if (classification.route === "STAFF") {
      if (isSuggestion) {
        const output: AssistantRouteOutput = {
          action: "reply",
          route: "STAFF",
          intent: classification.intent,
          reason: classification.reason,
          reply: handoffAckForReason(classification.reason),
          handoff: {
            reason: classification.reason,
            sensitive: classification.sensitive,
            shouldAck: false,
          },
          usedLlm: false,
          classification,
        };
        await this.logOutput(output, input.conversationId, startedAt);
        return output;
      }

      const outcome = await this.openHandoff(
        input.conversationId,
        classification.reason,
        classification.sensitive,
        input.messageId,
      );
      const output = this.toOutput(outcome, classification);
      await this.logOutput(output, input.conversationId, startedAt);
      return output;
    }

    let outcome: NonStaffOutcome;

    try {
      if (classification.route === "AI") {
        const guard: RepeatGuardResult = isSuggestion
          ? { escalate: false, count: 0, sameCount: 0 }
          : await this.repeatGuard.register(
              input.conversationId,
              signature,
              input.lastStaffMessageAt,
            );
        if (guard.escalate) {
          outcome = {
            kind: "handoff",
            reason: guard.reason ?? "repeat_guard",
            sensitive: false,
            handler: "repeat_guard",
          };
        } else {
          const output: AssistantRouteOutput = {
            action: "llm",
            route: "AI",
            intent: classification.intent,
            reason: classification.reason,
            usedLlm: true,
            llmRequest: classification.aiRequest,
            classification,
          };
          await this.logOutput(output, input.conversationId, startedAt);
          return output;
        }
      } else {
        outcome = await this.dispatchNonStaff(input, classification, isSuggestion);
      }
    } catch (error) {
      this.logger.warn(
        `Assistant route failed for ${input.conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      outcome = {
        kind: "handoff",
        reason: "assistant_error",
        sensitive: false,
        handler: "error",
      };
    }

    // Chỉ nhánh AI mới bị đếm chống lặp (đăng ký ngay trước khi gọi model).
    // FAQ/DB/TEMPLATE là câu trả lời tất định từ dữ liệu shop: trả lặp lại vẫn
    // đúng, không được biến thành handoff rồi im lặng. Handoff chỉ mở khi
    // route thật sự cần người (STAFF) hoặc guard AI đã chạm ngưỡng.
    if (outcome.kind === "handoff") {
      if (isSuggestion) {
        // Không mở handoff khi staff chỉ bấm xem gợi ý.
        const output: AssistantRouteOutput = {
          action: "reply",
          route: "STAFF",
          intent: `staff.${outcome.reason}`,
          reason: outcome.reason,
          reply: handoffAckForReason(outcome.reason),
          handoff: {
            reason: outcome.reason,
            sensitive: outcome.sensitive,
            shouldAck: false,
          },
          ...(outcome.missingFaqKey ? { missingFaqKey: outcome.missingFaqKey } : {}),
          usedLlm: false,
          classification,
        };
        await this.logOutput(output, input.conversationId, startedAt);
        return output;
      }

      const handoff = await this.openHandoff(
        input.conversationId,
        outcome.reason,
        outcome.sensitive,
        input.messageId,
      );
      const output = this.toOutput(
        {
          ...handoff,
          handler: outcome.handler,
          ...(outcome.missingFaqKey ? { missingFaqKey: outcome.missingFaqKey } : {}),
        },
        classification,
      );
      await this.logOutput(output, input.conversationId, startedAt);
      return output;
    }

    const output: AssistantRouteOutput = {
      action: outcome.kind === "reply" ? "reply" : "none",
      route: classification.route,
      intent: classification.intent,
      reason: classification.reason,
      ...(outcome.kind === "reply" ? { reply: outcome.reply } : {}),
      ...(outcome.kind === "reply" && outcome.productIds
        ? { productIds: outcome.productIds }
        : {}),
      ...(outcome.kind === "reply" && outcome.askAgain ? { askAgain: true } : {}),
      ...(classification.templateKey
        ? { templateKey: classification.templateKey }
        : {}),
      usedLlm: false,
      classification,
    };
    await this.logEvent(
      output,
      input.conversationId,
      startedAt,
      outcome.handler,
    );
    return output;
  }

  private async dispatchNonStaff(
    input: AssistantRouteInput,
    classification: ClassifierResult,
    isSuggestion = false,
  ): Promise<NonStaffOutcome> {
    if (classification.route === "TEMPLATE") {
      const key = classification.templateKey ?? "";
      const reply = TEMPLATE_REPLIES[key];
      if (!reply) {
        return { kind: "none", handler: `template:${key || "unknown"}` };
      }
      return {
        kind: "reply",
        reply,
        handler: `template:${key}`,
        ...(key === "contextual_reask" ? { askAgain: true } : {}),
      };
    }

    if (classification.route === "FAQ") {
      const faqKeys =
        classification.faqKeys?.length
          ? classification.faqKeys
          : classification.faqKey
            ? [classification.faqKey]
            : [];
      if (faqKeys.length === 0) {
        return {
          kind: "handoff",
          reason: "faq_config_missing",
          sensitive: false,
          handler: "faq",
          missingFaqKey: "unknown",
        };
      }

      // Thông tin ngân hàng/STK là nhóm nhạy cảm: mặc định luôn chuyển STAFF.
      // Chỉ khi BANK_ACCOUNT_AUTO_REPLY=true mới trả theo cấu hình FAQ.
      if (faqKeys.includes("bank_account") && !isBankAccountAutoReplyEnabled()) {
        return {
          kind: "handoff",
          reason: "bank_account_manual",
          sensitive: false,
          handler: "faq:bank_account",
        };
      }

      const replies: string[] = [];
      for (const faqKey of faqKeys) {
        const rendered = await this.faqService.render(faqKey);
        if (rendered.status === "missing") {
          return {
            kind: "handoff",
            reason: "faq_config_missing",
            sensitive: false,
            handler: `faq:${faqKey}`,
            missingFaqKey: rendered.missingKey,
          };
        }
        replies.push(rendered.reply);
      }

      return {
        kind: "reply",
        reply: replies.join("\n"),
        handler: `faq:${faqKeys.join("+")}`,
      };
    }

    if (classification.route === "DB") {
      const missing = classification.missingParams;

      if (missing.includes("product")) {
        const asked =
          isSuggestion ||
          (await this.repeatGuard.claimAsk(input.conversationId, "product:missing"));
        if (asked) {
          return {
            kind: "reply",
            reply: ASK_PRODUCT,
            handler: "db.ask_product",
            askAgain: true,
          };
        }
        return {
          kind: "handoff",
          reason: "product_lookup_unresolved",
          sensitive: false,
          handler: "db.ask_product",
        };
      }

      if (missing.includes("bookingId")) {
        const asked =
          isSuggestion ||
          (await this.repeatGuard.claimAsk(input.conversationId, "order:missing"));
        if (asked) {
          return {
            kind: "reply",
            reply: ASK_ORDER,
            handler: "db.ask_order",
            askAgain: true,
          };
        }
        return {
          kind: "handoff",
          reason: "order_lookup_unresolved",
          sensitive: false,
          handler: "db.ask_order",
        };
      }

      const result = await this.dbHandlers.handle({
        conversationId: input.conversationId,
        customerId: input.customerId,
        bookingId: input.context.bookingId,
        intent: classification.intent,
        slots: classification.slots,
        content: input.trigger.content,
      });

      if (result.status === "reply") {
        return {
          kind: "reply",
          reply: result.reply,
          handler: classification.intent,
          ...(result.productIds ? { productIds: result.productIds } : {}),
        };
      }

      if (result.status === "ask") {
        const asked =
          isSuggestion ||
          (await this.repeatGuard.claimAsk(input.conversationId, result.askKey));
        if (asked) {
          return {
            kind: "reply",
            reply: result.reply,
            handler: classification.intent,
            askAgain: true,
          };
        }
      }

      if (result.status === "staff") {
        return {
          kind: "handoff",
          reason: result.reason,
          sensitive: false,
          handler: classification.intent,
        };
      }

      return {
        kind: "handoff",
        reason: "product_lookup_unresolved",
        sensitive: false,
        handler: classification.intent,
      };
    }

    // Không nhận diện được: không gọi LLM nhưng tuyệt đối không im lặng.
    // Chuyển nhân viên kèm thông báo để khách biết tin đã được ghi nhận.
    return {
      kind: "handoff",
      reason: "unhandled_message",
      sensitive: false,
      handler: "router.unknown",
    };
  }

  private async openHandoff(
    conversationId: string,
    reason: string,
    sensitive: boolean,
    triggerMessageId?: string | null,
  ): Promise<{
    kind: "handoff";
    reason: string;
    sensitive: boolean;
    reply?: string;
    shouldAck: boolean;
    pendingCount?: number;
  }> {
    const result = triggerMessageId
      ? await this.handoffService.open(conversationId, reason, sensitive, triggerMessageId)
      : await this.handoffService.open(conversationId, reason, sensitive);
    if (result.shouldAck) {
      await this.handoffService.markAckSent(conversationId);
    }

    return {
      kind: "handoff",
      reason,
      sensitive,
      // Luôn gửi thông báo cho khách, kể cả khi handoff đã mở trước đó.
      // `shouldAck` chỉ còn ý nghĩa "đã đánh dấu ack trong DB hay chưa".
      reply: handoffAckForReason(reason),
      shouldAck: result.shouldAck,
      pendingCount: result.pendingCount,
    };
  }

  private toOutput(
    outcome: {
      kind: "handoff";
      reason: string;
      sensitive: boolean;
      reply?: string;
      shouldAck: boolean;
      pendingCount?: number;
      handler?: string;
      missingFaqKey?: string;
    },
    classification: ClassifierResult,
  ): AssistantRouteOutput {
    return {
      action: "handoff",
      route: "STAFF",
      intent: `staff.${outcome.reason}`,
      reason: outcome.reason,
      ...(outcome.reply ? { reply: outcome.reply } : {}),
      handoff: {
        reason: outcome.reason,
        sensitive: outcome.sensitive,
        shouldAck: outcome.shouldAck,
        ...(outcome.pendingCount !== undefined
          ? { pendingCount: outcome.pendingCount }
          : {}),
      },
      ...(outcome.missingFaqKey ? { missingFaqKey: outcome.missingFaqKey } : {}),
      usedLlm: false,
      classification,
    };
  }

  private buildSignature(classification: ClassifierResult): string {
    const slots = classification.slots;
    return JSON.stringify([
      classification.intent,
      slots.productCode ?? "",
      slots.orderCode ?? "",
      slots.quantity ?? "",
      slots.size ?? "",
      slots.color ?? "",
      slots.priceMin ?? "",
      slots.priceMax ?? "",
      slots.dateMentioned ? "date" : "",
      slots.productReference ?? "",
      slots.lastProductCardId ?? "",
    ]);
  }

  private async logOutput(
    output: AssistantRouteOutput,
    conversationId: string,
    startedAt: number,
  ): Promise<void> {

    if (output.reason === "faq_config_missing") {
      const faqKey = output.missingFaqKey
        ? output.missingFaqKey.split(".")[0] ?? "unknown"
        : "unknown";
      await this.metrics.recordMissingFaqConfig(
        conversationId,
        faqKey,
        output.missingFaqKey ?? "unknown",
      );
      return;
    }

    await this.logEvent(output, conversationId, startedAt, undefined);
  }

  private async logEvent(
    output: AssistantRouteOutput,
    conversationId: string,
    startedAt: number,
    handler?: string,
  ): Promise<void> {
    await this.metrics.record({
      conversationId,
      routeType: output.route,
      intent: output.intent,
      reason: output.reason,
      handler: handler ?? output.action,
      llmCalled: output.action === "llm",
      handoffReason: output.handoff?.reason ?? null,
      durationMs: Date.now() - startedAt,
    });
  }
}
