import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockCreateChatSocket = vi.fn();
const mockDisconnectChatSocket = vi.fn();
const mockGetChatConversations = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockGetConversationLockStatus = vi.fn();
const mockGetMyChatConversation = vi.fn();
const mockGetChatConversationCounts = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: {
      accessToken: "token",
      user: { id: "staff-1", email: "staff@example.com", role: "staff", isActive: true, fullName: "Staff One", phone: null },
    },
  }),
}));

vi.mock("@/lib/socket", () => ({
  createChatSocket: (...args: unknown[]) => mockCreateChatSocket(...args),
  disconnectChatSocket: () => mockDisconnectChatSocket(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/chat", () => ({
  getChatConversations: (...args: unknown[]) => mockGetChatConversations(...args),
  getConversationMessages: (conversationId: string) => mockGetConversationMessages(conversationId),
  getConversationLockStatus: (conversationId: string) => mockGetConversationLockStatus(conversationId),
  getMyChatConversation: () => mockGetMyChatConversation(),
  getChatConversationCounts: () => mockGetChatConversationCounts(),
  buildAdvisorHistory: () => [],
  getProductAdvisor: vi.fn().mockResolvedValue({ success: true, data: { topics: [] } }),
  sendProductCardMessage: vi.fn(),
  uploadChatFile: vi.fn(),
  markConversationRead: vi.fn(),
  startManagerSupport: vi.fn().mockResolvedValue({ success: false }),
  endManagerSupport: vi.fn().mockResolvedValue({ success: false }),
}));

const mockSocket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

beforeEach(() => {
  mockCreateChatSocket.mockReturnValue(mockSocket);
  mockDisconnectChatSocket.mockClear();
  mockSocket.on.mockClear();
  mockSocket.off.mockClear();
  mockSocket.emit.mockClear();
  mockGetChatConversations.mockReset();
  mockGetConversationMessages.mockReset();
  mockGetConversationLockStatus.mockReset();
  mockGetMyChatConversation.mockReset();
  mockGetChatConversationCounts.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChatPage", () => {
  it("renders staff conversation list and joins a conversation", async () => {
    mockGetChatConversations.mockResolvedValue({
      success: true,
      data: [
        {
          id: "conv-1",
          customerId: "cust-1",
          customerName: "Khách 1",
          staffId: null,
          staffName: null,
          status: "open",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastMessage: { id: "msg-1", conversation_id: "conv-1", sender_id: "cust-1", content: "Xin chào", created_at: "2026-01-01T00:00:00.000Z" },
          unreadCount: 1,
        },
      ],
    });

    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-1",
          sender_id: "cust-1",
          content: "Xin chào",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 1, needsReply: 0, awaitingReply: 0, waitingCustomer: 0, resolved: 0 },
    });

    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");

    render(<ChatPage />);

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenCalled());

    expect(screen.getByText("Cần trả lời")).toBeInTheDocument();
    expect(screen.getByText("Chờ tiếp nhận")).toBeInTheDocument();
    expect(screen.getByText("Chung")).toBeInTheDocument();
    expect(screen.getByText("Cá nhân")).toBeInTheDocument();
    expect(screen.getByText("Chờ khách")).toBeInTheDocument();

    // Verify count badges are displayed ("Chờ phản hồi" and "Đã tư vấn" both show 0)
    expect(screen.getAllByText("0").length).toBeGreaterThan(0); // assigned count
    expect(screen.getByText("1")).toBeInTheDocument(); // unassigned count

    await userEvent.click(screen.getByText("Chờ tiếp nhận"));
    expect(await screen.findByText("Khách hàng: Khách 1")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Khách hàng: Khách 1"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-1"));
    expect(mockSocket.emit).toHaveBeenCalledWith("join_room", { conversationId: "conv-1" });
  });

  it("aligns AI replies with staff messages and gives them a distinct bubble", async () => {
    mockGetChatConversations.mockResolvedValue({
      success: true,
      data: [
        {
          id: "conv-ai",
          customerId: "cust-1",
          customerName: "Khách AI",
          staffId: "staff-1",
          staffName: "Staff One",
          status: "open",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastMessage: { id: "msg-2", conversation_id: "conv-ai", sender_id: "ai-assistant", sender_type: "ai", content: "AI tư vấn", created_at: "2026-01-01T00:01:00.000Z" },
          unreadCount: 0,
        },
      ],
    });
    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-ai",
          sender_id: "staff-1",
          sender_type: "staff",
          content: "Staff trả lời",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "msg-2",
          conversation_id: "conv-ai",
          sender_id: "ai-assistant",
          sender_type: "ai",
          content: "AI tư vấn",
          created_at: "2026-01-01T00:01:00.000Z",
        },
      ],
    });
    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 0, needsReply: 1, awaitingReply: 0, waitingCustomer: 0, resolved: 0 },
    });
    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");
    render(<ChatPage />);

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenCalled());
    await userEvent.click(await screen.findByText("Khách hàng: Khách AI"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-ai"));

    const staffBubble = (await screen.findByText("Staff trả lời")).closest("div.group");
    expect(staffBubble).toHaveClass("ml-auto");
    expect(staffBubble?.firstElementChild).toHaveClass("bg-lotus/10");

    const aiBubble = (await screen.findByText("Trợ lý AI")).closest("div.group");
    // AI trả lời thay staff → cùng hướng bên phải, nhưng nền jade khác staff.
    expect(aiBubble).toHaveClass("ml-auto");
    expect(aiBubble?.firstElementChild).toHaveClass("bg-jade/10");
  });

  it("shows the delete button for staff only while holding the reply lock", async () => {
    mockGetChatConversations.mockResolvedValue({
      success: true,
      data: [
        {
          id: "conv-lock",
          customerId: "cust-1",
          customerName: "Khách Lock",
          staffId: "staff-1",
          staffName: "Staff One",
          status: "open",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastMessage: { id: "msg-1", conversation_id: "conv-lock", sender_id: "staff-1", content: "Tin của tôi", created_at: "2026-01-01T00:00:00.000Z" },
          unreadCount: 0,
        },
      ],
    });
    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-lock",
          sender_id: "staff-1",
          sender_type: "staff",
          content: "Tin của tôi",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 0, needsReply: 0, awaitingReply: 1, waitingCustomer: 0, resolved: 0 },
    });
    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");
    render(<ChatPage />);

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenCalled());
    await userEvent.click(await screen.findByText("Khách hàng: Khách Lock"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-lock"));

    const bubble = (await screen.findAllByText("Tin của tôi"))
      .map((element) => element.closest("div.group"))
      .find((element): element is HTMLElement => element !== null) as HTMLElement;
    fireEvent.mouseEnter(bubble);
    expect(screen.queryByTitle("Xoá tin nhắn")).not.toBeInTheDocument();

    const openResultCall = mockSocket.on.mock.calls.find(([event]) => event === "open_conversation_result");
    const onOpenResult = openResultCall?.[1] as ((payload: unknown) => void) | undefined;
    act(() =>
      onOpenResult?.({
        conversationId: "conv-lock",
        canReply: true,
        staffId: "staff-1",
        staffName: "Staff One",
        status: "open",
      }),
    );

    fireEvent.mouseEnter(bubble);
    await waitFor(() => expect(screen.getByTitle("Xoá tin nhắn")).toBeInTheDocument());
  });

  it("moves an accepted conversation from Chung to the personal tabs", async () => {
    const unassignedConversation = {
      id: "conv-chung",
      customerId: "cust-1",
      customerName: "Khách chờ",
      staffId: null,
      staffName: null,
      status: "open",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastMessage: { id: "msg-1", conversation_id: "conv-chung", sender_id: "cust-1", content: "Cần tư vấn", created_at: "2026-01-01T00:00:00.000Z" },
      unreadCount: 1,
      reopenedFromResolved: false,
    };
    const assignedConversation = {
      ...unassignedConversation,
      staffId: "staff-1",
      staffName: "Staff One",
    };

    mockGetChatConversations.mockImplementation((tab?: string) =>
      Promise.resolve({
        success: true,
        data: tab === "unassigned" ? [unassignedConversation] : tab === "needs_reply" ? [assignedConversation] : [],
      }),
    );
    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-chung",
          sender_id: "cust-1",
          content: "Cần tư vấn",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 1, needsReply: 0, awaitingReply: 0, waitingCustomer: 0, resolved: 0 },
    });
    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");
    render(<ChatPage />);

    await userEvent.click(await screen.findByText("Chờ tiếp nhận"));
    await waitFor(() => expect(mockGetChatConversations).toHaveBeenLastCalledWith("unassigned"));
    await userEvent.click(await screen.findByText("Khách hàng: Khách chờ"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-chung"));

    await userEvent.click(screen.getByText("Tiếp nhận hỗ trợ"));
    expect(mockSocket.emit).toHaveBeenCalledWith("open_conversation", { conversationId: "conv-chung" });

    const openResultCall = mockSocket.on.mock.calls.find(([event]) => event === "open_conversation_result");
    const onOpenResult = openResultCall?.[1] as ((payload: unknown) => void) | undefined;
    act(() =>
      onOpenResult?.({
        conversationId: "conv-chung",
        canReply: true,
        staffId: "staff-1",
        staffName: "Staff One",
        status: "open",
      }),
    );

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenLastCalledWith("needs_reply"));
  });

  it("moves a reopened conversation from Đã tư vấn to Chờ phản hồi", async () => {
    const resolvedConversation = {
      id: "conv-resolved",
      customerId: "cust-2",
      customerName: "Khách cũ",
      staffId: "staff-1",
      staffName: "Staff One",
      status: "resolved",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastMessage: { id: "msg-2", conversation_id: "conv-resolved", sender_id: "staff-1", content: "Đã tư vấn xong", created_at: "2026-01-01T00:00:00.000Z" },
      unreadCount: 0,
      reopenedFromResolved: false,
    };
    const reopenedConversation = { ...resolvedConversation, status: "open" };

    mockGetChatConversations.mockImplementation((tab?: string) =>
      Promise.resolve({
        success: true,
        data:
          tab === "resolved"
            ? [resolvedConversation]
            : tab === "awaiting_reply"
              ? [reopenedConversation]
              : [],
      }),
    );
    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-2",
          conversation_id: "conv-resolved",
          sender_id: "staff-1",
          content: "Đã tư vấn xong",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 0, needsReply: 0, awaitingReply: 0, waitingCustomer: 0, resolved: 1 },
    });
    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");
    render(<ChatPage />);

    await userEvent.click(await screen.findByText("Đã tư vấn"));
    await waitFor(() => expect(mockGetChatConversations).toHaveBeenLastCalledWith("resolved"));
    await userEvent.click(await screen.findByText("Khách hàng: Khách cũ"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-resolved"));

    await userEvent.click(screen.getByText("Tư vấn bổ sung"));
    expect(mockSocket.emit).toHaveBeenCalledWith("open_conversation", { conversationId: "conv-resolved" });

    const openResultCall = mockSocket.on.mock.calls.find(([event]) => event === "open_conversation_result");
    const onOpenResult = openResultCall?.[1] as ((payload: unknown) => void) | undefined;
    act(() =>
      onOpenResult?.({
        conversationId: "conv-resolved",
        canReply: true,
        staffId: "staff-1",
        staffName: "Staff One",
        status: "open",
      }),
    );

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenLastCalledWith("awaiting_reply"));
  });

  it("silently refreshes Chờ tiếp nhận on chat_unlocked and preserves the current draft", async () => {
    const assignedConversation = {
      id: "conv-assigned",
      customerId: "cust-1",
      customerName: "Khách đang chat",
      staffId: "staff-1",
      staffName: "Staff One",
      status: "open",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastMessage: { id: "msg-1", conversation_id: "conv-assigned", sender_id: "cust-1", content: "Xin chào", created_at: "2026-01-01T00:00:00.000Z" },
      unreadCount: 1,
      reopenedFromResolved: false,
    };
    const unlockedConversation = {
      id: "conv-unlocked",
      customerId: "cust-2",
      customerName: "Khách mới",
      staffId: null,
      staffName: null,
      status: "open",
      updatedAt: "2026-01-01T00:01:00.000Z",
      lastMessage: { id: "msg-2", conversation_id: "conv-unlocked", sender_id: "cust-2", content: "Cần tư vấn", created_at: "2026-01-01T00:01:00.000Z" },
      unreadCount: 1,
      reopenedFromResolved: false,
    };

    mockGetChatConversations.mockImplementation((tab?: string) =>
      Promise.resolve({
        success: true,
        data: tab === "unassigned" ? [unlockedConversation] : [assignedConversation],
      }),
    );
    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-assigned",
          sender_id: "cust-1",
          content: "Xin chào",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 1, needsReply: 1, awaitingReply: 0, waitingCustomer: 0, resolved: 0 },
    });
    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");
    render(<ChatPage />);

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenCalled());
    await userEvent.click(await screen.findByText("Khách hàng: Khách đang chat"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-assigned"));

    const openResultCall = mockSocket.on.mock.calls.find(([event]) => event === "open_conversation_result");
    const onOpenResult = openResultCall?.[1] as ((payload: unknown) => void) | undefined;
    act(() =>
      onOpenResult?.({
        conversationId: "conv-assigned",
        canReply: true,
        staffId: "staff-1",
        staffName: "Staff One",
        status: "open",
      }),
    );

    const textarea = await screen.findByPlaceholderText("Nhập tin nhắn...");
    await userEvent.type(textarea, "nội dung đang gõ");
    expect(textarea).toHaveValue("nội dung đang gõ");

    await userEvent.click(screen.getByText("Chờ tiếp nhận"));
    await waitFor(() => expect(mockGetChatConversations).toHaveBeenLastCalledWith("unassigned"));
    const callsBeforeUnlock = mockGetChatConversations.mock.calls.length;

    const unlockedCall = mockSocket.on.mock.calls.find(([event]) => event === "chat_unlocked");
    const onChatUnlocked = unlockedCall?.[1] as ((payload: unknown) => void) | undefined;
    act(() => onChatUnlocked?.({ conversationId: "conv-unlocked", status: "open", released: true }));

    await waitFor(() =>
      expect(mockGetChatConversations.mock.calls.length).toBeGreaterThan(callsBeforeUnlock),
    );
    expect(mockGetChatConversations).toHaveBeenLastCalledWith("unassigned");
    // Reload danh sách chỉ đổi sidebar; draft của staff vẫn còn nguyên.
    expect(screen.getByDisplayValue("nội dung đang gõ")).toBeInTheDocument();
  });

  it("does not render the same socket message twice", async () => {
    mockGetChatConversations.mockResolvedValue({
      success: true,
      data: [
        {
          id: "conv-1",
          customerId: "cust-1",
          customerName: "Khách 1",
          staffId: null,
          staffName: null,
          status: "open",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastMessage: { id: "msg-1", conversation_id: "conv-1", sender_id: "cust-1", content: "Xin chào", created_at: "2026-01-01T00:00:00.000Z" },
          unreadCount: 1,
        },
      ],
    });
    mockGetConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: "msg-1",
          conversation_id: "conv-1",
          sender_id: "cust-1",
          content: "Xin chào",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockGetChatConversationCounts.mockResolvedValue({
      success: true,
      data: { unassigned: 1, needsReply: 0, awaitingReply: 0, waitingCustomer: 0, resolved: 0 },
    });
    mockGetConversationLockStatus.mockResolvedValue({
      success: true,
      data: { isLocked: false, lockedBy: null, lockedAt: null, expiresAt: null },
    });

    const { default: ChatPage } = await import("./page");
    render(<ChatPage />);

    await waitFor(() => expect(mockGetChatConversations).toHaveBeenCalled());
    await userEvent.click(screen.getByText("Chờ tiếp nhận"));
    await userEvent.click(await screen.findByText("Khách hàng: Khách 1"));
    await waitFor(() => expect(mockGetConversationMessages).toHaveBeenCalledWith("conv-1"));

    const receivedCall = mockSocket.on.mock.calls.find(([event]) => event === "message_received");
    const onMessageReceived = receivedCall?.[1] as ((payload: unknown) => void) | undefined;
    expect(onMessageReceived).toBeTypeOf("function");

    const payload = {
      conversationId: "conv-1",
      message: {
        id: "msg-2",
        conversation_id: "conv-1",
        sender_id: "cust-1",
        content: "Tin nhắn mới",
        created_at: "2026-01-01T00:01:00.000Z",
        message_type: "text",
      },
    };

    act(() => onMessageReceived?.(payload));
    await waitFor(() => expect(screen.getAllByText("Tin nhắn mới").length).toBeGreaterThan(0));
    const firstRenderCount = screen.getAllByText("Tin nhắn mới").length;

    // Socket phát lại cùng message id → không được thêm bong bóng thứ hai.
    act(() => onMessageReceived?.(payload));
    await waitFor(() => expect(screen.getAllByText("Tin nhắn mới")).toHaveLength(firstRenderCount));
  });
});
