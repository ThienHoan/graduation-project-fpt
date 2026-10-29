import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordVisibilityToggle } from "./password-visibility-toggle";

describe("PasswordVisibilityToggle", () => {
  it("renders show-eye icon and correct aria-label when visible=false", () => {
    render(
      <PasswordVisibilityToggle visible={false} label="mật khẩu" onToggle={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: "Hiện mật khẩu" });
    expect(btn).toBeInTheDocument();
  });

  it("renders hide-eye icon and correct aria-label when visible=true", () => {
    render(
      <PasswordVisibilityToggle visible={true} label="mật khẩu" onToggle={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: "Ẩn mật khẩu" });
    expect(btn).toBeInTheDocument();
  });

  it("calls onToggle when button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <PasswordVisibilityToggle visible={false} label="password" onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("has type=button to avoid accidental form submit", () => {
    render(
      <PasswordVisibilityToggle visible={false} label="password" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("applies custom className to the button", () => {
    render(
      <PasswordVisibilityToggle visible={false} label="pw" onToggle={vi.fn()} className="custom-cls" />,
    );
    expect(screen.getByRole("button")).toHaveClass("custom-cls");
  });

  it("aria-label includes custom label prop", () => {
    render(
      <PasswordVisibilityToggle visible={true} label="xác nhận mật khẩu" onToggle={vi.fn()} />,
    );
    expect(screen.getByLabelText("Ẩn xác nhận mật khẩu")).toBeInTheDocument();
  });
});
