import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAQ_SEED_ITEMS } from "./faq-defaults";
import { FaqService } from "./faq.service";
import { FaqAdminService, maskAccountNumber } from "./faq-admin.service";
import { FaqAdminController } from "./faq-admin.controller";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";

const ACTOR = { id: "11111111-1111-1111-1111-111111111111", role: "manager_owner" };

function rowFrom(
  config: {
    key: string;
    intent: string;
    answerTemplate: string;
    requiredParams: string[];
    values: Record<string, string>;
    notApplicable?: boolean;
    notApplicableReply?: string | null;
    isActive: boolean;
  },
  id = "22222222-2222-2222-2222-222222222222",
  updatedBy: string | null = ACTOR.id,
) {
  return {
    id,
    key: config.key,
    intent: config.intent,
    patterns: [],
    answerTemplate: config.answerTemplate,
    requiredParams: config.requiredParams,
    values: config.values,
    notApplicable: config.notApplicable ?? false,
    notApplicableReply: config.notApplicableReply ?? null,
    isActive: config.isActive,
    updatedBy,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  };
}

function createPrisma() {
  const prisma: any = {
    faqItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(prisma));
  return prisma;
}

function createRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    delPattern: vi.fn().mockResolvedValue(undefined),
  };
}

describe("FaqAdminService", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let redis: ReturnType<typeof createRedis>;
  let faqService: FaqService;
  let service: FaqAdminService;

  beforeEach(() => {
    prisma = createPrisma();
    redis = createRedis();
    faqService = new FaqService(prisma as never, redis as never);
    service = new FaqAdminService(prisma as never, faqService);
  });

  it("lists every seed key without writing seed rows", async () => {
    const items = await service.list();

    expect(items).toHaveLength(FAQ_SEED_ITEMS.length);
    expect(prisma.faqItem.upsert).not.toHaveBeenCalled();

    const address = items.find((item) => item.key === "address");
    expect(address).toMatchObject({
      exists: false,
      isActive: false,
      values: {},
      missingKeys: ["address.address"],
      updatedAt: null,
    });
  });

  it("overlays saved rows and keeps custom rows visible", async () => {
    prisma.faqItem.findMany.mockResolvedValue([
      rowFrom({
        key: "address",
        intent: "faq.address",
        answerTemplate: "Địa chỉ shop: {{address}}.",
        requiredParams: ["address"],
        values: { address: "12 Nguyễn Huệ" },
        isActive: true,
      }),
      rowFrom({
        key: "legacy_note",
        intent: "faq.legacy_note",
        answerTemplate: "Ghi chú cũ.",
        requiredParams: [],
        values: {},
        isActive: true,
      }),
    ]);

    const items = await service.list();

    const address = items.find((item) => item.key === "address");
    expect(address).toMatchObject({
      exists: true,
      isActive: true,
      values: { address: "12 Nguyễn Huệ" },
      missingKeys: [],
    });

    expect(items.some((item) => item.key === "legacy_note")).toBe(true);
  });

  it("rejects an unknown FAQ key", async () => {
    await expect(
      service.update("not_a_real_key", ACTOR as never, { isActive: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it("saves values, audits changed field names and clears the cache", async () => {
    prisma.faqItem.upsert.mockResolvedValue(
      rowFrom({
        key: "address",
        intent: "faq.address",
        answerTemplate: "Địa chỉ shop: {{address}}.",
        requiredParams: ["address"],
        values: { address: "12 Nguyễn Huệ" },
        isActive: true,
      }),
    );

    const item = await service.update("address", ACTOR as never, {
      values: { address: "12 Nguyễn Huệ" },
      isActive: true,
    });

    expect(prisma.faqItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "address" },
        create: expect.objectContaining({
          key: "address",
          values: { address: "12 Nguyễn Huệ" },
          isActive: true,
          updatedBy: ACTOR.id,
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: ACTOR.id,
        action: "FAQ_UPDATE",
        entityType: "faq_item",
        entityId: "22222222-2222-2222-2222-222222222222",
        metadata: expect.objectContaining({
          key: "address",
          changedFields: ["values", "isActive"],
          changedBy: ACTOR.id,
          changedAt: expect.any(String),
        }),
      }),
    });
    expect(redis.del).toHaveBeenCalledWith("chat:faq:address");
    expect(item).toMatchObject({
      exists: true,
      values: { address: "12 Nguyễn Huệ" },
      isActive: true,
      missingKeys: [],
    });
  });

  it("refuses to activate a FAQ while a value is missing", async () => {
    await expect(
      service.update("address", ACTOR as never, { isActive: true }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.faqItem.upsert).not.toHaveBeenCalled();
  });

  it("allows saving blank values as long as the FAQ stays inactive", async () => {
    prisma.faqItem.upsert.mockResolvedValue(
      rowFrom({
        key: "address",
        intent: "faq.address",
        answerTemplate: "Địa chỉ shop: {{address}}.",
        requiredParams: ["address"],
        values: { address: "" },
        isActive: false,
      }),
    );

    const item = await service.update("address", ACTOR as never, {
      values: { address: "" },
      isActive: false,
    });

    expect(item.values).toEqual({ address: "" });
    expect(item.isActive).toBe(false);
    expect(item.missingKeys).toEqual(["address.address"]);
  });

  it("rejects value keys that are not used by the template", async () => {
    await expect(
      service.update("address", ACTOR as never, {
        values: { address: "A", random_key: "B" },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("requires confirmation for bank changes and never audits the values", async () => {
    const bankRow = rowFrom({
      key: "bank_account",
      intent: "faq.bank_account",
      answerTemplate:
        "Ngân hàng: {{bank_name}}\nSố tài khoản: {{account_number}}\nChủ tài khoản: {{account_holder}}",
      requiredParams: ["bank_name", "account_number", "account_holder"],
      values: {
        bank_name: "Vietcombank",
        account_number: "0123456789",
        account_holder: "NGUYEN VAN A",
      },
      isActive: true,
    });
    prisma.faqItem.findUnique.mockResolvedValue(bankRow);

    await expect(
      service.update("bank_account", ACTOR as never, {
        values: { account_number: "9999999999" },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.faqItem.upsert).not.toHaveBeenCalled();

    prisma.faqItem.upsert.mockResolvedValue({
      ...bankRow,
      values: {
        ...bankRow.values,
        account_number: "9999999999",
      },
    });

    await service.update("bank_account", ACTOR as never, {
      values: { account_number: "9999999999" },
      confirm: true,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "FAQ_BANK_ACCOUNT_UPDATE",
        metadata: expect.objectContaining({
          key: "bank_account",
          changedFields: ["values"],
          changedBy: ACTOR.id,
          changedAt: expect.any(String),
          masked: { account_number: "******9999" },
        }),
      }),
    });
    expect(
      JSON.stringify(prisma.auditLog.create.mock.calls[0][0]),
    ).not.toContain("9999999999");
  });

  it("never logs full bank values when validation fails", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const debug = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    const verbose = vi.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);

    let error: unknown;
    try {
      await service.update("bank_account", ACTOR as never, {
        values: {
          bank_name: "Vietcombank",
          account_number: "0123456789",
          account_holder: "",
        },
        isActive: true,
        confirm: true,
      });
    } catch (caught) {
      error = caught;
    } finally {
      warn.mockRestore();
      errorLog.mockRestore();
      log.mockRestore();
      debug.mockRestore();
      verbose.mockRestore();
    }

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain("bank_account.account_holder");

    const serialized = JSON.stringify({
      message: (error as Error).message,
      logs: [
        ...warn.mock.calls,
        ...errorLog.mock.calls,
        ...log.mock.calls,
        ...debug.mock.calls,
        ...verbose.mock.calls,
      ],
    });
    expect(serialized).not.toContain("0123456789");
    expect(serialized).not.toContain("Vietcombank");
  });

  it("requires a not-applicable reply when that flag is on", async () => {
    await expect(
      service.update("shipping", ACTOR as never, {
        notApplicable: true,
        notApplicableReply: "   ",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("does not write when nothing changed", async () => {
    prisma.faqItem.findUnique.mockResolvedValue(
      rowFrom({
        key: "address",
        intent: "faq.address",
        answerTemplate: "Địa chỉ shop: {{address}}.",
        requiredParams: ["address"],
        values: { address: "12 Nguyễn Huệ" },
        isActive: true,
      }),
    );

    const item = await service.update("address", ACTOR as never, {
      values: { address: "12 Nguyễn Huệ" },
    });

    expect(prisma.faqItem.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(item.exists).toBe(true);
  });
});

describe("FAQ seed invariants", () => {
  it("ships only empty values and inactive flags (except try-on)", () => {
    for (const item of FAQ_SEED_ITEMS) {
      expect(item.values, item.key).toEqual({});
      if (item.key !== "try_on_appointment") {
        expect(item.isActive, item.key).toBe(false);
      }
    }
  });
});

describe("maskAccountNumber", () => {
  it("keeps at most the last four characters", () => {
    expect(maskAccountNumber("0123456789")).toBe("******6789");
    expect(maskAccountNumber("1234")).toBe("****");
    expect(maskAccountNumber("12")).toBe("**");
    expect(maskAccountNumber("  ")).toBe("");
  });
});

describe("FaqAdminController", () => {
  it("is restricted to manager_owner and admin", () => {
    expect(Reflect.getMetadata(ROLES_KEY, FaqAdminController)).toEqual([
      "manager_owner",
      "admin",
    ]);
  });

  it("is protected by the JWT and roles guards", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, FaqAdminController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  describe("RolesGuard at the real controller metadata", () => {
    const guard = new RolesGuard(new Reflector());

    function contextFor(user?: { id: string; role: string }): ExecutionContext {
      return {
        getHandler: () => FaqAdminController.prototype.list,
        getClass: () => FaqAdminController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      } as unknown as ExecutionContext;
    }

    it("rejects anonymous callers", () => {
      expect(() => guard.canActivate(contextFor())).toThrow(UnauthorizedException);
    });

    it.each(["customer", "staff"])("rejects %s", (role) => {
      expect(() =>
        guard.canActivate(contextFor({ id: "user-1", role })),
      ).toThrow(ForbiddenException);
    });

    it.each(["manager_owner", "admin"])("allows %s", (role) => {
      expect(guard.canActivate(contextFor({ id: "user-1", role }))).toBe(true);
    });
  });
});
