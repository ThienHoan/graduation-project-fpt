import { describe, expect, it, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ChatService } from "./chat.service";

describe("ChatService", () => {
  let service: ChatService;
  let prisma: any;
  let aiService: any;

  beforeEach(() => {
    prisma = {
      conversations: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      messages: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userAccount: {
        findUnique: vi.fn(),
      },
    };
    aiService = { productAdvisor: vi.fn() };
    service = new ChatService(prisma as never, aiService as never);
  });

  describe("sendProductCardMessage", () => {
    it("rejects when user is not a conversation participant", async () => {
      // findFirst returns null (conversation not found) → ForbiddenException
      prisma.conversations.findFirst.mockResolvedValue(null);

      await expect(
        service.sendProductCardMessage("user-1", "customer", "conv-1", "garment-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects when garment does not exist", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
        customer_last_read_at: null,
        staff_last_read_at: null,
      });
      prisma.garment = {
        findUnique: vi.fn().mockResolvedValue(null),
      };

      await expect(
        service.sendProductCardMessage("user-1", "customer", "conv-1", "garment-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("creates a product card message with garment data from DB and updates conversation context", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
        customer_last_read_at: null,
        staff_last_read_at: null,
      });
      prisma.garment = {
        findUnique: vi.fn().mockResolvedValue({
          id: "garment-1",
          name: "Ao dai sen",
          images: [{ imageUrl: "https://example.com/img.jpg" }],
          garment_sizes: [{ id: "size-1", size_label: "M", daily_price: 350000 }],
        }),
      };
      prisma.messages.create.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-1",
        content: '{"type":"product_card","product":{"id":"garment-1","name":"Ao dai sen","image":"https://example.com/img.jpg","size":"M","price":350000,"detailUrl":"/catalog/size-1"}}',
        created_at: new Date(),
      });
      prisma.messages.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-1",
        content: '{"type":"product_card","product":{"id":"garment-1","name":"Ao dai sen","image":"https://example.com/img.jpg","size":"M","price":350000,"detailUrl":"/catalog/size-1"}}',
        created_at: new Date(),
      });
      prisma.conversations.update.mockResolvedValue({});

      const result = await service.sendProductCardMessage("user-1", "customer", "conv-1", "garment-1");

      expect(result).toBeDefined();
      // Verify the garment query was called with the right garmentId
      expect(prisma.garment.findUnique).toHaveBeenCalledWith({
        where: { id: "garment-1" },
        include: {
          images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
          garment_sizes: {
            where: { is_active: true },
            orderBy: { daily_price: "asc" as const },
          },
          assets: {
            where: { status: "available" },
            select: { id: true, garment_size_id: true },
          },
          category: { select: { name: true } },
        },
      });
      // Verify conversation update includes topic context
      const updateCall = prisma.conversations.update.mock.calls[0]?.[0];
      expect(updateCall.data).toMatchObject({
        topic: "product_advice",
        garment_id: "garment-1",
      });
    });
  });

  describe("sendMessage validations", () => {
    it("rejects empty content", async () => {
      await expect(
        service.sendMessage("user-1", "customer", "conv-1", ""),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.sendMessage("user-1", "customer", "conv-1", "   "),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects content over 2000 characters", async () => {
      await expect(
        service.sendMessage("user-1", "customer", "conv-1", "x".repeat(2001)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("does not persist a message when the staff is not assigned", async () => {
      prisma.conversations.findUnique.mockResolvedValue({
        id: "conv-1",
        customer_id: "customer-1",
        staff_id: "staff-1",
        status: "open",
      });

      await expect(
        service.sendMessage("staff-2", "staff", "conv-1", "Xin chào"),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.messages.create).not.toHaveBeenCalled();
    });

    it("allows content of exactly 2000 characters", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
        customer_last_read_at: null,
        staff_last_read_at: null,
      });
      prisma.messages.create.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-1",
        content: "x".repeat(2000),
        created_at: new Date(),
      });
      prisma.messages.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-1",
        content: "x".repeat(2000),
        created_at: new Date(),
      });
      prisma.conversations.update.mockResolvedValue({});

      const result = await service.sendMessage("user-1", "customer", "conv-1", "x".repeat(2000));
      expect(result).toBeDefined();
    });

    it("rejects product_card JSON payload", async () => {
      await expect(
        service.sendMessage("user-1", "customer", "conv-1", JSON.stringify({ type: "product_card", productId: "p-1" })),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.sendMessage("user-1", "customer", "conv-1", JSON.stringify({ type: "product_card" })),
      ).rejects.toThrow("Product cards must be created by server");
    });

    it("allows regular JSON that is not a product_card", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
        customer_last_read_at: null,
        staff_last_read_at: null,
      });
      prisma.messages.create.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-1",
        content: '{"type":"custom"}',
        created_at: new Date(),
      });
      prisma.messages.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-1",
        content: '{"type":"custom"}',
        created_at: new Date(),
      });
      prisma.conversations.update.mockResolvedValue({});

      const result = await service.sendMessage("user-1", "customer", "conv-1", '{"type":"custom"}');
      expect(result).toBeDefined();
    });
  });

  it("creates a message and updates the sender's last read timestamp", async () => {
    const now = new Date();
    prisma.conversations.findUnique.mockResolvedValue({
      id: "conversation-1",
      customer_id: "customer-1",
      staff_id: "staff-1",
      customer_last_read_at: null,
      staff_last_read_at: null,
    });
    prisma.messages.create.mockResolvedValue({
      id: "message-1",
      conversation_id: "conversation-1",
      sender_id: "staff-1",
      content: "Hello",
      created_at: now,
    });
    prisma.messages.findUnique.mockResolvedValue({
      id: "message-1",
      conversation_id: "conversation-1",
      sender_id: "staff-1",
      content: "Hello",
      created_at: now,
    });
    prisma.conversations.update.mockResolvedValue({});

    const result = await service.sendMessage("staff-1", "staff", "conversation-1", "Hello");

    expect(prisma.messages.create).toHaveBeenCalledOnce();
    expect(prisma.conversations.update).toHaveBeenCalledOnce();
    expect(result).toEqual({
      id: "message-1",
      conversation_id: "conversation-1",
      sender_id: "staff-1",
      content: "Hello",
      created_at: now,
      replyTo: null,
    });
  });

  it("resolves a conversation and clears topic context", async () => {
    const prisma = {
      conversations: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conv-resolve",
          customer_id: "customer-1",
          staff_id: "staff-1",
          status: "open",
          topic: "product_advice",
          garment_id: "garment-1",
          booking_id: null,
        }),
        update: vi.fn().mockResolvedValue({ id: "conv-resolve", status: "resolved" }),
      },
    };

    const service = new ChatService(prisma as never, aiService as never);
    await service.resolveConversation("conv-resolve", "staff-1");

    expect(prisma.conversations.update).toHaveBeenCalledOnce();
    const updateCall = prisma.conversations.update.mock.calls[0]?.[0];
    expect(updateCall.data).toMatchObject({
      status: "resolved",
      topic: "general",
      garment_id: null,
      booking_id: null,
    });
  });

  it("marks a conversation as read for the current user", async () => {
    const prisma = {
      conversations: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conversation-2",
          customer_id: "customer-2",
          staff_id: "staff-2",
          customer_last_read_at: null,
          staff_last_read_at: null,
        }),
        update: vi.fn().mockResolvedValue({ id: "conversation-2" }),
      },
    };

    const service = new ChatService(prisma as never, aiService as never);
    await service.markConversationRead("customer-2", "customer", "conversation-2");

    expect(prisma.conversations.update).toHaveBeenCalledOnce();
    const updateCall = prisma.conversations.update.mock.calls[0]?.[0];
    expect(updateCall.where).toEqual({ id: "conversation-2" });
    expect(updateCall.data.customer_last_read_at).toBeInstanceOf(Date);
  });

  it("loads conversation messages with cursor-based pagination", async () => {
    const prisma = {
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: "conversation-3", customer_id: "customer-3", staff_id: "staff-3" }),
      },
      messages: {
        findFirst: vi.fn().mockResolvedValue({ id: "message-1", created_at: new Date("2025-01-01T00:00:00.000Z") }),
        findMany: vi.fn().mockResolvedValue([
          { id: "message-2", content: "Second", sender_id: "staff-3", conversation_id: "conversation-3", created_at: new Date(), user_accounts: { id: "staff-3", email: "staff@example.com", role: "staff" } },
        ]),
      },
    };

    const service = new ChatService(prisma as never, aiService as never);
    const messages = await service.getMessages(
      {
        id: "customer-3",
        email: "customer@example.com",
        role: "customer",
        isActive: true,
        fullName: "Customer 3",
        phone: null,
      },
      "conversation-3",
      "message-1",
      20,
    );

    expect(prisma.messages.findMany).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("message-2");
  });

  describe("sendBookingCardMessage", () => {
    it("rejects when user is not a conversation participant", async () => {
      prisma.conversations.findFirst.mockResolvedValue(null);

      await expect(
        service.sendBookingCardMessage("user-1", "customer", "conv-1", "booking-1", "booking_support"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects when booking does not exist", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
        customer_last_read_at: null,
        staff_last_read_at: null,
      });
      prisma.booking = { findUnique: vi.fn().mockResolvedValue(null) };

      await expect(
        service.sendBookingCardMessage("user-1", "customer", "conv-1", "booking-1", "booking_support"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects when booking does not belong to the conversation's customer", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
      });
      prisma.booking = {
        findUnique: vi.fn().mockResolvedValue({
          id: "booking-1",
          customerId: "other-user",
        }),
      };

      await expect(
        service.sendBookingCardMessage("user-1", "customer", "conv-1", "booking-1", "booking_support"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("creates a booking card message and updates conversation context", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-1",
        customer_id: "user-1",
        staff_id: null,
        status: "open",
        customer_last_read_at: null,
        staff_last_read_at: null,
      });
      prisma.booking = {
        findUnique: vi.fn().mockResolvedValue({
          id: "booking-1",
          customerId: "user-1",
          status: "pending_confirmation",
          rentalStartDate: new Date("2026-06-28"),
          rentalEndDate: new Date("2026-06-29"),
          rentalTotal: 640000,
          depositTotal: 900000,
          items: [{ id: "item-1" }],
        }),
      };
      prisma.messages = {
        create: vi.fn().mockResolvedValue({
          id: "msg-booking-1",
          conversation_id: "conv-1",
          sender_id: "user-1",
          content: JSON.stringify({
            type: "booking_card",
            booking: {
              id: "booking-1",
              code: "BOOKING-",
              status: "pending_confirmation",
              statusLabel: "Chờ xác nhận",
              rentalStartDate: new Date("2026-06-28"),
              rentalEndDate: new Date("2026-06-29"),
              days: 2,
              itemCount: 1,
              rentalTotal: 640000,
              depositTotal: 900000,
            },
          }),
          created_at: new Date(),
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: "msg-booking-1",
          conversation_id: "conv-1",
          sender_id: "user-1",
          content: "{\"type\":\"booking_card\",\"booking\":{}}",
          created_at: new Date(),
        }),
      };
      prisma.conversations.update.mockResolvedValue({});

      const result = await service.sendBookingCardMessage("user-1", "customer", "conv-1", "booking-1", "complaint");

      expect(result).toBeDefined();
      const updateCall = prisma.conversations.update.mock.calls[0]?.[0];
      expect(updateCall.data).toMatchObject({
        topic: "complaint",
        booking_id: "booking-1",
        garment_id: null,
      });
    });
  });

  describe("releaseAssignmentIfStaffUnavailable", () => {
    it("releases the assignment when the staff account no longer exists", async () => {
      const prisma = {
        userAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        conversations: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        messages: { findFirst: vi.fn() },
      };
      const service = new ChatService(prisma as never, aiService as never);

      await expect(
        service.releaseAssignmentIfStaffUnavailable("conv-1", "staff-old"),
      ).resolves.toBe(true);

      expect(prisma.conversations.updateMany).toHaveBeenCalledWith({
        where: { id: "conv-1", staff_id: "staff-old" },
        data: { staff_id: null, updated_at: expect.any(Date) },
      });
      // Không xét tin cuối: mất acc thì phải trả hội thoại về Chờ tiếp nhận.
      expect(prisma.messages.findFirst).not.toHaveBeenCalled();
    });

    it("releases the assignment when the staff account is inactive", async () => {
      const prisma = {
        userAccount: { findUnique: vi.fn().mockResolvedValue({ isActive: false }) },
        conversations: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      const service = new ChatService(prisma as never, aiService as never);

      await expect(
        service.releaseAssignmentIfStaffUnavailable("conv-2", "staff-inactive"),
      ).resolves.toBe(true);

      expect(prisma.conversations.updateMany).toHaveBeenCalledOnce();
    });

    it("keeps the assignment when the staff account is still active", async () => {
      const prisma = {
        userAccount: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
        conversations: { updateMany: vi.fn() },
      };
      const service = new ChatService(prisma as never, aiService as never);

      await expect(
        service.releaseAssignmentIfStaffUnavailable("conv-3", "staff-active"),
      ).resolves.toBe(false);

      expect(prisma.conversations.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("releaseConversationLock", () => {
    it("reports released when the last message is from the customer", async () => {
      prisma.conversations.findUnique.mockResolvedValue({
        id: "conv-1",
        reopened_from_resolved: false,
      });
      prisma.messages.findFirst = vi.fn().mockResolvedValue({ sender_id: "customer-1" });
      prisma.conversations.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      await expect(service.releaseConversationLock("conv-1", "staff-1")).resolves.toEqual({
        status: "open",
        released: true,
      });
      expect(prisma.conversations.updateMany).toHaveBeenCalledWith({
        where: { id: "conv-1", staff_id: "staff-1" },
        data: { staff_id: null, updated_at: expect.any(Date) },
      });
    });

    it("releases the assignment when the staff sent the last message", async () => {
      prisma.conversations.findUnique.mockResolvedValue({
        id: "conv-2",
        reopened_from_resolved: false,
      });
      prisma.messages.findFirst = vi.fn().mockResolvedValue({ sender_id: "staff-1" });
      prisma.conversations.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      await expect(service.releaseConversationLock("conv-2", "staff-1")).resolves.toEqual({
        status: "open",
        released: true,
      });
      expect(prisma.conversations.updateMany).toHaveBeenCalledWith({
        where: { id: "conv-2", staff_id: "staff-1" },
        data: { staff_id: null, updated_at: expect.any(Date) },
      });
    });

    it("resolves a reopened conversation when the customer has not asked again", async () => {
      prisma.conversations.findUnique.mockResolvedValue({
        id: "conv-3",
        customer_id: "customer-1",
        reopened_from_resolved: true,
      });
      prisma.messages.findFirst = vi.fn().mockResolvedValue({ sender_id: "staff-1" });
      prisma.conversations.findFirst.mockResolvedValue({
        id: "conv-3",
        staff_id: "staff-1",
      });
      prisma.conversations.update.mockResolvedValue({
        id: "conv-3",
        status: "resolved",
      });
      prisma.conversations.updateMany = vi.fn();

      await expect(service.releaseConversationLock("conv-3", "staff-1")).resolves.toEqual({
        status: "resolved",
        released: false,
      });
    });

    it("releases instead of resolving a reopened conversation with a new customer message", async () => {
      prisma.conversations.findUnique.mockResolvedValue({
        id: "conv-4",
        customer_id: "customer-1",
        reopened_from_resolved: true,
      });
      prisma.messages.findFirst = vi.fn().mockResolvedValue({ sender_id: "customer-1" });
      prisma.conversations.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      await expect(service.releaseConversationLock("conv-4", "staff-1")).resolves.toEqual({
        status: "open",
        released: true,
      });
      expect(prisma.conversations.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "resolved" }),
        }),
      );
    });
  });

  it("releases all open staff assignments after a server restart", async () => {
    const prisma = {
      conversations: {
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
    };
    const service = new ChatService(prisma as never, aiService as never);

    await service.releaseStaleStaffAssignments();

    expect(prisma.conversations.updateMany).toHaveBeenCalledWith({
      where: { status: "open", staff_id: { not: null } },
      data: { staff_id: null, updated_at: expect.any(Date) },
    });
  });

  describe("conversation tab classification", () => {
    const staffUser = {
      id: "staff-1",
      email: "staff1@example.com",
      role: "staff" as const,
      isActive: true,
      fullName: "Staff One",
      phone: null,
    };

    function makeConversation(params: {
      id: string;
      staffId: string | null;
      senderId: string;
      senderType?: string;
      customerId?: string;
    }) {
      return {
        id: params.id,
        customer_id: params.customerId ?? "customer-1",
        staff_id: params.staffId,
        status: "open",
        topic: "general",
        garment_id: null,
        booking_id: null,
        updated_at: new Date("2025-01-01T00:00:00.000Z"),
        customer_last_read_at: null,
        staff_last_read_at: null,
        reopened_from_resolved: false,
        messages: [
          {
            id: `msg-${params.id}`,
            content: "last message",
            sender_id: params.senderId,
            sender_type: params.senderType ?? "staff",
            created_at: new Date("2025-01-01T00:00:00.000Z"),
            message_type: "text",
            metadata: null,
            deleted_at: null,
          },
        ],
        user_accounts_conversations_customer_idTouser_accounts: null,
        user_accounts_conversations_staff_idTouser_accounts: null,
      };
    }

    it("separates Chờ tiếp nhận and Chờ khách for unassigned conversations", async () => {
      const prisma = {
        conversations: {
          findMany: vi.fn().mockResolvedValue([
            makeConversation({ id: "customer-last", staffId: null, senderId: "customer-1", senderType: "customer" }),
            makeConversation({ id: "ai-last", staffId: null, senderId: "ai", senderType: "ai" }),
            makeConversation({ id: "staff-last", staffId: null, senderId: "staff-1" }),
          ]),
        },
        messages: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
      };
      const service = new ChatService(prisma as never, aiService as never);

      const unassigned = await service.listConversations(staffUser, "unassigned");
      const waitingCustomer = await service.listConversations(staffUser, "waiting_customer");

      expect(unassigned.map((c) => c.id)).toEqual(["customer-last", "ai-last"]);
      expect(waitingCustomer.map((c) => c.id)).toEqual(["staff-last"]);
      expect(prisma.conversations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { staff_id: null, status: "open" } }),
      );
    });

    it("only shows owned conversations with an active lock in Chờ phản hồi", async () => {
      const prisma = {
        conversations: {
          findMany: vi.fn().mockResolvedValue([
            makeConversation({ id: "assigned-own", staffId: "staff-1", senderId: "staff-1" }),
            makeConversation({ id: "assigned-expired", staffId: "staff-1", senderId: "staff-2" }),
            makeConversation({ id: "unassigned-own", staffId: null, senderId: "staff-1" }),
          ]),
        },
        messages: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
      };
      const service = new ChatService(prisma as never, aiService as never);
      const isLockActive = vi.fn(
        (conversationId: string, staffId: string) =>
          conversationId === "assigned-own" && staffId === "staff-1",
      );

      const result = await service.listConversations(staffUser, "awaiting_reply", isLockActive);

      expect(result.map((c) => c.id)).toEqual(["assigned-own"]);
      expect(prisma.conversations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { staff_id: "staff-1", status: "open" },
              { manager_support_by: "staff-1" },
            ],
          },
        }),
      );
    });

    it("hides empty conversations from the staff list and tab counts", async () => {
      const emptyConversation = {
        ...makeConversation({ id: "empty", staffId: null, senderId: "customer-1", senderType: "customer" }),
        messages: [],
      };
      const prisma = {
        conversations: {
          findMany: vi.fn().mockResolvedValue([
            emptyConversation,
            makeConversation({ id: "has-message", staffId: null, senderId: "customer-1", senderType: "customer" }),
          ]),
        },
        messages: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
      };
      const service = new ChatService(prisma as never, aiService as never);

      const unassigned = await service.listConversations(staffUser, "unassigned");
      const all = await service.listConversations(staffUser);

      expect(unassigned.map((c) => c.id)).toEqual(["has-message"]);
      expect(all.map((c) => c.id)).toEqual(["has-message"]);
      await expect(service.getConversationCounts(staffUser)).resolves.toEqual({
        needsReply: 0,
        awaitingReply: 0,
        unassigned: 1,
        waitingCustomer: 0,
        resolved: 0,
      });
    });

    it("counts conversations by mutually exclusive tabs", async () => {
      const prisma = {
        conversations: {
          findMany: vi.fn().mockResolvedValue([
            makeConversation({ id: "u-customer", staffId: null, senderId: "customer-1", senderType: "customer" }),
            makeConversation({ id: "u-ai", staffId: null, senderId: "ai", senderType: "ai" }),
            makeConversation({ id: "u-own", staffId: null, senderId: "staff-1" }),
            makeConversation({ id: "u-other", staffId: null, senderId: "staff-2" }),
            makeConversation({ id: "a-customer", staffId: "staff-1", senderId: "customer-1", senderType: "customer" }),
            makeConversation({ id: "a-ai", staffId: "staff-1", senderId: "ai", senderType: "ai" }),
            makeConversation({ id: "a-own", staffId: "staff-1", senderId: "staff-1" }),
            makeConversation({ id: "a-expired", staffId: "staff-1", senderId: "staff-1" }),
            makeConversation({ id: "a-other", staffId: "staff-2", senderId: "customer-1", senderType: "customer" }),
            {
              ...makeConversation({ id: "resolved", staffId: "staff-1", senderId: "staff-1" }),
              status: "resolved",
            },
          ]),
        },
      };
      const service = new ChatService(prisma as never, aiService as never);
      const isLockActive = vi.fn((conversationId: string) => conversationId === "a-own");

      await expect(service.getConversationCounts(staffUser, isLockActive)).resolves.toEqual({
        needsReply: 2,
        awaitingReply: 1,
        unassigned: 2,
        waitingCustomer: 2,
        resolved: 1,
      });
    });
  });

  it("returns the customer unread count with their conversation", async () => {
    const lastReadAt = new Date("2025-01-01T00:00:00.000Z");
    const prisma = {
      conversations: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conv-unread",
          customer_id: "customer-1",
          customer_last_read_at: lastReadAt,
          messages: [],
        }),
      },
      messages: {
        count: vi.fn().mockResolvedValue(4),
      },
    };
    const service = new ChatService(prisma as never, aiService as never);

    const conversation = await service.getOrCreateConversationForCustomer("customer-1");

    expect(prisma.messages.count).toHaveBeenCalledWith({
      where: {
        conversation_id: "conv-unread",
        sender_id: { not: "customer-1" },
        created_at: { gt: lastReadAt },
      },
    });
    expect(conversation.unreadCount).toBe(4);
  });

  it("lists conversations and computes unread message counts", async () => {
    const prisma = {
      conversations: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conversation-4",
            customer_id: "customer-4",
            staff_id: "staff-4",
            status: "open",
            topic: "product_advice",
            garment_id: "garment-1",
            booking_id: null,
            updated_at: new Date("2025-01-01T00:00:00.000Z"),
            customer_last_read_at: new Date("2024-12-01T00:00:00.000Z"),
            staff_last_read_at: null,
            messages: [
              {
                id: "message-3",
                content: "A new question",
                sender_id: "staff-4",
                created_at: new Date("2025-01-01T00:00:00.000Z"),
              },
            ],
          },
        ]),
      },
      messages: {
        count: vi.fn().mockResolvedValue(1),
      },
      garment: {
        findUnique: vi.fn().mockResolvedValue({ name: "Ao dai sen" }),
      },
    };

    const service = new ChatService(prisma as never, aiService as never);
    const conversations = await service.listConversations({
      id: "customer-4",
      email: "customer4@example.com",
      role: "customer",
      isActive: true,
      fullName: "Customer 4",
      phone: null,
    });

    expect(prisma.conversations.findMany).toHaveBeenCalledOnce();
    expect(prisma.messages.count).toHaveBeenCalledOnce();
    expect(conversations[0]).toMatchObject({
      id: "conversation-4",
      unreadCount: 1,
      lastMessage: {
        id: "message-3",
        content: "A new question",
      },
      topic: "product_advice",
      garmentId: "garment-1",
      garmentName: "Ao dai sen",
    });
  });

  describe("manager support", () => {
    const manager = {
      id: "manager-1",
      email: "manager@example.com",
      role: "manager_owner" as const,
      isActive: true,
      fullName: "Manager One",
      phone: null,
    };
    const baseConversation = {
      id: "conv-manager",
      customer_id: "customer-1",
      staff_id: "staff-a",
      status: "resolved",
      manager_support_by: null as string | null,
      manager_support_state: null as string | null,
      manager_support_expires_at: null as Date | null,
    };

    function activeConversation(state = "active") {
      return {
        ...baseConversation,
        manager_support_by: manager.id,
        manager_support_state: state,
        manager_support_expires_at: new Date(Date.now() + 60 * 60 * 1000),
      };
    }

    it("rejects accounts that are not managers", async () => {
      await expect(
        service.startManagerSupport("conv-manager", {
          ...manager,
          role: "staff",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("starts a support session without changing status or staff_id", async () => {
      prisma.conversations.findUnique.mockResolvedValue({ ...baseConversation });
      prisma.conversations.update.mockImplementation(({ data }: any) => ({
        ...baseConversation,
        ...data,
      }));

      const result = await service.startManagerSupport("conv-manager", manager);

      const data = prisma.conversations.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        manager_support_by: manager.id,
        manager_support_state: "active",
      });
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("staff_id");
      expect(result.manager_support_state).toBe("active");
    });

    it("lets the manager send while keeping resolved status and original staff", async () => {
      prisma.conversations.findUnique.mockResolvedValue(activeConversation());
      prisma.messages.create.mockResolvedValue({ id: "msg-stk" });

      await service.sendMessage("manager-1", "manager_owner", "conv-manager", "Cho em xin STK");

      expect(prisma.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sender_id: manager.id,
            metadata: expect.objectContaining({
              managerSupport: true,
              managerId: manager.id,
              originalStaffId: "staff-a",
            }),
          }),
        }),
      );
      const data = prisma.conversations.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ manager_support_state: "waiting_customer" });
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("staff_id");
    });

    it("keeps the conversation resolved while the customer replies during support", async () => {
      prisma.conversations.findFirst.mockResolvedValue(
        activeConversation("waiting_customer"),
      );
      prisma.messages.create.mockResolvedValue({ id: "msg-stk-reply" });

      await service.sendMessage("customer-1", "customer", "conv-manager", "STK 123");

      const data = prisma.conversations.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({ manager_support_state: "waiting_manager" });
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("staff_id");
    });

    it("reopens to the shared queue when the customer replies after support expired", async () => {
      prisma.conversations.findFirst.mockResolvedValue({
        ...activeConversation("waiting_customer"),
        manager_support_expires_at: new Date(Date.now() - 1000),
      });
      prisma.messages.create.mockResolvedValue({ id: "msg-late" });

      await service.sendMessage("customer-1", "customer", "conv-manager", "Còn ai không?");

      const data = prisma.conversations.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: "open", staff_id: null });
      expect(data.manager_support_by).toBeNull();
    });

    it("keeps resolved and the original staff when support ends on a customer message", async () => {
      prisma.conversations.findUnique.mockResolvedValue(activeConversation("waiting_manager"));
      prisma.conversations.update.mockResolvedValue({
        ...baseConversation,
        manager_support_by: null,
        manager_support_state: null,
      });

      const result = await service.endManagerSupport("conv-manager", manager.id);

      const data = prisma.conversations.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("staff_id");
      expect(data.manager_support_by).toBeNull();
      expect(result).toMatchObject({
        status: "resolved",
        staffId: "staff-a",
        released: false,
      });
    });

    it("keeps resolved status when support ends after the manager replied", async () => {
      prisma.conversations.findUnique.mockResolvedValue(activeConversation("waiting_customer"));
      prisma.conversations.update.mockResolvedValue({
        ...baseConversation,
        manager_support_by: null,
        manager_support_state: null,
      });

      const result = await service.endManagerSupport("conv-manager", manager.id);

      const data = prisma.conversations.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("staff_id");
      expect(result).toMatchObject({ status: "resolved", released: false });
    });

    it("classifies an active support session into the manager's personal tabs", async () => {
      prisma.conversations.findMany = vi.fn().mockResolvedValue([
        {
          ...activeConversation("waiting_manager"),
          messages: [{ sender_id: "customer-1", sender_type: "customer" }],
        },
      ]);

      await expect(service.getConversationCounts(manager)).resolves.toMatchObject({
        needsReply: 1,
        awaitingReply: 0,
        resolved: 0,
      });
    });
  });

  describe("deleteMessage", () => {
    it("rejects a message that belongs to another conversation", async () => {
      prisma.messages.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-2",
        sender_id: "staff-1",
      });

      await expect(service.deleteMessage("staff-1", "msg-1", "conv-1")).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.messages.update).not.toHaveBeenCalled();
    });

    it("rejects deleting a message sent by someone else", async () => {
      prisma.messages.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "staff-2",
      });

      await expect(service.deleteMessage("staff-1", "msg-1", "conv-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("soft-deletes the sender's own message", async () => {
      prisma.messages.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "staff-1",
      });
      prisma.messages.update.mockResolvedValue({});

      await expect(service.deleteMessage("staff-1", "msg-1", "conv-1")).resolves.toMatchObject({
        id: "msg-1",
        conversation_id: "conv-1",
        deleted_by: "staff-1",
      });
    });
  });
});
