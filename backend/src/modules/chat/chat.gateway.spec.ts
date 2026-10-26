import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatGateway, getStaffLockTimeoutMs } from "./chat.gateway";

describe("ChatGateway (unit)", () => {
  let gateway: ChatGateway;
  const mockChatService = {
    getConversationById: vi.fn(),
    assignStaffToConversationIfEmpty: vi.fn(),
    releaseStaffAssignment: vi.fn(),
    releaseStaffAssignmentIfStale: vi.fn(),
    releaseAssignmentIfStaffUnavailable: vi.fn(),
    releaseConversationLock: vi.fn(),
    autoReplyUnassignedIfCustomerWaiting: vi.fn().mockResolvedValue([]),
    maybeAutoReply: vi.fn().mockResolvedValue([]),
    resolveAllReopenedConversations: vi.fn().mockResolvedValue(undefined),
    releaseStaleStaffAssignments: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn(),
  } as any;

  const mockJwtService = {} as any;
  const mockPrisma = {
    conversations: {
      findUnique: vi.fn().mockResolvedValue({ staff_id: null, status: "open" }),
    },
  } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new ChatGateway(mockChatService, mockJwtService, mockPrisma);
    mockChatService.getConversationById.mockReset();
    mockChatService.assignStaffToConversationIfEmpty.mockReset();
    mockChatService.releaseStaffAssignment.mockReset();
    mockChatService.releaseStaffAssignmentIfStale.mockReset();
    mockChatService.releaseStaffAssignmentIfStale.mockResolvedValue(false);
    mockChatService.releaseAssignmentIfStaffUnavailable.mockReset();
    mockChatService.releaseAssignmentIfStaffUnavailable.mockResolvedValue(false);
    mockChatService.releaseConversationLock.mockReset();
    mockChatService.autoReplyUnassignedIfCustomerWaiting.mockReset();
    mockChatService.autoReplyUnassignedIfCustomerWaiting.mockResolvedValue([]);
    mockChatService.maybeAutoReply.mockReset();
    mockChatService.maybeAutoReply.mockResolvedValue([]);
    mockChatService.resolveAllReopenedConversations.mockReset();
    mockChatService.resolveAllReopenedConversations.mockResolvedValue(undefined);
    mockChatService.releaseStaleStaffAssignments.mockReset();
    mockChatService.releaseStaleStaffAssignments.mockResolvedValue(undefined);
    mockChatService.deleteMessage.mockReset();
    mockChatService.deleteMessage.mockResolvedValue({ deleted_at: new Date("2026-01-01T00:00:00.000Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases stale staff assignments when the server starts", async () => {
    await gateway.onModuleInit();

    expect(mockChatService.resolveAllReopenedConversations).toHaveBeenCalledOnce();
    expect(mockChatService.releaseStaleStaffAssignments).toHaveBeenCalledOnce();

    gateway.onModuleDestroy();
  });

  it("locks conversation when a staff opens it", async () => {
    mockChatService.getConversationById.mockResolvedValue({ id: "conv-1", staff_id: null, status: "open" });
    mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({ id: "conv-1", staff_id: "staff-1", status: "open" });
    const client = {
      id: "sock-1",
      data: { user: { userId: "staff-1", role: "staff", fullName: "Staff One" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;

    await gateway.handleOpenConversation({ conversationId: "conv-1" }, client);

    const status = gateway.getLockStatus("conv-1");
    expect(status.isLocked).toBe(true);
    expect(status.lockedBy?.name).toBe("Staff One");
  });

  it("lets another staff claim a conversation whose assigned account is inactive/missing", async () => {
    const staleConversation = {
      id: "conv-stale",
      staff_id: "staff-old",
      status: "open",
      reopened_from_resolved: false,
    };
    mockChatService.getConversationById
      .mockResolvedValueOnce(staleConversation)
      .mockResolvedValueOnce({ ...staleConversation, staff_id: null });
    mockChatService.releaseAssignmentIfStaffUnavailable.mockResolvedValue(true);
    mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({
      id: "conv-stale",
      staff_id: "staff-new",
      status: "open",
    });

    const client = {
      id: "sock-stale",
      data: { user: { userId: "staff-new", role: "staff", fullName: "Staff New" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;

    await gateway.handleOpenConversation({ conversationId: "conv-stale" }, client);

    expect(mockChatService.releaseAssignmentIfStaffUnavailable).toHaveBeenCalledWith("conv-stale", "staff-old");
    expect(mockChatService.releaseStaffAssignmentIfStale).not.toHaveBeenCalled();
    expect(mockChatService.assignStaffToConversationIfEmpty).toHaveBeenCalledWith("conv-stale", "staff-new");
    expect(client.emit).toHaveBeenCalledWith(
      "open_conversation_result",
      expect.objectContaining({ conversationId: "conv-stale", canReply: true, staffId: "staff-new" }),
    );
  });

  it("releases lock on timeout", async () => {
    mockChatService.getConversationById.mockResolvedValue({ id: "conv-2", staff_id: null, status: "open" });
    mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({ id: "conv-2", staff_id: "staff-2", status: "open" });
    mockChatService.releaseConversationLock.mockResolvedValue({ status: "open", released: true });
    const client = {
      id: "sock-2",
      data: { user: { userId: "staff-2", role: "staff", fullName: "Staff Two" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;

    await gateway.handleOpenConversation({ conversationId: "conv-2" }, client);
    expect(gateway.getLockStatus("conv-2").isLocked).toBe(true);

    // advance time by 20 minutes
    vi.advanceTimersByTime(getStaffLockTimeoutMs() + 1000);

    expect(gateway.getLockStatus("conv-2").isLocked).toBe(false);
  });

  it("asks AI after the grace period when lock expiry actually releases the assignment", async () => {
    mockChatService.getConversationById.mockResolvedValue({
      id: "conv-ai",
      staff_id: null,
      status: "open",
      reopened_from_resolved: false,
    });
    mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({
      id: "conv-ai",
      staff_id: "staff-ai",
      status: "open",
    });
    mockChatService.releaseConversationLock.mockResolvedValue({ status: "open", released: true });
    mockChatService.autoReplyUnassignedIfCustomerWaiting.mockResolvedValue([{ id: "ai-msg-1" }]);

    const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
    gateway.server = server as any;

    const client = {
      id: "sock-ai",
      data: { user: { userId: "staff-ai", role: "staff", fullName: "Staff AI" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;

    await gateway.handleOpenConversation({ conversationId: "conv-ai" }, client);

    vi.advanceTimersByTime(getStaffLockTimeoutMs());
    await Promise.resolve();
    await Promise.resolve();

    // Hết lock: chưa gọi AI ngay, phải chờ staff khác có cơ hội nhận.
    expect(mockChatService.autoReplyUnassignedIfCustomerWaiting).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockChatService.autoReplyUnassignedIfCustomerWaiting).toHaveBeenCalledWith("conv-ai");
    expect(server.emit).toHaveBeenCalledWith(
      "message_received",
      expect.objectContaining({
        conversationId: "conv-ai",
        message: { id: "ai-msg-1" },
        staffId: null,
        status: "open",
      }),
    );
  });

  it("does not ask AI when lock expiry releases a conversation whose staff sent the last message", async () => {
    mockChatService.getConversationById.mockResolvedValue({
      id: "conv-kept",
      staff_id: null,
      status: "open",
      reopened_from_resolved: false,
    });
    mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({
      id: "conv-kept",
      staff_id: "staff-kept",
      status: "open",
    });
    mockChatService.releaseConversationLock.mockResolvedValue({ status: "open", released: true });
    mockChatService.autoReplyUnassignedIfCustomerWaiting.mockResolvedValue([]);

    const client = {
      id: "sock-kept",
      data: { user: { userId: "staff-kept", role: "staff", fullName: "Staff Kept" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;

    await gateway.handleOpenConversation({ conversationId: "conv-kept" }, client);

    vi.advanceTimersByTime(getStaffLockTimeoutMs());
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    await Promise.resolve();

    // Hội thoại được nhả sang "Chờ khách"; AI vẫn được hỏi nhưng sẽ tự bỏ qua
    // vì tin cuối không phải của khách.
    expect(mockChatService.autoReplyUnassignedIfCustomerWaiting).toHaveBeenCalledWith("conv-kept");
  });

  it("cancels the post-release AI when another staff claims during the grace period", async () => {
    mockChatService.getConversationById.mockResolvedValue({
      id: "conv-race",
      staff_id: null,
      status: "open",
      reopened_from_resolved: false,
    });
    mockChatService.assignStaffToConversationIfEmpty
      .mockResolvedValueOnce({ id: "conv-race", staff_id: "staff-old", status: "open" })
      .mockResolvedValueOnce({ id: "conv-race", staff_id: "staff-new", status: "open" });
    mockChatService.releaseConversationLock.mockResolvedValue({ status: "open", released: true });

    const oldStaff = {
      id: "sock-old",
      data: { user: { userId: "staff-old", role: "staff", fullName: "Staff Old" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;
    const newStaff = {
      id: "sock-new",
      data: { user: { userId: "staff-new", role: "staff", fullName: "Staff New" } },
      emit: vi.fn(),
      broadcast: { to: () => ({ emit: vi.fn() }) },
      join: vi.fn(),
      rooms: new Set<string>(),
    } as any;

    await gateway.handleOpenConversation({ conversationId: "conv-race" }, oldStaff);

    vi.advanceTimersByTime(getStaffLockTimeoutMs());
    await Promise.resolve();
    await Promise.resolve();

    await gateway.handleOpenConversation({ conversationId: "conv-race" }, newStaff);
    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockChatService.autoReplyUnassignedIfCustomerWaiting).not.toHaveBeenCalled();
  });

  describe("handleSendMessage validations", () => {
    function makeClient(userId: string, role = "customer", fullName = "Test User") {
      const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
      gateway.server = server as any;
      return {
        id: "sock-3",
        data: { user: { userId, role, fullName } },
        emit: vi.fn(),
        broadcast: { to: () => ({ emit: vi.fn() }) },
        join: vi.fn(),
        rooms: new Set<string>(),
      } as any;
    }

    it("rejects message over 2000 characters", async () => {
      const client = makeClient("user-1");
      const longContent = "x".repeat(2001);

      const result = await gateway.handleSendMessage(
        { conversationId: "conv-3", content: longContent },
        client,
      );

      expect(client.emit).toHaveBeenCalledWith("send_error", {
        conversationId: "conv-3",
        reason: "message_too_long",
      });
      expect(result).toEqual({ success: false, error: "message_too_long" });
    });

    it("allows message of exactly 2000 characters", async () => {
      const client = makeClient("user-1");
      mockChatService.getConversationById.mockResolvedValue({ id: "conv-3", customer_id: "user-1", staff_id: null, status: "open" });
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-1", content: "x".repeat(2000) });

      const result = await gateway.handleSendMessage(
        { conversationId: "conv-3", content: "x".repeat(2000) },
        client,
      );

      expect(client.emit).not.toHaveBeenCalledWith("send_error", expect.objectContaining({ reason: "message_too_long" }));
      expect(result).toEqual({ success: true });
    });

    it("rejects product_card payload from client", async () => {
      const client = makeClient("user-2");
      const productCard = JSON.stringify({ type: "product_card", productId: "prod-1" });

      const result = await gateway.handleSendMessage(
        { conversationId: "conv-4", content: productCard },
        client,
      );

      expect(client.emit).toHaveBeenCalledWith("send_error", {
        conversationId: "conv-4",
        reason: "forbidden_payload",
      });
      expect(result).toEqual({ success: false, error: "forbidden_payload" });
    });

    it("rejects rate-limited user after 5 messages in 10 seconds", async () => {
      const client = makeClient("user-3");
      mockChatService.getConversationById.mockResolvedValue({ id: "conv-5", customer_id: "user-3", staff_id: null, status: "open" });
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-1" });

      // Send 5 valid messages
      for (let i = 0; i < 5; i++) {
        const res = await gateway.handleSendMessage(
          { conversationId: "conv-5", content: `Message ${i + 1}` },
          client,
        );
        expect(res).toEqual({ success: true });
      }

      // 6th message should be rate limited
      const result = await gateway.handleSendMessage(
        { conversationId: "conv-5", content: "Message 6" },
        client,
      );

      expect(client.emit).toHaveBeenCalledWith("send_error", {
        conversationId: "conv-5",
        reason: "rate_limited",
      });
      expect(result).toEqual({ success: false, error: "rate_limited" });
    });

    it("allows messages again after rate limit window expires", async () => {
      const client = makeClient("user-4");
      mockChatService.getConversationById.mockResolvedValue({ id: "conv-6", customer_id: "user-4", staff_id: null, status: "open" });
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-1" });
      client.emit.mockClear();

      // Send 5 messages
      for (let i = 0; i < 5; i++) {
        const res = await gateway.handleSendMessage(
          { conversationId: "conv-6", content: `Message ${i + 1}` },
          client,
        );
        expect(res).toEqual({ success: true });
      }

      // Advance time by 10 seconds
      vi.advanceTimersByTime(10_000);

      // 6th message should now be allowed
      client.emit.mockClear();
      const result = await gateway.handleSendMessage(
        { conversationId: "conv-6", content: "Message 6 after window" },
        client,
      );

      expect(client.emit).not.toHaveBeenCalledWith("send_error", expect.objectContaining({ reason: "rate_limited" }));
      expect(result).toEqual({ success: true });
    });

    it("returns { success: false, error: \"invalid_payload\" } when user is not authenticated", async () => {
      const client = {
        id: "sock-anon",
        data: {},
        emit: vi.fn(),
        broadcast: { to: () => ({ emit: vi.fn() }) },
        join: vi.fn(),
      } as any;

      const result = await gateway.handleSendMessage(
        { conversationId: "conv-7", content: "Hello" },
        client,
      );

      expect(client.emit).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "invalid_payload" });
    });

    it("emits AI typing only when auto-reply accepts the message", async () => {
      const client = makeClient("user-5");
      const server = gateway.server as any;
      mockChatService.getConversationById.mockResolvedValue({
        id: "conv-8",
        customer_id: "user-5",
        staff_id: null,
        status: "open",
      });
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-1", content: "còn áo đỏ không" });
      mockChatService.maybeAutoReply.mockImplementation(
        (_id: string, _trigger: unknown, options?: { onAccepted?: () => void }) => {
          options?.onAccepted?.();
          return Promise.resolve([]);
        },
      );

      await gateway.handleSendMessage(
        { conversationId: "conv-8", content: "còn áo đỏ không" },
        client,
      );
      await Promise.resolve();

      expect(server.emit).toHaveBeenCalledWith(
        "typing",
        expect.objectContaining({ conversationId: "conv-8", isTyping: true, userId: "ai-assistant" }),
      );
      expect(server.emit).toHaveBeenCalledWith(
        "typing",
        expect.objectContaining({ conversationId: "conv-8", isTyping: false, userId: "ai-assistant" }),
      );
    });

    it("does not show AI typing when auto-reply is skipped", async () => {
      const client = makeClient("user-6");
      const server = gateway.server as any;
      mockChatService.getConversationById.mockResolvedValue({
        id: "conv-9",
        customer_id: "user-6",
        staff_id: null,
        status: "open",
      });
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-1", content: "ok" });

      await gateway.handleSendMessage({ conversationId: "conv-9", content: "ok" }, client);
      await Promise.resolve();

      expect(server.emit).not.toHaveBeenCalledWith(
        "typing",
        expect.objectContaining({ isTyping: true }),
      );
    });

    it("does not let AI reply after staff claims but before staff sends a message", async () => {
      mockChatService.getConversationById.mockResolvedValue({
        id: "conv-10",
        customer_id: "user-10",
        staff_id: null,
        status: "open",
        reopened_from_resolved: false,
      });
      mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({
        id: "conv-10",
        customer_id: "user-10",
        staff_id: "staff-10",
        status: "open",
      });
      mockPrisma.conversations.findUnique.mockResolvedValue({
        staff_id: "staff-10",
        status: "open",
      });

      const staffClient = makeClient("staff-10", "staff", "Staff Ten");
      await gateway.handleOpenConversation({ conversationId: "conv-10" }, staffClient);
      expect(gateway.hasActiveStaffLock("conv-10")).toBe(true);

      const customerClient = makeClient("user-10");
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-10", content: "còn áo đỏ không" });
      await gateway.handleSendMessage(
        { conversationId: "conv-10", content: "còn áo đỏ không" },
        customerClient,
      );
      await Promise.resolve();

      expect(mockChatService.maybeAutoReply).not.toHaveBeenCalled();
      expect(mockChatService.sendMessage).toHaveBeenCalledWith(
        "user-10",
        "customer",
        "conv-10",
        "còn áo đỏ không",
      );
    });

    it("emits AI message with the current staff assignment instead of null", async () => {
      const client = makeClient("user-11");
      mockChatService.getConversationById.mockResolvedValue({
        id: "conv-11",
        customer_id: "user-11",
        staff_id: "staff-11",
        status: "open",
      });
      mockChatService.sendMessage = vi.fn().mockResolvedValue({ id: "msg-11", content: "còn áo đỏ không" });
      mockChatService.maybeAutoReply.mockResolvedValue([{ id: "ai-msg-11", sender_type: "ai" }]);
      mockPrisma.conversations.findUnique.mockResolvedValue({
        staff_id: "staff-11",
        status: "open",
      });
      const server = gateway.server as any;
      server.emit.mockClear();

      await gateway.handleSendMessage(
        { conversationId: "conv-11", content: "còn áo đỏ không" },
        client,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(server.emit).toHaveBeenCalledWith(
        "message_received",
        expect.objectContaining({
          conversationId: "conv-11",
          message: { id: "ai-msg-11", sender_type: "ai" },
          staffId: "staff-11",
          status: "open",
        }),
      );
    });
  });

  describe("handleDeleteMessage", () => {
    function makeDeleteClient(userId: string, role: string) {
      const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
      gateway.server = server as any;
      return {
        id: `sock-${userId}`,
        data: { user: { userId, role, fullName: "Test User" } },
        emit: vi.fn(),
        broadcast: { to: () => ({ emit: vi.fn() }) },
        join: vi.fn(),
        rooms: new Set<string>(),
      } as any;
    }

    it("blocks staff who do not hold the reply lock", async () => {
      const client = makeDeleteClient("staff-1", "staff");

      await gateway.handleDeleteMessage({ conversationId: "conv-1", messageId: "msg-1" }, client);

      expect(mockChatService.deleteMessage).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith("delete_error", {
        conversationId: "conv-1",
        messageId: "msg-1",
        reason: "lock_required",
      });
    });

    it("allows the staff holding the lock to delete a message", async () => {
      mockChatService.getConversationById.mockResolvedValue({ id: "conv-1", staff_id: null, status: "open" });
      mockChatService.assignStaffToConversationIfEmpty.mockResolvedValue({
        id: "conv-1",
        staff_id: "staff-1",
        status: "open",
      });
      const client = makeDeleteClient("staff-1", "staff");
      await gateway.handleOpenConversation({ conversationId: "conv-1" }, client);
      expect(gateway.isStaffLockActive("conv-1", "staff-1")).toBe(true);

      await gateway.handleDeleteMessage({ conversationId: "conv-1", messageId: "msg-1" }, client);

      expect(mockChatService.deleteMessage).toHaveBeenCalledWith("staff-1", "msg-1", "conv-1");
      const server = gateway.server as any;
      expect(server.emit).toHaveBeenCalledWith(
        "message_deleted",
        expect.objectContaining({ conversationId: "conv-1", messageId: "msg-1" }),
      );
    });

    it("does not require a lock for customers", async () => {
      const client = makeDeleteClient("customer-1", "customer");

      await gateway.handleDeleteMessage({ conversationId: "conv-1", messageId: "msg-1" }, client);

      expect(mockChatService.deleteMessage).toHaveBeenCalledWith("customer-1", "msg-1", "conv-1");
    });
  });
});