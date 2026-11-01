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
  type AutoReplyTrigger,
} from "./auto-reply-trigger";
import { AssistantRouterService } from "./assistant/assistant-router.service";
import type { AssistantRouteOutput } from "./assistant/assistant.types";
import { handoffAckForReason } from "./assistant/handoff-messages";
import { handoffBadgeForReason, type HandoffGroup } from "./assistant/handoff-labels";
import { isHandoffExpired } from "./assistant/assistant-config";

const AI_USER_ID = "00000000-0000-0000-0000-000000000000";
// Gộp các tin nhắn liên tiếp của khách thành 1 lượt trả lời duy nhất.
const AI_DEBOUNCE_MS = 1500;
const AI_FALLBACK_REPLY =
  "Em đã ghi nhận câu hỏi của bạn. Nhân viên sẽ phản hồi bạn trong ít phút ạ.";
const AI_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;
// Tổng thời gian tối đa cho một lượt gọi model (gồm cả catalog + retry bên
// trong AiService). Sau mốc này router coi như lỗi và dùng fallback.
export const AI_TOTAL_TIMEOUT_MS = (() => {
  const configured = Number(process.env.AI_TOTAL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 5_000
    ? Math.floor(configured)
    : 60_000;
})();
// Khoá phân tán phải sống lâu hơn tổng timeout của model, nếu không instance
// khác có thể chen vào đúng lúc lượt trước còn đang chạy.
export const AI_AUTO_REPLY_LOCK_TTL_SECONDS = Math.max(
  90,
  Math.ceil(AI_TOTAL_TIMEOUT_MS / 1000) + 30,
);
// Bump version khi đổi logic classifier/router để không trả lại gợi ý đã cache
// theo cách hiểu cũ (cache 10 phút, khoá theo messageId).
const SUGGESTION_CACHE_PREFIX = "chat:suggestion:v2:";
const SUGGESTION_CACHE_TTL_SECONDS = 10 * 60;
const MAX_SUGGESTION_TOPICS = 3;
const MAX_SUGGESTION_PRODUCTS = 3;

export type ChatSuggestionProduct = {
  garmentId: string;
  name: string;
  imageUrl: string | null;
  dailyPrice: number;
  size: string | null;
  reason?: string;
};

export type ChatSuggestionTopic = {
  title: string;
  assistantReply: string;
  recommendedProductIds: string[];
  reasons: Record<string, string>;
  products: ChatSuggestionProduct[];
};

// Phiên quản lý hỗ trợ tự hết hạn sau khoảng này. Mỗi lần quản lý gửi/đọc tin
// hoặc khách trả lời, thời hạn được gia hạn thêm.
const DEFAULT_MANAGER_SUPPORT_TTL_MINUTES = 30;

export type ManagerSupportState = "active" | "waiting_customer" | "waiting_manager";

export type ManagerSupportFields = {
  managerSupportBy: string | null;
  managerSupportState: ManagerSupportState | null;
  managerSupportExpiresAt: Date | null;
};

export function getManagerSupportTtlMs(): number {
  const configured = Number(process.env.CHAT_MANAGER_SUPPORT_TTL_MINUTES);
  const minutes =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_MANAGER_SUPPORT_TTL_MINUTES;
  return minutes * 60 * 1000;
}

type ManagerSupportConversationFields = {
  manager_support_by?: string | null;
  manager_support_state?: string | null;
  manager_support_started_at?: Date | null;
  manager_support_last_read_at?: Date | null;
  manager_support_expires_at?: Date | null;
};

/** Handoff còn hiệu lực để staff thấy trên UI (chưa hết TTL, chưa có staff trả lời). */
export type ConversationHandoffFields = {
  handoff: {
    reason: string;
    label: string;
    group: HandoffGroup;
    sensitive: boolean;
    openedAt: Date | null;
    expired: boolean;
    triggerMessageId: string | null;
  } | null;
};

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
    // Router dùng chung với classifier. Không đánh @Optional: nếu Nest không
    // inject được, app phải fail lúc khởi động thay vì âm thầm bỏ auto-reply.
    // Unit test dựng tay truyền thẳng router vào tham số này.
    private readonly assistantRouter?: AssistantRouterService,
  ) { }

  /**
   * Phiên quản lý hỗ trợ chỉ còn hiệu lực khi chưa hết hạn. Field còn sót lại
   * trong DB sau khi hết hạn được coi như không có để mọi luồng khác hoạt động
   * như hội thoại resolved bình thường.
   */
  isManagerSupportActive(
    conversation: ManagerSupportConversationFields,
    now = new Date(),
  ): boolean {
    if (!conversation.manager_support_by || !conversation.manager_support_state) {
      return false;
    }
    if (!conversation.manager_support_expires_at) {
      return true;
    }
    return conversation.manager_support_expires_at.getTime() > now.getTime();
  }

  isManagerSupportActiveFor(
    conversation: ManagerSupportConversationFields,
    managerId: string,
    now = new Date(),
  ): boolean {
    return (
      conversation.manager_support_by === managerId &&
      this.isManagerSupportActive(conversation, now)
    );
  }

  /** Field trả về UI: hết hạn thì coi như không có phiên hỗ trợ. */
  getManagerSupportFields(
    conversation: ManagerSupportConversationFields,
    now = new Date(),
  ): ManagerSupportFields {
    if (!this.isManagerSupportActive(conversation, now)) {
      return {
        managerSupportBy: null,
        managerSupportState: null,
        managerSupportExpiresAt: null,
      };
    }

    return {
      managerSupportBy: conversation.manager_support_by ?? null,
      managerSupportState:
        (conversation.manager_support_state as ManagerSupportState | null) ?? null,
      managerSupportExpiresAt: conversation.manager_support_expires_at ?? null,
    };
  }

  /**
   * Field handoff trả về UI staff.
   *
   * Chỉ trả khi handoff đang mở trong DB. Quá TTL vẫn trả để UI hiện "Quá hạn"
   * (staff cần biết có khách từng bị bỏ rơi), nhưng bật cờ `expired` để nhãn
   * khác đi so với handoff còn hiệu lực.
   */
  getHandoffFields(
    conversation: {
      handoff_state?: string | null;
      handoff_reason?: string | null;
      handoff_sensitive?: boolean | null;
      handoff_opened_at?: Date | null;
      handoff_trigger_message_id?: string | null;
    },
    now = new Date(),
  ): ConversationHandoffFields {
    if (conversation.handoff_state !== "open" || !conversation.handoff_reason) {
      return { handoff: null };
    }

    const sensitive = Boolean(conversation.handoff_sensitive);
    const badge = handoffBadgeForReason(conversation.handoff_reason);

    return {
      handoff: {
        reason: conversation.handoff_reason,
        label: badge.label,
        group: badge.group,
        sensitive,
        openedAt: conversation.handoff_opened_at ?? null,
        expired: isHandoffExpired(conversation.handoff_opened_at, sensitive, now),
        triggerMessageId: conversation.handoff_trigger_message_id ?? null,
      },
    };
  }

  private nextManagerSupportExpiry(now: Date): Date {
    return new Date(now.getTime() + getManagerSupportTtlMs());
  }

  /**
   * Tin khách gửi vào hội thoại:
   * - đang có phiên quản lý hỗ trợ: giữ nguyên resolved + staff_id, chỉ đánh
   *   dấu chờ quản lý trả lời;
   * - còn lại (kể cả phiên đã hết hạn): mở lại hội thoại và trả về hàng chờ
   *   chung như mọi hội thoại resolved khác.
   */
  private buildCustomerReplyUpdate(
    conversation: ManagerSupportConversationFields & { status: string },
    now: Date,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    if (conversation.status !== "resolved") {
      return {
        customer_last_read_at: now,
        updated_at: now,
        reopened_from_resolved: false,
        ...extra,
      };
    }

    if (this.isManagerSupportActive(conversation, now)) {
      return {
        customer_last_read_at: now,
        updated_at: now,
        manager_support_state: "waiting_manager",
        manager_support_expires_at: this.nextManagerSupportExpiry(now),
        ...extra,
      };
    }

    return {
      status: "open",
      staff_id: null,
      customer_last_read_at: now,
      updated_at: now,
      reopened_from_resolved: false,
      manager_support_by: null,
      manager_support_state: null,
      manager_support_started_at: null,
      manager_support_last_read_at: null,
      manager_support_expires_at: null,
      ...extra,
    };
  }

  private managerSupportClearedFields() {
    return {
      manager_support_by: null,
      manager_support_state: null,
      manager_support_started_at: null,
      manager_support_last_read_at: null,
      manager_support_expires_at: null,
    };
  }

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

    if (role !== "customer") await this.onStaffReplied(conversationId);

    // Update conversation timestamps and topic context
    let productUpdateData: Record<string, unknown>;
    if (role === "customer") {      productUpdateData = this.buildCustomerReplyUpdate(conversation, now, {
        topic: "product_advice",
        garment_id: garmentId,
      });
    } else {
      productUpdateData = {
        staff_last_read_at: now,
        updated_at: now,
      };
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

    if (role !== "customer") await this.onStaffReplied(conversationId);

    const cardContext = { topic, booking_id: bookingId, garment_id: null };
    if (role === "customer") {
      const updateData = this.buildCustomerReplyUpdate(conversation, now, cardContext);
      if (conversation.status === "resolved") {
        await this.prisma.conversations.updateMany({
          where: { id: conversationId, status: "resolved" },
          data: updateData,
        });
      } else {
        await this.prisma.conversations.update({
          where: { id: conversationId },
          data: updateData,
        });
      }
    } else {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: {
          ...cardContext,
          staff_last_read_at: now,
          updated_at: now,
        },
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
    

    // Khi mở một hội thoại đã resolved (vd khách đã tư vấn xong nhưng manager
    // cần liên hệ để xin thông tin chuyển khoản hoàn cọc): tự động khởi động
    // phiên quản lý hỗ trợ nếu người gọi là manager và chưa có manager nào khác
    // đang hỗ trợ. Như vậy manager có thể gửi tin ngay mà không cần bấm thêm
    // nút "Bắt đầu hỗ trợ". Nếu manager khác đang hỗ trợ hoặc có lỗi xảy ra,
    // chỉ trả về hội thoại hiện tại mà không làm gián đoạn.
    if (
      user.role === "manager_owner" &&
      conversation.status === "resolved" &&
      !this.isManagerSupportActive(conversation)
    ) {
      try {
        await this.startManagerSupport(conversation.id, user);
      } catch {
        // Có thể manager khác vừa khởi động phiên, hoặc hội thoại không đủ
        // điều kiện — chỉ trả về như bình thường, UI sẽ hiển thị trạng thái thực tế.
      }
    }

    const refreshed = await this.getOrCreateConversationForCustomer(customerId);

    return {
      id: refreshed.id,
      customerId,
      customerName: customer.profile?.fullName ?? customer.email ?? null,
      staffId: refreshed.staff_id ?? null,
      staffName: null,
      status: refreshed.status,
      updatedAt: refreshed.updated_at,
      lastMessage: refreshed.messages.length > 0
        ? refreshed.messages[refreshed.messages.length - 1]
        : null,
      unreadCount: 0,
      topic: refreshed.topic ?? "general",
      garmentId: refreshed.garment_id ?? null,
      garmentName: null,
      bookingId: refreshed.booking_id ?? null,
      reopenedFromResolved: refreshed.reopened_from_resolved,
      ...this.getManagerSupportFields(refreshed),
      ...this.getHandoffFields(refreshed),
    };
  }

  private async doGetOrCreateConversationForCustomer(customerId: string) {
    const existingConversation = await this.prisma.conversations.findFirst({
      where: { customer_id: customerId },
    });

    if (existingConversation) {
      // Không nạp toàn bộ lịch sử tin nhắn ở đây: khách có thể đã chat rất
      // nhiều, và màn chat còn gọi riêng API lấy 15 tin mới nhất. Chỉ lấy tin
      // cuối để hiển thị preview + đếm chưa đọc, chạy song song cho nhanh.
      const [unreadCount, lastMessage] = await Promise.all([
        this.prisma.messages.count({
          where: {
            conversation_id: existingConversation.id,
            sender_id: { not: customerId },
            created_at: { gt: existingConversation.customer_last_read_at ?? new Date(0) },
          },
        }),
        typeof this.prisma.messages.findFirst === "function"
          ? this.prisma.messages.findFirst({
              where: { conversation_id: existingConversation.id },
              orderBy: { created_at: "desc" },
            })
          : null,
      ]);
      return {
        ...existingConversation,
        messages: lastMessage ? [lastMessage] : [],
        unreadCount,
      };
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

  async sendMessage(
    userId: string,
    role: AppRole,
    conversationId: string,
    content: string,
    options?: { replyToId?: string | null },
  ) {
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

    const now = new Date();
    const managerSupportMessage =
      role === "manager_owner" &&
      conversation.status === "resolved" &&
      this.isManagerSupportActiveFor(conversation, userId, now);
    if (role === "manager_owner" && !managerSupportMessage && conversation.staff_id !== userId) {
      throw new ForbiddenException(
        "Start manager support before messaging this conversation.",
      );
    }

    // Trích dẫn tin nhắn (kiểu reply Messenger) chỉ dành cho staff/manager.
    // Tin gốc phải nằm trong cùng hội thoại, nếu không thì bỏ qua trích dẫn
    // thay vì chặn cả tin nhắn.
    let replyTo: { id: string; content: string } | null = null;
    const replyToId = options?.replyToId?.trim();
    if (replyToId && role !== "customer") {
      const quoted = await this.prisma.messages.findFirst({
        where: { id: replyToId, conversation_id: conversationId },
        select: { id: true, content: true, message_type: true, deleted_at: true },
      });
      if (quoted && !quoted.deleted_at) {
        replyTo = {
          id: quoted.id,
          content:
            quoted.message_type && quoted.message_type !== "text"
              ? `[${quoted.message_type}]`
              : quoted.content.slice(0, 300),
        };
      }
    }

    const message = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: userId,
        content,
        // Trích dẫn tin khách (chỉ staff/manager dùng). Giới hạn trong cùng
        // hội thoại và bỏ qua nếu tin gốc không tồn tại để không ghi rác.
        ...(replyTo
          ? { metadata: { replyTo: { id: replyTo.id, content: replyTo.content } } }
          : {}),
        ...(managerSupportMessage
          ? {
              metadata: {
                managerSupport: true,
                managerId: userId,
                originalStaffId: conversation.staff_id ?? null,
                ...(replyTo
                  ? { replyTo: { id: replyTo.id, content: replyTo.content } }
                  : {}),
              },
            }
          : {}),
      },
      ...(typeof this.prisma.messages.findUnique === "function"
        ? { include: { user_accounts: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } } } }
        : {}),
    });

    if (role !== "customer") await this.onStaffReplied(conversationId);

    let updateData: Record<string, unknown>;
    if (role === "customer") {
      updateData = this.buildCustomerReplyUpdate(conversation, now);
    } else if (managerSupportMessage) {      updateData = {
        manager_support_state: "waiting_customer",
        manager_support_last_read_at: now,
        manager_support_expires_at: this.nextManagerSupportExpiry(now),
        updated_at: now,
      };
    } else {
      updateData = { staff_last_read_at: now, updated_at: now };
    }

    if (role === "customer" && conversation.status === "resolved") {
      await this.prisma.conversations.updateMany({ where: { id: conversationId, status: "resolved" }, data: updateData });
    } else {
      await this.prisma.conversations.update({ where: { id: conversationId }, data: updateData });
    }

    return this.withReplyPreview(message);
  }

  async maybeAutoReply(
    conversationId: string,
    input: AutoReplyTrigger | string,
    options?: AutoReplyOptions,
  ): Promise<messages[]> {
    const trigger = normalizeTrigger(input);
    const requireUnassigned = options?.requireUnassigned ?? false;
    if (options?.shouldAbort?.()) return [];

    // Tin text rỗng/emoji-only không cần chạm DB; router cũng sẽ SKIP nhưng
    // chặn sớm ở đây để đỡ một query mỗi tin.
    if (
      (trigger.messageType ?? "text") === "text" &&
      !/[\p{L}\p{N}]/u.test(trigger.content ?? "")
    ) {
      this.logger.debug(`Skip auto-reply for ${conversationId}: empty_or_emoji`);
      return [];
    }

    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { id: true, customer_id: true, staff_id: true, status: true, topic: true },
    });
    if (!conversation || conversation.status === "resolved") return [];
    if (requireUnassigned && (conversation.status !== "open" || conversation.staff_id !== null)) return [];

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

    // Idempotency: chỉ trả lời khi tin cuối vẫn là của khách.
    // Nếu staff/AI vừa trả lời trong lúc debounce thì bỏ qua.
    const latest = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: { sender_id: true },
    });
    if (!latest || latest.sender_id !== conversation.customer_id) return [];

    // Một router duy nhất cho auto-reply và staff suggestion: STAFF > FAQ > DB
    // > AI. Chỉ nhánh AI mới gọi model, mọi nhánh còn lại trả ngay từ rule/DB.
    this.logger.debug(`Auto-reply via assistant router for ${conversationId}`);
    return this.doPerformRoutedAutoReply(
      conversationId,
      conversation.customer_id,
      trigger,
      requireUnassigned,
      shouldAbort,
    );
  }

  /**
   * Router là provider bắt buộc của ChatModule. Tham số constructor vẫn để
   * optional để unit test cũ dựng tay được, nhưng thiếu router là lỗi lập trình
   * nên phải ném ra thay vì âm thầm bỏ qua auto-reply.
   */
  private requireRouter(): AssistantRouterService {
    if (!this.assistantRouter) {
      throw new Error("AssistantRouterService was not injected into ChatService");
    }
    return this.assistantRouter;
  }

  /**
   * Nhánh auto-reply dùng router chung: STAFF > FAQ > DB > AI.
   * Chỉ action "llm" mới gọi model; mọi action còn lại ghi câu trả lời cố
   * định (hoặc im lặng khi handoff đã mở trước đó).
   */
  private async doPerformRoutedAutoReply(
    conversationId: string,
    customerId: string,
    trigger: AutoReplyTrigger,
    requireUnassigned: boolean,
    shouldAbort?: () => boolean,
  ): Promise<messages[]> {
    const output = await this.requireRouter().routeConversation({
      conversationId,
      customerId,
      messageId: trigger.messageId,
      trigger,
    });

    this.logger.debug(
      `Assistant route for ${conversationId}: route=${output.route} reason=${output.reason} action=${output.action} llm=${output.usedLlm}`,
    );

    if (shouldAbort?.()) return [];

    if (output.action === "none") return [];

    if (output.action === "reply" || output.action === "handoff") {
      // Handoff luôn phải có thông báo cho khách. Nếu router không kèm câu
      // (ví dụ handoff đã mở trước đó), dùng câu thông báo mặc định thay vì
      // im lặng.
      const reply =
        output.reply ??
        (output.action === "handoff" ? handoffAckForReason(output.reason) : null);
      if (!reply) return [];
      return this.persistAiReply(
        conversationId,
        customerId,
        reply,
        output.productIds ?? [],
        this.assistantReplyMetadata(output),
        requireUnassigned,
        shouldAbort,
      );
    }

    // action === "llm"
    const history = await this.buildAutoReplyHistory(
      conversationId,
      customerId,
      trigger.messageId,
    );

    let result;
    try {
      result = await this.withAiDeadline(
        this.aiService.productAdvisor(
          { message: output.llmRequest ?? trigger.content, history },
          true,
        ),
      );
    } catch (error) {
      this.logger.warn(
        `AI advisor error for conversation ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.createAutoReplyFallback(
        conversationId,
        customerId,
        requireUnassigned,
        shouldAbort,
      );
    }

    const replyTopic = (result.data?.topics ?? []).find(
      (topic) =>
        typeof topic.assistantReply === "string" &&
        topic.assistantReply.trim().length > 0,
    );
    if (!replyTopic) {
      this.logger.warn(`AI advisor returned no reply for conversation ${conversationId}`);
      return this.createAutoReplyFallback(
        conversationId,
        customerId,
        requireUnassigned,
        shouldAbort,
      );
    }

    return this.persistAiReply(
      conversationId,
      customerId,
      replyTopic.assistantReply.trim(),
      (replyTopic.recommendedProductIds ?? []).slice(0, MAX_SUGGESTION_PRODUCTS),
      this.assistantReplyMetadata(output),
      requireUnassigned,
      shouldAbort,
    );
  }

  /**
   * Gợi ý cho staff — chỉ chạy khi staff bấm nút, không tự động gửi.
   * Cùng router với auto-reply, cache theo messageId để bấm lại không tốn
   * thêm lượt model. Tối đa 3 chủ đề × 3 sản phẩm.
   *
   * `targetMessageId`: khi staff chọn "trả lời" một tin cũ của khách, gợi ý
   * phải trả lời đúng tin đó chứ không phải tin mới nhất. Ngữ cảnh lấy từ
   * ~5 tin ngay trước tin được chọn.
   */
  async suggestReplyForStaff(
    user: AuthenticatedUser,
    conversationId: string,
    targetMessageId?: string,
  ): Promise<{
    messageId: string | null;
    topics: ChatSuggestionTopic[];
    cached: boolean;
  }> {
    if (user.role === "customer") {
      throw new ForbiddenException("Only staff can request AI suggestions.");
    }

    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException("Conversation not found.");

    if (user.role === "staff" && conversation.staff_id !== user.id) {
      throw new ForbiddenException(
        "Only the assigned staff can request suggestions for this conversation.",
      );
    }
    if (
      user.role === "manager_owner" &&
      conversation.staff_id !== user.id &&
      !this.isManagerSupportActiveFor(conversation, user.id)
    ) {
      throw new ForbiddenException(
        "Start manager support before requesting suggestions.",
      );
    }

    const lastCustomerMessage = targetMessageId
      ? await this.prisma.messages.findFirst({
          where: {
            id: targetMessageId,
            conversation_id: conversationId,
            deleted_at: null,
            sender_id: conversation.customer_id,
            message_type: "text",
          },
          select: {
            id: true,
            content: true,
            message_type: true,
            metadata: true,
            created_at: true,
          },
        })
      : null;

    // Tin staff chọn không hợp lệ (không phải tin khách / đã xoá) → quay lại
    // hành vi cũ: gợi ý cho tin khách mới nhất.
    const anchorMessage =
      lastCustomerMessage &&
      /[\p{L}\p{N}]/u.test(lastCustomerMessage.content?.trim() ?? "")
        ? lastCustomerMessage
        : await this.prisma.messages.findFirst({
            where: {
              conversation_id: conversationId,
              deleted_at: null,
              sender_id: conversation.customer_id,
              message_type: "text",
            },
            orderBy: { created_at: "desc" },
            select: {
              id: true,
              content: true,
              message_type: true,
              metadata: true,
              created_at: true,
            },
          });

    const content = anchorMessage?.content?.trim() ?? "";
    if (!anchorMessage || !/[\p{L}\p{N}]/u.test(content)) {
      return { messageId: null, topics: [], cached: false };
    }

    const cacheKey = `${SUGGESTION_CACHE_PREFIX}${anchorMessage.id}`;
    const cached = await this.redisService?.get<ChatSuggestionTopic[]>(cacheKey);
    if (cached) {
      return { messageId: anchorMessage.id, topics: cached, cached: true };
    }

    const output = await this.requireRouter().routeConversation({
      conversationId,
      customerId: conversation.customer_id,
      messageId: anchorMessage.id,
      trigger: {
        content,
        messageType: "text",
        metadata:
          (anchorMessage.metadata as Record<string, unknown> | null) ?? null,
        messageId: anchorMessage.id,
      },
      mode: "suggestion",
    });

    let topics: ChatSuggestionTopic[] = [];

    if (output.action === "reply" && output.reply?.trim()) {
      const productIds = (output.productIds ?? []).slice(0, MAX_SUGGESTION_PRODUCTS);
      topics = [
        {
          title: this.suggestionTitle(output),
          assistantReply: output.reply.trim(),
          recommendedProductIds: productIds,
          reasons: {},
          products: await this.loadSuggestionProducts(productIds),
        },
      ];
    } else if (output.action === "llm") {
      // Ngữ cảnh: các tin ngay TRƯỚC tin được chọn (tối đa 6) — đủ để hiểu
      // "cái đó", "mẫu kia" mà không kéo cả hội thoại dài vào prompt.
      const history = await this.buildAutoReplyHistory(
        conversationId,
        conversation.customer_id,
        anchorMessage.id,
        { before: anchorMessage.created_at, limit: 6 },
      );
      try {
        const result = await this.withAiDeadline(
          this.aiService.productAdvisor(
            { message: output.llmRequest ?? content, history },
            true,
          ),
        );
        topics = this.normalizeSuggestionTopics(result.data?.topics ?? []);
      } catch (error) {
        this.logger.warn(
          `Suggestion model error for conversation ${conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        topics = [];
      }
    }

    await this.redisService?.set(cacheKey, topics, SUGGESTION_CACHE_TTL_SECONDS);
    return { messageId: anchorMessage.id, topics, cached: false };
  }

  /** Staff đã trả lời: mở lại chu kỳ auto-reply và reset chống lặp. */
  private async onStaffReplied(conversationId: string): Promise<void> {
    try {
      await this.requireRouter().handleStaffReply(conversationId);
    } catch (error) {
      this.logger.warn(
        `Could not reset assistant state for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private withAiDeadline<T>(
    promise: Promise<T>,
    timeoutMs = AI_TOTAL_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`AI total timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private assistantReplyMetadata(output: AssistantRouteOutput): Prisma.InputJsonValue {
    return {
      assistant_route: output.route,
      assistant_reason: output.reason,
    };
  }

  private suggestionTitle(output: AssistantRouteOutput): string {
    switch (output.route) {
      case "FAQ":
        return "Trả lời từ FAQ";
      case "DB":
        return "Thông tin từ shop";
      case "TEMPLATE":
        return "Trả lời nhanh";
      case "STAFF":
        return "Chuyển nhân viên";
      default:
        return "Gợi ý sản phẩm";
    }
  }

  private normalizeSuggestionTopics(rawTopics: unknown[]): ChatSuggestionTopic[] {
    return rawTopics
      .filter(
        (topic): topic is Record<string, unknown> & { assistantReply: string } =>
          Boolean(topic) &&
          typeof topic === "object" &&
          typeof (topic as Record<string, unknown>).assistantReply === "string" &&
          ((topic as Record<string, unknown>).assistantReply as string).trim().length > 0,
      )
      .slice(0, MAX_SUGGESTION_TOPICS)
      .map((topic) => {
        const rawProducts = Array.isArray(topic.products) ? topic.products : [];
        const products = rawProducts
          .filter(
            (product): product is Record<string, unknown> =>
              Boolean(product) && typeof product === "object",
          )
          .slice(0, MAX_SUGGESTION_PRODUCTS)
          .map((product) => ({
            garmentId: String(product.garmentId ?? ""),
            name: String(product.name ?? ""),
            imageUrl:
              typeof product.imageUrl === "string" ? product.imageUrl : null,
            dailyPrice: Number(product.dailyPrice ?? 0),
            size: typeof product.size === "string" ? product.size : null,
            ...(typeof product.reason === "string"
              ? { reason: product.reason }
              : {}),
          }))
          .filter((product) => product.garmentId !== "");

        const recommended = Array.isArray(topic.recommendedProductIds)
          ? topic.recommendedProductIds
              .filter((id): id is string => typeof id === "string")
              .slice(0, MAX_SUGGESTION_PRODUCTS)
          : products.map((product) => product.garmentId);

        return {
          title:
            typeof topic.title === "string" && topic.title.trim()
              ? topic.title.trim()
              : "Gợi ý sản phẩm",
          assistantReply: topic.assistantReply.trim(),
          recommendedProductIds: recommended,
          reasons:
            topic.reasons && typeof topic.reasons === "object"
              ? (topic.reasons as Record<string, string>)
              : {},
          products,
        };
      });
  }

  private async loadSuggestionProducts(
    ids: string[],
  ): Promise<ChatSuggestionProduct[]> {
    const uniqueIds = [...new Set(ids)].slice(0, MAX_SUGGESTION_PRODUCTS);
    if (uniqueIds.length === 0) return [];

    const garments = await this.prisma.garment.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        garment_sizes: {
          where: { is_active: true },
          orderBy: { daily_price: "asc" },
          take: 1,
        },
      },
    });

    return garments.map((garment) => ({
      garmentId: garment.id,
      name: garment.name,
      imageUrl: garment.images[0]?.imageUrl ?? null,
      dailyPrice: Number(garment.garment_sizes[0]?.daily_price ?? 0),
      size: garment.garment_sizes[0]?.size_label ?? null,
    }));
  }

  /**
   * Lịch sử gửi kèm cho model. Bỏ tin đang được trả lời để tránh lặp nội dung,
   * và mô tả card/ảnh/video thành chữ để model hiểu ngữ cảnh.
   */
  private async buildAutoReplyHistory(
    conversationId: string,
    customerId: string,
    excludeMessageId?: string,
    options: { before?: Date; limit?: number } = {},
  ): Promise<Array<{ role: "customer" | "staff" | "ai"; content: string; createdAt: string }>> {
    const recentMessages = await this.prisma.messages.findMany({
      where: {
        conversation_id: conversationId,
        deleted_at: null,
        message_type: { in: ["text", "product_card", "booking_card", "image", "video"] },
        ...(options.before ? { created_at: { lt: options.before } } : {}),
      },
      orderBy: { created_at: "desc" },
      take: options.limit ?? 15,
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

  /**
   * Dọn các phiên quản lý hỗ trợ đã hết hạn.
   *
   * Chỉ xoá field phiên hỗ trợ và giữ nguyên resolved + staff phụ trách. Khách
   * gửi tin mới sau thời điểm này mới thực sự mở lại hội thoại (xem
   * `buildCustomerReplyUpdate`).
   *
   * Trả về danh sách id vừa được dọn để gateway cập nhật UI.
   */
  async expireManagerSupportSessions(): Promise<string[]> {
    const now = new Date();
    const expired = await this.prisma.conversations.findMany({
      where: {
        manager_support_state: { not: null },
        manager_support_expires_at: { lt: now },
      },
      select: { id: true },
    });
    if (expired.length === 0) return [];

    const ids = expired.map((conversation) => conversation.id);
    await this.prisma.conversations.updateMany({
      where: {
        id: { in: ids },
        manager_support_state: { not: null },
        manager_support_expires_at: { lt: now },
      },
      data: {
        ...this.managerSupportClearedFields(),
        updated_at: now,
      },
    });

    return ids;
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

  /**
   * Bắt đầu phiên "quản lý hỗ trợ" cho một hội thoại đã resolved.
   * Không đụng tới status/staff_id — quản lý chỉ mượn quyền gửi tin tạm thời.
   */
  async startManagerSupport(conversationId: string, manager: AuthenticatedUser) {
    if (manager.role !== "manager_owner") {
      throw new ForbiddenException("Only managers can start manager support.");
    }

    const conversation = await this.getConversationById(conversationId);
    if (conversation.status !== "resolved") {
      throw new ForbiddenException("Manager support is only available for resolved conversations.");
    }

    const now = new Date();
    if (
      this.isManagerSupportActive(conversation, now) &&
      conversation.manager_support_by &&
      conversation.manager_support_by !== manager.id
    ) {
      throw new ForbiddenException("Another manager is already supporting this conversation.");
    }

    return this.prisma.conversations.update({
      where: { id: conversationId },
      data: {
        manager_support_by: manager.id,
        manager_support_state: "active",
        manager_support_started_at: now,
        manager_support_last_read_at: now,
        manager_support_expires_at: this.nextManagerSupportExpiry(now),
        updated_at: now,
      },
    });
  }

  /**
   * Kết thúc phiên quản lý hỗ trợ.
   *
   * Luôn giữ nguyên status (resolved) và staff phụ trách. Chỉ khi khách gửi
   * tin MỚI sau khi phiên kết thúc thì hội thoại mới được mở lại và đưa về
   * hàng "Chờ tiếp nhận" chung.
   */
  async endManagerSupport(conversationId: string, managerId: string) {
    const conversation = await this.getConversationById(conversationId);
    if (conversation.manager_support_by !== managerId) {
      throw new ForbiddenException("You are not supporting this conversation.");
    }

    const updated = await this.prisma.conversations.update({
      where: { id: conversationId },
      data: {
        ...this.managerSupportClearedFields(),
        updated_at: new Date(),
      },
    });

    return {
      status: updated.status,
      staffId: updated.staff_id ?? null,
      released: false,
    };
  }

  async markManagerSupportRead(conversationId: string, managerId: string) {
    const conversation = await this.getConversationById(conversationId);
    const now = new Date();
    if (!this.isManagerSupportActiveFor(conversation, managerId, now)) {
      throw new ForbiddenException("You are not supporting this conversation.");
    }

    return this.prisma.conversations.update({
      where: { id: conversationId },
      data: {
        manager_support_last_read_at: now,
        manager_support_expires_at: this.nextManagerSupportExpiry(now),
      },
    });
  }

  async markConversationRead(userId: string, role: AppRole, conversationId: string) {
    const conversation = role === "customer"
      ? await this.findConversationForParticipant(userId, conversationId)
      : await this.getConversationById(conversationId);
    if (!conversation) {
      throw new ForbiddenException("You are not part of this conversation.");
    }

    const now = new Date();
    if (role === "manager_owner" && this.isManagerSupportActiveFor(conversation, userId, now)) {
      return this.prisma.conversations.update({
        where: { id: conversationId },
        data: {
          manager_support_last_read_at: now,
          manager_support_expires_at: this.nextManagerSupportExpiry(now),
        },
      });
    }
    if (role !== "customer" && conversation.staff_id !== userId) {
      throw new ForbiddenException("You are not part of this conversation.");
    }

    const updateData = role === "customer"
      ? { customer_last_read_at: now }
      : { staff_last_read_at: now };

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
      return Promise.all(
        msgs.reverse().map(async (m) => this.withReplyPreview(await this.attachSignedUrl(m))),
      );
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
   * - quản lý đang hỗ trợ: Cần trả lời / Chờ phản hồi theo tin cuối (tab Cá nhân)
   * - resolved: Đã tư vấn
   * - chưa gán staff + tin cuối khách/AI: Chờ tiếp nhận
   * - chưa gán staff + tin cuối staff: Chờ khách
   * - staff hiện tại + còn lock + tin cuối staff: Chờ phản hồi
   * - staff hiện tại + còn lại: Cần trả lời
   */
  private getStaffConversationTab(
    conversation: ManagerSupportConversationFields & {
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

    // Quản lý đang hỗ trợ hội thoại này: dùng chung tab Cá nhân với staff
    // (Chờ phản hồi / Cần trả lời) theo tin cuối, thay vì một tab riêng.
    // Staff phụ trách vẫn thấy hội thoại ở tab Đã tư vấn.
    if (this.isManagerSupportActiveFor(conversation, staffId)) {
      const lastFromCustomerOrAi = this.isCustomerOrAiMessage(
        lastMessage,
        conversation.customer_id,
      );
      return lastFromCustomerOrAi ? "needs_reply" : "awaiting_reply";
    }

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
          // Manager đang hỗ trợ vẫn giữ status resolved + staff phụ trách,
          // nên phải gộp thêm các hội thoại manager_support_by = mình để
          // chúng xuất hiện ở tab Cá nhân như hội thoại bình thường.
          where = {
            OR: [
              { staff_id: user.id, status: "open" },
              { manager_support_by: user.id },
            ],
          };
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
        ...this.getManagerSupportFields(conversation),
        ...this.getHandoffFields(conversation),
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
        manager_support_by: true,
        manager_support_state: true,
        manager_support_expires_at: true,
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

    // Quản lý khác đang hỗ trợ hội thoại: không cho staff/manager khác gửi
    // media chen ngang (text đã bị chặn ở gateway và sendMessage).
    if (
      role !== "customer" &&
      conversation.manager_support_by &&
      conversation.manager_support_by !== userId &&
      this.isManagerSupportActive(conversation)
    ) {
      throw new ForbiddenException("Another manager is supporting this conversation.");
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
    const managerSupportMessage =
      role === "manager_owner" &&
      this.isManagerSupportActiveFor(conversation, userId, now);
    const message = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: userId,
        content: "",
        message_type: messageType,
        metadata: managerSupportMessage
          ? {
              ...meta,
              managerSupport: true,
              managerId: userId,
              originalStaffId: conversation.staff_id ?? null,
            }
          : meta,
      },
    });

    if (role === "customer") {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: this.buildCustomerReplyUpdate(conversation, now),
      });
    } else if (managerSupportMessage) {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: {
          manager_support_state: "waiting_customer",
          manager_support_last_read_at: now,
          manager_support_expires_at: this.nextManagerSupportExpiry(now),
          updated_at: now,
        },
      });
    } else {
      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: { staff_last_read_at: now, updated_at: now },
      });
    }

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
    return fullMsg ? this.withReplyPreview(await this.attachSignedUrl(fullMsg)) : null;
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

  /**
   * Tách `metadata.replyTo` (do sendMessage ghi khi staff trả lời trích dẫn)
   * thành field `replyTo` ở gốc message để UI không phải biết cấu trúc JSON.
   */
  private withReplyPreview<T extends { metadata?: unknown }>(
    msg: T,
  ): T & { replyTo: { id: string; content: string } | null } {
    const meta = (msg.metadata ?? null) as Record<string, unknown> | null;
    const raw = meta?.replyTo;
    const replyTo =
      raw && typeof raw === "object" &&
      typeof (raw as Record<string, unknown>).id === "string"
        ? {
            id: (raw as Record<string, unknown>).id as string,
            content: String((raw as Record<string, unknown>).content ?? ""),
          }
        : null;
    return { ...msg, replyTo };
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
