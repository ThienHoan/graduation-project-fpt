/**
 * @blast-radius: ui
 * Trang kết quả thanh toán phần chênh của yêu cầu đổi mẫu (§13.3).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockSearchParams = new URLSearchParams("requestId=req-1&bookingId=book-12345678");

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  getChangeRequestPaymentStatus: vi.fn(),
  retryChangeRequestPayment: vi.fn(),
}));

import { getChangeRequestPaymentStatus, retryChangeRequestPayment } from "@/lib/api";
import ChangePaymentPage from "./page";

const mockedStatus = vi.mocked(getChangeRequestPaymentStatus);
const mockedRetry = vi.mocked(retryChangeRequestPayment);

function status(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      requestId: "req-1",
      status: "awaiting_payment",
      paid: false,
      chargeAmount: 50000,
      checkoutUrl: "https://pay.example/change",
      countdownSeconds: 300,
      ...overrides,
    },
  };
}

describe("ChangePaymentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams("requestId=req-1&bookingId=book-12345678");
  });

  it("shows the pending state with the surcharge and a pay button", async () => {
    mockedStatus.mockResolvedValue(status() as never);

    render(<ChangePaymentPage />);

    expect(await screen.findByText("Đang chờ thanh toán")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở lại trang thanh toán" })).toBeInTheDocument();
    // Sau thanh toán, quay về TAB SỰ CỐ trong tài khoản (không về trang sự cố của đơn).
    expect(screen.getByRole("link", { name: "Về trang sự cố" })).toHaveAttribute(
      "href",
      "/dashboard/customer/incidents",
    );
  });

  it("lets the customer pay again after cancelling on PayOS (mints a fresh link)", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("requestId=req-1&bookingId=book-12345678&cancelled=1");
    mockedStatus.mockResolvedValue(status() as never);
    mockedRetry.mockResolvedValue(
      status({ checkoutUrl: "https://pay.example/fresh-link" }) as never,
    );

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, href: "" },
      writable: true,
      configurable: true,
    });

    try {
      render(<ChangePaymentPage />);

      expect(await screen.findByText("Bạn đã huỷ thanh toán")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Thanh toán lại" }));

      await waitFor(() => expect(mockedRetry).toHaveBeenCalledWith("req-1"));
      await waitFor(() => expect(window.location.href).toBe("https://pay.example/fresh-link"));
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  it("shows the server message when a fresh PayOS link cannot be created", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("requestId=req-1&bookingId=book-12345678&cancelled=1");
    mockedStatus.mockResolvedValue(status() as never);
    mockedRetry.mockResolvedValue({
      success: false,
      message: "Giữ chỗ đã hết hạn, vui lòng chọn lại mẫu khác.",
    } as never);

    render(<ChangePaymentPage />);

    await screen.findByText("Bạn đã huỷ thanh toán");
    await user.click(screen.getByRole("button", { name: "Thanh toán lại" }));

    expect(
      await screen.findByText("Giữ chỗ đã hết hạn, vui lòng chọn lại mẫu khác."),
    ).toBeInTheDocument();
  });

  it("confirms the change was applied", async () => {
    mockedStatus.mockResolvedValue(status({ status: "applied", paid: true }) as never);

    render(<ChangePaymentPage />);

    expect(await screen.findByText("Đã áp dụng thay đổi!")).toBeInTheDocument();
    // Xong thanh toán → về tab sự cố.
    expect(screen.getByRole("link", { name: "Về trang sự cố" })).toHaveAttribute(
      "href",
      "/dashboard/customer/incidents",
    );
  });

  it("says the hold expired when the request is not applied", async () => {
    mockedStatus.mockResolvedValue(status({ status: "expired" }) as never);

    render(<ChangePaymentPage />);

    expect(await screen.findByText("Yêu cầu đã hết hạn")).toBeInTheDocument();
  });

  it("asks the customer to contact the store when stock ran out after payment", async () => {
    mockedStatus.mockResolvedValue(status({ status: "needs_manager", paid: true }) as never);

    render(<ChangePaymentPage />);

    expect(await screen.findByText("Cần cửa hàng hỗ trợ")).toBeInTheDocument();
  });

  it("shows an error state when the request cannot be loaded", async () => {
    mockedStatus.mockResolvedValue({ success: false, message: "Không tìm thấy yêu cầu đổi." } as never);

    render(<ChangePaymentPage />);

    expect(await screen.findByText("Không tìm thấy yêu cầu thanh toán")).toBeInTheDocument();
    expect(screen.getByText("Không tìm thấy yêu cầu đổi.")).toBeInTheDocument();
  });
});