import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChangePasswordPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/change-password",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: {
      user: {
        id: "user-1",
        email: "customer@example.com",
        role: "customer",
      },
      accessToken: "mock-token",
    },
  }),
}));

vi.mock("@/lib/api", () => ({
  changePassword: vi.fn(),
  getSecurityActivity: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

describe("ChangePasswordPage", () => {
  it("renders page header and both form and activity sections", async () => {
    render(<ChangePasswordPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /bảo mật & đổi mật khẩu/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /thay đổi mật khẩu/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /lịch sử hoạt động bảo mật/i })).toBeInTheDocument();
    });
  });
});
