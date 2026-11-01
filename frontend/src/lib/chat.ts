import { apiRequest } from "./api";
import { readStoredAccessToken } from "./auth";
import { getChatSocket } from "./socket";

export type ChatReplyPreview = {
  id: string;
  content: string;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  message_type?: string;
  sender_type?: string;
  metadata?: Record<string, unknown> | null;
  /** Tin được trích dẫn khi staff/manager trả lời một tin cụ thể. */
  replyTo?: ChatReplyPreview | null;
  user_accounts?: {
    id: string;
    email: string;
    role: string;
    profile?: { fullName?: string | null };
  };
};

export type StaffConversationTab =
  | "unassigned"
  | "resolved"
  | "waiting_customer"
  | "awaiting_reply"
  | "needs_reply";

export type ManagerSupportState = "active" | "waiting_customer" | "waiting_manager";

export type ChatConversationCounts = {
  needsReply: number;
  awaitingReply: number;
  unassigned: number;
  waitingCustomer: number;
  resolved: number;
};

export type ChatHandoffGroup = "complaint" | "payment" | "bot";

/**
 * Handoff đang mở của hội thoại (backend trả kèm mọi payload hội thoại).
 * `expired` = đã quá TTL mà chưa có staff trả lời; staff vẫn cần thấy.
 */
export type ChatHandoff = {
  reason: string;
  label: string;
  group: ChatHandoffGroup;
  sensitive: boolean;
  openedAt: string | null;
  expired: boolean;
  triggerMessageId: string | null;
};

export type ChatConversation = {
  id: string;
  customerId: string;
  customerName: string;
  staffId: string | null;
  staffName: string | null;
  status: string;
  updatedAt: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  topic?: string;
  garmentId?: string | null;
  garmentName?: string | null;
  bookingId?: string | null;
  reopenedFromResolved: boolean;
  managerSupportBy?: string | null;
  managerSupportState?: ManagerSupportState | null;
  managerSupportExpiresAt?: string | null;
  handoff?: ChatHandoff | null;
};

export type ManagerSupportSnapshot = {
  conversationId: string;
  status: string;
  staffId: string | null;
  managerSupportBy: string | null;
  managerSupportState: ManagerSupportState | null;
  managerSupportExpiresAt: string | null;
};

export type ConversationLockStatus = {
  isLocked: boolean;
  lockedBy: { staffId: string; name: string } | null;
  lockedAt: string | null;
  expiresAt: string | null;
};

export type ProductCardMessage = {
  type: "product_card";
  product: {
    id: string;
    name: string;
    image: string;
    size: string | null;
    price: number;
    detailUrl: string;
  };
};

export type BookingCardMessage = {
  type: "booking_card";
  topic?: string;
  booking: {
    id: string;
    code: string;
    status: string;
    statusLabel: string;
    rentalStartDate: string;
    rentalEndDate: string;
    days: number;
    itemCount: number;
    rentalTotal: number;
    depositTotal: number;
    detailUrl?: string;
  };
};

const DEFAULT_PRODUCT_IMAGE = "https://dep.com.vn/wp-content/uploads/2020/11/ao-dai-9.jpg";

export function getProductCardData(msg: ChatMessage): ProductCardMessage["product"] | null {
  if (msg.message_type === "product_card" && msg.metadata?.product && typeof msg.metadata.product === "object") {
    return msg.metadata.product as ProductCardMessage["product"];
  }
  return null;
}

export function getBookingCardData(msg: ChatMessage): { booking: BookingCardMessage["booking"]; topic?: string } | null {
  if (msg.message_type === "booking_card" && msg.metadata?.booking && typeof msg.metadata.booking === "object") {
    return { booking: msg.metadata.booking as BookingCardMessage["booking"], topic: msg.metadata.topic as string | undefined };
  }
  return null;
}

export function getBookingTopic(msg: ChatMessage): string | null {
  const data = getBookingCardData(msg);
  return data?.topic ?? null;
}

export type AdvisorHistoryRole = "customer" | "staff" | "ai";

export type AdvisorHistoryItem = {
  role: AdvisorHistoryRole;
  content: string;
  createdAt: string;
};

/**
 * Dựng history gửi cho AI advisor từ danh sách tin nhắn.
 *
 * - AI phải giữ đúng vai "ai" (trước đây bị map thành "customer").
 * - Mọi người gửi không phải khách (staff/manager) đều là "staff",
 *   kể cả khi hội thoại đã được chuyển cho staff khác.
 * - Card/ảnh/video được mô tả thành chữ để model hiểu ngữ cảnh.
 */
