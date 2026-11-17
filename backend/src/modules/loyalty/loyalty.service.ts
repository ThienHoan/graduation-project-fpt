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

    // Lấy thông tin hạng hiện tại của khách trước khi cộng điểm
    const beforeUser = await tx.userAccount.findUnique({
      where: { id: customerId },
      select: { loyaltyTier: true, loyaltyPointsLifetime: true },
    });
    const oldTier = beforeUser?.loyaltyTier ?? "basic";
    const currentLifetime = beforeUser?.loyaltyPointsLifetime ?? 0;
    const newLifetime = currentLifetime + delta;

    let targetTier: loyalty_tier = "basic";
    if (newLifetime >= TIER_THRESHOLDS.premium) {
      targetTier = "premium";
    } else if (newLifetime >= TIER_THRESHOLDS.plus) {
      targetTier = "plus";
    }

    const isUpgrade = (oldTier === "basic" && targetTier !== "basic") || (oldTier === "plus" && targetTier === "premium");

    if (isUpgrade) {
      // Khi thăng hạng mới (Basic -> Plus/Premium hoặc Plus -> Premium): cấp thời hạn 365 ngày
      await tx.$executeRaw`
        UPDATE "user_accounts"
        SET
          "loyalty_points"          = "loyalty_points" + ${delta},
          "loyalty_points_lifetime" = "loyalty_points_lifetime" + ${delta},
          "loyalty_tier"            = ${targetTier}::loyalty_tier,
          "loyalty_tier_expires_at" = now() + INTERVAL '365 days',
          "loyalty_tier_updated_at" = now(),
          "updated_at"              = now()
        WHERE "id" = ${customerId}::uuid
      `;
    } else {
      // Không đổi bậc hoặc đã ở hạng đó: cộng điểm bình thường
      await tx.$executeRaw`
        UPDATE "user_accounts"
        SET
          "loyalty_points"          = "loyalty_points" + ${delta},
          "loyalty_points_lifetime" = "loyalty_points_lifetime" + ${delta},
          "loyalty_tier"            = ${targetTier}::loyalty_tier,
          "updated_at"              = now()
        WHERE "id" = ${customerId}::uuid
      `;
    }

    // Lấy số dư sau cập nhật để ghi nhận ledger
    const user = await tx.userAccount.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });

    const balanceAfter = user?.loyaltyPoints ?? delta;
    const pointsExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await tx.loyalty_point_logs.create({
      data: {
        customerId,
        bookingId,
        delta,
        reason: "earn_rental",
        meta: { rentalSpend, pointsPerVnd: POINTS_PER_VND },
        balanceAfter,
        expiresAt: pointsExpiresAt,
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
        loyaltyTierExpiresAt: true,
        loyaltyTierUpdatedAt: true,
      },
    });
    if (!user) throw new NotFoundException("Không tìm thấy thông tin tài khoản.");

    // Xác định hạng chuẩn tương ứng với điểm vòng đời (hỗ trợ tự động đồng bộ khi test DB)
    let expectedTier: loyalty_tier = "basic";
    if (user.loyaltyPointsLifetime >= TIER_THRESHOLDS.premium) {
      expectedTier = "premium";
    } else if (user.loyaltyPointsLifetime >= TIER_THRESHOLDS.plus) {
      expectedTier = "plus";
    } else {
      expectedTier = "basic";
    }

    let userTier = user.loyaltyTier;
    let tierExpiresAt = user.loyaltyTierExpiresAt;
    let tierUpdatedAt = user.loyaltyTierUpdatedAt;

    if (user.loyaltyTier !== expectedTier) {
      userTier = expectedTier;
      tierExpiresAt = expectedTier === "basic" ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      tierUpdatedAt = new Date();
      await this.prisma.userAccount.update({
        where: { id: customerId },
        data: {
          loyaltyTier: expectedTier,
          loyaltyTierExpiresAt: tierExpiresAt,
          loyaltyTierUpdatedAt: tierUpdatedAt,
        },
      });
    }

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

    // Tính điểm tích luỹ trong chu kỳ 12 tháng hiện tại
    const cycleLogs = await this.prisma.loyalty_point_logs.aggregate({
      where: {
        customerId,
        delta: { gt: 0 },
        reason: "earn_rental",
        ...(user.loyaltyTierUpdatedAt ? { createdAt: { gte: user.loyaltyTierUpdatedAt } } : {}),
      },
      _sum: { delta: true },
    });
    const cyclePoints = Number(cycleLogs._sum.delta ?? 0);
    const maintainThreshold = TIER_THRESHOLDS[userTier];
    const maintainPointsNeeded = userTier === "basic" ? 0 : Math.max(0, maintainThreshold - cyclePoints);
    const daysRemaining = tierExpiresAt
      ? Math.max(0, Math.ceil((new Date(tierExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null;

    return ok({
      points: user.loyaltyPoints,
      lifetimePoints: user.loyaltyPointsLifetime,
      pendingPoints,
      pendingBookings,
      tier: userTier,
      nextTier,
      tierBenefits: TIER_BENEFITS[userTier],
      tierExpiresAt,
      tierUpdatedAt,
      cyclePoints,
      maintainPointsNeeded,
      daysRemaining,
    });
  }

  /**
   * Quét và xử lý các tài khoản đã hết hạn 12 tháng (gọi từ cron hàng đêm).
   * - Nếu đủ điểm chu kỳ: Gia hạn thêm 365 ngày.
   * - Nếu không đủ điểm: Hạ bậc mềm mại (Premium -> Plus, Plus -> Basic).
   */
  async evaluateExpiredTiers(): Promise<{ renewed: number; downgraded: number }> {
    const now = new Date();
    const expiredUsers = await this.prisma.userAccount.findMany({
      where: {
        loyaltyTierExpiresAt: { lte: now },
        loyaltyTier: { not: "basic" },
      },
      select: {
        id: true,
        loyaltyTier: true,
        loyaltyPoints: true,
        loyaltyTierUpdatedAt: true,
      },
    });

    let renewed = 0;
    let downgraded = 0;

    for (const user of expiredUsers) {
      const cycleLogs = await this.prisma.loyalty_point_logs.aggregate({
        where: {
          customerId: user.id,
          delta: { gt: 0 },
          reason: "earn_rental",
          ...(user.loyaltyTierUpdatedAt ? { createdAt: { gte: user.loyaltyTierUpdatedAt } } : {}),
        },
        _sum: { delta: true },
      });
      const cyclePoints = Number(cycleLogs._sum.delta ?? 0);
      const oldTier = user.loyaltyTier;
      let newTier: loyalty_tier = "basic";

      if (oldTier === "premium") {
        if (cyclePoints >= TIER_THRESHOLDS.premium) {
          newTier = "premium";
        } else if (cyclePoints >= TIER_THRESHOLDS.plus) {
          newTier = "plus";
        } else {
          newTier = "basic";
        }
      } else if (oldTier === "plus") {
        if (cyclePoints >= TIER_THRESHOLDS.plus) {
          newTier = "plus";
        } else {
          newTier = "basic";
        }
      }

      await this.prisma.runSerializable(async (tx) => {
        if (newTier === oldTier) {
          await tx.$executeRaw`
            UPDATE "user_accounts"
            SET
              "loyalty_tier_expires_at" = now() + INTERVAL '365 days',
              "loyalty_tier_updated_at" = now(),
              "updated_at"              = now()
            WHERE "id" = ${user.id}::uuid
          `;
          await tx.loyalty_point_logs.create({
            data: {
              customerId: user.id,
              delta: 0,
              reason: "tier_renewed",
              meta: { oldTier, newTier, cyclePoints, note: `Gia hạn thành công hạng ${newTier}` },
              balanceAfter: user.loyaltyPoints,
            },
          });
          renewed += 1;
        } else {
          const newExpiresAt = newTier === "basic" ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
          await tx.$executeRaw`
            UPDATE "user_accounts"
            SET
              "loyalty_tier"            = ${newTier}::loyalty_tier,
              "loyalty_tier_expires_at" = ${newExpiresAt},
              "loyalty_tier_updated_at" = now(),
              "updated_at"              = now()
            WHERE "id" = ${user.id}::uuid
          `;
          await tx.loyalty_point_logs.create({
            data: {
              customerId: user.id,
              delta: 0,
              reason: "tier_downgraded",
              meta: { oldTier, newTier, cyclePoints, note: `Hạ bậc từ ${oldTier} xuống ${newTier} do không đủ điểm duy trì` },
              balanceAfter: user.loyaltyPoints,
            },
          });
          downgraded += 1;
        }
      });
    }

    return { renewed, downgraded };
  }

  /**
   * Quét và trừ các điểm tích luỹ quá 12 tháng chưa dùng (gọi từ cron hàng đêm).
   */
  async expireOutdatedPoints(): Promise<{ expiredCount: number; pointsDeducted: number }> {
    const now = new Date();
    const expiredPointLogs = await this.prisma.loyalty_point_logs.findMany({
      where: {
        delta: { gt: 0 },
        reason: "earn_rental",
        expiresAt: { lte: now },
      },
      select: {
        id: true,
        customerId: true,
        delta: true,
      },
    });

    let expiredCount = 0;
    let pointsDeducted = 0;

    for (const log of expiredPointLogs) {
      const alreadyHandled = await this.prisma.loyalty_point_logs.findFirst({
        where: {
          customerId: log.customerId,
          reason: "points_expired",
          meta: { path: ["expiredLogId"], equals: log.id },
        },
      });
      if (alreadyHandled) continue;

      await this.prisma.runSerializable(async (tx) => {
        const user = await tx.userAccount.findUnique({
          where: { id: log.customerId },
          select: { loyaltyPoints: true },
        });
        if (!user || user.loyaltyPoints <= 0) return;

        const deduct = Math.min(user.loyaltyPoints, log.delta);
        if (deduct <= 0) return;

        await tx.$executeRaw`
          UPDATE "user_accounts"
          SET
            "loyalty_points" = GREATEST(0, "loyalty_points" - ${deduct}),
            "updated_at"     = now()
          WHERE "id" = ${log.customerId}::uuid
        `;

        const newBalance = user.loyaltyPoints - deduct;
        await tx.loyalty_point_logs.create({
          data: {
            customerId: log.customerId,
            delta: -deduct,
            reason: "points_expired",
            meta: { expiredLogId: log.id, originalPoints: log.delta, note: "Điểm thưởng hết hạn sau 12 tháng" },
            balanceAfter: newBalance,
          },
        });

        expiredCount += 1;
        pointsDeducted += deduct;
      });
    }

    return { expiredCount, pointsDeducted };
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

