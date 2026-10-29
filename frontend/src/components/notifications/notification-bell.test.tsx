import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationBell } from "./notification-bell";

const mockGetMyNotifications = vi.fn();
const mockMarkMyNotificationRead = vi.fn();
const mockMarkAllMyNotificationsRead = vi.fn();

vi.mock("@/lib/api", () => ({
  getMyNotifications: (...args: unknown[]) => mockGetMyNotifications(...args),
  markMyNotificationRead: (...args: unknown[]) => mockMarkMyNotificationRead(...args),
  markAllMyNotificationsRead: (...args: unknown[]) => mockMarkAllMyNotificationsRead(...args),
}));

vi.mock("@/lib/use-realtime-invalidation", () => ({
  useRealtimeInvalidation: vi.fn(),
}));

vi.mock("@/lib/status-labels", () => ({
  normalizeStatusInText: (text: string) => text,
}));

const makeNotification = (overrides: Partial<{
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}> = {}) => ({
  id: "notif-1",
  title: "Test Notification",
  body: "Test body",
  isRead: false,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const emptyResponse = { success: true, data: { notifications: [], unreadCount: 0 } };

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetMyNotifications.mockResolvedValue(emptyResponse);
    mockMarkMyNotificationRead.mockResolvedValue({ success: true });
    mockMarkAllMyNotificationsRead.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Initial state ---
  it("renders bell button", async () => {
    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Thông báo")).toBeInTheDocument();
  });

  it("shows no unread badge when unreadCount is 0", async () => {
    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });
    // unread badge span is conditionally rendered — should not exist
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows unread badge count when there are unread notifications", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: { notifications: [makeNotification()], unreadCount: 3 },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows 99+ when unread count exceeds 99", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: { notifications: [], unreadCount: 100 },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  // --- Panel toggle ---
  it("panel is closed by default", async () => {
    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("Thông báo")).not.toBeInTheDocument();
  });

  it("opens panel when bell is clicked", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: { notifications: [], unreadCount: 0 },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    expect(screen.getByText("Thông báo")).toBeInTheDocument();
  });

  it("shows empty state message when no notifications", async () => {
    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    expect(screen.getByText("Chưa có thông báo.")).toBeInTheDocument();
  });

  it("toggles panel closed when bell is clicked again", async () => {
    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    const bell = screen.getByLabelText("Thông báo");
    fireEvent.click(bell); // open
    fireEvent.click(bell); // close
    expect(screen.queryByText("Chưa có thông báo.")).not.toBeInTheDocument();
  });

  // --- Notification list ---
  it("renders notification titles in the panel", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: {
        notifications: [
          makeNotification({ id: "n1", title: "Đặt hàng thành công" }),
          makeNotification({ id: "n2", title: "Đơn hàng đã giao" }),
        ],
        unreadCount: 2,
      },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    expect(screen.getByText("Đặt hàng thành công")).toBeInTheDocument();
    expect(screen.getByText("Đơn hàng đã giao")).toBeInTheDocument();
  });

  // --- Mark read ---
  it("calls markMyNotificationRead when an unread notification is clicked", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: {
        notifications: [makeNotification({ id: "n1", isRead: false })],
        unreadCount: 1,
      },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    fireEvent.click(screen.getByText("Test Notification"));
    await act(async () => { await Promise.resolve(); });

    expect(mockMarkMyNotificationRead).toHaveBeenCalledWith("n1");
  });

  it("does not call markMyNotificationRead when a read notification is clicked", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: {
        notifications: [makeNotification({ id: "n1", isRead: true })],
        unreadCount: 0,
      },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    fireEvent.click(screen.getByText("Test Notification"));

    expect(mockMarkMyNotificationRead).not.toHaveBeenCalled();
  });

  // --- Mark all read ---
  it("calls markAllMyNotificationsRead when mark-all button is clicked", async () => {
    mockGetMyNotifications.mockResolvedValue({
      success: true,
      data: {
        notifications: [makeNotification()],
        unreadCount: 1,
      },
    });

    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    fireEvent.click(screen.getByText("Đánh dấu tất cả"));
    await act(async () => { await Promise.resolve(); });

    expect(mockMarkAllMyNotificationsRead).toHaveBeenCalledTimes(1);
  });

  // --- "View all" link ---
  it("renders 'Xem tất cả' link when notificationsHref is provided", async () => {
    render(<NotificationBell notificationsHref="/notifications" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    const link = screen.getByText("Xem tất cả");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/notifications");
  });

  it("does not render 'Xem tất cả' link when notificationsHref is not provided", async () => {
    render(<NotificationBell />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByLabelText("Thông báo"));
    expect(screen.queryByText("Xem tất cả")).not.toBeInTheDocument();
  });
});
