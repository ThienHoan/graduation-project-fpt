/**
 * Pure business logic policy for determining eligibility and calculating benefits
 * for Customer Thank-You Vouchers (Voucher Tri Ân) awarded upon booking completion.
 *
 * NOTE:
 * - Pure logic: No database queries, no side effects, no mutation.
 * - Timezone safe: Adheres strictly to Asia/Ho_Chi_Minh.
 */

export type ThankYouVoucherDecisionStatus =
  | "ELIGIBLE"
  | "NOT_ELIGIBLE"
  | "ALREADY_ISSUED"
  | "POLICY_UNCONFIRMED";

export interface ThankYouVoucherBenefitConfig {
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscountAmount?: number | null;
  minOrderValue?: number;
  validDays: number;
  excludePenalizedBookings?: boolean;
}

export interface ThankYouVoucherProgramConfig {
  enabled: boolean;
  benefit?: ThankYouVoucherBenefitConfig;
}

export interface ThankYouVoucherBookingInput {
  bookingId: string;
  bookingCode?: string | null;
  customerId: string;
  status: string; // BookingStatus
  penaltyTotal?: number;
  hasDispute?: boolean;
  rentalEndDate?: Date | string;
  alreadyIssued?: boolean;
}

export interface CalculatedVoucherBenefit {
  code: string;
  name: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderValue: number;
  startAt: Date;
  endAt: Date;
  validDays: number;
}

export type ThankYouVoucherPolicyDecision =
  | {
      status: "ELIGIBLE";
      reason: "eligible";
      description: string;
      bookingId: string;
      customerId: string;
      benefit: CalculatedVoucherBenefit;
    }
  | {
      status: "ALREADY_ISSUED";
      reason: "already_issued";
      description: string;
      bookingId: string;
    }
  | {
      status: "NOT_ELIGIBLE";
      reason:
        | "program_disabled"
        | "invalid_booking_status"
        | "booking_cancelled"
        | "booking_penalized"
        | "missing_customer"
        | "invalid_discount_value"
        | "invalid_validity_duration";
      description: string;
      bookingId: string;
    }
  | {
      status: "POLICY_UNCONFIRMED";
      reason: "missing_program_config" | "ambiguous_policy";
      description: string;
      bookingId: string;
    };

/**
 * Builds the standard deterministic voucher code for a given booking:
 * TRIAN-{bookingCode}
 */
export function buildThankYouVoucherCode(bookingId: string, bookingCode?: string | null): string {
  const code =
    bookingCode && bookingCode.trim()
      ? bookingCode.trim().toUpperCase()
      : bookingId.slice(0, 8).toUpperCase();
  return `TRIAN-${code}`;
}

/**
 * Validates and calculates voucher benefit parameters.
 */
export function calculateVoucherBenefit(
  bookingId: string,
  bookingCode: string | null | undefined,
  config: ThankYouVoucherBenefitConfig,
  now: Date = new Date(),
): { valid: true; benefit: CalculatedVoucherBenefit } | { valid: false; reason: "invalid_discount_value" | "invalid_validity_duration"; description: string } {
  // 1. Validate discountValue
  if (config.discountType === "percentage") {
    if (config.discountValue <= 0 || config.discountValue > 100) {
      return {
        valid: false,
        reason: "invalid_discount_value",
        description: `Giá trị phần trăm giảm giá không hợp lệ (${config.discountValue}%). Phải từ 1 đến 100.`,
      };
    }
  } else if (config.discountType === "fixed") {
    if (config.discountValue <= 0) {
      return {
        valid: false,
        reason: "invalid_discount_value",
        description: `Số tiền giảm giá cố định không hợp lệ (${config.discountValue}đ). Phải lớn hơn 0.`,
      };
    }
  }

  // 2. Validate validDays
  if (config.validDays <= 0 || !Number.isInteger(config.validDays)) {
    return {
      valid: false,
      reason: "invalid_validity_duration",
      description: `Thời hạn hiệu lực (${config.validDays} ngày) không hợp lệ. Phải là số nguyên dương.`,
    };
  }

  const code = buildThankYouVoucherCode(bookingId, bookingCode);
  const startAt = new Date(now);
  const endAt = new Date(now.getTime() + config.validDays * 24 * 60 * 60 * 1000);

  const discountText =
    config.discountType === "percentage"
      ? `${config.discountValue}%`
      : `${new Intl.NumberFormat("vi-VN").format(config.discountValue)}đ`;

  return {
    valid: true,
    benefit: {
      code,
      name: `Tri ân khách hàng - Đơn #${code.replace("TRIAN-", "")}`,
      description: `Voucher giảm ${discountText} cảm ơn quý khách đã hoàn tất đơn thuê cổ phục #${code.replace("TRIAN-", "")}.`,
      discountType: config.discountType,
      discountValue: config.discountValue,
      maxDiscountAmount: config.maxDiscountAmount && config.maxDiscountAmount > 0 ? config.maxDiscountAmount : null,
      minOrderValue: config.minOrderValue && config.minOrderValue > 0 ? config.minOrderValue : 0,
      startAt,
      endAt,
      validDays: config.validDays,
    },
  };
}

