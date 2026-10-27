import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CustomerChatBubble } from "./customer-chat-bubble";
import type { ChatConversation, ChatMessage } from "@/lib/chat";
import { createRef } from "react";

const mockConversation: ChatConversation = {
  id: "conv-1",
  customerId: "customer-1",
  customerName: "Customer Test",
  staffId: "staff-1",
  staffName: "Staff Test",
  status: "open",
  updatedAt: new Date().toISOString(),
  lastMessage: null,
  unreadCount: 0,
  reopenedFromResolved: false,
};

const mockSession = {
  accessToken: "token",
  refreshToken: "refresh",
  user: {
    id: "customer-1",
    email: "customer@example.com",
    role: "customer" as const,
    isActive: true,
    fullName: "Customer Test",
    phone: null,
  },
};

describe("CustomerChatBubble scroll preservation", () => {
  it("preserves scroll position when older messages are prepended instead of jumping to bottom", () => {
    const containerRef = createRef<HTMLDivElement>();
    const onLoadOlderMessages = vi.fn();

    const initialMessages: ChatMessage[] = [
      {
        id: "msg-2",
        conversation_id: "conv-1",
        sender_id: "staff-1",
        sender_type: "staff",
        content: "Message 2",
        message_type: "text",
        metadata: null,
        created_at: new Date(Date.now() - 1000).toISOString(),
        deleted_at: null,
        deleted_by: null,
      },
      {
        id: "msg-3",
        conversation_id: "conv-1",
        sender_id: "customer-1",
        sender_type: "customer",
        content: "Message 3",
        message_type: "text",
        metadata: null,
        created_at: new Date().toISOString(),
        deleted_at: null,
        deleted_by: null,
      },
    ];

    const { rerender } = render(
      <CustomerChatBubble
        conversation={mockConversation}
        messages={initialMessages}
        messageText=""
        setMessageText={vi.fn()}
        typingUsers={{}}
        loadingMessages={false}
        session={mockSession}
        onSendMessage={vi.fn()}
        onTyping={vi.fn()}
        hasMoreMessages={true}
        loadingOlderMessages={false}
        onLoadOlderMessages={onLoadOlderMessages}
        messagesContainerRef={containerRef}
        onDeleteMessage={vi.fn()}
      />
    );

    // Open chat
    const openBtn = screen.getByRole("button", { name: /Mở chat/i });
    fireEvent.click(openBtn);

    const container = containerRef.current!;
    expect(container).toBeTruthy();

    // Mock scrollHeight and scrollTop
    Object.defineProperty(container, "scrollHeight", {
      value: 1000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 400,
      writable: true,
      configurable: true,
    });
    container.scrollTop = 30;

    // Simulate scrolling near top (<= 50)
    fireEvent.scroll(container, { target: { scrollTop: 30 } });
    expect(onLoadOlderMessages).toHaveBeenCalled();

    // Prepend an older message
    const olderMessage: ChatMessage = {
      id: "msg-1",
      conversation_id: "conv-1",
      sender_id: "staff-1",
      sender_type: "staff",
      content: "Older Message 1",
      message_type: "text",
      metadata: null,
      created_at: new Date(Date.now() - 5000).toISOString(),
      deleted_at: null,
      deleted_by: null,
    };

    // Container scrollHeight will increase when older messages are rendered
    Object.defineProperty(container, "scrollHeight", {
      value: 1500, // 500px added at top
      writable: true,
      configurable: true,
    });

    act(() => {
      rerender(
        <CustomerChatBubble
          conversation={mockConversation}
          messages={[olderMessage, ...initialMessages]}
          messageText=""
          setMessageText={vi.fn()}
          typingUsers={{}}
          loadingMessages={false}
          session={mockSession}
          onSendMessage={vi.fn()}
          onTyping={vi.fn()}
          hasMoreMessages={true}
          loadingOlderMessages={false}
          onLoadOlderMessages={onLoadOlderMessages}
          messagesContainerRef={containerRef}
          onDeleteMessage={vi.fn()}
        />
      );
    });

    // delta = 1500 - 1000 = 500; new scrollTop = 500 + 30 = 530
    // It should NOT be at the bottom (1500)
    expect(container.scrollTop).toBe(530);
    expect(container.scrollTop).not.toBe(1500);
  });
});

describe("CustomerChatBubble sender labels", () => {
  const baseMessage = {
    conversation_id: "conv-1",
    message_type: "text",
    metadata: null,
    created_at: new Date().toISOString(),
    deleted_at: null,
    deleted_by: null,
  };

  it("labels manager and staff messages above their bubbles", () => {
    const containerRef = createRef<HTMLDivElement>();
    const messages: ChatMessage[] = [
      {
        ...baseMessage,
        id: "msg-staff",
        sender_id: "staff-1",
        sender_type: "staff",
        content: "Nhân viên trả lời",
        user_accounts: {
          id: "staff-1",
          email: "staff@example.com",
          role: "staff",
          profile: { fullName: "Staff Test" },
        },
      },
      {
        ...baseMessage,
        id: "msg-manager",
        sender_id: "manager-1",
        content: "Quản lý trả lời",
        metadata: { managerSupport: true },
        user_accounts: {
          id: "manager-1",
          email: "manager@example.com",
          role: "manager_owner",
          profile: { fullName: "Manager Test" },
        },
      },
    ];

    render(
      <CustomerChatBubble
        conversation={mockConversation}
        messages={messages}
        messageText=""
        setMessageText={vi.fn()}
        typingUsers={{}}
        loadingMessages={false}
        session={mockSession}
        onSendMessage={vi.fn()}
        onTyping={vi.fn()}
        hasMoreMessages={false}
        loadingOlderMessages={false}
        onLoadOlderMessages={vi.fn()}
        messagesContainerRef={containerRef}
        onDeleteMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mở chat/i }));

    expect(screen.getByText("Nhân viên")).toBeTruthy();
    expect(screen.getByText("Quản lý")).toBeTruthy();
  });

  it("does not label the customer's own messages", () => {
    const containerRef = createRef<HTMLDivElement>();

    render(
      <CustomerChatBubble
        conversation={mockConversation}
        messages={[
          {
            ...baseMessage,
            id: "msg-customer",
            sender_id: "customer-1",
            sender_type: "customer",
            content: "Khách hỏi",
          },
        ]}
        messageText=""
        setMessageText={vi.fn()}
        typingUsers={{}}
        loadingMessages={false}
        session={mockSession}
        onSendMessage={vi.fn()}
        onTyping={vi.fn()}
        hasMoreMessages={false}
        loadingOlderMessages={false}
        onLoadOlderMessages={vi.fn()}
        messagesContainerRef={containerRef}
        onDeleteMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mở chat/i }));

    expect(screen.queryByText("Nhân viên")).toBeNull();
    expect(screen.queryByText("Quản lý")).toBeNull();
  });
});