export function buildAdvisorHistory(params: {
  messages: ChatMessage[];
  customerId: string;
  excludeMessageId?: string;
  limit?: number;
}): AdvisorHistoryItem[] {
  const { messages, customerId, excludeMessageId, limit = 10 } = params;

  return messages
    .filter(
      (m) =>
        !m.deleted_at &&
        (!m.message_type || ["text", "product_card", "booking_card", "image", "video"].includes(m.message_type)) &&
        m.id !== excludeMessageId,
    )
    .slice(-limit)
    .map((m) => {
      let content = m.content;

      if (m.message_type === "product_card") {
        const product = getProductCardData(m);
        if (product) {
          const price = typeof product.price === "number" ? product.price.toLocaleString("vi-VN") : "";
          content = `[Thẻ sản phẩm] ${product.name} | Size: ${product.size ?? "N/A"}${price ? ` | Giá: ${price}đ/ngày` : ""}`;
        }
      } else if (m.message_type === "booking_card") {
        const data = getBookingCardData(m);
        if (data) {
          content = `[Thẻ đơn hàng] Mã ${data.booking.code} | Trạng thái: ${data.booking.statusLabel}`;
        }
      } else if (m.message_type === "image") {
        content = "[Hình ảnh]";
      } else if (m.message_type === "video") {
        content = "[Video]";
      }

      const isCustomer = m.sender_id === customerId || m.user_accounts?.role === "customer";
      const role: AdvisorHistoryRole =
        m.sender_type === "ai" ? "ai" : isCustomer ? "customer" : "staff";

      return { role, content, createdAt: m.created_at };
    });
}

export async function sendBookingCardMessage(params: {
  conversationId: string;
  bookingId: string;
  topic: "booking_support" | "complaint";
}) {
  return apiRequest<ChatMessage>(`/chat/conversations/${params.conversationId}/booking-card`, {
    method: "POST",
    body: JSON.stringify({ bookingId: params.bookingId, topic: params.topic }),
  });
}

/**
 * Send a product card message to the chat conversation via REST API.
 * The backend will query the real garment data from DB and create the message,
 * preventing clients from forging product details.
 *
 * Dispatches a custom DOM event so that CustomerChatProvider can add the
 * message to local state immediately, regardless of socket timing.
 */
export async function sendProductCardMessage(params: {
  conversationId: string;
  productId: string;
}) {
  const result = await apiRequest<ChatMessage>(`/chat/conversations/${params.conversationId}/product-card`, {
    method: "POST",
    body: JSON.stringify({ garmentId: params.productId }),
  });

  // Dispatch custom event so CustomerChatProvider picks it up in real time
  // if (result.success && result.data) {
  //   window.dispatchEvent(
  //     new CustomEvent("chat:message_received", {
  //       detail: {
  //         conversationId: params.conversationId,
  //         message: result.data,
  //       },
  //     }),
  //   );
  // }

  return result;
}

export async function getMyChatConversation() {
  return apiRequest<ChatConversation>("/chat/conversations/me");
}

// Staff/manager: mở (hoặc tạo) cuộc trò chuyện với một khách cụ thể
export async function getConversationWithCustomer(customerId: string) {
  return apiRequest<ChatConversation>(`/chat/conversations/with-customer/${customerId}`);
}

export async function createChatConversation() {
  return apiRequest<ChatConversation>("/chat/conversations", { method: "POST" });
}

export async function getChatConversations(tab?: string) {
  const query = tab ? `?tab=${tab}` : "";
  return apiRequest<ChatConversation[]>(`/chat/conversations${query}`);
}

export async function getChatConversationCounts() {
  return apiRequest<ChatConversationCounts>("/chat/conversations/counts");
}

export async function getConversationMessages(conversationId: string, before?: string, limit = 15) {
  const searchParams = new URLSearchParams();
  if (before) searchParams.set("before", before);
  if (limit) searchParams.set("limit", String(limit));

  return apiRequest<ChatMessage[]>(`/chat/conversations/${conversationId}/messages?${searchParams.toString()}`);
}

export async function markConversationRead(conversationId: string) {
  return apiRequest<{ id: string }>(`/chat/conversations/${conversationId}/read`, {
    method: "PATCH",
  });
}

export async function startManagerSupport(conversationId: string) {
  return apiRequest<ManagerSupportSnapshot>(
    `/chat/conversations/${conversationId}/manager-support/start`,
    { method: "POST" },
  );
}

export async function endManagerSupport(conversationId: string) {
  return apiRequest<{
    status: string;
    staffId: string | null;
    released: boolean;
  }>(`/chat/conversations/${conversationId}/manager-support/end`, {
    method: "POST",
  });
}

export async function getConversationHandoff(conversationId: string) {
  return apiRequest<{ handoff: ChatHandoff | null }>(
    `/chat/conversations/${conversationId}/handoff`,
  );
}

export async function getConversationLockStatus(conversationId: string) {
  return apiRequest<ConversationLockStatus>(`/chat/conversations/${conversationId}/lock-status`);
}

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

export type StaffSuggestionResponse = {
  messageId: string | null;
  topics: ChatSuggestionTopic[];
  cached: boolean;
};

