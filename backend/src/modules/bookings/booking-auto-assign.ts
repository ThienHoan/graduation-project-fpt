import { AssetStatus, BookingStatus } from "@prisma/client";

/** Đơn ở các trạng thái này được hệ thống tự gán áo/phụ kiện thật. */
export const AUTO_ASSIGNABLE_STATUSES: BookingStatus[] = [
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
  BookingStatus.paid,
  BookingStatus.preparing,
];

/** Chỉ tự gán cho đơn bắt đầu trong vòng N ngày tới: gán sát ngày giúp tránh chọn
 * phải chiếc áo có thể hỏng/bảo trì trước ngày thuê. Đơn xa hơn manager vẫn gán tay được. */
export const AUTO_ASSIGN_LEAD_DAYS = 3;

/** Khoảng nghỉ tối thiểu giữa hai lượt thuê để kịp kiểm đồ + giặt hấp. */
export const MIN_TURNAROUND_DAYS = 2;

const DAY_MS = 86_400_000;

// Đơn chưa xong vòng đời: áo có thể chưa về kho / chưa giặt xong.
const UNSETTLED_STATUSES: BookingStatus[] = [
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
  BookingStatus.paid,
  BookingStatus.preparing,
  BookingStatus.ready_for_pickup,
  BookingStatus.delivering,
  BookingStatus.renting,
  BookingStatus.overdue,
  BookingStatus.returned,
  BookingStatus.inspection_pending,
];

const NOT_COUNTED_FOR_WEAR: BookingStatus[] = [BookingStatus.cancelled, BookingStatus.rejected];

const STATUS_RANK: Partial<Record<AssetStatus, number>> = {
  [AssetStatus.available]: 0,
  [AssetStatus.reserved]: 1,
  [AssetStatus.rented]: 2,
};

export interface AssetCandidate {
  id: string;
  code: string;
  status: AssetStatus;
  bookings: Array<{ status: BookingStatus; rentalStartDate: Date; rentalEndDate: Date }>;
}

export interface RankedAssetCandidate extends AssetCandidate {
  usageCount: number;
  tightTurnaround: boolean;
}

/**
 * Xếp hạng các chiếc áo/phụ kiện thật có thể gán cho một đơn bắt đầu ngày `startDay`.
 * Ưu tiên theo thứ tự:
 *  1. Không bị "nối đuôi" sát một lượt thuê chưa xong (cần ≥ MIN_TURNAROUND_DAYS để kiểm + giặt).
 *  2. Đang có sẵn trong kho trước, rồi đang giữ, rồi đang cho thuê.
 *  3. Ít lượt thuê hơn → cân bằng độ hao mòn giữa các chiếc.
 *  4. Mã tài sản (ổn định, dễ đoán).
 * Hàm chỉ sắp xếp; kiểm tra trùng lịch chính thức vẫn nằm trong transaction gán.
 */
export function rankAssetCandidates(
  candidates: AssetCandidate[],
  startDay: Date,
  options: { minTurnaroundDays?: number } = {},
): RankedAssetCandidate[] {
  const minTurnaround = options.minTurnaroundDays ?? MIN_TURNAROUND_DAYS;
  return candidates
    .filter((candidate) => STATUS_RANK[candidate.status] !== undefined)
    .map((candidate) => {
      const usageCount = candidate.bookings.filter((b) => !NOT_COUNTED_FOR_WEAR.includes(b.status)).length;
      const tightTurnaround = candidate.bookings.some((b) => {
        if (!UNSETTLED_STATUSES.includes(b.status)) return false;
        if (b.rentalEndDate >= startDay) return false;
        const gapDays = Math.round((startDay.getTime() - b.rentalEndDate.getTime()) / DAY_MS);
        return gapDays < minTurnaround;
      });
      return { ...candidate, usageCount, tightTurnaround };
    })
    .sort((a, b) =>
      Number(a.tightTurnaround) - Number(b.tightTurnaround) ||
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      a.usageCount - b.usageCount ||
      a.code.localeCompare(b.code),
    );
}
