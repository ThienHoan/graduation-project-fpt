import type { ProductFilters } from "../interfaces/ai-response.interface";

// \b does not work with Vietnamese characters (non-ASCII \W).
// Use (?:^|(?<=\s)) / (?=\s|$|[.,;:!?]) instead.

const CATEGORY_MAP: Record<string, string[]> = {
  "áo dài": ["Áo dài truyền thống", "Áo dài cách tân"],
  "váy cưới": ["Váy cưới"],
  "váy": ["Váy cưới"],
  "đầm": ["Váy cưới"],
  "cổ phục": ["Cổ phục"],
  "vest": ["Vest & Suit"],
  "suit": ["Vest & Suit"],
};

const COLOR_SYNONYMS: Record<string, string[]> = {
  "tím": ["tím", "tím sen", "tím than", "tím nhạt", "tím pastel", "tím hoa cà", "tím lavender", "tím hồng"],
  "đỏ": ["đỏ", "đỏ tươi", "đỏ thắm", "đỏ rượu", "đô", "đỏ hồng"],
  "hồng": ["hồng", "hồng phấn", "hồng cánh sen", "hồng nhạt", "hồng đậm", "hồng tím"],
  "xanh": ["xanh", "xanh dương", "xanh lam", "xanh lơ", "xanh da trời", "xanh nước biển", "xanh biển", "xanh lá", "xanh rêu", "xanh cốm", "xanh ngọc", "xanh mint"],
  "trắng": ["trắng", "trắng tinh", "trắng kem", "trắng ngà", "trắng sữa"],
  "đen": ["đen", "huyền", "mun"],
  "vàng": ["vàng", "vàng nhạt", "vàng đậm", "vàng gold", "vàng chanh", "vàng cam", "gold"],
  "nâu": ["nâu", "nâu nhạt", "nâu đậm", "nâu đồng", "nâu đất", "be", "kem"],
  "cam": ["cam", "cam đỏ", "cam vàng", "hồng cam"],
  "xám": ["xám", "xám bạc", "xám tro", "bạc", "ghi"],
};

const SIZE_NORMALIZE: Record<string, string> = {
  "s": "S",
  "m": "M",
  "l": "L",
  "xl": "XL",
  "xxl": "XXL",
  "xxxl": "XXXL",
  "vừa": "M",
  "nhỏ": "S",
  "to": "L",
  "lớn": "L",
  "rất to": "XL",
  "rất lớn": "XL",
};

const GENERAL_STOP_WORDS = new Set([
  "có", "không", "ko", "à", "nhỉ", "hả", "ạ", "nha", "nè", "vậy", "thì", "là",
  "và", "hoặc", "nhưng", "mà", "của", "trong", "với", "cho", "để", "bị", "được",
  "này", "đó", "kia", "ấy", "nào", "mấy", "bao", "nhiêu", "sao", "thế", "gì",
  "tôi", "mình", "tớ", "em", "chị", "anh", "bạn", "quý", "khách", "shop",
  "muốn", "cần", "thích", "đang", "sẽ", "đã", "hãy", "hơi", "rất", "lắm",
  "ơi", "nhé", "nhờ", "giúp", "tư vấn", "cho hỏi", "hỏi", "xin", "làm ơn",
  "còn", "hàng", "hết", "mua", "bán", "xem", "tìm", "kiếm", "sẵn", "gọi", "alo",
  "giá", "tiền", "bao", "đâu", "khi", "loại", "màu", "size", "cỡ", "mẫu",
  "về", "ngừng", "nhập", "tạm", "thuê", "mướn",
  "phù", "hợp", "dành", "mặc", "đi", "dự", "tham",
  "ngân sách", "budget",
]);

