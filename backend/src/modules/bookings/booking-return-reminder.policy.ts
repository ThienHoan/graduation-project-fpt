/**
 * Pure policy logic for calculating return deadlines and T-3h return reminder scheduling.
 *
 * NOTE:
 * - Pure logic: No database queries, no side effects, no external dependencies.
 * - Adheres strictly to timezone Asia/Ho_Chi_Minh (UTC+7, no DST).
 * - Distinguishes between:
 *   1) system_midnight: The 00:00:00 next-day cutoff where markOverdueBookings() triggers overdue fees.
 *   2) store_closing: The showroom closing time (e.g. 20:00) when physical return can occur.
 *   3) custom_confirmed: An explicitly agreed-upon return datetime.
 *   4) POLICY_UNCONFIRMED: When only a calendar date is known without an agreed deadline policy.
 */

export const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
export const VN_OFFSET_HOURS = 7;
export const VN_OFFSET_MS = VN_OFFSET_HOURS * 60 * 60 * 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const DEFAULT_RETURN_REMINDER_OFFSET_HOURS = 3; // T-3 hours
export const ELIGIBLE_RETURN_STATUSES = ["renting"];

export type ReturnDeadlineType =
  | "system_midnight"
  | "store_closing"
  | "custom_confirmed";

export interface ReturnPolicyInput {
  bookingId: string;
  status: string;
  rentalEndDate: Date | string;
  timeZone?: string;
  deadlineType?: ReturnDeadlineType;
  storeClosingTime?: string | null; // e.g. "20:00"
  customDeadline?: Date | string | null;
  reminderOffsetHours?: number; // Default 3
  now?: Date;
  hasPendingExtension?: boolean;
}

export type ReturnPolicyDecision =
  | {
      status: "ELIGIBLE";
      deadline: Date;
      scheduledReminderTime: Date;
      isDue: boolean; // now >= scheduledReminderTime && now < deadline
      deadlineType: ReturnDeadlineType;
      reason: string;
      hoursUntilDeadline: number;
      dateStr: string;
    }
  | {
      status: "INELIGIBLE";
      reason:
        | "invalid_status"
        | "past_deadline"
        | "has_pending_extension"
        | "invalid_date";
      description: string;
      bookingId: string;
    }
  | {
      status: "POLICY_UNCONFIRMED";
      reason: "missing_deadline_time" | "ambiguous_policy";
      description: string;
      dateOnly: string;
      suggestedMidnightDeadline: Date;
      suggestedClosingDeadline?: Date;
    };

/**
 * Parses any date/string input and returns the calendar date string YYYY-MM-DD in VN time.
 */
export function extractVnDateString(date: Date | string): string | null {
  if (!date) return null;
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return null;

    // If input is a raw date string like "2026-11-08", return it directly
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }

    // Convert date to VN calendar date (UTC+7)
    const vnTime = new Date(d.getTime() + VN_OFFSET_MS);
    return vnTime.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * Builds a UTC Date object representing a specific VN clock time (YYYY-MM-DD HH:mm:ss in UTC+7).
 */
export function createVnDateTime(
  dateStr: string,
  hour: number,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  // Construct UTC timestamp corresponding to VN local time (UTC+7)
  const utcMillis = Date.UTC(year, month, day, hour - VN_OFFSET_HOURS, minute, second, millisecond);
  return new Date(utcMillis);
}

/**
 * Evaluates whether a return reminder should be scheduled or sent for a booking.
 */
