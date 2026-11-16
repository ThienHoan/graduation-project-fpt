import { AssetStatus } from "@prisma/client";
import { RENTABLE_ASSET_STATUSES } from "./booking-inventory";

export type IncidentItemKind = "garment" | "accessory";

/**
 * Sự cố do tình trạng asset (không cho thuê được). `maintenance` chỉ là tạm thời
 * nhưng vẫn đánh dấu để nhân viên biết; các trạng thái còn lại là hỏng/mất/ngừng.
 */
const ASSET_REASON: Partial<Record<AssetStatus, string>> = {
  [AssetStatus.damaged]: "asset_damaged",
  [AssetStatus.lost]: "asset_lost",
  [AssetStatus.retired]: "asset_retired",
  [AssetStatus.maintenance]: "asset_maintenance",
};

/** Trả về mã lý do sự cố nếu asset không cho thuê được, ngược lại `null`. */
export function assetIncidentReason(status: AssetStatus): string | null {
  return ASSET_REASON[status] ?? null;
}

/**
 * Một asset chỉ "sẵn sàng" khi đang ở trạng thái cho thuê (`available`/`reserved`/
 * `rented`). Mọi trạng thái khác — kể cả `laundry`, `inspection_pending`,
 * `cleaned` chưa được đưa về available — đều tính là sự cố.
 *
 * Dùng CHUNG cho trang phục và phụ kiện để quét không bỏ sót một loại nào:
 * - Trạng thái có mã riêng (hỏng/mất/ngừng/bảo trì) → giữ mã đó để hiển thị chi tiết.
 * - Trạng thái không cho thuê nhưng chưa có mã riêng → mã dự phòng theo loại món.
 */
export function assetNotReadyReason(status: AssetStatus, kind: IncidentItemKind): string | null {
  if (RENTABLE_ASSET_STATUSES.includes(status)) return null;
  return assetIncidentReason(status) ?? (kind === "garment" ? "no_asset_available" : "accessory_unavailable");
}

const REASON_LABELS: Record<string, string> = {
  asset_damaged: "bị hư hỏng",
  asset_lost: "bị mất",
  asset_retired: "ngừng cho thuê",
  asset_maintenance: "đang bảo trì",
  asset_conflict: "bị trùng lịch với đơn khác",
  no_asset_available: "không còn chiếc cùng size",
  accessory_unavailable: "không còn phụ kiện thay thế",
};

/** Nhãn tiếng Việt cho mã lý do (dùng trong thông báo). */
export function incidentReasonLabel(reason: string, kind: IncidentItemKind = "garment"): string {
  // Các mã lý do do tình trạng asset dùng chung cho cả hai loại → ghép đúng chủ thể.
  if (reason.startsWith("asset_")) {
    const subject = kind === "accessory" ? "phụ kiện" : "trang phục";
    const detail = REASON_LABELS[reason] ?? reason;
    return `${subject} ${detail}`;
  }
  return REASON_LABELS[reason] ?? reason;
}

const RESOLUTION_LABELS: Record<string, string> = {
  replaced: "Đã đổi sang mẫu thay thế",
  removed: "Đã bỏ món khỏi đơn",
  booking_cancelled: "Đơn đã huỷ nên sự cố tự đóng",
  asset_recovered: "Tài sản đã sẵn sàng cho thuê trở lại",
  manual: "Cửa hàng xử lý thủ công",
};

/** Nhãn tiếng Việt cho cách xử lý sự cố (trang quản lý không hiện mã kỹ thuật). */
export function incidentResolutionLabel(resolution: string | null | undefined): string | null {
  if (!resolution) return null;
  return RESOLUTION_LABELS[resolution] ?? resolution;
}
