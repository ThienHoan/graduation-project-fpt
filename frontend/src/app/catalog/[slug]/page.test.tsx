import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import GarmentDetailPage from "./page";
import type { GarmentGrouped } from "@/lib/api";

const mockPush = vi.fn();
const mockNotFound = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  notFound: () => mockNotFound(),
}));

const mockGetGarmentsGrouped = vi.fn();
const mockGetEffectivePrices = vi.fn();
const mockGetGarmentReviews = vi.fn();
const mockGetMyMeasurements = vi.fn();
const mockGetSizeAvailabilityCalendar = vi.fn();
const mockTrackGarmentView = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getGarmentsGrouped: (...args: unknown[]) => mockGetGarmentsGrouped(...args),
    getEffectivePrices: (...args: unknown[]) => mockGetEffectivePrices(...args),
    getGarmentReviews: (...args: unknown[]) => mockGetGarmentReviews(...args),
    getMyMeasurements: (...args: unknown[]) => mockGetMyMeasurements(...args),
    getSizeAvailabilityCalendar: (...args: unknown[]) => mockGetSizeAvailabilityCalendar(...args),
    trackGarmentView: (...args: unknown[]) => mockTrackGarmentView(...args),
  };
});

const mockAddToCart = vi.fn();
vi.mock("@/lib/cart", () => ({
  addToCart: (...args: unknown[]) => mockAddToCart(...args),
  cartCount: () => 1,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "cust-1", fullName: "Lê Văn C", email: "customer@example.com" },
  }),
}));

vi.mock("@/components/common/optimized-image", () => ({
  OptimizedImage: ({ alt, src }: { alt?: string; src?: string }) => (
    <img alt={alt} src={src} data-testid="optimized-image" />
  ),
}));

vi.mock("@/components/customer/navbar", () => ({
  CustomerNavbar: () => <header data-testid="customer-navbar">Navbar</header>,
}));

vi.mock("@/components/customer/footer", () => ({
  CustomerFooter: () => <footer data-testid="customer-footer">Footer</footer>,
}));

vi.mock("@/components/customer/rental-date-calendar", () => ({
  RentalDateCalendar: () => <div data-testid="rental-calendar">Calendar Mock</div>,
}));

vi.mock("@/components/try-on/realtime-tryon-modal", () => ({
  RealtimeTryOnModal: () => <div data-testid="try-on-modal">Try On Modal Mock</div>,
}));

vi.mock("@/components/customer/review-modal", () => ({
  ReviewModal: () => <div data-testid="review-modal">Review Modal Mock</div>,
}));

const sampleGarmentGroup: GarmentGrouped = {
  garmentId: "g-nhat-binh",
  name: "Áo Nhật Bình Thêu Cung Đình",
  slug: "ao-nhat-binh-cung-dinh",
  categoryName: "Cổ phục Hoàng triều",
  description: "Trang phục cung đình triều Nguyễn được phục dựng công phu.",
  color: "Đỏ cung đình",
  material: ["Lụa tơ tằm", "Chỉ kim tuyến"],
  occasion: ["Lễ cưới", "Chụp ảnh kỷ niệm"],
  careInstructions: ["Giặt khô"],
  usageConditions: ["Không kéo căng"],
  imageUrl: "/images/nhat-binh.jpg",
  accessories: [],
  images: [
    {
      id: "img-1",
      imageUrl: "/images/nhat-binh.jpg",
      altText: "Nhật Bình",
      sortOrder: 1,
    },
  ],
  sizes: [
    {
      garmentSizeId: "size-m-1",
      garmentId: "g-nhat-binh-m",
      sizeLabel: "M",
      dailyPrice: 350000,
      depositAmount: 500000,
      accessories: [],
      measurements: {
        bustCm: 90,
        waistCm: 72,
        hipCm: 96,
        lengthCm: 120,
        shoulderCm: 38,
        sleeveLengthCm: 56,
      },
    },
    {
      garmentSizeId: "size-l-1",
      garmentId: "g-nhat-binh-l",
      sizeLabel: "L",
      dailyPrice: 380000,
      depositAmount: 500000,
      accessories: [],
      measurements: {
        bustCm: 96,
        waistCm: 78,
        hipCm: 102,
        lengthCm: 122,
        shoulderCm: 40,
        sleeveLengthCm: 58,
      },
    },
  ],
};

function renderPage(slug = "ao-nhat-binh-cung-dinh") {
  const value = { slug };
  const paramsPromise = Promise.resolve(value) as any;
  paramsPromise.status = "fulfilled";
  paramsPromise.value = value;
  return render(
    <Suspense fallback={<div>Đang tải trang...</div>}>
      <GarmentDetailPage params={paramsPromise} />
    </Suspense>,
  );
}

describe("GarmentDetailPage (PDP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGarmentsGrouped.mockResolvedValue({
      success: true,
      data: [sampleGarmentGroup],
    });
    mockGetEffectivePrices.mockResolvedValue({
      success: true,
      data: [
        {
          sizeId: "size-m-1",
          basePrice: 350000,
          effectivePrice: 350000,
          hasDiscount: false,
        },
        {
          sizeId: "size-l-1",
          basePrice: 380000,
          effectivePrice: 380000,
          hasDiscount: false,
        },
      ],
    });
    mockGetGarmentReviews.mockResolvedValue({
      success: true,
      data: {
        garmentId: "g-nhat-binh",
        stats: {
          totalReviews: 1,
          averageRating: 5,
          fitStats: { true_to_size: 1 },
        },
        reviews: [],
      },
    });
    mockGetMyMeasurements.mockResolvedValue({
      success: true,
      data: {
        bustCm: 88,
        waistCm: 70,
        hipCm: 94,
        usualSize: "M",
      },
    });
    mockGetSizeAvailabilityCalendar.mockResolvedValue({
      success: true,
      data: { days: [] },
    });
  });

  it("renders garment details and size selection", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Áo Nhật Bình Thêu Cung Đình" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Cổ phục Hoàng triều/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Trang phục cung đình triều Nguyễn được phục dựng công phu."),
    ).toBeInTheDocument();

    expect(
      screen.getAllByRole("button", { name: /size m/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /size l/i })).toBeInTheDocument();
    expect(mockTrackGarmentView).toHaveBeenCalledWith("g-nhat-binh");
  });

  it("adds selected garment size to cart with confirmation toast", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Áo Nhật Bình Thêu Cung Đình" }),
    ).toBeInTheDocument();

    const addToCartButton = screen.getByRole("button", { name: /thêm vào giỏ/i });
    await user.click(addToCartButton);

    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        garmentSizeId: "size-m-1",
        garmentId: "g-nhat-binh",
        sizeLabel: "M",
        dailyPrice: 350000,
        depositAmount: 500000,
      }),
    );

    expect(
      await screen.findByText('Đã thêm "Áo Nhật Bình Thêu Cung Đình" vào giỏ'),
    ).toBeInTheDocument();
  });

  it("triggers Rent Now action and redirects to date-selection page", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Áo Nhật Bình Thêu Cung Đình" }),
    ).toBeInTheDocument();

    // Select Size L
    const sizeLButton = screen.getByRole("button", { name: /size l/i });
    await user.click(sizeLButton);

    const rentNowButton = screen.getByRole("button", { name: /thuê ngay/i });
    await user.click(rentNowButton);

    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        garmentSizeId: "size-l-1",
        sizeLabel: "L",
        dailyPrice: 380000,
      }),
    );

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("/booking/date-selection?startDate="),
    );
  });
});
