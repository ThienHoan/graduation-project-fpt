import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRouterService } from "./assistant-router.service";
import { AssistantContextService } from "./assistant-context.service";
import { FaqService } from "./faq.service";
import { RepeatGuardService } from "./repeat-guard.service";
import { IdempotencyService } from "./idempotency.service";
import type { AssistantRouteInput } from "./assistant.types";

const BANK_ROW = {
  key: "bank_account",
  intent: "faq.bank_account",
  answerTemplate: [
    "Ngân hàng: {{bank_name}}",
    "Số tài khoản: {{account_number}}",
    "Chủ tài khoản: {{account_holder}}",
  ].join("\n"),
  requiredParams: ["bank_name", "account_number", "account_holder"],
  values: {
    bank_name: "Vietcombank",
    account_number: "0123456789",
    account_holder: "NGUYEN VAN A",
  },
  notApplicable: false,
  notApplicableReply: null,
  isActive: true,
};

const FAQ_ROWS: Record<string, Record<string, unknown>> = {
  opening_hours: {
    key: "opening_hours",
    intent: "faq.opening_hours",
    answerTemplate: "Shop mở cửa {{hours}}.",
    requiredParams: ["hours"],
    values: { hours: "8:00 - 21:00 hằng ngày" },
    notApplicable: false,
    notApplicableReply: null,
    isActive: true,
  },
  phone: {
    key: "phone",
    intent: "faq.phone",
    answerTemplate: "Hotline/Zalo shop: {{phone}}.",
    requiredParams: ["phone"],
    values: { phone: "0909 123 456" },
    notApplicable: false,
    notApplicableReply: null,
    isActive: true,
  },
  address: {
    key: "address",
    intent: "faq.address",
    answerTemplate: "Địa chỉ shop: {{address}}.",
    requiredParams: ["address"],
    values: { address: "123 Lê Thánh Tôn, Quận 1" },
    notApplicable: false,
    notApplicableReply: null,
    isActive: true,
  },
};

function input(
  content: string,
  overrides: Partial<AssistantRouteInput> = {},
): AssistantRouteInput {
  return {
    conversationId: "conv-1",
    customerId: "customer-1",
    trigger: { content },
    context: {},
    ...overrides,
  };
}

