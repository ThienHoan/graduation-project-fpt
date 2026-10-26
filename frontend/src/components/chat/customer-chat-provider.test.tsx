import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomerChatProvider } from "./customer-chat-provider";

const mockCreateChatSocket = vi.fn();
const mockGetMyChatConversation = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockMarkConversationRead = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const { mockSession, mockSignOut, mockRefreshUser } = vi.hoisted(() => ({
  mockSession: {
    accessToken: "token",
    user: {
      id: "customer-1",
      email: "customer@example.com",
      role: "customer",
      isActive: true,
      fullName: "Customer One",
      phone: null,
    },
  },
  mockSignOut: vi.fn(),
  mockRefreshUser: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: mockSession,
    signOut: mockSignOut,
    refreshUser: mockRefreshUser,
  }),
}));

vi.mock("@/lib/socket", () => ({
  createChatSocket: (...args: unknown[]) => mockCreateChatSocket(...args),
}));

vi.mock("@/lib/chat", () => ({
  getMyChatConversation: () => mockGetMyChatConversation(),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
  emitChatMessage: vi.fn(),
  uploadChatFile: vi.fn(),
  getBookingCardData: () => null,
  getProductCardData: () => null,
}));

const handlers: Record<string, (payload?: any) => void> = {};
const socket = {
  connected: true,
  on: vi.fn((event: string, handler: (payload?: any) => void) => {
    handlers[event] = handler;
  }),
  off: vi.fn(),
  offAny: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key];
  mockCreateChatSocket.mockReturnValue(socket);
  mockGetMyChatConversation.mockResolvedValue({
    success: true,
    data: {
      id: "conversation-1",
      customerId: "customer-1",
      customerName: "Customer One",
      staffId: "staff-1",
      staffName: "Staff One",
      status: "open",
      updatedAt: new Date().toISOString(),
      lastMessage: null,
      unreadCount: 2,
      reopenedFromResolved: false,
    },
  });
  mockGetConversationMessages.mockResolvedValue({ success: true, data: [] });
  mockMarkConversationRead.mockResolvedValue({ success: true, data: { id: "conversation-1" } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CustomerChatProvider unread badge", () => {
  it("shows initial unread count, increments on staff message, and clears when opened", async () => {
    render(
      <CustomerChatProvider>
        <div>content</div>
      </CustomerChatProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Mở chat (2 tin nhắn chưa đọc)")).toBeInTheDocument();
    });

    act(() => {
      handlers.message_received?.({
        conversationId: "conversation-1",
        message: {
          id: "message-2",
          conversation_id: "conversation-1",
          sender_id: "staff-1",
          sender_type: "user",
          content: "hello",
          created_at: new Date().toISOString(),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Mở chat (3 tin nhắn chưa đọc)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Mở chat (3 tin nhắn chưa đọc)"));

    await waitFor(() => {
      expect(mockMarkConversationRead).toHaveBeenCalledWith("conversation-1");
      expect(screen.getAllByLabelText("Đóng chat").length).toBeGreaterThan(0);
    });
  });

  it("loads older messages when the customer scrolls to the top", async () => {
    const history = Array.from({ length: 15 }, (_, index) => ({
      id: `message-${index + 1}`,
      conversation_id: "conversation-1",
      sender_id: index % 2 === 0 ? "customer-1" : "staff-1",
      sender_type: index % 2 === 0 ? "customer" : "user",
      content: `Tin ${index + 1}`,
      created_at: new Date(Date.now() + index * 60_000).toISOString(),
    }));
    const olderMessage = {
      id: "message-old",
      conversation_id: "conversation-1",
      sender_id: "customer-1",
      sender_type: "customer",
      content: "Tin cũ hơn",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    };
    mockGetConversationMessages.mockImplementation(
      (_conversationId: string, before?: string) =>
        Promise.resolve({
          success: true,
          data: before ? [olderMessage] : history,
        }),
    );

    render(
      <CustomerChatProvider>
        <div>content</div>
      </CustomerChatProvider>,
    );

    const openButton = await screen.findByLabelText("Mở chat (2 tin nhắn chưa đọc)");
    fireEvent.click(openButton);

    const hint = await screen.findByText("Cuộn lên để xem tin nhắn cũ");
    const scrollContainer = hint.parentElement as HTMLElement;
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 0 } });

    await waitFor(() => {
      expect(mockGetConversationMessages).toHaveBeenLastCalledWith(
        "conversation-1",
        "message-1",
      );
      expect(screen.getByText("Tin cũ hơn")).toBeInTheDocument();
    });
  });
});
