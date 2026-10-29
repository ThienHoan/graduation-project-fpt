/**
 * @blast-radius: ui
 * Behavioral unit tests for BookingPaymentPage: pending polling, success redirect, cancel/retry.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let mockSearchParams = new URLSearchParams("bookingId=book-12345678");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  createPaymentLink: vi.fn(),
  getPaymentStatus: vi.fn(),
}));

import { createPaymentLink, getPaymentStatus } from "@/lib/api";
import BookingPaymentPage from "./page";

const mockedGetPaymentStatus = vi.mocked(getPaymentStatus);
const mockedCreatePaymentLink = vi.mocked(createPaymentLink);

describe("BookingPaymentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams("bookingId=book-12345678");
    localStorage.clear();
  });

  it("renders pending payment state with booking code", () => {
    mockedGetPaymentStatus.mockResolvedValue({
      success: true,
      data: { status: "pending", paid: false },
    });

    render(<BookingPaymentPage />);

    expect(screen.getByText("Đang chờ thanh toán")).toBeInTheDocument();
    expect(screen.getByText("#BOOK-123")).toBeInTheDocument();
    expect(screen.getByText(/Đang chờ xác nhận thanh toán/i)).toBeInTheDocument();
  });

  it("transitions to success state when payment is confirmed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedGetPaymentStatus.mockResolvedValueOnce({
        success: true,
        data: { status: "paid", paid: true },
      });

      render(<BookingPaymentPage />);

      // Advance timer for polling interval (3000ms)
      await vi.advanceTimersByTimeAsync(3100);

      expect(await screen.findByText("Thanh toán thành công!")).toBeInTheDocument();
      expect(screen.getByText(/đã được thanh toán thành công/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders cancelled/failed state and allows retry", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("bookingId=book-12345678&cancelled=1");

    mockedCreatePaymentLink.mockResolvedValueOnce({
      success: true,
      data: {
        amount: 500000,
        checkoutUrl: "https://checkout.stripe.test/123",
        qrCode: "qr-data",
        orderCode: 123456,
      },
    });

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, href: "" },
      writable: true,
      configurable: true,
    });

    render(<BookingPaymentPage />);

    expect(screen.getByText("Thanh toán đã bị huỷ")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /Thanh toán lại/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(mockedCreatePaymentLink).toHaveBeenCalledWith("book-12345678");
      expect(window.location.href).toBe("https://checkout.stripe.test/123");
    });

    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });
});
