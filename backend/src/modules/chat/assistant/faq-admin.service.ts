import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import type { AuthenticatedUser } from "../../auth/auth-user";
import { FaqService, type FaqConfig } from "./faq.service";
import {
  BANK_ACCOUNT_REQUIRED_PARAMS,
  FAQ_SEED_ITEMS,
  type FaqSeedItem,
} from "./faq-defaults";
import { UpdateFaqItemDto } from "./dto/update-faq-item.dto";

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const BANK_ACCOUNT_KEY = "bank_account";

/**
 * Che số tài khoản trong audit: giữ tối đa 4 ký tự cuối, phần còn lại thay
 * bằng `*`. STK ngắn hơn 4 ký tự bị che toàn bộ.
 */
export function maskAccountNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "*".repeat(trimmed.length);
  return `${"*".repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

export type FaqAdminItem = FaqConfig & {
  /** Đã có row trong `faq_items` hay chỉ là placeholder lấy từ seed. */
  exists: boolean;
  /** Các field còn thiếu để có thể bật FAQ (dạng `key.param`). */
  missingKeys: string[];
  updatedAt: string | null;
  updatedBy: string | null;
};

type FaqRow = {
  id: string;
  key: string;
  intent: string;
  answerTemplate: string;
  requiredParams: unknown;
  values: unknown;
  notApplicable: boolean;
  notApplicableReply: string | null;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: Date;
};

const SEED_BY_KEY = new Map<string, FaqSeedItem>(
  FAQ_SEED_ITEMS.map((item) => [item.key, item]),
);

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameRecord(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * Đọc/ghi cấu hình FAQ cho manager/admin.
 *
 * Nguyên tắc:
 * - GET chỉ đọc, ghép seed placeholder với row DB, KHÔNG tự ghi seed.
 * - PUT chỉ cho phép key đã biết trong seed, merge với cấu hình hiện tại,
 *   chặn bật FAQ khi còn thiếu giá trị.
 * - Nhóm ngân hàng/STK bắt buộc `confirm` và ghi audit với tên field thay
 *   đổi (không ghi giá trị thật).
 * - Sau khi lưu, cache `chat:faq:<key>` bị xoá để lượt trả lời kế tiếp đọc
 *   cấu hình mới.
 */
@Injectable()
export class FaqAdminService {
  private readonly logger = new Logger(FaqAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly faqService: FaqService,
  ) {}

  async list(): Promise<FaqAdminItem[]> {
    const rows = await this.prisma.faqItem.findMany({
      orderBy: { key: "asc" },
    });
    const rowByKey = new Map(rows.map((row) => [row.key, row as FaqRow]));

    const items: FaqAdminItem[] = FAQ_SEED_ITEMS.map((seed) => {
      const row = rowByKey.get(seed.key);
      return row
        ? this.toItem(this.faqService.toConfig(row), row)
        : this.seedItem(seed);
    });

    // Row ngoài seed (nếu được thêm thủ công) vẫn hiển thị để không "biến
    // mất" cấu hình, nhưng PUT sẽ từ chối vì không nằm trong danh sách key.
    for (const row of rows) {
      if (!SEED_BY_KEY.has(row.key)) {
        items.push(this.toItem(this.faqService.toConfig(row as FaqRow), row as FaqRow));
      }
    }

    return items;
  }

  async update(
    key: string,
    actor: AuthenticatedUser,
    dto: UpdateFaqItemDto,
  ): Promise<FaqAdminItem> {
    const seed = SEED_BY_KEY.get(key);
    if (!seed) {
      throw new NotFoundException(`Unknown FAQ key: ${key}`);
    }

    const row = (await this.prisma.faqItem.findUnique({
      where: { key },
    })) as FaqRow | null;

    const current = row ? this.faqService.toConfig(row) : this.fromSeed(seed);
    const next = this.merge(current, dto);
    this.validate(next);

    const changedFields = this.diff(current, next);
    if (changedFields.length === 0) {
      return this.toItem(next, row);
    }

    if (key === BANK_ACCOUNT_KEY && dto.confirm !== true) {
      throw new BadRequestException(
        "Thay đổi thông tin ngân hàng/số tài khoản cần xác nhận (confirm = true).",
      );
    }

    const changedAt = new Date();
    const saved = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.faqItem.upsert({
        where: { key },
        create: {
          key,
          intent: next.intent,
          answerTemplate: next.answerTemplate,
          requiredParams: next.requiredParams as Prisma.InputJsonValue,
          values: next.values as Prisma.InputJsonValue,
          notApplicable: next.notApplicable,
          notApplicableReply: next.notApplicableReply,
          isActive: next.isActive,
          updatedBy: actor.id,
        },
        update: {
          intent: next.intent,
          answerTemplate: next.answerTemplate,
          requiredParams: next.requiredParams as Prisma.InputJsonValue,
          values: next.values as Prisma.InputJsonValue,
          notApplicable: next.notApplicable,
          notApplicableReply: next.notApplicableReply,
          isActive: next.isActive,
          updatedBy: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action:
            key === BANK_ACCOUNT_KEY ? "FAQ_BANK_ACCOUNT_UPDATE" : "FAQ_UPDATE",
          entityType: "faq_item",
          entityId: upserted.id,
          // Chỉ tên field + giá trị đã che cho nhóm thanh toán. Không bao giờ
          // ghi full số tài khoản/STK vào audit.
          metadata: {
            key,
            changedFields,
            changedBy: actor.id,
            changedAt: changedAt.toISOString(),
            ...(key === BANK_ACCOUNT_KEY
              ? {
                  masked: {
                    account_number: maskAccountNumber(
                      next.values.account_number ?? "",
                    ),
                  },
                }
              : {}),
          },
        },
      });

      return upserted as FaqRow;
    });

    try {
      await this.faqService.invalidate(key);
    } catch (error) {
      this.logger.warn(
        `Could not invalidate FAQ cache for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.toItem(next, saved);
  }

  private merge(current: FaqConfig, dto: UpdateFaqItemDto): FaqConfig {
    const intent =
      dto.intent === undefined ? current.intent : dto.intent.trim();
    if (!intent) {
      throw new BadRequestException("intent cannot be empty.");
    }

    const answerTemplate =
      dto.answerTemplate === undefined
        ? current.answerTemplate
        : dto.answerTemplate;

    const requiredParams =
      dto.requiredParams === undefined
        ? current.requiredParams
        : [...new Set(dto.requiredParams.map((param) => param.trim()))].filter(
            (param) => param !== "",
          );

    const values =
      dto.values === undefined
        ? { ...current.values }
        : { ...current.values, ...this.readValues(dto.values) };

    const notApplicable = dto.notApplicable ?? current.notApplicable;
    const notApplicableReply =
      dto.notApplicableReply === undefined
        ? current.notApplicableReply
        : dto.notApplicableReply.trim() || null;

    return {
      key: current.key,
      intent,
      answerTemplate,
      requiredParams,
      values: this.pickKnownValues(
        values,
        requiredParams,
        answerTemplate,
        current.key,
      ),
      notApplicable,
      notApplicableReply,
      isActive: dto.isActive ?? current.isActive,
    };
  }

  private readValues(raw: Record<string, unknown>): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (value === null || value === undefined) {
        values[name] = "";
        continue;
      }
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new BadRequestException(`FAQ value '${name}' must be a string.`);
      }
      values[name] = String(value).trim();
    }
    return values;
  }

  private pickKnownValues(
    values: Record<string, string>,
    requiredParams: string[],
    template: string,
    key: string,
  ): Record<string, string> {
    const allowed = new Set<string>(requiredParams);
    for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
      if (match[1]) allowed.add(match[1]);
    }
    if (key === BANK_ACCOUNT_KEY) {
      for (const required of BANK_ACCOUNT_REQUIRED_PARAMS) allowed.add(required);
    }

    const unknown = Object.keys(values).filter((name) => !allowed.has(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown FAQ value key(s): ${unknown.join(", ")}`,
      );
    }

    const result: Record<string, string> = {};
    for (const name of allowed) {
      result[name] = values[name] ?? "";
    }
    return result;
  }

  private validate(config: FaqConfig): void {
    if (config.notApplicable) {
      if (!config.notApplicableReply?.trim()) {
        throw new BadRequestException(
          "notApplicableReply is required when notApplicable is true.",
        );
      }
      // Câu trả lời "không áp dụng" không dùng placeholder nên có thể bật
      // ngay cả khi chưa nhập values.
      return;
    }

    if (config.isActive) {
      const snapshot = this.faqService.inspect(config);
      if (snapshot && snapshot.missingKeys.length > 0) {
        throw new BadRequestException(
          `Cannot activate FAQ '${config.key}' while values are missing: ${snapshot.missingKeys.join(
            ", ",
          )}`,
        );
      }
    }
  }

  private diff(current: FaqConfig, next: FaqConfig): string[] {
    const changed: string[] = [];
    if (current.intent !== next.intent) changed.push("intent");
    if (current.answerTemplate !== next.answerTemplate) {
      changed.push("answerTemplate");
    }
    if (!sameArray(current.requiredParams, next.requiredParams)) {
      changed.push("requiredParams");
    }
    if (!sameRecord(current.values, next.values)) changed.push("values");
    if (current.notApplicable !== next.notApplicable) {
      changed.push("notApplicable");
    }
    if (
      (current.notApplicableReply ?? null) !==
      (next.notApplicableReply ?? null)
    ) {
      changed.push("notApplicableReply");
    }
    if (current.isActive !== next.isActive) changed.push("isActive");
    return changed;
  }

  private fromSeed(seed: FaqSeedItem): FaqConfig {
    return {
      key: seed.key,
      intent: seed.intent,
      answerTemplate: seed.answerTemplate,
      requiredParams: [...seed.requiredParams],
      values: { ...seed.values },
      notApplicable: false,
      notApplicableReply: null,
      isActive: seed.isActive,
    };
  }

  private seedItem(seed: FaqSeedItem): FaqAdminItem {
    return this.toItem(this.fromSeed(seed), null);
  }

  private toItem(config: FaqConfig, row: FaqRow | null): FaqAdminItem {
    const snapshot = this.faqService.inspect(config);
    return {
      ...config,
      exists: Boolean(row),
      missingKeys: snapshot?.missingKeys ?? [],
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    };
  }
}
