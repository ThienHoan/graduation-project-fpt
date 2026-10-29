/**
 * @blast-radius: ui
 * Behavioral unit tests for VerifyEmailPage: OTP entry, email verification, resend OTP.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
let mockSearchParams = new URLSearchParams("email=test%40example.com");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/api";
import VerifyEmailPage from "./page";

const mockedApiRequest = vi.mocked(apiRequest);

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams("email=test%40example.com");
  });

  it("redirects to /register if no email in search params", () => {
    mockSearchParams = new URLSearchParams("");
    render(<VerifyEmailPage />);
    expect(replace).toHaveBeenCalledWith("/register");
  });

  it("submits 6-digit OTP and redirects on success", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      success: true,
      data: { verified: true },
    });

    const { container } = render(<VerifyEmailPage />);

    expect(screen.getByText("test@example.com")).toBeInTheDocument();

    for (let i = 0; i < 6; i++) {
      const input = container.querySelector<HTMLInputElement>(`#otp-${i}`)!;
      await user.type(input, String(i + 1));
    }

    const verifyBtn = screen.getByRole("button", { name: /Xác nhận mã OTP/i });
    await user.click(verifyBtn);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/auth/verify-email",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "test@example.com", code: "123456" }),
        }),
      );
      expect(screen.getByText(/Xác thực thành công!/i)).toBeInTheDocument();
    });
  });

  it("displays error message when verification fails", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      success: false,
      message: "Mã OTP không chính xác hoặc đã hết hạn.",
    });

    const { container } = render(<VerifyEmailPage />);

    for (let i = 0; i < 6; i++) {
      const input = container.querySelector<HTMLInputElement>(`#otp-${i}`)!;
      await user.type(input, "9");
    }

    const verifyBtn = screen.getByRole("button", { name: /Xác nhận mã OTP/i });
    await user.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByText("Mã OTP không chính xác hoặc đã hết hạn.")).toBeInTheDocument();
    });
  });
});
