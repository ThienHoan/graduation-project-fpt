import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, price_rule_type, price_rules } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreatePriceRuleDto, UpdatePriceRuleDto } from "./dto/price-rule.dto";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Độ ưu tiên mặc định khi nhiều rule cùng khớp 1 ngày:
 * Tết > Ngày lễ > Chương trình cửa hàng > Sale đôi > Mùa cao điểm > Cuối tuần > Giá mặc định.
 * Chủ cửa hàng có thể ghi đè bằng cột `priority`.
 */
export const DEFAULT_RULE_PRIORITY: Record<price_rule_type, number> = {
  tet: 100,
  holiday: 80,
  store_program: 70,
  double_sale: 60,
  peak_season: 50,
  weekend: 40,
};

export const RULE_TYPE_LABELS: Record<price_rule_type, string> = {
  tet: "Tết",
  holiday: "Ngày lễ",
  store_program: "Chương trình cửa hàng",
  double_sale: "Sale đôi",
  peak_season: "Mùa cao điểm",
  weekend: "Cuối tuần",
};

export type AppliedPriceRule = {
  id: string;
  name: string;
  ruleType: price_rule_type;
  percentage: number | null;
  fixedAmount: number | null;
  priority: number;
};

export type SizePriceTarget = {
  sizeId: string;
  garmentId: string;
  categoryId: string | null;
  basePrice: number;
  /** Giá chốt thủ công (price_periods đã duyệt) — thắng mọi rule tự động trong ngày đó */
  overrides?: Array<{ from: Date; to: Date; price: number }>;
};

export type DailyPriceBreakdown = {
  date: string;
  price: number;
  rule: AppliedPriceRule | null;
};

export type SizeRentalQuote = {
  sizeId: string;
  basePrice: number;
  /** Giá/ngày bình quân sau khi áp rule (= discountPrice) */
  discountPrice: number;
  rentalTotal: number;
  days: number;
  /** Rule chiếm nhiều ngày nhất trong khoảng thuê (null nếu toàn giá gốc) */
  appliedPriceRule: AppliedPriceRule | null;
  /** Mọi rule đã áp dụng + số ngày */
  appliedRules: Array<AppliedPriceRule & { days: number }>;
  breakdown: DailyPriceBreakdown[];
};

