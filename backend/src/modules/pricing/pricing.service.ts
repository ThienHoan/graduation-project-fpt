import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, AssetStatus, BookingStatus } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import type { CreatePriceCalendarDto } from "./dto/create-price-calendar.dto";
import type { CreateSuggestionDto } from "./dto/create-suggestion.dto";
import type { UpdatePriceCalendarDto } from "./dto/update-price-calendar.dto";
import type { UpdateSuggestionPriceDto } from "./dto/update-suggestion-price.dto";
import type { GenerateSuggestionsDto } from "./dto/generate-suggestions.dto";
import type { BulkSuggestionActionDto } from "./dto/bulk-suggestion-action.dto";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Các trạng thái booking không còn giữ hàng (không tính vào "committed" khi đo nhu cầu)
const RELEASED_STATUSES: BookingStatus[] = [
  BookingStatus.cancelled,
  BookingStatus.rejected,
  BookingStatus.refund_pending,
  BookingStatus.completed,
  BookingStatus.returned,
  BookingStatus.inspection_pending,
];

const USABLE_ASSET_STATUSES: AssetStatus[] = [
  AssetStatus.available,
  AssetStatus.reserved,
  AssetStatus.rented,
];

const VELOCITY_RECENT_DAYS = 7;
const VELOCITY_BASELINE_WEEKS = 4;

const OCCASION_TYPE_VALUES = ["holiday", "occasion", "peak_season", "off_season"] as const;
type OccasionType = (typeof OCCASION_TYPE_VALUES)[number];

// Từ khóa để search loại sự kiện theo tiếng Việt (giá trị lưu DB là enum tiếng Anh).
const OCCASION_SEARCH_TERMS: Array<{ type: OccasionType; terms: string[] }> = [
  { type: "holiday", terms: ["holiday", "lễ", "ngày lễ", "tết"] },
  { type: "occasion", terms: ["occasion", "dịp", "sự kiện đặc biệt"] },
  { type: "peak_season", terms: ["peak_season", "cao điểm", "mùa cao điểm"] },
  { type: "off_season", terms: ["off_season", "thấp điểm", "mùa thấp điểm"] },
];

type PricingConfig = {
  absMinPerDay: number;
  targetRentalDays: number;
  maxUpliftPct: number;
  failFast: boolean;
};

type PriceBounds = {
  sizeId: string;
  basePrice: number;
  garmentFloorCost: number | null;
  minPrice: number;
  maxPrice: number;
};

type AiAdjustmentInput = {
  garmentName: string;
  basePrice: number;
  purchaseCost: number;
  demandPressure: number;
  bookingPressure: number;
  holidays: Array<{
    name: string;
    adjustmentPercent: number;
    occasionType: string;
  }>;
  fromDate: string;
  toDate: string;
};

