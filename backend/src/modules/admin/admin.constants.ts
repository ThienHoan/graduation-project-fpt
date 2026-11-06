import { AppRole } from "@prisma/client";

export type AdminSettingKind = "number" | "text" | "json";

export interface DamageFeeEntry {
  /** Tên loại lỗi, hiển thị cho staff khi chọn, e.g. "Rách nhẹ", "Mất khuy" */
  label: string;
  /** Tiền phạt cố định (VND). Nếu set, penalty = amount bất kể giá trị đồ */
  amount?: number | null;
  /** Phần trăm giá trị đồ (0-100). Dùng khi amount không set */
  pct?: number | null;
  /** Các nấc % định sẵn cho nhân viên chọn nhanh (VD: [30, 40, 50, 60]) */
  tiers?: number[] | null;
  /** Phân loại mức độ nặng */
  severity: "low" | "medium" | "high" | "severe";
}

export type DamageFeeTable = DamageFeeEntry[];

export type AdminSettingDefinition = {
  key: string;
  label: string;
  description: string;
  kind: AdminSettingKind;
  defaultValue: unknown;
};

export const ADMIN_SETTING_DEFINITIONS: AdminSettingDefinition[] = [
  {
    key: "max_rental_days",
    label: "Số ngày thuê tối đa",
    description: "Giới hạn số ngày của một đơn thuê trước khi hệ thống chặn lưu đơn.",
    kind: "number",
    defaultValue: { value: 30 },
  },
  {
    key: "deposit_refund_window_h",
    label: "Thời gian hoàn cọc",
    description: "Số giờ xử lý hoàn cọc sau khi đơn kết thúc.",
    kind: "number",
    defaultValue: { value: 48 },
  },
  {
    key: "late_penalty_per_day",
    label: "Phí trễ theo ngày",
    description: "Mức phí áp dụng cho mỗi ngày trả trễ hoặc quá hạn.",
    kind: "number",
    defaultValue: { value: 200000 },
  },
  {
    key: "store_address",
    label: "Địa chỉ cửa hàng",
    description: "Địa chỉ hiển thị trên cổng vận hành và phiếu hỗ trợ.",
    kind: "text",
    defaultValue: { value: "Đại học FPT Đà Nẵng, Khu đô thị FPT City, Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng" },
  },
  {
    key: "store_phone",
    label: "Số điện thoại cửa hàng",
    description: "Số điện thoại hỗ trợ và xác nhận đơn.",
    kind: "text",
    defaultValue: { value: "0236 730 0999" },
  },
  {
    key: "business_hours",
    label: "Giờ hoạt động",
    description: "Khung giờ vận hành để bộ phận điều phối tham chiếu.",
    kind: "json",
    defaultValue: { open: "08:00", close: "20:00", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  },
  {
    key: "store_lat",
    label: "Vĩ độ atelier",
    description: "Tọa độ vĩ độ (latitude) của atelier, dùng để tính phí giao hàng.",
    kind: "text",
    defaultValue: { value: "15.967945" },
  },
  {
    key: "store_lng",
    label: "Kinh độ atelier",
    description: "Tọa độ kinh độ (longitude) của atelier, dùng để tính phí giao hàng.",
    kind: "text",
    defaultValue: { value: "108.260727" },
  },
  {
    key: "shipping_fee_intra",
    label: "Phí giao hàng nội miền",
    description: "Cước vận chuyển (VND) khi atelier và khách cùng miền, theo bảng giá Viettel Post.",
    kind: "number",
    defaultValue: { value: 24000 },
  },
  {
    key: "shipping_fee_adjacent",
    label: "Phí giao hàng cận miền",
    description: "Cước vận chuyển (VND) giữa hai miền liền kề (Bắc–Trung, Trung–Nam), theo bảng giá Viettel Post.",
    kind: "number",
    defaultValue: { value: 32000 },
  },
  {
    key: "shipping_fee_inter",
    label: "Phí giao hàng liên miền",
    description: "Cước vận chuyển (VND) tuyến Bắc–Nam, theo bảng giá Viettel Post.",
    kind: "number",
    defaultValue: { value: 38000 },
  },
  {
    key: "pricing_target_rental_days",
    label: "Số ngày thuê kỳ vọng (pricing)",
    description: "Dùng để tính giá sàn: purchase_cost / target_rental_days. Nhỏ hơn hoặc bằng 0 → cấu hình lỗi.",
    kind: "number",
    defaultValue: { value: 30 },
  },
  {
    key: "pricing_abs_min_per_day",
    label: "Giá sàn tuyệt đối/ngày (pricing)",
    description: "Mức giá tối thiểu tuyệt đối mỗi ngày, áp cùng với mức sàn theo giá nhập.",
    kind: "number",
    defaultValue: { value: 0 },
  },
  {
    key: "pricing_max_uplift_pct",
    label: "Phần trăm tăng giá tối đa (pricing)",
    description: "Giới hạn trần giá: base_price × (1 + max_uplift_pct/100). Nhỏ hơn 0 → cấu hình lỗi.",
    kind: "number",
    defaultValue: { value: 50 },
  },
  {
    key: "pricing_advice_lead_days",
    label: "Số ngày khuyên trước sự kiện (pricing)",
    description: "Scheduler mỗi ngày sinh đề xuất cho sự kiện bắt đầu trong X ngày tới.",
    kind: "number",
    defaultValue: { value: 7 },
  },
  {
    key: "booking_auto_confirm_enabled",
    label: "Tự duyệt đơn cho khách quen",
    description: "Đơn trả tiền mặt của khách đủ điều kiện sẽ được hệ thống xác nhận ngay, không chờ nhân viên.",
    kind: "json",
    defaultValue: { value: true },
  },
  {
    key: "booking_auto_confirm_min_completed",
    label: "Số đơn hoàn tất tối thiểu để tự duyệt",
    description: "Khách cần đã thuê thành công ít nhất bấy nhiêu đơn (và chưa từng bị phạt trễ/hư hỏng) mới được tự duyệt.",
    kind: "number",
    defaultValue: { value: 1 },
  },
  {
    key: "booking_auto_confirm_max_total",
    label: "Giá trị đơn tối đa được tự duyệt (VND)",
    description: "Đơn có tổng tiền thuê + cọc + phí giao lớn hơn mức này vẫn chuyển nhân viên duyệt tay.",
    kind: "number",
    defaultValue: { value: 3000000 },
  },
  {
    key: "asset_issue_voucher_percent",
    label: "Voucher xin lỗi khi hết áo thay thế (%)",
    description: "Khi áo đã gán bị hỏng mà không còn chiếc cùng size, khách nhận voucher giảm bấy nhiêu % cho lần thuê sau. Đặt 0 để tắt.",
    kind: "number",
    defaultValue: { value: 20 },
  },
  {
    key: "asset_issue_voucher_max_amount",
    label: "Mức giảm tối đa của voucher xin lỗi (VND)",
    description: "Giới hạn số tiền giảm của voucher xin lỗi để tránh giảm quá lớn cho đơn giá trị cao.",
    kind: "number",
    defaultValue: { value: 200000 },
  },
  {
    key: "pricing_fail_fast_per_round",
    label: "Fail-fast toàn lượt (pricing)",
    description: "Khi bật, nếu một size lỗi (sàn > trần, thiếu giá nhập...) sẽ dừng cả lượt sinh thay vì bỏ qua size đó.",
    kind: "json",
    defaultValue: { value: false },
  },
  {
    key: "laundry_buffer_days",
    label: "Ngày đệm giặt sau trả đồ",
    description: "Số ngày khoá lịch sau ngày trả để có thời gian giặt hấp trước khi cho thuê tiếp. Mặc định 1.",
    kind: "number",
    defaultValue: { value: 1 },
  },
  {
    key: "damage_fee_table",
    label: "Bảng định mức lỗi kiểm tra",
    description: "Danh sách loại lỗi và mức tiền phạt. Admin chỉnh sửa JSON. Staff chọn loại lỗi → hệ thống điền tiền tự động.",
    kind: "json",
    defaultValue: [
      { label: "Rách nhỏ / sờn vải nhẹ", amount: 50000, severity: "low" },
      { label: "Mất khuy / tuột chỉ", amount: 30000, severity: "low" },
      { label: "Vết bẩn không giặt sạch", amount: 80000, severity: "medium" },
      { label: "Rách to / mất phụ kiện đính", pct: 20, tiers: [15, 20, 25, 30], severity: "medium" },
      { label: "Biến dạng / ố vàng nghiêm trọng", pct: 40, tiers: [30, 40, 50, 60], severity: "high" },
      { label: "Hư hỏng không phục hồi / mất đồ", pct: 100, severity: "severe" },
    ],
  },
];

export const ADMIN_ROLE_OPTIONS: AppRole[] = ["customer", "staff", "manager_owner", "admin"];


export const ADMIN_ROLE_LABELS: Record<AppRole, string> = {
  admin: "Quản trị viên",
  manager_owner: "Quản lý / Chủ cửa hàng",
  staff: "Nhân viên",
  customer: "Khách hàng",
};

export const ADMIN_AREA_LABELS: Record<string, string> = {
  accessories: "Phụ kiện",
  admin: "Quản trị hệ thống",
  ai: "AI",
  analytics: "Thống kê",
  assets: "Kho trang phục",
  bookings: "Đơn thuê",
  chat: "Chat & FAQ",
  financial: "Tài chính",
  garments: "Trang phục",
  inspections: "Kiểm tra trả hàng",
  notifications: "Thông báo",
  payments: "Thanh toán",
  pricing: "Giá thuê",
  refunds: "Hoàn tiền",
  reviews: "Đánh giá",
  users: "Người dùng",
  vouchers: "Voucher",
  wishlist: "Yêu thích",
};

export const ADMIN_SETTING_KEYS = new Set(ADMIN_SETTING_DEFINITIONS.map((definition) => definition.key));
