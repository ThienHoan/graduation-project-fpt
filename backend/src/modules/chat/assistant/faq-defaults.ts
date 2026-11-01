/**
 * Khung FAQ mặc định.
 *
 * Chỉ chứa KEY + template có placeholder; TUYỆT ĐỐI không chứa giá trị
 * nghiệp vụ (địa chỉ, giờ mở cửa, số tài khoản...). Giá trị thật lấy từ
 * SHOP_DATA do chủ shop cung cấp và được nhập qua trang quản trị FAQ.
 *
 * Trường nào chưa có giá trị thì để trống + isActive = false. Router gặp item
 * chưa cấu hình sẽ chuyển STAFF với reason `faq_config_missing`, không render
 * template rỗng và không gọi LLM.
 */

export type FaqSeedItem = {
  key: string;
  intent: string;
  answerTemplate: string;
  requiredParams: string[];
  values: Record<string, string>;
  isActive: boolean;
};

export const BANK_ACCOUNT_REQUIRED_PARAMS = [
  "bank_name",
  "account_number",
  "account_holder",
] as const;

const seed = (
  key: string,
  intent: string,
  answerTemplate: string,
  requiredParams: string[],
): FaqSeedItem => ({
  key,
  intent,
  answerTemplate,
  requiredParams,
  values: {},
  isActive: false,
});

export const FAQ_SEED_ITEMS: FaqSeedItem[] = [
  seed("opening_hours", "faq.opening_hours", "Shop mở cửa {{hours}}.", ["hours"]),
  seed("address", "faq.address", "Địa chỉ shop: {{address}}.", ["address"]),
  seed("phone", "faq.phone", "Hotline/Zalo: {{phone}}.", ["phone"]),
  seed(
    "bank_account",
    "faq.bank_account",
    [
      "Ngân hàng: {{bank_name}}",
      "Số tài khoản: {{account_number}}",
      "Chủ tài khoản: {{account_holder}}",
    ].join("\n"),
    [...BANK_ACCOUNT_REQUIRED_PARAMS],
  ),
  seed(
    "payment_methods",
    "faq.payment_methods",
    "Shop nhận thanh toán: {{methods}}.",
    ["methods"],
  ),
  seed("deposit_policy", "faq.deposit_policy", "Mức cọc: {{deposit}}.", ["deposit"]),
  seed(
    "rental_duration",
    "faq.rental_duration",
    "Thời gian thuê: {{duration}}.",
    ["duration"],
  ),
  seed("shipping", "faq.shipping", "Giao nhận: {{shipping}}.", ["shipping"]),
  seed(
    "late_return_penalty",
    "faq.late_return_penalty",
    "Quy định trả trễ/đền bù: {{penalty}}.",
    ["penalty"],
  ),
  seed("laundry", "faq.laundry", "Vệ sinh trang phục: {{laundry}}.", ["laundry"]),
  seed(
    "documents",
    "faq.documents",
    "Giấy tờ cần mang: {{documents}}.",
    ["documents"],
  ),
  seed(
    "size_exchange_policy",
    "faq.size_exchange_policy",
    "Chính sách đổi size/hủy: {{policy}}.",
    ["policy"],
  ),
  seed(
    "promotions",
    "faq.promotions",
    "Ưu đãi hiện có: {{promotions}}.",
    ["promotions"],
  ),
  seed(
    "accessories_services",
    "faq.accessories_services",
    "Phụ kiện/dịch vụ đi kèm: {{accessories}}.",
    ["accessories"],
  ),
  seed(
    "try_on_appointment",
    "faq.try_on_appointment",
    "Đặt lịch thử đồ: {{try_on}}.",
    ["try_on"],
  ),
];
