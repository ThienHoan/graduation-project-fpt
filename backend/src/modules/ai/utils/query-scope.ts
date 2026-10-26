import type { ExclusionTarget, ProductFilters, QueryScope } from "../interfaces/ai-response.interface";
import { isBrowseQuestion } from "./browse-detector";
import {
  CATEGORY_MAP,
  COLOR_SYNONYMS,
  OCCASION_KEYS_BY_LENGTH,
  extractCategory,
  extractColor,
  extractOccasion,
  extractFilters,
  extractSize,
} from "./filter-extractor";

const TARGET_END =
  String.raw`(?=\s+(?:thì|shop|cửa\s+hàng|em|mình|ạ|nhé|nha|còn|có|xem|tìm|muốn|chỉ|mà|nhưng)\s|[,.!?;]|$)`;

const EXCLUSION_PATTERN = new RegExp(
  String.raw`(?:^|\s)(?:ngoài(?:\s+ra)?|trừ|không\s+tính|bỏ\s+qua|bên\s+cạnh|khác\s+(?:với|so\s+với)|không\s+(?:cần|muốn|thích|lấy|dùng))\s+(.+?)${TARGET_END}`,
  "giu",
);

const KHAC_PATTERN = new RegExp(
  String.raw`(?:^|\s)khác\s+(.+?)${TARGET_END}`,
  "giu",
);

const BARE_KHAC_PATTERN = /(?:^|\s)khác(?=\s|$|[.,!?;])/giu;

const REFERENCE_PATTERN =
  /(?:^|\s)(?:mẫu|cái|chiếc|bộ|sản\s+phẩm|áo\s+dài|váy|đầm|vest|suit|cổ\s+phục)\s+(?:này|đó|trên|vừa\s+gửi|vừa\s+xem|ở\s+trên|vừa\s+tư\s+vấn|vừa\s+nói)(?=\s|$|[.,;:!?])/iu;

const GENERIC_TARGET_WORDS = new Set([
  "sản", "phẩm", "trang", "phục", "đồ", "loại", "các", "những", "mẫu", "bộ",
  "nào", "gì", "còn", "có", "shop", "cửa", "hàng", "em", "mình", "thì", "và",
  "hoặc", "của", "cho", "xem", "tìm", "muốn", "cần", "thêm", "nữa", "ra",
  "khác", "ngoài", "trừ", "bên", "cạnh", "so", "với", "không", "tính", "bỏ",
  "qua", "rồi", "nhé", "ạ", "nha", "này", "đó", "kia", "ấy", "trên", "dưới",
]);

type ExclusionMatch = {
  index: number;
  full: string;
  target: string;
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectMatches(pattern: RegExp, message: string): ExclusionMatch[] {
  const matches: ExclusionMatch[] = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    const target = (match[1] ?? "").trim();
    matches.push({
      index: match.index,
      full: match[0],
      target,
    });
    if (match[0].length === 0) regex.lastIndex += 1;
  }

  return matches;
}

function collectBareKhac(message: string): ExclusionMatch[] {
  const matches: ExclusionMatch[] = [];
  const regex = new RegExp(BARE_KHAC_PATTERN.source, BARE_KHAC_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    matches.push({
      index: match.index,
      full: match[0],
      target: "",
    });
  }

  return matches;
}

