import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceUser = vi.fn();

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  getMyAddresses: vi.fn().mockResolvedValue({ success: true, data: [] }),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

import { useAuth } from "@/components/auth/auth-provider";
import { apiRequest } from "@/lib/api";
import CustomerProfilePage from "./page";

const mockedUseAuth = vi.mocked(useAuth);

describe("CustomerProfilePage", () => {
  beforeEach(() => {
    replaceUser.mockReset();
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      status: "authenticated",
      session: {
        accessToken: "jwt-token",
        user: {
          id: "user-1",
          email: "customer@example.com",
          role: "customer",
          isActive: true,
          fullName: "Nguyen Van A",
          phone: "0909000000",
        },
      },
      user: {
        id: "user-1",
        email: "customer@example.com",
        role: "customer",
        isActive: true,
        fullName: "Nguyen Van A",
        phone: "0909000000",
      },
      signIn: vi.fn(),
      signOut: vi.fn(),
      replaceUser,
      refreshUser: vi.fn(),
    });
  });

  it("updates the customer profile and syncs the auth session", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      data: {
        id: "user-1",
        email: "customer@example.com",
        role: "customer",
        isActive: true,
        fullName: "Kha Tran",
        phone: "0911222333",
      },
    });
    const user = userEvent.setup();

    render(<CustomerProfilePage />);

    await waitFor(() => expect(screen.getByLabelText("Họ và tên")).toHaveValue("Nguyen Van A"));
    await user.clear(screen.getByLabelText("Họ và tên"));
    await user.type(screen.getByLabelText("Họ và tên"), "Kha Tran");
    await user.clear(screen.getByLabelText("Số điện thoại"));
    await user.type(screen.getByLabelText("Số điện thoại"), "0911222333");
    await user.click(screen.getByRole("button", { name: /Lưu thay đổi/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/users/me/profile", {
      method: "PATCH",
      body: JSON.stringify({
        fullName: "Kha Tran",
        phone: "0911222333",
      }),
    }));
    expect(replaceUser).toHaveBeenCalledWith({
      id: "user-1",
      email: "customer@example.com",
      role: "customer",
      isActive: true,
      fullName: "Kha Tran",
      phone: "0911222333",
    });
    expect(screen.getByText(/Cập nhật hồ sơ thành công/i)).toBeInTheDocument();
  });
});
