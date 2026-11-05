/**
 * @blast-radius: ui
 * Khách tự gia hạn: báo giá theo số ngày, chuyển sang PayOS, tiếp tục/huỷ yêu cầu đang chờ.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getBookingExtensions: vi.fn(),
  getExtensionQuote: vi.fn(),
  createExtensionPayment: vi.fn(),
  cancelPendingExtension: vi.fn(),
}));

import { cancelPendingExtension, createExtensionPayment, getBookingExtensions, getExtensionQuote } from "@/lib/api";
import { ExtendRentalModal } from "./extend-rental-modal";

const BOOKING_ID = "book-12345678";
const mockedList = vi.mocked(getBookingExtensions);
const mockedQuote = vi.mocked(getExtensionQuote);
const mockedCreate = vi.mocked(createExtensionPayment);
const mockedCancel = vi.mocked(cancelPendingExtension);

function quote(days: number) {
  return {
    success: true,
    data: {
      previousEndDate: "2026-10-12",
      newEndDate: `2026-10-${12 + days}`,
      extraDays: days,
      amount: 120000 * days,
      memberDiscount: 0,
      lines: [{ label: `Áo dài gấm (size M) × ${days} ngày`, amount: 120000 * days }],
    },
  };
}

describe("ExtendRentalModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue({ success: true, data: [] });
    mockedQuote.mockImplementation(async (_id, days) => quote(days));
  });

  it("quotes the selected number of days and sends the customer to PayOS", async () => {
    const user = userEvent.setup();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { value: { ...originalLocation, href: "" }, writable: true, configurable: true });
    mockedCreate.mockResolvedValue({
      success: true,
      data: {
        extensionId: "ext-1", amount: 240000, previousEndDate: "2026-10-12", newEndDate: "2026-10-14",
        expiresAt: new Date().toISOString(), checkoutUrl: "https://pay.example/ext", applied: false,
      },
    });

    render(<ExtendRentalModal bookingId={BOOKING_ID} rentalEndDate="2026-10-12" onClose={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText("13/10/2026")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "2 ngày" }));
    expect(await screen.findByText("14/10/2026")).toBeInTheDocument();
    expect(mockedQuote).toHaveBeenLastCalledWith(BOOKING_ID, 2);

    await user.click(screen.getByRole("button", { name: /Thanh toán/ }));

    await waitFor(() => expect(window.location.href).toBe("https://pay.example/ext"));
    expect(mockedCreate).toHaveBeenCalledWith(BOOKING_ID, 2);
    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true });
  });

  it("explains why the extension is not possible and blocks payment", async () => {
    mockedQuote.mockResolvedValue({ success: false, message: "Áo dài gấm đã có khách khác đặt trong những ngày bạn muốn gia hạn." });

    render(<ExtendRentalModal bookingId={BOOKING_ID} rentalEndDate="2026-10-12" onClose={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText(/đã có khách khác đặt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Xác nhận gia hạn|Thanh toán/ })).toBeDisabled();
  });

  it("offers to resume or cancel a request still waiting for payment", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onClose = vi.fn();
    mockedList.mockResolvedValue({
      success: true,
      data: [{
        id: "ext-1", bookingId: BOOKING_ID, previousEndDate: "2026-10-12", newEndDate: "2026-10-14", extraDays: 2,
        amount: 240000, status: "pending", checkoutUrl: "https://pay.example/ext",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), appliedAt: null, note: null, createdAt: new Date().toISOString(),
      }],
    });
    mockedCancel.mockResolvedValue({ success: true, data: { extensionId: "ext-1", cancelled: true } });

    render(<ExtendRentalModal bookingId={BOOKING_ID} rentalEndDate="2026-10-14" onClose={onClose} onChanged={onChanged} />);

    expect(await screen.findByText(/đang chờ thanh toán/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Thanh toán tiếp" })).toHaveAttribute("href", "https://pay.example/ext");
    expect(mockedQuote).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Huỷ yêu cầu" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringContaining("Đã huỷ")));
    expect(mockedCancel).toHaveBeenCalledWith(BOOKING_ID);
    expect(onClose).toHaveBeenCalled();
  });
});