// 14 giá trị canonical cho dịp sử dụng. Mọi cách khách nói đều quy về các giá trị này.
const OCCASION_PHRASES: Record<string, string> = {
  // Đám cưới
  "đám cưới": "Đám cưới",
  "đi đám cưới": "Đám cưới",
  "đi ăn cưới": "Đám cưới",
  "lễ thành hôn": "Đám cưới",
  "cưới": "Đám cưới",
  "tiệc cưới": "Đám cưới",
  "đám hỏi": "Đám cưới",
  "lễ cưới": "Đám cưới",

  // Kỷ yếu
  "kỷ yếu": "Kỷ yếu",
  "chụp kỷ yếu": "Kỷ yếu",
  "ảnh kỷ yếu": "Kỷ yếu",

  // Tốt nghiệp
  "tốt nghiệp": "Tốt nghiệp",
  "lễ tốt nghiệp": "Tốt nghiệp",

  // Sinh nhật
  "sinh nhật": "Sinh nhật",
  "tiệc sinh nhật": "Sinh nhật",

  // Chụp ảnh
  "chụp ảnh": "Chụp ảnh",
  "chụp hình": "Chụp ảnh",
  "chụp hình ngoại cảnh": "Chụp ảnh",

  // Chụp ảnh cưới
  "chụp ảnh cưới": "Chụp ảnh cưới",
  "chụp hình cưới": "Chụp ảnh cưới",
  "ảnh cưới": "Chụp ảnh cưới",

  // Chụp ảnh cổ trang
  "chụp ảnh cổ trang": "Chụp ảnh cổ trang",
  "chụp hình cổ trang": "Chụp ảnh cổ trang",
  "ảnh cổ trang": "Chụp ảnh cổ trang",

  // Sự kiện
  "sự kiện": "Sự kiện",
  "event": "Sự kiện",
  "hội nghị": "Sự kiện",
  "họp mặt": "Sự kiện",
  "công sở": "Sự kiện",
  "văn phòng": "Sự kiện",

  // Lễ hội
  "lễ hội": "Lễ hội",
  "hội lễ": "Lễ hội",

  // Tết
  "tết": "Tết",
  "đi tết": "Tết",
  "tết nguyên đán": "Tết",

  // Tiệc
  "tiệc": "Tiệc",
  "đi tiệc": "Tiệc",
  "dự tiệc": "Tiệc",

  // Lễ
  "lễ": "Lễ",
  "đi lễ": "Lễ",
  "lễ tân": "Lễ",

  // Ngoại giao
  "ngoại giao": "Ngoại giao",
  "sự kiện ngoại giao": "Ngoại giao",

  // Dạo phố
  "dạo phố": "Dạo phố",
  "đi chơi": "Dạo phố",
  "du lịch": "Dạo phố",
  "đi du lịch": "Dạo phố",
};

// Cụm dài trước để "chụp ảnh cưới" không bị "chụp ảnh" cắt mất.
const OCCASION_KEYS_BY_LENGTH = Object.keys(OCCASION_PHRASES).sort(
  (a, b) => b.length - a.length,
);

// 14 giá trị canonical, dùng chung cho AI advisor, pricing và form quản trị.
export function getCanonicalOccasions(): string[] {
  return [...new Set(Object.values(OCCASION_PHRASES))];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractOccasion(text: string): string[] | undefined {
  let lower = text.toLowerCase();
  const found = new Set<string>();
  for (const phrase of OCCASION_KEYS_BY_LENGTH) {
    if (!lower.includes(phrase)) continue;
    found.add(OCCASION_PHRASES[phrase]);
    // Xóa mọi lần xuất hiện để các cụm ngắn hơn không match lại phần đã khớp.
    lower = lower.split(phrase).join(" ");
  }
  return found.size > 0 ? [...found] : undefined;
}

function extractCategory(text: string): string[] | undefined {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  for (const [key, categories] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) {
      matches.push(...categories);
    }
  }
  return matches.length > 0 ? [...new Set(matches)] : undefined;
}

function extractColor(text: string): string[] | undefined {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const [canonical, synonyms] of Object.entries(COLOR_SYNONYMS)) {
    for (const syn of synonyms) {
      if (lower.includes(syn)) {
        found.push(canonical);
        break;
      }
    }
  }

  if (found.length === 0) return undefined;

  // Include both lowercase and capitalized variants to handle DB case-sensitivity
  const unique = [...new Set(found)];
  const result: string[] = [];
  for (const c of unique) {
    result.push(c);
    result.push(c.charAt(0).toUpperCase() + c.slice(1));
  }
  return result;
}

