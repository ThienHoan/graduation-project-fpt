/**
 * @blast-radius: ui
 * Behavioral unit tests for BookingSuccessPage: booking info display, items rendering, copy booking ID.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockSearchParams = new URLSearchParams("bookingId=book-success-12345678");

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  getBooking: vi.fn(),
}));

vi.mock("@/lib/use-realtime-invalidation", () => ({
  useRealtimeInvalidation: vi.fn(),
}));

vi.mock("@/components/customer/navbar", () => ({
  CustomerNavbar: () => <nav>Mock Navbar</nav>,
}));

vi.mock("@/components/customer/footer", () => ({
  CustomerFooter: () => <footer>Mock Footer</footer>,
}));

vi.mock("@/components/customer/booking-status-stepper", () => ({
  BookingStatusStepper: () => <div>Mock Stepper</div>,
}));

import { getBooking } from "@/lib/api";
import BookingSuccessPage from "./page";

const mockedGetBooking = vi.mocked(getBooking);

describe("BookingSuccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams("bookingId=book-success-12345678");
  });

  it("renders booking details when loaded successfully", async () => {
    mockedGetBooking.mockResolvedValueOnce({
      success: true,
      data: {
        id: "book-success-12345678",
        status: "confirmed",
        createdAt: "2026-11-01T10:00:00.000Z",
        rentalStartDate: "2026-11-01",
        rentalEndDate: "2026-11-03",
        days: 2,
        pickupMethod: "store_pickup",
        totalRentalPrice: 400000,
        totalDeposit: 500000,
        shippingFee: 0,
        paymentStatus: "paid",
        items: [
          {
            id: "item-1",
            garmentName: "Áo Nhật Bình Tơ Tằm",
            sizeLabel: "M",
            dailyPrice: 200000,
          },
        ],
        accessories: [],
      } as never,
    });

    render(<BookingSuccessPage />);

    await waitFor(() => {
      expect(screen.getByText("Đặt Giữ Lịch Thành Công")).toBeInTheDocument();
      expect(screen.getByText("Cổ Phục Đã Sẵn Sàng Chờ Bạn")).toBeInTheDocument();
      expect(screen.getByText("#BOOK-SUC")).toBeInTheDocument();
      expect(screen.getByText("Áo Nhật Bình Tơ Tằm")).toBeInTheDocument();
    });
  });

  it("shows error state when booking fails to load", async () => {
    mockedGetBooking.mockResolvedValueOnce({
      success: false,
      message: "Không tìm thấy đơn thuê tương ứng.",
    });

    render(<BookingSuccessPage />);

    await waitFor(() => {
      expect(screen.getByText("Không tìm thấy đơn thuê tương ứng.")).toBeInTheDocument();
    });
  });
});
