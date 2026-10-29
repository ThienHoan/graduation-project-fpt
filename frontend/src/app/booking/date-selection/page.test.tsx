/**
 * @blast-radius: ui
 * Behavioral unit tests for BookingDateSelectionPage: empty cart, item list, continue to logistics.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/cart", () => ({
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  getCartSummary: vi.fn(() => ({ rentalTotal: 200000, depositTotal: 500000, count: 1 })),
}));

vi.mock("@/lib/accessory-selection", () => ({
  countSelectedAccessories: vi.fn(() => 0),
  getAccessorySelection: vi.fn(() => ({})),
  removeGarmentAccessories: vi.fn(),
  setAccessorySelection: vi.fn(),
  toggleAccessory: vi.fn(() => ({})),
}));

vi.mock("@/lib/api", () => ({
  checkAvailability: vi.fn(),
  checkAccessoryAvailability: vi.fn(),
  getGarmentAccessories: vi.fn(),
}));

vi.mock("@/components/customer/navbar", () => ({
  CustomerNavbar: () => <nav>Mock Navbar</nav>,
}));

vi.mock("@/components/customer/footer", () => ({
  CustomerFooter: () => <footer>Mock Footer</footer>,
}));

import { checkAvailability, getGarmentAccessories } from "@/lib/api";
import { getCart } from "@/lib/cart";
import BookingDateSelectionPage from "./page";

const mockedGetCart = vi.mocked(getCart);
const mockedCheckAvailability = vi.mocked(checkAvailability);
const mockedGetGarmentAccessories = vi.mocked(getGarmentAccessories);

describe("BookingDateSelectionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty cart state when no items in cart", () => {
    mockedGetCart.mockReturnValue([]);

    render(<BookingDateSelectionPage />);

    expect(screen.getAllByText("Giỏ hàng trống").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Bạn chưa thêm trang phục nào vào giỏ/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Khám phá bộ sưu tập/i })).toBeInTheDocument();
  });

  it("renders cart items and proceeds to logistics when items are available", async () => {
    const user = userEvent.setup();
    mockedGetCart.mockReturnValue([
      {
        garmentId: "g-1",
        garmentSizeId: "s-1",
        name: "Áo Nhật Bình Hoàng Gia",
        sizeLabel: "M",
        dailyPrice: 200000,
        depositAmount: 500000,
        imageUrl: "/img/ao.jpg",
      },
    ]);

    mockedGetGarmentAccessories.mockResolvedValue({
      success: true,
      data: [],
    });

    mockedCheckAvailability.mockResolvedValue({
      success: true,
      data: {
        garmentSizeId: "s-1",
        available: true,
        availableCount: 3,
        totalAssets: 5,
      },
    });

    render(<BookingDateSelectionPage />);

    expect(screen.getAllByText("Áo Nhật Bình Hoàng Gia").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Giỏ thuê \(1\)/i)).toBeInTheDocument();

    const continueBtn = await screen.findByRole("button", { name: /Sang bước vận chuyển/i });
    expect(continueBtn).not.toBeDisabled();

    await user.click(continueBtn);

    expect(push).toHaveBeenCalledWith(expect.stringContaining("/booking/logistics"));
  });
});
