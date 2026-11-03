import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_AUTO_REPLY_LOCK_TTL_SECONDS,
  AI_TOTAL_TIMEOUT_MS,
  ChatService,
} from "./chat.service";
import { AssistantRouterService } from "./assistant/assistant-router.service";
import { RepeatGuardService } from "./assistant/repeat-guard.service";
import { IdempotencyService } from "./assistant/idempotency.service";

const CUSTOMER = "customer-1";
const CONV = "11111111-1111-1111-1111-111111111111";
const AI_USER = "00000000-0000-0000-0000-000000000000";
const DEBOUNCE_WAIT_MS = 1800;

const PERSISTED_MESSAGE = {
  id: "ai-msg-1",
  conversation_id: CONV,
  sender_id: AI_USER,
  sender_type: "ai",
  content: "ok",
  message_type: "text",
  created_at: new Date(),
};

type PrismaOptions = {
  staffId?: string | null;
  status?: string;
  latestSender?: string;
  historyMessages?: Array<Record<string, unknown>>;
  fallbackRecent?: boolean;
};

function createPrisma(options: PrismaOptions = {}) {
  return {
    conversations: {
      findUnique: vi.fn().mockResolvedValue({
        id: CONV,
        customer_id: CUSTOMER,
        staff_id: options.staffId ?? null,
        status: options.status ?? "open",
        topic: "general",
        handoff_state: null,
        handoff_reason: null,
        handoff_sensitive: false,
        handoff_pending_count: 0,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    messages: {
      findFirst: vi.fn().mockImplementation((args: any) => {
        if (typeof args?.where?.content === "string") {
          return Promise.resolve(options.fallbackRecent ? { id: "fallback-1" } : null);
        }
        return Promise.resolve({ sender_id: options.latestSender ?? CUSTOMER });
      }),
      findMany: vi.fn().mockImplementation((args: any) => {
        if (args?.where?.id?.in) return Promise.resolve([PERSISTED_MESSAGE]);
        if (args?.where?.message_type?.in) {
          return Promise.resolve(options.historyMessages ?? []);
        }
        return Promise.resolve([]);
      }),
      create: vi.fn().mockResolvedValue({ id: "ai-msg-1" }),
    },
    garment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function createRouter(options: {
  faqReply?: string;
  dbReply?: string;
  context?: Record<string, unknown>;
}) {
  const faqService = {
    render: vi.fn().mockResolvedValue({
      status: "ok",
      key: "address",
      reply: options.faqReply ?? "Địa chỉ shop: 123 Lê Thánh Tôn.",
    }),
  };
  const dbHandlers = {
    handle: vi.fn().mockResolvedValue({
      status: "reply",
      reply: options.dbReply ?? "Mẫu Áo dài đỏ có giá thuê 350.000đ/ngày (size M).",
      productIds: ["g-1"],
    }),
  };
  const handoff = {
    open: vi.fn().mockResolvedValue({ opened: true, shouldAck: true, pendingCount: 1 }),
    markAckSent: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn(),
  };
  const metrics = {
    record: vi.fn().mockResolvedValue(undefined),
    recordMissingFaqConfig: vi.fn().mockResolvedValue(undefined),
  };
  const contextService = {
    build: vi.fn().mockResolvedValue({
      context: options.context ?? {},
      lastStaffMessageAt: null,
      conversationTopic: null,
    }),
  };

  const router = new AssistantRouterService(
    faqService as never,
    dbHandlers as never,
    handoff as never,
    new RepeatGuardService(),
    new IdempotencyService(),
    metrics as never,
    contextService as never,
  );

  return { router, faqService, dbHandlers, handoff, metrics };
}

function createRedis() {
  return {
    setNx: vi.fn().mockResolvedValue(true),
    delIfValue: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

function createAiService() {
  return {
    productAdvisor: vi.fn().mockResolvedValue({
      success: true,
      data: {
        topics: [
          {
            title: "Gợi ý sản phẩm",
            assistantReply: "Em gợi ý mẫu áo dài đỏ ạ.",
            recommendedProductIds: ["g-1"],
            reasons: {},
            products: [],
          },
        ],
      },
    }),
  };
}

async function waitForDebounce() {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_WAIT_MS));
}

describe("ChatService auto-reply (assistant router)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let aiService: ReturnType<typeof createAiService>;
  let redis: ReturnType<typeof createRedis>;
  let parts: ReturnType<typeof createRouter>;
  let service: ChatService;

  function build(
    routerParts: ReturnType<typeof createRouter> = parts,
    prismaClient: ReturnType<typeof createPrisma> = prisma,
  ) {
    service = new ChatService(
      prismaClient as never,
      aiService as never,
      redis as never,
      routerParts.router,
    );
    return service;
  }

  beforeEach(() => {
    prisma = createPrisma();
    aiService = createAiService();
    redis = createRedis();
    parts = createRouter({});
    build();
  });

  async function run(
    content: string,
    messageId?: string,
  ) {
    return (service as any).performAutoReply(CONV, {
      content,
      messageType: "text",
      messageId,
    });
  }

  async function runTrigger(trigger: Record<string, unknown>) {
    return (service as any).performAutoReply(CONV, trigger);
  }

  it("answers address questions from FAQ without calling the model", async () => {
    const result = await run("địa chỉ shop ở đâu");

    expect(parts.faqService.render).toHaveBeenCalledWith("address");
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain("123 Lê Thánh Tôn");
    expect(prisma.messages.create.mock.calls[0][0].data.sender_type).toBe("ai");
  });

  it("keeps answering FAQ while a handoff is already open", async () => {
    parts = createRouter({
      faqReply: "Hotline/Zalo shop: 0909 123 456.",
      context: {
        handoff: { open: true, reason: "repeat_limit", sensitive: false },
      },
    });
    build();

    const result = await run("zalo của shop là gì");

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(parts.handoff.open).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain("0909 123 456");
  });

  it("always sends a notice to the customer when the router hands off", async () => {
    parts.router.routeConversation = vi.fn().mockResolvedValue({
      action: "handoff",
      route: "STAFF",
      intent: "staff.unhandled_message",
      reason: "unhandled_message",
      handoff: { reason: "unhandled_message", sensitive: false, shouldAck: false },
      usedLlm: false,
    } as never);

    const result = await run("thời tiết hôm nay thế nào");

    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain(
      "chuyển cho nhân viên",
    );
  });

  it("answers a price question from the product card instead of the model", async () => {
    parts = createRouter({
      context: {
        lastProductCard: {
          id: "g-1",
          name: "Áo dài đỏ thêu sen",
          size: "M",
          price: 350000,
        },
      },
    });
    build();

    const result = await run("bộ này giá bao nhiêu");

    expect(parts.dbHandlers.handle).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "db.product_price" }),
    );
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain("350.000đ");
  });

  it("answers a greeting with a fixed template and no model call", async () => {
    await run("chào shop");

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain("chào");
    expect(prisma.messages.create.mock.calls[0][0].data.metadata).toMatchObject({
      assistant_route: "TEMPLATE",
      assistant_reason: "greeting_template",
    });
  });

  it("answers thanks with a fixed template and no model call", async () => {
    await run("cảm ơn shop đã tư vấn");

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain("cảm ơn");
    expect(prisma.messages.create.mock.calls[0][0].data.metadata).toMatchObject({
      assistant_route: "TEMPLATE",
      assistant_reason: "thanks_template",
    });
  });

  it("calls the model only for an advice request, with the routed request", async () => {
    const result = await run("tư vấn giúp mình đồ đi tiệc");

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(aiService.productAdvisor.mock.calls[0][0].message).toBe(
      "tư vấn giúp mình đồ đi tiệc",
    );
    expect(aiService.productAdvisor.mock.calls[0][0].intent).toBe("ai.styling");
    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.metadata).toMatchObject({
      assistant_route: "AI",
    });
  });

  it("keeps the auto-reply lock alive longer than the model deadline", async () => {
    expect(AI_AUTO_REPLY_LOCK_TTL_SECONDS * 1000).toBeGreaterThan(AI_TOTAL_TIMEOUT_MS);

    await run("chào shop");

    expect(redis.setNx).toHaveBeenCalledWith(
      `chat:auto-reply:lock:${CONV}`,
      expect.any(String),
      AI_AUTO_REPLY_LOCK_TTL_SECONDS,
    );
  });

  it("skips when another instance already holds the auto-reply lock", async () => {
    redis.setNx.mockResolvedValue(false);

    const result = await run("địa chỉ shop ở đâu");

    expect(result).toEqual([]);
    expect(parts.router).toBeDefined();
    expect(parts.faqService.render).not.toHaveBeenCalled();
    expect(redis.delIfValue).not.toHaveBeenCalled();
  });

  it("releases the distributed lock after replying", async () => {
    await run("địa chỉ shop ở đâu");

    expect(redis.delIfValue).toHaveBeenCalledWith(
      `chat:auto-reply:lock:${CONV}`,
      redis.setNx.mock.calls[0][1],
    );
  });

  it("opens exactly one handoff for a complaint and never calls the model", async () => {
    const result = await run("đồ bị rách, shop xử lý sao");

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(parts.handoff.open).toHaveBeenCalledWith(CONV, "complaint", true);
    expect(parts.handoff.markAckSent).toHaveBeenCalledWith(CONV);
    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain(
      "chuyển cho nhân viên",
    );
  });

  it("hands an image to staff without calling the model", async () => {
    const result = await runTrigger({ content: "", messageType: "image" });

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(parts.handoff.open).toHaveBeenCalledWith(CONV, "media_received", false);
    expect(result).toHaveLength(1);
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain(
      "chuyển cho nhân viên",
    );
  });

  it("hands a complaint booking card to staff without calling the model", async () => {
    await runTrigger({
      content: "",
      messageType: "booking_card",
      metadata: {
        topic: "complaint",
        booking: { code: "BK999999", statusLabel: "Hoàn thành" },
      },
    });

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(parts.handoff.open).toHaveBeenCalledWith(CONV, "booking_card_complaint", true);
  });

  it("reads a product card from DB instead of calling the model", async () => {
    prisma.garment.findMany.mockResolvedValue([
      {
        id: "g-1",
        name: "Áo dài đỏ thêu sen",
        images: [{ imageUrl: "https://example.com/a.jpg" }],
        garment_sizes: [{ size_label: "M", daily_price: 350000 }],
      },
    ]);

    const result = await runTrigger({
      content: "",
      messageType: "product_card",
      messageId: "card-1",
      metadata: {
        product: { id: "g-1", name: "Áo dài đỏ thêu sen", size: "M", price: 350000 },
      },
    });

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(parts.dbHandlers.handle).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "db.product_card_detail" }),
    );
    expect(result).toHaveLength(1);
    const cardCall = prisma.messages.create.mock.calls.find(
      (call: any[]) => call[0]?.data?.message_type === "product_card",
    );
    expect(cardCall).toBeDefined();
    expect(cardCall?.[0].data.metadata.product).toMatchObject({
      id: "g-1",
      name: "Áo dài đỏ thêu sen",
      size: "M",
      price: 350000,
    });
  });

  it("creates rich product cards for products returned by a DB reply", async () => {
    prisma.garment.findMany.mockResolvedValue([
      {
        id: "g-1",
        name: "Áo dài đỏ thêu sen",
        color: "đỏ",
        category: { name: "Áo dài" },
        images: [{ imageUrl: "https://example.com/a.jpg" }],
        garment_sizes: [
          { id: "s-m", size_label: "M", daily_price: 350000, deposit_amount: 500000 },
          { id: "s-l", size_label: "L", daily_price: 400000, deposit_amount: 550000 },
        ],
        assets: [{ id: "a-1", garment_size_id: "s-m" }],
      },
    ]);

    await run("shop có những sản phẩm gì");

    const cardCall = prisma.messages.create.mock.calls.find(
      (call: any[]) => call[0]?.data?.message_type === "product_card",
    );
    expect(cardCall).toBeDefined();
    expect(cardCall?.[0].data.metadata.product).toMatchObject({
      id: "g-1",
      name: "Áo dài đỏ thêu sen",
      size: "M, L",
      sizes: ["M", "L"],
      price: 350000,
      priceFrom: 350000,
      priceTo: 400000,
      depositFrom: 500000,
      detailUrl: "/catalog/s-m",
      inStock: true,
      category: "Áo dài",
      color: "đỏ",
    });
  });

  it("processes the same customer messageId only once", async () => {
    await run("địa chỉ shop ở đâu", "msg-1");
    await run("địa chỉ shop ở đâu", "msg-1");

    expect(prisma.messages.create).toHaveBeenCalledOnce();
  });

  it("coalesces a burst of messages into one routed turn", async () => {
    const p1 = service.maybeAutoReply(CONV, "chào shop");
    const p2 = service.maybeAutoReply(CONV, "mình cao 1m65 nặng 55kg nên mặc size nào");
    const p3 = service.maybeAutoReply(CONV, "tư vấn giúp mình đồ đi tiệc");

    await waitForDebounce();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(aiService.productAdvisor.mock.calls[0][0].message).toBe(
      "tư vấn giúp mình đồ đi tiệc",
    );
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it("ignores empty and emoji-only text before touching the database", async () => {
    await expect(service.maybeAutoReply(CONV, "   ")).resolves.toEqual([]);
    await expect(service.maybeAutoReply(CONV, "🙂🙂")).resolves.toEqual([]);

    expect(prisma.conversations.findUnique).not.toHaveBeenCalled();
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("does not reply when the conversation is resolved", async () => {
    prisma = createPrisma({ status: "resolved" });
    build();

    await expect(service.maybeAutoReply(CONV, "địa chỉ shop ở đâu")).resolves.toEqual([]);

    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("does not reply when requireUnassigned and a staff already owns the conversation", async () => {
    prisma = createPrisma({ staffId: "staff-1" });
    build();

    const result = await service.maybeAutoReply(CONV, "địa chỉ shop ở đâu", {
      requireUnassigned: true,
    });

    expect(result).toEqual([]);
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("does not reply when the latest message is already from AI", async () => {
    prisma = createPrisma({ latestSender: AI_USER });
    build();

    const result = await run("địa chỉ shop ở đâu");

    expect(result).toEqual([]);
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("sends a fallback acknowledgement when the model fails", async () => {
    aiService.productAdvisor.mockRejectedValue(new Error("OpenRouter API 429"));

    const result = await run("tư vấn giúp mình đồ đi tiệc");

    expect(prisma.messages.create).toHaveBeenCalledOnce();
    const created = prisma.messages.create.mock.calls[0][0].data;
    expect(created.sender_type).toBe("ai");
    expect(created.content).toContain("Em đã ghi nhận");
    expect(result).toHaveLength(1);
  });

  it("does not spam fallback messages within the cooldown window", async () => {
    aiService.productAdvisor.mockRejectedValue(new Error("timeout"));
    prisma = createPrisma({ fallbackRecent: true });
    build();

    const result = await run("tư vấn giúp mình đồ đi tiệc");

    expect(prisma.messages.create).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("excludes the message being answered from the model history", async () => {
    prisma = createPrisma({
      historyMessages: [
        {
          id: "current-msg",
          conversation_id: CONV,
          sender_id: CUSTOMER,
          sender_type: "user",
          content: "còn màu khác không",
          message_type: "text",
          metadata: null,
          created_at: new Date(),
        },
        {
          id: "older-msg",
          conversation_id: CONV,
          sender_id: CUSTOMER,
          sender_type: "user",
          content: "áo dài xanh",
          message_type: "text",
          metadata: null,
          created_at: new Date(Date.now() - 60_000),
        },
      ],
    });
    build();

    await run("tư vấn giúp mình đồ đi tiệc", "current-msg");

    const history = aiService.productAdvisor.mock.calls[0][0].history;
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("áo dài xanh");
  });

  it("rejects a model call that exceeds the total deadline", async () => {
    const deadline = (service as any).withAiDeadline.bind(service);

    await expect(deadline(new Promise(() => undefined), 20)).rejects.toThrow(
      "AI total timeout after 20ms",
    );
  });

  it("does not save or send an AI reply when staff takes the lock during the model call", async () => {
    let staffLocked = false;
    aiService.productAdvisor.mockImplementation(async () => {
      staffLocked = true;
      return {
        success: true,
        data: {
          topics: [
            {
              title: "Gợi ý",
              assistantReply: "Em gợi ý mẫu này ạ.",
              recommendedProductIds: [],
              reasons: {},
              products: [],
            },
          ],
        },
      };
    });

    const result = await (service as any).performAutoReply(
      CONV,
      { content: "tư vấn giúp mình đồ đi tiệc", messageType: "text" },
      false,
      () => staffLocked,
    );

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(result).toEqual([]);
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("builds a post-release trigger from the last customer message", async () => {
    const prismaWithFindFirst = {
      conversations: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONV,
          customer_id: CUSTOMER,
          staff_id: null,
          status: "open",
          topic: "general",
        }),
      },
      messages: {
        findFirst: vi.fn().mockResolvedValue({
          id: "msg-last",
          content: "áo dài đỏ",
          message_type: "text",
          metadata: null,
          sender_id: CUSTOMER,
        }),
      },
    };
    build(parts, prismaWithFindFirst as never);
    const maybeAutoReply = vi.spyOn(service, "maybeAutoReply").mockResolvedValue([]);

    await service.autoReplyUnassignedIfCustomerWaiting(CONV);

    expect(maybeAutoReply).toHaveBeenCalledWith(
      CONV,
      {
        content: "áo dài đỏ",
        messageType: "text",
        metadata: null,
        messageId: "msg-last",
      },
      { requireUnassigned: true },
    );
  });

  it("does not auto-reply after release when a staff member already owns the conversation", async () => {
    const prismaWithFindFirst = {
      conversations: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONV,
          customer_id: CUSTOMER,
          staff_id: "staff-b",
          status: "open",
          topic: "general",
        }),
      },
      messages: { findFirst: vi.fn() },
    };
    build(parts, prismaWithFindFirst as never);
    const maybeAutoReply = vi.spyOn(service, "maybeAutoReply").mockResolvedValue([]);

    await service.autoReplyUnassignedIfCustomerWaiting(CONV);

    expect(maybeAutoReply).not.toHaveBeenCalled();
    expect(prismaWithFindFirst.messages.findFirst).not.toHaveBeenCalled();
  });

  it("does not auto-reply after release when the last message is not from the customer", async () => {
    const prismaWithFindFirst = {
      conversations: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONV,
          customer_id: CUSTOMER,
          staff_id: null,
          status: "open",
          topic: "general",
        }),
      },
      messages: {
        findFirst: vi.fn().mockResolvedValue({
          id: "msg-last",
          content: "Đã trả lời",
          message_type: "text",
          metadata: null,
          sender_id: AI_USER,
        }),
      },
    };
    build(parts, prismaWithFindFirst as never);
    const maybeAutoReply = vi.spyOn(service, "maybeAutoReply").mockResolvedValue([]);

    await service.autoReplyUnassignedIfCustomerWaiting(CONV);

    expect(maybeAutoReply).not.toHaveBeenCalled();
  });
});
