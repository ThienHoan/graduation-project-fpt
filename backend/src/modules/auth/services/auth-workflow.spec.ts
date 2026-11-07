import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthService } from "../auth.service";

describe("AuthService - Expanded Workflows", () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockJwtService: any;
  let mockNotificationsService: any;
  let mockTokenService: any;
  let mockLockoutService: any;
  let mockOtpService: any;
  let mockPasswordService: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockPrisma = {
      userAccount: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    mockJwtService = {
      signAsync: vi.fn(),
      verifyAsync: vi.fn(),
    };
    mockNotificationsService = {
      sendAuthVerificationEmail: vi.fn(),
    };
    mockTokenService = {
      blacklistToken: vi.fn().mockResolvedValue(undefined),
    };
    mockLockoutService = {
      isLocked: vi.fn().mockResolvedValue({ isLocked: false, remainingSeconds: 0 }),
      recordFailedAttempt: vi.fn().mockResolvedValue({ attempts: 1, isLocked: false, remainingSeconds: 0 }),
      clearFailedAttempts: vi.fn().mockResolvedValue(undefined),
    };
    mockOtpService = {
      checkResendCooldown: vi.fn().mockResolvedValue({ canResend: true, remainingSeconds: 0 }),
      setResendCooldown: vi.fn().mockResolvedValue(undefined),
    };
    mockPasswordService = {
      comparePassword: vi.fn(),
      hashPassword: vi.fn().mockResolvedValue("new_hashed_password"),
      assertPasswordStrength: vi.fn(),
    };
    mockAuditService = {
      logAuthEvent: vi.fn().mockResolvedValue(undefined),
      getUserSecurityActivity: vi.fn().mockResolvedValue([]),
    };

    authService = new AuthService(
      mockPrisma as any,
      mockJwtService as any,
      mockNotificationsService as any,
      mockTokenService as any,
      mockLockoutService as any,
      mockOtpService as any,
      mockPasswordService as any,
      mockAuditService as any,
    );
  });

  describe("changePassword", () => {
    it("successfully changes password when current password matches and new password is valid", async () => {
      mockPrisma.userAccount.findUnique.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        passwordHash: "old_hash",
        isActive: true,
      });
      mockPasswordService.comparePassword.mockResolvedValue(true);

      const res = await authService.changePassword("user-1", {
        currentPassword: "OldPassword123!",
        newPassword: "NewSecurePass@2026",
      });

      expect(res.success).toBe(true);
      expect(mockPasswordService.assertPasswordStrength).toHaveBeenCalledWith(
        "NewSecurePass@2026",
        "test@example.com",
      );
      expect(mockPrisma.userAccount.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          passwordHash: "new_hashed_password",
          updatedAt: expect.any(Date),
        },
      });
      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "AUTH_PASSWORD_CHANGED", actorId: "user-1" }),
      );
    });

    it("rejects when current password does not match", async () => {
      mockPrisma.userAccount.findUnique.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        passwordHash: "old_hash",
        isActive: true,
      });
      mockPasswordService.comparePassword.mockResolvedValue(false);

      await expect(
        authService.changePassword("user-1", {
          currentPassword: "WrongPassword!",
          newPassword: "NewSecurePass@2026",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects when new password matches current password", async () => {
      mockPrisma.userAccount.findUnique.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        passwordHash: "same_hash",
        isActive: true,
      });
      mockPasswordService.comparePassword.mockResolvedValue(true);

      await expect(
        authService.changePassword("user-1", {
          currentPassword: "SamePassword123!",
          newPassword: "SamePassword123!",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("logout", () => {
    it("blacklists the token and records audit log", async () => {
      const res = await authService.logout("valid.jwt.token", "user-1");

      expect(res.success).toBe(true);
      expect(mockTokenService.blacklistToken).toHaveBeenCalledWith("valid.jwt.token");
      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "AUTH_LOGOUT", actorId: "user-1" }),
      );
    });
  });

  describe("login with lockout protection", () => {
    it("blocks login if account is currently locked", async () => {
      mockLockoutService.isLocked.mockResolvedValue({ isLocked: true, remainingSeconds: 400 });

      await expect(
        authService.login({ email: "locked@example.com", password: "Password123!" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});

