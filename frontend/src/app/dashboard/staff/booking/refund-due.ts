import type { StaffBookingResponse } from "@/lib/api";

/**
 * Số tiền staff phải hoàn cho một đơn (khớp đúng số Quản lý sẽ duyệt).
 *
 * - Đơn đã huỷ/từ chối (vd từ chối bàn giao): hoàn TOÀN BỘ tiền khách đã thực thu
 *   trừ các phiếu hoàn đang/đã xử lý. Công thức `cọc + credit − phạt` tính THIẾU
 *   vì tiền thuê đã thu cũng phải trả lại, còn credit đã bị void khi huỷ.
 * - Đơn đang có phiếu hoàn đang chờ nhưng BE chưa kịp trả `cancellationRefund`
 *   → dùng số tiền phiếu hoàn đó (đó chính là số Quản lý sẽ duyệt).
 * - Đơn hoàn cọc thường: cọc + credit đổi mẫu/bỏ món − phạt (§11).
 */
export function staffRefundDue(booking: StaffBookingResponse): number {
  if (booking.cancellationRefund) {
    return Math.max(
      0,
      booking.cancellationRefund.paidTotal - booking.cancellationRefund.coveringRefundsTotal,
    );
  }

  if (booking.status === "cancelled" || booking.status === "rejected") {
    const activeRefund = booking.refunds?.find(
      (r) => r.status === "pending" || r.status === "refunding",
    );
    return activeRefund ? Math.max(0, activeRefund.amount) : 0;
  }

  return Math.max(
    0,
    booking.depositTotal + (booking.accruedCreditTotal ?? 0) - (booking.penaltyTotal ?? 0),
  );
}