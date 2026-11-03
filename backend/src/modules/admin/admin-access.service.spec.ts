/**
 * @blast-radius: api
 * AdminAccessService: role matrix is derived from real @Roles metadata; integrations never leak secrets.
 */
import "reflect-metadata";
import { Controller, Get, Post } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { Roles } from "../auth/decorators/roles.decorator";
import { AdminAccessService } from "./admin-access.service";

@Controller("bookings")
class FakeBookingsController {
  @Get()
  @Roles("staff", "manager_owner")
  list() {}

  @Post()
  @Roles("manager_owner")
  create() {}

  @Get("public")
  publicRoute() {}
}

@Controller("admin")
@Roles("admin")
class FakeAdminController {
  @Get("users")
  users() {}
}

function build(env: Record<string, string> = {}) {
  const prisma = {
    userAccount: {
      groupBy: vi
        .fn()
        .mockResolvedValueOnce([{ role: "staff", _count: { _all: 3 } }, { role: "admin", _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ role: "staff", _count: { _all: 2 } }, { role: "admin", _count: { _all: 1 } }]),
    },
  };
  const discovery = {
    getControllers: () => [{ metatype: FakeBookingsController }, { metatype: FakeAdminController }],
  };
  const config = { get: (key: string) => env[key] };
  const service = new AdminAccessService(prisma as any, discovery as any, new Reflector(), config as any);
  return { service };
}

describe("AdminAccessService", () => {
  it("builds the permission matrix from @Roles metadata and counts users per role", async () => {
    const { service } = build();

    const result: any = await service.getRoleMatrix();
    const byRole = Object.fromEntries(result.data.roles.map((r: any) => [r.role, r]));

    expect(byRole.staff.areas).toEqual([expect.objectContaining({ area: "bookings", read: 1, write: 0 })]);
    expect(byRole.manager_owner.areas).toEqual([expect.objectContaining({ area: "bookings", read: 1, write: 1 })]);
    expect(byRole.admin.areas).toEqual([expect.objectContaining({ area: "admin", read: 1, write: 0 })]);
    expect(byRole.customer.areas).toEqual([]);
    expect(byRole.staff.userCount).toBe(3);
    expect(byRole.staff.activeCount).toBe(2);
    expect(byRole.customer.userCount).toBe(0);
  });

  it("reports integration status without exposing secret values", () => {
    const { service } = build({
      AI_API_KEY: "sk-super-secret",
      AI_MODEL: "model-x",
      AI_BASE_URL: "https://api.example.com/v1",
      PAYOS_CLIENT_ID: "client-id-value",
      PAYOS_API_KEY: "payos-api-secret",
    });

    const result: any = service.getIntegrations();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("sk-super-secret");
    expect(serialized).not.toContain("payos-api-secret");
    expect(serialized).not.toContain("client-id-value");
    const ai = result.data.find((i: any) => i.key === "ai");
    const payos = result.data.find((i: any) => i.key === "payos");
    expect(ai.configured).toBe(true);
    expect(ai.details).toContainEqual({ label: "Máy chủ", value: "api.example.com" });
    expect(payos.configured).toBe(false);
  });
});
