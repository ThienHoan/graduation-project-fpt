import { describe, expect, it, vi } from "vitest";
import { BookingStatus } from "@prisma/client";
import { CustomerCareService } from "./customer-care.service";
import { EmailPreviewService } from "../email/email-preview.service";
import { EmailTemplateBuilder } from "../email/email-templates.builder";

describe("CustomerCareService", () => {
  const createMockPrisma = () => {
    return {
      booking: {
        count: vi.fn().mockImplementation((args: any) => {
          if (args?.where?.status === BookingStatus.renting && args?.where?.rentalEndDate) {
            return Promise.resolve(4); // returns due today
          }
          if (args?.where?.status === BookingStatus.renting) {
            return Promise.resolve(12); // active rentals
          }
          if (args?.where?.rentalStartDate) {
            return Promise.resolve(5); // upcoming pickups
          }
          if (args?.where?.status === BookingStatus.completed) {
            return Promise.resolve(45); // completed bookings
          }
          return Promise.resolve(10);
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "00000000-0000-4000-8000-000000000001",
            bookingCode: "CP-0001",
            customerId: "user-1",
            status: BookingStatus.renting,
            rentalStartDate: new Date("2026-11-05"),
            rentalEndDate: new Date("2026-11-07"),
            pickupMethod: "store_pickup",
            customer: {
              email: "khach1@gmail.com",
              profile: { fullName: "Nguyễn Văn A", phone: "0901234567" },
            },
            items: [
              {
                garment_sizes: {
                  garments: { name: "Nhật Bình Hoàng Gia" },
                },
              },
            ],
            extensions: [],
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            bookingCode: "CP-0002",
            customerId: "user-2",
            status: BookingStatus.renting,
            rentalStartDate: new Date("2026-11-01"),
            rentalEndDate: new Date("2026-11-05"),
            pickupMethod: "delivery",
            customer: {
              email: "khach2@gmail.com",
              profile: { fullName: "Trần Thị B", phone: "0912345678" },
            },
            items: [
              {
                garment_sizes: {
                  garments: { name: "Áo Tấc Gấm" },
                },
              },
            ],
            extensions: [{ id: "ext-1", status: "pending" }],
          },
        ]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      auditLog: {
        count: vi.fn().mockImplementation((args: any) => {
          if (args?.where?.action === "voucher.thank_you_issued") {
            return Promise.resolve(8);
          }
          if (args?.where?.action === "notification.failed") {
            return Promise.resolve(1);
          }
          return Promise.resolve(15);
        }),
        findFirst: vi.fn().mockImplementation((args: any) => {
          if (args?.where?.action === "notification.pickup_reminder_dispatched") {
            return Promise.resolve({
              id: "log-1",
              action: "notification.pickup_reminder_dispatched",
              createdAt: new Date("2026-11-07T09:00:00Z"),
              entityId: "00000000-0000-4000-8000-000000000001",
            });
          }
          return Promise.resolve({
            id: "log-2",
            action: "notification.return_reminder_dispatched",
            createdAt: new Date("2026-11-07T12:00:00Z"),
            entityId: "00000000-0000-4000-8000-000000000002",
          });
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "log-1",
            action: "notification.pickup_reminder_dispatched",
            createdAt: new Date("2026-11-07T09:00:00Z"),
            entityId: "00000000-0000-4000-8000-000000000001",
            metadata: { bookingCode: "CP-0001" },
          },
          {
            id: "log-2",
            action: "notification.return_reminder_dispatched",
            createdAt: new Date("2026-11-07T12:00:00Z"),
            entityId: "00000000-0000-4000-8000-000000000002",
            metadata: { bookingCode: "CP-0002", scheduleType: "daily" },
          },
          {
            id: "log-3",
            action: "notification.return_reminder_dispatched",
            createdAt: new Date("2026-11-07T17:00:00Z"),
            entityId: "00000000-0000-4000-8000-000000000003",
            metadata: { bookingCode: "CP-0003", scheduleType: "before_close" },
          },
        ]),
      },
      userAccount: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "user-1",
            email: "khach1@gmail.com",
            profile: { fullName: "Nguyễn Văn A", phone: "0901234567" },
          },
        ]),
      },
      bookingExtension: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
    } as any;
  };

  const builder = new EmailTemplateBuilder();
  const previewService = new EmailPreviewService(builder);

  it("getKpis() trả về dữ liệu KPI thời gian thực đầy đủ", async () => {
    const prisma = createMockPrisma();
    const service = new CustomerCareService(prisma, previewService);

    const kpis = await service.getKpis();

    expect(kpis.activeRentals).toBe(12);
    expect(kpis.upcomingPickups).toBe(5);
    expect(kpis.returnsDueToday).toBe(4);
    expect(kpis.completedBookings).toBe(45);
    expect(kpis.dispatchedRemindersToday).toBe(15);
    expect(kpis.failedDispatchesToday).toBe(1);
    expect(kpis.systemDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getReminderMonitoring() trả về 3 mốc 09h, 12h, 17h và lịch sử gửi", async () => {
    const prisma = createMockPrisma();
    const service = new CustomerCareService(prisma, previewService);

    const monitoring = await service.getReminderMonitoring();

    expect(monitoring.milestones).toHaveLength(3);
    expect(monitoring.milestones[0].key).toBe("pickup_09h");
    expect(monitoring.milestones[0].cronExpression).toBe("0 9 * * *");
    expect(monitoring.milestones[1].key).toBe("return_12h");
    expect(monitoring.milestones[1].cronExpression).toBe("0 12 * * *");
    expect(monitoring.milestones[2].key).toBe("return_17h");
    expect(monitoring.milestones[2].cronExpression).toBe("0 17 * * *");
    expect(monitoring.recentDispatches.length).toBeGreaterThan(0);
  });

  it("getAttentionList() lọc và xác định đúng lý do cần chăm sóc", async () => {
    const prisma = createMockPrisma();
    const service = new CustomerCareService(prisma, previewService);

    const result = await service.getAttentionList({
      page: 1,
      limit: 10,
      category: "all",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].bookingCode).toBe("CP-0001");
    expect(result.items[0].garmentName).toBe("Nhật Bình Hoàng Gia");
    // Đơn 2 có extension pending
    expect(result.items[1].hasPendingExtension).toBe(true);
    expect(result.items[1].attentionCategory).toBe("pending_extension");
    expect(result.items[1].attentionReason).toContain("gia hạn");
  });

  it("getVoucherProgramStatus() tuân thủ Safety Gate (canEnable = false, enabled = false)", async () => {
    const prisma = createMockPrisma();
    const service = new CustomerCareService(prisma, previewService);

    const voucherStatus = await service.getVoucherProgramStatus();

    expect(voucherStatus.enabled).toBe(false);
    expect(voucherStatus.canEnable).toBe(false);
    expect(voucherStatus.safetyWarning).toContain("Customer Ownership Gap");
    expect(voucherStatus.policy.minimumCompletedBookings).toBe(1);
    expect(voucherStatus.policy.discountValue).toBe(10);
  });

  it("getEmailTemplatesCatalog() trả về danh mục 5 template email", () => {
    const prisma = createMockPrisma();
    const service = new CustomerCareService(prisma, previewService);

    const catalog = service.getEmailTemplatesCatalog();

    expect(catalog).toHaveLength(5);
    const keys = catalog.map((c) => c.key);
    expect(keys).toContain("booking.pickup_reminder");
    expect(keys).toContain("booking.return_reminder");
    expect(keys).toContain("booking.extension_applied");
    expect(keys).toContain("booking.thank_you_voucher");
    expect(keys).toContain("booking.review_invite");
  });

  it("getEmailPreview() sinh bản xem trước HTML và Plain Text hợp lệ", () => {
    const prisma = createMockPrisma();
    const service = new CustomerCareService(prisma, previewService);

    const preview = service.getEmailPreview({
      templateKey: "booking.pickup_reminder",
      variant: "store_pickup",
    });

    expect(preview.subject).toContain("Nhắc lịch");
    expect(preview.html).toContain("<!DOCTYPE html>");
    expect(preview.text).toBeDefined();
  });

  it("getNotificationHistory() truy vấn lịch sử, sanitize lỗi và không bao giờ tự tổng hợp trạng thái delivered", async () => {
    const prisma = createMockPrisma();
    prisma.auditLog.findMany = vi.fn().mockResolvedValue([
      {
        id: "log-sent-1",
        action: "notification.sent",
        createdAt: new Date("2026-11-07T09:05:00Z"),
        entityType: "notification",
        entityId: "notif-1",
        actorId: null,
        metadata: {
          templateKey: "booking.pickup_reminder",
          bookingId: "00000000-0000-4000-8000-000000000001",
          email: "customer@gmail.com",
          channels: ["email"],
          emailStatus: { status: "sent", provider: "smtp" },
        },
      },
      {
        id: "log-failed-1",
        action: "notification.failed",
        createdAt: new Date("2026-11-07T10:00:00Z"),
        entityType: "notification",
        entityId: null,
        actorId: null,
        metadata: {
          templateKey: "booking.return_reminder",
          bookingId: "00000000-0000-4000-8000-000000000002",
          email: "fail@gmail.com",
          provider: "resend",
          error: "Resend key re_secretkey12345 failed with connection timeout",
          retryCount: 1,
        },
      },
      {
        id: "log-unknown-1",
        action: "notification.custom_test",
        createdAt: new Date("2026-11-07T11:00:00Z"),
        entityType: "system",
        entityId: null,
        actorId: null,
        metadata: {},
      },
    ]);
    prisma.auditLog.count = vi.fn().mockImplementation((args: any) => {
      if (args?.where?.action === "notification.failed") return Promise.resolve(1);
      return Promise.resolve(3);
    });

    const service = new CustomerCareService(prisma, previewService);
    const result = await service.getNotificationHistory({ page: 1, limit: 10 });

    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);

    // Kiểm tra status derivation
    const sentItem = result.items.find((i) => i.id === "log-sent-1");
    expect(sentItem?.status).toBe("accepted");
    expect(sentItem?.status).not.toBe("delivered"); // Tuyệt đối không tự suy diễn delivered
    expect(sentItem?.canRetry).toBe(false);

    const failedItem = result.items.find((i) => i.id === "log-failed-1");
    expect(failedItem?.status).toBe("failed");
    expect(failedItem?.error).toContain("re_[REDACTED]"); // Đã được sanitize
    expect(failedItem?.error).not.toContain("re_secretkey12345");
    expect(failedItem?.canRetry).toBe(true);
    expect(failedItem?.retryCount).toBe(1);

    const unknownItem = result.items.find((i) => i.id === "log-unknown-1");
    expect(unknownItem?.status).toBe("unknown");

    expect(result.stats.acceptedCount).toBeDefined();
    expect(result.stats.failedCount).toBe(1);
  });

  it("getExtensionMonitoring() tổng hợp KPI gia hạn và danh sách chi tiết", async () => {
    const prisma = createMockPrisma();
    prisma.bookingExtension.findMany = vi.fn().mockResolvedValue([
      {
        id: "ext-1",
        bookingId: "00000000-0000-4000-8000-000000000001",
        previousEndDate: new Date("2026-11-08"),
        newEndDate: new Date("2026-11-10"),
        extraDays: 2,
        amount: 200000,
        status: "applied",
        checkoutUrl: null,
        expiresAt: new Date("2026-11-08T10:30:00Z"),
        appliedAt: new Date("2026-11-08T10:15:00Z"),
        note: null,
        createdAt: new Date("2026-11-08T10:00:00Z"),
        booking: {
          id: "00000000-0000-4000-8000-000000000001",
          customerId: "user-1",
          bookingCode: "CP-0001",
          customer: {
            email: "user1@example.com",
            profile: { fullName: "Nguyễn Văn A", phone: "0901234567" },
          },
          items: [{ garment_sizes: { garments: { name: "Nhật Bình" } } }],
        },
        payment: { id: "pay-1", status: "paid", amount: 200000 },
      },
    ]);
    prisma.bookingExtension.count = vi.fn().mockImplementation((args?: any) => {
      if (args?.where?.status === "applied") return Promise.resolve(8);
      if (args?.where?.status === "pending") return Promise.resolve(2);
      if (args?.where?.status === "expired") return Promise.resolve(1);
      return Promise.resolve(11); // total
    });
    prisma.bookingExtension.aggregate = vi.fn().mockResolvedValue({
      _sum: { amount: 1600000 },
    });

    const service = new CustomerCareService(prisma, previewService);
    const result = await service.getExtensionMonitoring({ page: 1, limit: 10 });

    expect(result.kpis.totalRequests).toBe(11);
    expect(result.kpis.appliedCount).toBe(8);
    expect(result.kpis.pendingCount).toBe(2);
    expect(result.kpis.totalPaidRevenue).toBe(1600000);
    expect(result.kpis.successRate).toBe(73); // 8/11 ~ 73%
    expect(result.history.items).toHaveLength(1);
    expect(result.history.items[0].garmentName).toBe("Nhật Bình");
  });

  it("getAnalytics() tính toán số liệu phân tích và biểu đồ thời gian thực không để lọt ngày trống", async () => {
    const prisma = createMockPrisma();
    prisma.booking.findMany = vi.fn().mockResolvedValue([
      {
        id: "b1",
        status: BookingStatus.completed,
        createdAt: new Date("2026-11-05T08:00:00Z"),
        customerId: "cust-1",
      },
      {
        id: "b2",
        status: BookingStatus.renting,
        createdAt: new Date("2026-11-06T09:00:00Z"),
        customerId: "cust-2",
      },
      {
        id: "b3",
        status: BookingStatus.completed,
        createdAt: new Date("2026-11-07T10:00:00Z"),
        customerId: "cust-1", // cust-1 quay lại lần 2
      },
    ]);

    prisma.booking.groupBy = vi.fn().mockResolvedValue([
      { customerId: "cust-1", _count: { id: 2 } }, // returning
      { customerId: "cust-2", _count: { id: 1 } }, // first-time
    ]);

    prisma.bookingExtension.aggregate = vi.fn().mockResolvedValue({
      _sum: { amount: 500000 },
    });

    const service = new CustomerCareService(prisma, previewService);
    const analytics = await service.getAnalytics({ period: "7d" });

    expect(analytics.period).toBe("7d");
    expect(analytics.bookingAnalytics).toBeDefined();
    expect(analytics.reminderAnalytics).toBeDefined();
    expect(analytics.emailAnalytics).toBeDefined();
    expect(analytics.extensionAnalytics).toBeDefined();

    // Retention metrics
    expect(analytics.retentionAnalytics.totalActiveCustomers).toBe(2);
    expect(analytics.retentionAnalytics.returningRenters).toBe(1);
    expect(analytics.retentionAnalytics.firstTimeRenters).toBe(1);
    expect(analytics.retentionAnalytics.retentionRate).toBe(50);

    // Voucher safety
    expect(analytics.voucherAnalytics.programStatus).toBe("DISABLED");

    // Charts: 7 days trend points without gap
    expect(analytics.charts.bookingTrend.length).toBeGreaterThanOrEqual(7);
    expect(analytics.charts.reminderBreakdown).toHaveLength(3);
    expect(analytics.charts.emailStatusBreakdown).toHaveLength(3);
    expect(analytics.charts.extensionBreakdown).toHaveLength(3);
  });

  it("getAnalytics() xử lý an toàn khi database hoàn toàn rỗng", async () => {
    const prisma = createMockPrisma();
    prisma.booking.findMany = vi.fn().mockResolvedValue([]);
    prisma.booking.count = vi.fn().mockResolvedValue(0);
    prisma.booking.groupBy = vi.fn().mockResolvedValue([]);
    prisma.auditLog.count = vi.fn().mockResolvedValue(0);
    prisma.bookingExtension.count = vi.fn().mockResolvedValue(0);
    prisma.bookingExtension.aggregate = vi.fn().mockResolvedValue({ _sum: { amount: null } });

    const service = new CustomerCareService(prisma, previewService);
    const analytics = await service.getAnalytics({ period: "30d" });

    expect(analytics.bookingAnalytics.totalBookings).toBe(0);
    expect(analytics.extensionAnalytics.successRate).toBe(0);
    expect(analytics.extensionAnalytics.totalPaidRevenue).toBe(0);
    expect(analytics.retentionAnalytics.retentionRate).toBe(0);
    expect(analytics.retentionAnalytics.totalActiveCustomers).toBe(0);
    expect(analytics.charts.bookingTrend).toBeDefined();
  });
});

