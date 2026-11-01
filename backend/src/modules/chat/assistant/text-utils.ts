/**
 * Chuẩn hoá văn bản tiếng Việt cho bộ phân loại rule-based.
 *
 * - Bỏ dấu, đưa về chữ thường để "mức cọc" và "muc coc" khớp nhau.
 * - Chuẩn hoá teencode phổ biến (ko/k/khg -> khong, dc -> duoc, stk, sdt...).
 * - Giữ nguyên ranh giới từ bằng khoảng trắng; không dùng substring trần.
 */

const TOKEN_ALIASES: Record<string, string> = {
  ko: "khong",
  khg: "khong",
  kh: "khong",
  dc: "duoc",
  dk: "duoc",
  sdt: "so dien thoai",
  stk: "so tai khoan",
  ib: "inbox",
  mik: "minh",
  mink: "minh",
  mn: "moi nguoi",
};

const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/\bthank you\b/g, "cam on"],
  [/\bthanks\b/g, "cam on"],
  [/\btks\b/g, "cam on"],
];

export function foldVietnamese(input: string): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function normalizeForMatch(input: string): string {
  const folded = foldVietnamese(input)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[.,;:!?~…"'“”‘’()\[\]{}<>/\\|@#$%^&*+=_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!folded) return "";

  const aliased = PHRASE_ALIASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    folded,
  );

  const tokens = aliased.split(" ").filter(Boolean);

  const mapped = tokens.map((token, index) => {
    if (token === "k") {
      const previous = tokens[index - 1];
      // "size k" là size, "300 k" là 300 nghìn — không đổi thành "không".
      if (previous === "size" || (previous && /^\d+$/.test(previous))) return "k";
      return "khong";
    }
    return TOKEN_ALIASES[token] ?? token;
  });

  return mapped.join(" ").replace(/\s+/g, " ").trim();
}

export function hasMeaningfulContent(input: string): boolean {
  return /[\p{L}\p{N}]/u.test(input ?? "");
}

export function toTokens(normalized: string): string[] {
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

/** True nếu tin nhắn trông như một câu hỏi (dùng cho ngữ cảnh "ok/dạ"). */
export function looksLikeQuestion(input: string): boolean {
  const raw = input ?? "";
  if (raw.includes("?")) return true;

  const normalized = normalizeForMatch(raw);
  if (!normalized) return false;

  const markers = [
    "nao",
    "gi",
    "bao nhieu",
    "o dau",
    "khi nao",
    "may gio",
    "the nao",
    "duoc khong",
    "dung khong",
    "phai khong",
  ];
  if (markers.some((marker) => normalized === marker || normalized.includes(` ${marker} `))) {
    return true;
  }

  // "không"/"chưa" chỉ là dấu hiệu câu hỏi khi nằm ở cuối câu.
  return (
    normalized.endsWith(" khong") ||
    normalized === "khong" ||
    normalized.endsWith(" chua") ||
    normalized === "chua"
  );
}
