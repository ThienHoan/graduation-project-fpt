import { beforeEach, describe, expect, it, vi } from "vitest";
import { FaqService, type FaqConfig } from "./faq.service";

function bankConfig(overrides: Partial<FaqConfig> = {}): FaqConfig {
  return {
    key: "bank_account",
    intent: "faq.bank_account",
    answerTemplate: [
      "Ngân hàng: {{bank_name}}",
      "Số tài khoản: {{account_number}}",
      "Chủ tài khoản: {{account_holder}}",
    ].join("\n"),
    requiredParams: ["bank_name", "account_number", "account_holder"],
    values: {
      bank_name: "Vietcombank",
      account_number: "0123456789",
      account_holder: "NGUYEN VAN A",
    },
    notApplicable: false,
    notApplicableReply: null,
    isActive: true,
    ...overrides,
  };
}

function rowFrom(config: FaqConfig) {
  return {
    key: config.key,
    intent: config.intent,
    answerTemplate: config.answerTemplate,
    requiredParams: config.requiredParams,
    values: config.values,
    notApplicable: config.notApplicable,
    notApplicableReply: config.notApplicableReply,
    isActive: config.isActive,
  };
}

describe("FaqService", () => {
  let prisma: any;
  let redis: any;
  let service: FaqService;

  beforeEach(() => {
    prisma = {
      faqItem: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };
    redis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      delPattern: vi.fn(),
    };
    service = new FaqService(prisma as never, redis as never);
  });

  it("renders bank details only from configured FAQ values", async () => {
    prisma.faqItem.findUnique.mockResolvedValue(rowFrom(bankConfig()));

    const result = await service.render("bank_account");

    expect(result).toMatchObject({ status: "ok", key: "bank_account" });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.reply).toContain("Vietcombank");
    expect(result.reply).toContain("0123456789");
    expect(result.reply).toContain("NGUYEN VAN A");
  });

  it("does not invent bank details when a required field is blank", async () => {
    prisma.faqItem.findUnique.mockResolvedValue(
      rowFrom(
        bankConfig({
          values: {
            bank_name: "Vietcombank",
            account_number: "0123456789",
            account_holder: "",
          },
        }),
      ),
    );

    const result = await service.render("bank_account");

    expect(result).toMatchObject({
      status: "missing",
      key: "bank_account",
      missingKey: "bank_account.account_holder",
      reason: "faq_config_missing",
    });
  });

  it("treats an inactive FAQ as missing, never as an empty answer", async () => {
    prisma.faqItem.findUnique.mockResolvedValue(
      rowFrom(bankConfig({ isActive: false })),
    );

    const result = await service.render("bank_account");

    expect(result.status).toBe("missing");
    if (result.status !== "missing") throw new Error("expected missing");
    expect(result.reason).toBe("faq_config_missing");
    expect(result.missingKey).toBe("bank_account");
  });

  it("returns missing when the item does not exist", async () => {
    prisma.faqItem.findUnique.mockResolvedValue(null);

    const result = await service.render("address");

    expect(result).toMatchObject({
      status: "missing",
      key: "address",
      missingKey: "address",
    });
  });

  it("uses cached config and invalidates the bank_account cache after saving", async () => {
    const cached = bankConfig();
    redis.get.mockResolvedValue(cached);

    await expect(service.render("bank_account")).resolves.toMatchObject({ status: "ok" });
    expect(prisma.faqItem.findUnique).not.toHaveBeenCalled();

    await service.invalidate("bank_account");
    expect(redis.del).toHaveBeenCalledWith("chat:faq:bank_account");
  });

  it("supports a configured not-applicable reply instead of opening the FAQ", () => {
    const result = service.renderConfig(
      bankConfig({
        notApplicable: true,
        notApplicableReply: "Shop chỉ nhận tiền mặt ạ.",
      }),
      "bank_account",
    );

    expect(result).toEqual({
      status: "not_applicable",
      key: "bank_account",
      reply: "Shop chỉ nhận tiền mặt ạ.",
    });
  });
});
