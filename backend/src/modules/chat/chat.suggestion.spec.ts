import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { AssistantRouterService } from "./assistant/assistant-router.service";
import { RepeatGuardService } from "./assistant/repeat-guard.service";
import { IdempotencyService } from "./assistant/idempotency.service";

const CUSTOMER = "customer-1";
const STAFF = "staff-1";
const CONV = "22222222-2222-2222-2222-222222222222";
const LAST_MESSAGE = {
  id: "msg-last",
  content: "địa chỉ shop ở đâu",
  message_type: "text",
  metadata: null,
};

function createPrisma(overrides: { staffId?: string | null; message?: any } = {}) {
  return {
    conversations: {
      findUnique: vi.fn().mockResolvedValue({
        id: CONV,
        customer_id: CUSTOMER,
        staff_id: overrides.staffId ?? STAFF,
        status: "open",
        topic: "general",
        manager_support_by: null,
        manager_support_state: null,
        manager_support_expires_at: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    messages: {
      findFirst: vi.fn().mockResolvedValue(overrides.message ?? LAST_MESSAGE),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    garment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function createRouter(options: {
  faqReply?: string;
  faqStatus?: "ok" | "missing";
  context?: Record<string, unknown>;
}) {
  const faqService = {
    render: vi
      .fn()
      .mockResolvedValue(
        options.faqStatus === "missing"
          ? {
              status: "missing",
              key: "address",
              missingKey: "address",
              reason: "faq_config_missing",
            }
          : {
              status: "ok",
              key: "address",
              reply: options.faqReply ?? "Địa chỉ shop: 123 Lê Thánh Tôn.",
            },
      ),
  };
  const dbHandlers = { handle: vi.fn() };
  const handoff = {
    open: vi.fn().mockResolvedValue({ opened: true, shouldAck: true, pendingCount: 1 }),
    markAckSent: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
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

function createCache() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function createAiService() {
  return {
    productAdvisor: vi.fn().mockResolvedValue({
      success: true,
      data: {
        topics: [
          {
            title: "Áo dài đỏ",
            assistantReply: "Em gợi ý mẫu áo dài đỏ ạ.",
            recommendedProductIds: ["g-1", "g-2", "g-3", "g-4"],
            reasons: {},
            products: [
              { garmentId: "g-1", name: "A", imageUrl: null, dailyPrice: 1, size: "M" },
              { garmentId: "g-2", name: "B", imageUrl: null, dailyPrice: 1, size: "M" },
              { garmentId: "g-3", name: "C", imageUrl: null, dailyPrice: 1, size: "M" },
              { garmentId: "g-4", name: "D", imageUrl: null, dailyPrice: 1, size: "M" },
            ],
          },
          { title: "T2", assistantReply: "R2", recommendedProductIds: [], reasons: {}, products: [] },
          { title: "T3", assistantReply: "R3", recommendedProductIds: [], reasons: {}, products: [] },
          { title: "T4", assistantReply: "R4", recommendedProductIds: [], reasons: {}, products: [] },
        ],
      },
    }),
  };
}

describe("ChatService staff suggestion", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let cache: ReturnType<typeof createCache>;
  let parts: ReturnType<typeof createRouter>;
  let aiService: ReturnType<typeof createAiService>;
  let service: ChatService;

  beforeEach(() => {
    prisma = createPrisma();
    cache = createCache();
    parts = createRouter({});
    aiService = createAiService();
    service = new ChatService(
      prisma as never,
      aiService as never,
      cache as never,
      parts.router,
    );
  });

  it("rejects customers", async () => {
    await expect(
      service.suggestReplyForStaff(
        { id: CUSTOMER, role: "customer" } as never,
        CONV,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects staff who are not assigned to the conversation", async () => {
    await expect(
      service.suggestReplyForStaff({ id: "staff-2", role: "staff" } as never, CONV),
    ).rejects.toThrow(ForbiddenException);
  });

  it("suggests the FAQ answer and caches it per messageId", async () => {
    const first = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
    );

    expect(first).toMatchObject({
      messageId: LAST_MESSAGE.id,
      cached: false,
    });
    expect(first.topics).toHaveLength(1);
    expect(first.topics[0].assistantReply).toContain("123 Lê Thánh Tôn");
    expect(aiService.productAdvisor).not.toHaveBeenCalled();

    const second = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
    );

    expect(second.cached).toBe(true);
    expect(second.topics).toEqual(first.topics);
    expect(parts.faqService.render).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledWith(
      `chat:suggestion:v2:${LAST_MESSAGE.id}`,
      first.topics,
      600,
    );
  });

  it("caps an LLM suggestion at 3 topics x 3 products", async () => {
    prisma.messages.findFirst.mockResolvedValue({
      id: "msg-advice",
      content: "tư vấn giúp mình đồ đi tiệc",
      message_type: "text",
      metadata: null,
    });

    const result = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
    );

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(result.topics).toHaveLength(3);
    for (const topic of result.topics) {
      expect(topic.products.length).toBeLessThanOrEqual(3);
      expect(topic.recommendedProductIds.length).toBeLessThanOrEqual(3);
    }
  });

  it("suggests an acknowledgement for a complaint without opening a handoff", async () => {
    prisma.messages.findFirst.mockResolvedValue({
      id: "msg-complaint",
      content: "đồ bị rách, shop xử lý sao",
      message_type: "text",
      metadata: null,
    });

    const result = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
    );

    expect(result.topics[0].assistantReply).toContain("chuyển cho nhân viên");
    expect(parts.handoff.open).not.toHaveBeenCalled();
    expect(parts.handoff.markAckSent).not.toHaveBeenCalled();
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
  });

  it("returns an empty suggestion when the customer has no text message", async () => {
    prisma.messages.findFirst.mockResolvedValue(null);

    const result = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
    );

    expect(result).toEqual({ messageId: null, topics: [], cached: false });
    expect(parts.faqService.render).not.toHaveBeenCalled();
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
  });

  it("trả lời tin khách mà staff chọn, với 6 tin trước đó làm ngữ cảnh", async () => {
    const target = {
      id: "msg-old",
      content: "tu van giup minh do di tiec",
      message_type: "text",
      metadata: null,
      created_at: new Date("2026-10-30T10:00:00.000Z"),
    };
    prisma.messages.findFirst.mockResolvedValueOnce(target);

    const result = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
      "msg-old",
    );

    // Chỉ một truy vấn: tin được chọn hợp lệ nên không cần rơi về tin mới nhất.
    expect(prisma.messages.findFirst).toHaveBeenCalledOnce();
    expect(prisma.messages.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "msg-old",
      conversation_id: CONV,
      sender_id: CUSTOMER,
      deleted_at: null,
      message_type: "text",
    });

    expect(result.messageId).toBe("msg-old");
    expect(cache.set).toHaveBeenCalledWith(
      "chat:suggestion:v2:msg-old",
      result.topics,
      600,
    );
    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(aiService.productAdvisor.mock.calls[0][0].message).toContain(
      "tu van giup minh do di tiec",
    );
    expect(aiService.productAdvisor.mock.calls[0][0].intent).toBe("ai.styling");

    // Lịch sử gửi model: tối đa 6 tin TRƯỚC tin được chọn.
    const historyCall = prisma.messages.findMany.mock.calls.find(
      (call: any[]) => call[0]?.take === 6,
    );
    expect(historyCall).toBeTruthy();
    expect(historyCall?.[0].where.created_at).toEqual({
      lt: target.created_at,
    });
  });

  it("quay về tin khách mới nhất khi staff chọn tin không phải của khách", async () => {
    prisma.messages.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LAST_MESSAGE);

    const result = await service.suggestReplyForStaff(
      { id: STAFF, role: "staff" } as never,
      CONV,
      "msg-of-staff",
    );

    expect(prisma.messages.findFirst).toHaveBeenCalledTimes(2);
    expect(result.messageId).toBe(LAST_MESSAGE.id);
    expect(parts.faqService.render).toHaveBeenCalledOnce();
  });
});
