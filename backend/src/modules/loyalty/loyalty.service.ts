import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BookingStatus, Prisma, loyalty_tier } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";

/** 1.000đ chi tiêu thuê thực tế = 1 điểm tích luỹ */
export const POINTS_PER_VND = 1 / 1000;

/**
 * Ngưỡng điểm tích luỹ toàn thời gian (Lifetime Points) để xét hạng thành viên.
 * Basic: Hạng khởi đầu
 * Plus: Từ 2.000 điểm (~2.000.000đ chi tiêu thuê)
 * Premium: Từ 6.000 điểm (~6.000.000đ chi tiêu thuê)
 */
export const TIER_THRESHOLDS = {
  basic: 0,
  plus: 2000,
  premium: 6000,
} as const;

export const TIER_BENEFITS: Record<loyalty_tier, string[]> = {
  basic: [
    "Tích lũy 1 điểm cho mỗi 1.000đ giá trị thuê thực tế",
    "Đổi điểm thưởng lấy các mã voucher giảm giá",
  ],
  plus: [
    "Tất cả quyền lợi của hạng Basic",
    "Giảm 5% trực tiếp trên tiền thuê trang phục",
    "Ưu tiên giữ chỗ và thử trước các mẫu cổ phục hot",
  ],
  premium: [
    "Tất cả quyền lợi của hạng Plus",
    "Giảm 10% trực tiếp trên tiền thuê trang phục",
    "Miễn phí 1 phụ kiện đi kèm cho mỗi bộ cổ phục",
    "Ưu tiên hỗ trợ riêng và xử lý đơn hỏa tốc",
  ],
};

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) { }

  // ─────────────────────────────────────────────────────────────────────────
  // Tích điểm khi đơn thuê hoàn tất (completed)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Tích điểm tự động khi booking hoàn thành.
   * Tính trên số tiền thuê thực tế khách chi trả (rentalTotal - discountTotal).
   * Gọi TRONG transaction của refunds.service / bookings completion.
   */
  async awardPointsForBooking(
    tx: Prisma.TransactionClient,
    bookingId: string,
    customerId: string,
    rentalSpend: number,
  ): Promise<{ pointsEarned: number } | null> {
    const delta = Math.floor(rentalSpend * POINTS_PER_VND);
    if (delta <= 0) return null;

    // Tránh cộng trùng điểm nếu đơn thuê này đã từng được tích điểm
    const existing = await tx.loyalty_point_logs.findFirst({
      where: { bookingId, reason: "earn_rental" },
    });
    if (existing) return null;

    // Cập nhật atomic điểm và tự động nâng hạng theo lifetime points
    await tx.$executeRaw`
      UPDATE "user_accounts"
      SET
        "loyalty_points"          = "loyalty_points" + ${delta},
        "loyalty_points_lifetime" = "loyalty_points_lifetime" + ${delta},
        "loyalty_tier"            = CASE
          WHEN "loyalty_points_lifetime" + ${delta} >= ${TIER_THRESHOLDS.premium} THEN 'premium'::loyalty_tier
          WHEN "loyalty_points_lifetime" + ${delta} >= ${TIER_THRESHOLDS.plus}    THEN 'plus'::loyalty_tier
          ELSE 'basic'::loyalty_tier
        END,
        "updated_at"              = now()
      WHERE "id" = ${customerId}::uuid
    `;

    // Lấy số dư sau cập nhật để ghi nhận ledger
    const user = await tx.userAccount.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });

    const balanceAfter = user?.loyaltyPoints ?? delta;

    await tx.loyalty_point_logs.create({
      data: {
        customerId,
        bookingId,
        delta,
        reason: "earn_rental",
        meta: { rentalSpend, pointsPerVnd: POINTS_PER_VND },
        balanceAfter,
      },
    });

    return { pointsEarned: delta };
  }

  /**
   * Thu hồi điểm khi đơn bị hủy sau khi đã hoàn tất tích điểm (idempotent, an toàn).
   */
  async clawbackPointsForBooking(
    tx: Prisma.TransactionClient,
    bookingId: string,
    customerId: string,
    reason = "Đơn bị hủy hoặc hoàn tiền ngoại lệ",
  ): Promise<{ pointsDeducted: number } | null> {
    const earnedLog = await tx.loyalty_point_logs.findFirst({
      where: { bookingId, reason: "earn_rental" },
    });
    if (!earnedLog || earnedLog.delta <= 0) return null;

    const alreadyClawed = await tx.loyalty_point_logs.findFirst({
      where: { bookingId, reason: "clawback_cancelled" },
    });
    if (alreadyClawed) return null;

    const deduct = earnedLog.delta;

    await tx.$executeRaw`
      UPDATE "user_accounts"
      SET
        "loyalty_points"          = GREATEST(0, "loyalty_points" - ${deduct}),
        "loyalty_points_lifetime" = GREATEST(0, "loyalty_points_lifetime" - ${deduct}),
        "loyalty_tier"            = CASE
          WHEN GREATEST(0, "loyalty_points_lifetime" - ${deduct}) >= ${TIER_THRESHOLDS.premium} THEN 'premium'::loyalty_tier
          WHEN GREATEST(0, "loyalty_points_lifetime" - ${deduct}) >= ${TIER_THRESHOLDS.plus}    THEN 'plus'::loyalty_tier
          ELSE 'basic'::loyalty_tier
        END,
        "updated_at"              = now()
      WHERE "id" = ${customerId}::uuid
    `;

    const user = await tx.userAccount.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });

    await tx.loyalty_point_logs.create({
      data: {
        customerId,
        bookingId,
        delta: -deduct,
        reason: "clawback_cancelled",
        meta: { originalLogId: earnedLog.id, reason },
        balanceAfter: user?.loyaltyPoints ?? 0,
      },
    });

    return { pointsDeducted: deduct };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Đổi điểm lấy Voucher
  // ─────────────────────────────────────────────────────────────────────────

  async redeemPoints(customerId: string, ruleId: string) {
    const rule = await this.prisma.loyalty_redemption_rules.findUnique({
      where: { id: ruleId },
    });
    if (!rule || !rule.isActive) {
      throw new BadRequestException("Gói đổi điểm không tồn tại hoặc tạm ngưng.");
    }

    const result = await this.prisma.runSerializable(async (tx) => {
      // Trừ điểm atomic có điều kiện: chỉ trừ khi số dư >= pointsRequired
      const updated = await tx.$executeRaw`
        UPDATE "user_accounts"
        SET
          "loyalty_points" = "loyalty_points" - ${rule.pointsRequired},
          "updated_at"     = now()
        WHERE "id" = ${customerId}::uuid
          AND "loyalty_points" >= ${rule.pointsRequired}
      `;
      if (updated === 0) {
        throw new BadRequestException("Điểm tích luỹ hiện tại không đủ để đổi voucher này.");
      }

      const user = await tx.userAccount.findUnique({
        where: { id: customerId },
        select: { loyaltyPoints: true },
      });

      // Tạo voucher độc quyền dùng 1 lần cho khách hàng
      const expiresAt = new Date(Date.now() + rule.voucherValidityDays * 24 * 60 * 60 * 1000);
      const code = `LYL-${customerId.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

      const voucher = await tx.vouchers.create({
        data: {
          code,
          name: rule.voucherName,
          description: `Đổi từ ${rule.pointsRequired} điểm thưởng thành viên`,
          discount_type: rule.discountType,
          discount_value: rule.discountValue,
          max_discount_amount: rule.maxDiscountAmount,
          min_order_value: rule.minOrderValue,
          usage_limit: 1,
          per_user_limit: 1,
          start_at: new Date(),
          end_at: expiresAt,
          category_ids: [],
          garment_ids: [],
          is_active: true,
        },
      });

      // Ghi nhận log trừ điểm
      await tx.loyalty_point_logs.create({
        data: {
          customerId,
          delta: -rule.pointsRequired,
          reason: "redeem_voucher",
          meta: { ruleId, voucherId: voucher.id, voucherCode: code },
          balanceAfter: user?.loyaltyPoints ?? 0,
        },
      });

      return {
        voucher,
        balanceAfter: user?.loyaltyPoints ?? 0,
      };
    });

    return ok(
      {
        voucherCode: result.voucher.code,
        voucherName: result.voucher.name,
        discountType: result.voucher.discount_type,
        discountValue: Number(result.voucher.discount_value),
        expiresAt: result.voucher.end_at,
        balanceAfter: result.balanceAfter,
      },
      "Đổi điểm thành công! Mã voucher đã sẵn sàng sử dụng.",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Truy vấn thông tin dành cho khách hàng
  // ─────────────────────────────────────────────────────────────────────────

  async getMyLoyalty(customerId: string) {
    const user = await this.prisma.userAccount.findUnique({
      where: { id: customerId },
      select: {
        loyaltyPoints: true,
        loyaltyPointsLifetime: true,
        loyaltyTier: true,
      },
    });
    if (!user) throw new NotFoundException("Không tìm thấy thông tin tài khoản.");

    // Lấy các đơn thuê đã được xác nhận/thanh toán đang tiến hành nhưng chưa hoàn tất tích điểm
    // Quy tắc nghiệp vụ:
    // 1. TUYỆT ĐỐI KHÔNG tính pending points cho đơn 'pending_confirmation'
    // 2. Với đơn 'confirmed' hoặc 'awaiting_payment': Chỉ tính khi đã thanh toán thành công thực tế (có Payment status 'paid')
    // 3. Các đơn ở trạng thái sau thanh toán (paid, preparing, ready_for_pickup, delivering, renting, returned, inspection_pending, refund_pending, overdue) được tính
    const candidateBookings = await this.prisma.booking.findMany({
      where: {
        customerId,
        status: {
          in: [
            BookingStatus.confirmed,
            BookingStatus.awaiting_payment,
            BookingStatus.paid,
            BookingStatus.preparing,
            BookingStatus.ready_for_pickup,
            BookingStatus.delivering,
            BookingStatus.renting,
            BookingStatus.returned,
            BookingStatus.inspection_pending,
            BookingStatus.refund_pending,
            BookingStatus.overdue,
          ],
        },
        pointLogs: {
          none: {
            reason: "earn_rental",
          },
        },
      },
      select: {
        id: true,
        rentalTotal: true,
        discountTotal: true,
        status: true,
        rentalStartDate: true,
        rentalEndDate: true,
        createdAt: true,
        payments: {
          select: {
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const activeBookings = candidateBookings.filter((b) => {
      const hasSuccessfulPayment = b.payments?.some((p) => p.status === "paid");
      const postPaymentStatuses: BookingStatus[] = [
        BookingStatus.paid,
        BookingStatus.preparing,
        BookingStatus.ready_for_pickup,
        BookingStatus.delivering,
        BookingStatus.renting,
        BookingStatus.returned,
        BookingStatus.inspection_pending,
        BookingStatus.refund_pending,
        BookingStatus.overdue,
      ];
      const isPostPaymentStatus = postPaymentStatuses.includes(b.status);

      return hasSuccessfulPayment || isPostPaymentStatus;
    });

    const pendingBookings = activeBookings.map((b) => {
      // b.rentalTotal đã là tiền thuê thực trả sau khi trừ ưu đãi/voucher
      const earnableSpend = Math.max(0, Number(b.rentalTotal ?? 0));
      const points = Math.floor(earnableSpend * POINTS_PER_VND);
      return {
        bookingId: b.id,
        status: b.status,
        rentalStartDate: b.rentalStartDate,
        rentalEndDate: b.rentalEndDate,
        earnableSpend,
        points,
      };
    });

    const pendingPoints = pendingBookings.reduce((sum, b) => sum + b.points, 0);
    const nextTier = this.calcNextTier(user.loyaltyPointsLifetime);

    return ok({
      points: user.loyaltyPoints,
      lifetimePoints: user.loyaltyPointsLifetime,
      pendingPoints,
      pendingBookings,
      tier: user.loyaltyTier,
      nextTier,
      tierBenefits: TIER_BENEFITS[user.loyaltyTier],
    });
  }

  async getMyHistory(customerId: string, cursor?: string) {
    const logs = await this.prisma.loyalty_point_logs.findMany({
      where: {
        customerId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return ok(
      logs.map((l) => ({
        id: l.id,
        delta: l.delta,
        reason: l.reason,
        meta: l.meta,
        balanceAfter: l.balanceAfter,
        createdAt: l.createdAt,
      })),
    );
  }

  async listRedemptionRules() {
    const rules = await this.prisma.loyalty_redemption_rules.findMany({
      where: { isActive: true },
      orderBy: { pointsRequired: "asc" },
    });

    return ok(
      rules.map((r) => ({
        id: r.id,
        pointsRequired: r.pointsRequired,
        voucherName: r.voucherName,
        discountType: r.discountType,
        discountValue: Number(r.discountValue),
        maxDiscountAmount: r.maxDiscountAmount ? Number(r.maxDiscountAmount) : null,
        minOrderValue: Number(r.minOrderValue),
        voucherValidityDays: r.voucherValidityDays,
      })),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dành cho Quản trị viên (Manager / Admin)
  // ─────────────────────────────────────────────────────────────────────────

  async listAllRules() {
    const rules = await this.prisma.loyalty_redemption_rules.findMany({
      orderBy: { pointsRequired: "asc" },
    });
    return ok(rules);
  }

  async updateRule(
    ruleId: string,
    data: {
      isActive?: boolean;
      pointsRequired?: number;
      voucherValidityDays?: number;
      voucherName?: string;
    },
  ) {
    const existing = await this.prisma.loyalty_redemption_rules.findUnique({
      where: { id: ruleId },
    });
    if (!existing) throw new NotFoundException("Không tìm thấy quy tắc đổi điểm.");

    const updated = await this.prisma.loyalty_redemption_rules.update({
      where: { id: ruleId },
      data: {
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.pointsRequired !== undefined ? { pointsRequired: data.pointsRequired } : {}),
        ...(data.voucherValidityDays !== undefined ? { voucherValidityDays: data.voucherValidityDays } : {}),
        ...(data.voucherName !== undefined ? { voucherName: data.voucherName } : {}),
        updatedAt: new Date(),
      },
    });

    return ok(updated, "Cập nhật quy tắc đổi điểm thành công.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper tính hạng tiếp theo
  // ─────────────────────────────────────────────────────────────────────────

  private calcNextTier(lifetimePoints: number) {
    if (lifetimePoints >= TIER_THRESHOLDS.premium) {
      return null; // Đã đạt hạng cao nhất
    }
    if (lifetimePoints >= TIER_THRESHOLDS.plus) {
      return {
        tier: "premium" as const,
        pointsNeeded: TIER_THRESHOLDS.premium - lifetimePoints,
        targetPoints: TIER_THRESHOLDS.premium,
      };
    }
    return {
      tier: "plus" as const,
      pointsNeeded: TIER_THRESHOLDS.plus - lifetimePoints,
      targetPoints: TIER_THRESHOLDS.plus,
    };
  }
}