function extractSize(text: string): string[] | undefined {
  // Match "size|cỡ|số" followed by a size label (allow Vietnamese chars)
  const sizeRegex = /(?:size|cỡ|số)\s+(\S{1,8})/gi;
  const found: string[] = [];
  let match;

  while ((match = sizeRegex.exec(text)) !== null) {
    const raw = match[1].toLowerCase().trim();
    const normalized = SIZE_NORMALIZE[raw];
    if (normalized) {
      found.push(normalized);
    }
  }

  // Also match standalone size labels
  // Use lookarounds instead of \b to avoid matching "m" inside "tím"
  const standaloneRegex = /(?:^|(?<=\s))(?:xxl|xxxl|xl|s|m|l|vừa|nhỏ|to|lớn|rất\s+to|rất\s+lớn)(?=\s|$|[.,;:!?])/gi;
  while ((match = standaloneRegex.exec(text)) !== null) {
    const raw = match[0].toLowerCase().trim().replace(/\s+/, " ");
    const normalized = SIZE_NORMALIZE[raw];
    if (normalized && !found.includes(normalized)) {
      found.push(normalized);
    }
  }

  return found.length > 0 ? [...new Set(found)] : undefined;
}

function normalizePriceValue(input: string): number | null {
  // Vietnamese format: comma = decimal, dot = thousand separator
  // Examples: "1,2tr" → 1.200.000, "500k" → 500.000, "1.200.000" → 1.200.000
  let s = input.trim();

  // Detect multiplier suffix BEFORE stripping separators
  const multiplier = s.match(/(tr|triệu|k)$/i)?.[1]?.toLowerCase() ?? null;
  const multValue = multiplier === "k" ? 1_000
    : (multiplier === "tr" || multiplier === "triệu") ? 1_000_000
    : 1;

  // Strip multiplier suffix
  s = s.replace(/(tr|triệu|k)$/i, "").trim();

  // Handle Vietnamese decimal: comma → decimal point
  // If there's a comma (and optionally dots as thousand separators):
  // "1,2" → "1.2", "1.200.000" → "1200000"
  if (s.includes(",")) {
    // Remove all dots (thousand separators) first, then replace comma with dot
    s = s.replace(/\./g, "").replace(",", ".");
    // Handle space before comma: "1 ,2" → "1.2"
    s = s.replace(/\s+/g, "");
  } else if (s.includes(".")) {
    // Dots might be thousand separators: "1.200.000" → "1200000"
    // Or decimal: "1.5" → "1.5"
    // Count dots to decide: >1 dot = thousand separators, 1 dot = decimal
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount > 1) {
      s = s.replace(/\./g, "");
    }
    // else: single dot is decimal (keep as is)
  }

  s = s.replace(/\s+/g, "");

  const num = parseFloat(s);
  if (isNaN(num) || num <= 0) return null;

  return num * multValue;
}

function extractBudget(text: string): { budgetMin?: number; budgetMax?: number } | undefined {
  // Normalize number formatting before extraction:
  // "1 ,2" → "1,2", "1 .2" → "1.2", "1. 200" → "1.200"
  const normalized = text.replace(/(\d)\s+([.,])/g, "$1$2");
  const lower = normalized.toLowerCase();
  let budgetMin: number | undefined;
  let budgetMax: number | undefined;

  // "dưới X" or "dưới X (triệu|tr|k)"
  const underMatch = lower.match(/(?:^|(?<=\s))dưới\s+([\d.,]+\s*(triệu|tr|k)?)(?=\s|$|[.,;:!?])/i);
  if (underMatch) {
    const val = normalizePriceValue(underMatch[1]);
    if (val !== null) budgetMax = val;
  }

  // "trên X" or "từ X"
  const overMatch = lower.match(/(?:^|(?<=\s))(trên|từ)\s+([\d.,]+\s*(triệu|tr|k)?)(?=\s|$|[.,;:!?])/i);
  if (overMatch) {
    const val = normalizePriceValue(overMatch[2]);
    if (val !== null) budgetMin = val;
  }

  // "X - Y" or "X đến Y"
  const rangeMatch = lower.match(/([\d.,]+\s*(triệu|tr|k)?)\s*(–|-|đến|->)\s*([\d.,]+\s*(triệu|tr|k)?)(?=\s|$|[.,;:!?])/i);
  if (rangeMatch) {
    const fromVal = normalizePriceValue(rangeMatch[1]);
    const toVal = normalizePriceValue(rangeMatch[4]);
    if (fromVal !== null && toVal !== null) {
      budgetMin = fromVal;
      budgetMax = toVal;
    }
  }

  // "khoảng X"
  const approxMatch = lower.match(/(?:^|(?<=\s))khoảng\s+([\d.,]+\s*(triệu|tr|k)?)(?=\s|$|[.,;:!?])/i);
  if (approxMatch && !rangeMatch) {
    const val = normalizePriceValue(approxMatch[1]);
    if (val !== null) {
      budgetMin = val * 0.8;
      budgetMax = val * 1.2;
    }
  }

  // "giá X" — treat as max (up to X), include cheaper products
  const giaMatch = lower.match(/(?:^|(?<=\s))giá\s+([\d.,]+\s*(triệu|tr|k)?)(?=\s|$|[.,;:!?])/i);
  if (giaMatch && budgetMin === undefined && budgetMax === undefined) {
    const val = normalizePriceValue(giaMatch[1]);
    if (val !== null) {
      budgetMax = val;
    }
  }

  // "X" standalone with k/tr/triệu — treat as max (up to X)
  const standalonePrice = lower.match(/(?:^|(?<=\s))([\d.,]+\s*(triệu|tr|k))(?=\s|$|[.,;:!?])/i);
  if (standalonePrice && budgetMin === undefined && budgetMax === undefined) {
    const val = normalizePriceValue(standalonePrice[0]);
    if (val !== null) {
      budgetMax = val;
    }
  }

  if (budgetMin !== undefined || budgetMax !== undefined) {
    return { budgetMin, budgetMax };
  }
  return undefined;
}

