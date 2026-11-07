import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { RedisService } from "../../redis/redis.service";
import type { NotificationRetryResult } from "./customer-care.types";
import { isRetryableNotificationError } from "./notification-sanitizer";

export const NOTIFICATION_RETRY_ACTION = "notification.retry_dispatched";
export const MAX_NOTIFICATION_RETRIES = 3;

interface InMemoryLockEntry {
  expiresAt: number;
  ownerToken: string;
}

@Injectable()
export class NotificationRetryService {
  private readonly logger = new Logger(NotificationRetryService.name);
  private readonly inMemoryLocks = new Map<string, InMemoryLockEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Tính thời gian chờ theo thuật toán Exponential Backoff:
   * - Lần 1: 60s (1 phút)
   * - Lần 2: 120s (2 phút)
   * - Lần 3: 240s (4 phút)
   */
  calculateBackoffSeconds(retryCount: number): number {
    return Math.min(60 * Math.pow(2, Math.max(0, retryCount)), 900);
  }

  /**
   * Thử lại gửi thông báo thất bại một cách an toàn:
   * 1. Kiểm tra tồn tại và trạng thái thất bại.
   * 2. Giới hạn tối đa 3 lần thử lại.
   * 3. Bỏ qua các lỗi không thể khắc phục (e.g. Email sai định dạng, template không tồn tại).
   * 4. Kiểm tra khoảng cách thời gian (Exponential Backoff).
   * 5. Khóa tương tranh (Idempotency Concurrency Lock) chống double-click.
   * 6. Tái phân phối qua NotificationsService và ghi nhận AuditLog.
   */
  async retryNotification(logId: string, actorId?: string): Promise<NotificationRetryResult> {
    const log = await this.prisma.auditLog.findUnique({
      where: { id: logId },
    });

    if (!log) {
      throw new NotFoundException(`Không tìm thấy nhật ký thông báo với mã ${logId}`);
    }

    const meta = (log.metadata && typeof log.metadata === "object" ? log.metadata : {}) as Record<string, any>;
    const isFailed =
      log.action === "notification.failed" ||
      meta.status === "failed" ||
      meta.emailStatus?.status === "failed" ||
      Boolean(meta.error);

    if (!isFailed) {
      throw new BadRequestException("Chỉ có thể thử lại các thông báo có trạng thái thất bại");
    }

    const currentRetries = typeof meta.retryCount === "number" ? meta.retryCount : 0;
    if (currentRetries >= MAX_NOTIFICATION_RETRIES) {
      throw new BadRequestException(
        `Thông báo đã vượt quá số lần thử lại tối đa (${MAX_NOTIFICATION_RETRIES} lần)`,
      );
    }

    const rawError = meta.error ?? meta.reason;
    if (!isRetryableNotificationError(rawError)) {
      throw new BadRequestException(
        `Không thể thử lại: Lỗi không thể khắc phục (${rawError || "Dữ liệu không hợp lệ"})`,
      );
    }

    // Kiểm tra Exponential Backoff
    const backoffSeconds = this.calculateBackoffSeconds(currentRetries);
    const elapsedSeconds = (Date.now() - log.createdAt.getTime()) / 1000;
    if (elapsedSeconds < backoffSeconds) {
      const waitRemaining = Math.ceil(backoffSeconds - elapsedSeconds);
      throw new BadRequestException(
        `Vui lòng chờ thêm ${waitRemaining} giây trước khi gửi lại (Thời gian chờ tối thiểu ${backoffSeconds}s)`,
      );
    }

    // Concurrency Locking
    const lockKey = `lock:notification:retry:${logId}`;
    const ownerToken = randomUUID();
    const lockAcquired = await this.acquireLock(lockKey, ownerToken, 60);

    if (!lockAcquired) {
      throw new ConflictException("Yêu cầu gửi lại cho thông báo này đang được xử lý, vui lòng chờ");
    }

    try {
      const templateKey = meta.templateKey || "booking.pickup_reminder";
      const userId = meta.userId || (log.entityType === "user" ? log.entityId : null);
      const bookingId = meta.bookingId || (log.entityType === "booking" ? log.entityId : null);
      const email = meta.email || null;

      // Re-dispatch qua NotificationsService
      if (userId && bookingId) {
        await this.notificationsService.sendBookingNotification({
          userId,
          templateKey: templateKey as any,
          bookingId,
          note: meta.note,
          garmentName: meta.garmentName,
        });
      } else if (userId) {
        await this.notificationsService.notifyUser({
          userId,
          templateKey,
          data: meta.data || {},
        });
      } else if (email) {
        await this.notificationsService.sendTemplateEmail({
          email,
          templateKey,
          data: meta.data || {},
        });
      }

      const nextRetryCount = currentRetries + 1;

      // Ghi nhận AuditLog retry thành công
      await this.prisma.auditLog.create({
        data: {
          action: NOTIFICATION_RETRY_ACTION,
          entityType: log.entityType || "notification",
          entityId: log.entityId || null,
          actorId: actorId || null,
          metadata: {
            originalLogId: logId,
            retryCount: nextRetryCount,
            dispatchedAt: new Date().toISOString(),
            templateKey,
            email,
            userId,
            bookingId,
            status: "accepted",
          },
        },
      });

      // Cập nhật retryCount lên bản ghi gốc nếu có thể
      try {
        await this.prisma.auditLog.update({
          where: { id: logId },
          data: {
            metadata: {
              ...meta,
              retryCount: nextRetryCount,
              lastRetriedAt: new Date().toISOString(),
            },
          },
        });
      } catch (err) {
        this.logger.warn(`Không thể cập nhật retryCount cho audit log ${logId}: ${err}`);
      }

      return {
        success: true,
        message: `Đã gửi lại thông báo thành công (Lần thử ${nextRetryCount}/${MAX_NOTIFICATION_RETRIES})`,
        retryCount: nextRetryCount,
        logId,
        status: "accepted",
      };
    } finally {
      await this.releaseLock(lockKey, ownerToken);
    }
  }

  private async acquireLock(lockKey: string, ownerToken: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis?.setNx) {
      return this.redis.setNx(lockKey, ownerToken, ttlSeconds);
    }

    const now = Date.now();
    const existing = this.inMemoryLocks.get(lockKey);
    if (existing && existing.expiresAt > now) {
      return false;
    }

    this.inMemoryLocks.set(lockKey, {
      expiresAt: now + ttlSeconds * 1000,
      ownerToken,
    });
    return true;
  }

  private async releaseLock(lockKey: string, ownerToken?: string): Promise<void> {
    if (ownerToken && this.redis?.delIfValue) {
      await this.redis.delIfValue(lockKey, ownerToken).catch(() => {});
    } else if (this.redis?.del) {
      await this.redis.del(lockKey).catch(() => {});
    }

    const existing = this.inMemoryLocks.get(lockKey);
    if (existing) {
      if (!ownerToken || existing.ownerToken === ownerToken) {
        this.inMemoryLocks.delete(lockKey);
      }
    }
  }
}
