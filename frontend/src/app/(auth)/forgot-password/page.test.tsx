/**
 * @blast-radius: ui
 * Behavioral unit tests for ForgotPasswordPage: OTP request, OTP entry, password reset.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api", () => ({
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

import { forgotPassword, resetPassword } from "@/lib/api";
import ForgotPasswordPage from "./page";

const mockedForgotPassword = vi.mocked(forgotPassword);
const mockedResetPassword = vi.mocked(resetPassword);

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits email to request OTP and moves to step 2", async () => {
    const user = userEvent.setup();
    mockedForgotPassword.mockResolvedValueOnce({
      success: true,
      message: "Đã gửi mã OTP đến email.",
    });

    render(<ForgotPasswordPage />);

    const emailInput = screen.getByLabelText(/Địa chỉ Email/i);
    const submitBtn = screen.getByRole("button", { name: /Gửi mã OTP/i });

    await user.type(emailInput, "test@example.com");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockedForgotPassword).toHaveBeenCalledWith("test@example.com");
      expect(screen.getByText("Nhập mã OTP")).toBeInTheDocument();
    });
  });

  it("shows error if requesting OTP fails", async () => {
    const user = userEvent.setup();
    mockedForgotPassword.mockResolvedValueOnce({
      success: false,
      message: "Email không tồn tại trong hệ thống.",
    });

    render(<ForgotPasswordPage />);

    const emailInput = screen.getByLabelText(/Địa chỉ Email/i);
    const submitBtn = screen.getByRole("button", { name: /Gửi mã OTP/i });

    await user.type(emailInput, "notfound@example.com");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Email không tồn tại trong hệ thống.")).toBeInTheDocument();
    });
  });

  it("completes password reset when OTP and new password are valid", async () => {
    const user = userEvent.setup();
    mockedForgotPassword.mockResolvedValueOnce({
      success: true,
      message: "Đã gửi mã OTP.",
    });
    mockedResetPassword.mockResolvedValueOnce({
      success: true,
      message: "Mật khẩu đã được đặt lại thành công!",
    });

    const { container } = render(<ForgotPasswordPage />);

    // Step 1: Request OTP
    const emailInput = screen.getByLabelText(/Địa chỉ Email/i);
    await user.type(emailInput, "test@example.com");
    await user.click(screen.getByRole("button", { name: /Gửi mã OTP/i }));

    // Step 2: Wait for step 2 inputs
    await waitFor(() => {
      expect(screen.getByText("Nhập mã OTP")).toBeInTheDocument();
    });

    for (let i = 0; i < 6; i++) {
      const input = container.querySelector<HTMLInputElement>(`#otp-${i}`)!;
      await user.type(input, String(i + 1));
    }

    const passwordInput = screen.getByLabelText(/Mật khẩu mới/i);
    await user.type(passwordInput, "NewPassword123@");

    const resetBtn = screen.getByRole("button", { name: /Đặt lại mật khẩu/i });
    await user.click(resetBtn);

    await waitFor(() => {
      expect(mockedResetPassword).toHaveBeenCalledWith("test@example.com", "123456", "NewPassword123@");
      expect(screen.getByText(/Mật khẩu đã được đặt lại thành công!/i)).toBeInTheDocument();
    });
  });
});