function extractKeyword(text: string): string | undefined {
  // Normalize spaces around digits and separators before cleanup
  let cleaned = text.toLowerCase().trim().replace(/(\d)\s+([.,])/g, "$1$2");

  // Remove common generic phrases that are not product-related
  const genericPhrases = ["sản phẩm", "còn hàng", "hết hàng", "liên hệ", "inbox", "cho thuê", "cho thuê áo dài"];
  for (const phrase of genericPhrases) {
    cleaned = cleaned.replace(new RegExp(phrase, "gi"), "");
  }

  // Remove detected filter fragments
  const categoryKeys = Object.keys(CATEGORY_MAP).sort((a, b) => b.length - a.length);
  for (const key of categoryKeys) {
    cleaned = cleaned.replace(new RegExp(key, "gi"), "");
  }

  const allColorSynonyms = [...new Set(Object.values(COLOR_SYNONYMS).flat())].sort((a, b) => b.length - a.length);
  for (const syn of allColorSynonyms) {
    cleaned = cleaned.replace(new RegExp(syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }

  cleaned = cleaned.replace(/(?:size|cỡ|số)\s+\S{1,8}/gi, "");
  cleaned = cleaned.replace(/(?:^|(?<=\s))(?:xxl|xxxl|xl|s|m|l|vừa|nhỏ|to|lớn|rất\s+to|rất\s+lớn)(?=\s|$|[.,;:!?])/gi, "");

  const occSorted = OCCASION_KEYS_BY_LENGTH;
  for (const phrase of occSorted) {
    cleaned = cleaned.replace(new RegExp(escapeRegex(phrase), "gi"), "");
  }

  // \b doesn't work with Vietnamese → use string includes
  for (const word of ["dưới", "trên", "khoảng", "từ", "đến", "giá", "ngân sách", "budget"]) {
    cleaned = cleaned.replace(new RegExp(word.replace(/\s+/, "\\s+") + "\\s+[\\d.,]+\\s*(triệu|tr|k)?", "gi"), "");
  }
  cleaned = cleaned.replace(/[\d.,]+\s*(triệu|tr|k)/g, "");

  // Remove stop words (strip trailing punctuation for matching)
  const words = cleaned.split(/\s+/).filter((w) => {
    if (w.length === 0) return false;
    const stripped = w.replace(/[.,;:!?]+$/g, "");
    return stripped.length > 0 && !GENERAL_STOP_WORDS.has(stripped);
  });

  // Remove question words
  const result = words.filter((w) => {
    const stripped = w.replace(/[.,;:!?]+$/g, "");
    return stripped.length >= 2;
  }).join(" ").trim();

  return result.length > 0 ? result : undefined;
}

export function extractFilters(message: string): ProductFilters {
  const category = extractCategory(message);
  const color = extractColor(message);
  const size = extractSize(message);
  const budget = extractBudget(message);
  const occasion = extractOccasion(message);
  const keyword = extractKeyword(message);

  return {
    ...(category ? { category } : {}),
    ...(color ? { color } : {}),
    ...(size ? { size } : {}),
    ...(budget ? budget : {}),
    ...(occasion ? { occasion } : {}),
    ...(keyword ? { keyword } : {}),
  };
}
