/**
 * Tính chỉ số hiệu quả sản phẩm — hàm thuần, không đụng DB để dễ test.
 * Lưu ý nghiệp vụ: sản phẩm ít được thuê KHÔNG bao giờ bị tự động xoá/ẩn,
 * hệ thống chỉ trả về đề xuất để quản trị viên xem xét.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Đơn tính là "được thuê" (không tính nháp / huỷ / từ chối) */
export const RENTED_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "awaiting_payment",
  "paid",
  "preparing",
  "ready_for_pickup",
  "delivering",
  "renting",
  "returned",
  "inspection_pending",
  "refund_pending",
  "completed",
  "overdue",
];

/** Đơn đã phát sinh doanh thu (đã thanh toán trở đi) */
export const REVENUE_STATUSES = [
  "paid",
  "preparing",
  "ready_for_pickup",
  "delivering",
  "renting",
  "returned",
  "inspection_pending",
  "refund_pending",
  "completed",
  "overdue",
];

export const CANCELLED_STATUSES = ["cancelled", "rejected"];

export type GarmentInfo = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  minDailyPrice: number;
  assetCount: number;
};

export type ItemRow = {
  garmentId: string;
  dailyPrice: number;
  status: string;
  bookingCreatedAt: Date;
  rentalStart: Date;
  rentalEnd: Date;
  bookingSubtotal: number;
  bookingDiscount: number;
};

export type Recommendation = {
  action: "discount" | "promote" | "discontinue_review" | "reduce_stock" | "quality_check";
  message: string;
};

export type ProductStat = {
  garmentId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  isActive: boolean;
  minDailyPrice: number;
  assetCount: number;
  rentCount: number;
  revenue: number;
  /** Tỷ lệ được đặt = ngày-bản đã được đặt / tổng ngày-bản có thể cho thuê trong kỳ */
  occupancyRate: number;
  /** Tỷ lệ chuyển đổi = lượt thuê / lượt xem */
  conversionRate: number | null;
  cancelCount: number;
  cancelRate: number;
  bookedDays: number;
  availableDays: number;
  views: number;
  tryons: number;
  avgRating: number | null;
  reviewCount: number;
  lastRentedAt: string | null;
  classification: "HOT" | "LOW_DEMAND" | "NORMAL" | "NEW";
  hotRank: number | null;
  recommendations: Recommendation[];
};

export type CalcOptions = {
  from: Date;
  to: Date;
  sortBy: "revenue" | "bookings";
  hotLimit: number;
  lowDemandMaxRentals: number;
  minAgeDays: number;
};

const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Số ngày giao nhau (tính cả 2 đầu) giữa 2 khoảng ngày */
export function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = Math.max(dayStart(aStart), dayStart(bStart));
  const e = Math.min(dayStart(aEnd), dayStart(bEnd));
  return e < s ? 0 : Math.round((e - s) / MS_PER_DAY) + 1;
}

const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

