import { BadRequestException, Injectable } from "@nestjs/common";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { ProductStatsQueryDto, TrackViewDto } from "./dto/product-stats-query.dto";
import {
  computeProductStats,
  MS_PER_DAY,
  REVENUE_STATUSES,
  type GarmentInfo,
  type ItemRow,
} from "./product-stats.calculator";

const VIEW_DEDUPE_MS = 30 * 60 * 1000;
const NON_RENTABLE_ASSET_STATUSES = ["retired", "lost"] as const;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ghi nhận 1 lượt xem; cùng visitor + sản phẩm trong 30 phút chỉ tính 1 lần. */
  async trackView(dto: TrackViewDto, viewerId?: string | null) {
    const visitorKey = dto.visitorKey.trim().slice(0, 64);
    if (!visitorKey) throw new BadRequestException("visitorKey không hợp lệ.");
    const garment = await this.prisma.garment.findFirst({
      where: { id: dto.garmentId, deletedAt: null },
      select: { id: true },
    });
    if (!garment) return ok({ counted: false });

    const recent = await this.prisma.garment_views.findFirst({
      where: {
        garment_id: dto.garmentId,
        visitor_key: visitorKey,
        created_at: { gte: new Date(Date.now() - VIEW_DEDUPE_MS) },
      },
      select: { id: true },
    });
    if (recent) return ok({ counted: false });

    await this.prisma.garment_views.create({
      data: { garment_id: dto.garmentId, visitor_key: visitorKey, viewer_id: viewerId ?? null },
    });
    return ok({ counted: true });
  }

  async productStats(q: ProductStatsQueryDto) {
    const to = q.to ? new Date(`${q.to.slice(0, 10)}T00:00:00.000Z`) : this.todayUtc();
    const from = q.from ? new Date(`${q.from.slice(0, 10)}T00:00:00.000Z`) : new Date(to.getTime() - 89 * MS_PER_DAY);
    if (from > to) throw new BadRequestException("Ngày bắt đầu phải trước ngày kết thúc.");
    if ((to.getTime() - from.getTime()) / MS_PER_DAY > 730) throw new BadRequestException("Khoảng thống kê tối đa 2 năm.");
    const toEnd = new Date(to.getTime() + MS_PER_DAY - 1);

    const opts = {
      from,
      to,
      sortBy: q.sortBy ?? "revenue",
      hotLimit: q.hotLimit ?? 10,
      lowDemandMaxRentals: q.lowDemandMaxRentals ?? 1,
      minAgeDays: q.minAgeDays ?? 30,
    } as const;

    const garmentWhere = { deletedAt: null, ...(q.categoryId ? { categoryId: q.categoryId } : {}) };
    const garmentsRaw = await this.prisma.garment.findMany({
      where: garmentWhere,
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        categoryId: true,
        category: { select: { name: true } },
        images: { select: { imageUrl: true }, take: 1 },
        garment_sizes: { where: { is_active: true }, select: { daily_price: true } },
        assets: {
          where: { status: { notIn: [...NON_RENTABLE_ASSET_STATUSES] } },
          select: { id: true },
        },
      },
    });
    const garmentIds = garmentsRaw.map((g) => g.id);

    const [itemsRaw, viewGroups, tryonGroups, ratingGroups] = await Promise.all([
      this.prisma.bookingItem.findMany({
        where: {
          garmentId: { in: garmentIds },
          booking: {
            status: { not: "draft" },
            OR: [
              { createdAt: { gte: from, lte: toEnd } },
              { rentalStartDate: { lte: to }, rentalEndDate: { gte: from } },
            ],
          },
        },
        select: {
          garmentId: true,
          dailyPrice: true,
          booking: {
            select: {
              status: true,
              createdAt: true,
              rentalStartDate: true,
              rentalEndDate: true,
              subtotal: true,
              discountTotal: true,
            },
          },
        },
      }),
      this.prisma.garment_views.groupBy({
        by: ["garment_id"],
        where: { garment_id: { in: garmentIds }, created_at: { gte: from, lte: toEnd } },
        _count: { _all: true },
      }),
      this.prisma.tryonRequest.groupBy({
        by: ["garmentId"],
        where: { garmentId: { in: garmentIds }, createdAt: { gte: from, lte: toEnd } },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ["garmentId"],
        where: { garmentId: { in: garmentIds }, status: "public" },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    const garments: GarmentInfo[] = garmentsRaw.map((g) => {
      const prices = g.garment_sizes.map((s) => Number(s.daily_price ?? 0)).filter((n) => n > 0);
      return {
        id: g.id,
        name: g.name,
        isActive: g.isActive,
        createdAt: g.createdAt,
        categoryId: g.categoryId,
        categoryName: g.category?.name ?? null,
        imageUrl: g.images[0]?.imageUrl ?? null,
        minDailyPrice: prices.length ? Math.min(...prices) : 0,
        assetCount: g.assets.length,
      };
    });
    const items: ItemRow[] = itemsRaw.map((i) => ({
      garmentId: i.garmentId,
      dailyPrice: Number(i.dailyPrice),
      status: i.booking.status,
      bookingCreatedAt: i.booking.createdAt,
      rentalStart: i.booking.rentalStartDate,
      rentalEnd: i.booking.rentalEndDate,
      bookingSubtotal: Number(i.booking.subtotal ?? 0),
      bookingDiscount: Number(i.booking.discountTotal ?? 0),
    }));

    const stats = computeProductStats(
      garments,
      items,
      new Map(viewGroups.map((v) => [v.garment_id, v._count._all])),
      new Map(tryonGroups.map((t) => [t.garmentId, t._count._all])),
      new Map(ratingGroups.map((r) => [r.garmentId, { avg: Number(r._avg.rating ?? 0), count: r._count._all }])),
      opts,
    );

    const hot = stats.filter((s) => s.classification === "HOT").sort((a, b) => (a.hotRank ?? 0) - (b.hotRank ?? 0));
    const lowDemand = stats
      .filter((s) => s.classification === "LOW_DEMAND")
      .sort((a, b) => a.rentCount - b.rentCount || a.views - b.views);

    const sum = (f: (s: (typeof stats)[number]) => number) => stats.reduce((acc, s) => acc + f(s), 0);
    const totalCapacity = sum((s) => s.bookedDays + s.availableDays);
    const totalRented = sum((s) => s.rentCount);
    const totalCancelled = sum((s) => s.cancelCount);

    return ok({
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      options: opts,
      summary: {
        garmentCount: stats.length,
        totalRentals: totalRented,
        totalRevenue: sum((s) => s.revenue),
        avgOccupancyRate: totalCapacity > 0 ? Math.round((sum((s) => s.bookedDays) / totalCapacity) * 10000) / 10000 : 0,
        cancelRate: totalRented + totalCancelled > 0 ? Math.round((totalCancelled / (totalRented + totalCancelled)) * 10000) / 10000 : 0,
        totalViews: sum((s) => s.views),
        totalTryons: sum((s) => s.tryons),
        hotCount: hot.length,
        lowDemandCount: lowDemand.length,
        revenueStatuses: REVENUE_STATUSES,
      },
      note: "Sản phẩm ít được thuê chỉ được đề xuất để quản trị viên xem xét, hệ thống không tự động xoá hay ẩn.",
      hot,
      lowDemand,
      items: stats,
    });
  }

  private todayUtc() {
    const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
  }
}