/**
 * Pure policy evaluation for determining if a booking is eligible for a Thank-You Voucher.
 */
export function evaluateThankYouVoucherPolicy(
  booking: ThankYouVoucherBookingInput,
  program?: ThankYouVoucherProgramConfig | null,
  now: Date = new Date(),
): ThankYouVoucherPolicyDecision {
  const { bookingId, bookingCode, customerId, status, penaltyTotal = 0, hasDispute = false, alreadyIssued = false } = booking;

  // 1. Check if voucher was already issued for this booking
  if (alreadyIssued) {
    return {
      status: "ALREADY_ISSUED",
      reason: "already_issued",
      description: `Đơn hàng #${bookingId} đã được cấp voucher tri ân trước đó. Không cấp trùng.`,
      bookingId,
    };
  }

  // 2. Validate customer
  if (!customerId || !customerId.trim()) {
    return {
      status: "NOT_ELIGIBLE",
      reason: "missing_customer",
      description: "Đơn hàng thiếu thông tin khách hàng nhận voucher.",
      bookingId,
    };
  }

  // 3. Validate booking status
  if (status === "cancelled") {
    return {
      status: "NOT_ELIGIBLE",
      reason: "booking_cancelled",
      description: "Đơn hàng đã bị hủy, không đủ điều kiện nhận voucher tri ân.",
      bookingId,
    };
  }

  if (status !== "completed") {
    return {
      status: "NOT_ELIGIBLE",
      reason: "invalid_booking_status",
      description: `Đơn hàng đang ở trạng thái '${status}', chưa hoàn tất bàn giao và nghiệm thu ('completed').`,
      bookingId,
    };
  }

  // 4. Validate program configuration
  if (!program) {
    return {
      status: "POLICY_UNCONFIRMED",
      reason: "missing_program_config",
      description: "Hệ thống chưa thiết lập cấu hình chương trình voucher tri ân.",
      bookingId,
    };
  }

  if (!program.enabled) {
    return {
      status: "NOT_ELIGIBLE",
      reason: "program_disabled",
      description: "Chương trình tặng voucher tri ân hiện đang tạm tắt.",
      bookingId,
    };
  }

  if (!program.benefit) {
    return {
      status: "POLICY_UNCONFIRMED",
      reason: "ambiguous_policy",
      description: "Chương trình tri ân đang bật nhưng thiếu thông số ưu đãi cụ thể (benefit config).",
      bookingId,
    };
  }

  // 5. Check penalty/dispute exclusion policy
  if (program.benefit.excludePenalizedBookings && (penaltyTotal > 0 || hasDispute)) {
    return {
      status: "NOT_ELIGIBLE",
      reason: "booking_penalized",
      description: `Đơn hàng có phát sinh tiền phạt hư hại (${new Intl.NumberFormat("vi-VN").format(penaltyTotal)}đ) hoặc tranh chấp, không đủ điều kiện tri ân.`,
      bookingId,
    };
  }

  // 6. Calculate benefit parameters
  const calcResult = calculateVoucherBenefit(bookingId, bookingCode, program.benefit, now);
  if (!calcResult.valid) {
    return {
      status: "NOT_ELIGIBLE",
      reason: calcResult.reason,
      description: calcResult.description,
      bookingId,
    };
  }

  return {
    status: "ELIGIBLE",
    reason: "eligible",
    description: "Đơn hàng hoàn tất hợp lệ và đủ điều kiện nhận voucher tri ân.",
    bookingId,
    customerId,
    benefit: calcResult.benefit,
  };
}

