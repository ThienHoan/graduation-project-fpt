import { describe, expect, it, vi, beforeEach } from "vitest";
import { BookingStatus } from "@prisma/client";
import {
  ReturnReminderIdempotencyService,
  RETURN_REMINDER_ACTION,
} from "./return-reminder-idempotency.service";
import { PICKUP_REMINDER_ACTION } from "./pickup-reminder-idempotency.service";
import { BookingsService } from "./bookings.service";

describe("ReturnReminderIdempotencyService", () => {
  const BOOKING_A = "00000000-0000-4000-8000-0000000000a1";
  const BOOKING_B = "00000000-0000-4000-8000-0000000000b2";
  const DATE_1 = "2026-11-08";
  const DATE_2 = "2026-11-12";

  let auditLogs: Array<{ action: string; entityType?: string; entityId: string | null; metadata: any }> = [];
  let prismaMock: any;
  let redisMock: any;
  let redisLocks: Map<string, string>;
  let idempotencyService: ReturnReminderIdempotencyService;

  beforeEach(() => {
    auditLogs = [];
    redisLocks = new Map<string, string>();

    prismaMock = {
      auditLog: {
        findMany: vi.fn().mockImplementation(async ({ where }: any) => {
          return auditLogs.filter(
            (log) => log.action === where.action && log.entityId === where.entityId,
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          auditLogs.push(data);
          return { id: "log-ret-1", ...data, createdAt: new Date() };
        }),
      },
    };

    redisMock = {
      getStatus: vi.fn().mockReturnValue({ connected: true, mode: "redis" as const }),
      setNx: vi.fn().mockImplementation(async (key: string, val: string) => {
        if (redisLocks.has(key)) return false;
        redisLocks.set(key, val);
        return true;
      }),
      delIfValue: vi.fn().mockImplementation(async (key: string, val: string) => {
        if (redisLocks.get(key) === val) {
          redisLocks.delete(key);
          return true;
        }
        return false;
      }),
      del: vi.fn().mockImplementation(async (key: string) => {
        redisLocks.delete(key);
        return 1;
      }),
    };

    idempotencyService = new ReturnReminderIdempotencyService(prismaMock, redisMock);
  });

  // 1. Lần gửi đầu tiên thành công
  it("Scenario 1: allows first-time claim acquisition, returns ownership token, and finalizes dispatch", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);
    expect(claim.reason).toBe("acquired");
    expect(claim.businessKey).toBe(`reminder:return:${BOOKING_A}:${DATE_1}:daily`);
    expect(claim.ownerToken).toBeDefined();

    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.get(lockKey)).toBe(claim.ownerToken);

    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken);
    expect(redisLocks.has(lockKey)).toBe(false);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: RETURN_REMINDER_ACTION,
          entityId: BOOKING_A,
          metadata: expect.objectContaining({
            businessKey: `reminder:return:${BOOKING_A}:${DATE_1}:daily`,
            rentalEndDate: DATE_1,
            notificationType: "return_reminder",
          }),
        }),
      }),
    );
  });

  // 2. Gọi cron lại cùng booking và ngày -> Bị chặn
  it("Scenario 2: skips duplicate claim when cron re-runs for the same booking and same date", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // Re-run
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe("already_dispatched");
  });

  // 3. Manager gọi API nhiều lần
  it("Scenario 3: BookingsService.sendReturnReminders skips already dispatched bookings on repeated calls", async () => {
    const booking = {
      id: BOOKING_A,
      customerId: "user-1",
      status: BookingStatus.renting,
      rentalStartDate: new Date("2026-11-06T00:00:00.000Z"),
      rentalEndDate: new Date("2026-11-08T00:00:00.000Z"),
      pickupMethod: "store_pickup",
      items: [{ garment_sizes: { garments: { name: "Áo Nhật Bình" } } }],
      accessoryItems: [],
      extensions: [],
    };

    const bookingsPrisma = {
      ...prismaMock,
      booking: { findMany: vi.fn().mockResolvedValue([booking]) },
      systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const notifications = { sendBookingNotification: vi.fn().mockResolvedValue({}) };

    const service = new BookingsService(
      bookingsPrisma as never,
      notifications as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      idempotencyService,
    );

    // Call 1
    const res1 = await service.sendReturnReminders();
    expect(res1.data?.remindedCount).toBe(1);
    expect(notifications.sendBookingNotification).toHaveBeenCalledTimes(1);

    // Call 2 (manager button click or second cron run)
    const res2 = await service.sendReturnReminders();
    expect(res2.data?.remindedCount).toBe(0);
    expect(notifications.sendBookingNotification).toHaveBeenCalledTimes(1);
  });

  // 4. Hai worker cạnh tranh lock
  it("Scenario 4: handles two concurrent workers safely - only worker 1 acquires, worker 2 is rejected", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);

    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe("concurrency_locked");

    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    const claim3 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim3.claimed).toBe(false);
    expect(claim3.reason).toBe("already_dispatched");
  });

  // 5. Hai booking khác nhau độc lập
  it("Scenario 5: independent bookings do not interfere with each other", async () => {
    const claimA = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    const claimB = await idempotencyService.acquireClaim(BOOKING_B, DATE_1);

    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(true);

    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claimA.ownerToken);
    await idempotencyService.finalizeClaim(BOOKING_B, DATE_1, true, claimB.ownerToken);

    expect(auditLogs).toHaveLength(2);
  });

  // 6. Redis lock lease expires
  it("Scenario 6: allows second worker to acquire claim after previous lock lease expires", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    const lockKey = `lock:${claim1.businessKey}`;
    expect(redisLocks.get(lockKey)).toBe(claim1.ownerToken);

    // Simulate Worker 1 lease expiring after 60s
    redisLocks.delete(lockKey);

    // Worker 2 can now acquire the lock
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(true);
    expect(claim2.ownerToken).toBeDefined();
    expect(redisLocks.get(lockKey)).toBe(claim2.ownerToken);
  });

  // 7. Worker cũ không xóa lock worker mới (delIfValue protection)
  it("Scenario 7: old worker cannot delete new worker lock upon completing late (delIfValue protection)", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    const lockKey = `lock:${claim1.businessKey}`;

    // Simulate lease expiry and Worker 2 acquiring the lock
    redisLocks.delete(lockKey);
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(true);

    // Worker 1 wakes up and calls finalizeClaim with ownerToken1
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // Worker 2's lock must remain intact
    expect(redisLocks.get(lockKey)).toBe(claim2.ownerToken);
    expect(redisMock.delIfValue).toHaveBeenCalledWith(lockKey, claim1.ownerToken);

    // Worker 2 releases with ownerToken2
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim2.ownerToken);
    expect(redisLocks.has(lockKey)).toBe(false);
  });

  // 8. Redis offline -> Fallback In-Memory
  it("Scenario 8: falls back to in-memory locking when Redis is unavailable, maintaining single-instance safety", async () => {
    const memoryService = new ReturnReminderIdempotencyService(prismaMock, undefined);

    expect(memoryService.getLockStatus()).toEqual({ mode: "memory", connected: false });

    const claim1 = await memoryService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);

    const claim2 = await memoryService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe("concurrency_locked");

    await memoryService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    const claim3 = await memoryService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim3.claimed).toBe(false);
    expect(claim3.reason).toBe("already_dispatched");
  });

  // 9. NotificationService ném lỗi
  it("Scenario 9: releases lock and does not mark dispatched when NotificationService throws", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);

    // Notification failed
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, false, claim.ownerToken);

    // Lock is released and no AuditLog created
    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.has(lockKey)).toBe(false);
    expect(auditLogs).toHaveLength(0);

    // Next cron run can retry
    const retryClaim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(retryClaim.claimed).toBe(true);
  });

  // 10. AuditLog ghi thất bại
  it("Scenario 10: handles AuditLog write failure gracefully without throwing and releases lock", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);

    prismaMock.auditLog.create.mockRejectedValueOnce(new Error("AuditLog deadlock"));

    await expect(
      idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken),
    ).resolves.toBeUndefined();

    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.has(lockKey)).toBe(false);
  });

  // 11. Booking thay đổi ngày trả hợp lệ
  it("Scenario 11: permits new reminder when rentalEndDate is rescheduled to a new date", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // Rescheduled to DATE_2
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_2);
    expect(claim2.claimed).toBe(true);
    expect(claim2.businessKey).toContain(DATE_2);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_2, true, claim2.ownerToken);

    expect(auditLogs).toHaveLength(2);
  });

  // 12. Extension pending
  it("Scenario 12: processes reminder for current date while tracking pending extension warning cleanly", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken);
    expect(auditLogs).toHaveLength(1);
  });

  // 13. Extension applied
  it("Scenario 13: allows dispatching return reminder for newly extended date once applied", async () => {
    // Initial rental ended on DATE_1
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // Extension applied to DATE_2
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_2);
    expect(claim2.claimed).toBe(true);
    expect(claim2.businessKey).toBe(`reminder:return:${BOOKING_A}:${DATE_2}:daily`);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_2, true, claim2.ownerToken);

    expect(auditLogs).toHaveLength(2);
  });

  // 14. Pickup và Return Reminder độc lập
  it("Scenario 14: maintains complete isolation between pickup and return reminder actions", async () => {
    // Dispatch return reminder
    const claimReturn = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claimReturn.ownerToken);

    // Check that pickup reminder action was NOT affected or recorded
    const hasPickup = auditLogs.some((l) => l.action === PICKUP_REMINDER_ACTION);
    expect(hasPickup).toBe(false);

    const hasReturn = auditLogs.some((l) => l.action === RETURN_REMINDER_ACTION);
    expect(hasReturn).toBe(true);
  });

  // 15. Return Reminder không ảnh hưởng Payments
  it("Scenario 15: operates purely on notification and audit log without touching payment records", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken);

    // Only auditLog created
    expect(auditLogs[0].action).toBe(RETURN_REMINDER_ACTION);
    expect(auditLogs[0].entityType).toBe("booking");
  });

  // 16. Crash giữa dispatch và AuditLog được nhận diện đúng giới hạn
  it("Scenario 16: documents crash consistency gap between notification dispatch and AuditLog record", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);

    // Worker crashes right after notificationsService.sendBookingNotification
    // finalizeClaim is never executed
    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.has(lockKey)).toBe(true);
    expect(auditLogs).toHaveLength(0);

    // After 60s TTL expires
    redisLocks.delete(lockKey);

    // Next run checks isAlreadyDispatched -> returns false because AuditLog was not written before crash
    const nextCheck = await idempotencyService.isAlreadyDispatched(BOOKING_A, DATE_1);
    expect(nextCheck).toBe(false);
  });

  // 17. Dual Reminder: Cho phép 12:00 (daily) gửi xong, 17:00 (before_close) VẪN gửi được trong cùng ngày
  it("Scenario 17: allows 12:00 daily dispatch, then subsequently allows 17:00 before_close dispatch on the same day", async () => {
    // 1. Chạy mốc 12:00 (daily)
    const claimDaily = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "daily");
    expect(claimDaily.claimed).toBe(true);
    expect(claimDaily.businessKey).toBe(`reminder:return:${BOOKING_A}:${DATE_1}:daily`);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claimDaily.ownerToken, "daily");

    // 2. Chạy mốc 17:00 (before_close) -> Phải giành được claim, KHÔNG bị chặn bởi mốc 12:00
    const claimBeforeClose = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "before_close");
    expect(claimBeforeClose.claimed).toBe(true);
    expect(claimBeforeClose.businessKey).toBe(`reminder:return:${BOOKING_A}:${DATE_1}:before_close`);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claimBeforeClose.ownerToken, "before_close");

    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[0].metadata.scheduleType).toBe("daily");
    expect(auditLogs[1].metadata.scheduleType).toBe("before_close");
  });

  // 18. Chống gửi trùng từng mốc (12:00 và 17:00 chạy lại đều bị chặn độc lập)
  it("Scenario 18: blocks re-run of 12:00 daily and 17:00 before_close independently", async () => {
    // Đã gửi cả 2 mốc
    const claimDaily = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "daily");
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claimDaily.ownerToken, "daily");

    const claimBeforeClose = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "before_close");
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claimBeforeClose.ownerToken, "before_close");

    // Thử chạy lại 12:00 -> bị từ chối already_dispatched
    const retryDaily = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "daily");
    expect(retryDaily.claimed).toBe(false);
    expect(retryDaily.reason).toBe("already_dispatched");

    // Thử chạy lại 17:00 -> bị từ chối already_dispatched
    const retryBeforeClose = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "before_close");
    expect(retryBeforeClose.claimed).toBe(false);
    expect(retryBeforeClose.reason).toBe("already_dispatched");
  });

  // 19. Xử lý đồng thời (concurrent workers) tại mốc 17:00
  it("Scenario 19: prevents dual-dispatch for concurrent workers competing at 17:00 before_close milestone", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "before_close");
    expect(claim1.claimed).toBe(true);

    // Worker 2 thử acquire trước khi Worker 1 finalize
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "before_close");
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe("concurrency_locked");

    // Worker 1 finalize
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken, "before_close");

    // Worker 2 thử lại sau khi lock đã release -> lúc này nhận already_dispatched
    const claim3 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1, "before_close");
    expect(claim3.claimed).toBe(false);
    expect(claim3.reason).toBe("already_dispatched");
  });
});
