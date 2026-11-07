import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthLockoutService } from "./auth-lockout.service";

describe("AuthLockoutService", () => {
  let service: AuthLockoutService;
  let mockRedisService: any;

  beforeEach(() => {
    mockRedisService = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };
    service = new AuthLockoutService(mockRedisService as any);
  });

  it("returns not locked when no lock key exists", async () => {
    mockRedisService.get.mockResolvedValue(null);
    const result = await service.isLocked("user@example.com");
    expect(result.isLocked).toBe(false);
    expect(result.remainingSeconds).toBe(0);
  });

  it("returns locked with remaining seconds when lock key exists in future", async () => {
    const lockUntil = Date.now() + 600 * 1000; // 10 minutes from now
    mockRedisService.get.mockResolvedValue(lockUntil);

    const result = await service.isLocked("user@example.com");
    expect(result.isLocked).toBe(true);
    expect(result.remainingSeconds).toBeGreaterThan(0);
  });

  it("increments attempts on failed attempt and does not lock if under threshold", async () => {
    mockRedisService.get.mockResolvedValueOnce(2); // current attempts = 2

    const result = await service.recordFailedAttempt("user@example.com");
    expect(result.attempts).toBe(3);
    expect(result.isLocked).toBe(false);
    expect(mockRedisService.set).toHaveBeenCalledWith(
      "auth:lockout:attempts:user@example.com",
      3,
      service.WINDOW_SECONDS,
    );
  });

  it("locks account when failed attempts reach threshold", async () => {
    mockRedisService.get.mockResolvedValueOnce(4); // current attempts = 4, new = 5 (threshold)

    const result = await service.recordFailedAttempt("user@example.com");
    expect(result.attempts).toBe(5);
    expect(result.isLocked).toBe(true);
    expect(result.remainingSeconds).toBe(service.LOCKOUT_DURATION_SECONDS);

    expect(mockRedisService.set).toHaveBeenCalledWith(
      "auth:lockout:locked:user@example.com",
      expect.any(Number),
      service.LOCKOUT_DURATION_SECONDS,
    );
  });

  it("clears attempts and lock keys upon successful login", async () => {
    await service.clearFailedAttempts("user@example.com");
    expect(mockRedisService.del).toHaveBeenCalledWith("auth:lockout:attempts:user@example.com");
    expect(mockRedisService.del).toHaveBeenCalledWith("auth:lockout:locked:user@example.com");
  });
});

