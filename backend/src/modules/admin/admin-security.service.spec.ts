/**
 * @blast-radius: api
 * AdminSecurityService: force sign-out, manual email verification, security overview.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AdminSecurityService } from "./admin-security.service";

const ADMIN: AuthenticatedUser = {
  id: "admin-1",
  email: "admin@shop.vn",
  role: AppRole.admin,
  isActive: true,
  fullName: "Admin",
  phone: null,
};

function build(target: Record<string, unknown> | null = { id: "u-2", email: "staff@shop.vn", isEmailVerified: false }) {
  const tx = {
    userAccount: { update: vi.fn().mockResolvedValue({}) },
    emailVerificationCode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    userAccount: {
      findUnique: vi.fn().mockResolvedValue(target),
      count: vi.fn().mockResolvedValue(4),
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new AdminSecurityService(prisma as any), prisma, tx };
}

describe("AdminSecurityService", () => {
  it("revokes sessions by bumping updatedAt and writes an audit entry", async () => {
    const { service, tx } = build();

    const result: any = await service.revokeSessions("u-2", ADMIN);

    expect(result.success).toBe(true);
    expect(tx.userAccount.update).toHaveBeenCalledWith({
      where: { id: "u-2" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ADMIN_REVOKE_SESSIONS", actorId: "admin-1", entityId: "u-2" }),
    });
  });

  it("does not let an admin sign themselves out", async () => {
    const { service, tx } = build();
    await expect(service.revokeSessions("admin-1", ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.userAccount.update).not.toHaveBeenCalled();
  });

  it("returns 404 when revoking an unknown account", async () => {
    const { service } = build(null);
    await expect(service.revokeSessions("missing", ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("verifies an email manually and closes pending OTP codes", async () => {
    const { service, tx } = build();

    await service.verifyEmail("u-2", ADMIN);

    expect(tx.userAccount.update).toHaveBeenCalledWith({ where: { id: "u-2" }, data: { isEmailVerified: true } });
    expect(tx.emailVerificationCode.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-2", used: false },
      data: { used: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ADMIN_VERIFY_EMAIL" }),
    });
  });

  it("rejects verifying an already verified email", async () => {
    const { service } = build({ id: "u-2", email: "a@b.c", isEmailVerified: true });
    await expect(service.verifyEmail("u-2", ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("filters accounts by type and never returns password hashes", async () => {
    const { service, prisma } = build();
    prisma.userAccount.findMany.mockResolvedValue([
      {
        id: "u-3",
        email: "x@y.z",
        role: AppRole.customer,
        isActive: false,
        isEmailVerified: true,
        passwordHash: "$2a$12$secret",
        createdAt: new Date(),
        updatedAt: new Date(),
        profile: { fullName: "X" },
      },
    ]);

    const result: any = await service.listAccounts({ page: 1, limit: 10, type: "inactive" } as any);

    expect(prisma.userAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: false }) }),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.data.items[0]).toMatchObject({ id: "u-3", fullName: "X" });
  });

  it("builds the overview with stats and labelled recent events", async () => {
    const { service, prisma } = build();
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "l1",
        action: "ADMIN_REVOKE_SESSIONS",
        metadata: { targetEmail: "staff@shop.vn" },
        createdAt: new Date("2026-11-02T00:00:00Z"),
        actor: { email: "admin@shop.vn", profile: { fullName: "Admin" } },
      },
    ]);

    const result: any = await service.getOverview();

    expect(result.data.stats.total).toBe(4);
    expect(result.data.recentEvents[0]).toMatchObject({
      label: "Buộc đăng xuất",
      actorName: "Admin",
      targetEmail: "staff@shop.vn",
    });
  });
});
