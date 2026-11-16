/**
 * @blast-radius: ui
 * Trung tâm thông báo khách: render link nội bộ từ server (§13.3).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { fullName: "Nguyễn Văn A", email: "vana@example.com" } }),
}));

vi.mock("@/lib/api", () => ({
  getMyNotifications: vi.fn(),
  getMyNotificationPreferences: vi.fn(),
  markAllMyNotificationsRead: vi.fn(),
  markMyNotificationRead: vi.fn(),
  updateMyNotificationPreferences: vi.fn(),
}));

import { getMyNotificationPreferences, getMyNotifications } from "@/lib/api";
import CustomerNotificationsPage from "./page";

const mockedNotifications = vi.mocked(getMyNotifications);
const mockedPreferences = vi.mocked(getMyNotificationPreferences);

describe("CustomerNotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPreferences.mockResolvedValue({
      success: true,
      data: {
        emailEnabled: true,
        inAppEnabled: true,
        bookingUpdatesEnabled: true,
        paymentUpdatesEnabled: true,
        reminderEnabled: true,
        marketingEnabled: false,
      },
    });
  });

  it("renders a safe internal link for a notification", async () => {
    mockedNotifications.mockResolvedValue({
      success: true,
      data: {
        unreadCount: 1,
        notifications: [
          {
            id: "n-1",
            userId: "u-1",
            title: "Cần xử lý sự cố đổi mẫu",
            body: "Áo Nhật Bình không còn sẵn sàng cho lịch thuê.",
            linkUrl: "/booking/incidents/book-12345678",
            readAt: null,
            createdAt: "2026-11-08T10:00:00.000Z",
            isRead: false,
          },
        ],
      },
    });

    render(<CustomerNotificationsPage />);

    const link = await screen.findByRole("link", { name: /Xem chi tiết/i });
    expect(link).toHaveAttribute("href", "/booking/incidents/book-12345678");
  });

  it("does not render a link for external or protocol-relative URLs", async () => {
    mockedNotifications.mockResolvedValue({
      success: true,
      data: {
        unreadCount: 1,
        notifications: [
          {
            id: "n-2",
            userId: "u-1",
            title: "Thông báo hệ thống",
            body: "Nội dung",
            linkUrl: "https://evil.example/phish",
            readAt: null,
            createdAt: "2026-11-08T10:00:00.000Z",
            isRead: false,
          },
        ],
      },
    });

    render(<CustomerNotificationsPage />);

    await screen.findByText("Thông báo hệ thống");
    expect(screen.queryByRole("link", { name: /Xem chi tiết/i })).not.toBeInTheDocument();
  });

  it.each([
    ["backslash trick", "/\\evil.example"],
    ["protocol-relative", "//evil.example"],
    ["leading whitespace", " /booking/incidents/1"],
    ["trailing whitespace", "/booking/incidents/1 "],
    ["control character", "/booking/\u0000incidents"],
    ["newline injection", "/booking/incidents\nhttp://evil"],
  ])("does not render a link for %s linkUrl", async (_label, hostile) => {
    mockedNotifications.mockResolvedValue({
      success: true,
      data: {
        unreadCount: 1,
        notifications: [
          {
            id: "n-hostile",
            userId: "u-1",
            title: "Thông báo đáng ngờ",
            body: "Nội dung",
            linkUrl: hostile,
            readAt: null,
            createdAt: "2026-11-08T10:00:00.000Z",
            isRead: false,
          },
        ],
      },
    });

    render(<CustomerNotificationsPage />);

    await screen.findByText("Thông báo đáng ngờ");
    expect(screen.queryByRole("link", { name: /Xem chi tiết/i })).not.toBeInTheDocument();
  });

  it("renders notifications without a link when linkUrl is null", async () => {
    mockedNotifications.mockResolvedValue({
      success: true,
      data: {
        unreadCount: 0,
        notifications: [
          {
            id: "n-3",
            userId: "u-1",
            title: "Đơn thuê đã hoàn tất",
            body: "Cảm ơn bạn đã thuê.",
            linkUrl: null,
            readAt: "2026-11-08T11:00:00.000Z",
            createdAt: "2026-11-08T10:00:00.000Z",
            isRead: true,
          },
        ],
      },
    });

    render(<CustomerNotificationsPage />);

    await screen.findByText("Đơn thuê đã hoàn tất");
    expect(screen.queryByRole("link", { name: /Xem chi tiết/i })).not.toBeInTheDocument();
  });
});