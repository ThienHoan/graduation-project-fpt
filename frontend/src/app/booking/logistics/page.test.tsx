/**
 * @blast-radius: ui
 * Behavioral unit tests for BookingLogisticsPage: method selection, address loading, continue to review.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let mockSearchParams = new URLSearchParams({
  startDate: "2026-11-01",
  endDate: "2026-11-03",
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  getShippingFee: vi.fn(),
  getStoreInfo: vi.fn().mockResolvedValue({
    success: true,
    data: {
      name: "Heritage Atelier Đà Nẵng",
      address: "FPT City, Ngũ Hành Sơn, Đà Nẵng",
      phone: "0236 730 0999",
      businessHours: "09:00 - 20:00",
    },
  }),
  normalizePickupMethod: vi.fn((m) => m ?? "store_pickup"),
}));

vi.mock("@/components/customer/navbar", () => ({
  CustomerNavbar: () => <nav>Mock Navbar</nav>,
}));

vi.mock("@/components/customer/footer", () => ({
  CustomerFooter: () => <footer>Mock Footer</footer>,
}));

import { apiRequest, getShippingFee } from "@/lib/api";
import BookingLogisticsPage from "./page";

const mockedApiRequest = vi.mocked(apiRequest);
const mockedGetShippingFee = vi.mocked(getShippingFee);

describe("BookingLogisticsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams({
      startDate: "2026-11-01",
      endDate: "2026-11-03",
    });
  });

  it("renders error state when rental dates are invalid or missing", () => {
    mockSearchParams = new URLSearchParams({});

    render(<BookingLogisticsPage />);

    expect(screen.getByText(/Thông tin đặt lịch không hợp lệ/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chọn lại trang phục/i })).toBeInTheDocument();
  });

  it("allows selecting store pickup and proceeds to review", async () => {
    const user = userEvent.setup();
    render(<BookingLogisticsPage />);

    expect(screen.getByText("Phương thức nhận đồ")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Heritage Atelier Đà Nẵng")).toBeInTheDocument();
    });

    const continueBtn = screen.getByRole("button", { name: /Sang bước kiểm tra đơn/i });
    expect(continueBtn).not.toBeDisabled();

    await user.click(continueBtn);

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/booking/review?startDate=2026-11-01&endDate=2026-11-03&pickupMethod=store_pickup"),
    );
  });

  it("allows selecting delivery, loads addresses and estimates shipping fee", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: "addr-1",
          receiverName: "Nguyen Van A",
          phone: "0901234567",
          line1: "123 Tran Phu",
          ward: "Hai Chau 1",
          district: "Hai Chau",
          city: "Da Nang",
          latitude: 16.0678,
          longitude: 108.2208,
          isDefault: true,
          createdAt: "2026-01-01",
        },
      ],
    });

    mockedGetShippingFee.mockResolvedValueOnce({
      success: true,
      data: {
        estimatedFee: 35000,
        distanceKm: 5.2,
        durationMinutes: 20,
        distanceText: "5.2 km",
        durationText: "20 phút",
        routeType: "intra",
        routeLabel: "Nội thành",
        deliveryTimeText: "Trong ngày",
        storeLat: 16.05,
        storeLng: 108.2,
        customerLat: 16.06,
        customerLng: 108.22,
      },
    });

    render(<BookingLogisticsPage />);

    const deliveryOption = screen.getByText("Giao tận nơi");
    await user.click(deliveryOption);

    await waitFor(() => {
      expect(screen.getByText("Địa chỉ giao nhận")).toBeInTheDocument();
      expect(screen.getByText(/123 Tran Phu/i)).toBeInTheDocument();
      expect(screen.getByText(/35.000/i)).toBeInTheDocument();
    });

    const continueBtn = screen.getByRole("button", { name: /Sang bước kiểm tra đơn/i });
    await user.click(continueBtn);

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/booking/review?startDate=2026-11-01&endDate=2026-11-03&pickupMethod=delivery&deliveryAddressId=addr-1&shippingFee=35000"),
    );
  });
});
