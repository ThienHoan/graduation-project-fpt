import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "./change-password-form";

vi.mock("@/lib/api", () => ({
  changePassword: vi.fn(),
}));

import { changePassword } from "@/lib/api";

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form elements and labels", () => {
    render(<ChangePasswordForm />);
    expect(screen.getByLabelText("Mật khẩu hiện tại", { selector: "input" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu mới", { selector: "input" })).toBeInTheDocument();
    expect(screen.getByLabelText("Xác nhận mật khẩu mới", { selector: "input" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cập nhật mật khẩu/i })).toBeInTheDocument();
  });

  it("validates that new password cannot be identical to current password", async () => {
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại", { selector: "input" }), {
      target: { value: "SamePassword123!" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới", { selector: "input" }), {
      target: { value: "SamePassword123!" },
    });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới", { selector: "input" }), {
      target: { value: "SamePassword123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: /cập nhật mật khẩu/i }));

    await waitFor(() => {
      expect(screen.getByText(/không được trùng với mật khẩu hiện tại/i)).toBeInTheDocument();
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("validates that confirm password matches new password", async () => {
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại", { selector: "input" }), {
      target: { value: "OldPassword123!" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới", { selector: "input" }), {
      target: { value: "NewSecurePass@2026" },
    });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới", { selector: "input" }), {
      target: { value: "DifferentPass@2026" },
    });

    fireEvent.click(screen.getByRole("button", { name: /cập nhật mật khẩu/i }));

    await waitFor(() => {
      expect(screen.getByText(/mật khẩu xác nhận không khớp/i)).toBeInTheDocument();
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("submits API request when fields are valid and displays success", async () => {
    vi.mocked(changePassword).mockResolvedValueOnce({
      success: true,
      data: { email: "customer@example.com" },
    });

    const onSuccess = vi.fn();
    render(<ChangePasswordForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại", { selector: "input" }), {
      target: { value: "OldPassword123!" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới", { selector: "input" }), {
      target: { value: "NewSecurePass@2026" },
    });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới", { selector: "input" }), {
      target: { value: "NewSecurePass@2026" },
    });

    fireEvent.click(screen.getByRole("button", { name: /cập nhật mật khẩu/i }));

    await waitFor(() => {
      expect(screen.getByText(/đổi mật khẩu thành công/i)).toBeInTheDocument();
    });
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "OldPassword123!",
      newPassword: "NewSecurePass@2026",
    });
    expect(onSuccess).toHaveBeenCalled();
  });
});
