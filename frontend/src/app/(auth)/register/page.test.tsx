/**
 * @blast-radius: ui
 * Behavioral unit tests for RegisterPage: validation, password strength, registration API submission.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/components/auth/google-sign-in-button", () => ({
  GoogleSignInButton: () => <button type="button">Mock Google Sign In</button>,
}));

import { useAuth } from "@/components/auth/auth-provider";
import { apiRequest } from "@/lib/api";
import RegisterPage from "./page";

const mockedUseAuth = vi.mocked(useAuth);
const mockedApiRequest = vi.mocked(apiRequest);

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      status: "unauthenticated",
      session: null,
      user: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      replaceUser: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it("submits registration successfully when inputs and passwords are valid", async () => {
    const user = userEvent.setup();

    mockedApiRequest.mockResolvedValueOnce({
      success: true,
      data: {
        email: "newuser@example.com",
        requiresVerification: true,
      },
    });

    render(<RegisterPage />);

    const nameInput = screen.getByLabelText(/Họ và tên/i);
    const emailInput = screen.getByLabelText(/^Email$/i);
    const passwordInput = screen.getByLabelText(/^Mật khẩu$/i);
    const confirmInput = screen.getByLabelText(/^Xác nhận mật khẩu$/i);
    const submitBtn = screen.getByRole("button", { name: /^Đăng ký ngay$/i });

    await user.type(nameInput, "Nguyen Van Test");
    await user.type(emailInput, "newuser@example.com");
    await user.type(passwordInput, "SecurePass123@");
    await user.type(confirmInput, "SecurePass123@");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            fullName: "Nguyen Van Test",
            email: "newuser@example.com",
            password: "SecurePass123@",
          }),
        }),
      );
      expect(push).toHaveBeenCalledWith(expect.stringContaining("/verify-email"));
    });
  });

  it("blocks submission and shows error if passwords do not match", async () => {
    const user = userEvent.setup();

    render(<RegisterPage />);

    const nameInput = screen.getByLabelText(/Họ và tên/i);
    const emailInput = screen.getByLabelText(/^Email$/i);
    const passwordInput = screen.getByLabelText(/^Mật khẩu$/i);
    const confirmInput = screen.getByLabelText(/^Xác nhận mật khẩu$/i);
    const submitBtn = screen.getByRole("button", { name: /^Đăng ký ngay$/i });

    await user.type(nameInput, "Nguyen Van Test");
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "SecurePass123@");
    await user.type(confirmInput, "DifferentPass123@");
    await user.click(submitBtn);

    await waitFor(() => {
      const errorElements = screen.getAllByText("Mật khẩu xác nhận không khớp.");
      expect(errorElements.length).toBeGreaterThanOrEqual(1);
      expect(mockedApiRequest).not.toHaveBeenCalled();
    });
  });
});