export function computeProductStats(
  garments: GarmentInfo[],
  items: ItemRow[],
  views: Map<string, number>,
  tryons: Map<string, number>,
  ratings: Map<string, { avg: number; count: number }>,
  opts: CalcOptions,
): ProductStat[] {
  const periodDays = overlapDays(opts.from, opts.to, opts.from, opts.to);
  const fromT = opts.from.getTime();
  const toT = dayStart(opts.to) + MS_PER_DAY - 1;
  const itemsByGarment = new Map<string, ItemRow[]>();
  for (const it of items) {
    const arr = itemsByGarment.get(it.garmentId) ?? [];
    arr.push(it);
    itemsByGarment.set(it.garmentId, arr);
  }

  const stats: ProductStat[] = garments.map((g) => {
    const rows = itemsByGarment.get(g.id) ?? [];
    const createdInPeriod = rows.filter((r) => r.bookingCreatedAt.getTime() >= fromT && r.bookingCreatedAt.getTime() <= toT);

    const rented = createdInPeriod.filter((r) => RENTED_STATUSES.includes(r.status));
    const cancelled = createdInPeriod.filter((r) => CANCELLED_STATUSES.includes(r.status));
    const consideredForCancel = rented.length + cancelled.length;

    let revenue = 0;
    for (const r of createdInPeriod) {
      if (!REVENUE_STATUSES.includes(r.status)) continue;
      const days = overlapDays(r.rentalStart, r.rentalEnd, r.rentalStart, r.rentalEnd);
      const gross = r.dailyPrice * days;
      // Phân bổ giảm giá voucher của đơn theo tỷ lệ giá trị dòng
      const share = r.bookingSubtotal > 0 ? Math.min(1, r.bookingDiscount / r.bookingSubtotal) : 0;
      revenue += gross * (1 - share);
    }

    // Ngày-bản bị chiếm trong kỳ (theo lịch thuê, không theo ngày tạo đơn)
    const bookedDays = rows
      .filter((r) => RENTED_STATUSES.includes(r.status))
      .reduce((s, r) => s + overlapDays(r.rentalStart, r.rentalEnd, opts.from, opts.to), 0);
    const capacity = g.assetCount * periodDays;
    const occupancyRate = capacity > 0 ? Math.min(1, bookedDays / capacity) : 0;

    const v = views.get(g.id) ?? 0;
    const rating = ratings.get(g.id);
    const last = rows
      .filter((r) => RENTED_STATUSES.includes(r.status))
      .reduce<Date | null>((m, r) => (!m || r.bookingCreatedAt > m ? r.bookingCreatedAt : m), null);

    return {
      garmentId: g.id,
      name: g.name,
      categoryId: g.categoryId,
      categoryName: g.categoryName,
      imageUrl: g.imageUrl,
      isActive: g.isActive,
      minDailyPrice: g.minDailyPrice,
      assetCount: g.assetCount,
      rentCount: rented.length,
      revenue: Math.round(revenue),
      occupancyRate: round(occupancyRate),
      conversionRate: v > 0 ? round(rented.length / v) : null,
      cancelCount: cancelled.length,
      cancelRate: consideredForCancel > 0 ? round(cancelled.length / consideredForCancel) : 0,
      bookedDays: Math.min(bookedDays, capacity || bookedDays),
      availableDays: Math.max(0, capacity - bookedDays),
      views: v,
      tryons: tryons.get(g.id) ?? 0,
      avgRating: rating ? round(rating.avg, 2) : null,
      reviewCount: rating?.count ?? 0,
      lastRentedAt: last ? last.toISOString() : null,
      classification: "NORMAL",
      hotRank: null,
      recommendations: [],
    };
  });

  // ── HOT: top theo doanh thu hoặc số booking ──
  const ranked = [...stats]
    .filter((s) => s.rentCount > 0)
    .sort((a, b) =>
      opts.sortBy === "revenue"
        ? b.revenue - a.revenue || b.rentCount - a.rentCount
        : b.rentCount - a.rentCount || b.revenue - a.revenue,
    );
  ranked.slice(0, opts.hotLimit).forEach((s, i) => {
    s.classification = "HOT";
    s.hotRank = i + 1;
  });

  // ── LOW DEMAND: ít lượt thuê trong kỳ dài, chỉ đề xuất ──
  const ageCutoff = opts.to.getTime() - opts.minAgeDays * MS_PER_DAY;
  const viewValues = stats.map((s) => s.views).sort((a, b) => a - b);
  const medianViews = viewValues.length ? viewValues[Math.floor(viewValues.length / 2)] : 0;

  for (const s of stats) {
    const g = garments.find((x) => x.id === s.garmentId)!;
    if (s.classification === "HOT") continue;
    if (g.createdAt.getTime() > ageCutoff) {
      s.classification = "NEW";
      continue;
    }
    if (!g.isActive || s.rentCount > opts.lowDemandMaxRentals) continue;

    s.classification = "LOW_DEMAND";
    const rec: Recommendation[] = [];
    const interested = s.views > 0 && s.views >= medianViews;
    if (interested || s.tryons > 0) {
      rec.push({
        action: "discount",
        message:
          s.tryons > 0
            ? `Có ${s.tryons} lượt thử AI và ${s.views} lượt xem nhưng ít người thuê — đề xuất giảm giá 10–20% (tạo luật giá "Chương trình cửa hàng").`
            : `Có ${s.views} lượt xem nhưng ít người thuê — đề xuất giảm giá 10–20% để kích cầu.`,
      });
    } else {
      rec.push({
        action: "promote",
        message: "Rất ít lượt xem — đề xuất cập nhật hình ảnh, mô tả hoặc đưa lên trang chủ/khuyến mãi.",
      });
    }
    if (s.rentCount === 0 && s.views < medianViews && s.tryons === 0) {
      rec.push({
        action: "discontinue_review",
        message: "Không có lượt thuê và ít quan tâm trong kỳ — quản trị viên có thể cân nhắc ngừng kinh doanh (hệ thống không tự xoá).",
      });
    }
    if (s.assetCount >= 3 && s.occupancyRate < 0.1) {
      rec.push({
        action: "reduce_stock",
        message: `Có ${s.assetCount} bản nhưng tỷ lệ được đặt < 10% — cân nhắc giảm số bản tồn kho.`,
      });
    }
    if (s.avgRating != null && s.reviewCount >= 2 && s.avgRating < 3.5) {
      rec.push({
        action: "quality_check",
        message: `Đánh giá trung bình ${s.avgRating}/5 — kiểm tra lại chất lượng/độ vừa vặn.`,
      });
    }
    s.recommendations = rec;
  }

  return stats;
}
