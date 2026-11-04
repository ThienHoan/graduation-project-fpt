import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CustomerNavbar } from "./navbar";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock auth provider
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "cust-1",
        fullName: "Hoàng Ngân",
        email: "hoangngan@example.com",
        role: "customer",
      },
    },
    signOut: vi.fn(),
    status: "authenticated",
  }),
}));

// Mock notifications
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => <button data-testid="notification-bell">Bell</button>,
}));

// Mock cart and wishlist
vi.mock("@/lib/cart", () => ({
  cartCount: () => 2,
}));

vi.mock("@/lib/wishlist", () => ({
  wishlistCount: () => 1,
  refreshWishlistFromServer: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/api", () => ({
  getMyLoyalty: vi.fn().mockResolvedValue({ success: true, data: { tier: "basic" } }),
}));

describe("CustomerNavbar", () => {
  it("renders brand logo, centered desktop navigation links, and right action tools", () => {
    const { container } = render(<CustomerNavbar />);

    // Brand logo
    expect(screen.getByText("Cổ Phục")).toBeInTheDocument();
    expect(screen.getByText("Hoàng Thành • AI")).toBeInTheDocument();

    // Navigation links in centered nav
    expect(screen.getByText("Trang chủ")).toBeInTheDocument();
    expect(screen.getByText("Bộ sưu tập")).toBeInTheDocument();
    expect(screen.getByText("Thử đồ AI")).toBeInTheDocument();
    expect(screen.getByText("Bảo vật 3D")).toBeInTheDocument();
    expect(screen.queryByText("Hành trình thuê")).not.toBeInTheDocument();
    expect(screen.getByText("Hệ thống ERP")).toBeInTheDocument();

    // Verify nav has flex-1 and justify-center to stay centered without overlapping
    const nav = container.querySelector("nav.hidden.lg\\:flex");
    expect(nav).toHaveClass("flex-1", "justify-center", "min-w-0");

    // Action buttons
    expect(screen.getByText("Thuê Ngay")).toBeInTheDocument();
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
  });
});