type AiAdjustmentOutput = {
  recommendedAdjustmentPct: number;
  demandPressure?: number;
  bookingPressure?: number;
  confidence?: number;
  reason?: {
    demand?: string;
    booking?: string;
    inventory?: string;
    holiday?: string;
    season?: string;
  };
};

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Settings ───────────────────────────────────────────────────────────────

  private async getSettingNumber(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const raw = (row?.value as { value?: unknown } | null)?.value ?? row?.value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  private async getSettingBoolean(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const raw = (row?.value as { value?: unknown } | null)?.value ?? row?.value;
    return typeof raw === "boolean" ? raw : fallback;
  }

  private async loadConfig(): Promise<PricingConfig> {
    const [absMinPerDay, targetRentalDays, maxUpliftPct, failFast] = await Promise.all([
      this.getSettingNumber("pricing_abs_min_per_day", 0),
      this.getSettingNumber("pricing_target_rental_days", 30),
      this.getSettingNumber("pricing_max_uplift_pct", 50),
      this.getSettingBoolean("pricing_fail_fast_per_round", false),
    ]);

    if (!Number.isFinite(targetRentalDays) || targetRentalDays <= 0) {
      throw new BadRequestException(
        "Cấu hình pricing_target_rental_days phải là số dương. Hãy sửa trong Settings trước khi chạy pricing.",
      );
    }
    if (!Number.isFinite(maxUpliftPct) || maxUpliftPct < 0) {
      throw new BadRequestException(
        "Cấu hình pricing_max_uplift_pct phải >= 0. Hãy sửa trong Settings trước khi chạy pricing.",
      );
    }

    return { absMinPerDay, targetRentalDays, maxUpliftPct, failFast };
  }

  // ── Helpers tính toán ──────────────────────────────────────────────────────

  private dayUtc(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private matchesKeywords(description: string | null | undefined, keywords: string[]): boolean {
    if (!keywords || keywords.length === 0) return false;
    const text = (description ?? "").toLowerCase();
    return keywords.some((k) => k && text.includes(k.toLowerCase()));
  }

  /**
   * Giá vốn cấp garment = MAX(purchase_cost) trong các asset khả dụng
   * (available / reserved / rented). NULL hoặc <= 0 => không có sàn.
   */
  private async computeGarmentFloorCost(garmentId: string): Promise<number | null> {
    const agg = await this.prisma.garmentAsset.aggregate({
      where: {
        garmentId,
        status: { in: USABLE_ASSET_STATUSES },
        purchaseCost: { not: null },
      },
      _max: { purchaseCost: true },
    });
    const maxCost = Number(agg._max.purchaseCost ?? 0);
    return maxCost > 0 ? maxCost : null;
  }

  private async computeBounds(
    sizeId: string,
    config: PricingConfig,
  ): Promise<PriceBounds & { name: string; sizeLabel: string | null; description: string | null; garmentId: string }> {
    const size = await this.prisma.garment_sizes.findUnique({
      where: { id: sizeId },
      include: { garments: { select: { id: true, name: true, description: true } } },
    });
    if (!size) throw new NotFoundException("Garment size not found.");

    const basePrice = Number(size.daily_price ?? 0);
    const garmentFloorCost = await this.computeGarmentFloorCost(size.garment_id);
    const recoveryMin = garmentFloorCost
      ? garmentFloorCost / Math.max(1, config.targetRentalDays)
      : 0;
    const minPrice = Math.max(config.absMinPerDay, recoveryMin);
    const maxPrice = basePrice * (1 + config.maxUpliftPct / 100);

    return {
      sizeId,
      sizeLabel: size.size_label,
      basePrice,
      garmentFloorCost,
      minPrice: this.round2(minPrice),
      maxPrice: this.round2(maxPrice),
      name: size.garments.name,
      description: size.garments.description,
      garmentId: size.garments.id,
    };
  }

  private validateBounds(bounds: PriceBounds): string[] {
    const errors: string[] = [];
    if (bounds.garmentFloorCost === null) {
      errors.push("Thiếu giá nhập / giá vốn không hợp lệ (chưa khai purchase_cost cho asset khả dụng).");
    }
    if (bounds.basePrice < bounds.minPrice) {
      errors.push(
        `Giá cơ sở (${bounds.basePrice.toLocaleString("vi-VN")}đ) thấp hơn giá sàn (${bounds.minPrice.toLocaleString("vi-VN")}đ). Hãy sửa giá cơ sở hoặc giá vốn để đạt base >= min.`,
      );
    }
    if (bounds.minPrice > bounds.maxPrice) {
      errors.push(
        `Giá sàn (${bounds.minPrice.toLocaleString("vi-VN")}đ) vượt trần tăng (${bounds.maxPrice.toLocaleString("vi-VN")}đ). Kiểm tra base_price / purchase_cost / target_rental_days cho size này.`,
      );
    }
    return errors;
  }

  /**
   * Nhu cầu của một size trong khoảng [from, to]: số booking item đang giữ hàng
   * trùng ngày so với sức chứa asset (chưa retired/lost).
   */
  private async computeWindowLoad(sizeId: string, from: Date, to: Date) {
    const capacity = await this.prisma.garmentAsset.count({
      where: {
        garment_size_id: sizeId,
        status: { notIn: [AssetStatus.retired, AssetStatus.lost] },
      },
    });
    const committed = await this.prisma.bookingItem.count({
      where: {
        garment_size_id: sizeId,
        booking: {
          status: { notIn: RELEASED_STATUSES },
          rentalStartDate: { lte: to },
          rentalEndDate: { gte: from },
        },
      },
    });
    const unreserved = Math.max(0, capacity - committed);
    return { capacity, committed, unreserved };
  }

  /**
   * Booking velocity của một size: số booking bắt đầu trong 7 ngày gần nhất
   * so với trung bình mỗi tuần của 4 tuần trước đó.
   * demandPressure = clamp(recent / baseline - 1, -1, +1).
   */
  private async computeDemandVelocity(sizeId: string) {
    const now = new Date();
    const recentStart = this.dayUtc(new Date(now.getTime() - VELOCITY_RECENT_DAYS * MS_PER_DAY));
    const baselineStart = this.dayUtc(new Date(now.getTime() - (VELOCITY_RECENT_DAYS + VELOCITY_BASELINE_WEEKS * 7) * MS_PER_DAY));

    const countByStart = (gte: Date, lt: Date) =>
      this.prisma.bookingItem.count({
        where: {
          garment_size_id: sizeId,
          booking: {
            status: { notIn: RELEASED_STATUSES },
            rentalStartDate: { gte, lt },
          },
        },
      });

    const [recent, baselineTotal] = await Promise.all([
      countByStart(recentStart, now),
      countByStart(baselineStart, recentStart),
    ]);
    const baselinePerWeek = baselineTotal / VELOCITY_BASELINE_WEEKS;

    let demandRatio: number;
    if (baselinePerWeek > 0) {
      demandRatio = recent / baselinePerWeek;
    } else {
      demandRatio = recent > 0 ? 2 : 1;
    }
    const demandPressure = this.round2(Math.max(-1, Math.min(1, demandRatio - 1)));
    return { recent, baselinePerWeek, demandRatio, demandPressure };
  }

  private async buildSignals(
    bounds: Awaited<ReturnType<typeof PricingService.prototype.computeBounds>>,
    fromDate: Date,
    toDate: Date,
  ) {
    const { capacity, committed, unreserved } = await this.computeWindowLoad(bounds.sizeId, fromDate, toDate);
    const bookingPressure = capacity > 0 ? Math.max(0, 1 - unreserved / capacity) : 0;
    const velocity = await this.computeDemandVelocity(bounds.sizeId);

    const events = await this.prisma.price_calendar.findMany({
      where: {
        is_active: true,
        from_date: { lte: toDate },
        to_date: { gte: fromDate },
      },
    });
    const holidays = events
      .filter((e) => this.matchesKeywords(bounds.description, e.garment_keywords))
      .map((e) => ({
        name: e.name,
        adjustmentPercent: e.adjustment_percent,
        occasionType: e.occasion_type,
      }));

    return {
      basePrice: bounds.basePrice,
      purchaseCost: bounds.garmentFloorCost ?? 0,
      capacity,
      committed,
      unreserved,
      demandPressure: velocity.demandPressure,
      bookingPressure: this.round2(bookingPressure),
      holidays,
    };
  }

  // ── AI: chỉ trả % điều chỉnh, backend là source of truth ──────────────────

  private fallbackAdjustment(input: AiAdjustmentInput): AiAdjustmentOutput {
    const holidayPct = input.holidays.reduce((sum, h) => sum + h.adjustmentPercent, 0);
    const demandPct = Math.round(input.demandPressure * 20);
    const bookingPct = Math.round(input.bookingPressure * 15);
    const recommendedAdjustmentPct = holidayPct + demandPct + bookingPct;
    return {
      recommendedAdjustmentPct,
      demandPressure: input.demandPressure,
      bookingPressure: input.bookingPressure,
      confidence: 0.5,
      reason: {
        holiday: `${holidayPct}%`,
        demand: `${demandPct >= 0 ? "+" : ""}${demandPct}%`,
        booking: `+${bookingPct}%`,
        season: "0%",
      },
    };
  }

  private async callAdjustmentAI(input: AiAdjustmentInput): Promise<AiAdjustmentOutput> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      this.logger.warn("OPENROUTER_API_KEY chưa cấu hình — dùng bộ tính mặc định (không gọi AI).");
      return this.fallbackAdjustment(input);
    }

    const model = process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini";
    const systemPrompt = [
      "Bạn là chuyên gia định giá cho cửa hàng cho thuê áo dài và trang phục truyền thống Việt Nam.",
      "Bạn NHẬN ĐẦU VÀO là dữ liệu kinh doanh (giá gốc, giá vốn, nhu cầu, tồn kho, dịp lễ).",
      "Bạn CHỈ trả về MỨC ĐIỀU CHỈNH TƯƠNG ĐỐI (phần trăm) so với giá gốc, KHÔNG bao giờ trả giá tiền tuyệt đối.",
      "demandPressure là tốc độ đặt thuê gần đây so với trung bình: -1 = giảm mạnh, 0 = bình thường, +1 = tăng gấp đôi. Giá có thể giảm khi demandPressure âm.",
      "bookingPressure là mức kín chỗ của kỳ sự kiện do booking đặt trước: 0 = còn trống, 1 = kín sạch.",
      "Gợi ý hợp lý: tổng hợp các yếu tố dịp lễ + nhu cầu + đặt trước, giữ mức cân bằng, tránh tăng quá gắt.",
      "Trả về JSON hợp lệ, không markdown, không giải thích thêm, đúng format:",
      '{"recommendedAdjustmentPct": 18, "demandPressure": 0.8, "bookingPressure": 0.8, "confidence": 0.87, "reason": {"demand": "+10%", "booking": "+5%", "holiday": "+3%", "season": "0%"}}',
    ].join("\n");

    const userContent = JSON.stringify({
      garmentName: input.garmentName,
      basePrice: input.basePrice,
      purchaseCost: input.purchaseCost,
      demandPressure: input.demandPressure,
      bookingPressure: input.bookingPressure,
      holidays: input.holidays,
      window: { fromDate: input.fromDate, toDate: input.toDate },
    });

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: 300,
          response_format: { type: "json_object" },
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        this.logger.error(`OpenRouter pricing HTTP ${res.status}: ${text.substring(0, 300)}`);
        return this.fallbackAdjustment(input);
      }

      const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return this.fallbackAdjustment(input);

      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed.recommendedAdjustmentPct !== "number" || Number.isNaN(Number(parsed.recommendedAdjustmentPct))) {
        return this.fallbackAdjustment(input);
      }
      const num = (key: string): number | undefined =>
        typeof parsed[key] === "number" ? (parsed[key] as number) : undefined;
      return {
        recommendedAdjustmentPct: Number(parsed.recommendedAdjustmentPct),
        demandPressure: num("demandPressure") ?? num("demandScore") ?? input.demandPressure,
        bookingPressure:
          num("bookingPressure") ?? num("inventoryPressure") ?? num("inventoryScore") ?? input.bookingPressure,
        confidence: num("confidence"),
        reason: typeof parsed.reason === "object" && parsed.reason !== null ? (parsed.reason as AiAdjustmentOutput["reason"]) : undefined,
      };
    } catch (error) {
      this.logger.error("Lỗi khi gọi OpenRouter pricing:", error instanceof Error ? error.message : String(error));
      return this.fallbackAdjustment(input);
    }
  }

  // ── Calendar CRUD ──────────────────────────────────────────────────────────

  private parseDateStr(value: string, fieldName: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${fieldName} không hợp lệ.`);
    }
    return this.dayUtc(d);
  }

  private serializeCalendar(row: {
    id: string;
    name: string;
    occasion_type: string;
    from_date: Date;
    to_date: Date;
    adjustment_percent: number;
    priority: number;
    garment_keywords: string[];
    is_active: boolean;
    note: string | null;
    created_at: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      occasionType: row.occasion_type,
      fromDate: row.from_date.toISOString().slice(0, 10),
      toDate: row.to_date.toISOString().slice(0, 10),
      adjustmentPercent: row.adjustment_percent,
      priority: row.priority,
      garmentKeywords: row.garment_keywords,
      isActive: row.is_active,
      note: row.note,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listCalendar(options?: {
    activeOnly?: boolean;
    upcoming?: boolean;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const today = this.dayUtc(new Date());
    const page = options?.page ?? 1;
    const limit = Math.min(options?.limit ?? 50, 100);
    const where: Prisma.price_calendarWhereInput = {
      ...(options?.activeOnly ? { is_active: true } : {}),
      ...(options?.upcoming ? { to_date: { gte: today } } : {}),
      ...(options?.search ? { name: { contains: options.search, mode: "insensitive" } } : {}),
      ...(options?.from || options?.to
        ? {
            AND: [
              ...(options?.from ? [{ to_date: { gte: this.parseDateStr(options.from, "from") } }] : []),
              ...(options?.to ? [{ from_date: { lte: this.parseDateStr(options.to, "to") } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.price_calendar.findMany({
        where,
        orderBy: [{ priority: "desc" }, { from_date: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.price_calendar.count({ where }),
    ]);
    return ok({ items: rows.map((r) => this.serializeCalendar(r)), total, page, limit });
  }

  async createCalendar(dto: CreatePriceCalendarDto) {
    const fromDate = this.parseDateStr(dto.fromDate, "fromDate");
    const toDate = this.parseDateStr(dto.toDate, "toDate");
    if (toDate < fromDate) throw new BadRequestException("toDate phải lớn hơn hoặc bằng fromDate.");
    if (!OCCASION_TYPE_VALUES.includes(dto.occasionType as OccasionType)) {
      throw new BadRequestException("occasionType không hợp lệ.");
    }

    const row = await this.prisma.price_calendar.create({
      data: {
        name: dto.name,
        occasion_type: dto.occasionType as OccasionType,
        from_date: fromDate,
        to_date: toDate,
        adjustment_percent: dto.adjustmentPercent ?? 0,
        priority: dto.priority ?? 0,
        garment_keywords: dto.garmentKeywords ?? [],
        is_active: dto.isActive ?? true,
        note: dto.note ?? null,
      },
    });
    return ok(this.serializeCalendar(row));
  }

  async updateCalendar(id: string, dto: UpdatePriceCalendarDto) {
    const existing = await this.prisma.price_calendar.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Price calendar entry not found.");

    const data: Prisma.price_calendarUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.occasionType !== undefined) {
      if (!OCCASION_TYPE_VALUES.includes(dto.occasionType as OccasionType)) {
        throw new BadRequestException("occasionType không hợp lệ.");
      }
      data.occasion_type = dto.occasionType as OccasionType;
    }
    if (dto.adjustmentPercent !== undefined) data.adjustment_percent = dto.adjustmentPercent;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.garmentKeywords !== undefined) data.garment_keywords = dto.garmentKeywords;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (dto.note !== undefined) data.note = dto.note;

    if (dto.fromDate !== undefined || dto.toDate !== undefined) {
      const fromDate = dto.fromDate !== undefined ? this.parseDateStr(dto.fromDate, "fromDate") : this.dayUtc(existing.from_date);
      const toDate = dto.toDate !== undefined ? this.parseDateStr(dto.toDate, "toDate") : this.dayUtc(existing.to_date);
      if (toDate < fromDate) throw new BadRequestException("toDate phải lớn hơn hoặc bằng fromDate.");
      data.from_date = fromDate;
      data.to_date = toDate;
    }

    const row = await this.prisma.price_calendar.update({ where: { id }, data });
    return ok(this.serializeCalendar(row));
  }

  async removeCalendar(id: string) {
    const existing = await this.prisma.price_calendar.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Price calendar entry not found.");
    const row = await this.prisma.price_calendar.update({
      where: { id },
      data: { is_active: false },
    });
    return ok({ id, deactivated: true, calendar: this.serializeCalendar(row) });
  }

  // ── Sinh đề xuất AI ────────────────────────────────────────────────────────

  private async candidateSizeIdsForCalendar(calendarId: string): Promise<string[]> {
    const calendar = await this.prisma.price_calendar.findUnique({ where: { id: calendarId } });
    if (!calendar) throw new NotFoundException("Price calendar entry not found.");

    const sizes = await this.prisma.garment_sizes.findMany({
      where: { is_active: true },
      include: { garments: { select: { description: true } } },
    });
    return sizes
      .filter((s) => this.matchesKeywords(s.garments.description, calendar.garment_keywords))
      .map((s) => s.id);
  }

  /**
   * Chỉ giữ các size có ÍT NHẤT 1 asset đang tồn tại (chưa retired/lost).
   * Size không có asset nào sẽ không được đưa vào sinh đề xuất.
   */
  private async filterSizesWithAssets(sizeIds: string[]): Promise<string[]> {
    if (sizeIds.length === 0) return [];
    const rows = await this.prisma.garmentAsset.groupBy({
      by: ["garment_size_id"],
      where: {
        garment_size_id: { in: sizeIds },
        status: { notIn: [AssetStatus.retired, AssetStatus.lost] },
      },
      _count: { _all: true },
    });
    const withAssets = new Set(rows.map((r) => r.garment_size_id));
    return sizeIds.filter((id) => withAssets.has(id));
  }

  async generateSuggestions(dto: GenerateSuggestionsDto) {
    const config = await this.loadConfig();

    let calendarId: string | null = dto.calendarId ?? null;
    let fromDate: Date;
    let toDate: Date;

    if (calendarId) {
      const calendar = await this.prisma.price_calendar.findUnique({ where: { id: calendarId } });
      if (!calendar) throw new NotFoundException("Price calendar entry not found.");
      fromDate = this.dayUtc(calendar.from_date);
      toDate = this.dayUtc(calendar.to_date);
    } else if (dto.from || dto.to) {
      if (!dto.from || !dto.to) {
        throw new BadRequestException("Phải cung cấp đủ from và to khi không chọn calendarId.");
      }
      fromDate = this.parseDateStr(dto.from, "from");
      toDate = this.parseDateStr(dto.to, "to");
      if (toDate < fromDate) throw new BadRequestException("to phải lớn hơn hoặc bằng from.");
    } else {
      const today = this.dayUtc(new Date());
      fromDate = today;
      toDate = new Date(today.getTime() + 7 * MS_PER_DAY);
    }

    let sizeIds: string[];
    if (dto.sizeIds?.length) {
      sizeIds = dto.sizeIds;
    } else if (calendarId) {
      sizeIds = await this.filterSizesWithAssets(await this.candidateSizeIdsForCalendar(calendarId));
      if (sizeIds.length === 0) {
        return ok({
          generated: 0,
          skipped: [{ note: "Không có garment nào vừa khớp garment_keywords vừa có ít nhất 1 asset tồn tại." }],
          suggestions: [],
        });
      }
    } else {
      const sizes = await this.prisma.garment_sizes.findMany({
        where: { is_active: true },
        select: { id: true },
      });
      sizeIds = await this.filterSizesWithAssets(sizes.map((s) => s.id));
    }

    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);
    const issues: Array<{
      sizeId: string;
      error: string;
      garmentName?: string | null;
      sizeLabel?: string | null;
    }> = [];
    const suggestions: string[] = [];

    for (const sizeId of sizeIds) {
      let bounds: Awaited<ReturnType<typeof PricingService.prototype.computeBounds>>;
      try {
        bounds = await this.computeBounds(sizeId, config);
      } catch {
        issues.push({ sizeId, error: "Không tìm thấy size." });
        continue;
      }

      const errors = this.validateBounds(bounds);
      if (errors.length > 0) {
        if (config.failFast) throw new BadRequestException(errors[0]);
        issues.push({
          sizeId,
          error: errors[0],
          garmentName: bounds.name,
          sizeLabel: bounds.sizeLabel,
        });
        continue;
      }

      const signals = await this.buildSignals(bounds, fromDate, toDate);
      const ai = await this.callAdjustmentAI({
        garmentName: bounds.name,
        basePrice: bounds.basePrice,
        purchaseCost: bounds.garmentFloorCost ?? 0,
        demandPressure: signals.demandPressure,
        bookingPressure: signals.bookingPressure,
        holidays: signals.holidays,
        fromDate: fromStr,
        toDate: toStr,
      });

      const suggestedPrice = bounds.basePrice * (1 + ai.recommendedAdjustmentPct / 100);
      const validPrice = this.round2(Math.min(Math.max(suggestedPrice, bounds.minPrice), bounds.maxPrice));

      const pendingCount = await this.prisma.price_suggestions.count({
        where: {
          garment_size_id: sizeId,
          from_date: fromDate,
          to_date: toDate,
          status: "pending",
        },
      });
      if (pendingCount > 0) {
        issues.push({
          sizeId,
          error: "Đã có đề xuất pending cho cùng khoảng ngày.",
          garmentName: bounds.name,
          sizeLabel: bounds.sizeLabel,
        });
        continue;
      }

      try {
        const suggestion = await this.prisma.price_suggestions.create({
          data: {
            garment_size_id: sizeId,
            calendar_id: calendarId,
            from_date: fromDate,
            to_date: toDate,
            base_price: bounds.basePrice,
            purchase_cost: bounds.garmentFloorCost ?? 0,
            target_rental_days: config.targetRentalDays,
            recommended_adjustment_pct: ai.recommendedAdjustmentPct,
            suggested_price: this.round2(suggestedPrice),
            min_price: bounds.minPrice,
            max_price: bounds.maxPrice,
            valid_price: validPrice,
            demand_score: ai.demandPressure ?? signals.demandPressure,
            booking_score: ai.bookingPressure ?? signals.bookingPressure,
            confidence: ai.confidence ?? null,
            reason_json: (ai.reason ?? {}) as Prisma.InputJsonValue,
            status: "pending",
          },
          select: { id: true },
        });
        suggestions.push(suggestion.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          issues.push({
            sizeId,
            error: "Đã có đề xuất pending cho cùng khoảng ngày.",
            garmentName: bounds.name,
            sizeLabel: bounds.sizeLabel,
          });
        } else {
          throw error;
        }
      }
    }

    return ok({
      generated: suggestions.length,
      skipped: issues,
      suggestions,
      window: { from: fromStr, to: toStr, calendarId },
    });
  }

  // ── List / Approve / Reject ────────────────────────────────────────────────

  private serializeSuggestion(row: Prisma.price_suggestionsGetPayload<{
    include: {
      garment_sizes: { include: { garments: true } };
      price_calendar: true;
    };
  }>) {
    return {
      id: row.id,
      garmentSizeId: row.garment_size_id,
      garmentId: row.garment_sizes?.garment_id ?? null,
      garmentName: row.garment_sizes?.garments?.name ?? null,
      sizeLabel: row.garment_sizes?.size_label ?? null,
      calendarId: row.calendar_id ?? null,
      calendarName: row.price_calendar?.name ?? null,
      fromDate: row.from_date.toISOString().slice(0, 10),
      toDate: row.to_date.toISOString().slice(0, 10),
      basePrice: Number(row.base_price),
      purchaseCost: Number(row.purchase_cost),
      targetRentalDays: row.target_rental_days,
      recommendedAdjustmentPct: Number(row.recommended_adjustment_pct),
      suggestedPrice: Number(row.suggested_price),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      validPrice: Number(row.valid_price),
      demandPressure: row.demand_score === null ? null : Number(row.demand_score),
      bookingPressure: row.booking_score === null ? null : Number(row.booking_score),
      confidence: row.confidence === null ? null : Number(row.confidence),
      reason: row.reason_json ?? {},
      source: row.source,
      status: row.status,
      reviewedBy: row.reviewed_by ?? null,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      appliedAt: row.applied_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listSuggestions(options?: {
    status?: string;
    sizeId?: string;
    calendarId?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const page = options?.page ?? 1;
    const limit = Math.min(options?.limit ?? 50, 100);
    const where: Prisma.price_suggestionsWhereInput = {
      ...(options?.status
        ? { status: options.status as "pending" | "approved" | "rejected" | "deactivated" }
        : {}),
      ...(options?.sizeId ? { garment_size_id: options.sizeId } : {}),
      ...(options?.calendarId ? { calendar_id: options.calendarId } : {}),
      ...(options?.search
        ? {
            OR: [
              { garment_sizes: { garments: { name: { contains: options.search, mode: "insensitive" } } } },
              { garment_sizes: { size_label: { contains: options.search, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(options?.from || options?.to
        ? {
            AND: [
              ...(options?.from ? [{ to_date: { gte: this.parseDateStr(options.from, "from") } }] : []),
              ...(options?.to ? [{ from_date: { lte: this.parseDateStr(options.to, "to") } }] : []),
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.price_suggestions.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          garment_sizes: { include: { garments: true } },
          price_calendar: true,
        },
      }),
      this.prisma.price_suggestions.count({ where }),
    ]);

    return ok({ items: items.map((i) => this.serializeSuggestion(i)), total, page, limit });
  }

  /**
   * Chủ shop tự tạo đề xuất thủ công (không qua AI): chọn 1 hoặc NHIỀU size + khoảng ngày + giá.
   * Mỗi size được tạo 1 suggestion riêng (nguồn = owner => khi duyệt không bị kiểm tra lại min/max).
   */
  async createSuggestion(dto: CreateSuggestionDto) {
    const fromDate = this.dayUtc(new Date(dto.from));
    const toDate = this.dayUtc(new Date(dto.to));
    if (toDate < fromDate) {
      throw new BadRequestException("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
    }
    if (!dto.garmentSizeIds?.length) {
      throw new BadRequestException("Chọn ít nhất 1 size để tạo đề xuất.");
    }

    const config = await this.loadConfig();
    const validPrice = this.round2(dto.validPrice);

    const created: Array<{ id: string }> = [];
    const skipped: Array<{
      sizeId: string;
      name: string | null;
      sizeLabel: string | null;
      error: string;
    }> = [];

    for (const sizeId of dto.garmentSizeIds) {
      let bounds: Awaited<ReturnType<typeof PricingService.prototype.computeBounds>>;
      try {
        bounds = await this.computeBounds(sizeId, config);
      } catch {
        skipped.push({ sizeId, name: null, sizeLabel: null, error: "Không tìm thấy size." });
        continue;
      }
      const basePrice = bounds.basePrice;
      const recommendedAdjustmentPct =
        basePrice > 0 ? this.round2(((validPrice - basePrice) / basePrice) * 100) : 0;

      try {
        const suggestion = await this.prisma.price_suggestions.create({
          data: {
            garment_size_id: sizeId,
            calendar_id: dto.calendarId ?? null,
            from_date: fromDate,
            to_date: toDate,
            base_price: basePrice,
            purchase_cost: bounds.garmentFloorCost ?? 0,
            target_rental_days: config.targetRentalDays,
            recommended_adjustment_pct: recommendedAdjustmentPct,
            suggested_price: validPrice,
            min_price: bounds.minPrice,
            max_price: bounds.maxPrice,
            valid_price: validPrice,
            demand_score: null,
            booking_score: null,
            confidence: null,
            reason_json: { summary: "Chủ shop tự đặt giá." } as Prisma.InputJsonValue,
            status: "pending",
            source: "owner",
          },
          select: { id: true },
        });
        created.push(suggestion);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          skipped.push({
            sizeId,
            name: bounds.name,
            sizeLabel: bounds.sizeLabel,
            error: "Đã có đề xuất cho size này trong cùng khoảng ngày.",
          });
        } else {
          throw error;
        }
      }
    }

    return ok({ created, skipped });
  }

  /**
   * Chủ shop sửa giá của đề xuất đang chờ duyệt.
   * Sau khi sửa, đề xuất được đánh dấu nguồn = owner (không còn là AI suggestion).
   */
  async updateSuggestionPrice(id: string, dto: UpdateSuggestionPriceDto) {
    const suggestion = await this.prisma.price_suggestions.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException("Suggestion not found.");
    if (suggestion.status !== "pending") {
      throw new BadRequestException(`Chỉ sửa được đề xuất pending (hiện tại: ${suggestion.status}).`);
    }

    const validPrice = this.round2(dto.validPrice);
    const basePrice = Number(suggestion.base_price);
    const recommendedAdjustmentPct =
      basePrice > 0 ? this.round2(((validPrice - basePrice) / basePrice) * 100) : 0;
    const previousReason = (suggestion.reason_json ?? {}) as Record<string, unknown>;

    const updated = await this.prisma.price_suggestions.update({
      where: { id },
      data: {
        valid_price: validPrice,
        suggested_price: validPrice,
        recommended_adjustment_pct: recommendedAdjustmentPct,
        source: "owner",
        reason_json: {
          ...previousReason,
          summary: "Chủ shop điều chỉnh giá đề xuất.",
        } as Prisma.InputJsonValue,
      },
      include: { garment_sizes: { include: { garments: true } }, price_calendar: true },
    });

    return ok({ id, suggestion: this.serializeSuggestion(updated) });
  }

  async approveSuggestion(id: string, actor?: AuthenticatedUser) {
    const result = await this.approveOne(id, actor);
    if (!result.ok) throw new BadRequestException(result.reason);
    return ok({ id, status: "approved", suggestion: result.suggestion });
  }

  private async approveOne(
    id: string,
    actor?: AuthenticatedUser,
  ): Promise<{ ok: true; suggestion: ReturnType<PricingService["serializeSuggestion"]> } | { ok: false; reason: string }> {
    const suggestion = await this.prisma.price_suggestions.findUnique({ where: { id } });
    if (!suggestion) return { ok: false, reason: "Không tìm thấy đề xuất." };
    if (suggestion.status !== "pending") {
      return { ok: false, reason: `Chỉ duyệt được đề xuất pending (hiện tại: ${suggestion.status}).` };
    }

    // Re-validate với cấu hình hiện tại — không cho duyệt giá từ cấu hình cũ.
    // Với đề xuất của chủ shop (source=owner) thì bỏ qua kiểm tra min/max:
    // chủ shop có toàn quyền đặt giá, không bị ràng buộc bởi AI/business rule.
    const config = await this.loadConfig();
    const isOwnerSource = suggestion.source === "owner";
    if (!isOwnerSource) {
      const bounds = await this.computeBounds(suggestion.garment_size_id, config);
      const errors = this.validateBounds(bounds);
      if (errors.length > 0) {
        return { ok: false, reason: `Không thể duyệt: ${errors[0]}` };
      }
      const validPrice = Number(suggestion.valid_price);
      if (validPrice < bounds.minPrice - 0.01 || validPrice > bounds.maxPrice + 0.01) {
        return {
          ok: false,
          reason: "Giá đề xuất không còn nằm trong [min, max] theo cấu hình hiện tại. Hãy sinh lại đề xuất rồi duyệt.",
        };
      }
    }
    const validPrice = Number(suggestion.valid_price);

    const overlapping = await this.prisma.price_periods.findFirst({
      where: {
        garment_size_id: suggestion.garment_size_id,
        is_active: true,
        from_date: { lte: suggestion.to_date },
        to_date: { gte: suggestion.from_date },
      },
      select: { id: true },
    });
    if (overlapping) {
      return {
        ok: false,
        reason: "Khoảng ngày trùng với price period đang hiệu lực. Hãy “Vô hiệu hóa” period cũ trước khi duyệt.",
      };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.price_periods.create({
          data: {
            garment_size_id: suggestion.garment_size_id,
            from_date: suggestion.from_date,
            to_date: suggestion.to_date,
            daily_price: validPrice,
            source: isOwnerSource ? "owner" : "ai_suggestion",
            source_suggestion_id: suggestion.id,
            is_active: true,
          },
        });
        await tx.price_suggestions.update({
          where: { id },
          data: {
            status: "approved",
            reviewed_by: actor?.id ?? null,
            reviewed_at: new Date(),
            applied_at: new Date(),
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/overlaps?\s+active/i.test(message)) {
        return {
          ok: false,
          reason: "Khoảng ngày trùng với price period đang hiệu lực. Hãy “Vô hiệu hóa” period cũ trước khi duyệt.",
        };
      }
      throw error;
    }

    const updated = await this.prisma.price_suggestions.findUnique({
      where: { id },
      include: { garment_sizes: { include: { garments: true } }, price_calendar: true },
    });
    return { ok: true, suggestion: this.serializeSuggestion(updated!) };
  }

  async rejectSuggestion(id: string, actor?: AuthenticatedUser) {
    const result = await this.rejectOne(id, actor);
    if (!result.ok) throw new BadRequestException(result.reason);
    return ok({ id, status: "rejected" });
  }

  private async rejectOne(
    id: string,
    actor?: AuthenticatedUser,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const suggestion = await this.prisma.price_suggestions.findUnique({ where: { id } });
    if (!suggestion) return { ok: false, reason: "Không tìm thấy đề xuất." };
    if (suggestion.status !== "pending") {
      return { ok: false, reason: `Chỉ từ chối được đề xuất pending (hiện tại: ${suggestion.status}).` };
    }
    await this.prisma.price_suggestions.update({
      where: { id },
      data: { status: "rejected", reviewed_by: actor?.id ?? null, reviewed_at: new Date() },
    });
    return { ok: true };
  }

  /**
   * Duyệt / từ chối hàng loạt theo danh sách id. Chạy tuần tự, mỗi đề xuất độc lập:
   * một cái fail (không pending, trùng period, giá ngoài khung...) không làm hỏng các cái khác.
   */
  async bulkSuggestionAction(dto: BulkSuggestionActionDto, actor?: AuthenticatedUser) {
    const ids = [...new Set(dto.ids)];
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      const result = dto.action === "approve" ? await this.approveOne(id, actor) : await this.rejectOne(id, actor);
      if (result.ok) succeeded.push(id);
      else failed.push({ id, reason: result.reason });
    }
    return ok({
      action: dto.action,
      succeeded,
      failed,
      successCount: succeeded.length,
      failureCount: failed.length,
    });
  }

  /**
   * Vô hiệu hóa đề xuất đã duyệt (chủ shop đổi ý):
   * tắt price period do đề xuất này tạo ra để trống lại khoảng ngày,
   * và đánh dấu đề xuất là "deactivated" (không quay về pending để tránh
   * xung đột unique (garment_size_id, from_date, to_date) với đề xuất mới).
   */
  async deactivateSuggestion(id: string) {
    const suggestion = await this.prisma.price_suggestions.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException("Suggestion not found.");
    if (suggestion.status !== "approved") {
      throw new BadRequestException(`Chỉ vô hiệu hóa được đề xuất đã duyệt (hiện tại: ${suggestion.status}).`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const deactivated = await tx.price_periods.updateMany({
        where: { source_suggestion_id: id, is_active: true },
        data: { is_active: false },
      });
      const updatedSuggestion = await tx.price_suggestions.update({
        where: { id },
        data: { status: "deactivated" },
      });
      return { suggestion: updatedSuggestion, deactivatedCount: deactivated.count };
    });

    return ok({
      id,
      status: updated.suggestion.status,
      deactivatedPeriods: updated.deactivatedCount,
      note: "Đã vô hiệu hóa đề xuất và tắt price period cũ.",
    });
  }

  // ── Price period list ──────────────────────────────────────────────────────

  async listPeriods(options?: {
    sizeId?: string;
    activeOnly?: boolean;
    endDateGte?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const page = options?.page ?? 1;
    const limit = Math.min(options?.limit ?? 50, 100);
    const search = options?.search?.trim();
    const searchOR: Prisma.price_periodsWhereInput[] = [];
    if (search) {
      searchOR.push(
        { garment_sizes: { garments: { name: { contains: search, mode: "insensitive" } } } },
        { garment_sizes: { size_label: { contains: search, mode: "insensitive" } } },
        { price_suggestions: { price_calendar: { name: { contains: search, mode: "insensitive" } } } },
      );
      const q = search.toLowerCase();
      const matchedTypes = OCCASION_SEARCH_TERMS.filter((o) => o.terms.some((t) => q.includes(t))).map((o) => o.type);
      if (matchedTypes.length > 0) {
        searchOR.push({ price_suggestions: { price_calendar: { occasion_type: { in: matchedTypes } } } });
      }
    }
    const where: Prisma.price_periodsWhereInput = {
      ...(options?.sizeId ? { garment_size_id: options.sizeId } : {}),
      ...(options?.activeOnly ? { is_active: true } : {}),
      ...(options?.endDateGte ? { to_date: { gte: new Date(options.endDateGte) } } : {}),
      ...(searchOR.length > 0 ? { OR: searchOR } : {}),
      ...(options?.from || options?.to
        ? {
            AND: [
              ...(options?.from ? [{ to_date: { gte: this.parseDateStr(options.from, "from") } }] : []),
              ...(options?.to ? [{ from_date: { lte: this.parseDateStr(options.to, "to") } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.price_periods.findMany({
        where,
        orderBy: [{ garment_size_id: "asc" }, { from_date: "asc" }],
        include: {
          garment_sizes: { include: { garments: true } },
          price_suggestions: {
            select: {
              id: true,
              status: true,
              price_calendar: { select: { id: true, name: true, occasion_type: true } },
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.price_periods.count({ where }),
    ]);
    return ok({
      items: rows.map((r) => ({
        id: r.id,
        garmentSizeId: r.garment_size_id,
        garmentName: r.garment_sizes?.garments?.name ?? null,
        sizeLabel: r.garment_sizes?.size_label ?? null,
        fromDate: r.from_date.toISOString().slice(0, 10),
        toDate: r.to_date.toISOString().slice(0, 10),
        dailyPrice: Number(r.daily_price),
        source: r.source,
        sourceSuggestionId: r.source_suggestion_id ?? null,
        occasionType: r.price_suggestions?.price_calendar?.occasion_type ?? null,
        eventName: r.price_suggestions?.price_calendar?.name ?? null,
        isActive: r.is_active,
        createdAt: r.created_at.toISOString(),
      })),
      total,
      page,
      limit,
    });
  }

  /**
   * Vô hiệu hóa trực tiếp một price period (tab "Khoảng giá hiệu lực").
   * Nếu period gắn với suggestion đang approved thì đánh dấu suggestion deactivated luôn.
   */
  async deactivatePeriod(id: string) {
    const period = await this.prisma.price_periods.findUnique({ where: { id } });
    if (!period) throw new NotFoundException("Price period not found.");
    if (!period.is_active) {
      throw new BadRequestException("Khoảng giá này đã bị vô hiệu hóa.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.price_periods.update({ where: { id }, data: { is_active: false } });
      if (period.source_suggestion_id) {
        await tx.price_suggestions.updateMany({
          where: { id: period.source_suggestion_id, status: "approved" },
          data: { status: "deactivated" },
        });
      }
    });

    return ok({ id, isActive: false });
  }

  // ── Giá hiệu lực theo NGÀY (dùng cho booking tạo mới) ─────────────────────

  /**
   * Trả Map<sizeId, giá hiệu lực> của nhiều size tại một ngày `onDate`.
   * Ưu tiên price_period active chứa ngày đó; fallback về base (daily_price).
   */
  async effectiveDailyPriceMap(sizeIds: string[], onDate: Date = new Date()): Promise<Map<string, number>> {
    const uniqueIds = [...new Set(sizeIds)];
    if (uniqueIds.length === 0) return new Map();
    const day = this.dayUtc(onDate);

    const [periods, sizes] = await Promise.all([
      this.prisma.price_periods.findMany({
        where: {
          garment_size_id: { in: uniqueIds },
          is_active: true,
          from_date: { lte: day },
          to_date: { gte: day },
        },
        select: { garment_size_id: true, daily_price: true },
      }),
      this.prisma.garment_sizes.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, daily_price: true },
      }),
    ]);

    const map = new Map<string, number>();
    for (const s of sizes) {
      map.set(s.id, Number(s.daily_price ?? 0));
    }
    // DB trigger chặn active overlap (cùng size), nên tối đa 1 period khớp.
    for (const p of periods) {
      map.set(p.garment_size_id, Number(p.daily_price));
    }
    return map;
  }

  /**
   * Giá hiệu lực cho 1 size tại một ngày. Quyết định lúc TẠO booking
   * (booking.createdAt), không theo từng ngày trong khoảng thuê.
   */
  async effectiveDailyPrice(sizeId: string, onDate: Date = new Date()): Promise<number> {
    const map = await this.effectiveDailyPriceMap([sizeId], onDate);
    return map.get(sizeId) ?? 0;
  }

  // ── Chạy tự động: sinh đề xuất cho sự kiện sắp diễn ra ─────────────────────

  async runScheduledGeneration() {
    const leadDays = await this.getSettingNumber("pricing_advice_lead_days", 7);
    const today = this.dayUtc(new Date());
    const horizon = new Date(today.getTime() + leadDays * MS_PER_DAY);

    const events = await this.prisma.price_calendar.findMany({
      where: {
        is_active: true,
        from_date: { gte: today, lte: horizon },
      },
      orderBy: { from_date: "asc" },
    });

    const summary: Array<{ calendarId: string; name: string; generated: number; skipped: unknown[] }> = [];
    for (const event of events) {
      const result = await this.generateSuggestions({ calendarId: event.id });
      summary.push({
        calendarId: event.id,
        name: event.name,
        generated: result.data?.generated ?? 0,
        skipped: result.data?.skipped ?? [],
      });
    }
    return ok({ events: summary });
  }
}