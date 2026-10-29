/**
 * @blast-radius: ui
 * Behavioral unit tests for BookingReviewPage: empty cart, terms agreement, order confirmation.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let mockSearchParams = new URLSearchParams({
  startDate: "2026-11-01",
  endDate: "2026-11-03",
  pickupMethod: "store_pickup",
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/cart", () => ({
  getCart: vi.fn(),
  clearCart: vi.fn(),
}));

vi.mock("@/lib/accessory-selection", () => ({
  clearAccessorySelection: vi.fn(),
  flattenAccessorySelection: vi.fn(() => []),
  getAccessorySelection: vi.fn(() => ({})),
  pruneAccessorySelection: vi.fn(() => ({})),
}));

vi.mock("@/lib/api", () => ({
  createBooking: vi.fn(),
  createPaymentLink: vi.fn(),
  getAvailableVouchers: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getGarmentAccessories: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getMyAddresses: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getRentalQuote: vi.fn().mockResolvedValue({
    success: true,
    data: [{ sizeId: "s-1", subtotal: 400000, breakdown: [] }],
  }),
  normalizePickupMethod: vi.fn((m) => m ?? "store_pickup"),
  validateVoucher: vi.fn(),
}));

vi.mock("@/components/customer/navbar", () => ({
  CustomerNavbar: () => <nav>Mock Navbar</nav>,
}));

vi.mock("@/components/customer/footer", () => ({
  CustomerFooter: () => <footer>Mock Footer</footer>,
}));

import { createBooking, getRentalQuote } from "@/lib/api";
import { getCart, clearCart } from "@/lib/cart";
import BookingReviewPage from "./page";

const mockedGetCart = vi.mocked(getCart);
const mockedCreateBooking = vi.mocked(createBooking);

describe("BookingReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams({
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      pickupMethod: "store_pickup",
    });
  });

  it("renders empty cart state when no items in cart", () => {
    mockedGetCart.mockReturnValue([]);

    render(<BookingReviewPage />);

    expect(screen.getAllByText("Giỏ hàng trống").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: /Khám phá bộ sưu tập/i })).toBeInTheDocument();
  });

  it("submits booking after agreeing to terms and conditions", async () => {
    const user = userEvent.setup();
    mockedGetCart.mockReturnValue([
      {
        garmentId: "g-1",
        garmentSizeId: "s-1",
        name: "Áo Tấc Cung Đình",
        sizeLabel: "L",
        dailyPrice: 200000,
        depositAmount: 500000,
        imageUrl: "/img/ao-tac.jpg",
      },
    ]);

    mockedCreateBooking.mockResolvedValueOnce({
      success: true,
      data: {
        id: "book-success-999",
        status: "confirmed",
      } as never,
    });

    render(<BookingReviewPage />);

    expect(screen.getAllByText("Áo Tấc Cung Đình").length).toBeGreaterThanOrEqual(1);

    const confirmBtn = screen.getByRole("button", { name: /Xác nhận đặt lịch/i });
    expect(confirmBtn).toBeDisabled();

    // Check terms agreement checkbox
    const termsCheckbox = screen.getByRole("checkbox");
    await user.click(termsCheckbox);

    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockedCreateBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: "2026-11-01",
          endDate: "2026-11-03",
          pickupMethod: "store_pickup",
          garmentSizeIds: ["s-1"],
        }),
      );
      expect(clearCart).toHaveBeenCalled();
      expect(push).toHaveBeenCalledWith(expect.stringContaining("/booking/success?bookingId=book-success-999"));
    });
  });
});
