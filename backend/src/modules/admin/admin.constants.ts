import { AppRole } from "@prisma/client";

export type AdminSettingKind = "number" | "text" | "json";

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
    defaultValue: { value: "123 Lê Thánh Tôn, Bến Nghé, Quận 1, TP.HCM" },
  },
  {
    key: "store_phone",
    label: "Số điện thoại cửa hàng",
    description: "Số điện thoại hỗ trợ và xác nhận đơn.",
    kind: "text",
    defaultValue: { value: "0901999888" },
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
    defaultValue: { value: "10.7769" },
  },
  {
    key: "store_lng",
    label: "Kinh độ atelier",
    description: "Tọa độ kinh độ (longitude) của atelier, dùng để tính phí giao hàng.",
    kind: "text",
    defaultValue: { value: "106.7009" },
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
    key: "pricing_fail_fast_per_round",
    label: "Fail-fast toàn lượt (pricing)",
    description: "Khi bật, nếu một size lỗi (sàn > trần, thiếu giá nhập...) sẽ dừng cả lượt sinh thay vì bỏ qua size đó.",
    kind: "json",
    defaultValue: { value: false },
  },
];

export const ADMIN_ROLE_OPTIONS: AppRole[] = ["customer", "staff", "manager_owner", "admin"];

