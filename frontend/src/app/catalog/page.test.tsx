/**
 * @blast-radius: ui
 * Behavioral unit tests for CatalogPage: loading garments, category filter, adding item to cart.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/customer/navbar", () => ({
  CustomerNavbar: () => <nav>Mock Navbar</nav>,
}));

vi.mock("@/components/customer/footer", () => ({
  CustomerFooter: () => <footer>Mock Footer</footer>,
}));

vi.mock("@/lib/api", () => ({
  getEffectivePrices: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getGarmentCategories: vi.fn().mockResolvedValue({
    success: true,
    data: [{ id: "cat-1", name: "Áo Nhật Bình" }, { id: "cat-2", name: "Áo Tấc" }],
  }),
  getGarmentsGrouped: vi.fn(),
  trackGarmentView: vi.fn(),
}));

vi.mock("@/lib/cart", () => ({
  addToCart: vi.fn(),
  cartCount: vi.fn(() => 0),
  getCart: vi.fn(() => []),
  removeFromCart: vi.fn(),
}));

vi.mock("@/lib/chat", () => ({
  getProductAdvisor: vi.fn(),
}));

import { getGarmentCategories, getGarmentsGrouped } from "@/lib/api";
import { addToCart } from "@/lib/cart";
import CatalogPage from "./page";

const mockedGetGarmentsGrouped = vi.mocked(getGarmentsGrouped);
const mockedGetGarmentCategories = vi.mocked(getGarmentCategories);
const mockedAddToCart = vi.mocked(addToCart);

describe("CatalogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // IntersectionObserver mock for lazy view tracking
    window.IntersectionObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  it("renders categories and garment list", async () => {
    mockedGetGarmentsGrouped.mockResolvedValue({
      success: true,
      data: [
        {
          garmentId: "g-1",
          slug: "ao-nhat-binh-hoang-gia",
          name: "Áo Nhật Bình Hoàng Gia",
          category: "Áo Nhật Bình",
          imageUrl: "/img/ao-1.jpg",
          sizes: [
            {
              garmentSizeId: "s-1",
              sizeLabel: "M",
              dailyPrice: 250000,
              depositAmount: 500000,
            },
          ],
        } as never,
      ],
    });

    render(<CatalogPage />);

    expect(screen.getByText(/Bộ Sưu Tập Cổ Phục Tuyển Chọn/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("Áo Nhật Bình Hoàng Gia").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("button", { name: "Áo Nhật Bình" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Áo Tấc" })).toBeInTheDocument();
    });
  });

  it("filters garments when selecting a category", async () => {
    const user = userEvent.setup();
    mockedGetGarmentsGrouped.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<CatalogPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Áo Tấc" })).toBeInTheDocument();
    });

    const categoryBtn = screen.getByRole("button", { name: "Áo Tấc" });
    await user.click(categoryBtn);

    await waitFor(() => {
      expect(mockedGetGarmentsGrouped).toHaveBeenCalledWith(undefined, "Áo Tấc");
    });
  });

  it("adds garment to cart when clicking add to cart button", async () => {
    const user = userEvent.setup();
    mockedGetGarmentsGrouped.mockResolvedValue({
      success: true,
      data: [
        {
          garmentId: "g-1",
          slug: "ao-nhat-binh-hoang-gia",
          name: "Áo Nhật Bình Hoàng Gia",
          category: "Áo Nhật Bình",
          imageUrl: "/img/ao-1.jpg",
          sizes: [
            {
              garmentSizeId: "s-1",
              sizeLabel: "M",
              dailyPrice: 250000,
              depositAmount: 500000,
            },
          ],
        } as never,
      ],
    });

    render(<CatalogPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Áo Nhật Bình Hoàng Gia").length).toBeGreaterThanOrEqual(1);
    });

    const addBtns = screen.getAllByRole("button", { name: /Thêm vào giỏ/i });
    await user.click(addBtns[0]);

    expect(mockedAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        garmentId: "g-1",
        garmentSizeId: "s-1",
        dailyPrice: 250000,
        depositAmount: 500000,
      }),
    );
  });
});
