"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { createChatSocket, disconnectChatSocket } from "@/lib/socket";
import {
  emitChatMessage,
  getChatConversations,
  getConversationLockStatus,
  getConversationHandoff,
  getConversationMessages,
  getMyChatConversation,
  getConversationWithCustomer,
  sendBookingCardMessage,
  getBookingCardData,
  getProductCardData,
  getBookingTopic,
  markConversationRead,
  startManagerSupport as startManagerSupportRequest,
  endManagerSupport as endManagerSupportRequest,
  type ChatConversation,
  type ChatMessage,
  type ConversationLockStatus,
  type StaffConversationTab,
} from "@/lib/chat";
import { CustomerChatBubble } from "./customer-chat-bubble";
import { StaffChatWorkspace } from "./staff-chat-workspace";
import { useRouter } from "next/navigation";
import { ManagerPortalShell, StaffPortalShell } from "@/components/heritage/ui";
export default function ChatPage() {
  const { session, status, signOut: authSignOut, refreshUser } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [lockStatus, setLockStatus] = useState<ConversationLockStatus | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [failedMessages, setFailedMessages] = useState<Set<string>>(new Set());
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [staffCanReply, setStaffCanReply] = useState(false);
  const [staffLockError, setStaffLockError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<StaffConversationTab>("needs_reply");
  const [notification, setNotification] = useState<string | null>(null);
  const [managerSupportLoading, setManagerSupportLoading] = useState(false);
  // Tin đang được trích dẫn để trả lời (chỉ staff/manager dùng).
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    content: string;
    senderLabel: string;
  } | null>(null);


  const previousConversationIdRef = useRef<string | null>(null);
  const currentConversationIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unassignedRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarTabRef = useRef(sidebarTab);
  sidebarTabRef.current = sidebarTab;
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedConversationRef = useRef<ChatConversation | null>(null);
  const messagesConversationIdRef = useRef<string | null>(null);
  // Track if we've already restored the staff workspace after socket connect.
  const autoOpenedRef = useRef(false); 
  const isAcceptingConversationRef = useRef(false);
  const hasManuallyInteractedRef = useRef(false);
  // Staff và Quản lý/Chủ cửa hàng (duyệt hoàn cọc) đều dùng workspace phía nhân viên
  const isManager = session?.user.role === "manager_owner";
  const isStaff = session?.user.role === "staff" || isManager;

  const assignedConversations = isStaff
    ? conversations.filter((conversation) => conversation.staffId === session?.user.id && conversation.status !== "resolved")
    : conversations;

  const socket = useMemo(() => {
    if (!session?.accessToken) {
      return null;
    }
    return createChatSocket(session.accessToken);
  }, [session?.accessToken]);

  const typingEntries = Object.entries(typingUsers).filter(([, isTyping]) => isTyping).map(([userId]) => userId);

  function applyManagerSupportFields(
    conversationId: string,
    fields: Partial<Pick<ChatConversation, "managerSupportBy" | "managerSupportState" | "managerSupportExpiresAt" | "status" | "staffId" | "staffName">>,
  ) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, ...fields } : conversation,
      ),
    );
    setSelectedConversation((prev) =>
      prev?.id === conversationId ? { ...prev, ...fields } : prev,
    );
  }

  const [isHydrated, setIsHydrated] = useState(false);
  const router = useRouter();
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Đổi hội thoại: bỏ trích dẫn đang chờ để không gửi reply sang hội thoại khác.
  useEffect(() => {
    setReplyTarget(null);
  }, [selectedConversation?.id]);

  // Mở đúng cuộc trò chuyện với khách khi vào /chat?customer=<id>&booking=<bookingId>
  // (vd từ nút "Nhắn khách xin thông tin chuyển khoản" ở màn duyệt hoàn cọc)
  useEffect(() => {
    if (!socket || !connected || !isStaff) return;
    if (autoOpenedRef.current || hasManuallyInteractedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const targetCustomerId = params.get("customer");
    const targetBookingId = params.get("booking");
    if (!targetCustomerId) return;

    autoOpenedRef.current = true;
    hasManuallyInteractedRef.current = true;
    void (async () => {
      const res = await getConversationWithCustomer(targetCustomerId);
      if (!res.success || !res.data) return;
      let conv = res.data;

      // Gắn ngữ cảnh đúng đơn đang hoàn cọc: nếu cuộc trò chuyện đang mang
      // topic/đơn khác (vd khiếu nại đơn cũ) thì gửi booking card của đơn này —
      // backend đồng thời cập nhật topic + booking_id của cuộc trò chuyện.
      if (targetBookingId && (conv.bookingId !== targetBookingId || conv.topic !== "booking_support")) {
        const cardRes = await sendBookingCardMessage({
          conversationId: conv.id,
          bookingId: targetBookingId,
          topic: "booking_support",
        });
        if (cardRes.success) {
          conv = { ...conv, topic: "booking_support", bookingId: targetBookingId };
        }
      }

      setConversations((prev) => {
        const rest = prev.filter((c) => c.id !== conv.id);
        return [conv, ...rest];
      });
      await joinConversation(conv.id, true, conv);
    })();
  }, [socket, connected, isStaff]);

  // Restore the first assigned staff conversation after reload and reclaim send permission.
  useEffect(() => {
    if (!socket || !connected || !isStaff || conversations.length === 0) return;
    if (autoOpenedRef.current) return;
    if (hasManuallyInteractedRef.current) return;
    // Có ?customer= thì nhường cho effect mở đúng khách ở trên
    if (new URLSearchParams(window.location.search).get("customer")) return;

    const myConv = assignedConversations[0];
    if (myConv && myConv.id !== selectedConversation?.id) {
      autoOpenedRef.current = true;
      void joinConversation(myConv.id, false);
    }
  }, [socket, connected, isStaff, conversations, assignedConversations, selectedConversation?.id]);

  useEffect(() => {
    if (!socket) return;

    const conv = () => selectedConversationRef.current;

    const onMessageReceived = (payload: { conversationId: string; message: ChatMessage; staffId?: string | null; status?: string; managerSupportBy?: string | null; managerSupportState?: ChatConversation["managerSupportState"]; managerSupportExpiresAt?: string | null; handoff?: ChatConversation["handoff"] | null }) => {

      const isOwnMessage = payload.message.sender_id === session?.user.id;
      const isSelectedConversation = payload.conversationId === conv()?.id;

      setMessages((prev) => {
        let next = prev;
        if (isOwnMessage) {
          // Thay optimistic message bằng bản ghi thật từ server.
          const optimisticIndex = next.findIndex(
            (message) => message.id.startsWith("temp-") && message.content === payload.message.content,
          );
          if (optimisticIndex !== -1) {
            next = next.filter((_, index) => index !== optimisticIndex);
          }
        }

        // Socket có thể phát lại cùng một message (reconnect/retry). Bỏ qua
        // bản ghi đã có để không hiển thị hai bong bóng giống nhau.
        if (next.some((message) => message.id === payload.message.id)) {
          return next;
        }

        if (!isSelectedConversation) return next;
        return [...next, payload.message];
      });

      if (isOwnMessage) {
        setFailedMessages((prev) => {
          const next = new Set(prev);
          for (const id of prev) {
            if (id.startsWith("temp-")) next.delete(id);
          }
          return next;
        });
        // Refresh lock status when staff sends a message (timeout is renewed by backend)
        void refreshLockStatus(payload.conversationId);
      } else if (isSelectedConversation) {
        // Mark read via REST when receiving message in active conversation
        void markConversationRead(payload.conversationId);
      }
      // Always update the sidebar conversation's lastMessage
      let updatedTopicFields: Record<string, unknown> | null = null;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== payload.conversationId) return c;
          let topicExtras: Record<string, unknown> = {};
          if (payload.message.sender_id === c.customerId && payload.message.message_type === "product_card") {
            const product = getProductCardData(payload.message);
            if (product) {
              topicExtras = { topic: "product_advice", garmentId: product.id, garmentName: product.name, bookingId: null };
            }
          } else if (payload.message.sender_id === c.customerId && payload.message.message_type === "booking_card") {
            const data = getBookingCardData(payload.message);
            if (data?.booking) {
              topicExtras = { topic: data.topic ?? "booking_support", bookingId: data.booking.id, garmentId: null, garmentName: null };
            }
          }
          const updated = {
            ...c,
            lastMessage: payload.message,
            updatedAt: payload.message.created_at,
            unreadCount: payload.message.sender_id !== session?.user.id ? c.unreadCount + 1 : 0,
            ...(payload.staffId !== undefined ? { staffId: payload.staffId } : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.managerSupportBy !== undefined ? { managerSupportBy: payload.managerSupportBy } : {}),
            ...(payload.managerSupportState !== undefined ? { managerSupportState: payload.managerSupportState } : {}),
            ...(payload.managerSupportExpiresAt !== undefined ? { managerSupportExpiresAt: payload.managerSupportExpiresAt } : {}),
            ...(payload.handoff !== undefined ? { handoff: payload.handoff } : {}),
            ...(payload.message.sender_id === c.customerId ? topicExtras : {}),
          };
          if (payload.conversationId === conv()?.id && Object.keys(topicExtras).length > 0) {
            updatedTopicFields = topicExtras;
          }
          return updated;
        }),
      );

      // Also update selectedConversation for real-time header update
      if (payload.conversationId === conv()?.id) {
        setSelectedConversation((prev) => {
          if (!prev) return prev;
          const updates: Record<string, unknown> = {};
          if (payload.staffId !== undefined) updates.staffId = payload.staffId;
          if (payload.status !== undefined) updates.status = payload.status;
          if (payload.managerSupportBy !== undefined) updates.managerSupportBy = payload.managerSupportBy;
          if (payload.managerSupportState !== undefined) updates.managerSupportState = payload.managerSupportState;
          if (payload.managerSupportExpiresAt !== undefined) updates.managerSupportExpiresAt = payload.managerSupportExpiresAt;
          if (payload.handoff !== undefined) updates.handoff = payload.handoff;
          if (updatedTopicFields) Object.assign(updates, updatedTopicFields);
          return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
        });
      }

      // Phiên quản lý hỗ trợ dùng chung tab Cá nhân: tin mới làm hội thoại
      // chuyển giữa "Cần trả lời" và "Chờ phản hồi", nên làm mới danh sách.
      const supportOwner = payload.managerSupportBy ?? conv()?.managerSupportBy ?? null;
      if (
        supportOwner === session?.user.id &&
        (sidebarTabRef.current === "needs_reply" ||
          sidebarTabRef.current === "awaiting_reply")
      ) {
        scheduleSidebarRefresh(sidebarTabRef.current);
      }
    };
    const onMessageDeleted = (payload: { conversationId: string; messageId: string; deletedBy: string; deletedAt: string }) => {
      if (payload.conversationId === conv()?.id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? { ...m, deleted_at: payload.deletedAt, deleted_by: payload.deletedBy, content: "" }
              : m,
          ),
        );
      }
      // Also update sidebar lastMessage if it was the deleted message
      setConversations((prev) =>
        prev.map((c) =>
          c.id === payload.conversationId && c.lastMessage?.id === payload.messageId
            ? { ...c, lastMessage: { ...c.lastMessage, deleted_at: payload.deletedAt, deleted_by: payload.deletedBy, content: "" } }
            : c,
        ),
      );
    };
    const onConversationRead = (payload: { conversationId: string; readerId: string }) => {
      if (payload.conversationId !== conv()?.id) return;
      setTypingUsers((prev) => ({ ...prev, [payload.readerId]: false }));
    };
    const onTyping = (payload: { conversationId: string; isTyping: boolean; userId: string }) => {
      if (payload.conversationId !== conv()?.id) return;
      setTypingUsers((prev) => ({ ...prev, [payload.userId]: payload.isTyping }));
    };
    const onOpenResult = (payload: { conversationId?: string; canReply: boolean; lockedBy?: string; staffId?: string; staffName?: string; status?: string }) => {
      const conversationId = payload.conversationId ?? conv()?.id;
      setStaffCanReply(payload.canReply);
      setStaffLockError(payload.canReply ? null : `Bị khoá bởi ${payload.lockedBy ?? "người khác"}`);

      if (payload.canReply && conversationId && session?.user) {
        const staffName = session.user.fullName ?? session.user.email;
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, staffId: session.user.id, staffName, status: payload.status ?? conversation.status }
              : conversation,
          ),
        );
        setSelectedConversation((prev) =>
          prev?.id === conversationId ? { ...prev, staffId: session.user.id, staffName, status: payload.status ?? prev.status } : prev,
        );
          if (isAcceptingConversationRef.current) {
            // Chuyển ngay sang tab Cá nhân sau khi Tiếp nhận / Tư vấn bổ sung.
            // Dùng ref vì effect socket được tạo với closure cũ.
            const current = selectedConversationRef.current;
            const last = current?.lastMessage;
            const lastFromStaff =
              last != null && last.sender_id !== current?.customerId && last.sender_type !== "ai";
            setSidebarTab(lastFromStaff ? "awaiting_reply" : "needs_reply");
            isAcceptingConversationRef.current = false;
          }
      } else if (isAcceptingConversationRef.current) {
        isAcceptingConversationRef.current = false;
      }

      void refreshLockStatus(conversationId);
    };
    const onChatLocked = (payload: { conversationId: string; staffName: string }) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === payload.conversationId ? { ...conversation, staffName: payload.staffName } : conversation,
        ),
      );

      if (payload.conversationId === conv()?.id) {
        void refreshLockStatus();
      }
    };
    const onChatUnlocked = (payload: { conversationId: string; status?: string; released?: boolean }) => {
      const isRevertingToResolved = payload.status === "resolved";
      // Server cũ không gửi `released`; mặc định coi như đã nhả để tương thích.
      const wasReleased = payload.released !== false;
      const shouldClearStaff = !isRevertingToResolved && wasReleased;

      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === payload.conversationId
            ? {
                ...conversation,
                ...(shouldClearStaff
                  ? {
                      staffId: null,
                      staffName: null,
                      managerSupportBy: null,
                      managerSupportState: null,
                      managerSupportExpiresAt: null,
                    }
                  : {}),
                status: payload.status ?? conversation.status,
              }
            : conversation,
        ),
      );
      if (payload.conversationId === conv()?.id) {
        setSelectedConversation((prev) =>
          prev
            ? {
                ...prev,
                ...(shouldClearStaff
                  ? {
                      staffId: null,
                      staffName: null,
                      managerSupportBy: null,
                      managerSupportState: null,
                      managerSupportExpiresAt: null,
                    }
                  : {}),
                status: payload.status ?? prev.status,
              }
            : prev,
        );
        setStaffCanReply(false);
        // Nếu assignment vẫn giữ nguyên (released=false), giữ thông báo
        // "Phiên trả lời đã hết hạn" thay vì xoá mất lý do composer bị khoá.
        if (shouldClearStaff) {
          setStaffLockError(null);
        }
        void refreshLockStatus();
      }

      // Refresh đúng tab đang xem nếu hội thoại vừa được nhả về hàng chờ.
      // Hội thoại có tin cuối của staff sẽ nằm ở "Chờ khách", còn lại ở
      // "Chờ tiếp nhận"; cả hai đều thuộc nhóm Chung.
      if (isStaff && wasReleased && !isRevertingToResolved) {
        if (
          sidebarTabRef.current === "unassigned" ||
          sidebarTabRef.current === "waiting_customer"
        ) {
          scheduleSidebarRefresh(sidebarTabRef.current);
        } else {
          setNotification("Có hội thoại vừa được chuyển về hàng chờ.");
          if (notificationTimerRef.current) {
            clearTimeout(notificationTimerRef.current);
          }
          notificationTimerRef.current = setTimeout(() => setNotification(null), 4000);
        }
      }
    };
    const onLockExpired = (payload: { conversationId: string }) => {
      if (payload.conversationId === conv()?.id) {
        setStaffCanReply(false);
        setStaffLockError("Phiên trả lời đã hết hạn.");
        void refreshLockStatus();
      }
      // Hết lock thì hội thoại không còn thuộc "Chờ phản hồi" nữa, kể cả khi
      // staff đang mở một hội thoại khác.
      if (sidebarTabRef.current === "awaiting_reply") {
        scheduleSidebarRefresh("awaiting_reply");
      }
    };
    const onConversationResolved = (payload: { conversationId: string; status?: string }) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === payload.conversationId
            ? { ...conversation, status: payload.status ?? "resolved", topic: "general", garmentId: null, garmentName: null }
            : conversation,
        ),
      );
      if (payload.conversationId === conv()?.id) {
        setSelectedConversation((prev) => prev ? { ...prev, status: payload.status ?? "resolved", topic: "general", garmentId: null, garmentName: null } : prev);
        setStaffCanReply(false);
        setStaffLockError("Cuộc trò chuyện đã được đánh dấu đã tư vấn.");
        void refreshLockStatus();
      }
    };
    const onManagerSupportUpdated = (payload: {
      conversationId: string;
      status?: string;
      staffId?: string | null;
      managerSupportBy?: string | null;
      managerSupportState?: ChatConversation["managerSupportState"];
      managerSupportExpiresAt?: string | null;
    }) => {
      const { conversationId, ...fields } = payload;
      applyManagerSupportFields(conversationId, fields);
      if (fields.managerSupportBy && fields.managerSupportBy === session?.user.id) {
        setStaffCanReply(false);
        setStaffLockError(null);
      }
      // Phiên hỗ trợ dùng chung tab Cá nhân: hội thoại có thể vừa chuyển
      // giữa "Cần trả lời" / "Chờ phản hồi" nên làm mới danh sách đang xem.
      if (
        sidebarTabRef.current === "needs_reply" ||
        sidebarTabRef.current === "awaiting_reply"
      ) {
        scheduleSidebarRefresh(sidebarTabRef.current);
      }
    };
    const onManagerSupportReply = (payload: {
      conversationId: string;
      customerName?: string | null;
      content?: string;
      managerSupportBy?: string | null;
      managerSupportState?: ChatConversation["managerSupportState"];
      managerSupportExpiresAt?: string | null;
    }) => {
      applyManagerSupportFields(payload.conversationId, {
        managerSupportBy: payload.managerSupportBy,
        managerSupportState: payload.managerSupportState,
        managerSupportExpiresAt: payload.managerSupportExpiresAt,
      });
      setNotification(`Khách hàng ${payload.customerName ?? ""} đã trả lời trong phiên hỗ trợ.`.trim());
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      notificationTimerRef.current = setTimeout(() => setNotification(null), 5000);
    };
    const onManagerSupportEnded = (payload: { conversationId: string; status?: string; released?: boolean }) => {
      // Server luôn giữ resolved + staff phụ trách khi kết thúc/hết hạn hỗ trợ.
      // Hội thoại chỉ quay lại hàng "Chờ tiếp nhận" khi khách gửi tin mới.
      applyManagerSupportFields(payload.conversationId, {
        managerSupportBy: null,
        managerSupportState: null,
        managerSupportExpiresAt: null,
        status: payload.status ?? "resolved",
      });
      if (payload.conversationId === conv()?.id) {
        setStaffCanReply(false);
        setStaffLockError("Đã kết thúc hỗ trợ.");
      }
      scheduleSidebarRefresh(sidebarTabRef.current);
    };
    const onHandoffUpdated = (payload: { conversationId: string; handoff?: ChatConversation["handoff"] | null }) => {
      // Backend gửi lại handoff khi join phòng / khi có tin mới. Đồng bộ cả
      // sidebar lẫn header để badge không bị lệch sau khi reconnect.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === payload.conversationId ? { ...c, handoff: payload.handoff ?? null } : c,
        ),
      );
      setSelectedConversation((prev) =>
        prev?.id === payload.conversationId ? { ...prev, handoff: payload.handoff ?? null } : prev,
      );
    };
    const onNewUnassignedMessage = (payload: { conversationId: string; customerName: string; content: string }) => {
      setNotification(`Có tin nhắn mới từ khách hàng ${payload.customerName}`);
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      notificationTimerRef.current = setTimeout(() => setNotification(null), 4000);

      // If we don't already have this conversation in the sidebar, add a lightweight placeholder
      setConversations((prev) => {
        if (prev.some((c) => c.id === payload.conversationId)) return prev;
        const newConv: ChatConversation = {
          id: payload.conversationId,
          customerId: "",
          customerName: payload.customerName,
          staffId: null,
          staffName: null,
          status: "open",
          updatedAt: new Date().toISOString(),
          lastMessage: {
            id: `notif-${Date.now()}`,
            conversation_id: payload.conversationId,
            sender_id: "customer",
            content: payload.content,
            created_at: new Date().toISOString(),
          },
          unreadCount: 1,
          reopenedFromResolved: false,
        };
        return [newConv, ...prev];
      });
    };
    const onSendError = (payload: { conversationId: string; reason: string; tempId?: string }) => {
      if (payload.conversationId !== conv()?.id) return;
      if (payload.tempId) {
        setFailedMessages((prev) => new Set(prev).add(payload.tempId!));
      }
      switch (payload.reason) {
        case "conversation_locked":
          setStaffLockError("Không thể gửi tin nhắn: cuộc trò chuyện chưa được mở khóa.");
          break;
        case "message_too_long":
          setNotification("Tin nhắn vượt quá 2000 ký tự.");
          break;
        case "forbidden_payload":
          setNotification("Không thể gửi định dạng tin nhắn này.");
          break;
        case "rate_limited":
          setNotification("Bạn đang gửi tin nhắn quá nhanh, vui lòng chậm lại.");
          break;
        default:
          setNotification("Không thể gửi tin nhắn.");
      }
      if (payload.reason !== "conversation_locked") {
        const t = notificationTimerRef.current;
        if (t) clearTimeout(t);
        notificationTimerRef.current = setTimeout(() => setNotification(null), 4000);
      }
    };

    socket.on("message_received", onMessageReceived);
    socket.on("message_deleted", onMessageDeleted);
    socket.on("conversation_read", onConversationRead);
    socket.on("typing", onTyping);
    socket.on("user_typing", onTyping);
    socket.on("open_conversation_result", onOpenResult);
    socket.on("chat_locked", onChatLocked);
    socket.on("chat_unlocked", onChatUnlocked);
    socket.on("lock_expired", onLockExpired);
    socket.on("new_unassigned_message", onNewUnassignedMessage);
    socket.on("send_error", onSendError);
    socket.on("conversation_resolved", onConversationResolved);
    socket.on("manager_support_updated", onManagerSupportUpdated);
    socket.on("manager_support_reply", onManagerSupportReply);
    socket.on("manager_support_ended", onManagerSupportEnded);
    socket.on("handoff_updated", onHandoffUpdated);

    return () => {
      socket.off("message_received", onMessageReceived);
      socket.off("message_deleted", onMessageDeleted);
      socket.off("conversation_read", onConversationRead);
      socket.off("typing", onTyping);
      socket.off("user_typing", onTyping);
      socket.off("open_conversation_result", onOpenResult);
      socket.off("chat_locked", onChatLocked);
      socket.off("chat_unlocked", onChatUnlocked);
      socket.off("lock_expired", onLockExpired);
      socket.off("new_unassigned_message", onNewUnassignedMessage);
      socket.off("send_error", onSendError);
      socket.off("conversation_resolved", onConversationResolved);
      socket.off("manager_support_updated", onManagerSupportUpdated);
      socket.off("manager_support_reply", onManagerSupportReply);
      socket.off("manager_support_ended", onManagerSupportEnded);
      socket.off("handoff_updated", onHandoffUpdated);
    };
  }, [socket, isStaff, session]);

  useEffect(() => {
    return () => {
      for (const t of sendTimeoutRef.current.values()) clearTimeout(t);
      sendTimeoutRef.current.clear();
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      if (unassignedRefreshTimerRef.current) {
        clearTimeout(unassignedRefreshTimerRef.current);
        unassignedRefreshTimerRef.current = null;
      }
    };
  }, [socket, isStaff]);

  useEffect(() => {
    if (!session?.accessToken) {
      disconnectChatSocket();
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (!session) return;
    void loadConversations(isStaff ? sidebarTab : undefined);
  }, [session, sidebarTab]);

  useEffect(() => {
    if (!isHydrated || status === "loading") return;

    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    if (session && !isStaff) {
      router.replace("/dashboard/customer?chat=open");
    }
  }, [isHydrated, status, session, isStaff, router]);

  useEffect(() => {
    if (!socket || !selectedConversation) return;
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    if (!messageText.trim()) {
      socket.emit("typing", { conversationId: selectedConversation.id, isTyping: false });
      return;
    }

    socket.emit("typing", { conversationId: selectedConversation.id, isTyping: true });
    typingTimerRef.current = setTimeout(() => {
      socket.emit("typing", { conversationId: selectedConversation.id, isTyping: false });
    }, 1200);

    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, [messageText, selectedConversation, socket]);

  selectedConversationRef.current = selectedConversation;

  // Socket connect/disconnect handler – re-join room for both staff and customers on reconnect
  useEffect(() => {
  if (!socket) return;

  // Ensure socket actively tries to connect if not already
  if (!socket.connected) {
    socket.connect();
  }

  const onConnect = () => {
    setConnected(true);
    const conv = selectedConversationRef.current;
    if (!conv) return;

    // Always re-join the room on (re)connect
    socket.emit("join_room", { conversationId: conv.id });

    if (isStaff && conv.staffId === session?.user.id) {
      socket.emit("open_conversation", { conversationId: conv.id });
    } else if (!isStaff) {
      // Customer re-opens their conversation on reconnect
      socket.emit("open_conversation", { conversationId: conv.id });
    }

    // Refresh messages to fill any gap while disconnected (merge instead of replace)
    void refreshMessages(conv.id);
    // Refresh conversation list to update unreadCount and new conversations
    void loadConversations(isStaff ? sidebarTab : undefined);
  };
  const onDisconnect = (reason: string) => {
    setConnected(false);
    if (reason === "io server disconnect") {
      void refreshUser().then((user) => {
        if (!user) authSignOut();
      });
      socket.connect();
    }
  };

  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);

  if (socket.connected) {
    onConnect();
  }

  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
  };
  }, [socket, isStaff, session, authSignOut, refreshUser]);

  async function loadConversations(tab?: string, options?: { silent?: boolean }) {
    if (!session) return;
    if (!options?.silent) {
      setLoadingConversations(true);
    }

    try {
      if (isStaff) {
        const result = await getChatConversations(tab);
        if (result.success && result.data) {
          setConversations(result.data);
        }
      } else {
        // Customer: POST to create or get existing conversation
        const result = await getMyChatConversation();
        if (result.success && result.data) {
          setConversations([result.data]);
          setSelectedConversation(result.data);
          void joinConversation(result.data.id);
          // Emit open_conversation will be handled by the connect handler
        }
      }
    } finally {
      if (!options?.silent) {
        setLoadingConversations(false);
      }
    }
  }

  function scheduleSidebarRefresh(tab = sidebarTabRef.current) {
    if (unassignedRefreshTimerRef.current) {
      clearTimeout(unassignedRefreshTimerRef.current);
    }
    // Gộp nhiều sự kiện unlock liên tiếp thành một request.
    unassignedRefreshTimerRef.current = setTimeout(() => {
      unassignedRefreshTimerRef.current = null;
      if (sidebarTabRef.current === tab) {
        void loadConversations(tab, { silent: true });
      }
    }, 300);
  }

  async function joinConversation(conversationId: string, isManual = false, convOverride?: ChatConversation) {
    if (!socket) return;
    currentConversationIdRef.current = conversationId;
    setLockStatus(null);

    if (isManual) hasManuallyInteractedRef.current = true;

    socket.emit("join_room", { conversationId });
    previousConversationIdRef.current = conversationId;
    const conv = convOverride ?? conversations.find((c) => c.id === conversationId) ?? null;
    
    setSelectedConversation(conv);
    setStaffCanReply(false);
    setStaffLockError(null);
    await loadMessages(conversationId);

    // Đồng bộ handoff qua REST: socket chỉ phát khi có sự kiện mới. Nếu hội
    // thoại đã có handoff mở từ trước (vd mở lại sau reload), phải lấy tại đây.
    if (isStaff) {
      void getConversationHandoff(conversationId).then((res) => {
        if (!res.success) return;
        const handoff = res.data?.handoff ?? null;
        setSelectedConversation((prev) =>
          prev?.id === conversationId ? { ...prev, handoff } : prev,
        );
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, handoff } : c)),
        );
      });
    }

    // Mark read via REST when assigned staff opens a conversation, or when the
    // current manager is running a manager-support session on a resolved one.
    const managerSupportMine =
      conv?.managerSupportBy === session?.user.id &&
      (!conv?.managerSupportExpiresAt ||
        new Date(conv.managerSupportExpiresAt).getTime() > Date.now());
    if (
      managerSupportMine ||
      (conv?.status !== "resolved" && conv?.staffId === session?.user.id)
    ) {
      void markConversationRead(conversationId);
    }

    if (conv && conv.staffId === session?.user.id && conv.status !== "resolved") {
      socket.emit("open_conversation", { conversationId });
    } else {
      void refreshLockStatus(conversationId);
    }
  }

  async function loadMessages(conversationId: string) {
    setLoadingMessages(true);
    setHasMoreMessages(false);
    setFailedMessages(new Set());
    const result = await getConversationMessages(conversationId);
    if (currentConversationIdRef.current !== conversationId) {
      setLoadingMessages(false);
      return;
    }
    if (result.success && result.data) {
      messagesConversationIdRef.current = conversationId;
      setMessages(result.data);
      setHasMoreMessages(result.data.length >= 15);
    }
    setLoadingMessages(false);
  }

  async function refreshMessages(conversationId: string) {
    setLoadingMessages(true);
    const result = await getConversationMessages(conversationId);
    if (result.success && result.data) {
      const latestMessages = result.data;
      const messagesConvId = messagesConversationIdRef.current;
      if (messagesConvId !== conversationId) {
        messagesConversationIdRef.current = conversationId;
        setMessages(latestMessages);
        setHasMoreMessages(latestMessages.length >= 15);
      } else {
        setMessages((prev) => {
          if (prev.length === 0) return latestMessages;
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = latestMessages.filter(m => !existingIds.has(m.id));
          const confirmedContent = new Set(latestMessages.map(m => `${m.sender_id}:${m.content}`));
          const cleaned = prev.filter(m =>
            !m.id.startsWith("temp-") || !confirmedContent.has(`${m.sender_id}:${m.content}`)
          );
          if (newMsgs.length === 0 && cleaned.length === prev.length) return prev;
          return [...cleaned, ...newMsgs].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
        setHasMoreMessages(latestMessages.length >= 15);
      }
    }
    setLoadingMessages(false);
  }

  async function loadOlderMessages() {
    if (!selectedConversation || messages.length === 0 || loadingOlderMessages) return;
    const convId = selectedConversation.id;
    const oldestMessage = messages[0];
    setLoadingOlderMessages(true);

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    const result = await getConversationMessages(convId, oldestMessage.id);
    if (currentConversationIdRef.current !== convId) {
      setLoadingOlderMessages(false);
      return;
    }
    if (result.success && result.data) {
      if (result.data.length < 15) {
        setHasMoreMessages(false);
      }
      setMessages((prev) => [...(result.data ?? []), ...prev]);

      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    }
    setLoadingOlderMessages(false);
  }

  async function refreshLockStatus(conversationId = selectedConversation?.id) {
    if (!conversationId) return;
    const targetId = conversationId;
    const result = await getConversationLockStatus(conversationId);
    if (result.success && result.data && targetId === currentConversationIdRef.current) {
      setLockStatus(result.data);
    }
  }


  function openConversation() {
    if (!socket) {
      console.warn("openConversation: socket is null, cannot emit");
      return;
    }
    if (!selectedConversation) return;
    // Cả "Tiếp nhận" (chưa có staff) và "Tư vấn bổ sung" (mở lại hội thoại
    // resolved) đều phải đưa hội thoại sang tab Cá nhân ngay khi thành công.
    isAcceptingConversationRef.current =
      selectedConversation.staffId === null || selectedConversation.status === "resolved";

    const doEmit = () => {
      socket!.emit("open_conversation", { conversationId: selectedConversation!.id });
    };

    if (!socket.connected) {
      socket.connect();
      socket.once("connect", doEmit);
    } else {
      doEmit();
    }
  }
  const sendTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function sendMessage() {
    if (!socket || !selectedConversation || !messageText.trim()) return;
    const convId = selectedConversation.id;
    const content = messageText.trim();
    setMessageText("");

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingReply = replyTarget;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: convId,
      sender_id: session?.user.id ?? "",
      sender_type: isStaff ? "staff" : "customer",
      content,
      message_type: "text",
      metadata: null,
      replyTo: pendingReply
        ? { id: pendingReply.id, content: pendingReply.content }
        : null,
      created_at: new Date().toISOString(),
      deleted_at: null,
      deleted_by: null,
    };

    setMessages((prev) => [...prev, optimistic]);
    setReplyTarget(null);

    emitChatMessage({ socket, conversationId: convId, content, tempId, sendTimeoutRef, setMessages, setFailedMessages, replyToId: pendingReply?.id });
  }

  function startReply(message: ChatMessage) {
    if (!isStaff) return;
    const label =
      message.sender_id === selectedConversation?.customerId
        ? selectedConversation?.customerName ?? "khách"
        : message.sender_type === "ai"
          ? "Trợ lý AI"
          : message.user_accounts?.profile?.fullName ??
            message.user_accounts?.email ??
            "nhân viên";
    setReplyTarget({
      id: message.id,
      content:
        message.message_type && message.message_type !== "text"
          ? `[${message.message_type}]`
          : message.content.slice(0, 300),
      senderLabel: label,
    });
  }

  function retrySendMessage(messageContent: string) {
    if (!socket || !selectedConversation) return;
    const convId = selectedConversation.id;
    const content = messageContent;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: convId,
      sender_id: session?.user.id ?? "",
      sender_type: isStaff ? "staff" : "customer",
      content,
      message_type: "text",
      metadata: null,
      created_at: new Date().toISOString(),
      deleted_at: null,
      deleted_by: null,
    };

    setMessages((prev) => [...prev, optimistic]);

    emitChatMessage({ socket, conversationId: convId, content, tempId, sendTimeoutRef, setMessages, setFailedMessages });
  }

  function deleteMessage(messageId: string) {
    if (!socket || !selectedConversation) return;
    socket.emit("delete_message", { conversationId: selectedConversation.id, messageId });
  }

  function resolveConversation() {
    if (!socket || !selectedConversation || !isStaff) return;
    socket.emit("resolve_conversation", { conversationId: selectedConversation.id });
  }

  async function handleStartManagerSupport() {
    if (!selectedConversation || !isManager || managerSupportLoading) return;
    const conversationId = selectedConversation.id;
    setManagerSupportLoading(true);
    try {
      const res = await startManagerSupportRequest(conversationId);
      if (!res.success || !res.data) {
        setNotification(res.error ?? "Không thể bắt đầu hỗ trợ hội thoại.");
        return;
      }
      applyManagerSupportFields(conversationId, {
        managerSupportBy: res.data.managerSupportBy,
        managerSupportState: res.data.managerSupportState,
        managerSupportExpiresAt: res.data.managerSupportExpiresAt,
        status: res.data.status,
        staffId: res.data.staffId,
      });
      // Phiên hỗ trợ dùng chung tab Cá nhân với staff: chuyển ngay sang tab
      // đúng với tin cuối để quản lý thấy hội thoại vừa mở.
      const lastMessage = selectedConversation.lastMessage;
      const lastFromCustomer =
        !lastMessage ||
        lastMessage.sender_id === selectedConversation.customerId ||
        lastMessage.sender_type === "ai";
      setSidebarTab(lastFromCustomer ? "needs_reply" : "awaiting_reply");
      setNotification("Đã bắt đầu hỗ trợ với tư cách quản lý.");
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      notificationTimerRef.current = setTimeout(() => setNotification(null), 4000);
    } catch {
      setNotification("Không thể bắt đầu hỗ trợ hội thoại.");
    } finally {
      setManagerSupportLoading(false);
    }
  }

  async function handleEndManagerSupport() {
    if (!selectedConversation || !isManager || managerSupportLoading) return;
    const conversationId = selectedConversation.id;
    setManagerSupportLoading(true);
    try {
      const res = await endManagerSupportRequest(conversationId);
      if (!res.success || !res.data) {
        setNotification(res.error ?? "Không thể kết thúc hỗ trợ hội thoại.");
        return;
      }
      // Kết thúc hỗ trợ luôn giữ hội thoại ở trạng thái resolved + staff cũ.
      // Chỉ tin nhắn mới của khách sau thời điểm này mới đưa về hàng chờ.
      applyManagerSupportFields(conversationId, {
        managerSupportBy: null,
        managerSupportState: null,
        managerSupportExpiresAt: null,
        status: res.data.status,
        ...(res.data.staffId ? { staffId: res.data.staffId } : {}),
      });
      setStaffCanReply(false);
      setStaffLockError("Đã kết thúc hỗ trợ.");
      setNotification("Đã kết thúc hỗ trợ. Hội thoại vẫn thuộc nhân viên phụ trách.");
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      notificationTimerRef.current = setTimeout(() => setNotification(null), 4000);
      setSidebarTab("resolved");
      scheduleSidebarRefresh("resolved");
    } catch {
      setNotification("Không thể kết thúc hỗ trợ hội thoại.");
    } finally {
      setManagerSupportLoading(false);
    }
  }

  function setTyping(isTyping: boolean) {
    if (!socket || !selectedConversation) return;
    socket.emit("typing", { conversationId: selectedConversation.id, isTyping });
  }

  function handleSetSidebarTab(tab: StaffConversationTab) {
  hasManuallyInteractedRef.current = true;
  setSidebarTab(tab);
  }
  if (!isHydrated || status === "loading") {
  return <div className="min-h-screen bg-mist" />;
  }

  if (!isStaff) {
    return null; // hoặc loading, vì redirect effect sẽ chạy
  }

