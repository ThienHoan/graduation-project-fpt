import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { BANK_ACCOUNT_REQUIRED_PARAMS, FAQ_SEED_ITEMS, type FaqSeedItem } from "./faq-defaults";

const FAQ_CACHE_PREFIX = "chat:faq:";
const FAQ_CACHE_TTL_SECONDS = 300;
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type FaqConfig = {
  key: string;
  intent: string;
  answerTemplate: string;
  requiredParams: string[];
  values: Record<string, string>;
  notApplicable: boolean;
  notApplicableReply: string | null;
  isActive: boolean;
};

export type FaqRenderResult =
  | { status: "ok"; key: string; reply: string }
  | { status: "not_applicable"; key: string; reply: string }
  | {
      status: "missing";
      key: string;
      /** Key cụ thể bị thiếu, ví dụ `bank_account.account_number`. */
      missingKey: string;
      reason: "faq_config_missing";
    };

export type FaqSnapshot = {
  config: FaqConfig;
  missingKeys: string[];
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string") {
      result[key] = raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      result[key] = String(raw);
    }
  }
  return result;
}

/**
 * Đọc cấu hình FAQ, render câu trả lời từ values do quản trị nhập.
 *
 * Không có giá trị mặc định nào cho nội dung nghiệp vụ. Thiếu cấu hình
 * (item không tồn tại / inactive / template hoặc required param rỗng) đều
 * trả `faq_config_missing` để router chuyển STAFF.
 */
@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async listConfigs(): Promise<FaqConfig[]> {
    const rows = await this.prisma.faqItem.findMany({
      orderBy: { key: "asc" },
    });
    return rows.map((row) => this.toConfig(row));
  }

  async getConfig(key: string): Promise<FaqConfig | null> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return null;

    const cacheKey = `${FAQ_CACHE_PREFIX}${normalizedKey}`;
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const row = await this.prisma.faqItem.findUnique({ where: { key: normalizedKey } });
    if (!row) return null;

    const config = this.toConfig(row);
    await this.writeCache(cacheKey, config);
    return config;
  }

  async render(key: string): Promise<FaqRenderResult> {
    const config = await this.getConfig(key);
    return this.renderConfig(config, key);
  }

  /** Tách pure để test và để trang admin preview trước khi lưu. */
  renderConfig(config: FaqConfig | null, key: string): FaqRenderResult {
    if (!config) {
      return {
        status: "missing",
        key,
        missingKey: key,
        reason: "faq_config_missing",
      };
    }

    if (config.notApplicable) {
      const reply = config.notApplicableReply?.trim() ?? "";
      if (!reply) {
        return {
          status: "missing",
          key,
          missingKey: `${key}.not_applicable_reply`,
          reason: "faq_config_missing",
        };
      }
      return { status: "not_applicable", key, reply };
    }

    if (!config.isActive) {
      return { status: "missing", key, missingKey: key, reason: "faq_config_missing" };
    }

    const template = config.answerTemplate?.trim() ?? "";
    if (!template) {
      return { status: "missing", key, missingKey: key, reason: "faq_config_missing" };
    }

    const missingKeys = this.findMissingKeys(config, template);
    if (missingKeys.length > 0) {
      return {
        status: "missing",
        key,
        missingKey: missingKeys[0],
        reason: "faq_config_missing",
      };
    }

    const reply = template.replace(PLACEHOLDER_PATTERN, (_match, name: string) =>
      (config.values[name] ?? "").trim(),
    );

    if (!reply.trim()) {
      return { status: "missing", key, missingKey: key, reason: "faq_config_missing" };
    }

    return { status: "ok", key, reply: reply.trim() };
  }

  /** Dùng cho trang admin: biết ngay field nào còn thiếu trước khi bật FAQ. */
  inspect(config: FaqConfig | null): FaqSnapshot | null {
    if (!config) return null;
    return {
      config,
      missingKeys: this.findMissingKeys(config, config.answerTemplate),
    };
  }

  /** Gọi sau khi admin lưu FAQ (đặc biệt STK/ngân hàng/chủ tài khoản). */
  async invalidate(key?: string): Promise<void> {
    if (!this.redisService) return;
    if (key) {
      await this.redisService.del(`${FAQ_CACHE_PREFIX}${key}`);
      return;
    }
    await this.redisService.delPattern(`${FAQ_CACHE_PREFIX}*`);
  }

  /** Danh sách key seed để trang admin tạo mới, không tự ghi DB. */
  seedItems(): FaqSeedItem[] {
    return FAQ_SEED_ITEMS.map((item) => ({ ...item, values: { ...item.values } }));
  }

  private findMissingKeys(config: FaqConfig, template: string): string[] {
    const missing = new Set<string>();

    for (const required of config.requiredParams) {
      if (!config.values[required]?.trim()) missing.add(`${config.key}.${required}`);
    }

    for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1];
      if (name && !config.values[name]?.trim()) missing.add(`${config.key}.${name}`);
    }

    // STK/ngân hàng/chủ tài khoản là nhóm nhạy cảm: luôn kiểm tra đủ 3 field,
    // kể cả khi template bị sửa thiếu placeholder.
    if (config.key === "bank_account") {
      for (const required of BANK_ACCOUNT_REQUIRED_PARAMS) {
        if (!config.values[required]?.trim()) missing.add(`${config.key}.${required}`);
      }
    }

    return [...missing];
  }

  /** Chuyển row DB sang cấu hình thuần. Public để trang quản trị FAQ dùng lại. */
  toConfig(row: {
    key: string;
    intent: string;
    answerTemplate: string;
    requiredParams: unknown;
    values: unknown;
    notApplicable: boolean;
    notApplicableReply: string | null;
    isActive: boolean;
  }): FaqConfig {
    return {
      key: row.key,
      intent: row.intent,
      answerTemplate: row.answerTemplate,
      requiredParams: asStringArray(row.requiredParams),
      values: asStringRecord(row.values),
      notApplicable: row.notApplicable,
      notApplicableReply: row.notApplicableReply,
      isActive: row.isActive,
    };
  }

  private async readCache(cacheKey: string): Promise<FaqConfig | null> {
    if (!this.redisService) return null;
    try {
      return await this.redisService.get<FaqConfig>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `FAQ cache read failed for ${cacheKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async writeCache(cacheKey: string, config: FaqConfig): Promise<void> {
    if (!this.redisService) return;
    try {
      await this.redisService.set(cacheKey, config, FAQ_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `FAQ cache write failed for ${cacheKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
