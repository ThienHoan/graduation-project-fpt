import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { NotificationRetryService } from "./notification-retry.service";

describe("NotificationRetryService", () => {
  const createMockPrisma = (initialLog?: any) => {
    return {
      auditLog: {
        findUnique: vi.fn().mockResolvedValue(
          initialLog ?? {
            id: "log-failed-1",
            action: "notification.failed",
            createdAt: new Date(Date.now() - 100 * 1000), // 100s ago (> 60s backoff)
            entityType: "booking",
            entityId: "00000000-0000-4000-8000-000000000001",
            actorId: null,
            metadata: {
              templateKey: "booking.pickup_reminder",
              bookingId: "00000000-0000-4000-8000-000000000001",
              userId: "user-1",
              email: "customer@example.com",
              error: "Connection timeout after 10000ms",
              retryCount: 0,
            },
          },
        ),
        create: vi.fn().mockResolvedValue({ id: "log-retry-1" }),
        update: vi.fn().mockResolvedValue({ id: "log-failed-1" }),
      },
    } as any;
  };

  const createMockNotificationsService = () => {
    return {
      sendBookingNotification: vi.fn().mockResolvedValue({ success: true }),
      notifyUser: vi.fn().mockResolvedValue({ success: true }),
      sendTemplateEmail: vi.fn().mockResolvedValue({ status: "sent", provider: "smtp" }),
    } as any;
  };

  it("thử lại thành công khi thông báo thất bại, lỗi có thể retry và đã qua thời gian backoff", async () => {
    const prisma = createMockPrisma();
    const notificationsService = createMockNotificationsService();
    const service = new NotificationRetryService(prisma, notificationsService);

    const result = await service.retryNotification("log-failed-1", "admin-1");

    expect(result.success).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.status).toBe("accepted");
    expect(notificationsService.sendBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "00000000-0000-4000-8000-000000000001",
        userId: "user-1",
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "notification.retry_dispatched",
          actorId: "admin-1",
        }),
      }),
    );
    expect(prisma.auditLog.update).toHaveBeenCalled();
  });

  it("ném NotFoundException khi không tìm thấy logId", async () => {
    const prisma = createMockPrisma();
    prisma.auditLog.findUnique = vi.fn().mockResolvedValue(null);
    const notificationsService = createMockNotificationsService();
    const service = new NotificationRetryService(prisma, notificationsService);

    await expect(service.retryNotification("invalid-id")).rejects.toThrow(NotFoundException);
  });

  it("ném BadRequestException khi thông báo không ở trạng thái thất bại", async () => {
    const prisma = createMockPrisma({
      id: "log-success-1",
      action: "notification.sent",
      createdAt: new Date(),
      metadata: { status: "sent" },
    });
    const notificationsService = createMockNotificationsService();
    const service = new NotificationRetryService(prisma, notificationsService);

    await expect(service.retryNotification("log-success-1")).rejects.toThrow(BadRequestException);
  });

  it("ném BadRequestException khi đã vượt quá giới hạn 3 lần retry", async () => {
    const prisma = createMockPrisma({
      id: "log-failed-3",
      action: "notification.failed",
      createdAt: new Date(Date.now() - 500 * 1000),
      metadata: { error: "Network timeout", retryCount: 3 },
    });
    const notificationsService = createMockNotificationsService();
    const service = new NotificationRetryService(prisma, notificationsService);

    await expect(service.retryNotification("log-failed-3")).rejects.toThrow(BadRequestException);
  });

  it("ném BadRequestException khi lỗi không thể khắc phục (Invalid email syntax)", async () => {
    const prisma = createMockPrisma({
      id: "log-failed-syntax",
      action: "notification.failed",
      createdAt: new Date(Date.now() - 500 * 1000),
      metadata: { error: "Invalid email address syntax: bad@@address" },
    });
    const notificationsService = createMockNotificationsService();
    const service = new NotificationRetryService(prisma, notificationsService);

    await expect(service.retryNotification("log-failed-syntax")).rejects.toThrow(BadRequestException);
  });

  it("ném BadRequestException khi gọi quá sớm chưa qua Exponential Backoff", async () => {
    const prisma = createMockPrisma({
      id: "log-failed-early",
      action: "notification.failed",
      createdAt: new Date(Date.now() - 10 * 1000), // Chỉ mới 10s trước (< 60s)
      metadata: { error: "Network timeout", retryCount: 0 },
    });
    const notificationsService = createMockNotificationsService();
    const service = new NotificationRetryService(prisma, notificationsService);

    await expect(service.retryNotification("log-failed-early")).rejects.toThrow(BadRequestException);
  });

  it("ném ConflictException khi có tiến trình khác đang giữ lock của logId", async () => {
    const prisma = createMockPrisma();
    const notificationsService = createMockNotificationsService();
    const mockRedis = {
      setNx: vi.fn().mockResolvedValue(false), // Lock bị giữ
      delIfValue: vi.fn().mockResolvedValue(true),
    };
    const service = new NotificationRetryService(prisma, notificationsService, mockRedis as any);

    await expect(service.retryNotification("log-failed-1")).rejects.toThrow(ConflictException);
  });
});
