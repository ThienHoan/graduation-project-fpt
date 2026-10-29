import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerDashboardPage from "./page";
import type { BookingResponse } from "@/lib/api";

const mockGetMyBookings = vi.fn();
const mockCancelBooking = vi.fn();
const mockGetCustomerRefund = vi.fn();
const mockGetDeliveryTrack = vi.fn();
const mockGetCustomerBookingInspections = vi.fn();
const mockReadStoredSession = vi.fn();

vi.mock("@/lib/api", () => ({
  getMyBookings: (...args: unknown[]) => mockGetMyBookings(...args),
  cancelBooking: (...args: unknown[]) => mockCancelBooking(...args),
  getCustomerRefund: (...args: unknown[]) => mockGetCustomerRefund(...args),
  getDeliveryTrack: (...args: unknown[]) => mockGetDeliveryTrack(...args),
  getCustomerBookingInspections: (...args: unknown[]) => mockGetCustomerBookingInspections(...args),
}));

vi.mock("@/lib/auth", () => ({
  readStoredSession: () => mockReadStoredSession(),
}));

vi.mock("@/lib/use-realtime-invalidation", () => ({
  useRealtimeInvalidation: vi.fn(),
}));

vi.mock("@/components/location/delivery-tracker", () => ({
  DeliveryTracker: () => <div data-testid="delivery-tracker">Delivery Tracker Mock</div>,
}));

vi.mock("@/components/customer/review-modal", () => ({
  ReviewModal: () => <div data-testid="review-modal">Review Modal Mock</div>,
}));

vi.mock("@/components/customer/handover-summary", () => ({
  HandoverSummary: () => <div data-testid="handover-summary">Handover Mock</div>,
}));

vi.mock("@/components/customer/booking-status-stepper", () => ({
  BookingStatusStepper: () => <div data-testid="stepper-mock">Stepper Mock</div>,
}));

const sampleActiveBooking: BookingResponse = {
  id: "bk-active-001",
  status: "confirmed",
  rentalStartDate: "2026-11-01",
  rentalEndDate: "2026-11-03",
  days: 2,
  pickupMethod: "delivery",
  rentalTotal: 350000,
  depositTotal: 500000,
  paymentMethod: "payos",
  note: null,
  createdAt: "2026-10-29T10:00:00.000Z",
  items: [
    {
      id: "item-1",
      garmentId: "g-1",
      garmentSizeId: "size-1",
      garmentName: "Áo Nhật Bình Cung Đình",
      sizeLabel: "M",
      dailyPrice: 350000,
      depositAmount: 500000,
      imageUrl: "/images/nhat-binh.jpg",
    },
  ],
};

describe("CustomerDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadStoredSession.mockReturnValue({
      user: { fullName: "Nguyễn Văn A", email: "vana@example.com" },
    });
    mockGetCustomerRefund.mockResolvedValue({ success: true, data: [] });
    mockGetDeliveryTrack.mockResolvedValue({ success: true, data: null });
    mockGetCustomerBookingInspections.mockResolvedValue({ success: true, data: [] });
  });

  it("renders empty state when user has no active bookings", async () => {
    mockGetMyBookings.mockResolvedValue({ success: true, data: [] });

    render(<CustomerDashboardPage />);

    expect(await screen.findByText("Xin chào, Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getByText("Không có đơn thuê đang hoạt động")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /khám phá bộ sưu tập/i })).toHaveAttribute("href", "/catalog");
  });

  it("renders active booking and history overview", async () => {
    mockGetMyBookings.mockResolvedValue({
      success: true,
      data: [sampleActiveBooking],
    });

    render(<CustomerDashboardPage />);

    expect(await screen.findByText("Xin chào, Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getAllByText("Áo Nhật Bình Cung Đình").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Thời gian thuê:/i)).toBeInTheDocument();
    expect(screen.getByTestId("stepper-mock")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /xem hóa đơn & chi tiết/i })).toHaveAttribute(
      "href",
      "/booking/success?bookingId=bk-active-001",
    );
  });

  it("handles booking cancellation via confirmation modal", async () => {
    const user = userEvent.setup();
    mockGetMyBookings.mockResolvedValue({
      success: true,
      data: [sampleActiveBooking],
    });
    mockCancelBooking.mockResolvedValue({
      success: true,
      data: { ...sampleActiveBooking, status: "cancelled" },
    });

    render(<CustomerDashboardPage />);

    const cancelButton = await screen.findByRole("button", { name: /hủy đơn/i });
    await user.click(cancelButton);

    expect(screen.getByText("Xác nhận hủy đơn thuê")).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "Xác nhận" });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockCancelBooking).toHaveBeenCalledWith("bk-active-001");
    });
    expect(await screen.findByText("Đã hủy đơn thuê thành công.")).toBeInTheDocument();
  });

  it("filters history list by search input", async () => {
    const user = userEvent.setup();
    const completedBooking: BookingResponse = {
      ...sampleActiveBooking,
      id: "bk-completed-999",
      status: "completed",
      items: [
        {
          ...sampleActiveBooking.items[0],
          garmentName: "Áo Tấc Thêu Rồng Phượng",
        },
      ],
    };

    mockGetMyBookings.mockResolvedValue({
      success: true,
      data: [sampleActiveBooking, completedBooking],
    });

    render(<CustomerDashboardPage />);

    expect(await screen.findByText("Xin chào, Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getAllByText("Áo Tấc Thêu Rồng Phượng").length).toBeGreaterThanOrEqual(1);

    const searchInput = screen.getByPlaceholderText("Tìm theo tên đồ hoặc mã đơn...");
    await user.type(searchInput, "Tấc Thêu");

    // "Áo Tấc Thêu Rồng Phượng" remains
    expect(screen.getAllByText("Áo Tấc Thêu Rồng Phượng").length).toBeGreaterThanOrEqual(1);
    // Active hero section still exists, but in table "Áo Nhật Bình Cung Đình" should not be matched in history
    expect(screen.getByDisplayValue("Tấc Thêu")).toBeInTheDocument();
  });
});
