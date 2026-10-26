import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChatService } from "./chat.service";

const CUSTOMER = "customer-1";
const CONV = "conv-1";
const AI_USER = "00000000-0000-0000-0000-000000000000";
const DEBOUNCE_WAIT_MS = 1800;

const AI_REPLY_MESSAGE = {
  id: "ai-msg-1",
  conversation_id: CONV,
  sender_id: AI_USER,
  sender_type: "ai",
  content: "Em gợi ý mẫu áo dài đỏ này ạ.",
  message_type: "text",
  created_at: new Date(),
};

type PrismaOptions = {
  staffId?: string | null;
  conversationStatus?: string;
  conversationTopic?: string;
  staffActiveAt?: Date | null;
  latestSender?: string;
  fallbackRecent?: boolean;
  historyMessages?: Array<Record<string, unknown>>;
};

function createPrisma(options: PrismaOptions = {}) {
  const conversation = {
    id: CONV,
    customer_id: CUSTOMER,
    staff_id: options.staffId ?? null,
    status: options.conversationStatus ?? "open",
    topic: options.conversationTopic ?? "general",
  };

  return {
    conversations: {
      findUnique: vi.fn().mockResolvedValue(conversation),
      update: vi.fn().mockResolvedValue({}),
    },
    messages: {
      findFirst: vi.fn().mockImplementation((args: any) => {
        // Staff vừa gửi tin trong hội thoại?
        if (args?.where?.sender_type?.not === "ai") {
          return Promise.resolve(options.staffActiveAt ? { created_at: options.staffActiveAt } : null);
        }
        // Đã gửi fallback gần đây chưa?
        if (typeof args?.where?.content === "string") {
          return Promise.resolve(options.fallbackRecent ? { id: "fallback-1" } : null);
        }
        // Tin nhắn cuối cùng của hội thoại
        return Promise.resolve({ sender_id: options.latestSender ?? CUSTOMER });
      }),
      findMany: vi.fn().mockImplementation((args: any) => {
        if (args?.where?.id?.in) return Promise.resolve([AI_REPLY_MESSAGE]);
        if (args?.where?.message_type?.in) return Promise.resolve(options.historyMessages ?? []);
        return Promise.resolve([]);
      }),
      create: vi.fn().mockResolvedValue({ id: "ai-msg-1" }),
    },
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
            assistantReply: AI_REPLY_MESSAGE.content,
            recommendedProductIds: [],
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

describe("ChatService auto-reply", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let aiService: ReturnType<typeof createAiService>;
  let service: ChatService;

  beforeEach(() => {
    prisma = createPrisma();
    aiService = createAiService();
    service = new ChatService(prisma as never, aiService as never);
  });

  it("replies to a product request without a question word or question mark", async () => {
    const promise = service.maybeAutoReply(CONV, "áo dài tím còn hàng khônh");
    await waitForDebounce();
    const result = await promise;

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(aiService.productAdvisor.mock.calls[0][0].message).toBe("áo dài tím còn hàng khônh");
    expect(result).toHaveLength(1);
    expect(result[0].sender_type).toBe("ai");
  });

  it("skips only when the assigned staff has replied recently", async () => {
    prisma = createPrisma({ staffId: "staff-1", staffActiveAt: new Date() });
    service = new ChatService(prisma as never, aiService as never);

    const result = await service.maybeAutoReply(CONV, "áo dài đỏ size M");

    expect(result).toEqual([]);
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
  });

  it("replies again when staff_id is set but the staff has been silent past the TTL", async () => {
    prisma = createPrisma({ staffId: "staff-1", staffActiveAt: null });
    service = new ChatService(prisma as never, aiService as never);

    const promise = service.maybeAutoReply(CONV, "tư vấn giúp mình áo dài đỏ");
    await waitForDebounce();
    const result = await promise;

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
  });

  it("aborts before calling AI when staff claims during the debounce window", async () => {
    let staffLocked = false;
    const promise = service.maybeAutoReply(CONV, "tư vấn giúp mình áo dài đỏ", {
      shouldAbort: () => staffLocked,
    });

    staffLocked = true;
    await waitForDebounce();
    const result = await promise;

    expect(result).toEqual([]);
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("aborts before persisting when staff claims while the model is running", async () => {
    let staffLocked = false;
    let resolveModel: ((value: unknown) => void) | undefined;
    aiService.productAdvisor.mockReturnValue(
      new Promise((resolve) => {
        resolveModel = resolve;
      }),
    );

    const promise = service.maybeAutoReply(CONV, "tư vấn giúp mình áo dài đỏ", {
      shouldAbort: () => staffLocked,
    });
    await waitForDebounce();

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    staffLocked = true;
    resolveModel?.({
      success: true,
      data: {
        topics: [
          {
            title: "Áo dài đỏ",
            assistantReply: AI_REPLY_MESSAGE.content,
            recommendedProductIds: [],
            reasons: {},
            products: [],
          },
        ],
      },
    });

    await expect(promise).resolves.toEqual([]);
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("coalesces a burst of messages into one AI call using the latest content", async () => {
    const p1 = service.maybeAutoReply(CONV, "chào shop");
    const p2 = service.maybeAutoReply(CONV, "mình cần áo dài đỏ");
    const p3 = service.maybeAutoReply(CONV, "size M nữa nhé");

    await waitForDebounce();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    expect(aiService.productAdvisor.mock.calls[0][0].message).toBe("size M nữa nhé");
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it("does not reply twice when the latest message is already from AI", async () => {
    prisma = createPrisma({ latestSender: AI_USER });
    service = new ChatService(prisma as never, aiService as never);

    const result = await service.maybeAutoReply(CONV, "áo dài đỏ");

    expect(result).toEqual([]);
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
  });

  it("ignores empty and emoji-only messages", async () => {
    await expect(service.maybeAutoReply(CONV, "   ")).resolves.toEqual([]);
    await expect(service.maybeAutoReply(CONV, "🙂🙂")).resolves.toEqual([]);
    expect(prisma.conversations.findUnique).not.toHaveBeenCalled();
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
  });

  it("sends a fallback acknowledgement when the AI call fails", async () => {
    aiService.productAdvisor.mockRejectedValue(new Error("OpenRouter API 429"));

    const promise = service.maybeAutoReply(CONV, "còn áo dài đỏ không");
    await waitForDebounce();
    const result = await promise;

    expect(prisma.messages.create).toHaveBeenCalledOnce();
    const created = prisma.messages.create.mock.calls[0][0].data;
    expect(created.sender_type).toBe("ai");
    expect(created.content).toContain("Em đã ghi nhận");
    expect(result).toHaveLength(1);
    expect(prisma.conversations.update).toHaveBeenCalled();
  });

  it("sends a fallback when the AI returns an empty reply", async () => {
    aiService.productAdvisor.mockResolvedValue({
      success: true,
      data: { topics: [{ title: "Trống", assistantReply: "   ", recommendedProductIds: [], reasons: {}, products: [] }] },
    });

    const promise = service.maybeAutoReply(CONV, "áo dài đỏ");
    await waitForDebounce();
    const result = await promise;

    expect(prisma.messages.create).toHaveBeenCalledOnce();
    expect(prisma.messages.create.mock.calls[0][0].data.content).toContain("Em đã ghi nhận");
    expect(result).toHaveLength(1);
  });

  it("does not spam fallback messages within the cooldown window", async () => {
    aiService.productAdvisor.mockRejectedValue(new Error("timeout"));
    prisma = createPrisma({ fallbackRecent: true });
    service = new ChatService(prisma as never, aiService as never);

    const promise = service.maybeAutoReply(CONV, "còn áo dài đỏ không");
    await waitForDebounce();
    const result = await promise;

    expect(prisma.messages.create).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("turns product card metadata into a real product question", async () => {
    const promise = service.maybeAutoReply(CONV, {
      content: "",
      messageType: "product_card",
      messageId: "card-1",
      metadata: {
        product: { id: "g-1", name: "Áo dài đỏ thêu sen", size: "M", price: 350000 },
      },
    });
    await waitForDebounce();
    const result = await promise;

    expect(aiService.productAdvisor).toHaveBeenCalledOnce();
    const request = aiService.productAdvisor.mock.calls[0][0];
    expect(request.message).toContain("Áo dài đỏ thêu sen");
    expect(request.message).toContain("size M");
    expect(request.message).not.toContain("[Đã gửi sản phẩm]");
    expect(result).toHaveLength(1);
  });

  it("answers booking cards with a canned handoff and never calls the model", async () => {
    const promise = service.maybeAutoReply(CONV, {
      content: "",
      messageType: "booking_card",
      messageId: "card-1",
      metadata: {
        topic: "booking_support",
        booking: { code: "BK123456", statusLabel: "Đã xác nhận" },
      },
    });
    await waitForDebounce();
    const result = await promise;

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(prisma.messages.create).toHaveBeenCalledOnce();
    const created = prisma.messages.create.mock.calls[0][0].data;
    expect(created.sender_type).toBe("ai");
    expect(created.content).toContain("BK123456");
    expect(created.content).toContain("Nhân viên");
    expect(result).toHaveLength(1);
  });

  it("answers complaints with an apology instead of a generic AI reply", async () => {
    const promise = service.maybeAutoReply(CONV, {
      content: "",
      messageType: "booking_card",
      metadata: {
        topic: "complaint",
        booking: { code: "BK999999", statusLabel: "Hoàn thành" },
      },
    });
    await waitForDebounce();
    await promise;

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    const created = prisma.messages.create.mock.calls[0][0].data;
    expect(created.content).toContain("xin lỗi");
    expect(created.content).toContain("BK999999");
  });

  it("acknowledges image uploads without calling the model", async () => {
    const promise = service.maybeAutoReply(CONV, {
      content: "",
      messageType: "image",
      metadata: { bucket: "chat-attachments", path: "conv/a.webp" },
    });
    await waitForDebounce();
    await promise;

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    const created = prisma.messages.create.mock.calls[0][0].data;
    expect(created.content).toContain("hình ảnh");
  });

  it("hands media in a complaint conversation to staff", async () => {
    prisma = createPrisma({ conversationTopic: "complaint" });
    service = new ChatService(prisma as never, aiService as never);

    const promise = service.maybeAutoReply(CONV, { content: "", messageType: "image" });
    await waitForDebounce();
    await promise;

    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    const created = prisma.messages.create.mock.calls[0][0].data;
    expect(created.content).toContain("Nhân viên");
  });

  it("excludes the message being answered from the AI history", async () => {
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
    service = new ChatService(prisma as never, aiService as never);

    const promise = service.maybeAutoReply(CONV, {
      content: "còn màu khác không",
      messageType: "text",
      messageId: "current-msg",
    });
    await waitForDebounce();
    await promise;

    const history = aiService.productAdvisor.mock.calls[0][0].history;
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("áo dài xanh");
  });

  it("skips acknowledgement-only messages without calling the model or sending a reply", async () => {
    const result = await service.maybeAutoReply(CONV, "ok shop");

    expect(result).toEqual([]);
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(prisma.messages.create).not.toHaveBeenCalled();
  });

  it("does not reply after release if a staff member claims during the debounce window", async () => {
    prisma = createPrisma({ staffId: null });
    prisma.conversations.findUnique
      .mockResolvedValueOnce({
        id: CONV,
        customer_id: CUSTOMER,
        staff_id: null,
        status: "open",
        topic: "general",
      })
      .mockResolvedValueOnce({
        id: CONV,
        customer_id: CUSTOMER,
        staff_id: "staff-b",
        status: "open",
        topic: "general",
      });
    service = new ChatService(prisma as never, aiService as never);

    const promise = service.maybeAutoReply(CONV, "áo dài đỏ", { requireUnassigned: true });
    await waitForDebounce();
    const result = await promise;

    expect(result).toEqual([]);
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
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
    service = new ChatService(prismaWithFindFirst as never, aiService as never);
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
    service = new ChatService(prismaWithFindFirst as never, aiService as never);
    const maybeAutoReply = vi.spyOn(service, "maybeAutoReply").mockResolvedValue([]);

    await service.autoReplyUnassignedIfCustomerWaiting(CONV);

    expect(maybeAutoReply).not.toHaveBeenCalled();
    expect(prismaWithFindFirst.messages.findFirst).not.toHaveBeenCalled();
  });

  it("does not auto-reply after release when the last message is from staff or AI", async () => {
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
    service = new ChatService(prismaWithFindFirst as never, aiService as never);
    const maybeAutoReply = vi.spyOn(service, "maybeAutoReply").mockResolvedValue([]);

    await service.autoReplyUnassignedIfCustomerWaiting(CONV);

    expect(maybeAutoReply).not.toHaveBeenCalled();
  });

  it("skips when another instance already holds the auto-reply lock", async () => {
    const redis = {
      setNx: vi.fn().mockResolvedValue(false),
      delIfValue: vi.fn().mockResolvedValue(false),
    };
    service = new ChatService(prisma as never, aiService as never, redis as never);

    const promise = service.maybeAutoReply(CONV, "áo dài đỏ");
    await waitForDebounce();
    const result = await promise;

    expect(redis.setNx).toHaveBeenCalledWith(`chat:auto-reply:lock:${CONV}`, expect.any(String), 90);
    expect(aiService.productAdvisor).not.toHaveBeenCalled();
    expect(result).toEqual([]);
    expect(redis.delIfValue).not.toHaveBeenCalled();
  });

  it("releases the distributed lock after replying", async () => {
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      delIfValue: vi.fn().mockResolvedValue(true),
    };
    service = new ChatService(prisma as never, aiService as never, redis as never);

    const promise = service.maybeAutoReply(CONV, "áo dài đỏ");
    await waitForDebounce();
    const result = await promise;

    expect(result).toHaveLength(1);
    expect(redis.delIfValue).toHaveBeenCalledWith(
      `chat:auto-reply:lock:${CONV}`,
      redis.setNx.mock.calls[0][1],
    );
  });
});