/**
 * Gợi ý do backend định tuyến (STAFF > FAQ > DB > AI) và cache theo messageId.
 * Chỉ staff phụ trách (hoặc manager đang hỗ trợ) gọi được; không tự gửi.
 *
 * `messageId`: tin khách mà staff chọn trả lời. Bỏ trống = tin khách mới nhất.
 */
export async function getStaffSuggestion(
  conversationId: string,
  messageId?: string | null,
) {
  return apiRequest<StaffSuggestionResponse>(
    `/chat/conversations/${conversationId}/suggestion`,
    {
      method: "POST",
      body: messageId ? JSON.stringify({ messageId }) : undefined,
    },
  );
}

export type FaqAdminItem = {
  key: string;
  intent: string;
  answerTemplate: string;
  requiredParams: string[];
  values: Record<string, string>;
  notApplicable: boolean;
  notApplicableReply: string | null;
  isActive: boolean;
  exists: boolean;
  missingKeys: string[];
  updatedAt: string | null;
  updatedBy: string | null;
};

export type UpdateFaqItemPayload = {
  intent?: string;
  answerTemplate?: string;
  requiredParams?: string[];
  values?: Record<string, string>;
  notApplicable?: boolean;
  notApplicableReply?: string;
  isActive?: boolean;
  confirm?: boolean;
};

/** Danh sách FAQ cho manager/admin; key chưa lưu hiện dưới dạng placeholder. */
export async function getFaqItems() {
  return apiRequest<FaqAdminItem[]>("/chat/faq");
}

export async function updateFaqItem(
  key: string,
  payload: UpdateFaqItemPayload,
) {
  return apiRequest<FaqAdminItem>(`/chat/faq/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export type AIAdvisorProduct = {
  garmentId: string;
  name: string;
  imageUrl: string;
  dailyPrice: number;
  depositAmount: number;
  size: string;
  reason: string;
  inStock: boolean;
};

export type AIAdvisorTopic = {
  title: string;
  assistantReply: string;
  recommendedProductIds: string[];
  reasons: Record<string, string>;
  products: AIAdvisorProduct[];
};

export type AIAdvisorResponse = {
  topics: AIAdvisorTopic[];
};

export async function getProductAdvisor(params: {
  message: string;
  history?: AdvisorHistoryItem[];
  rentalStartDate?: string;
  rentalEndDate?: string;
}) {
  return apiRequest<AIAdvisorResponse>("/ai/product-advisor", {
    method: "POST",
    body: JSON.stringify({
      message: params.message,
      history: params.history,
      rentalStartDate: params.rentalStartDate,
      rentalEndDate: params.rentalEndDate,
    }),
  });
}

/**
 * Shared send-message emit logic extracted from 4 duplicated copies.
 * Caller must add the optimistic message to `setMessages` before calling.
 */
export function emitChatMessage(params: {
  socket: { connected: boolean; on: (event: string, fn: (...args: unknown[]) => void) => unknown; once: (event: string, fn: (...args: unknown[]) => void) => unknown; emit: (event: string, ...args: unknown[]) => unknown; connect: () => unknown };
  conversationId: string;
  content: string;
  tempId: string;
  sendTimeoutRef: { current: Map<string, ReturnType<typeof setTimeout>> };
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setFailedMessages: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  roomJoinedRef?: { current: boolean };
  /** Staff/manager trả lời trích dẫn một tin cụ thể. */
  replyToId?: string | null;
}) {
  const { socket, conversationId, content, tempId, sendTimeoutRef, setMessages, setFailedMessages } = params;
  const roomJoinedRef = params.roomJoinedRef;
  const replyToId = params.replyToId ?? null;

  const doEmit = () => {
    socket.emit("send_message", { conversationId, content, tempId, ...(replyToId ? { replyToId } : {}) }, (ack: { success?: boolean; error?: string; tempId?: string } | undefined) => {
      const t = sendTimeoutRef.current.get(tempId);
      if (t) { clearTimeout(t); sendTimeoutRef.current.delete(tempId); }
      if (ack && ack.success && ack.tempId) {
        setFailedMessages((prev) => {
          const next = new Set(prev);
          next.delete(ack.tempId!);
          return next;
        });
      } else if (!ack || !ack.success) {
        setFailedMessages((prev) => new Set(prev).add(tempId));
      }
    });

    const timeout = setTimeout(() => {
      sendTimeoutRef.current.delete(tempId);
      setFailedMessages((prev) => new Set(prev).add(tempId));
    }, 5000);
    sendTimeoutRef.current.set(tempId, timeout);
  };

  if (!socket.connected) {
    socket.connect();
    socket.once("connect", doEmit);
  } else {
    doEmit();
  }
}

export async function uploadChatFile(conversationId: string, file: File) {
  const token = readStoredAccessToken();
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${apiBase}/chat/conversations/${conversationId}/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    throw new Error("Upload failed");
  }

  return (await res.json()) as { success: boolean; data: ChatMessage };
}