import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthAuditService } from "./auth-audit.service";

describe("AuthAuditService", () => {
  let service: AuthAuditService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    service = new AuthAuditService(mockPrisma as any);
  });

  it("creates an audit log entry for auth events", async () => {
    await service.logAuthEvent({
      actorId: "user-1",
      action: "AUTH_LOGIN_SUCCESS",
      clientInfo: {
        ip: "192.168.1.*",
        browser: "Chrome",
        os: "Windows",
        deviceType: "desktop",
      },
      details: { loginMethod: "password" },
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "user-1",
        action: "AUTH_LOGIN_SUCCESS",
        entityType: "AUTH",
        entityId: null,
        metadata: expect.objectContaining({
          ip: "192.168.1.*",
          browser: "Chrome",
          loginMethod: "password",
        }),
      },
    });
  });

  it("retrieves formatted security activities for a user", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        actorId: "user-1",
        action: "AUTH_LOGIN_SUCCESS",
        createdAt: new Date("2026-11-06T10:00:00Z"),
        metadata: {
          ip: "127.0.0.1",
          browser: "Chrome",
          os: "macOS",
          deviceType: "desktop",
        },
      },
    ]);

    const result = await service.getUserSecurityActivity("user-1");

    expect(result).toHaveLength(1);
    expect(result[0].actionLabel).toBe("Đăng nhập thành công");
    expect(result[0].browser).toBe("Chrome");
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { actorId: "user-1", entityType: "AUTH" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  });
});

