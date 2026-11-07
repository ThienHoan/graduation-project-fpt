import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import CustomerCarePage from "./page";
import * as customerCareApi from "@/lib/customer-care-api";

// Mock router and auth
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard/manager/customer-care",
}));

vi.mock("@/lib/auth", () => ({
  readStoredAccessToken: () => "mock-token",
  readStoredSession: () => ({
    user: { id: "mgr-1", email: "manager@cophuc.vn", role: "manager_owner" },
  }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "mgr-1", email: "manager@cophuc.vn", role: "manager_owner", fullName: "Quản Lý Hoàng Thành" },
    session: { user: { id: "mgr-1", email: "manager@cophuc.vn", role: "manager_owner" } },
    signOut: vi.fn(),
    isAuthenticated: true,
  }),
}));

describe("CustomerCarePage & Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(customerCareApi, "fetchCustomerCareKpis").mockResolvedValue({
      success: true,
      data: {
        activeRentals: 15,
        upcomingPickups: 6,
        returnsDueToday: 4,
        completedBookings: 88,
        eligibleVoucherReviews: 14,
        dispatchedRemindersToday: 22,
        failedDispatchesToday: 0,
        systemDate: "2026-11-07",
      },
    });

    vi.spyOn(customerCareApi, "fetchAttentionList").mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            bookingCode: "CP-9901",
            customerId: "cust-1",
            customerName: "Nguyễn Thị Hoa",
            customerPhone: "0901234567",
            customerEmail: "hoa@gmail.com",
            garmentName: "Nhật Bình Hoàng Gia",
            pickupMethod: "store_pickup",
            rentalStartDate: "2026-11-08",
            rentalEndDate: "2026-11-10",
            status: "confirmed",
            attentionCategory: "pickup_tomorrow",
            attentionReason: "Lịch nhận đồ vào ngày mai (09h)",
            hasPendingExtension: false,
            isOverdue: false,
            overdueDays: 0,
          },
        ],
        total: 1,
        page: 1,
        limit: 15,
        totalPages: 1,
      },
    });

    vi.spyOn(customerCareApi, "fetchReminderMonitoring").mockResolvedValue({
      success: true,
      data: {
        milestones: [
          {
            key: "pickup_09h",
            name: "Nhắc nhận đồ ngày mai (09:00)",
            scheduleTime: "09:00",
            targetDescription: "Đơn thuê bắt đầu nhận vào ngày mai",
            cronExpression: "0 9 * * *",
            lastRunAt: "2026-11-07T09:00:00Z",
            countToday: 6,
            status: "active",
          },
          {
            key: "return_12h",
            name: "Nhắc trả đồ trưa (12:00)",
            scheduleTime: "12:00",
            targetDescription: "Đơn thuê hết hạn hôm nay",
            cronExpression: "0 12 * * *",
            lastRunAt: "2026-11-07T12:00:00Z",
            countToday: 4,
            status: "active",
          },
          {
            key: "return_17h",
            name: "Cảnh báo trước giờ đóng cửa (17:00)",
            scheduleTime: "17:00",
            targetDescription: "Đơn thuê hết hạn hôm nay (T-3h)",
            cronExpression: "0 17 * * *",
            lastRunAt: "2026-11-07T17:00:00Z",
            countToday: 4,
            status: "active",
          },
        ],
        recentDispatches: [],
      },
    });

    vi.spyOn(customerCareApi, "fetchVoucherProgramStatus").mockResolvedValue({
      success: true,
      data: {
        enabled: false,
        safetyWarning:
          "Chương trình Voucher Tri Ân chưa được kích hoạt vì hệ thống chưa hỗ trợ giới hạn voucher theo đúng khách hàng được tặng (Customer Ownership Gap).",
        issuedCount: 12,
        policy: {
          minimumCompletedBookings: 1,
          discountValue: 10,
          discountType: "percentage",
          maxUsage: 1,
          validityDays: 30,
          codePrefix: "TRIAN-",
          targetTier: "all",
        },
        retentionTargetDescription: "Tặng voucher 10% sau đơn đầu tiên.",
        canEnable: false,
      },
    });

    vi.spyOn(customerCareApi, "fetchEmailTemplatesCatalog").mockResolvedValue({
      success: true,
      data: [
        {
          key: "booking.pickup_reminder",
          name: "Nhắc Lịch Nhận Cổ Phục (T-1)",
          description: "Gửi lúc 09h00",
          category: "reminder",
          variants: ["store_pickup", "delivery"],
        },
        {
          key: "booking.return_reminder",
          name: "Nhắc Hạn Hoàn Trả Cổ Phục",
          description: "Gửi lúc 12h00 hoặc 17h00",
          category: "reminder",
          variants: ["daily_12h", "before_close_17h"],
        },
      ],
    });

    vi.spyOn(customerCareApi, "fetchEmailPreview").mockResolvedValue({
      success: true,
      data: {
        templateKey: "booking.pickup_reminder",
        subject: "[Nhắc lịch] Ngày mai là ngày nhận cổ phục đơn #CP-9901",
        title: "Nhắc Lịch Nhận Cổ Phục",
        html: "<html><body><p>Preview HTML Content</p></body></html>",
        text: "Preview Plain Text Content",
      },
    });

    vi.spyOn(customerCareApi, "fetchNotificationHistory").mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: "notif-hist-1",
            action: "notification.sent",
            createdAt: "2026-11-07T09:00:00Z",
            status: "accepted",
            notificationType: "pickup_reminder",
            bookingCode: "CP-9901",
            recipientName: "Nguyễn Thị Hoa",
            recipientEmail: "hoa@gmail.com",
            channels: ["email"],
            provider: "smtp",
            canRetry: false,
            retryCount: 0,
          },
          {
            id: "notif-hist-2",
            action: "notification.failed",
            createdAt: "2026-11-07T10:00:00Z",
            status: "failed",
            notificationType: "return_reminder",
            bookingCode: "CP-9902",
            recipientName: "Trần Văn An",
            recipientEmail: "an@gmail.com",
            channels: ["email"],
            provider: "resend",
            error: "Connection timeout",
            canRetry: true,
            retryCount: 0,
          },
        ],
        total: 2,
        page: 1,
        limit: 15,
        totalPages: 1,
        stats: { acceptedCount: 1, failedCount: 1, unknownCount: 0 },
      },
    });

    vi.spyOn(customerCareApi, "fetchManagerExtensionMonitoring").mockResolvedValue({
      success: true,
      data: {
        kpis: {
          totalRequests: 8,
          appliedCount: 5,
          pendingCount: 2,
          expiredCount: 1,
          failedCount: 0,
          successRate: 62.5,
          totalPaidRevenue: 1500000,
        },
        history: {
          items: [
            {
              id: "ext-1",
              bookingId: "b-1",
              bookingCode: "CP-8801",
              customerId: "cust-1",
              customerName: "Lê Văn An",
              customerEmail: "an@cophuc.vn",
              customerPhone: "0912345678",
              garmentName: "Áo Tấc Thêu Hoa Mai",
              previousEndDate: "2026-11-10T12:00:00Z",
              newEndDate: "2026-11-12T12:00:00Z",
              extraDays: 2,
              amount: 400000,
              status: "applied",
              paymentStatus: "paid",
              paymentId: "p-1",
              checkoutUrl: null,
              expiresAt: "2026-11-08T12:15:00Z",
              appliedAt: "2026-11-08T12:10:00Z",
              note: "Gia hạn thêm 2 ngày",
              createdAt: "2026-11-08T12:00:00Z",
              isHoldActive: false,
            },
          ],
          total: 1,
          page: 1,
          limit: 15,
          totalPages: 1,
        },
      },
    });

    vi.spyOn(customerCareApi, "fetchCustomerCareAnalytics").mockResolvedValue({
      success: true,
      data: {
        period: "30d",
        fromDate: "2026-10-08",
        toDate: "2026-11-07",
        systemDate: "2026-11-07",
        bookingAnalytics: {
          totalBookings: 120,
          completedBookings: 88,
          rentingBookings: 15,
          upcomingPickups: 6,
          returnsDueToday: 4,
          overdueBookings: 2,
        },
        reminderAnalytics: {
          pickup09hDispatches: 45,
          return12hDispatches: 38,
          return17hDispatches: 30,
          totalDispatches: 113,
          failedDispatches: 1,
        },
        emailAnalytics: {
          acceptedCount: 110,
          failedCount: 2,
          unknownCount: 1,
          retryDispatches: 1,
        },
        extensionAnalytics: {
          totalRequests: 25,
          appliedCount: 18,
          pendingCount: 4,
          expiredOrFailedCount: 3,
          successRate: 72,
          totalPaidRevenue: 5400000,
        },
        retentionAnalytics: {
          totalActiveCustomers: 95,
          firstTimeRenters: 65,
          returningRenters: 30,
          retentionRate: 31.6,
          tierDistribution: {
            singleBooking: 65,
            twoToThreeBookings: 24,
            fourPlusBookings: 6,
          },
        },
        voucherAnalytics: {
          issuedCount: 12,
          programStatus: "DISABLED",
          safetyWarning:
            "Tạm ngừng phát hành tự động để bảo toàn ngân sách cho đến khi có cơ chế kiểm tra quyền sở hữu khách hàng.",
        },
        charts: {
          bookingTrend: [
            { date: "2026-11-06", bookingsCount: 5, completedCount: 3 },
            { date: "2026-11-07", bookingsCount: 8, completedCount: 4 },
          ],
          reminderBreakdown: [
            { name: "Nhắc nhận đồ (09h)", count: 45, color: "#059669" },
            { name: "Nhắc trả đồ (12h)", count: 38, color: "#D97706" },
            { name: "Nhắc trả đồ (17h)", count: 30, color: "#2563EB" },
            { name: "Gửi thất bại", count: 1, color: "#DC2626" },
          ],
          emailStatusBreakdown: [
            { name: "Đã tiếp nhận (Accepted)", count: 110, color: "#059669" },
            { name: "Thất bại (Failed)", count: 2, color: "#DC2626" },
            { name: "Chưa rõ (Unknown)", count: 1, color: "#D97706" },
          ],
          extensionBreakdown: [
            { name: "Đã áp dụng (Applied)", count: 18, color: "#059669" },
            { name: "Chờ thanh toán (Pending)", count: 4, color: "#D97706" },
            { name: "Hết hạn / Hủy", count: 3, color: "#6B7280" },
          ],
          customerSegmentation: [
            { name: "Khách thuê lần đầu", count: 65, color: "#6B7280" },
            { name: "Khách hàng quay lại (≥2)", count: 30, color: "#881337" },
          ],
        },
      },
    });
  });

  it("render trang và hiển thị đúng tiêu đề cùng các thẻ KPI", async () => {
    render(<CustomerCarePage />);

    expect(screen.getAllByText(/Trung tâm Chăm sóc Khách hàng/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Giám sát thông báo nhắc lịch/i).length,
    ).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getAllByText("15").length).toBeGreaterThan(0); // active rentals
      expect(screen.getAllByText("6").length).toBeGreaterThan(0); // upcoming pickups
      expect(screen.getAllByText("4").length).toBeGreaterThan(0); // returns due today
    });
  });

  it("hiển thị danh sách đơn cần chăm sóc ở Tab 1", async () => {
    render(<CustomerCarePage />);

    await waitFor(() => {
      expect(screen.getByText("#CP-9901")).toBeDefined();
      expect(screen.getByText("Nguyễn Thị Hoa")).toBeDefined();
      expect(screen.getByText("Nhật Bình Hoàng Gia")).toBeDefined();
      expect(screen.getByText("Lịch nhận đồ vào ngày mai (09h)")).toBeDefined();
    });
  });

  it("chuyển sang Tab 2 và hiển thị thông tin 3 mốc nhắc lịch 09h, 12h, 17h", async () => {
    render(<CustomerCarePage />);

    const reminderTabBtn = screen.getByRole("button", { name: /Giám Sát Nhắc Lịch/i });
    fireEvent.click(reminderTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Mốc 09:00")).toBeDefined();
      expect(screen.getByText("Mốc 12:00")).toBeDefined();
      expect(screen.getByText("Mốc 17:00")).toBeDefined();
      expect(screen.getByText("0 9 * * *")).toBeDefined();
      expect(screen.getByText("0 12 * * *")).toBeDefined();
      expect(screen.getByText("0 17 * * *")).toBeDefined();
    });
  });

  it("chuyển sang Tab 3 và hiển thị Safety Warning Banner về Customer Ownership Gap", async () => {
    render(<CustomerCarePage />);

    const voucherTabBtn = screen.getByRole("button", { name: /Voucher Tri Ân/i });
    fireEvent.click(voucherTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/Chính Sách An Toàn Nghiệp Vụ/i)).toBeDefined();
      expect(screen.getByText(/Customer Ownership Gap/i)).toBeDefined();
      expect(screen.getByText(/Trạng thái: Tạm khóa bảo vệ/i)).toBeDefined();
      expect(screen.getByText("12")).toBeDefined(); // issued count
    });
  });

  it("chuyển sang Tab 4 và xem trước mẫu email HTML iframe và văn bản", async () => {
    render(<CustomerCarePage />);

    const previewTabBtn = screen.getByRole("button", { name: /Xem Trước Mẫu Email/i });
    fireEvent.click(previewTabBtn);

    await waitFor(() => {
      expect(screen.getByText("[Nhắc lịch] Ngày mai là ngày nhận cổ phục đơn #CP-9901")).toBeDefined();
      expect(screen.getByTitle("Email Preview Sandboxed Frame")).toBeDefined();
    });

    // Chuyển sang Văn bản thuần
    const textModeBtn = screen.getByRole("button", { name: "Văn Bản Thuần" });
    fireEvent.click(textModeBtn);

    await waitFor(() => {
      expect(screen.getByText("Preview Plain Text Content")).toBeDefined();
    });
  });

  it("chuyển sang Tab 5 và hiển thị Lịch Sử Thông Báo với trạng thái accepted và failed", async () => {
    render(<CustomerCarePage />);

    const historyTabBtn = screen.getByRole("button", { name: /Lịch Sử Thông Báo/i });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Bảo vệ tính trung thực:")).toBeDefined();
      expect(screen.getByText("Đã tiếp nhận (Accepted)")).toBeDefined();
      expect(screen.getByText("#CP-9901")).toBeDefined();
      expect(screen.getByText("#CP-9902")).toBeDefined();
      expect(screen.getByText("Connection timeout")).toBeDefined();
      expect(screen.getByRole("button", { name: /Gửi lại/i })).toBeDefined();
    });
  });

  it("chuyển sang Tab 6 và hiển thị Giám Sát Gia Hạn với KPIs và bảng lịch sử", async () => {
    render(<CustomerCarePage />);

    const extensionTabBtn = screen.getByRole("button", { name: /Giám Sát Gia Hạn/i });
    fireEvent.click(extensionTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Yêu cầu gia hạn")).toBeDefined();
      expect(screen.getByText("Gia hạn thành công")).toBeDefined();
      expect(screen.getByText("62.5%")).toBeDefined();
      expect(screen.getByText("1.500.000 ₫")).toBeDefined();
      expect(screen.getByText("#CP-8801")).toBeDefined();
      expect(screen.getByText("Áo Tấc Thêu Hoa Mai")).toBeDefined();
      expect(screen.getByText("+2 ngày")).toBeDefined();
      expect(screen.getByText("400.000 ₫")).toBeDefined();
    });
  });

  it("chuyển sang Tab 7 và hiển thị Phân Tích & Báo Cáo với các biểu đồ SVG và KPIs", async () => {
    render(<CustomerCarePage />);

    const analyticsTabBtn = screen.getByRole("button", { name: /Phân Tích & Báo Cáo/i });
    fireEvent.click(analyticsTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Múi giờ: Asia/Ho_Chi_Minh (GMT+7)")).toBeDefined();
      expect(screen.getByText("Đơn Hàng & Vận Hành")).toBeDefined();
      expect(screen.getByText("Tự Động Hóa Nhắc Lịch")).toBeDefined();
      expect(screen.getByText("Độ Tin Cậy Email")).toBeDefined();
      expect(screen.getByText("Hiệu Quả Gia Hạn")).toBeDefined();
      expect(screen.getByText("Giữ Chân Khách Hàng")).toBeDefined();
      expect(screen.getByText("31.6%")).toBeDefined();
      expect(screen.getByText(/Xu Hướng Khối Lượng Đơn Hàng Theo Ngày/i)).toBeDefined();
      expect(screen.getByText(/Cơ Cấu Nhắc Lịch Tự Động/i)).toBeDefined();
    });
  });
});