describe("AssistantRouterService", () => {
  let faqPrisma: any;
  let faqService: FaqService;
  let dbHandlers: any;
  let handoff: any;
  let repeatGuard: RepeatGuardService;
  let idempotency: IdempotencyService;
  let metrics: any;
  let router: AssistantRouterService;
  const previousBankFlag = process.env.BANK_ACCOUNT_AUTO_REPLY;
  const previousTtl = process.env.CHAT_HANDOFF_TTL_MINUTES;
  const previousSensitiveTtl = process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES;

  beforeEach(() => {
    process.env.BANK_ACCOUNT_AUTO_REPLY = "true";
    faqPrisma = {
      faqItem: {
        findUnique: vi.fn(),
      },
    };
    faqService = new FaqService(faqPrisma as never);
    dbHandlers = { handle: vi.fn() };
    handoff = {
      open: vi.fn().mockResolvedValue({ opened: true, shouldAck: true, pendingCount: 1 }),
      markAckSent: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      getContext: vi.fn(),
    };
    repeatGuard = new RepeatGuardService();
    idempotency = new IdempotencyService();
    metrics = {
      record: vi.fn().mockResolvedValue(undefined),
      recordMissingFaqConfig: vi.fn().mockResolvedValue(undefined),
    };
    router = new AssistantRouterService(
      faqService,
      dbHandlers,
      handoff,
      repeatGuard,
      idempotency,
      metrics,
      { build: vi.fn() } as never,
    );
  });

  afterEach(() => {
    if (previousBankFlag === undefined) {
      delete process.env.BANK_ACCOUNT_AUTO_REPLY;
    } else {
      process.env.BANK_ACCOUNT_AUTO_REPLY = previousBankFlag;
    }
    if (previousTtl === undefined) {
      delete process.env.CHAT_HANDOFF_TTL_MINUTES;
    } else {
      process.env.CHAT_HANDOFF_TTL_MINUTES = previousTtl;
    }
    if (previousSensitiveTtl === undefined) {
      delete process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES;
    } else {
      process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES = previousSensitiveTtl;
    }
  });

  it("answers a greeting with a short template and never calls the LLM", async () => {
    const result = await router.route(input("chào shop"));

    expect(result).toMatchObject({
      action: "reply",
      route: "TEMPLATE",
      templateKey: "greeting",
      usedLlm: false,
    });
    expect(result.reply).toContain("chào");
    expect(result.llmRequest).toBeUndefined();
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        routeType: "TEMPLATE",
        reason: "greeting_template",
        llmCalled: false,
      }),
    );
  });

  it("answers standalone thanks without an LLM", async () => {
    const result = await router.route(input("cảm ơn shop nhé"));

    expect(result.action).toBe("reply");
    expect(result.templateKey).toBe("thanks");
    expect(result.usedLlm).toBe(false);
  });

  it("does not call the LLM for thanks that mention 'tư vấn'", async () => {
    const result = await router.route(input("cảm ơn shop đã tư vấn"));

    expect(result).toMatchObject({
      action: "reply",
      route: "TEMPLATE",
      templateKey: "thanks",
      reason: "thanks_template",
      usedLlm: false,
    });
    expect(result.llmRequest).toBeUndefined();
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        routeType: "TEMPLATE",
        reason: "thanks_template",
        llmCalled: false,
      }),
    );
  });

  it("re-asks once for a bare 'dạ' instead of acking or handing off", async () => {
    const result = await router.route(
      input("dạ", {
        context: {
          previousAssistantMessage: {
            content: "Anh/chị muốn size nào ạ?",
            senderType: "ai",
          },
        },
      }),
    );

    expect(result).toMatchObject({
      action: "reply",
      route: "TEMPLATE",
      templateKey: "contextual_reask",
      reason: "contextual_answer_missing_slots",
      usedLlm: false,
    });
    expect(handoff.open).not.toHaveBeenCalled();
    expect(result.handoff).toBeUndefined();
  });

  it("answers bank details exactly from FAQ configuration", async () => {
    faqPrisma.faqItem.findUnique.mockResolvedValue(BANK_ROW);

    const result = await router.route(input("số tài khoản ngân hàng của shop"));

    expect(result.route).toBe("FAQ");
    expect(result.intent).toBe("faq.bank_account");
    expect(result.action).toBe("reply");
    expect(result.usedLlm).toBe(false);
    expect(result.reply).toContain("Vietcombank");
    expect(result.reply).toContain("0123456789");
    expect(result.reply).toContain("NGUYEN VAN A");
    expect(result.handoff).toBeUndefined();
  });

  it("hands off with faq_config_missing when bank configuration is absent", async () => {
    faqPrisma.faqItem.findUnique.mockResolvedValue(null);

    const result = await router.route(input("tên chủ tài khoản là gì"));

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "faq_config_missing",
      missingFaqKey: "bank_account",
      usedLlm: false,
    });
    // Chỉ gửi đúng một câu tiếp nhận chuẩn, không render template rỗng
    // và không bịa thông tin ngân hàng.
    expect(result.reply).toContain("chuyển cho nhân viên");
    expect(result.reply).not.toContain("Ngân hàng");
    expect(result.reply).not.toContain("{{");
    expect(result.llmRequest).toBeUndefined();
    expect(handoff.open).toHaveBeenCalledWith(
      "conv-1",
      "faq_config_missing",
      false,
    );
    expect(metrics.recordMissingFaqConfig).toHaveBeenCalledWith(
      "conv-1",
      "bank_account",
      "bank_account",
    );
  });

  it("answers every FAQ topic in a combined question", async () => {
    faqPrisma.faqItem.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "rental_duration") {
        return Promise.resolve({
          key: "rental_duration",
          intent: "faq.rental_duration",
          answerTemplate: "Thời gian thuê: {{duration}}.",
          requiredParams: ["duration"],
          values: { duration: "3 ngày" },
          notApplicable: false,
          notApplicableReply: null,
          isActive: true,
        });
      }
      if (where.key === "shipping") {
        return Promise.resolve({
          key: "shipping",
          intent: "faq.shipping",
          answerTemplate: "Giao nhận: {{shipping}}.",
          requiredParams: ["shipping"],
          values: { shipping: "ship 30.000đ nội thành" },
          notApplicable: false,
          notApplicableReply: null,
          isActive: true,
        });
      }
      return Promise.resolve(null);
    });

    const result = await router.route(
      input("em có thể thuê bao lâu và giá ship như nào"),
    );

    expect(result).toMatchObject({
      action: "reply",
      route: "FAQ",
      usedLlm: false,
    });
    expect(result.reply).toContain("3 ngày");
    expect(result.reply).toContain("30.000đ nội thành");
    expect(faqPrisma.faqItem.findUnique).toHaveBeenCalledTimes(2);
  });

  it("hands off bank questions when BANK_ACCOUNT_AUTO_REPLY is off", async () => {
    process.env.BANK_ACCOUNT_AUTO_REPLY = "false";
    faqPrisma.faqItem.findUnique.mockResolvedValue(BANK_ROW);

    const result = await router.route(input("số tài khoản ngân hàng của shop"));

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "bank_account_manual",
      usedLlm: false,
    });
    expect(faqPrisma.faqItem.findUnique).not.toHaveBeenCalled();
    expect(handoff.open).toHaveBeenCalledWith(
      "conv-1",
      "bank_account_manual",
      false,
    );
  });

  it("defaults BANK_ACCOUNT_AUTO_REPLY to off", async () => {
    delete process.env.BANK_ACCOUNT_AUTO_REPLY;
    faqPrisma.faqItem.findUnique.mockResolvedValue(BANK_ROW);

    const result = await router.route(input("số tài khoản ngân hàng của shop"));

    expect(result.route).toBe("STAFF");
    expect(result.reason).toBe("bank_account_manual");
    expect(result.usedLlm).toBe(false);
  });

  it("answers a price question from the latest product card without an LLM", async () => {
    dbHandlers.handle.mockResolvedValue({
      status: "reply",
      reply: "Mẫu Áo dài đỏ thêu sen, màu Đỏ có giá thuê 350.000đ/ngày (size M).",
      productIds: ["g-1"],
    });

    const result = await router.route(
      input("bộ này giá bao nhiêu", {
        context: {
          lastProductCard: { id: "g-1", name: "Áo dài đỏ thêu sen", size: "M", price: 350000 },
        },
      }),
    );

    expect(result).toMatchObject({
      action: "reply",
      route: "DB",
      intent: "db.product_price",
      usedLlm: false,
    });
    expect(result.reply).toContain("350.000đ");
    expect(result.llmRequest).toBeUndefined();
    expect(dbHandlers.handle).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "db.product_price" }),
    );
  });

  it("asks for one clarification when the catalog is ambiguous, then hands off", async () => {
    dbHandlers.handle.mockResolvedValue({
      status: "ask",
      askKey: "product:ambiguous:g-1,g-2",
      reply: "Shop có nhiều mẫu phù hợp. Anh/chị muốn xem mẫu nào ạ?",
    });

    const first = await router.route(input("áo dài đỏ còn không"));
    expect(first).toMatchObject({ action: "reply", askAgain: true, route: "DB" });

    const second = await router.route(input("áo dài đỏ còn không"));
    expect(second).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "product_lookup_unresolved",
      usedLlm: false,
    });
  });

  it("asks for a product once when a size question has no product context", async () => {
    const first = await router.route(input("còn size L không"));
    expect(first.action).toBe("reply");
    expect(first.reply).toContain("mẫu hoặc màu");
    expect(dbHandlers.handle).not.toHaveBeenCalled();

    const second = await router.route(input("còn size L không"));
    expect(second).toMatchObject({
      action: "handoff",
      reason: "product_lookup_unresolved",
    });
  });

  it("hands off a typed product code with product_code_unsupported", async () => {
    const result = await router.route(input("Mẫu NB-012 giá bao nhiêu?"));

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "product_code_unsupported",
      usedLlm: false,
    });
    expect(handoff.open).toHaveBeenCalledWith(
      "conv-1",
      "product_code_unsupported",
      false,
    );
  });

  it("answers day-specific availability from the database", async () => {
    dbHandlers.handle.mockResolvedValue({
      status: "reply",
      reply: "Dạ mẫu Áo dài đỏ còn 2 bộ trống ngày 30/10/2026 ạ.",
    });

    const result = await router.route(input("ngày mai còn áo dài đỏ không"));

    expect(result).toMatchObject({
      action: "reply",
      route: "DB",
      intent: "db.product_availability",
      usedLlm: false,
    });
    expect(result.reply).toContain("bộ trống ngày");
    expect(dbHandlers.handle).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "db.product_availability" }),
    );
    expect(metrics.record).toHaveBeenCalled();
  });

  it("escalates to STAFF after three consecutive AI-eligible replies", async () => {
    const first = await router.route(input("tư vấn đồ đi tiệc"));
    expect(first.action).toBe("llm");

    const second = await router.route(input("so sánh mẫu A và B"));
    expect(second.action).toBe("llm");

    const third = await router.route(input("áo dài có nguồn gốc thế nào"));
    expect(third).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "repeat_limit",
      usedLlm: false,
    });
  });

  it("keeps answering deterministic FAQ questions instead of escalating on repeat", async () => {
    faqPrisma.faqItem.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(FAQ_ROWS[where.key] ?? null),
    );

    const opening = await router.route(input("shop mở cửa mấy giờ"));
    const zalo = await router.route(input("zalo của shop là gì"));
    const phone = await router.route(input("số điện thoại liên hệ của shop"));
    const address = await router.route(input("địa chỉ của shop"));

    for (const result of [opening, zalo, phone, address]) {
      expect(result.action).toBe("reply");
      expect(result.usedLlm).toBe(false);
      expect(result.handoff).toBeUndefined();
    }
    expect(zalo.reply).toContain("0909 123 456");
    expect(phone.reply).toContain("0909 123 456");
    expect(address.reply).toContain("123 Lê Thánh Tôn");
    expect(handoff.open).not.toHaveBeenCalled();
  });

  it("still answers FAQ while a handoff is already open", async () => {
    faqPrisma.faqItem.findUnique.mockResolvedValue(FAQ_ROWS.address);

    const result = await router.route(
      input("địa chỉ của shop", {
        context: {
          handoff: { open: true, reason: "repeat_limit", sensitive: false },
        },
      }),
    );

    expect(result).toMatchObject({
      action: "reply",
      route: "FAQ",
      intent: "faq.address",
      usedLlm: false,
    });
    expect(result.reply).toContain("123 Lê Thánh Tôn");
    expect(handoff.open).not.toHaveBeenCalled();
  });

  it("processes the same messageId only once", async () => {
    faqPrisma.faqItem.findUnique.mockResolvedValue(BANK_ROW);

    const first = await router.route(
      input("số tài khoản ngân hàng", { messageId: "msg-1" }),
    );
    expect(first.action).toBe("reply");

    const second = await router.route(
      input("số tài khoản ngân hàng", { messageId: "msg-1" }),
    );
    expect(second).toMatchObject({
      action: "none",
      reason: "duplicate_message",
      idempotentSkip: true,
      usedLlm: false,
    });
  });

  it("never calls the LLM for UNKNOWN messages but still notifies the customer", async () => {
    const result = await router.route(input("thời tiết hôm nay thế nào"));

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "unhandled_message",
      usedLlm: false,
    });
    expect(result.reply).toContain("chuyển cho nhân viên");
    expect(result.llmRequest).toBeUndefined();
    expect(handoff.open).toHaveBeenCalledWith("conv-1", "unhandled_message", false);
  });

  it("still notifies the customer when a handoff is already open", async () => {
    handoff.open.mockResolvedValue({ opened: false, shouldAck: false, pendingCount: 3 });

    const result = await router.route(input("mình muốn gặp nhân viên"));

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      usedLlm: false,
    });
    expect(result.reply).toContain("chuyển cho nhân viên");
    expect(handoff.markAckSent).not.toHaveBeenCalled();
  });

  it("uses an order-specific notice for delivery questions", async () => {
    const result = await router.route(input("đơn này khi nào mới tới nơi"));

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "order_delivery_support",
      usedLlm: false,
    });
    expect(result.reply).toContain("đơn của anh/chị");
  });

  it("keeps sensitive money follow-ups on STAFF while a sensitive handoff is open", async () => {
    process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES = "1440";
    const prisma = {
      conversations: {
        findUnique: vi.fn().mockResolvedValue({
          booking_id: null,
          topic: null,
          handoff_state: "open",
          handoff_reason: "complaint",
          handoff_sensitive: true,
          handoff_opened_at: new Date(Date.now() - 31 * 60_000),
        }),
      },
      messages: {
        findUnique: vi.fn().mockResolvedValue({
          id: "msg-1",
          created_at: new Date("2026-10-30T10:00:00.000Z"),
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const contextService = new AssistantContextService(prisma as never);
    const ttlRouter = new AssistantRouterService(
      faqService,
      dbHandlers,
      handoff,
      repeatGuard,
      idempotency,
      metrics,
      contextService,
    );

    const result = await ttlRouter.routeConversation({
      conversationId: "conv-1",
      customerId: "customer-1",
      messageId: "msg-sensitive-1",
      trigger: {
        content: "đã hoàn cọc chưa shop",
        messageType: "text",
      },
    });

    expect(result).toMatchObject({
      action: "handoff",
      route: "STAFF",
      reason: "sensitive_followup",
      usedLlm: false,
    });
    expect(result.llmRequest).toBeUndefined();
    expect(handoff.open).toHaveBeenCalledWith(
      "conv-1",
      "sensitive_followup",
      true,
      "msg-sensitive-1",
    );
  });

  it("still lets AI give styling advice while a sensitive handoff is open", async () => {
    // Handoff TTL 24h từng chặn mọi câu AI cả ngày; phối đồ không thể tạo cam
    // kết tài chính nên vẫn để AI tư vấn.
    process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES = "1440";
    const prisma = {
      conversations: {
        findUnique: vi.fn().mockResolvedValue({
          booking_id: null,
          topic: null,
          handoff_state: "open",
          handoff_reason: "complaint",
          handoff_sensitive: true,
          handoff_opened_at: new Date(Date.now() - 31 * 60_000),
        }),
      },
      messages: {
        findUnique: vi.fn().mockResolvedValue({
          id: "msg-1",
          created_at: new Date("2026-10-30T10:00:00.000Z"),
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const contextService = new AssistantContextService(prisma as never);
    const ttlRouter = new AssistantRouterService(
      faqService,
      dbHandlers,
      handoff,
      repeatGuard,
      idempotency,
      metrics,
      contextService,
    );

    const result = await ttlRouter.routeConversation({
      conversationId: "conv-1",
      customerId: "customer-1",
      messageId: "msg-styling-1",
      trigger: {
        content: "tư vấn giúp mình đồ đi tiệc",
        messageType: "text",
      },
    });

    expect(result).toMatchObject({
      action: "llm",
      route: "AI",
      intent: "ai.styling",
      usedLlm: true,
    });
    expect(handoff.open).not.toHaveBeenCalled();
  });
});
