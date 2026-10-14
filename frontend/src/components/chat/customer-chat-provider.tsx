"use client";

import {
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

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedConversationRef = useRef<ChatConversation | null>(null);
  const sendTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const socketRef =
    useRef<ReturnType<typeof createChatSocket> | null>(null);
  const roomJoinedRef = useRef(false);

  // =============================
  // SOCKET INIT
  // =============================
  useEffect(() => {
    if (!session?.accessToken || !isCustomer || !enabled) return;

    socketRef.current = createChatSocket(session.accessToken);

    const socket = socketRef.current;

    const onConnect = () => {
      setTypingUsers({});
      const conv = selectedConversationRef.current;
      if (!conv) return;

      socket.emit("join_room", { conversationId: conv.id }, () => {
        roomJoinedRef.current = true;
      });
      socket.emit("open_conversation", { conversationId: conv.id });
      void loadMessages(conv.id);
    };

    const onMessageReceived = (payload: any) => {
      //console.log("MESSAGE_RECEIVED", payload.message.id, payload.message.content);
      // If the message is from current user, remove only the first matching optimistic message (fallback)
      if (payload.message.sender_id === session?.user.id) {
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
      if (payload.conversationId === selectedConversationRef.current?.id) {
        setMessages((prev) => [...prev, payload.message]);
        // Mark read via REST when receiving message from staff
        if (payload.message.sender_id !== selectedConversationRef.current?.customerId) {
          void markConversationRead(payload.conversationId);
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
  }, [session?.accessToken, isCustomer, enabled, authSignOut, refreshUser]);

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
    if (!session || !isCustomer || !enabled) return;
    void loadConversation();
  }, [session, isCustomer, enabled]);

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

  async function loadConversation() {
    const result = await getMyChatConversation();

    if (result.success && result.data) {
      const conv = result.data;

      setConversation(conv);
      selectedConversationRef.current = conv;

      const socket = socketRef.current;

      if (socket?.connected) {
        socket.emit("join_room", { conversationId: conv.id });
        socket.emit("open_conversation", { conversationId: conv.id });
      }

      void loadMessages(conv.id);

      // Mark read via REST when customer opens chat bubble
      void markConversationRead(conv.id);
    }
  }

  async function loadMessages(conversationId: string) {
    //console.log("LOAD", conversationId);

    const result = await getConversationMessages(conversationId);

    //console.log("RESULT", result.success);
    //console.log("COUNT", result.data?.length);

    if (result.success && result.data) {
      setMessages(result.data);
    }
  }

  async function loadOlderMessages() {
    if (
      !conversation ||
      messages.length === 0 ||
      loadingOlderMessages
    )
      return;

    const oldestMessage = messages[0];
    setLoadingOlderMessages(true);

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    const result = await getConversationMessages(
      conversation.id,
      oldestMessage.id
    );

    if (result.success && result.data) {
      if (result.data.length < 15) setHasMoreMessages(false);

      setMessages((prev) => [...(result.data ?? []), ...prev]);

      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop =
            container.scrollHeight - prevScrollHeight;
        }
      });
    }

    setLoadingOlderMessages(false);
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

    setTypingUsers((prev) => ({ ...prev, "ai-assistant": true }));

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
      />
    </>
  );
}