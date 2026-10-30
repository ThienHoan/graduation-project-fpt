import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AppRole, messages } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AiService } from "../ai/ai.service";
import sharp from "sharp";

const AI_USER_ID = "00000000-0000-0000-0000-000000000000";
const QUESTION_KEYWORDS = /[?？]|(?:^|(?<=\s))(gì|nào|ko|không|bao nhiêu|có|sao|thế nào|khi nào|mấy|à|nhỉ|hả)(?=\s|$|[.,;:!?])/i;
const AI_DEBOUNCE_MS = 1000;

@Injectable()
export class ChatService {
  private readonly aiDebounceMap = new Map<string, NodeJS.Timeout>();
  private readonly getOrCreateLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) { }

  async sendProductCardMessage(
    userId: string,
    role: AppRole,
    conversationId: string,
    garmentId: string,
  ) {
    // Validate user is a participant - use the same approach as sendMessage
    let conversation;
    if (role === "customer") {
      conversation = await this.prisma.conversations.findFirst({
        where: {
          id: conversationId,
          customer_id: userId, // ← kết hợp cả 2 điều kiện vào query
        },
      });

      if (!conversation) {
        throw new ForbiddenException("You are not part of this conversation.");
      }
    } else {
      // Staff: chỉ cần conversation tồn tại, không bắt buộc phải là assigned staff
      // vì product card gửi từ catalog là hành động tư vấn, không phải reply trong chat
      conversation = await this.prisma.conversations.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        throw new NotFoundException("Conversation not found.");
      }
    }

    // Query garment from DB with images and sizes
    const garment = await this.prisma.garment.findUnique({
      where: { id: garmentId },
      include: {
        images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
        garment_sizes: { take: 1 },
      },
    });

    if (!garment) {
      throw new NotFoundException("Garment not found.");
    }

    const DEFAULT_IMAGE = "https://dep.com.vn/wp-content/uploads/2020/11/ao-dai-9.jpg";
    const imageUrl = garment.images[0]?.imageUrl || DEFAULT_IMAGE;
    const sizeLabel = garment.garment_sizes[0]?.size_label ?? null;
    const dailyPrice = garment.garment_sizes[0]?.daily_price ?? 0;
    const detailUrl = `/catalog/${garment.garment_sizes[0]?.id ?? garment.id}`;

    const now = new Date();
    const message = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: userId,
        content: "",
        message_type: "product_card",
        metadata: {
          product: {
            id: garment.id,
            name: garment.name,
            image: imageUrl,
            size: sizeLabel,
            price: Number(dailyPrice),
            detailUrl,
          },
        },
      },
    });

    // Update conversation timestamps and topic context
    const productUpdateData: Record<string, unknown> =
      role === "customer" && conversation.status === "resolved"
        ? { status: "open", staff_id: null, topic: "product_advice", garment_id: garmentId, customer_last_read_at: now, updated_at: now }
        : {
            ...(role === "customer"
              ? { customer_last_read_at: now, topic: "product_advice", garment_id: garmentId }
              : { staff_last_read_at: now }),
            updated_at: now,
          };

    if (role === "customer") {
      productUpdateData.reopened_from_resolved = false;
    }

    if (role === "customer" && conversation.status === "resolved") {
      await this.prisma.conversations.updateMany({
        where: { id: conversationId, status: "resolved" },
        data: productUpdateData as any,
      });
    } else {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: productUpdateData as any,
      });
    }

    // Return with user_accounts for real-time display
    if (typeof this.prisma.messages.findUnique === "function") {
      return this.prisma.messages.findUnique({
        where: { id: message.id },
        include: {
          user_accounts: {
            select: {
              id: true,
              email: true,
              role: true,
              profile: { select: { fullName: true } },
            },
          },
        },
      });
    }

    return message;
  }

  async sendBookingCardMessage(
    userId: string,
    role: AppRole,
    conversationId: string,
    bookingId: string,
    topic: "booking_support" | "complaint",
  ) {
    let conversation;
    if (role === "customer") {
      conversation = await this.prisma.conversations.findFirst({
        where: { id: conversationId, customer_id: userId },
      });
      if (!conversation) {
        throw new ForbiddenException("You are not part of this conversation.");
      }
    } else {
      conversation = await this.prisma.conversations.findUnique({
        where: { id: conversationId },
      });
      if (!conversation) {
        throw new NotFoundException("Conversation not found.");
      }
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    });
    if (!booking) {
      throw new NotFoundException("Booking not found.");
    }
    if (booking.customerId !== conversation.customer_id) {
      throw new ForbiddenException("This booking does not belong to you.");
    }

    const startDate = new Date(booking.rentalStartDate);
    const endDate = new Date(booking.rentalEndDate);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const bookingCode = booking.id.substring(0, 8).toUpperCase();
    const statusLabels: Record<string, string> = {
      pending_confirmation: "Chờ xác nhận",
      confirmed: "Đã xác nhận",
      awaiting_payment: "Chờ thanh toán",
      paid: "Đã thanh toán",
      preparing: "Đang chuẩn bị",
      ready_for_pickup: "Sẵn sàng",
      delivering: "Đang giao",
      renting: "Đang thuê",
      returned: "Đã trả",
      inspection_pending: "Chờ kiểm tra",
      completed: "Hoàn thành",
      cancelled: "Đã hủy",
      rejected: "Từ chối",
      overdue: "Quá hạn",
      draft: "Nháp",
    };
    const statusLabel = statusLabels[booking.status] ?? booking.status;

    const detailUrl = role === "customer"
      ? `/booking/success?bookingId=${booking.id}`
      : `/dashboard/staff/booking/${booking.id}`;

    const now = new Date();
    const message = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: userId,
        content: "",
        message_type: "booking_card",
        metadata: {
          topic,
          booking: {
            id: booking.id,
            code: bookingCode,
            status: booking.status,
            statusLabel,
            rentalStartDate: booking.rentalStartDate,
            rentalEndDate: booking.rentalEndDate,
            days,
            itemCount: booking.items.length,
            rentalTotal: Number(booking.rentalTotal),
            depositTotal: Number(booking.depositTotal),
            detailUrl,
          },
        },
      },
    });

    if (role === "customer" && conversation.status === "resolved") {
      await this.prisma.conversations.updateMany({
        where: { id: conversationId, status: "resolved" },
        data: { status: "open", topic, booking_id: bookingId, garment_id: null, customer_last_read_at: now, updated_at: now, reopened_from_resolved: false },
      });
    } else {
      const updateData: Record<string, unknown> = {
        topic,
        booking_id: bookingId,
        garment_id: null,
        updated_at: now,
      };
      if (role === "customer") {
        updateData.customer_last_read_at = now;
        updateData.reopened_from_resolved = false;
      } else {
        updateData.staff_last_read_at = now;
      }

      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: updateData,
      });
    }

    if (typeof this.prisma.messages.findUnique === "function") {
      return this.prisma.messages.findUnique({
        where: { id: message.id },
        include: {
          user_accounts: {
            select: {
              id: true,
              email: true,
              role: true,
              profile: { select: { fullName: true } },
            },
          },
        },
      });
    }

    return message;
  }

  async getOrCreateConversationForCustomer(customerId: string) {
    // Serialize concurrent get-or-create for the same customer (e.g. two browser
    // tabs opening chat at once) so we don't create duplicate conversations.
    const inFlight = this.getOrCreateLocks.get(customerId);
    if (inFlight) {
      return inFlight as ReturnType<ChatService["doGetOrCreateConversationForCustomer"]>;
    }

    const promise = this.doGetOrCreateConversationForCustomer(customerId)
      .finally(() => this.getOrCreateLocks.delete(customerId));
    this.getOrCreateLocks.set(customerId, promise);
    return promise;
  }

  // Staff/manager mở (hoặc tạo) cuộc trò chuyện với một khách cụ thể —
  // dùng cho nút "Nhắn khách xin thông tin chuyển khoản" ở màn duyệt hoàn cọc.
  async getOrCreateConversationWithCustomer(user: AuthenticatedUser, customerId: string) {
    if (user.role === "customer") {
      throw new ForbiddenException("Only staff can open a conversation with a customer.");
    }

    const customer = await this.prisma.userAccount.findUnique({
      where: { id: customerId },
      select: { id: true, role: true, email: true, profile: { select: { fullName: true } } },
    });
    if (!customer || customer.role !== "customer") {
      throw new NotFoundException("Customer not found.");
    }

    const conversation = await this.getOrCreateConversationForCustomer(customerId);
    const lastMessage = conversation.messages.length > 0 ? conversation.messages[conversation.messages.length - 1] : null;

    return {
      id: conversation.id,
      customerId,
      customerName: customer.profile?.fullName ?? customer.email ?? null,
      staffId: conversation.staff_id ?? null,
      staffName: null,
      status: conversation.status,
      updatedAt: conversation.updated_at,
      lastMessage,
      unreadCount: 0,
      topic: conversation.topic ?? "general",
      garmentId: conversation.garment_id ?? null,
      garmentName: null,
      bookingId: conversation.booking_id ?? null,
      reopenedFromResolved: conversation.reopened_from_resolved,
    };
  }

  private async doGetOrCreateConversationForCustomer(customerId: string) {
    const existingConversation = await this.prisma.conversations.findFirst({
      where: { customer_id: customerId },
      include: {
        messages: {
          orderBy: { created_at: "asc" },
        },
      },
    });

    if (existingConversation) {
      return existingConversation;
    }

    return this.prisma.conversations.create({
      data: {
        customer_id: customerId,
      },
      include: {
        messages: {
          orderBy: { created_at: "asc" },
        },
      },
    });
  }

  async sendMessage(userId: string, role: AppRole, conversationId: string, content: string) {
    const trimmed = content?.trim() ?? "";
    if (trimmed.length === 0) {
      throw new ForbiddenException("Message content cannot be empty.");
    }

    if (trimmed.length > 2000) {
      throw new ForbiddenException("Message content exceeds maximum length of 2000 characters.");
    }

    if (trimmed.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === "object" && (parsed as { type?: unknown }).type === "product_card") {
        throw new ForbiddenException("Product cards must be created by server");
      }
    }

    const conversationPromise = role === "customer"
      ? this.findConversationForParticipant(userId, conversationId)
      : (typeof this.prisma.conversations.findUnique === "function"
          ? this.prisma.conversations.findUnique({ where: { id: conversationId } })
          : this.prisma.conversations.findFirst({ where: { id: conversationId } }));

    const messagePromise = this.prisma.messages.create({
      data: { conversation_id: conversationId, sender_id: userId, content },
      ...(typeof this.prisma.messages.findUnique === "function"
        ? { include: { user_accounts: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } } } }
        : {}),
    });

    const [conversation, message] = await Promise.all([conversationPromise, messagePromise]);

    if (!conversation) {
      throw role === "customer"
        ? new ForbiddenException("You are not part of this conversation.")
        : new NotFoundException("Conversation not found.");
    }
    if (role === "staff" && conversation.staff_id !== userId) {
      throw new ForbiddenException("Only the assigned staff can send messages in this conversation.");
    }

    const now = new Date();
    const updateData: Record<string, unknown> =
      role === "customer" && conversation.status === "resolved"
        ? { status: "open", staff_id: null, customer_last_read_at: now, updated_at: now }
        : { ...(role === "customer" ? { customer_last_read_at: now } : { staff_last_read_at: now }), updated_at: now };

    if (role === "customer") {
      updateData.reopened_from_resolved = false;
    }

    if (role === "customer" && conversation.status === "resolved") {
      await this.prisma.conversations.updateMany({ where: { id: conversationId, status: "resolved" }, data: updateData });
    } else {
      await this.prisma.conversations.update({ where: { id: conversationId }, data: updateData });
    }

    return message;
  }

  async maybeAutoReply(
    conversationId: string,
    messageContent: string,
    hasOnlineStaff: boolean,
    messageType?: string,
  ): Promise<messages[]> {
    //console.log("maybeAutoReply", conversationId, messageContent, "onlineStaff?", hasOnlineStaff);
    if (hasOnlineStaff) {
      //console.log("→ skip: hasOnlineStaff", hasOnlineStaff);
      return [];
    }
    if (messageType !== "product_card" && messageType !== "booking_card") {
      // Greetings/thanks should bypass QUESTION_KEYWORDS (they're not questions but trigger hardcoded reply)
      const isGreetingOrThanks = /(?:^|(?<=\s))(chào|hello|hi|hí|hê?lô|alo)(?=\s|$|[.,;:!?])/i.test(messageContent) ||
        /(cảm ơn|cám ơn|thanks|thank you)/i.test(messageContent);
      if (!isGreetingOrThanks) {
        const match = QUESTION_KEYWORDS.test(messageContent);
        //console.log("→ QUESTION_KEYWORDS test:", match);
        if (!match) return [];
      }
    }

    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
    });
    //console.log("→ conv staff_id:", conversation?.staff_id);
    if (!conversation || conversation.staff_id !== null) return [];

    // Debounce: reset timer each time customer sends, only fire after AI_DEBOUNCE_MS of silence
    return new Promise<messages[]>((resolve) => {
      const existing = this.aiDebounceMap.get(conversationId);
      if (existing) clearTimeout(existing);

      const timeout = setTimeout(async () => {
        this.aiDebounceMap.delete(conversationId);
        //console.log("→ DEBOUNCE FIRE, calling performAutoReply");
        const result = await this.performAutoReply(conversationId, messageContent, conversation);
        //console.log("→ performAutoReply done, topics:", result.length);
        resolve(result);
      }, AI_DEBOUNCE_MS);

      this.aiDebounceMap.set(conversationId, timeout);
    });
  }

  private async performAutoReply(
    conversationId: string,
    messageContent: string,
    conversation: { customer_id: string; staff_id: string | null },
  ): Promise<messages[]> {
    const recentMessages = await this.prisma.messages.findMany({
      where: {
        conversation_id: conversationId,
        deleted_at: null,
        message_type: { in: ["text", "product_card"] },
      },
      orderBy: { created_at: "desc" },
      take: 10,
    });

    const history = recentMessages.map((m) => {
      let content = m.content;
      if (m.message_type === "product_card" && m.metadata && typeof m.metadata === "object") {
        const product = (m.metadata as Record<string, unknown>).product as Record<string, unknown> | undefined;
        if (product) {
          const price = typeof product.price === "number" ? product.price.toLocaleString() : "";
          content = `[Đã gửi sản phẩm] ${product.name ?? ""} | Size: ${product.size ?? "N/A"} | Giá: ${price}đ/ngày`;
        }
      }
      return {
        role: (m.sender_id === conversation.customer_id ? "customer" : m.sender_type === "ai" ? "ai" : "staff") as "customer" | "staff" | "ai",
        content,
        createdAt: m.created_at.toISOString(),
      };
    });

    let result;
    try {
      result = await this.aiService.productAdvisor({ message: messageContent, history }, true);
    } catch {
      return [];
    }

    const data = result.data;
    if (!data || !Array.isArray(data.topics) || data.topics.length === 0) return [];

    const reply = data.topics[0]?.assistantReply;
    if (!reply) return [];

    const now = new Date();
    const conversationAgain = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { staff_id: true },
    });
    if (conversationAgain?.staff_id !== null) return [];

    const createdMessages: messages[] = [];

    // Create text reply
    const textMsg = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: AI_USER_ID,
        content: reply,
        message_type: "text",
        sender_type: "ai",
      },
    });
    createdMessages.push(textMsg);

    // Create product cards for recommended products (max 3)
    const productIds = data.topics[0]?.recommendedProductIds ?? [];
    const cardIds = productIds.slice(0, 3);
    if (cardIds.length > 0) {
      const garments = await this.prisma.garment.findMany({
        where: { id: { in: cardIds } },
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          garment_sizes: { where: { is_active: true }, take: 1 },
        },
      });

      for (const g of garments) {
        const DEFAULT_IMAGE = "https://dep.com.vn/wp-content/uploads/2020/11/ao-dai-9.jpg";
        const imageUrl = g.images[0]?.imageUrl || DEFAULT_IMAGE;
        const sizeLabel = g.garment_sizes[0]?.size_label ?? null;
        const dailyPrice = g.garment_sizes[0]?.daily_price ?? 0;
        const detailUrl = `/catalog/${g.garment_sizes[0]?.id ?? g.id}`;

        const card = await this.prisma.messages.create({
          data: {
            conversation_id: conversationId,
            sender_id: AI_USER_ID,
            content: "",
            message_type: "product_card",
            sender_type: "ai",
            metadata: {
              product: {
                id: g.id,
                name: g.name,
                image: imageUrl,
                size: sizeLabel,
                price: Number(dailyPrice),
                detailUrl,
              },
            },
          },
        });
        createdMessages.push(card);
      }
    }

    await this.prisma.conversations.update({
      where: { id: conversationId },
      data: { updated_at: now },
    });

    return this.prisma.messages.findMany({
      where: { id: { in: createdMessages.map((m) => m.id) } },
      orderBy: { created_at: "asc" },
      include: {
        user_accounts: {
          select: {
            id: true,
            email: true,
            role: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException("Message not found.");
    }

    // Only the sender can delete their own message
    if (message.sender_id !== userId) {
      throw new ForbiddenException("You can only delete your own messages.");
    }

    const now = new Date();
    await this.prisma.messages.update({
      where: { id: messageId },
      data: { deleted_at: now, deleted_by: userId },
    });

    return { id: messageId, conversation_id: message.conversation_id, deleted_at: now, deleted_by: userId };
  }

  async assignStaffToConversationIfEmpty(conversationId: string, staffId: string) {
    await this.prisma.conversations.updateMany({
      where: { id: conversationId, staff_id: null, status: "open" },
      data: { staff_id: staffId, updated_at: new Date() },
    });

    return this.getConversationById(conversationId);
  }

  async reopenConversation(conversationId: string, staffId: string) {
    const result = await this.prisma.conversations.updateMany({
      where: { id: conversationId, staff_id: staffId },
      data: {
        status: "open",
        reopened_from_resolved: true,
        staff_last_read_at: new Date(),
        updated_at: new Date(),
      },
    });

    if (result.count === 0) {
      const conv = await this.getConversationById(conversationId);
      if (conv.staff_id && conv.staff_id !== staffId) {
        throw new ForbiddenException("Only the original staff can reopen this conversation.");
      }
    }

    return this.getConversationById(conversationId);
  }

  async releaseStaffAssignment(conversationId: string, staffId?: string) {
    await this.prisma.conversations.updateMany({
      where: {
        id: conversationId,
        ...(staffId ? { staff_id: staffId } : {}),
      },
      data: { staff_id: null, updated_at: new Date() },
    });

    return this.getConversationById(conversationId);
  }

  async releaseStaleStaffAssignments() {
    // Clear staff_id only for conversations where last message is NOT from staff
    // (Cần trả lời → Chờ tiếp nhận). Keep staff_id for Chờ phản hồi (last message from staff).
    const conversations = await this.prisma.conversations.findMany({
      where: { status: "open", staff_id: { not: null }, reopened_from_resolved: false },
      select: {
        id: true,
        staff_id: true,
        messages: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { sender_id: true },
        },
      },
    });

    const toRelease = conversations
      .filter((c) => {
        const lastMsg = c.messages[0] ?? null;
        return !lastMsg || lastMsg.sender_id !== c.staff_id;
      })
      .map((c) => c.id);

    if (toRelease.length > 0) {
      await this.prisma.conversations.updateMany({
        where: { id: { in: toRelease } },
        data: { staff_id: null, updated_at: new Date() },
      });
    }
  }

  //async releaseStaffAssignmentsByStaffId(staffId: string) {
    // const result = await this.prisma.conversations.updateMany({
    //   where: { status: "open", staff_id: staffId },
    //   data: { staff_id: null, updated_at: new Date() },
    // });
    //console.log("releaseStaffAssignmentsByStaffId", staffId, "updated:", result.count);
  //}

  async autoReplyReleasedConversations(staffId: string, hasOnlineStaff = false): Promise<Array<{ conversationId: string; messages: messages[] }>> {
    const conversations = await this.prisma.conversations.findMany({
      where: { status: "open", staff_id: staffId },
      select: { id: true, customer_id: true },
    });
    if (conversations.length === 0) return [];

    await this.prisma.conversations.updateMany({
      where: { id: { in: conversations.map(c => c.id) } },
      data: { staff_id: null, updated_at: new Date() },
    });
    //console.log("autoReplyReleasedConversations released", conversations.length, "conversations");

    const results: Array<{ conversationId: string; messages: messages[] }> = [];
    for (const conv of conversations) {
      const lastMsg = await this.prisma.messages.findFirst({
        where: {
          conversation_id: conv.id,
          deleted_at: null,
          sender_id: conv.customer_id,
        },
        orderBy: { created_at: "desc" },
        select: { content: true, message_type: true, created_at: true },
      });
      if (!lastMsg) continue;

      const lastAiReply = await this.prisma.messages.findFirst({
        where: {
          conversation_id: conv.id,
          deleted_at: null,
          sender_type: "ai",
          created_at: { gt: lastMsg.created_at },
        },
        orderBy: { created_at: "desc" },
        select: { id: true },
      });
      if (lastAiReply) continue;

      const aiMsgs = await this.maybeAutoReply(conv.id, lastMsg.content, hasOnlineStaff, lastMsg.message_type);
      if (aiMsgs.length > 0) {
        results.push({ conversationId: conv.id, messages: aiMsgs });
      }
    }
    return results;
  }

  async resolveAllReopenedConversations() {
    await this.prisma.conversations.updateMany({
      where: { reopened_from_resolved: true },
      data: { status: "resolved", reopened_from_resolved: false, updated_at: new Date() },
    });
  }

  async resolveConversation(conversationId: string, staffId: string) {
    const conversation = await this.findConversationForParticipant(staffId, conversationId);
    if (!conversation || conversation.staff_id !== staffId) {
      throw new ForbiddenException("Only the assigned staff can resolve this conversation.");
    }

    return this.prisma.conversations.update({
      where: { id: conversationId },
      data: {
        staff_last_read_at: new Date(),
        status: "resolved",
        reopened_from_resolved: false,
        topic: "general",
        garment_id: null,
        booking_id: null,
        updated_at: new Date(),
      },
    });
  }

  async releaseStaffAssignmentIfStale(conversationId: string, staffId: string): Promise<boolean> {
    // Only release if last message is NOT from the assigned staff (not Chờ phản hồi)
    const lastMsg = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    if (lastMsg && lastMsg.sender_id === staffId) return false;
    await this.releaseStaffAssignment(conversationId, staffId);
    return true;
  }

  async releaseConversationLock(conversationId: string, staffId: string) {
    const conversation = await this.getConversationById(conversationId);
    if (conversation.reopened_from_resolved) {
      await this.resolveConversation(conversationId, staffId);
      return "resolved";
    }
    // Check last message sender
    const lastMsg = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    // If last message is from the same staff → Chờ phản hồi → keep assignment
    if (lastMsg && lastMsg.sender_id === staffId) {
      return "open";
    }
    // Otherwise → clear staff_id → về Chờ tiếp nhận
    await this.releaseStaffAssignment(conversationId, staffId);
    return "open";
  }

  async markConversationRead(userId: string, role: AppRole, conversationId: string) {
    const conversation = await this.findConversationForParticipant(userId, conversationId);
    if (!conversation) {
      throw new ForbiddenException("You are not part of this conversation.");
    }

    const updateData = role === "customer"
      ? { customer_last_read_at: new Date() }
      : { staff_last_read_at: new Date() };

    return this.prisma.conversations.update({
      where: { id: conversationId },
      data: updateData,
    });
  }

  async getMessages(user: AuthenticatedUser, conversationId: string, before?: string, limit = 15) {
    await this.ensureCustomerOrStaffParticipant(user, conversationId);

    const fetchMessages = async (where: Record<string, unknown>) => {
      const msgs = await this.prisma.messages.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        include: {
          user_accounts: {
            select: {
              id: true,
              email: true,
              role: true,
              profile: { select: { fullName: true } },
            },
          },
        },
      });
      return Promise.all(msgs.reverse().map((m) => this.attachSignedUrl(m)));
    };

    if (!before) {
      return fetchMessages({ conversation_id: conversationId });
    }

    const beforeMessage = typeof this.prisma.messages.findUnique === "function"
      ? await this.prisma.messages.findUnique({
          where: { id: before },
          select: { created_at: true },
        })
      : await this.prisma.messages.findFirst({
          where: { id: before },
          select: { created_at: true },
        });

    if (!beforeMessage) {
      throw new NotFoundException("Cursor message not found.");
    }

    return fetchMessages({
      conversation_id: conversationId,
      created_at: { lt: beforeMessage.created_at },
    } as Record<string, unknown>);
  }

  async listConversations(user: AuthenticatedUser, tab?: string) {
    const isCustomer = user.role === "customer";

    let where: Record<string, unknown> = {};
    if (isCustomer) {
      where = { customer_id: user.id };
    } else if (tab) {
      switch (tab) {
        case "unassigned":
          where = { staff_id: null, status: "open" };
          break;
        case "needs_reply":
          where = { staff_id: user.id, status: { not: "resolved" } };
          break;
        case "awaiting_reply":
          where = { staff_id: user.id, status: { not: "resolved" } };
          break;
        case "resolved":
          where = { status: "resolved" };
          break;
      }
    }

    const conversations = await this.prisma.conversations.findMany({
      where,
      orderBy: { updated_at: "desc" },
      include: {
        messages: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: {
            id: true,
            content: true,
            sender_id: true,
            sender_type: true,
            created_at: true,
            message_type: true,
            metadata: true,
            deleted_at: true,
          },
        },
        user_accounts_conversations_customer_idTouser_accounts: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        user_accounts_conversations_staff_idTouser_accounts: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });

    const filtered = !isCustomer && tab ? conversations.filter((c) => {
      const lastMsg = c.messages[0] ?? null;
      if (tab === "unassigned") return lastMsg != null;
      if (tab === "needs_reply") return !lastMsg || lastMsg.sender_id !== user.id;
      if (tab === "awaiting_reply") return lastMsg && lastMsg.sender_id === user.id;
      return true;
    }) : conversations;

    return Promise.all(filtered.map(async (conversation) => {
      const lastMessage = conversation.messages[0] ?? null;

      // After
      let unreadCount: number;

      if (user.role === "customer") {
        // Customer: staff messages since customer last read
        const lastReadAt = conversation.customer_last_read_at;
        unreadCount = await this.prisma.messages.count({
          where: {
            conversation_id: conversation.id,
            sender_id: { not: user.id },
            created_at: { gt: lastReadAt ?? new Date(0) },
          },
        });
      } else {
        // Staff: customer messages since the LATER of
        //   (a) staff_last_read_at  — explicit read/resolve action
        //   (b) last message sent BY staff — implicit "we replied" marker
        const lastStaffMessage = await this.prisma.messages.findFirst({
          where: {
            conversation_id: conversation.id,
            sender_id: { not: conversation.customer_id }, // sent by any staff
          },
          orderBy: { created_at: "desc" },
          select: { created_at: true },
        });

        const readAt = conversation.staff_last_read_at;
        const repliedAt = lastStaffMessage?.created_at ?? null;

        // Pick the more recent of the two timestamps
        let baseline: Date | null = null;
        if (readAt && repliedAt) {
          baseline = readAt > repliedAt ? readAt : repliedAt;
        } else {
          baseline = readAt ?? repliedAt;
        }

        unreadCount = await this.prisma.messages.count({
          where: {
            conversation_id: conversation.id,
            sender_id: conversation.customer_id, // only customer messages
            ...(baseline ? { created_at: { gt: baseline } } : {}),
          },
        });
      }

      // Resolve garment name when context is product_advice
      let garmentName: string | null = null;
      if (conversation.garment_id) {
        const garment = await this.prisma.garment.findUnique({
          where: { id: conversation.garment_id },
          select: { name: true },
        });
        garmentName = garment?.name ?? null;
      }

      return {
        id: conversation.id,
        customerId: conversation.customer_id,
        customerName:
          conversation.user_accounts_conversations_customer_idTouser_accounts
            ?.profile?.fullName ??
          conversation.user_accounts_conversations_customer_idTouser_accounts
            ?.email ??
          null,
        staffId: conversation.staff_id,
        staffName:
          conversation.user_accounts_conversations_staff_idTouser_accounts
            ?.profile?.fullName ??
          conversation.user_accounts_conversations_staff_idTouser_accounts
            ?.email ??
          null,
        status: conversation.status,
        updatedAt: conversation.updated_at,
        lastMessage,
        unreadCount,
        topic: conversation.topic ?? "general",
        garmentId: conversation.garment_id ?? null,
        garmentName,
        bookingId: conversation.booking_id ?? null,
        reopenedFromResolved: conversation.reopened_from_resolved,
      };
    })
    );
  }

  async getConversationCounts(user: AuthenticatedUser) {
    const all = await this.prisma.conversations.findMany({
      where: user.role === "customer" ? { customer_id: user.id } : undefined,
      select: {
        staff_id: true,
        status: true,
        messages: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { sender_id: true },
        },
      },
    });

    let needsReply = 0;
    let awaitingReply = 0;
    let unassigned = 0;
    let resolved = 0;

    for (const c of all) {
      const lastMsg = c.messages[0] ?? null;
      if (c.status === "resolved") {
        resolved++;
      } else if (c.staff_id === null) {
        if (lastMsg != null) unassigned++;
      } else if (c.staff_id === user.id) {
        if (!lastMsg || lastMsg.sender_id !== user.id) {
          needsReply++;
        } else {
          awaitingReply++;
        }
      }
    }

    return { needsReply, awaitingReply, unassigned, resolved };
  }

  async getConversationById(conversationId: string) {
    const conversation = typeof this.prisma.conversations.findUnique === "function"
      ? await this.prisma.conversations.findUnique({ where: { id: conversationId } })
      : await this.prisma.conversations.findFirst({ where: { id: conversationId } });

    if (!conversation) {
      throw new NotFoundException("Conversation not found.");
    }

    return conversation;
  }

  async ensureCustomerOrStaffParticipant(user: AuthenticatedUser, conversationId: string) {
    const conversation = typeof this.prisma.conversations.findUnique === "function"
      ? await this.prisma.conversations.findUnique({ where: { id: conversationId } })
      : await this.prisma.conversations.findFirst({ where: { id: conversationId } });

    if (!conversation) {
      throw new NotFoundException("Conversation not found.");
    }

    if (user.role === "customer" && conversation.customer_id !== user.id) {
      throw new ForbiddenException("You are not part of this conversation.");
    }

    return conversation;
  }

  private async findConversationForParticipant(userId: string, conversationId: string) {
    return this.prisma.conversations.findFirst({
      where: {
        id: conversationId,
        OR: [
          { customer_id: userId },
          { staff_id: userId },
        ],
      },
    });
  }

  async uploadFile(
    userId: string,
    role: AppRole,
    conversationId: string,
    file: Express.Multer.File,
  ) {
    let conversation;
    if (role === "customer") {
      conversation = await this.prisma.conversations.findFirst({
        where: { id: conversationId, customer_id: userId },
      });
      if (!conversation) throw new ForbiddenException("You are not part of this conversation.");
    } else {
      conversation = await this.prisma.conversations.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new NotFoundException("Conversation not found.");
    }

    const bucket = process.env.SUPABASE_CHAT_BUCKET?.trim() || "chat-attachments";

    const mimeType = file.mimetype;
    let uploadBuffer = file.buffer;
    let uploadMimeType = mimeType;
    let ext = mimeType.split("/").pop() || "bin";

    if (mimeType.startsWith("image/") && !mimeType.includes("svg")) {
      try {
        uploadBuffer = await sharp(file.buffer)
          .rotate()
          .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 4 })
          .toBuffer();
        uploadMimeType = "image/webp";
        ext = "webp";
      } catch {
        // Fallback to original buffer
      }
    }

    const objectPath = `${conversationId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await this.getSupabaseStorage()
      .from(bucket)
      .upload(objectPath, uploadBuffer, {
        contentType: uploadMimeType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const messageType = mimeType.startsWith("video/") ? "video" : "image";

    const meta = {
      bucket,
      path: objectPath,
      mimetype: uploadMimeType,
      size: uploadBuffer.length,
    };

    const now = new Date();
    const message = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: userId,
        content: "",
        message_type: messageType,
        metadata: meta,
      },
    });

    const updateData: Record<string, unknown> = { updated_at: now };
    if (role === "customer") {
      updateData.customer_last_read_at = now;
      updateData.reopened_from_resolved = false;
      if (conversation.status === "resolved") { updateData.status = "open"; updateData.staff_id = null; }
    } else {
      updateData.staff_last_read_at = now;
    }
    await this.prisma.conversations.update({
      where: { id: conversationId },
      data: updateData,
    });

    const fullMsg = await this.prisma.messages.findUnique({
      where: { id: message.id },
      include: {
        user_accounts: {
          select: {
            id: true,
            email: true,
            role: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });
    return fullMsg ? this.attachSignedUrl(fullMsg) : null;
  }

  private async attachSignedUrl<T extends { message_type?: string | null; metadata?: unknown }>(msg: T): Promise<T> {
    if (msg.message_type === "image" || msg.message_type === "video") {
      const meta = msg.metadata as Record<string, unknown> | null;
      if (meta?.bucket && meta?.path) {
        meta.url = await this.generateSignedUrl(meta.bucket as string, meta.path as string);
      }
    }
    return msg;
  }

  private getSupabaseStorage() {
    const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceRoleKey) throw new Error("Supabase not configured");
    return createClient(baseUrl, serviceRoleKey).storage;
  }

  private async generateSignedUrl(bucket: string, path: string): Promise<string | null> {
    try {
      const { data, error } = await this.getSupabaseStorage()
        .from(bucket)
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (error) {
        return null;
      }
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

}