const chatContent = (
  <>
    {/* HEADER STATUS */}
    <div className="mb-4 flex justify-end">
      <div className="inline-flex items-center gap-2 rounded-full border border-sand bg-white px-3.5 py-1.5 text-xs text-stone-600 shadow-xs">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-jade animate-pulse" : "bg-stone-300"}`} />
        <span>Trạng thái kết nối:</span>
        <span className={`font-medium ${connected ? "text-jade" : "text-stone-500"}`}>
          {connected ? "Thời gian thực" : "Đang kết nối..."}
        </span>
      </div>
    </div>

    {/* WORKSPACE */}
    <StaffChatWorkspace
      conversations={conversations}
      selectedConversation={selectedConversation}
      messages={messages}
      messageText={messageText}
      setMessageText={setMessageText}
      typingUsers={typingUsers}
      typingEntries={typingEntries}
      loadingConversations={loadingConversations}
      loadingMessages={loadingMessages}
      lockStatus={lockStatus}
      staffCanReply={staffCanReply}
      staffLockError={staffLockError}
      sidebarTab={sidebarTab}
      setSidebarTab={handleSetSidebarTab}
      notification={notification}
      session={session}
      onJoinConversation={(id) => void joinConversation(id, true)}
      onSendMessage={sendMessage}
      onOpenConversation={openConversation}
      onResolveConversation={resolveConversation}
      onStartManagerSupport={() => void handleStartManagerSupport()}
      onEndManagerSupport={() => void handleEndManagerSupport()}
      managerSupportLoading={managerSupportLoading}
      onTyping={setTyping}
      hasMoreMessages={hasMoreMessages}
      loadingOlderMessages={loadingOlderMessages}
      onLoadOlderMessages={loadOlderMessages} 
      messagesContainerRef={messagesContainerRef}
      onDeleteMessage={deleteMessage}
      canDeleteMessages={staffCanReply}
      failedMessages={failedMessages}
      onRetryMessage={retrySendMessage}
      replyTarget={replyTarget}
      onReplyToMessage={startReply}
      onCancelReply={() => setReplyTarget(null)}
    />
  </>
);

if (isManager) {
  return (
    <ManagerPortalShell
      active="chat"
      title="Hộp thư CSKH"
      subtitle="Chat 1-1 với khách hàng — trao đổi thông tin chuyển khoản hoàn cọc."
      managerName={session?.user.fullName ?? session?.user.email?.split("@")[0] ?? "Quản lý cửa hàng"}
      managerEmail={session?.user.email ?? null}
      onTabChange={(key) => router.push(`/dashboard/manager#${key}`)}
    >
      {chatContent}
    </ManagerPortalShell>
  );
}

return (
  <StaffPortalShell
    active="chat"
    title="Hộp thư CSKH"
    subtitle="Chat 1-1 với khách hàng theo thời gian thực."
  >
    {chatContent}
  </StaffPortalShell>
);
}