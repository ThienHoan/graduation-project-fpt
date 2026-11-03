/**
 * @blast-radius: api
 * AdminExportService: CSV escaping, formula-injection guard, no password hashes, audit trail.
 */
import { BadRequestException } from "@nestjs/common";
import { AppRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AdminExportService, toCsv, toCsvCell } from "./admin-export.service";

const ADMIN: AuthenticatedUser = {
  id: "admin-1",
  email: "admin@shop.vn",
  role: AppRole.admin,
  isActive: true,
  fullName: "Admin",
  phone: null,
};

function build() {
  const prisma = {
    userAccount: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "u1",
          email: "a@b.vn",
          role: "customer",
          isActive: true,
          isEmailVerified: false,
          createdAt: new Date("2026-10-01T00:00:00Z"),
          profile: { fullName: '=HYPERLINK("http://evil")', phone: "0900" },
          _count: { bookings: 2 },
        },
      ]),
    },
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([
        {
          createdAt: new Date("2026-10-02T00:00:00Z"),
          action: "ADMIN_UPDATE_SETTING",
          entityType: "system_setting",
          entityId: null,
          actor: { email: "admin@shop.vn", role: "admin" },
          metadata: { key: "ai_primary_key", value: "sk-secret" },
        },
      ]),
    },
  };
  return { service: new AdminExportService(prisma as any), prisma };
}

describe("CSV helpers", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it("prefixes cells that could be executed as formulas", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(toCsvCell(bad).startsWith("'")).toBe(true);
    }
  });

  it("joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("AdminExportService", () => {
  it("exports users without password hash and neutralises formulas", async () => {
    const { service, prisma } = build();

    const result: any = await service.exportDataset("users", {}, ADMIN);

    expect(prisma.userAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.not.objectContaining({ passwordHash: expect.anything() }) }),
    );
    expect(result.data.filename).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.data.csv).toContain("'=HYPERLINK");
    expect(result.data.rows).toBe(1);
    expect(result.data.truncated).toBe(false);
  });

  it("applies the date range in Vietnam time and records the export in the audit log", async () => {
    const { service, prisma } = build();

    await service.exportDataset("bookings", { from: "2026-10-01", to: "2026-10-31" }, ADMIN);

    const where = prisma.booking.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(where.createdAt.lte.toISOString()).toBe("2026-10-31T16:59:59.999Z");
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ADMIN_EXPORT_DATA",
        actorId: "admin-1",
        metadata: expect.objectContaining({ dataset: "bookings", from: "2026-10-01", to: "2026-10-31" }),
      }),
    });
  });

  it("hides values of settings that are not defined when exporting audit logs", async () => {
    const { service } = build();

    const result: any = await service.exportDataset("audit-logs", {}, ADMIN);

    expect(result.data.csv).toContain("ai_primary_key");
    expect(result.data.csv).not.toContain("sk-secret");
  });

  it("rejects unknown datasets and reversed ranges", async () => {
    const { service } = build();
    await expect(service.exportDataset("passwords", {}, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.exportDataset("users", { from: "2026-11-02", to: "2026-11-01" }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
