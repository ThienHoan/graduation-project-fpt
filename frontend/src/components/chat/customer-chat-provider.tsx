"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { createChatSocket } from "@/lib/socket";
import {
  emitChatMessage,
  getConversationMessages,
  getMyChatConversation,
  markConversationRead,
  type ChatConversation,
  type ChatMessage,
} from "@/lib/chat";
import { CustomerChatBubble } from "@/app/chat/customer-chat-bubble";

const MESSAGES_FRESH_MS = 10_000;

interface CustomerChatProviderProps {
  children?: ReactNode;
}

export function CustomerChatProvider({ children }: CustomerChatProviderProps) {
  const { session, signOut: authSignOut, refreshUser } = useAuth();
  const pathname = usePathname();

  const isCustomer = session?.user.role === "customer";

  // =============================
  // ROUTE-BASED ENABLE RULE
  // =============================
  const enabled = useMemo(() => {
    if (!isCustomer) return false;

    return (
      pathname === "/" ||
      pathname.startsWith("/catalog") ||
      pathname.startsWith("/garment") ||
      pathname.startsWith("/booking") ||
      pathname.startsWith("/dashboard/customer") ||
      pathname.startsWith("/try-on")
    );
  }, [pathname, isCustomer]);

  const [conversation, setConversation] =
    useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [failedMessages, setFailedMessages] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedConversationRef = useRef<ChatConversation | null>(null);
  const chatOpenRef = useRef(false);
  const sendTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const socketRef =
    useRef<ReturnType<typeof createChatSocket> | null>(null);
  const roomJoinedRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  // Giữ lại thời điểm nạp tin nhắn gần nhất để không gọi lại API khi vừa mở
  // bubble (dữ liệu còn mới) và để gộp các lần gọi trùng nhau.
  const messagesLoadedAtRef = useRef(0);
  const messagesLoadedConvRef = useRef<string | null>(null);
  const loadMessagesInFlightRef = useRef<Promise<void> | null>(null);
  const loadMessagesInFlightConvRef = useRef<string | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    const result = await getMyChatConversation();
    if (!result.success || !result.data) return;

    const conv = result.data;
    if (!chatOpenRef.current) {
      // Không hạ badge xuống thấp hơn số vừa tăng từ socket: response API
      // có thể cũ nếu nó bắt đầu trước tin nhắn mới.
      setUnreadCount((prev) => Math.max(prev, conv.unreadCount ?? 0));
      return;
    }

    setUnreadCount(0);
    void markConversationRead(conv.id);
  }, []);

  // =============================
  // SOCKET INIT
  // =============================
  useEffect(() => {
    if (!session?.accessToken || !isCustomer || !enabled) return;

    socketRef.current = createChatSocket(session.accessToken);

    const socket = socketRef.current;

    const onConnect = () => {
      setTypingUsers({});
      const isReconnect = hasConnectedOnceRef.current;
      hasConnectedOnceRef.current = true;
      const conv = selectedConversationRef.current;
      if (!conv) return;

      socket.emit("join_room", { conversationId: conv.id }, () => {
        roomJoinedRef.current = true;
      });
      socket.emit("open_conversation", { conversationId: conv.id });
      void loadMessages(conv.id, {
        force: isReconnect,
        silent: !chatOpenRef.current,
      });
      // Có thể đã lỡ tin nhắn trong lúc socket mất kết nối/đang kết nối.
      void refreshUnreadCount();
    };

    const onMessageReceived = (payload: any) => {
      //console.log("MESSAGE_RECEIVED", payload.message.id, payload.message.content);
      const isOwnMessage = payload.message.sender_id === session?.user.id;
      const isCurrentConversation = payload.conversationId === selectedConversationRef.current?.id;

      // If the message is from current user, remove only the first matching optimistic message (fallback)
      if (isOwnMessage) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id.startsWith("temp-") && m.content === payload.message.content);
          if (idx === -1) return prev;
          return prev.filter((_, i) => i !== idx);
        });
        setFailedMessages((prev) => {
          const next = new Set(prev);
          for (const id of prev) {
            if (id.startsWith("temp-")) next.delete(id);
          }
          return next;
        });
      }
      if (isCurrentConversation) {
        setMessages((prev) => {
          // Socket có thể phát lại cùng một message sau khi reconnect.
          if (prev.some((m) => m.id === payload.message.id)) return prev;
          return [...prev, payload.message];
        });
        if (!isOwnMessage) {
          if (chatOpenRef.current) {
            // Đang mở bubble: khách đã thấy tin, đánh dấu đã đọc ngay.
            setUnreadCount(0);
            void markConversationRead(payload.conversationId);
          } else {
            // Bubble đang đóng: tăng badge để khách biết có tin mới.
            setUnreadCount((prev) => prev + 1);
          }
        }
      }
    };

    const onMessageDeleted = (payload: {
      conversationId: string;
      messageId: string;
      deletedBy: string;
      deletedAt: string;
    }) => {
      if (payload.conversationId === selectedConversationRef.current?.id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? { ...m, deleted_at: payload.deletedAt, deleted_by: payload.deletedBy, content: "" }
              : m,
          ),
        );
      }
    };

    const onTyping = (payload: {
      conversationId: string;
      isTyping: boolean;
      userId: string;
    }) => {
      if (payload.conversationId !== selectedConversationRef.current?.id)
        return;

      setTypingUsers((prev) => ({
        ...prev,
        [payload.userId]: payload.isTyping,
      }));
    };

    // const onCustomMessageReceived = (event: CustomEvent<{
    //   conversationId: string;
    //   message: ChatMessage;
    // }>) => {
    //   const { conversationId, message } = event.detail;
    //   if (conversationId === selectedConversationRef.current?.id) {
    //     setMessages((prev) => [...prev, message]);
    //   }
    // };

    const onDisconnect = (reason: string) => {
      roomJoinedRef.current = false;
      if (reason === "io server disconnect") {
        void refreshUser().then((user) => {
          if (!user) authSignOut();
        });
        socket.connect();
      }
    };

    //socket.onAny((event, ...args) => {
    //  console.log("EVENT", event, args);
    //});
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message_received", onMessageReceived);
    socket.on("message_deleted", onMessageDeleted);
    socket.on("typing", onTyping);
    socket.on("user_typing", onTyping);

    if (socket.connected) onConnect();

    return () => {
      socket.offAny();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message_received", onMessageReceived);
      socket.off("message_deleted", onMessageDeleted);
      socket.off("typing", onTyping);
      socket.off("user_typing", onTyping);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.accessToken, isCustomer, enabled, authSignOut, refreshUser, refreshUnreadCount]);

  // =============================
  // CLEANUP SOCKET
  // =============================
  useEffect(() => {
    return () => {
      for (const t of sendTimeoutRef.current.values()) clearTimeout(t);
      sendTimeoutRef.current.clear();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // =============================
  // LOAD CONVERSATION
  // =============================
  useEffect(() => {
    if (!session?.accessToken || !isCustomer || !enabled) return;
    void loadConversation();
  }, [session?.accessToken, isCustomer, enabled]);

  // Lắng nghe sự kiện mở chat từ các màn hình (vd: Tư vấn size, gửi khiếu nại)
  // để nạp lại tin nhắn mới nhất ngay lập tức
  useEffect(() => {
    if (!enabled) return;
    const handleChatOpen = () => {
      const convId = selectedConversationRef.current?.id;
      if (convId) {
        void loadMessages(convId);
      } else {
        void loadConversation();
      }
    };
    window.addEventListener("chat:open", handleChatOpen);
    return () => window.removeEventListener("chat:open", handleChatOpen);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (chatOpenRef.current) return;
      void refreshUnreadCount();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, refreshUnreadCount]);

  async function loadConversation() {
    const result = await getMyChatConversation();

    if (result.success && result.data) {
      const conv = result.data;

      setConversation(conv);
      selectedConversationRef.current = conv;
      setUnreadCount((prev) => {
        if (chatOpenRef.current) return 0;
        return Math.max(prev, conv.unreadCount ?? 0);
      });

      const socket = socketRef.current;

      if (socket?.connected) {
        socket.emit("join_room", { conversationId: conv.id });
        socket.emit("open_conversation", { conversationId: conv.id });
      }

      // Nạp tin nhắn nền: không bật spinner khi bubble đang đóng để mở chat
      // là thấy ngay nội dung đã có, không phải chờ.
      void loadMessages(conv.id, { silent: !chatOpenRef.current });

      // Chỉ đánh dấu đã đọc khi bubble thực sự đang mở. Nếu đóng,
      // giữ unreadCount để hiện badge trên nút chat.
      if (chatOpenRef.current) {
        setUnreadCount(0);
        void markConversationRead(conv.id);
      }
    }
  }

  function handleChatOpenChange(open: boolean) {
    chatOpenRef.current = open;
    if (!open) return;

    setUnreadCount(0);
    const conv = selectedConversationRef.current;
    if (!conv) return;

    void markConversationRead(conv.id);
    // Nếu vừa nạp xong (vd lúc mở app) thì bỏ qua; còn dữ liệu cũ mới refetch.
    void loadMessages(conv.id);
  }

  async function loadMessages(
    conversationId: string,
    options?: { silent?: boolean; force?: boolean },
  ) {
    const isSameConversation = messagesLoadedConvRef.current === conversationId;
    const isFresh =
      isSameConversation &&
      Date.now() - messagesLoadedAtRef.current < MESSAGES_FRESH_MS;
    if (!options?.force && isFresh) return;

    const inFlight = loadMessagesInFlightRef.current;
    if (inFlight && loadMessagesInFlightConvRef.current === conversationId) {
      return inFlight;
    }

    const silent = options?.silent ?? isSameConversation;
    if (!silent) setLoadingMessages(true);

    const request = (async () => {
      try {
        const result = await getConversationMessages(conversationId);
        if (result.success && result.data) {
          setMessages(result.data);
          // Trang mặc định trả 15 tin mới nhất. Chỉ khi đủ 15 mới có thể còn
          // tin cũ hơn để cuộn lên tải tiếp.
          setHasMoreMessages(result.data.length >= 15);
          messagesLoadedConvRef.current = conversationId;
          messagesLoadedAtRef.current = Date.now();
        }
      } finally {
        setLoadingMessages(false);
      }
    })();

    loadMessagesInFlightRef.current = request;
    loadMessagesInFlightConvRef.current = conversationId;
    void request
      .finally(() => {
        if (loadMessagesInFlightRef.current === request) {
          loadMessagesInFlightRef.current = null;
          loadMessagesInFlightConvRef.current = null;
        }
      })
      .catch(() => {});
    return request;
  }

  async function loadOlderMessages() {
    if (
      !conversation ||
      messages.length === 0 ||
      !hasMoreMessages ||
      loadingOlderMessages
    )
      return;

    const oldestMessage = messages[0];
    setLoadingOlderMessages(true);

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    try {
      const result = await getConversationMessages(
        conversation.id,
        oldestMessage.id
      );

      if (result.success && result.data) {
        if (result.data.length < 15) setHasMoreMessages(false);

        setMessages((prev) => [...(result.data ?? []), ...prev]);

        requestAnimationFrame(() => {
          if (container && prevScrollHeight > 0) {
            // Dự phòng nếu CustomerChatBubble chưa điều chỉnh vị trí cuộn
            if (container.scrollTop <= prevScrollTop + 50) {
              container.scrollTop =
                container.scrollHeight - prevScrollHeight + prevScrollTop;
            }
          }
        });
      }
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  // =============================
  // ACTIONS
  // =============================
  function sendMessage() {
    if (!socketRef.current || !conversation || !messageText.trim())
      return;

    const convId = conversation.id;
    const content = messageText.trim();
    setMessageText("");

    // Server chỉ phát "AI đang nhập" khi tin nhắn thực sự được đưa vào hàng đợi
    // (không phải tin rỗng/emoji hay hội thoại đang có staff xử lý).
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: convId,
      sender_id: session?.user.id ?? "",
      sender_type: "customer",
      content,
      message_type: "text",
      metadata: null,
      created_at: new Date().toISOString(),
      deleted_at: null,
      deleted_by: null,
    };
    setMessages((prev) => [...prev, optimistic]);

    emitChatMessage({ socket: socketRef.current, conversationId: convId, content, tempId, sendTimeoutRef, setMessages, setFailedMessages, roomJoinedRef });
  }

  function retrySendMessage(messageContent: string) {
    if (!socketRef.current || !conversation) return;

    const convId = conversation.id;
    const content = messageContent;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: convId,
      sender_id: session?.user.id ?? "",
      sender_type: "customer",
      content,
      message_type: "text",
      metadata: null,
      created_at: new Date().toISOString(),
      deleted_at: null,
      deleted_by: null,
    };
    setMessages((prev) => [...prev, optimistic]);

    emitChatMessage({ socket: socketRef.current, conversationId: convId, content, tempId, sendTimeoutRef, setMessages, setFailedMessages, roomJoinedRef });
  }

  function deleteMessage(messageId: string) {
    if (!socketRef.current || !conversation) return;

    socketRef.current.emit("delete_message", {
      conversationId: conversation.id,
      messageId,
    });
  }

  function setTyping(isTyping: boolean) {
    if (!socketRef.current || !conversation) return;

    socketRef.current.emit("typing", {
      conversationId: conversation.id,
      isTyping,
    });
  }

  // =============================
  // FINAL GUARD (IMPORTANT)
  // =============================
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <>
      {children}

      <CustomerChatBubble
        conversation={conversation}
        messages={messages}
        messageText={messageText}
        setMessageText={setMessageText}
        typingUsers={typingUsers}
        loadingMessages={loadingMessages}
        session={session}
        onSendMessage={sendMessage}
        onTyping={setTyping}
        hasMoreMessages={hasMoreMessages}
        loadingOlderMessages={loadingOlderMessages}
        onLoadOlderMessages={loadOlderMessages}
        messagesContainerRef={messagesContainerRef}
        onDeleteMessage={deleteMessage}
        failedMessages={failedMessages}
        onRetryMessage={retrySendMessage}
        unreadCount={unreadCount}
        onOpenChange={handleChatOpenChange}
      />
    </>
  );
}