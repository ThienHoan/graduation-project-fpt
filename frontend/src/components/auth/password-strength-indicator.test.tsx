import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordStrengthIndicator } from "./password-strength-indicator";

describe("PasswordStrengthIndicator", () => {
  it("renders nothing when value is empty", () => {
    const { container } = render(<PasswordStrengthIndicator value="" />);
    expect(container.firstChild).toBeNull();
  });

  it("calculates 'Yếu' level for weak password", () => {
    render(<PasswordStrengthIndicator value="abc" />);
    expect(screen.getByTestId("strength-level")).toHaveTextContent("Yếu");
  });

  it("calculates 'Trung bình' level for moderate password", () => {
    render(<PasswordStrengthIndicator value="Abc12345" />);
    expect(screen.getByTestId("strength-level")).toHaveTextContent("Trung bình");
  });

  it("calculates 'Mạnh' level for fully compliant password", () => {
    render(<PasswordStrengthIndicator value="SecurePass@2026" />);
    expect(screen.getByTestId("strength-level")).toHaveTextContent("Mạnh");
  });

  it("renders checklist rules correctly", () => {
    render(<PasswordStrengthIndicator value="Abc12345" showRules={true} />);
    expect(screen.getByTestId("rule-length")).toBeInTheDocument();
    expect(screen.getByTestId("rule-upper")).toBeInTheDocument();
    expect(screen.getByTestId("rule-lower")).toBeInTheDocument();
    expect(screen.getByTestId("rule-number")).toBeInTheDocument();
    expect(screen.getByTestId("rule-special")).toBeInTheDocument();
  });
});

