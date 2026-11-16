import { BookingStatus } from "@prisma/client";

/**
 * Mục 4.4 — hằng số dùng chung cho phát hiện sự cố đổi mẫu.
 * Viết trong code (không dùng bảng settings). Có thể tắt cron quét bằng env
 * `INCIDENT_SCAN_ENABLED` (đọc trong `runIncidentScan`).
 */

/** Quét các đơn có ngày thuê trong vòng N ngày tới (so sánh `<=`). */
export const INCIDENT_SCAN_WINDOW_DAYS = 2;
/** Thời gian giữ chỗ tạm (phút) cho một yêu cầu đổi do khách tạo. */
export const INCIDENT_HOLD_MINUTES = 10;
/**
 * Đề xuất đổi mẫu do quản lý gửi khách: giữ chỗ mẫu thay thế 30 phút để khách
 * kịp mở email, xác nhận và thanh toán phần chênh. Hết hạn thì cron giải phóng
 * hold và trả sự cố về cho quản lý xử lý tiếp.
 */
export const INCIDENT_MANAGER_HOLD_MINUTES = 30;
/** Số đơn tối đa mỗi vòng quét. */
export const INCIDENT_SCAN_BATCH_SIZE = 100;

/** Trạng thái đơn còn "trước bàn giao": được phát hiện và đổi mẫu/bỏ món/hủy. */
export const PRE_HANDOVER_STATUSES: BookingStatus[] = [
  BookingStatus.pending_confirmation,
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
  BookingStatus.paid,
  BookingStatus.preparing,
  BookingStatus.ready_for_pickup,
];

/**
 * Trạng thái đơn đủ điều kiện MỞ sự cố đổi mẫu (§13/§4.4).
 *
 * KHÔNG gồm `pending_confirmation`: đơn chưa được khách xác nhận thì hệ thống
 * cố ý CHƯA gán asset thật (xem `AUTO_ASSIGNABLE_STATUSES`), nên "thiếu asset"
 * là bình thường. Quét vào sẽ mở sự cố giả rồi tự đóng khi đơn chuyển sang
 * `confirmed`. Chỉ đánh giá từ `confirmed` trở lên (tới trước khi bàn giao).
 */
export const INCIDENT_ELIGIBLE_STATUSES: BookingStatus[] = PRE_HANDOVER_STATUSES.filter(
  (status) => status !== BookingStatus.pending_confirmation,
);

/** Trạng thái sự cố được coi là "đang mở" (chặn tạo trùng qua partial unique index). */
export const OPEN_INCIDENT_STATUSES = ["open", "awaiting_customer", "needs_manager"] as const;
