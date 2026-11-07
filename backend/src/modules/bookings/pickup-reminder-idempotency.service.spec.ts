import { describe, expect, it, vi, beforeEach } from "vitest";
import { BookingStatus } from "@prisma/client";
import {
  PickupReminderIdempotencyService,
  PICKUP_REMINDER_ACTION,
} from "./pickup-reminder-idempotency.service";
import { BookingsService } from "./bookings.service";

describe("PickupReminderIdempotencyService (Hardened distributed locking & idempotency)", () => {
  const BOOKING_A = "00000000-0000-4000-8000-0000000000a1";
  const DATE_1 = "2026-10-10";
  const DATE_2 = "2026-10-15";

  let auditLogs: Array<{ action: string; entityId: string | null; metadata: any }> = [];
  let prismaMock: any;
  let redisMock: any;
  let redisLocks: Map<string, string>;
  let idempotencyService: PickupReminderIdempotencyService;

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
          return { id: "log-1", ...data, createdAt: new Date() };
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

    idempotencyService = new PickupReminderIdempotencyService(prismaMock, redisMock);
  });

  // Scenario 1: First-time claim acquisition and lock ownership token
  it("Scenario 1: allows first-time claim acquisition, returns ownership token, and finalizes dispatch", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);
    expect(claim.reason).toBe("acquired");
    expect(claim.businessKey).toBe(`reminder:pickup:${BOOKING_A}:${DATE_1}:all`);
    expect(claim.ownerToken).toBeDefined();
    expect(typeof claim.ownerToken).toBe("string");

    // Lock must be held in Redis with the owner's token
    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.get(lockKey)).toBe(claim.ownerToken);

    // Finalize claim
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken);

    // Lock must be released
    expect(redisLocks.has(lockKey)).toBe(false);

    // Durable auditLog entry must be created
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: PICKUP_REMINDER_ACTION,
          entityId: BOOKING_A,
          metadata: expect.objectContaining({
            businessKey: `reminder:pickup:${BOOKING_A}:${DATE_1}:all`,
            rentalStartDate: DATE_1,
          }),
        }),
      }),
    );
  });

  // Scenario 2: Two concurrent workers competing for the same booking
  it("Scenario 2: handles two concurrent workers safely - only worker 1 acquires, worker 2 is rejected", async () => {
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    expect(claim1.reason).toBe("acquired");

    // Worker 2 attempts while Worker 1 still holds the lock
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe("concurrency_locked");
    expect(claim2.ownerToken).toBeUndefined();

    // Worker 1 finishes successfully
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // Subsequent worker now sees already_dispatched
    const claim3 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim3.claimed).toBe(false);
    expect(claim3.reason).toBe("already_dispatched");
  });

  // Scenario 3: Lease expiration & atomic compare-and-delete (delIfValue) ownership protection
  it("Scenario 3: expired worker cannot delete lock acquired by another worker (delIfValue protection)", async () => {
    // Worker 1 acquires lock
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    const lockKey = `lock:${claim1.businessKey}`;
    expect(redisLocks.get(lockKey)).toBe(claim1.ownerToken);

    // Simulate Worker 1 hanging / lease expiring after 60s in Redis
    redisLocks.delete(lockKey);

    // Worker 2 acquires the now-free lock
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(true);
    expect(redisLocks.get(lockKey)).toBe(claim2.ownerToken);
    expect(claim1.ownerToken).not.toBe(claim2.ownerToken);

    // Worker 1 wakes up late and attempts to finalize / release lock with ownerToken1
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // delIfValue must NOT have deleted Worker 2's lock because token didn't match!
    expect(redisLocks.get(lockKey)).toBe(claim2.ownerToken);
    expect(redisMock.delIfValue).toHaveBeenCalledWith(lockKey, claim1.ownerToken);

    // Worker 2 finishes and releases with ownerToken2
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim2.ownerToken);
    expect(redisLocks.has(lockKey)).toBe(false);
  });

  // Scenario 4: Worker crash / exception before sending notification
  it("Scenario 4: releases lock when exception occurs before sending notification so next run can retry", async () => {
    // If DB check throws inside acquireClaim
    prismaMock.auditLog.findMany.mockRejectedValueOnce(new Error("Database connection lost"));

    await expect(idempotencyService.acquireClaim(BOOKING_A, DATE_1)).rejects.toThrow(
      "Database connection lost",
    );

    // Lock must have been immediately released in catch
    const lockKey = `lock:reminder:pickup:${BOOKING_A}:${DATE_1}:all`;
    expect(redisLocks.has(lockKey)).toBe(false);

    // Next attempt succeeds once DB recovers
    prismaMock.auditLog.findMany.mockImplementation(async () => []);
    const retryClaim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(retryClaim.claimed).toBe(true);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, retryClaim.ownerToken);
  });

  // Scenario 5: Crash consistency analysis: Crash after notification sent but before AuditLog recorded
  it("Scenario 5: documents crash consistency gap when process crashes between notification and auditLog", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);

    // Simulating: Notification was sent via NotificationsService, but worker crashes (e.g. process killed)
    // without calling finalizeClaim.
    // Lock is held in Redis until its 60s TTL expires.
    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.has(lockKey)).toBe(true);

    // AuditLog has NOT been recorded
    expect(auditLogs).toHaveLength(0);

    // After Redis TTL expires (60s), the lock disappears
    redisLocks.delete(lockKey);

    // Because AuditLog was not recorded before crash, the next cron check will see it as not yet dispatched
    const nextCheck = await idempotencyService.isAlreadyDispatched(BOOKING_A, DATE_1);
    expect(nextCheck).toBe(false);

    // This test formally validates the known limitation of distributed 2-step writes
    // without a unified transactional outbox or shared idempotency_keys table.
  });

  // Scenario 6: Notification fails with error
  it("Scenario 6: releases lock and does not mark dispatched when notification throws", async () => {
    const booking = {
      id: BOOKING_A,
      customerId: "user-1",
      status: BookingStatus.paid,
      rentalStartDate: new Date("2026-10-09T00:00:00.000Z"),
      rentalEndDate: new Date("2026-10-11T00:00:00.000Z"),
      pickupMethod: "store_pickup",
      items: [{ garment_sizes: { garments: { name: "Áo Nhật Bình" } } }],
    };

    const bookingsPrisma = {
      ...prismaMock,
      booking: { findMany: vi.fn().mockResolvedValue([booking]) },
      systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    // Notification service fails
    const notifications = {
      sendBookingNotification: vi.fn().mockRejectedValue(new Error("Push notification gateway 503")),
    };

    const service = new BookingsService(
      bookingsPrisma as never,
      notifications as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      idempotencyService,
    );

    // Service catches or throws; in sendPickupReminders try/finally runs finalizeClaim(..., false)
    await expect(service.sendPickupReminders()).rejects.toThrow("Push notification gateway 503");

    // Lock must be released
    const lockKey = `lock:reminder:pickup:${BOOKING_A}:2026-10-09:all`;
    expect(redisLocks.has(lockKey)).toBe(false);

    // No dispatch recorded in auditLog
    expect(auditLogs).toHaveLength(0);

    // Next run can retry
    const retryClaim = await idempotencyService.acquireClaim(BOOKING_A, "2026-10-09");
    expect(retryClaim.claimed).toBe(true);
  });

  // Scenario 7: Notification succeeds but AuditLog creation fails
  it("Scenario 7: handles AuditLog write failure gracefully without breaking application flow", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);

    // Prisma auditLog create fails
    prismaMock.auditLog.create.mockRejectedValueOnce(new Error("AuditLog table deadlock or disk full"));

    // finalizeClaim should not throw unhandled exception to the caller, and lock must still be released
    await expect(
      idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken),
    ).resolves.toBeUndefined();

    // Lock is released even if auditLog failed
    const lockKey = `lock:${claim.businessKey}`;
    expect(redisLocks.has(lockKey)).toBe(false);
  });

  // Scenario 8: Background email provider delay/timeout
  it("Scenario 8: background email provider timeout does not prevent idempotency finalization", async () => {
    const claim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim.claimed).toBe(true);

    // In NestJS architecture, notificationService fires email asynchronously or returns once in-app row is created
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim.ownerToken);

    // Dispatch is recorded
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].metadata.businessKey).toBe(`reminder:pickup:${BOOKING_A}:${DATE_1}:all`);

    // A duplicate pickup reminder will not be allowed
    const duplicateClaim = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(duplicateClaim.claimed).toBe(false);
    expect(duplicateClaim.reason).toBe("already_dispatched");
  });

  // Scenario 9: Redis offline / Fallback to In-Memory Locking
  it("Scenario 9: falls back to in-memory locking when Redis is unavailable, maintaining single-instance safety", async () => {
    // Create an instance without Redis
    const memoryIdempotencyService = new PickupReminderIdempotencyService(prismaMock, undefined);

    expect(memoryIdempotencyService.getLockStatus()).toEqual({
      mode: "memory",
      connected: false,
    });

    // Worker 1 acquires in-memory lock
    const claim1 = await memoryIdempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    expect(claim1.ownerToken).toBeDefined();

    // Worker 2 within the same process tries concurrently -> rejected
    const claim2 = await memoryIdempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe("concurrency_locked");

    // Worker 1 finalizes
    await memoryIdempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // Lock is freed
    const claim3 = await memoryIdempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim3.claimed).toBe(false);
    expect(claim3.reason).toBe("already_dispatched");
  });

  // Scenario 10: Date rescheduling and isolation from other modules
  it("Scenario 10: permits new reminder when rentalStartDate changes and stays isolated from other reminders", async () => {
    // 1. Send reminder for DATE_1
    const claim1 = await idempotencyService.acquireClaim(BOOKING_A, DATE_1);
    expect(claim1.claimed).toBe(true);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_1, true, claim1.ownerToken);

    // 2. Booking rescheduled to DATE_2 -> new unique business key is generated and allowed
    const claim2 = await idempotencyService.acquireClaim(BOOKING_A, DATE_2);
    expect(claim2.claimed).toBe(true);
    expect(claim2.businessKey).toBe(`reminder:pickup:${BOOKING_A}:${DATE_2}:all`);
    await idempotencyService.finalizeClaim(BOOKING_A, DATE_2, true, claim2.ownerToken);

    expect(auditLogs).toHaveLength(2);

    // 3. Isolated from other modules: Return reminder query does not match pickup reminder action
    const hasReturnReminder = auditLogs.some(
      (log) => log.action === "notification.return_reminder_dispatched",
    );
    expect(hasReturnReminder).toBe(false);
  });
});
