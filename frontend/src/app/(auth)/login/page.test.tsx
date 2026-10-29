/**
 * @blast-radius: ui
 * Behavioral unit tests for LoginPage: credentials submission, error feedback, redirect.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const signIn = vi.fn();

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
import LoginPage from "./page";

const mockedUseAuth = vi.mocked(useAuth);
const mockedApiRequest = vi.mocked(apiRequest);

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      status: "unauthenticated",
      session: null,
      user: null,
      signIn,
      signOut: vi.fn(),
      replaceUser: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it("submits login form and redirects on success", async () => {
    const user = userEvent.setup();

    mockedApiRequest.mockResolvedValueOnce({
      success: true,
      data: {
        accessToken: "jwt-test-token",
        user: {
          id: "cust-1",
          email: "test@example.com",
          role: "customer",
        },
      },
    });

    render(<LoginPage />);

    const emailInput = screen.getByLabelText(/^Email$/i);
    const passwordInput = screen.getByLabelText(/^Mật khẩu$/i);
    const submitBtn = screen.getByRole("button", { name: /^Đăng nhập$/i });

    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "Password123@");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "test@example.com", password: "Password123@" }),
        }),
      );
      expect(signIn).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "jwt-test-token",
        }),
      );
      expect(push).toHaveBeenCalledWith("/dashboard/customer");
    });
  });

  it("displays error message when login credentials are invalid", async () => {
    const user = userEvent.setup();

    mockedApiRequest.mockResolvedValueOnce({
      success: false,
      message: "Email hoặc mật khẩu không chính xác.",
    });

    render(<LoginPage />);

    const emailInput = screen.getByLabelText(/^Email$/i);
    const passwordInput = screen.getByLabelText(/^Mật khẩu$/i);
    const submitBtn = screen.getByRole("button", { name: /^Đăng nhập$/i });

    await user.type(emailInput, "wrong@example.com");
    await user.type(passwordInput, "WrongPassword");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Email hoặc mật khẩu không chính xác.")).toBeInTheDocument();
      expect(signIn).not.toHaveBeenCalled();
    });
  });
});
