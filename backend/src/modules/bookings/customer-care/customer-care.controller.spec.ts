import { describe, expect, it, vi } from "vitest";
import { CustomerCareController } from "./customer-care.controller";
import type { CustomerCareService } from "./customer-care.service";
import type { NotificationRetryService } from "./notification-retry.service";

describe("CustomerCareController", () => {
  const createMockRetryService = () => {
    return {
      retryNotification: vi.fn().mockResolvedValue({
        success: true,
        message: "Đã gửi lại thành công",
        retryCount: 1,
        logId: "log-failed-1",
        status: "accepted",
      }),
    } as unknown as NotificationRetryService;
  };

  const createMockService = () => {
    return {
      getKpis: vi.fn().mockResolvedValue({
        activeRentals: 10,
        upcomingPickups: 3,
        returnsDueToday: 2,
        completedBookings: 50,
        eligibleVoucherReviews: 12,
        dispatchedRemindersToday: 18,
        failedDispatchesToday: 0,
        systemDate: "2026-11-07",
      }),
      getReminderMonitoring: vi.fn().mockResolvedValue({
        milestones: [
          { key: "pickup_09h", name: "Pickup 09h", countToday: 3, status: "active" },
          { key: "return_12h", name: "Return 12h", countToday: 2, status: "active" },
          { key: "return_17h", name: "Return 17h", countToday: 0, status: "active" },
        ],
        recentDispatches: [],
      }),
      getAttentionList: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
      getVoucherProgramStatus: vi.fn().mockResolvedValue({
        enabled: false,
        canEnable: false,
        safetyWarning: "Customer Ownership Gap",
        issuedCount: 5,
        policy: { minimumCompletedBookings: 1, discountValue: 10 },
      }),
      getEmailTemplatesCatalog: vi.fn().mockReturnValue([
        { key: "booking.pickup_reminder", name: "Pickup Reminder" },
      ]),
      getEmailPreview: vi.fn().mockReturnValue({
        subject: "[Nhắc lịch] Nhận đồ",
        html: "<p>Email</p>",
        text: "Plain text",
      }),
      getNotificationHistory: vi.fn().mockResolvedValue({
        items: [
          {
            id: "log-1",
            action: "notification.sent",
            createdAt: "2026-11-07T09:00:00Z",
            status: "accepted",
            channels: ["email"],
            canRetry: false,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        stats: { acceptedCount: 1, failedCount: 0, unknownCount: 0 },
      }),
      getExtensionMonitoring: vi.fn().mockResolvedValue({
        kpis: {
          totalRequests: 5,
          appliedCount: 4,
          pendingCount: 1,
          expiredCount: 0,
          failedCount: 0,
          successRate: 80,
          totalPaidRevenue: 800000,
        },
        history: { items: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      }),
      getAnalytics: vi.fn().mockResolvedValue({
        period: "30d",
        bookingAnalytics: { totalBookings: 25 },
        extensionAnalytics: { successRate: 80 },
        retentionAnalytics: { retentionRate: 40 },
        charts: { bookingTrend: [] },
      }),
    } as unknown as CustomerCareService;
  };

  it("getKpis() trả về ApiResponse thành công", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const res = await controller.getKpis();

    expect(res.success).toBe(true);
    expect(res.data?.activeRentals).toBe(10);
    expect(service.getKpis).toHaveBeenCalled();
  });

  it("getReminderMonitoring() trả về thông tin giám sát 3 mốc", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const res = await controller.getReminderMonitoring();

    expect(res.success).toBe(true);
    expect(res.data?.milestones).toHaveLength(3);
    expect(service.getReminderMonitoring).toHaveBeenCalled();
  });

  it("getAttentionList() chuyển query và trả về danh sách", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const query = { page: 1, limit: 10, category: "pickup_tomorrow" as const };
    const res = await controller.getAttentionList(query);

    expect(res.success).toBe(true);
    expect(service.getAttentionList).toHaveBeenCalledWith(query);
  });

  it("getVoucherProgramStatus() trả về trạng thái khóa an toàn", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const res = await controller.getVoucherProgramStatus();

    expect(res.success).toBe(true);
    expect(res.data?.enabled).toBe(false);
    expect(res.data?.canEnable).toBe(false);
  });

  it("getEmailTemplatesCatalog() trả về danh mục template", () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const res = controller.getEmailTemplatesCatalog();

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
  });

  it("getEmailPreview() trả về bản xem trước", () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const query = { templateKey: "booking.pickup_reminder" };
    const res = controller.getEmailPreview(query);

    expect(res.success).toBe(true);
    expect(res.data?.subject).toBe("[Nhắc lịch] Nhận đồ");
    expect(service.getEmailPreview).toHaveBeenCalledWith(query);
  });

  it("getNotificationHistory() trả về danh sách lịch sử thông báo", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const query = { page: 1, limit: 10, status: "accepted" as const };
    const res = await controller.getNotificationHistory(query);

    expect(res.success).toBe(true);
    expect(res.data?.items).toHaveLength(1);
    expect(res.data?.stats.acceptedCount).toBe(1);
    expect(service.getNotificationHistory).toHaveBeenCalledWith(query);
  });

  it("retryNotification() chuyển logId và actorId cho NotificationRetryService", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const req = { user: { id: "admin-1" } };
    const res = await controller.retryNotification("log-failed-1", req);

    expect(res.success).toBe(true);
    expect(res.data?.retryCount).toBe(1);
    expect(retryService.retryNotification).toHaveBeenCalledWith("log-failed-1", "admin-1");
  });

  it("getPreferencesPolicy() trả về thông tin chính sách phân loại", () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const res = controller.getPreferencesPolicy();

    expect(res.success).toBe(true);
    expect(res.data?.status).toBe("PARTIAL_BLOCKED_PENDING_SCHEMA_MIGRATION");
    expect(res.data?.transactionalTemplates.length).toBeGreaterThan(0);
  });

  it("getExtensionMonitoring() trả về KPI và lịch sử gia hạn cho quản lý", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const query = { page: 1, limit: 10, status: "applied" };
    const res = await controller.getExtensionMonitoring(query);

    expect(res.success).toBe(true);
    expect(res.data?.kpis.totalRequests).toBe(5);
    expect(res.data?.kpis.successRate).toBe(80);
    expect(service.getExtensionMonitoring).toHaveBeenCalledWith(query);
  });

  it("getAnalytics() trả về báo cáo phân tích hiệu quả chăm sóc khách hàng", async () => {
    const service = createMockService();
    const retryService = createMockRetryService();
    const controller = new CustomerCareController(service, retryService);

    const query = { period: "30d" as const };
    const res = await controller.getAnalytics(query);

    expect(res.success).toBe(true);
    expect(res.data?.period).toBe("30d");
    expect(res.data?.bookingAnalytics.totalBookings).toBe(25);
    expect(service.getAnalytics).toHaveBeenCalledWith(query);
  });
});