@Injectable()
export class PriceRulesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async list(opts: { activeOnly?: boolean; ruleType?: string } = {}) {
    const where: Prisma.price_rulesWhereInput = {};
    if (opts.activeOnly) where.is_active = true;
    if (opts.ruleType) where.rule_type = opts.ruleType as price_rule_type;
    const rules = await this.prisma.price_rules.findMany({
      where,
      orderBy: [{ priority: "desc" }, { created_at: "desc" }],
    });
    return ok(rules.map((r) => this.serialize(r)));
  }

  async findOne(id: string) {
    const rule = await this.prisma.price_rules.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Không tìm thấy luật giá.");
    return ok(this.serialize(rule));
  }

  async create(dto: CreatePriceRuleDto) {
    const data = this.toData(dto, true);
    const rule = await this.prisma.price_rules.create({ data: data as Prisma.price_rulesCreateInput });
    return ok(this.serialize(rule), "Đã tạo luật giá.");
  }

  async update(id: string, dto: UpdatePriceRuleDto) {
    const existing = await this.prisma.price_rules.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Không tìm thấy luật giá.");
    const merged = { ...this.serializeToDto(existing), ...dto } as CreatePriceRuleDto;
    this.toData(merged, true); // validate tổng thể
    const data = this.toData(dto, false);
    const rule = await this.prisma.price_rules.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
    });
    return ok(this.serialize(rule), "Đã cập nhật luật giá.");
  }

  async toggle(id: string, isActive: boolean) {
    const rule = await this.prisma.price_rules
      .update({ where: { id }, data: { is_active: isActive, updated_at: new Date() } })
      .catch(() => {
        throw new NotFoundException("Không tìm thấy luật giá.");
      });
    return ok(this.serialize(rule));
  }

  async remove(id: string) {
    await this.prisma.price_rules.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Không tìm thấy luật giá.");
    });
    return ok({ id }, "Đã xoá luật giá.");
  }

  // ── Tính giá ────────────────────────────────────────────────────────────

  /** Rule đang active có thể giao với khoảng [from, to]. Lọc ngày cụ thể ở `matchesDay`. */
  async loadActiveRules(from: Date, to: Date): Promise<price_rules[]> {
    return this.prisma.price_rules.findMany({
      where: {
        is_active: true,
        OR: [
          { recurring_yearly: true },
          {
            AND: [
              { OR: [{ start_date: null }, { start_date: { lte: to } }] },
              { OR: [{ end_date: null }, { end_date: { gte: from } }] },
            ],
          },
        ],
      },
    });
  }

  matchesDay(rule: price_rules, day: Date, target: Pick<SizePriceTarget, "garmentId" | "categoryId">): boolean {
    if (rule.garment_ids.length > 0 || rule.category_ids.length > 0) {
      const inGarment = rule.garment_ids.includes(target.garmentId);
      const inCategory = !!target.categoryId && rule.category_ids.includes(target.categoryId);
      if (!inGarment && !inCategory) return false;
    }

    if (rule.days_of_week.length > 0 && !rule.days_of_week.includes(day.getUTCDay())) return false;

    if (rule.recurring_yearly && rule.start_date && rule.end_date) {
      const md = (d: Date) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      const cur = md(day);
      const s = md(rule.start_date);
      const e = md(rule.end_date);
      // Khoảng có thể vắt qua năm mới (vd. 25/12 → 05/01)
      return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
    }

    if (rule.start_date && day < rule.start_date) return false;
    if (rule.end_date && day > rule.end_date) return false;
    return true;
  }

  /** Rule thắng cho 1 ngày: priority cao nhất, hoà thì rule tạo sau thắng. */
  pickRule(rules: price_rules[], day: Date, target: SizePriceTarget): price_rules | null {
    let best: price_rules | null = null;
    for (const r of rules) {
      if (!this.matchesDay(r, day, target)) continue;
      if (
        !best ||
        r.priority > best.priority ||
        (r.priority === best.priority && r.created_at > best.created_at)
      ) {
        best = r;
      }
    }
    return best;
  }

  applyRule(basePrice: number, rule: price_rules | null): number {
    if (!rule) return basePrice;
    let price = basePrice;
    if (rule.percentage != null) price = price * (1 + Number(rule.percentage) / 100);
    if (rule.fixed_amount != null) price = price + Number(rule.fixed_amount);
    // Làm tròn 1.000đ, không âm
    return Math.max(0, Math.round(price / 1000) * 1000);
  }

  /**
   * Báo giá thuê cho từng size theo TỪNG NGÀY trong khoảng [startDay, endDay].
   * Giá gốc không bị sửa; mỗi ngày áp tối đa 1 rule (ưu tiên cao nhất).
   */
  async quote(targets: SizePriceTarget[], startDay: Date, endDay: Date): Promise<Map<string, SizeRentalQuote>> {
    const rules = await this.loadActiveRules(startDay, endDay);
    const result = new Map<string, SizeRentalQuote>();

    const dayList: Date[] = [];
    for (let t = startDay.getTime(); t <= endDay.getTime(); t += MS_PER_DAY) dayList.push(new Date(t));

    for (const target of targets) {
      if (result.has(target.sizeId)) continue;
      const breakdown: DailyPriceBreakdown[] = [];
      const usage = new Map<string, { rule: AppliedPriceRule; days: number }>();
      let total = 0;
      for (const day of dayList) {
        const override = target.overrides?.find((o) => o.from <= day && o.to >= day);
        const rule = override ? null : this.pickRule(rules, day, target);
        const price = override ? override.price : this.applyRule(target.basePrice, rule);
        const applied: AppliedPriceRule | null = override
          ? {
              id: "manual",
              name: "Giá điều chỉnh thủ công",
              ruleType: "store_program",
              percentage: null,
              fixedAmount: null,
              priority: Number.MAX_SAFE_INTEGER,
            }
          : rule
            ? this.toApplied(rule)
            : null;
        if (applied) {
          const u = usage.get(applied.id) ?? { rule: applied, days: 0 };
          u.days += 1;
          usage.set(applied.id, u);
        }
        breakdown.push({ date: day.toISOString().slice(0, 10), price, rule: applied });
        total += price;
      }
      const appliedRules = [...usage.values()]
        .sort((a, b) => b.days - a.days || b.rule.priority - a.rule.priority)
        .map((u) => ({ ...u.rule, days: u.days }));
      const days = dayList.length || 1;
      result.set(target.sizeId, {
        sizeId: target.sizeId,
        basePrice: target.basePrice,
        discountPrice: Math.round(total / days),
        rentalTotal: total,
        days,
        appliedPriceRule: appliedRules[0]
          ? (({ days: _d, ...r }) => r)(appliedRules[0])
          : null,
        appliedRules,
        breakdown,
      });
    }
    return result;
  }

  /** Giá hiệu lực của nhiều size cho 1 ngày (dùng hiển thị giá hôm nay trên catalog). */
  async priceOnDay(targets: SizePriceTarget[], day: Date): Promise<Map<string, SizeRentalQuote>> {
    return this.quote(targets, day, day);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private toApplied(rule: price_rules): AppliedPriceRule {
    return {
      id: rule.id,
      name: rule.name,
      ruleType: rule.rule_type,
      percentage: rule.percentage != null ? Number(rule.percentage) : null,
      fixedAmount: rule.fixed_amount != null ? Number(rule.fixed_amount) : null,
      priority: rule.priority,
    };
  }

  private toData(dto: Partial<CreatePriceRuleDto>, validate: boolean) {
    const date = (v?: string | null) => (v ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : null);
    if (validate) {
      if (
        (dto.percentage == null || dto.percentage === 0) &&
        (dto.fixedAmount == null || dto.fixedAmount === 0)
      ) {
        throw new BadRequestException("Cần nhập phần trăm hoặc số tiền điều chỉnh.");
      }
      const s = date(dto.startDate);
      const e = date(dto.endDate);
      if (!dto.recurringYearly && s && e && s > e) {
        throw new BadRequestException("Ngày bắt đầu phải trước ngày kết thúc.");
      }
      if (dto.recurringYearly && (!s || !e)) {
        throw new BadRequestException("Rule lặp hằng năm cần có ngày bắt đầu và kết thúc.");
      }
      if (dto.ruleType !== "weekend" && !dto.daysOfWeek?.length && !s && !e) {
        throw new BadRequestException("Cần chọn khoảng ngày áp dụng.");
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.ruleType !== undefined) {
      data.rule_type = dto.ruleType;
      if (validate && dto.priority === undefined) data.priority = DEFAULT_RULE_PRIORITY[dto.ruleType];
    }
    if (dto.startDate !== undefined) data.start_date = date(dto.startDate);
    if (dto.endDate !== undefined) data.end_date = date(dto.endDate);
    if (dto.recurringYearly !== undefined) data.recurring_yearly = dto.recurringYearly;
    if (dto.daysOfWeek !== undefined)
      data.days_of_week = dto.daysOfWeek ?? (dto.ruleType === "weekend" ? [0, 6] : []);
    else if (validate && dto.ruleType === "weekend") data.days_of_week = [0, 6];
    if (dto.percentage !== undefined) data.percentage = dto.percentage;
    if (dto.fixedAmount !== undefined) data.fixed_amount = dto.fixedAmount;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.categoryIds !== undefined) data.category_ids = dto.categoryIds;
    if (dto.garmentIds !== undefined) data.garment_ids = dto.garmentIds;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (dto.note !== undefined) data.note = dto.note;
    return data;
  }

  private serializeToDto(r: price_rules): CreatePriceRuleDto {
    return {
      name: r.name,
      ruleType: r.rule_type,
      startDate: r.start_date?.toISOString().slice(0, 10) ?? null,
      endDate: r.end_date?.toISOString().slice(0, 10) ?? null,
      recurringYearly: r.recurring_yearly,
      daysOfWeek: r.days_of_week,
      percentage: r.percentage != null ? Number(r.percentage) : null,
      fixedAmount: r.fixed_amount != null ? Number(r.fixed_amount) : null,
      priority: r.priority,
    };
  }

  serialize(r: price_rules) {
    return {
      id: r.id,
      name: r.name,
      ruleType: r.rule_type,
      ruleTypeLabel: RULE_TYPE_LABELS[r.rule_type],
      startDate: r.start_date?.toISOString().slice(0, 10) ?? null,
      endDate: r.end_date?.toISOString().slice(0, 10) ?? null,
      recurringYearly: r.recurring_yearly,
      daysOfWeek: r.days_of_week,
      percentage: r.percentage != null ? Number(r.percentage) : null,
      fixedAmount: r.fixed_amount != null ? Number(r.fixed_amount) : null,
      priority: r.priority,
      categoryIds: r.category_ids,
      garmentIds: r.garment_ids,
      isActive: r.is_active,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