function uniqueLower(values?: string[]): string[] | undefined {
  if (!values?.length) return undefined;
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function stripKnownFragments(text: string, colors?: string[], sizes?: string[], occasions?: string[]): string {
  let residual = text.toLowerCase();

  const categoryKeys = Object.keys(CATEGORY_MAP).sort((a, b) => b.length - a.length);
  for (const key of categoryKeys) {
    residual = residual.replace(new RegExp(escapeRegex(key), "giu"), " ");
  }

  const colorSynonyms = [...new Set(Object.values(COLOR_SYNONYMS).flat())]
    .sort((a, b) => b.length - a.length);
  for (const synonym of colorSynonyms) {
    residual = residual.replace(new RegExp(escapeRegex(synonym), "giu"), " ");
  }

  for (const phrase of OCCASION_KEYS_BY_LENGTH) {
    residual = residual.replace(new RegExp(escapeRegex(phrase), "giu"), " ");
  }

  residual = residual.replace(/(?:size|cỡ|số)\s+\S{1,8}/giu, " ");
  for (const size of sizes ?? []) {
    residual = residual.replace(
      new RegExp(String.raw`(?:^|\s)${escapeRegex(size)}(?=\s|$|[.,;:!?])`, "giu"),
      " ",
    );
  }

  // Màu đã được tách riêng; xoá thêm các từ màu còn sót để residual chỉ còn
  // phần nhận diện tên mẫu.
  for (const color of colors ?? []) {
    residual = residual.replace(
      new RegExp(String.raw`(?:^|\s)${escapeRegex(color)}(?=\s|$|[.,;:!?])`, "giu"),
      " ",
    );
  }

  for (const occasion of occasions ?? []) {
    residual = residual.replace(
      new RegExp(String.raw`(?:^|\s)${escapeRegex(occasion)}(?=\s|$|[.,;:!?])`, "giu"),
      " ",
    );
  }

  return residual;
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/^[.,;:!?()[\]{}"']+|[.,;:!?()[\]{}"']+$/g, ""))
    .filter((token) =>
      token.length > 0 &&
      !GENERIC_TARGET_WORDS.has(token) &&
      !/^\d+$/.test(token),
    );
}

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeForMatch(text: string): string[] {
  return normalizeForMatch(text).split(" ").filter(Boolean);
}

function classifyTarget(target: string): ExclusionTarget {
  const text = target.replace(/\s+/g, " ").trim();
  if (!text) {
    return { kind: "product", text: "", refersToLastProduct: true };
  }

  const lower = text.toLowerCase();
  const endsWithTren = /(?:^|\s)trên$/u.test(lower) && !/\d/.test(lower);
  const isPriceRange = /(?:trên|dưới|khoảng|từ)\s+[\d.,]/iu.test(lower);
  if ((REFERENCE_PATTERN.test(lower) || endsWithTren) && !isPriceRange) {
    return {
      kind: "product",
      text,
      categories: extractCategory(text),
      refersToLastProduct: true,
    };
  }

  const categories = extractCategory(text);
  const colors = uniqueLower(extractColor(text));
  const sizes = extractSize(text);
  const occasions = extractOccasion(text);

  const residual = stripKnownFragments(text, colors, sizes, occasions);
  const nameTokens = tokenizeForMatch(tokenize(residual).join(" "));

  if (nameTokens.length === 0) {
    if (categories?.length && !colors && !sizes && !occasions) {
      return { kind: "category", text, categories };
    }

    return {
      kind: "attribute",
      text,
      categories,
      colors,
      sizes,
      occasions,
    };
  }

  return {
    kind: "product",
    text,
    categories,
    colors,
    sizes,
    occasions,
    nameTokens,
  };
}

/**
 * Tách các cụm loại trừ khỏi câu hỏi và trả về phần còn lại để trích bộ lọc
 * khách vẫn muốn giữ.
 *
 * Ví dụ:
 * - "áo dài khác ngoài áo dài đỏ" → remainder "áo dài khác", target "áo dài đỏ"
 * - "không cần áo dài, xem váy" → remainder "xem váy", target "áo dài"
 */
export function stripExclusionClauses(message: string): {
  remainder: string;
  targets: ExclusionTarget[];
} {
  let matches = collectMatches(EXCLUSION_PATTERN, message);

  if (matches.length === 0) {
    matches = collectMatches(KHAC_PATTERN, message);
  }

  if (matches.length === 0) {
    matches = collectBareKhac(message);
  }

  let remainder = message;
  const sorted = [...matches].sort((a, b) => b.index - a.index);
  for (const match of sorted) {
    remainder = `${remainder.slice(0, match.index)} ${remainder.slice(match.index + match.full.length)}`;
  }

  const targets = matches
    .map((match) => classifyTarget(match.target))
    .filter((target) => {
      // "Ngoài ra shop còn gì" không phải loại trừ sản phẩm nào.
      if (target.kind !== "attribute") return true;
      return Boolean(
        target.categories?.length ||
        target.colors?.length ||
        target.sizes?.length ||
        target.occasions?.length ||
        target.nameTokens?.length,
      );
    });
  const deduped = targets.filter((target, index) => {
    const key = `${target.kind}|${target.text}|${target.refersToLastProduct ? "last" : ""}`;
    return targets.findIndex((item) => {
      const itemKey = `${item.kind}|${item.text}|${item.refersToLastProduct ? "last" : ""}`;
      return itemKey === key;
    }) === index;
  });

  return {
    remainder: remainder.replace(/\s+/g, " ").trim(),
    targets: deduped,
  };
}

export function buildQueryScope(message: string): QueryScope {
  const { remainder, targets } = stripExclusionClauses(message);
  const filters: ProductFilters = extractFilters(remainder);

  const excludedCategories = new Set(
    targets
      .filter((target) => target.kind === "category")
      .flatMap((target) => target.categories ?? []),
  );

  if (filters.category?.length) {
    const kept = filters.category.filter((category) => !excludedCategories.has(category));
    if (kept.length > 0) {
      filters.category = kept;
    } else {
      delete filters.category;
    }
  }

  const hasKeepFilter = Boolean(
    filters.category?.length ||
    filters.color?.length ||
    filters.size?.length ||
    filters.occasion?.length ||
    filters.budgetMin !== undefined ||
    filters.budgetMax !== undefined ||
    filters.keyword,
  );

  return {
    filters,
    exclusions: targets,
    browse: isBrowseQuestion(message) || (targets.length > 0 && !hasKeepFilter),
    isExclusionQuestion: targets.length > 0,
  };
}
