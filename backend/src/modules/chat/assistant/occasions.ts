/**
 * Dịp/sự kiện khách hay hỏi ("đi Tết", "dự tiệc", "đám cưới"...) — dùng chung
 * cho bộ phân loại (định tuyến) và DbHandlersService (lọc `garment.occasion`)
 * để hai bên không lệch nhau.
 *
 * Tất cả keyword đã bỏ dấu, viết thường. So khớp bằng `includes` trên câu đã
 * chuẩn hoá nên phải dùng cụm đủ dài, tránh từ quá ngắn gây khớp nhầm.
 */
export const OCCASION_KEYWORDS = [
  "tet nguyen dan",
  "le tet",
  "tet",
  "dam cuoi",
  "le cuoi",
  "vu quy",
  "du tiec",
  "tiec cuoi",
  "tiec",
  "sinh nhat",
  "ky yeu",
  "chup anh cuoi",
  "chup anh",
  "chup hinh",
  "du lich",
  "cong so",
  "di lam",
  "le hoi",
  "bieu dien",
  "hen ho",
  "dao pho",
  "ngoai giao",
  "ra mat",
  "su kien",
] as const;

export type OccasionKeyword = (typeof OCCASION_KEYWORDS)[number];

/** Nhãn tiếng Việt để câu trả lời đọc tự nhiên. */
const OCCASION_LABELS: Record<string, string> = {
  "tet nguyen dan": "Tết Nguyên đán",
  "le tet": "lễ Tết",
  tet: "Tết",
  "dam cuoi": "đám cưới",
  "le cuoi": "lễ cưới",
  "vu quy": "lễ vu quy",
  "du tiec": "dự tiệc",
  "tiec cuoi": "tiệc cưới",
  tiec: "tiệc",
  "sinh nhat": "sinh nhật",
  "ky yeu": "kỷ yếu",
  "chup anh cuoi": "chụp ảnh cưới",
  "chup anh": "chụp ảnh",
  "chup hinh": "chụp hình",
  "du lich": "du lịch",
  "cong so": "công sở",
  "di lam": "đi làm",
  "le hoi": "lễ hội",
  "bieu dien": "biểu diễn",
  "hen ho": "hẹn hò",
  "dao pho": "dạo phố",
  "ngoai giao": "ngoại giao",
  "ra mat": "ra mắt",
  "su kien": "sự kiện",
};

/**
 * Các dịp xuất hiện trong câu (đã bỏ dấu). Trả về theo thứ tự khai báo, có thể
 * nhiều dịp ("đi tiệc cưới" → `["dam cuoi", "tiec cuoi", "tiec"]`).
 */
export function detectOccasions(normalized: string): string[] {
  return OCCASION_KEYWORDS.filter((keyword) => normalized.includes(keyword));
}

/** Nhãn hiển thị của keyword dịp; fallback về chính keyword nếu chưa có nhãn. */
export function occasionLabel(keyword: string): string {
  return OCCASION_LABELS[keyword] ?? keyword;
}
