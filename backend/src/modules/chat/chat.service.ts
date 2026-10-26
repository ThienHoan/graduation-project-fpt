import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma, type AppRole, type messages } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AiService } from "../ai/ai.service";
import { RedisService } from "../redis/redis.service";
import sharp from "sharp";
import {
  normalizeTrigger,
  planAutoReply,
  type AutoReplyTrigger,
} from "./auto-reply-policy";

const AI_USER_ID = "00000000-0000-0000-0000-000000000000";
// Gộp các tin nhắn liên tiếp của khách thành 1 lượt trả lời duy nhất.
const AI_DEBOUNCE_MS = 1500;
// Staff được coi là đang xử lý hội thoại nếu họ đã gửi tin trong khoảng này.
// Quá khoảng này thì AI tự trả lời lại, tránh việc hội thoại bị "kẹt" staff_id.
const STAFF_ACTIVE_TTL_MS = 15 * 60 * 1000;
const AI_FALLBACK_REPLY =
  "Em đã ghi nhận câu hỏi của bạn. Nhân viên sẽ phản hồi bạn trong ít phút ạ.";
const AI_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;
// Khoá phân tán quanh một lượt auto-reply. TTL đủ dài để phủ cả timeout model
// chính + model dự phòng, nhưng vẫn tự mở nếu instance giữ lock bị crash.
const AI_AUTO_REPLY_LOCK_TTL_SECONDS = 90;

type PendingAutoReply = {
  timer: NodeJS.Timeout;
  latestTrigger: AutoReplyTrigger;
  waiters: Array<(result: messages[]) => void>;
  requireUnassigned: boolean;
  shouldAbort?: () => boolean;
};

type AutoReplyOptions = {
  /** Gọi ngay khi tin nhắn được chấp nhận xử lý (dùng để bật typing indicator). */
  onAccepted?: () => void;
  /**
   * Chỉ trả lời nếu hội thoại vẫn chưa có staff nhận.
   * Dùng cho auto-reply sau khi lock hết hạn: staff khác có thể đã nhận
   * trong lúc chờ debounce/model chạy.
   */
  requireUnassigned?: boolean;
  /**
   * Kiểm tra lại ngay trước khi gọi model/ghi DB. Dùng cho trường hợp staff
   * vừa nhận hội thoại nhưng chưa kịp gửi tin: AI phải dừng, không chen vào.
   */
  shouldAbort?: () => boolean;
};

type ReleaseConversationLockResult = {
  status: "open" | "resolved";
  /** true khi staff_id thực sự được trả về null. */
  released: boolean;
};

export type StaffConversationTab =
  | "unassigned"
  | "resolved"
  | "waiting_customer"
  | "awaiting_reply"
  | "needs_reply";

/**
 * Kiểm tra staff còn giữ lock trả lời hay không. Lock nằm trong ChatGateway
 * (theo process), nên controller truyền hàm này xuống service để việc phân
 * loại tab và đếm số lượng dùng chung một nguồn sự thật.
 */
export type StaffLockChecker = (conversationId: string, staffId: string) => boolean;

