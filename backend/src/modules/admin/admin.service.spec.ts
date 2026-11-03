/**
 * @blast-radius: core, api
 * Behavioral tests for AdminService: user management, roles, and system settings.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";
import type { AuthenticatedUser } from "../auth/auth-user";

describe("AdminService", () => {
  const ADMIN_ACTOR: AuthenticatedUser = {
    id: "admin-1",
    email: "admin@shop.vn",
    role: AppRole.admin,
    isActive: true,
    fullName: "Quản trị viên",
    phone: "0900000000",
  };

  function createService(userOverrides: Record<string, any> = {}) {
    const targetUser = {
      id: "user-2",
      email: "staff@shop.vn",
      role: AppRole.staff,
      isActive: true,
      profile: { fullName: "Staff A", phone: "0901234567" },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...userOverrides,
    };

    const tx = {
      profile: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      userAccount: {
        update: vi.fn().mockImplementation(async ({ data }) => ({
          ...targetUser,
          ...data,
          profile: targetUser.profile,
          _count: { bookings: 5 },
        })),
        findUnique: vi.fn().mockResolvedValue({
          ...targetUser,
          profile: targetUser.profile,
          _count: { bookings: 5 },
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      systemSetting: {
        upsert: vi.fn().mockImplementation(async ({ create }) => ({
          ...create,
          updatedAt: new Date(),
        })),
      },
    };

    const prisma = {
      userAccount: {
        findUnique: vi.fn().mockResolvedValue(targetUser),
        count: vi.fn().mockResolvedValue(2),
      },
      garment: { count: vi.fn().mockResolvedValue(50) },
      garmentAsset: {
        count: vi.fn().mockResolvedValue(120),
        groupBy: vi.fn().mockResolvedValue([
          { status: "available", _count: { _all: 100 } },
          { status: "rented", _count: { _all: 20 } },
        ]),
      },
      booking: {
        count: vi.fn().mockResolvedValue(10),
        groupBy: vi.fn().mockResolvedValue([
          { status: "completed", _count: { _all: 8 } },
          { status: "pending_confirmation", _count: { _all: 2 } },
        ]),
        aggregate: vi.fn().mockResolvedValue({
          _sum: {
            rentalTotal: 10000000,
            depositTotal: 5000000,
            penaltyTotal: 200000,
          },
        }),
      },
      inspectionSession: { count: vi.fn().mockResolvedValue(2) },
      laundryTicket: { count: vi.fn().mockResolvedValue(3) },
      maintenanceJob: { count: vi.fn().mockResolvedValue(1) },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(5),
      },
      systemSetting: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockImplementation(async ({ create }) => ({
          ...create,
          updatedAt: new Date(),
        })),
      },
      $transaction: vi.fn().mockImplementation(async (cb: (txClient: typeof tx) => Promise<any>) => cb(tx)),
    };

    const service = new AdminService(prisma as any);
    return { service, prisma, tx, targetUser };
  }

  describe("updateUser", () => {
    it("updates role and active status of another user successfully", async () => {
      const { service, tx } = createService();

      const result = await service.updateUser("user-2", ADMIN_ACTOR, {
        role: AppRole.manager_owner,
        isActive: true,
      });

      expect(result.data).toBeDefined();
      expect(tx.userAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-2" },
          data: expect.objectContaining({ role: AppRole.manager_owner }),
        }),
      );
    });

    it("prevents admin from self-demoting or self-deactivating", async () => {
      const { service } = createService({ id: ADMIN_ACTOR.id, role: AppRole.admin });

      await expect(
        service.updateUser(ADMIN_ACTOR.id, ADMIN_ACTOR, { role: AppRole.customer }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.updateUser(ADMIN_ACTOR.id, ADMIN_ACTOR, { isActive: false }),
      ).rejects.toThrow("Bạn không thể tự hạ quyền hoặc vô hiệu hóa chính mình.");
    });

    it("prevents demoting or deactivating the last active admin in the system", async () => {
      const { service, prisma } = createService({ id: "admin-target", role: AppRole.admin });
      // Only 0 other active admins left
      prisma.userAccount.count.mockResolvedValue(0);

      await expect(
        service.updateUser("admin-target", ADMIN_ACTOR, { role: AppRole.customer }),
      ).rejects.toThrow("Hệ thống phải giữ lại ít nhất một quản trị viên đang hoạt động.");
    });

    it("throws NotFoundException if target user does not exist", async () => {
      const { service, prisma } = createService();
      prisma.userAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser("missing-id", ADMIN_ACTOR, { role: AppRole.staff }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException if no fields are provided to update", async () => {
      const { service } = createService();

      await expect(service.updateUser("user-2", ADMIN_ACTOR, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe("getOverview", () => {
    it("aggregates system counts and returns dashboard overview metrics", async () => {
      const { service, prisma } = createService();

      const overview = await service.getOverview();

      expect(overview.data).toBeDefined();
      expect(overview.data?.summary).toHaveLength(4);
      expect(overview.data?.queues).toBeDefined();
      expect(prisma.garment.count).toHaveBeenCalled();
      expect(prisma.booking.count).toHaveBeenCalled();
    });
  });

  describe("updateSetting", () => {
    it("validates setting type and updates setting successfully", async () => {
      const { service, tx } = createService();

      const result = await service.updateSetting("max_rental_days", ADMIN_ACTOR, { value: 45 });

      expect(result.data).toBeDefined();
      expect(tx.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "max_rental_days" },
          create: expect.objectContaining({ key: "max_rental_days", value: 45 }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalled();
    });

    it("rejects wrong value type for number setting", async () => {
      const { service } = createService();

      await expect(
        service.updateSetting("max_rental_days", ADMIN_ACTOR, { value: "not-a-number" }),
      ).rejects.toThrow("Thiết lập 'max_rental_days' cần một giá trị số.");
    });

    it("rejects keys that are not defined settings (e.g. API keys or gateway secrets)", async () => {
      const { service, tx } = createService();

      await expect(
        service.updateSetting("ai_primary_key", ADMIN_ACTOR, { value: "sk-secret" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  describe("listSettings", () => {
    it("only returns defined settings and hides legacy custom keys", async () => {
      const { service, prisma } = createService();
      (prisma as any).systemSetting = {
        findMany: vi.fn().mockResolvedValue([
          { key: "max_rental_days", value: { value: 12 }, updatedAt: new Date() },
          { key: "payment_vnpay_hashsecret", value: "leaked", updatedAt: new Date() },
        ]),
      };

      const result: any = await service.listSettings();
      const keys = result.data.map((item: { key: string }) => item.key);

      expect(keys).toContain("max_rental_days");
      expect(keys).not.toContain("payment_vnpay_hashsecret");
      expect(JSON.stringify(result)).not.toContain("leaked");
    });
  });

  describe("listAuditLogs", () => {
    function auditPrisma(service: any, prisma: any) {
      prisma.auditLog = {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([
          { action: "notification.sent", _count: { _all: 2000 } },
          { action: "ADMIN_UPDATE_USER", _count: { _all: 3 } },
        ]),
      };
      return prisma.auditLog;
    }

    it("filters by action group so system notifications can be hidden", async () => {
      const { service, prisma } = createService();
      const auditLog = auditPrisma(service, prisma);

      await service.listAuditLogs({ page: 1, limit: 10, group: "admin" } as any);
      expect(auditLog.findMany.mock.calls[0][0].where.AND).toEqual([{ action: { startsWith: "ADMIN_" } }]);

      await service.listAuditLogs({ page: 1, limit: 10, group: "other", action: "FAQ_UPDATE" } as any);
      expect(auditLog.findMany.mock.calls[1][0].where.AND).toEqual([
        { action: "FAQ_UPDATE" },
        { NOT: [{ action: { startsWith: "ADMIN_" } }, { action: { startsWith: "notification." } }] },
      ]);
    });

    it("applies no action filter by default", async () => {
      const { service, prisma } = createService();
      const auditLog = auditPrisma(service, prisma);

      await service.listAuditLogs({ page: 1, limit: 10 } as any);

      expect(auditLog.findMany.mock.calls[0][0].where.AND).toBeUndefined();
    });

    it("lists distinct actions with counts", async () => {
      const { service, prisma } = createService();
      auditPrisma(service, prisma);

      const result: any = await service.listAuditLogActions();

      expect(result.data).toEqual([
        { action: "notification.sent", count: 2000 },
        { action: "ADMIN_UPDATE_USER", count: 3 },
      ]);
    });

    it("redacts values of settings that are not defined", async () => {
      const { service, prisma } = createService();
      (prisma as any).auditLog = {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "log-1",
            action: "ADMIN_UPDATE_SETTING",
            entityType: "system_setting",
            entityId: null,
            metadata: { key: "ai_primary_key", value: "sk-secret" },
            actorId: "admin-1",
            actor: null,
            createdAt: new Date(),
          },
        ]),
      };

      const result: any = await service.listAuditLogs({ page: 1, limit: 20 } as any);

      expect(JSON.stringify(result)).not.toContain("sk-secret");
    });
  });
});
