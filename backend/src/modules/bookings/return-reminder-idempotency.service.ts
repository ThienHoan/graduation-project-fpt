import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

export interface ReturnReminderClaimResult {
  claimed: boolean;
  reason?: "already_dispatched" | "concurrency_locked" | "acquired";
  businessKey: string;
  ownerToken?: string;
}

export const RETURN_REMINDER_ACTION = "notification.return_reminder_dispatched";

interface InMemoryLockEntry {
  expiresAt: number;
  ownerToken: string;
}

@Injectable()
export class ReturnReminderIdempotencyService {
  private readonly logger = new Logger(ReturnReminderIdempotencyService.name);
  private readonly inMemoryLocks = new Map<string, InMemoryLockEntry>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Kiểm tra chế độ locking hiện tại (Redis phân tán hay In-Memory fallback).
   */
  getLockStatus(): { mode: "redis" | "memory"; connected: boolean } {
    if (this.redis?.getStatus) {
      return this.redis.getStatus();
    }
    return { mode: "memory", connected: false };
  }

  /**
   * Tạo business key duy nhất định danh lời nhắc trả đồ:
   * Key = reminder:return:{bookingId}:{rentalEndDate}:{scheduleType}
   * Mặc định scheduleType = "daily" (lịch nhắc 12h00 trưa ngày trả).
   */
  buildKey(bookingId: string, rentalEndDate: Date | string, scheduleType = "daily"): string {
    const dateStr =
      typeof rentalEndDate === "string"
        ? rentalEndDate.slice(0, 10)
        : rentalEndDate.toISOString().slice(0, 10);
    return `reminder:return:${bookingId}:${dateStr}:${scheduleType}`;
  }

  /**
   * Thử giành quyền xử lý (acquire claim) cho một lời nhắc trả đồ:
   * 1. Khóa chống chạy đồng thời (concurrency lock via Redis setNx kèm random ownerToken hoặc in-memory lease).
   * 2. Kiểm tra xem lời nhắc cho (bookingId, rentalEndDate) đã được phát hành trước đó chưa.
   * Nếu đã phát hành hoặc đang có tiến trình khác giữ lock -> trả về false.
   * Nếu hợp lệ -> giữ lock và trả về true kèm ownerToken định danh người sở hữu lock.
   */
  async acquireClaim(
    bookingId: string,
    rentalEndDate: Date | string,
    scheduleType = "daily",
  ): Promise<ReturnReminderClaimResult> {
    const businessKey = this.buildKey(bookingId, rentalEndDate, scheduleType);
    const lockKey = `lock:${businessKey}`;
    const dateStr = businessKey.split(":")[3];
    const ownerToken = randomUUID();

    // 1. Thử giành concurrency lock với ownership token (TTL 60s)
    const lockAcquired = await this.acquireLock(lockKey, ownerToken, 60);
    if (!lockAcquired) {
      return { claimed: false, reason: "concurrency_locked", businessKey };
    }

    // 2. Kiểm tra durable record xem đã gửi thành công trước đây chưa
    try {
      const alreadySent = await this.isAlreadyDispatched(
        bookingId,
        dateStr,
        businessKey,
        scheduleType,
      );
      if (alreadySent) {
        await this.releaseLock(lockKey, ownerToken);
        return { claimed: false, reason: "already_dispatched", businessKey, ownerToken };
      }

      return { claimed: true, reason: "acquired", businessKey, ownerToken };
    } catch (error) {
      // Khi gặp lỗi kiểm tra DB, lập tức giải phóng lock với đúng token để không treo reminder
      await this.releaseLock(lockKey, ownerToken);
      throw error;
    }
  }

  /**
   * Hoàn tất quá trình xử lý lời nhắc trả đồ:
   * - Nếu sendSuccess = true: Ghi nhận durable record vào AuditLog để chống gửi lại vĩnh viễn.
   * - Luôn giải phóng concurrency lock an toàn bằng compare-and-delete (delIfValue)
   *   nhằm tránh xóa nhầm lock của worker khác nếu lease 60s đã hết hạn.
   */
  async finalizeClaim(
    bookingId: string,
    rentalEndDate: Date | string,
    sendSuccess: boolean,
    ownerToken?: string,
    scheduleType = "daily",
  ): Promise<void> {
    const businessKey = this.buildKey(bookingId, rentalEndDate, scheduleType);
    const lockKey = `lock:${businessKey}`;
    const dateStr = businessKey.split(":")[3];

    try {
      if (sendSuccess) {
        await this.recordDispatch(bookingId, dateStr, businessKey, scheduleType);
      }
    } finally {
      await this.releaseLock(lockKey, ownerToken);
    }
  }

  /**
   * Kiểm tra xem đơn đã được gửi nhắc trả cho ngày đó và mốc đó (scheduleType) chưa.
   */
  async isAlreadyDispatched(
    bookingId: string,
    dateStr: string,
    businessKey?: string,
    scheduleType = "daily",
  ): Promise<boolean> {
    if (!this.prisma?.auditLog?.findMany) {
      return false;
    }

    try {
      const logs = await this.prisma.auditLog.findMany({
        where: {
          action: RETURN_REMINDER_ACTION,
          entityId: bookingId,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      return logs.some((log) => {
        if (!log.metadata || typeof log.metadata !== "object") return false;
        const meta = log.metadata as Record<string, unknown>;
        // 1. Khớp chính xác businessKey (ví dụ: reminder:return:...:daily hoặc reminder:return:...:before_close)
        if (businessKey && meta.businessKey === businessKey) {
          return true;
        }
        // 2. Khớp cùng ngày trả và cùng loại lịch nhắc (phân biệt daily 12h00 và before_close 17h00)
        const logSchedule = (meta.scheduleType as string) || "daily";
        if (meta.rentalEndDate === dateStr && logSchedule === scheduleType) {
          return true;
        }
        return false;
      });
    } catch (err) {
      this.logger.warn(`Lỗi khi kiểm tra auditLog return idempotency cho booking ${bookingId}: ${err}`);
      throw err;
    }
  }

  private async recordDispatch(
    bookingId: string,
    dateStr: string,
    businessKey: string,
    scheduleType: string,
  ): Promise<void> {
    if (!this.prisma?.auditLog?.create) {
      return;
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          action: RETURN_REMINDER_ACTION,
          entityType: "booking",
          entityId: bookingId,
          metadata: {
            businessKey,
            rentalEndDate: dateStr,
            dispatchedAt: new Date().toISOString(),
            notificationType: "return_reminder",
            scheduleType,
          },
        },
      });
    } catch (err) {
      this.logger.error(`Không thể ghi nhận auditLog return_reminder cho ${bookingId}: ${err}`);
    }
  }

  private async acquireLock(lockKey: string, ownerToken: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis?.setNx) {
      return this.redis.setNx(lockKey, ownerToken, ttlSeconds);
    }

    // In-memory fallback lock nếu không có Redis
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
    // Nếu có ownerToken, ưu tiên giải phóng bằng compare-and-delete (atomic Lua script)
    if (ownerToken && this.redis?.delIfValue) {
      await this.redis.delIfValue(lockKey, ownerToken).catch(() => {});
    } else if (this.redis?.del) {
      await this.redis.del(lockKey).catch(() => {});
    }

    // Giải phóng in-memory lock nếu token trùng khớp (hoặc không có token chỉ định)
    const existing = this.inMemoryLocks.get(lockKey);
    if (existing) {
      if (!ownerToken || existing.ownerToken === ownerToken) {
        this.inMemoryLocks.delete(lockKey);
      }
    }
  }
}

