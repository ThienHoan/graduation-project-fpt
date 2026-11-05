/**
 * @blast-radius: ui
 * Trang kết quả gia hạn sau khi khách quay lại từ PayOS.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockSearchParams = new URLSearchParams("extensionId=ext-1");

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  getExtensionStatus: vi.fn(),
  cancelPendingExtension: vi.fn(),
}));

import { getExtensionStatus } from "@/lib/api";
import BookingExtensionPage from "./page";

const mockedStatus = vi.mocked(getExtensionStatus);

function extension(status: string) {
  return {
    success: true,
    data: {
      id: "ext-1", bookingId: "book-12345678", previousEndDate: "2026-10-12", newEndDate: "2026-10-14", extraDays: 2,
      amount: 240000, status: status as never, checkoutUrl: status === "pending" ? "https://pay.example/ext" : null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), appliedAt: null, note: null, createdAt: new Date().toISOString(),
    },
  };
}

describe("BookingExtensionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams("extensionId=ext-1");
  });

  it("confirms the new return date once the extension is applied", async () => {
    mockedStatus.mockResolvedValue(extension("applied"));

    render(<BookingExtensionPage />);

    expect(await screen.findByText("Gia hạn thành công!")).toBeInTheDocument();
    expect(screen.getByText("14/10/2026")).toBeInTheDocument();
  });

  it("lets the customer pay again after cancelling on PayOS while the hold lasts", async () => {
    mockSearchParams = new URLSearchParams("extensionId=ext-1&cancelled=1");
    mockedStatus.mockResolvedValue(extension("pending"));

    render(<BookingExtensionPage />);

    expect(await screen.findByText("Bạn đã huỷ thanh toán")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Thanh toán lại" })).toHaveAttribute("href", "https://pay.example/ext");
    expect(screen.getByRole("button", { name: "Huỷ yêu cầu gia hạn" })).toBeInTheDocument();
  });

  it("explains that the old return date stays when the hold expired", async () => {
    mockedStatus.mockResolvedValue(extension("expired"));

    render(<BookingExtensionPage />);

    expect(await screen.findByText("Yêu cầu gia hạn đã hết hạn")).toBeInTheDocument();
    expect(screen.getByText("12/10/2026")).toBeInTheDocument();
  });
});