export function evaluateReturnReminderPolicy(
  input: ReturnPolicyInput,
): ReturnPolicyDecision {
  const {
    bookingId,
    status,
    rentalEndDate,
    deadlineType,
    storeClosingTime = "20:00",
    customDeadline,
    reminderOffsetHours = DEFAULT_RETURN_REMINDER_OFFSET_HOURS,
    now = new Date(),
    hasPendingExtension = false,
  } = input;

  // 1. Validate status: only 'renting' bookings are eligible
  if (!ELIGIBLE_RETURN_STATUSES.includes(status)) {
    return {
      status: "INELIGIBLE",
      reason: "invalid_status",
      description: `Đơn hàng đang ở trạng thái '${status}', không thuộc trạng thái đang thuê ('renting').`,
      bookingId,
    };
  }

  // 2. Validate pending extension: if customer is in the middle of extending rental (held for 30m)
  if (hasPendingExtension) {
    return {
      status: "INELIGIBLE",
      reason: "has_pending_extension",
      description: "Đơn hàng đang có yêu cầu gia hạn chờ thanh toán (hold 30 phút). Tạm hoãn nhắc trả.",
      bookingId,
    };
  }

  // 3. Validate rentalEndDate
  const dateStr = extractVnDateString(rentalEndDate);
  if (!dateStr) {
    return {
      status: "INELIGIBLE",
      reason: "invalid_date",
      description: "Ngày kết thúc thuê (rentalEndDate) không hợp lệ hoặc bị thiếu.",
      bookingId,
    };
  }

  // Calculate suggested midnight deadline (00:00 of the next calendar day in VN)
  const [y, m, d] = dateStr.split("-").map(Number);
  const nextDayUtc = Date.UTC(y, m - 1, d + 1, 0 - VN_OFFSET_HOURS, 0, 0, 0);
  const suggestedMidnightDeadline = new Date(nextDayUtc);

  // Calculate suggested store closing deadline (e.g. 20:00 of rentalEndDate in VN)
  let suggestedClosingDeadline: Date | undefined;
  if (storeClosingTime && /^\d{2}:\d{2}$/.test(storeClosingTime)) {
    const [cHour, cMin] = storeClosingTime.split(":").map(Number);
    const closingDate = createVnDateTime(dateStr, cHour, cMin);
    if (closingDate) suggestedClosingDeadline = closingDate;
  }

  // 4. Check deadlineType: if not specified, we cannot guess legal policy -> POLICY_UNCONFIRMED
  if (!deadlineType) {
    return {
      status: "POLICY_UNCONFIRMED",
      reason: "missing_deadline_time",
      description:
        "Dữ liệu đơn thuê chỉ có ngày (date-only) mà chưa có chính sách giờ hẹn trả chính thức (deadlineType).",
      dateOnly: dateStr,
      suggestedMidnightDeadline,
      suggestedClosingDeadline,
    };
  }

  // 5. Resolve actual deadline based on deadlineType
  let resolvedDeadline: Date | null = null;

  if (deadlineType === "system_midnight") {
    resolvedDeadline = suggestedMidnightDeadline;
  } else if (deadlineType === "store_closing") {
    if (!suggestedClosingDeadline) {
      return {
        status: "POLICY_UNCONFIRMED",
        reason: "ambiguous_policy",
        description: `Giờ đóng cửa showroom '${storeClosingTime}' không hợp lệ để tính deadline store_closing.`,
        dateOnly: dateStr,
        suggestedMidnightDeadline,
      };
    }
    resolvedDeadline = suggestedClosingDeadline;
  } else if (deadlineType === "custom_confirmed") {
    if (!customDeadline) {
      return {
        status: "POLICY_UNCONFIRMED",
        reason: "missing_deadline_time",
        description: "Deadline dạng custom_confirmed yêu cầu cung cấp customDeadline cụ thể.",
        dateOnly: dateStr,
        suggestedMidnightDeadline,
        suggestedClosingDeadline,
      };
    }
    const parsed = typeof customDeadline === "string" ? new Date(customDeadline) : customDeadline;
    if (Number.isNaN(parsed.getTime())) {
      return {
        status: "INELIGIBLE",
        reason: "invalid_date",
        description: "customDeadline được cung cấp không hợp lệ.",
        bookingId,
      };
    }
    resolvedDeadline = parsed;
  }

  if (!resolvedDeadline) {
    return {
      status: "POLICY_UNCONFIRMED",
      reason: "ambiguous_policy",
      description: `Không thể xác định deadline hợp lệ cho loại '${deadlineType}'.`,
      dateOnly: dateStr,
      suggestedMidnightDeadline,
    };
  }

  // 6. Calculate scheduled reminder time (T - reminderOffsetHours)
  const scheduledReminderTime = new Date(
    resolvedDeadline.getTime() - reminderOffsetHours * MS_PER_HOUR,
  );

  // 7. Check if deadline has already passed
  if (now.getTime() >= resolvedDeadline.getTime()) {
    return {
      status: "INELIGIBLE",
      reason: "past_deadline",
      description: "Thời hạn trả trang phục đã qua, đơn sẽ chuyển sang luồng xử lý quá hạn.",
      bookingId,
    };
  }

  // 8. Determine if reminder is due
  const isDue = now.getTime() >= scheduledReminderTime.getTime();
  const hoursUntilDeadline = (resolvedDeadline.getTime() - now.getTime()) / MS_PER_HOUR;

  return {
    status: "ELIGIBLE",
    deadline: resolvedDeadline,
    scheduledReminderTime,
    isDue,
    deadlineType,
    reason: isDue
      ? `Đã đến thời điểm nhắc trả T-${reminderOffsetHours}h.`
      : `Chưa đến thời điểm nhắc trả (dự kiến lúc ${scheduledReminderTime.toISOString()}).`,
    hoursUntilDeadline: Math.round(hoursUntilDeadline * 10) / 10,
    dateStr,
  };
}