const NO_ACTIVE_STAFF_LOCK: StaffLockChecker = () => false;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly aiDebounceMap = new Map<string, PendingAutoReply>();
  private readonly aiInFlight = new Set<string>();
  private readonly getOrCreateLocks = new Map<string, Promise<unknown>>();
  private readonly instanceId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    @Optional() private readonly redisService?: RedisService,
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
      // Khách cần thấy số tin nhắn chưa đọc ngay khi mở app, kể cả khi
      // bubble chat đang đóng. Đếm các tin không phải do khách gửi
      // (staff/AI) sau lần đọc gần nhất.
      const unreadCount = await this.prisma.messages.count({
        where: {
          conversation_id: existingConversation.id,
          sender_id: { not: customerId },
          created_at: { gt: existingConversation.customer_last_read_at ?? new Date(0) },
        },
      });
      return { ...existingConversation, unreadCount };
    }

    const created = await this.prisma.conversations.create({
      data: {
        customer_id: customerId,
      },
      include: {
        messages: {
          orderBy: { created_at: "asc" },
        },
      },
    });

    return { ...created, unreadCount: 0 };
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

    // Kiểm tra quyền trước khi tạo tin nhắn. Trước đây message được create song song
    // với check assignment nên staff không được phép vẫn có thể để lại một row rác.
    const conversation = await conversationPromise;

    if (!conversation) {
      throw role === "customer"
        ? new ForbiddenException("You are not part of this conversation.")
        : new NotFoundException("Conversation not found.");
    }
    if (role === "staff" && conversation.staff_id !== userId) {
      throw new ForbiddenException("Only the assigned staff can send messages in this conversation.");
    }

    const message = await this.prisma.messages.create({
      data: { conversation_id: conversationId, sender_id: userId, content },
      ...(typeof this.prisma.messages.findUnique === "function"
        ? { include: { user_accounts: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } } } }
        : {}),
    });

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
    input: AutoReplyTrigger | string,
    options?: AutoReplyOptions,
  ): Promise<messages[]> {
    const trigger = normalizeTrigger(input);
    const requireUnassigned = options?.requireUnassigned ?? false;
    if (options?.shouldAbort?.()) return [];

    // Tin rỗng/emoji/câu xác nhận ngắn không cần chạm DB.
    // (Policy cho text không phụ thuộc topic hội thoại.)
    const preliminary = planAutoReply(trigger);
    if (preliminary.kind === "skip") {
      this.logger.debug(`Skip auto-reply for ${conversationId}: ${preliminary.reason}`);
      return [];
    }

    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { id: true, customer_id: true, staff_id: true, status: true, topic: true },
    });
    if (!conversation || conversation.status === "resolved") return [];
    if (requireUnassigned && (conversation.status !== "open" || conversation.staff_id !== null)) return [];

    // Chỉ nhường cho staff khi chính staff của hội thoại này vừa trả lời.
    // Không dùng cờ "có staff online" toàn cục: staff mở dashboard ở tab khác
    // không được làm AI im lặng với mọi khách hàng.
    if (await this.isStaffActivelyHandling(conversation)) return [];

    // Tính lại policy với topic hội thoại (media trong hội thoại đơn hàng/
    // khiếu nại phải chuyển staff thay vì chỉ nhận ảnh).
    const plan = planAutoReply(trigger, conversation.topic);
    if (plan.kind === "skip") {
      this.logger.debug(`Skip auto-reply for ${conversationId}: ${plan.reason}`);
      return [];
    }

    options?.onAccepted?.();
    return this.enqueueAutoReply(conversationId, trigger, requireUnassigned, options?.shouldAbort);
  }

  /**
   * Gộp các tin khách gửi liên tiếp trong AI_DEBOUNCE_MS thành một lượt trả lời.
   * Mọi caller (kể cả autoReplyReleasedConversations) đều nhận cùng kết quả,
   * tránh promise bị treo khi timer bị reset.
   */
  private enqueueAutoReply(
    conversationId: string,
    trigger: AutoReplyTrigger,
    requireUnassigned = false,
    shouldAbort?: () => boolean,
  ): Promise<messages[]> {
    return new Promise<messages[]>((resolve) => {
      const existing = this.aiDebounceMap.get(conversationId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.latestTrigger = trigger;
        existing.waiters.push(resolve);
        // Nếu một trong các trigger yêu cầu hội thoại phải còn trống,
        // giữ yêu cầu chặt hơn cho lượt gộp này.
        existing.requireUnassigned = existing.requireUnassigned || requireUnassigned;
        existing.shouldAbort = existing.shouldAbort ?? shouldAbort;
        existing.timer = setTimeout(() => void this.fireAutoReply(conversationId), AI_DEBOUNCE_MS);
        return;
      }

      const entry: PendingAutoReply = {
        latestTrigger: trigger,
        waiters: [resolve],
        requireUnassigned,
        shouldAbort,
        timer: setTimeout(() => void this.fireAutoReply(conversationId), AI_DEBOUNCE_MS),
      };
      this.aiDebounceMap.set(conversationId, entry);
    });
  }

  private async fireAutoReply(conversationId: string) {
    const entry = this.aiDebounceMap.get(conversationId);
    if (!entry) return;
    this.aiDebounceMap.delete(conversationId);

    let result: messages[] = [];
    try {
      result = await this.performAutoReply(
        conversationId,
        entry.latestTrigger,
        entry.requireUnassigned,
        entry.shouldAbort,
      );
    } catch (error) {
      this.logger.error(
        `Auto-reply failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      for (const resolve of entry.waiters) resolve(result);
    }
  }

  /**
   * Staff chỉ "giữ" hội thoại trong STAFF_ACTIVE_TTL_MS kể từ tin nhắn gần nhất.
   * Hết hạn thì AI trả lời lại, dù staff_id vẫn còn (tránh hội thoại chết).
   */
  private async isStaffActivelyHandling(conversation: {
    id: string;
    customer_id: string;
    staff_id: string | null;
  }): Promise<boolean> {
    if (!conversation.staff_id) return false;

    const lastStaffMessage = await this.prisma.messages.findFirst({
      where: {
        conversation_id: conversation.id,
        sender_id: { not: conversation.customer_id },
        sender_type: { not: "ai" },
        deleted_at: null,
      },
      orderBy: { created_at: "desc" },
      select: { created_at: true },
    });

    if (!lastStaffMessage) return false;
    return Date.now() - lastStaffMessage.created_at.getTime() < STAFF_ACTIVE_TTL_MS;
  }

  private async performAutoReply(
    conversationId: string,
    trigger: AutoReplyTrigger,
    requireUnassigned = false,
    shouldAbort?: () => boolean,
  ): Promise<messages[]> {
    if (shouldAbort?.()) return [];

    // Fast path trong cùng process: tránh cả việc gọi Redis khi đã có lượt chạy.
    if (this.aiInFlight.has(conversationId)) return [];

    // Khoá phân tán: khi chạy nhiều instance, chỉ một instance được gọi model
    // và ghi câu trả lời cho mỗi hội thoại. Nếu Redis không bật, RedisService
    // tự fallback sang bộ nhớ (tương đương khoá theo process).
    const lockKey = `chat:auto-reply:lock:${conversationId}`;
    const lockValue = this.instanceId;
    const acquired = this.redisService
      ? await this.redisService.setNx(lockKey, lockValue, AI_AUTO_REPLY_LOCK_TTL_SECONDS)
      : true;
    if (!acquired) {
      this.logger.debug(
        `Skip auto-reply for ${conversationId}: another instance is already replying`,
      );
      return [];
    }

    this.aiInFlight.add(conversationId);
    try {
      return await this.doPerformAutoReply(conversationId, trigger, requireUnassigned, shouldAbort);
    } finally {
      this.aiInFlight.delete(conversationId);
      if (this.redisService) {
        await this.redisService.delIfValue(lockKey, lockValue).catch(() => undefined);
      }
    }
  }

  private async doPerformAutoReply(
    conversationId: string,
    trigger: AutoReplyTrigger,
    requireUnassigned = false,
    shouldAbort?: () => boolean,
  ): Promise<messages[]> {
    if (shouldAbort?.()) return [];

    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { id: true, customer_id: true, staff_id: true, status: true, topic: true },
    });
    if (!conversation || conversation.status === "resolved") return [];
    if (requireUnassigned && (conversation.status !== "open" || conversation.staff_id !== null)) return [];
    if (await this.isStaffActivelyHandling(conversation)) return [];

    // Idempotency: chỉ trả lời khi tin cuối vẫn là của khách.
    // Nếu staff/AI vừa trả lời trong lúc debounce thì bỏ qua.
    const latest = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    if (!latest || latest.sender_id !== conversation.customer_id) return [];

    // Tính lại plan tại thời điểm gửi: topic hội thoại có thể đã đổi
    // (ví dụ khách vừa gửi booking card khiếu nại).
    const plan = planAutoReply(trigger, conversation.topic);
    if (plan.kind === "skip") return [];

    if (plan.kind === "canned") {
      this.logger.debug(`Canned auto-reply for ${conversationId}: ${plan.reason}`);
      return this.persistAiReply(
        conversationId,
        conversation.customer_id,
        plan.reply,
        [],
        { auto_reply: plan.reason },
        requireUnassigned,
        shouldAbort,
      );
    }

    const history = await this.buildAutoReplyHistory(
      conversationId,
      conversation.customer_id,
      trigger.messageId,
    );

    let result;
    try {
      result = await this.aiService.productAdvisor({ message: plan.request, history }, true);
    } catch (error) {
      this.logger.warn(
        `AI advisor error for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.createAutoReplyFallback(
        conversationId,
        conversation.customer_id,
        requireUnassigned,
        shouldAbort,
      );
    }

    const topics = result.data?.topics ?? [];
    const replyTopic = topics.find(
      (t) => typeof t.assistantReply === "string" && t.assistantReply.trim().length > 0,
    );
    if (!replyTopic) {
      this.logger.warn(`AI advisor returned no reply for conversation ${conversationId}`);
      return this.createAutoReplyFallback(
        conversationId,
        conversation.customer_id,
        requireUnassigned,
        shouldAbort,
      );
    }

    return this.persistAiReply(
      conversationId,
      conversation.customer_id,
      replyTopic.assistantReply.trim(),
      replyTopic.recommendedProductIds ?? [],
      undefined,
      requireUnassigned,
      shouldAbort,
    );
  }

  /**
   * Lịch sử gửi kèm cho model. Bỏ tin đang được trả lời để tránh lặp nội dung,
   * và mô tả card/ảnh/video thành chữ để model hiểu ngữ cảnh.
   */
  private async buildAutoReplyHistory(
    conversationId: string,
    customerId: string,
    excludeMessageId?: string,
  ): Promise<Array<{ role: "customer" | "staff" | "ai"; content: string; createdAt: string }>> {
    const recentMessages = await this.prisma.messages.findMany({
      where: {
        conversation_id: conversationId,
        deleted_at: null,
        message_type: { in: ["text", "product_card", "booking_card", "image", "video"] },
      },
      orderBy: { created_at: "desc" },
      take: 15,
    });

    return recentMessages
      .filter((m) => !excludeMessageId || m.id !== excludeMessageId)
      .map((m) => ({
        role: (m.sender_id === customerId ? "customer" : m.sender_type === "ai" ? "ai" : "staff") as
          | "customer"
          | "staff"
          | "ai",
        content: this.describeMessageForHistory(m),
        createdAt: m.created_at.toISOString(),
      }));
  }

  private describeMessageForHistory(message: messages): string {
    const metadata = (message.metadata ?? null) as Record<string, unknown> | null;

    if (message.message_type === "product_card") {
      const product = (metadata?.product ?? null) as Record<string, unknown> | null;
      const price = typeof product?.price === "number" ? product.price.toLocaleString("vi-VN") : "";
      return `[Thẻ sản phẩm] ${product?.name ?? ""} | Size: ${product?.size ?? "N/A"}${price ? ` | Giá: ${price}đ/ngày` : ""}`;
    }

    if (message.message_type === "booking_card") {
      const booking = (metadata?.booking ?? null) as Record<string, unknown> | null;
      const start = typeof booking?.rentalStartDate === "string" ? booking.rentalStartDate.slice(0, 10) : "";
      const end = typeof booking?.rentalEndDate === "string" ? booking.rentalEndDate.slice(0, 10) : "";
      const dates = start && end ? ` | ${start} → ${end}` : "";
      return `[Thẻ đơn hàng] Mã ${booking?.code ?? "?"} | Trạng thái: ${booking?.statusLabel ?? "?"}${dates}`;
    }

    if (message.message_type === "image") return "[Hình ảnh]";
    if (message.message_type === "video") return "[Video]";

    return message.content;
  }

  private async persistAiReply(
    conversationId: string,
    customerId: string,
    reply: string,
    productIds: string[],
    metadata?: Prisma.InputJsonValue,
    requireUnassigned = false,
    shouldAbort?: () => boolean,
  ): Promise<messages[]> {
    if (shouldAbort?.()) return [];

    const now = new Date();
    const conversationAgain = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { status: true, staff_id: true },
    });
    if (!conversationAgain || conversationAgain.status === "resolved") return [];
    if (requireUnassigned && (conversationAgain.status !== "open" || conversationAgain.staff_id !== null)) {
      return [];
    }

    // Staff có thể đã trả lời hoặc vừa nhận hội thoại trong lúc model đang chạy
    // → không gửi reply nữa.
    if (shouldAbort?.()) return [];
    const latestAfterAi = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    if (!latestAfterAi || latestAfterAi.sender_id !== customerId) return [];

    const createdMessages: messages[] = [];

    // Create text reply
    const textMsg = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: AI_USER_ID,
        content: reply,
        message_type: "text",
        sender_type: "ai",
        ...(metadata ? { metadata } : {}),
      },
    });
    createdMessages.push(textMsg);

    // Create product cards for recommended products (max 3)
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

  /**
   * Khi model lỗi/timeout hoặc trả về rỗng, gửi một câu xác nhận thay vì im lặng.
   * Có cooldown để tránh spam khi OpenRouter sập trong thời gian dài.
   */
  private async createAutoReplyFallback(
    conversationId: string,
    customerId: string,
    requireUnassigned = false,
    shouldAbort?: () => boolean,
  ): Promise<messages[]> {
    if (shouldAbort?.()) return [];

    if (requireUnassigned) {
      const conversationAgain = await this.prisma.conversations.findUnique({
        where: { id: conversationId },
        select: { status: true, staff_id: true },
      });
      if (!conversationAgain || conversationAgain.status !== "open" || conversationAgain.staff_id !== null) {
        return [];
      }
    }

    if (shouldAbort?.()) return [];
    const latest = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    if (!latest || latest.sender_id !== customerId) return [];

    const recentFallback = await this.prisma.messages.findFirst({
      where: {
        conversation_id: conversationId,
        sender_type: "ai",
        message_type: "text",
        content: AI_FALLBACK_REPLY,
        created_at: { gte: new Date(Date.now() - AI_FALLBACK_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recentFallback) return [];

    const textMsg = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: AI_USER_ID,
        content: AI_FALLBACK_REPLY,
        message_type: "text",
        sender_type: "ai",
      },
    });

    await this.prisma.conversations.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    });

    return this.prisma.messages.findMany({
      where: { id: { in: [textMsg.id] } },
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

  async deleteMessage(userId: string, messageId: string, conversationId?: string) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException("Message not found.");
    }

    // Không cho xoá "chéo": messageId phải thuộc đúng hội thoại client gửi lên.
    if (conversationId && message.conversation_id !== conversationId) {
      throw new ForbiddenException("Message does not belong to this conversation.");
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
    // Server vừa restart/reload: toàn bộ reply-lock trong bộ nhớ đã mất.
    // staff_id còn lại trên conversation open chỉ là assignment cũ, không còn
    // ai thực sự giữ quyền trả lời. Phải nhả hết để staff khác không thấy
    // "đã bị chiếm" và có thể tiếp nhận lại từ tab Chờ tiếp nhận.
    await this.prisma.conversations.updateMany({
      where: { status: "open", staff_id: { not: null } },
      data: { staff_id: null, updated_at: new Date() },
    });
  }

  //async releaseStaffAssignmentsByStaffId(staffId: string) {
    // const result = await this.prisma.conversations.updateMany({
    //   where: { status: "open", staff_id: staffId },
    //   data: { staff_id: null, updated_at: new Date() },
    // });
    //console.log("releaseStaffAssignmentsByStaffId", staffId, "updated:", result.count);
  //}

  async autoReplyReleasedConversations(staffId: string): Promise<Array<{ conversationId: string; messages: messages[] }>> {
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
        select: { id: true, content: true, message_type: true, metadata: true, created_at: true },
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

      const aiMsgs = await this.maybeAutoReply(
        conv.id,
        {
          content: lastMsg.content,
          messageType: lastMsg.message_type,
          metadata: lastMsg.metadata as Record<string, unknown> | null,
          messageId: lastMsg.id,
        },
        { requireUnassigned: true },
      );
      if (aiMsgs.length > 0) {
        results.push({ conversationId: conv.id, messages: aiMsgs });
      }
    }
    return results;
  }

  /**
   * AI trả lời tin cuối của khách sau khi lock staff đã hết hạn và hội thoại
   * thực sự được trả về "Chờ tiếp nhận".
   *
   * Chỉ chạy khi:
   * - hội thoại vẫn open và chưa có staff nhận,
   * - tin cuối vẫn là của khách (staff/AI chưa trả lời),
   * - policy auto-reply cho phép.
   *
   * `requireUnassigned` được truyền xuyên qua debounce/model để nếu staff B
   * nhận hội thoại trong lúc AI đang xử lý thì AI không gửi câu trả lời nữa.
   */
  async autoReplyUnassignedIfCustomerWaiting(conversationId: string): Promise<messages[]> {
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { id: true, customer_id: true, staff_id: true, status: true, topic: true },
    });
    if (!conversation || conversation.status !== "open" || conversation.staff_id !== null) {
      return [];
    }

    const lastMsg = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        content: true,
        message_type: true,
        metadata: true,
        sender_id: true,
      },
    });
    if (!lastMsg || lastMsg.sender_id !== conversation.customer_id) {
      return [];
    }

    return this.maybeAutoReply(
      conversationId,
      {
        content: lastMsg.content,
        messageType: lastMsg.message_type,
        metadata: lastMsg.metadata as Record<string, unknown> | null,
        messageId: lastMsg.id,
      },
      { requireUnassigned: true },
    );
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
    // Gateway only calls this when no in-memory reply lock exists anymore, so
    // the assignment is stale regardless of who sent the last message.
    const result = await this.prisma.conversations.updateMany({
      where: { id: conversationId, staff_id: staffId },
      data: { staff_id: null, updated_at: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Giải phóng assignment khi tài khoản staff được gán không còn dùng được.
   *
   * Khác với `releaseStaffAssignmentIfStale`, hàm này không xét người gửi tin
   * cuối: nếu account đã bị xoá hoặc bị admin vô hiệu hoá thì hội thoại phải
   * được trả về "Chờ tiếp nhận" để staff khác có thể tiếp tục hỗ trợ khách.
   */
  async releaseAssignmentIfStaffUnavailable(conversationId: string, staffId: string): Promise<boolean> {
    const staff = await this.prisma.userAccount.findUnique({
      where: { id: staffId },
      select: { isActive: true },
    });

    if (staff?.isActive) return false;

    await this.prisma.conversations.updateMany({
      where: { id: conversationId, staff_id: staffId },
      data: { staff_id: null, updated_at: new Date() },
    });

    return true;
  }

  async releaseConversationLock(
    conversationId: string,
    staffId: string,
  ): Promise<ReleaseConversationLockResult> {
    const conversation = await this.getConversationById(conversationId);
    // Check last message sender
    const lastMsg = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    // Hội thoại mở lại từ "Đã tư vấn" chỉ tự đóng khi khách chưa hỏi câu mới.
    // Nếu tin cuối là của khách thì phải nhả về Chờ tiếp nhận, không được
    // resolve để tránh hiện lại nút "Tư vấn bổ sung" khi khách đang chờ.
    if (
      conversation.reopened_from_resolved &&
      (!lastMsg || lastMsg.sender_id !== conversation.customer_id)
    ) {
      await this.resolveConversation(conversationId, staffId);
      return { status: "resolved", released: false };
    }
    // If last message is from the same staff, the conversation is waiting for
    // the customer. The reply lock has just expired, so release the assignment
    // too: the conversation moves to "Chờ khách" (Chung) instead of staying
    // invisible in "Chờ phản hồi" forever.
    if (lastMsg && lastMsg.sender_id === staffId) {
      const result = await this.prisma.conversations.updateMany({
        where: { id: conversationId, staff_id: staffId },
        data: { staff_id: null, updated_at: new Date() },
      });
      return { status: "open", released: result.count > 0 };
    }
    // Otherwise → clear staff_id → về Chờ tiếp nhận
    const result = await this.prisma.conversations.updateMany({
      where: { id: conversationId, staff_id: staffId },
      data: { staff_id: null, updated_at: new Date() },
    });
    return { status: "open", released: result.count > 0 };
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

  /**
   * Tin cuối của khách hoặc AI nghĩa là hội thoại đang chờ staff phản hồi.
   * Tin cuối của staff nghĩa là đang chờ khách.
   */
  private isCustomerOrAiMessage(
    lastMessage: { sender_id: string; sender_type?: string | null } | null,
    customerId: string,
  ) {
    return Boolean(
      lastMessage &&
        (lastMessage.sender_id === customerId ||
          lastMessage.sender_id === AI_USER_ID ||
          lastMessage.sender_type === "ai"),
    );
  }

  /**
   * Mỗi hội thoại chỉ thuộc đúng một tab. Thứ tự kiểm tra dưới đây là nguồn
   * phân loại duy nhất cho cả danh sách và badge số lượng.
   *
   * - hội thoại chưa có tin nhắn: không thuộc tab nào (ẩn khỏi phía staff)
   * - resolved: Đã tư vấn
   * - chưa gán staff + tin cuối khách/AI: Chờ tiếp nhận
   * - chưa gán staff + tin cuối staff: Chờ khách
   * - staff hiện tại + còn lock + tin cuối staff: Chờ phản hồi
   * - staff hiện tại + còn lại: Cần trả lời
   */
  private getStaffConversationTab(
    conversation: {
      id: string;
      customer_id: string;
      staff_id: string | null;
      status: string;
      messages: Array<{ sender_id: string; sender_type?: string | null }>;
    },
    staffId: string,
    isLockActive: StaffLockChecker,
  ): StaffConversationTab | null {
    const lastMessage = conversation.messages[0] ?? null;
    // Khách mới mở khung chat là hệ thống đã tạo conversation, chưa chắc đã
    // gửi tin nào. Các "vỏ" rỗng này không thuộc tab nào của staff.
    if (!lastMessage) return null;

    if (conversation.status === "resolved") return "resolved";
    if (conversation.status !== "open") return null;

    const lastFromCustomerOrAi = this.isCustomerOrAiMessage(lastMessage, conversation.customer_id);

    if (conversation.staff_id === null) {
      return lastFromCustomerOrAi ? "unassigned" : "waiting_customer";
    }

    if (conversation.staff_id !== staffId) return null;
    if (!lastFromCustomerOrAi && isLockActive(conversation.id, staffId)) {
      return "awaiting_reply";
    }
    return lastFromCustomerOrAi ? "needs_reply" : null;
  }

  async listConversations(
    user: AuthenticatedUser,
    tab?: string,
    isLockActive: StaffLockChecker = NO_ACTIVE_STAFF_LOCK,
  ) {
    const isCustomer = user.role === "customer";

    let where: Record<string, unknown> = {};
    if (isCustomer) {
      where = { customer_id: user.id };
    } else if (tab) {
      switch (tab) {
        case "unassigned":
        case "waiting_customer":
          where = { staff_id: null, status: "open" };
          break;
        case "needs_reply":
        case "awaiting_reply":
          where = { staff_id: user.id, status: "open" };
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

    const filtered = !isCustomer
      ? conversations.filter((conversation) => {
          const conversationTab = this.getStaffConversationTab(conversation, user.id, isLockActive);
          return tab ? conversationTab === tab : conversationTab !== null;
        })
      : conversations;

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

  async getConversationCounts(
    user: AuthenticatedUser,
    isLockActive: StaffLockChecker = NO_ACTIVE_STAFF_LOCK,
  ) {
    const all = await this.prisma.conversations.findMany({
      where: user.role === "customer" ? { customer_id: user.id } : undefined,
      select: {
        id: true,
        customer_id: true,
        staff_id: true,
        status: true,
        messages: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { sender_id: true, sender_type: true },
        },
      },
    });

    const counts = {
      needsReply: 0,
      awaitingReply: 0,
      unassigned: 0,
      waitingCustomer: 0,
      resolved: 0,
    };

    for (const conversation of all) {
      const tab = this.getStaffConversationTab(conversation, user.id, isLockActive);
      switch (tab) {
        case "needs_reply":
          counts.needsReply++;
          break;
        case "awaiting_reply":
          counts.awaitingReply++;
          break;
        case "unassigned":
          counts.unassigned++;
          break;
        case "waiting_customer":
          counts.waitingCustomer++;
          break;
        case "resolved":
          counts.resolved++;
          break;
      }
    }

    return counts;
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
