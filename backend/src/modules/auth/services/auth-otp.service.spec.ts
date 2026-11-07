import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthOtpService } from "./auth-otp.service";

describe("AuthOtpService", () => {
  let service: AuthOtpService;
  let mockRedisService: any;

  beforeEach(() => {
    mockRedisService = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };
    service = new AuthOtpService(mockRedisService as any);
  });

  it("generates a 6-digit numeric string", () => {
    const code = service.generateCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("permits resend when no cooldown is active", async () => {
    mockRedisService.get.mockResolvedValue(null);
    const result = await service.checkResendCooldown("user-1");
    expect(result.canResend).toBe(true);
    expect(result.remainingSeconds).toBe(0);
  });

  it("blocks resend when cooldown is active", async () => {
    const expiresAt = Date.now() + 45 * 1000;
    mockRedisService.get.mockResolvedValue(expiresAt);

    const result = await service.checkResendCooldown("user-1");
    expect(result.canResend).toBe(false);
    expect(result.remainingSeconds).toBeGreaterThan(0);
  });

  it("tracks failed attempts and marks code exhausted when max attempts reached", async () => {
    mockRedisService.get.mockResolvedValueOnce(service.MAX_VERIFICATION_ATTEMPTS - 1);

    const result = await service.recordFailedAttempt("code-record-1");
    expect(result.isExhausted).toBe(true);
    expect(result.remainingAttempts).toBe(0);
  });

  it("clears attempts when verified", async () => {
    await service.clearAttempts("code-record-1");
    expect(mockRedisService.del).toHaveBeenCalledWith("auth:otp:attempts:code-record-1");
  });
});

