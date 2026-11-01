import type {
  ClassifierContext,
  ClassifierResult,
  ClassifierSlots,
  ClassifierTrigger,
  RouteType,
} from "./classification.types";
import { isSensitiveHandoff, SENSITIVE_FOLLOWUP_PHRASES } from "./sensitive-followups";
import { detectOccasions } from "./occasions";
import {
  foldVietnamese,
  hasMeaningfulContent,
  looksLikeQuestion,
  normalizeForMatch,
  toTokens,
} from "./text-utils";

/**
 * Bộ phân loại rule-based dùng chung cho Auto-Reply và Staff AI Suggestion.
 *
 * Nguyên tắc:
 * - Khớp theo cụm (nhiều token liên tiếp), không khớp từ đơn lẻ.
 * - Có xử lý phủ định: "không hủy đơn, chỉ hỏi mức cọc" -> FAQ.
 * - Ưu tiên STAFF > FAQ > DB > AI; SKIP/UNKNOWN tách riêng.
 * - Kết quả trả về đủ dữ kiện để router quyết định handler, không gọi LLM
 *   ở bất kỳ nhánh nào ngoài route AI.
 */

type Phrase = { raw: string; tokens: string[] };

function phrase(raw: string): Phrase {
  return { raw, tokens: toTokens(normalizeForMatch(raw)) };
}

function phrases(...raws: string[]): Phrase[] {
  return raws.map(phrase);
}

const NEGATION_TOKENS = new Set(["khong", "chua", "chang"]);
const NEGATION_RESET_TOKENS = new Set([
  "nhung",
  "ma",
  "thi",
  "la",
  "roi",
  "va",
  "con",
  "neu",
  "vi",
  "de",
  "voi",
  "cua",
]);

function findPhraseIndex(tokens: string[], phraseTokens: string[]): number {
  if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) return -1;

  for (let start = 0; start <= tokens.length - phraseTokens.length; start++) {
    let matched = true;
    for (let offset = 0; offset < phraseTokens.length; offset++) {
      if (tokens[start + offset] !== phraseTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }

  return -1;
}

function isNegated(tokens: string[], start: number): boolean {
  for (let index = start - 1, steps = 0; index >= 0 && steps < 4; index--, steps++) {
    const token = tokens[index];
    if (!token) continue;

    if (NEGATION_TOKENS.has(token)) {
      // "không chỉ ... mà còn ..." không phải phủ định hành động.
      if (token === "khong" && tokens[index + 1] === "chi") return false;
      return true;
    }

    if (NEGATION_RESET_TOKENS.has(token)) return false;
  }

  return false;
}

const SENSITIVE_FOLLOWUP_MATCHERS = SENSITIVE_FOLLOWUP_PHRASES.map(phrase);

function findPhrase(
  tokens: string[],
  list: Phrase[],
): { phrase: Phrase; index: number } | null {
  for (const item of list) {
    const index = findPhraseIndex(tokens, item.tokens);
    if (index >= 0 && !isNegated(tokens, index)) {
      return { phrase: item, index };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Slots                                                                      */
/* -------------------------------------------------------------------------- */

const NUMBER_WORDS: Record<string, number> = {
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  nam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
  muoi: 10,
};

const QUANTITY_UNITS = new Set([
  "bo",
  "set",
  "outfit",
  "ao",
  "vay",
  "dam",
  "quan",
  "vest",
  "suit",
]);

function extractQuantity(tokens: string[]): number | undefined {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    const value = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
    if (value === undefined) continue;

    const unit = tokens[index + 1];
    if (unit && QUANTITY_UNITS.has(unit)) return value;

    // "đặt cho 5 người" cũng là đơn nhóm.
    if (unit === "nguoi" && tokens[index - 1] === "cho") return value;

    // "5 bộ đồ", "8 bộ vest"
    const next = tokens[index + 2];
    if (unit === "bo" && next && ["do", "vest", "ao", "vay", "dam"].includes(next)) {
      return value;
    }
  }
  return undefined;
}

const SIZE_PATTERN = /\bsize\s*([2-5]?x[sml]|[sml]|\d{1,2})\b/;
const SHORT_SIZE_PATTERN = /\b([2-5]xl)\b/;
const PREPOSITION_SIZE_PATTERN = /\bco\s+([sml])\b/;
const STANDALONE_SIZE_PATTERN = /^(xs|s|m|l|xl|2xl|3xl)$/;

function extractSize(normalized: string): string | undefined {
  const sizeMatch = normalized.match(SIZE_PATTERN);
  if (sizeMatch?.[1]) return sizeMatch[1].toUpperCase();

  const shortMatch = normalized.match(SHORT_SIZE_PATTERN);
  if (shortMatch?.[1]) return shortMatch[1].toUpperCase();

  const prepMatch = normalized.match(PREPOSITION_SIZE_PATTERN);
  if (prepMatch?.[1]) return prepMatch[1].toUpperCase();

  if (STANDALONE_SIZE_PATTERN.test(normalized)) return normalized.toUpperCase();

  return undefined;
}

/* ------------------------------ Khoảng giá -------------------------------- */

/** Đơn vị giá khách hay gõ tắt: "100k", "1tr", "1 triệu", "500 nghìn". */
const PRICE_UNITS: Record<string, number> = {
  k: 1_000,
  nghin: 1_000,
  ngan: 1_000,
  tr: 1_000_000,
  trieu: 1_000_000,
  m: 1_000_000,
};

/** Từ đứng ngay sau con số trần cho biết đó là mốc giá, không phải số lượng. */
const PRICE_FOLLOW_WORDS = new Set([
  "den",
  "duoi",
  "tren",
  "tro",
  "toi",
  "khong",
  "qua",
  "hon",
]);

type PriceMention = { index: number; value: number; hasUnit: boolean };

/**
 * Đọc một mốc giá tại vị trí `index`.
 *
 * Hỗ trợ "100k", "1tr", "1.5 triệu" (đã tách token), và số trần như "300"
 * trong "từ 300 đến 1 triệu" — số trần dưới 1000 được hiểu là nghìn vì giá
 * thuê theo ngày luôn ở mức hàng trăm nghìn.
 */
function parsePriceAt(
  tokens: string[],
  index: number,
): { mention: PriceMention; nextIndex: number } | null {
  const token = tokens[index] ?? "";
  const compact = /^(\d{1,4})(k|tr|m)$/.exec(token);
  if (compact) {
    return {
      mention: {
        index,
        value: Number(compact[1]) * (PRICE_UNITS[compact[2]] ?? 1),
        hasUnit: true,
      },
      nextIndex: index + 1,
    };
  }

  if (!/^\d{1,4}$/.test(token)) return null;

  const unit = tokens[index + 1];
  if (unit && PRICE_UNITS[unit] !== undefined) {
    return {
      mention: {
        index,
        value: Number(token) * PRICE_UNITS[unit],
        hasUnit: true,
      },
      nextIndex: index + 2,
    };
  }

  // "từ 300 đến 1 triệu", "dưới 700 nghìn": số trần chỉ là giá khi từ ngay sau
  // xác nhận (đến/dưới/trên...). "3 bộ" thì không, nên tránh nhầm số lượng.
  if (unit && PRICE_FOLLOW_WORDS.has(unit)) {
    return {
      mention: { index, value: Number(token) * 1_000, hasUnit: false },
      nextIndex: index + 1,
    };
  }

  return null;
}

function extractPriceMentions(tokens: string[]): PriceMention[] {
  const mentions: PriceMention[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const parsed = parsePriceAt(tokens, index);
    if (!parsed) continue;
    mentions.push(parsed.mention);
    index = parsed.nextIndex - 1;
  }
  return mentions;
}

/**
 * Khoảng giá thuê khách muốn lọc.
 *
 * Hiểu: "dưới 100k", "trên 500k", "từ 300 đến 1 triệu", "500k đến 10 triệu",
 * "700k" (một mốc duy nhất coi như trần giá). Trả rỗng khi câu không nhắc giá
 * để không cướp các nhánh DB/FAQ khác.
 */
function extractPriceRange(tokens: string[]): { priceMin?: number; priceMax?: number } {
  const mentions = extractPriceMentions(tokens);
  if (mentions.length === 0) return {};

  const previousTokens = (mention: PriceMention): string[] =>
    tokens.slice(Math.max(0, mention.index - 3), mention.index);

  // "từ X đến Y" / "X đến Y": mốc trước "đến" là sàn, mốc sau là trần.
  const denIndex = tokens.indexOf("den");
  if (denIndex >= 0) {
    const lower = mentions.filter((mention) => mention.index < denIndex);
    const upper = mentions.filter((mention) => mention.index > denIndex);
    if (lower.length > 0 && upper.length > 0) {
      return {
        priceMin: lower[lower.length - 1].value,
        priceMax: upper[0].value,
      };
    }
  }

  let priceMin: number | undefined;
  let priceMax: number | undefined;

  for (const mention of mentions) {
    const previous = previousTokens(mention);

    if (
      previous.includes("duoi") ||
      previous.includes("nho hon") ||
      previous.includes("khong qua") ||
      previous.includes("toi da")
    ) {
      priceMax = Math.min(priceMax ?? Number.POSITIVE_INFINITY, mention.value);
    } else if (
      previous.includes("tren") ||
      previous.includes("hon") ||
      previous.includes("it nhat") ||
      previous.includes("toi thieu")
    ) {
      priceMin = Math.max(priceMin ?? 0, mention.value);
    }
  }

  if (priceMin !== undefined || priceMax !== undefined) return { priceMin, priceMax };

  // Một mốc giá duy nhất kèm đơn vị ("áo dài 700k") hiểu là "tầm đó trở xuống".
  const withUnit = mentions.filter((mention) => mention.hasUnit);
  if (withUnit.length === 1) return { priceMax: withUnit[0].value };

  return {};
}

const COLOR_WORDS = new Set([
  "do",
  "hong",
  "xanh",
  "trang",
  "den",
  "vang",
  "nau",
  "kem",
  "be",
  "bac",
  "ghi",
  "xam",
  "cam",
  "cham",
  "tim",
]);

const PRODUCT_NOUNS = new Set([
  "ao",
  "vay",
  "dam",
  "quan",
  "vest",
  "suit",
  "bo",
  "jupe",
]);

const PRODUCT_PHRASES = phrases(
  "ao dai",
  "ao dai cach tan",
  "co phuc",
  "trang phuc",
  "san pham",
  "chan vay",
  "bo do",
  "bo vest",
);

/**
 * Từ chỉ sản phẩm chung chung, không phải tên mẫu. Khi khách đang xem một mẫu
 * và hỏi "sản phẩm còn hàng ngày mai không", chủ thể chính là mẫu đang xem chứ
 * không phải cả catalog.
 */
const GENERIC_PRODUCT_POINTER_PHRASES = phrases(
  "san pham",
  "trang phuc",
  "bo do",
  "mon do",
  "cai do",
);

/** Cụm từ chỉ loại sản phẩm cụ thể, dùng để tách khỏi từ chung ở trên. */
const SPECIFIC_PRODUCT_PHRASES = phrases(
  "ao dai cach tan",
  "ao dai",
  "co phuc",
  "chan vay",
  "bo vest",
);

const DEMONSTRATIVE_PHRASES = phrases(
  "bo nay",
  "mau nay",
  "cai nay",
  "san pham nay",
  "do nay",
  "ao nay",
  "vay nay",
  "dam nay",
  "mon nay",
  "em nay",
  "chiec nay",
);

/**
 * Từ có thể đứng trước "này"/"kia" để chỉ một sản phẩm: "áo dài này",
 * "bộ vest này", "chiếc đầm kia", "mẫu này"... Chỉ nhận các từ này để
 * "shop này"/"bên này"/"chỗ này"/"hôm nay"/"ngày kia" không bị hiểu là
 * đang nói về mẫu vừa xem.
 */
const DEMONSTRATIVE_PRODUCT_ANCHORS = new Set([
  "ao",
  "vay",
  "dam",
  "quan",
  "vest",
  "suit",
  "bo",
  "jupe",
  "dai",
  "phuc",
  "do",
  "mau",
  "cai",
  "chiec",
  "mon",
  "em",
  "pham",
  "trang",
  "co",
  "chan",
]);

/**
 * Khách có đang chỉ vào mẫu vừa xem không ("… này"/"… kia").
 *
 * Ngoài các cụm cố định ("mẫu này", "bộ này"...) phải hiểu cả cụm ghép loại
 * sản phẩm + này, ví dụ "áo dài này", "bộ vest này", "chiếc đầm kia". Trước
 * đây chỉ khớp đúng "áo này" nên "áo dài này còn hàng ngày mai không" bị coi
 * là tra cả catalog và trả về nhiều mẫu thay vì đúng mẫu khách vừa xem.
 *
 * Loại trừ "hôm nay", "sáng nay", "tuần này", "ngày kia"... vì đó là mốc thời
 * gian, không phải chỉ định sản phẩm.
 */
function hasDemonstrativeReference(tokens: string[]): boolean {
  if (findPhrase(tokens, DEMONSTRATIVE_PHRASES) !== null) return true;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token !== "nay" && token !== "kia") continue;

    const previous = tokens[index - 1];
    if (!previous) continue;
    if (!DEMONSTRATIVE_PRODUCT_ANCHORS.has(previous)) continue;

    return true;
  }

  return false;
}

/** Token màu bị trùng nghĩa với từ khác trong câu. */
function isColorToken(tokens: string[], index: number): boolean {
  const token = tokens[index];
  const next = tokens[index + 1];
  if (!COLOR_WORDS.has(token)) return false;

  // "trang phục" là danh từ, không phải màu trắng.
  if (token === "trang" && next === "phuc") return false;

  // "đồ này", "đồ gì", "đồ đẹp"... là danh từ "đồ", không phải màu đỏ.
  if (
    token === "do" &&
    next !== undefined &&
    ["nay", "gi", "dep", "cua", "cho", "thue", "di"].includes(next)
  ) {
    return false;
  }

  // "đến" trong khoảng giá ("từ 300 đến 1 triệu") bỏ dấu trùng với "đen".
  if (token === "den") {
    const previous = tokens[index - 1];
    if (previous && /^\d/.test(previous)) return false;
    if (next && /^\d/.test(next)) return false;
    if (previous === "tu" || previous === "khoang" || previous === "tam") return false;
  }

  return true;
}

function extractColor(tokens: string[], hasProductContext: boolean): string | undefined {
  if (!hasProductContext && !tokens.includes("mau")) return undefined;

  // Lấy màu gần cuối câu nhất: "trang phục xám" phải là xám, không phải trắng
  // (token "trang" trong "trang phục"). Cách này cũng xử lý đúng
  // "áo dài trắng" và "đồ đỏ".
  for (let index = tokens.length - 1; index >= 0; index--) {
    if (isColorToken(tokens, index)) return tokens[index];
  }

  return undefined;
}

// Chỉ nhận mã khi chữ cái VIẾT HOA hoặc có dấu gạch nối ("nb-012").
// Nhờ vậy "ao dai 12", "size 5", "shop 123" không bị hiểu nhầm là mã.
const CODE_PATTERN = /\b([A-Za-z]{2,4})(-?)(\d{2,6})\b/g;
const CODE_PREFIX_BLOCKLIST = new Set([
  "shop",
  "size",
  "gia",
  "bao",
  "ngay",
  "thang",
  "nam",
  "gio",
  "phut",
  "kg",
  "cm",
  "mau",
  "ao",
  "dai",
  "vay",
  "dam",
  "quan",
  "bo",
  "set",
  "do",
  "phoi",
]);
const ORDER_CODE_PREFIXES = new Set(["bk", "hd", "ord"]);

function extractCodes(
  content: string,
  normalized: string,
): Pick<ClassifierSlots, "productCode" | "orderCode"> {
  const result: Pick<ClassifierSlots, "productCode" | "orderCode"> = {};

  for (const match of content.matchAll(CODE_PATTERN)) {
    const rawPrefix = match[1];
    const separator = match[2] ?? "";
    const digits = match[3];
    if (!rawPrefix || !digits) continue;

    const prefix = rawPrefix.toLowerCase();
    if (CODE_PREFIX_BLOCKLIST.has(prefix)) continue;

    const isUppercase = rawPrefix === rawPrefix.toUpperCase();
    if (!isUppercase && !separator) continue;

    const value = `${rawPrefix.toUpperCase()}-${digits}`;
    if (ORDER_CODE_PREFIXES.has(prefix)) {
      result.orderCode ??= value;
    } else {
      result.productCode ??= value;
    }
  }

  // Mã đơn viết liền, không phân biệt hoa thường: bk123456.
  const numericCode = normalized.match(/\b(?:bk|hd|ord)\s?(\d{4,8})\b/);
  if (!result.orderCode && numericCode?.[0]) {
    result.orderCode = numericCode[0].replace(/\s+/g, "").toUpperCase();
  }

  return result;
}

const DATE_PATTERN =
  /\b(ngay mai|hom nay|ngay kia|ngay \d{1,2}|thu [2-7]|chu nhat|cuoi tuan)\b/;
const DATE_SLASH_PATTERN = /\b\d{1,2}[/-]\d{1,2}\b/;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const AVAILABILITY_PHRASES = phrases(
  "con size",
  "con mau",
  "con hang",
  "con trong",
  "con khong",
  "con ao",
  "con vay",
  "con dam",
  "con bo",
  "co san",
  "co size",
  "co mau",
  "co ao",
  "co vay",
  "co dam",
  "co bo",
  "co quan",
  "co vest",
  "co trang phuc",
  "con nhung mau",
);

function extractSlots(
  content: string,
  normalized: string,
  context: ClassifierContext,
): ClassifierSlots {
  const tokens = toTokens(normalized);
  const foldedContent = foldVietnamese(content);
  const hasSpecificProductPhrase =
    findPhrase(tokens, SPECIFIC_PRODUCT_PHRASES) !== null;
  const hasGenericPointerPhrase =
    findPhrase(tokens, GENERIC_PRODUCT_POINTER_PHRASES) !== null;
  const hasNamedProduct =
    tokens.some((token) => PRODUCT_NOUNS.has(token)) ||
    findPhrase(tokens, PRODUCT_PHRASES) !== null;
  const hasProductContext =
    hasNamedProduct ||
    Boolean(context.lastProductCard?.id) ||
    hasDemonstrativeReference(tokens);

  const contextualAnswer =
    Boolean(context.previousAssistantMessage?.content) &&
    looksLikeQuestion(context.previousAssistantMessage?.content ?? "") &&
    tokens.length <= 4;

  const quantity = extractQuantity(tokens);
  const size = extractSize(normalized);
  const color = extractColor(tokens, hasProductContext || contextualAnswer);
  const priceRange = extractPriceRange(tokens);
  const codes = extractCodes(content, normalized);
  const orderId = content.match(UUID_PATTERN)?.[0];
  const dateMentioned =
    DATE_PATTERN.test(` ${normalized} `) || DATE_SLASH_PATTERN.test(foldedContent);

  const demonstrative = hasDemonstrativeReference(tokens);
  // "sản phẩm còn hàng không", "mẫu này còn size khác không": khách đang nói về
  // đúng món vừa xem; các từ "sản phẩm"/"trang phục" không phải tên mẫu.
  const genericProductOnly =
    hasGenericPointerPhrase && !hasSpecificProductPhrase && !tokens.some((token) => PRODUCT_NOUNS.has(token));
  // Câu hỏi rộng ("shop có sản phẩm màu hồng không") vẫn phải tra toàn catalog,
  // nên chỉ bám vào card khi không kèm thuộc tính tìm kiếm nào.
  const genericFollowUp =
    genericProductOnly &&
    Boolean(context.lastProductCard?.id) &&
    !color &&
    !size &&
    priceRange.priceMin === undefined &&
    priceRange.priceMax === undefined;
  // Chỉ coi là "mẫu đang xem" khi khách nói rõ ("mẫu này", "bộ này"...)
  // hoặc trả lời ngắn cho câu hỏi ngay trước đó. Câu tìm kiếm rộng
  // ("shop có sản phẩm màu hồng", "có mẫu size L không") phải tra toàn
  // catalog, không được dính product card gần nhất.
  const contextualCardAnswer =
    Boolean(context.lastProductCard?.id) &&
    contextualAnswer &&
    !hasNamedProduct &&
    !demonstrative;

  let productReference: ClassifierSlots["productReference"];
  if (context.lastProductCard?.id && (demonstrative || contextualCardAnswer || genericFollowUp)) {
    productReference = "last_card";
  } else if (demonstrative) {
    productReference = "demonstrative";
  } else if (hasNamedProduct) {
    productReference = "named";
  }

  return {
    ...(quantity !== undefined ? { quantity } : {}),
    ...(size ? { size } : {}),
    ...(color ? { color } : {}),
    ...(priceRange.priceMin !== undefined ? { priceMin: priceRange.priceMin } : {}),
    ...(priceRange.priceMax !== undefined ? { priceMax: priceRange.priceMax } : {}),
    ...(codes.productCode ? { productCode: codes.productCode } : {}),
    ...(codes.orderCode ? { orderCode: codes.orderCode } : {}),
    ...(dateMentioned ? { dateMentioned: true } : {}),
    ...(orderId ? { orderId } : {}),
    ...(productReference ? { productReference } : {}),
    // Chỉ gắn id card khi câu hỏi thực sự quy chiếu về card đó. Nếu không,
    // handler sẽ tra catalog theo màu/size thay vì trả lại đúng mẫu vừa xem.
    ...(productReference === "last_card" && context.lastProductCard?.id
      ? { lastProductCardId: context.lastProductCard.id }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* STAFF                                                                      */
/* -------------------------------------------------------------------------- */

type StaffRule = {
  reason: string;
  intent: string;
  sensitive: boolean;
  phrases: Phrase[];
};

const STAFF_RULES: StaffRule[] = [
  {
    reason: "complaint",
    intent: "staff.complaint",
    sensitive: true,
    phrases: phrases(
      "khieu nai",
      "phan nan",
      "boi thuong",
      "bi rach",
      "bi hu",
      "bi hong",
      "bi ban",
      "bi loi",
      "hu do",
      "do hu",
      "mat do",
      "thieu do",
      "sai hang",
      "giao tre",
      "tre hen",
      "qua han",
      "khong hai long",
      "dich vu kem",
      "thai do",
      "that vong",
      "buc minh",
      "tuc gian",
      "bi lua",
      "bi dua",
      "chui",
      "doa",
      "sao lai",
      "lam an",
      "yeu cau doi tra",
    ),
  },
  {
    reason: "refund",
    intent: "staff.refund",
    sensitive: true,
    phrases: phrases(
      "hoan coc",
      "hoan tien",
      "tra coc",
      "lay lai coc",
      "lay lai tien",
      "tra lai tien",
    ),
  },
  {
    reason: "payment",
    intent: "staff.payment",
    sensitive: true,
    phrases: phrases(
      "chot don",
      "dat coc giu",
      "dat coc luon",
      "dat coc ngay",
      "dat coc truoc",
      "muon dat coc",
      "coc luon",
      "coc truoc",
      "da coc",
      "coc roi",
      "giu don",
      "chuyen khoan roi",
      "da chuyen khoan",
      "da chuyen tien",
      "xac nhan thanh toan",
      "xac nhan chuyen khoan",
      "xac nhan giao dich",
      "bill",
      "bien lai",
      "anh chuyen khoan",
      "chup chuyen khoan",
      "thanh toan roi",
      "thanh toan luon",
      "uy nhiem chi",
    ),
  },
  {
    reason: "order_change",
    intent: "staff.order_change",
    sensitive: true,
    phrases: phrases(
      "huy don",
      "huy don hang",
      "huy lich",
      "huy dat lich",
      "doi lich",
      "doi ngay",
      "doi sang ngay",
      "doi gio",
      "doi ca",
      "khong thue nua",
      "khong lay nua",
      "tra do tre",
      "huy thue",
      "huy hop dong",
      "muon huy",
      "can huy",
      "huy giup",
      "huy luon",
      "huy di",
      "huy nhe",
      "huy voi",
      "huy duoc chua",
    ),
  },
  {
    reason: "media_request",
    intent: "staff.media_request",
    sensitive: false,
    phrases: phrases(
      "tim mau tuong tu",
      "tim mau giong",
      "mau tuong tu",
      "gui anh",
      "gui hinh",
      "gui video",
      "gui clip",
      "xem anh",
      "xem hinh",
      "xem video",
      "xem clip",
      "tim anh",
      "anh mau",
      "hinh mau",
      "anh tham khao",
    ),
  },
  {
    reason: "price_negotiation",
    intent: "staff.price_negotiation",
    sensitive: false,
    phrases: phrases(
      "xin giam",
      "giam gia duoc khong",
      "giam gia them",
      "giam them",
      "bot gia",
      "bot chut",
      "bot duoc khong",
      "re hon",
      "thuong luong",
      "fix gia",
      "mien phi",
      "discount",
      "sale off",
      "bot tien",
      "giam chut",
    ),
  },
  {
    reason: "customization",
    intent: "staff.customization",
    sensitive: false,
    phrases: phrases(
      "sua size",
      "may do",
      "may lai",
      "chinh size",
      "len size",
      "xuong size",
      "giu do",
      "giu hang",
      "giu mau",
      "dat rieng",
      "yeu cau dac biet",
      "theu ten",
      "in ten",
      "custom",
      "do may",
      "sua ao",
      "sua vay",
    ),
  },
  {
    reason: "staff_request",
    intent: "staff.staff_request",
    sensitive: false,
    phrases: phrases(
      "gap nhan vien",
      "gap quan ly",
      "gap chu shop",
      "goi lai",
      "lien he lai",
      "goi cho minh",
      "goi cho toi",
      "nhan vien goi",
      "cho minh gap",
      "tu van vien goi",
      "gap truc tiep",
    ),
  },
  {
    reason: "urgent_rental",
    intent: "staff.urgent_rental",
    sensitive: false,
    phrases: phrases(
      "thue gap",
      "can gap",
      "lay gap",
      "thue trong ngay",
      "can trong ngay",
      "lay trong ngay",
      "lay hom nay",
      "thue hom nay",
      "toi nay lay",
      "mai lay",
      "can luon",
      "gap lam",
      "gap nhe",
      "can ngay",
    ),
  },
  {
    reason: "order_delivery_support",
    intent: "staff.order_delivery_support",
    sensitive: false,
    phrases: phrases(
      "khi nao toi noi",
      "bao gio toi noi",
      "khi nao giao",
      "bao gio giao toi",
      "giao chua",
      "ship chua",
      "giao toi dau",
      "don nay khi nao",
      "don toi khi nao",
      "don minh khi nao",
      "don nay bao gio",
    ),
  },
  {
    reason: "bulk_order",
    intent: "staff.bulk_order",
    sensitive: false,
    phrases: phrases(
      "ca lop",
      "ca nhom",
      "doan phim",
      "doan khach",
      "cong ty",
      "dat cho lop",
      "dat cho doan",
      "dat cho cong ty",
      "su kien dong nguoi",
      "so luong lon",
      "thue so luong",
    ),
  },
];

const BULK_QUANTITY_THRESHOLD = 5;

function matchStaffRule(tokens: string[], quantity?: number): StaffRule | null {
  for (const rule of STAFF_RULES) {
    if (findPhrase(tokens, rule.phrases)) return rule;
  }

  if (quantity !== undefined && quantity >= BULK_QUANTITY_THRESHOLD) {
    return STAFF_RULES.find((rule) => rule.reason === "bulk_order") ?? null;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

type FaqTopic = { key: string; intent: string; phrases: Phrase[] };

const FAQ_TOPICS: FaqTopic[] = [
  {
    key: "opening_hours",
    intent: "faq.opening_hours",
    phrases: phrases(
      "gio mo cua",
      "may gio mo cua",
      "mo cua luc may gio",
      "dong cua luc may gio",
      "gio lam viec",
      "lam viec may gio",
      "mo cua den may gio",
      "mo cua tu may gio",
      "chu nhat co mo cua",
      "thu 7 co mo cua",
      "mo cua ngay nao",
      "shop mo cua",
    ),
  },
  {
    key: "address",
    intent: "faq.address",
    phrases: phrases(
      "dia chi",
      "o dau",
      "shop o dau",
      "duong nao",
      "chi duong",
      "dia diem",
      "vi tri shop",
      "google maps",
      "tim shop",
      "den shop the nao",
    ),
  },
  {
    key: "phone",
    intent: "faq.phone",
    phrases: phrases(
      "so dien thoai",
      "zalo",
      "hotline",
      "lien he shop",
      "so cua shop",
      "sdt shop",
      "so lien lac",
    ),
  },
  {
    key: "bank_account",
    intent: "faq.bank_account",
    phrases: phrases(
      "so tai khoan",
      "tai khoan ngan hang",
      "chu tai khoan",
      "ten chu tai khoan",
      "ngan hang nao",
      "ngan hang gi",
      "thong tin chuyen khoan",
      "stk shop",
      "tai khoan shop",
    ),
  },
  {
    key: "payment_methods",
    intent: "faq.payment_methods",
    phrases: phrases(
      "hinh thuc thanh toan",
      "phuong thuc thanh toan",
      "thanh toan bang gi",
      "thanh toan nhu the nao",
      "co chuyen khoan khong",
      "nhan chuyen khoan khong",
      "thanh toan chuyen khoan duoc khong",
      "tra tien mat",
      "quet the",
      "momo",
      "vnpay",
      "tien mat",
    ),
  },
  {
    key: "deposit_policy",
    intent: "faq.deposit_policy",
    phrases: phrases(
      "muc coc",
      "tien coc",
      "coc bao nhieu",
      "dat coc bao nhieu",
      "can coc bao nhieu",
      "quy dinh coc",
      "coc thue",
      "phi coc",
      "coc the nao",
      "coc la bao nhieu",
      "coc bao nhieu tien",
    ),
  },
  {
    key: "rental_duration",
    intent: "faq.rental_duration",
    phrases: phrases(
      "thoi gian thue",
      "thue bao lau",
      "thue may ngay",
      "may ngay",
      "bao nhieu ngay",
      "thue trong bao lau",
      "24 gio",
      "24h",
      "mot ngay",
    ),
  },
  {
    key: "shipping",
    intent: "faq.shipping",
    phrases: phrases(
      "co ship",
      "ship khong",
      "phi ship",
      "gia ship",
      "ship bao nhieu",
      "phi giao hang",
      "hinh thuc giao hang",
      "giao hang the nao",
      "ship the nao",
      "giao tan noi",
      "ship tan nha",
      "cach nhan do",
      "cach tra do",
      "nhan do the nao",
      "tra do the nao",
      "co giao hang",
    ),
  },
  {
    key: "late_return_penalty",
    intent: "faq.late_return_penalty",
    phrases: phrases(
      "phi tra tre",
      "tra tre bi phat",
      "phat tre",
      "tre han",
      "quy dinh den bu",
      "den bu the nao",
      "den bu hu hong",
      "hu hong den bao nhieu",
      "mat do den bao nhieu",
      "quy dinh tra tre",
    ),
  },
  {
    key: "laundry",
    intent: "faq.laundry",
    phrases: phrases(
      "ai giat",
      "co phai giat",
      "tu giat",
      "giat do",
      "ve sinh do",
      "shop giat",
      "giat o dau",
    ),
  },
  {
    key: "documents",
    intent: "faq.documents",
    phrases: phrases(
      "giay to",
      "cccd",
      "can cuoc",
      "cmnd",
      "ho chieu",
      "can mang gi",
      "mang theo gi",
      "giay to gi",
    ),
  },
  {
    key: "size_exchange_policy",
    intent: "faq.size_exchange_policy",
    phrases: phrases(
      "quy dinh doi size",
      "chinh sach doi size",
      "doi size duoc khong",
      "doi size co mat phi",
      "chinh sach huy",
      "quy dinh huy",
      "huy lich co mat phi",
      "doi mau duoc khong",
      "doi do duoc khong",
      "chinh sach doi tra",
    ),
  },
  {
    key: "promotions",
    intent: "faq.promotions",
    phrases: phrases(
      "uu dai",
      "khuyen mai",
      "combo",
      "giam gia theo so luong",
      "duoc giam bao nhieu",
      "giam bao nhieu",
      "co uu dai",
      "chuong trinh uu dai",
      "co giam gia",
      "giam gia khong",
      "giam gia bao nhieu",
      "thue 3 bo duoc giam",
      "thue 3 bo giam",
    ),
  },
  {
    key: "accessories_services",
    intent: "faq.accessories_services",
    phrases: phrases(
      "co phu kien",
      "ban phu kien",
      "thue phu kien",
      "phu kien gi",
      "cho thue phu kien",
      "trang diem",
      "makeup",
      "lam toc",
      "thue kem",
      "mu mao",
      "quat lua",
      "hai theu",
      "dich vu toc",
      "dich vu trang diem",
    ),
  },
  {
    key: "try_on_appointment",
    intent: "faq.try_on_appointment",
    phrases: phrases(
      "hen thu do",
      "thu do",
      "co can hen",
      "dat lich thu",
      "thu truoc",
      "thu do ao",
      "thu online",
      "thu do truoc",
    ),
  },
];

/* -------------------------------------------------------------------------- */
/* DB                                                                         */
/* -------------------------------------------------------------------------- */

const ORDER_STATUS_PHRASES = phrases(
  "trang thai don",
  "kiem tra don",
  "don cua toi",
  "don cua minh",
  "don den dau",
  "don toi dau",
  "don hang den dau",
  "bao gio giao hang",
  "lich nhan do",
  "tra cuu don",
  "xem don hang",
  "don hang cua toi",
);

const PRICE_PHRASES = phrases(
  "gia bao nhieu",
  "bao nhieu tien",
  "gia thue",
  "gia the nao",
  "gia cua",
  "bao nhieu mot ngay",
  "mot ngay bao nhieu",
  "1 ngay bao nhieu",
  "thue bao nhieu tien",
  "gia la bao nhieu",
);

const CATALOG_SEARCH_PHRASES = phrases(
  "tim mau",
  "tim bo",
  "co mau",
  "co size",
  "co ban",
  "co bo nao",
  "co ao nao",
  "co mau nao",
  "con nhung mau",
);

/**
 * Từ cho biết khách đang nói về quần áo/sản phẩm. Giữ lại để tài liệu hoá ngữ
 * nghĩa phân loại dịp; nhánh lọc dịp dùng `STYLING_QUESTION_PHRASES` để quyết
 * định nhường nhánh AI.
 */
// const OUTFIT_CUE_WORDS = new Set([
//   "mau",
//   "bo",
//   "do",
//   "ao",
//   "vay",
//   "dam",
//   "quan",
//   "vest",
//   "suit",
//   "jupe",
// ]);

/**
 * Tín hiệu câu hỏi tư vấn phong cách/chọn đồ — không được cướp thành lọc DB.
 *
 * Chỉ những cụm thật sự "hỏi cách mặc/hỏi ý kiến" hoặc xin tư vấn. Khách chỉ
 * nêu dịp ("mẫu trang phục đi tết") vẫn tra catalog; khách xin lời khuyên
 * ("tư vấn giúp mình đồ đi tiệc") phải để nhánh AI.
 */
const STYLING_QUESTION_PHRASES = phrases(
  "tu van",
  "goi y",
  "nen mac",
  "nen chon",
  "mac gi",
  "mac bo nao",
  "mac mau nao",
  "mac sao",
  "mac the nao",
  "phoi do",
  "phoi",
  "mix do",
  "hop voi",
  "so sanh",
  "dep hon",
  "dep khong",
  "co dep khong",
  "chon giup",
  "chon size",
  "mac size",
  "mac vua",
);


const PRODUCT_ACCESSORY_QUESTION_PHRASES = phrases(
  "phu kien di kem",
  "co phu kien",
  "phu kien gi",
  "kem theo gi",
  "kem phu kien",
  "phu kien cua",
  "thue phu kien kem",
);

const PRODUCT_ALTERNATIVE_PHRASES = phrases(
  "mau khac",
  "mau nao khac",
  "con mau khac",
  "cai khac",
  "bo khac",
  "lua chon khac",
  "mau khac khong",
);

const CATEGORY_BROWSE_PHRASES = phrases(
  "shop co nhung san pham",
  "co nhung san pham",
  "shop co san pham gi",
  "co san pham gi",
  "shop co ban gi",
  "shop co ban nhung gi",
  "shop co ban nhung san pham gi",
  "co ban gi",
  "ban nhung gi",
  "ban nhung san pham gi",
  "shop co nhung loai",
  "co nhung loai",
  "co nhung mau nao",
  "danh muc san pham",
  "danh muc",
  "cac danh muc",
  "xem danh muc",
  "liet ke danh muc",
  "cho toi danh muc",
  "cho minh danh muc",
  "cho em danh muc",
  "cac loai san pham",
  "shop ban nhung gi",
  "shop ban gi",
  "shop co gi",
  "shop co do gi",
  "co do gi",
  "ben minh ban gi",
  "ben minh co gi",
  "shop co nhung mau gi",
  "co nhung mau gi",
);

function matchFaqTopics(tokens: string[]): FaqTopic[] {
  const matches: FaqTopic[] = [];
  for (const topic of FAQ_TOPICS) {
    if (findPhrase(tokens, topic.phrases)) matches.push(topic);
  }
  return matches;
}

/** Tin nhắn AI/staff trước đó có đang mời khách chọn danh mục không. */
function askedForCategoryChoice(previousContent?: string | null): boolean {
  const previous = normalizeForMatch(previousContent ?? "");
  return (
    previous.includes("danh muc") &&
    (previous.includes("muon xem loai nao") || previous.includes("chon loai"))
  );
}

/** Tin nhắn trước đó có mời khách xem danh mục không. */
function offeredCategories(previousContent?: string | null): boolean {
  const previous = normalizeForMatch(previousContent ?? "");
  return (
    previous.includes("danh muc") &&
    (previous.includes("xem") ||
      previous.includes("liet ke") ||
      previous.includes("chon"))
  );
}

/** Tin nhắn trước đó có mời khách xem mẫu khác không. */
function offeredAlternatives(previousContent?: string | null): boolean {
  const previous = normalizeForMatch(previousContent ?? "");
  return (
    previous.includes("mau khac") ||
    previous.includes("mau tuong tu") ||
    previous.includes("goi y mau")
  );
}

/**
 * Khách không hỏi tư vấn phong cách, mà yêu cầu thông tin/trích xuất dữ liệu
 * về một sản phẩm cụ thể. Chỉ nhận khi có tín hiệu "thông tin"/"sản phẩm"
 * (kèm "tư vấn" hoặc không) để không cướp nhánh tư vấn phong cách của AI.
 */
const INFO_REQUEST_PATTERN = /\b(thong tin|san pham|thong so)\b/;

function detectedProductInfoRequest(normalized: string, hasNamedProduct: boolean): boolean {
  if (findPhrase(toTokens(normalized), PRODUCT_INFO_PHRASES)) return true;
  // "Tư vấn tôi/thông tin về sản phẩm X" cần có cả từ chỉ sản phẩm và tên mẫu.
  return hasNamedProduct && INFO_REQUEST_PATTERN.test(normalized);
}

/**
 * Gắn tham chiếu sản phẩm vào slots.
 *
 * Quan trọng: khi tham chiếu là mẫu đang xem (`last_card`) thì phải kèm luôn
 * `lastProductCardId`, nếu không handler không tra được mẫu và sẽ trả lời
 * "cho em biết mẫu cụ thể" dù khách vừa xem đúng mẫu đó.
 */
function referenceSlots(
  slots: ClassifierSlots,
  reference: ClassifierSlots["productReference"],
  lastCardId?: string | null,
): ClassifierSlots {
  return {
    ...slots,
    ...(reference ? { productReference: reference } : {}),
    ...(reference === "last_card" && lastCardId
      ? { lastProductCardId: lastCardId }
      : {}),
  };
}

function resolveProductReference(
  slots: ClassifierSlots,
  lastCardId: string | null | undefined,
): {
  reference: ClassifierSlots["productReference"];
  missingParams: string[];
  lastProductCardId?: string;
} {
  const hasLastCard = Boolean(lastCardId);
  const hasSearchAttributes = Boolean(
    slots.color ||
      slots.size ||
      slots.priceMin !== undefined ||
      slots.priceMax !== undefined,
  );

  if (slots.productReference === "last_card" && lastCardId) {
    return { reference: "last_card", missingParams: [], lastProductCardId: lastCardId };
  }
  if (slots.productReference === "named") {
    return { reference: "named", missingParams: [] };
  }
  if (slots.productReference === "demonstrative") {
    return {
      reference: "demonstrative",
      missingParams: hasLastCard ? [] : ["product"],
      ...(lastCardId ? { lastProductCardId: lastCardId } : {}),
    };
  }

  // Chỉ dùng product card gần nhất cho câu hỏi tiếp nối không kèm thuộc tính.
  // Câu hỏi chỉ có màu/size mà không nói rõ sản phẩm vẫn cần khách xác nhận
  // mẫu, tránh đoán bừa trên toàn catalog.
  if (lastCardId && !hasSearchAttributes) {
    return { reference: "last_card", missingParams: [], lastProductCardId: lastCardId };
  }
  return { reference: undefined, missingParams: ["product"] };
}

function detectDb(
  tokens: string[],
  slots: ClassifierSlots,
  context: ClassifierContext,
  options: { allowWeakSearch: boolean },
): { intent: string; missingParams: string[]; slots: ClassifierSlots } | null {
  const lastCardId = context.lastProductCard?.id;

  if (findPhrase(tokens, ORDER_STATUS_PHRASES)) {
    return {
      intent: "db.order_status",
      missingParams: context.bookingId ? [] : ["bookingId"],
      slots,
    };
  }

  // Khách lọc theo khoảng giá thuê ("dưới 100k", "từ 300 đến 1 triệu"): tra
  // catalog theo giá thay vì coi "giá thuê" là hỏi giá một mẫu cụ thể.
  if (
    (slots.priceMin !== undefined || slots.priceMax !== undefined) &&
    slots.productReference !== "last_card"
  ) {
    return {
      intent: "db.catalog_price",
      missingParams: [],
      slots,
    };
  }

  const priceHit = findPhrase(tokens, PRICE_PHRASES);
  const genericPriceCue =
    !priceHit &&
    tokens.includes("gia") &&
    (Boolean(slots.productReference) || tokens.includes("bao"));
  if (priceHit || genericPriceCue) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      lastCardId,
    );
    return {
      intent: "db.product_price",
      missingParams,
      slots: referenceSlots(slots, reference, lastProductCardId),
    };
  }

  const availability = findPhrase(tokens, AVAILABILITY_PHRASES);
  const searchHit = availability ?? findPhrase(tokens, CATALOG_SEARCH_PHRASES);

  // "Còn hàng không", "còn size L không" về đúng mẫu đang xem: kiểm tra tồn
  // thật thay vì mô tả lại mẫu như một kết quả tìm kiếm.
  if (availability && !slots.dateMentioned) {
    const resolved = resolveProductReference(slots, lastCardId);
    if (resolved.reference === "last_card") {
      return {
        intent: "db.product_stock",
        missingParams: resolved.missingParams,
        slots: referenceSlots(
          slots,
          resolved.reference,
          resolved.lastProductCardId,
        ),
      };
    }
  }

  // Khách tìm đồ theo dịp ("mẫu trang phục đi tết", "đồ dự tiệc", "đi đám
  // cưới"): tra catalog thật theo `garment.occasion`. Phải đứng trước
  // `catalog_search` để không rơi vào câu hỏi lại "cho em biết mẫu cụ thể".
  //
  // Chỉ nhường nhánh AI khi khách thật sự hỏi cách mặc/hỏi ý kiến
  // (`STYLING_QUESTION_PHRASES`) hoặc đang nói về mẫu trên card hiện tại.
  const occasions = detectOccasions(tokens.join(" "));
  const stylingCue = findPhrase(tokens, STYLING_QUESTION_PHRASES) !== null;
  if (
    occasions.length > 0 &&
    slots.productReference !== "last_card" &&
    !stylingCue
  ) {
    return {
      intent: "db.catalog_occasion",
      missingParams: [],
      slots,
    };
  }

  // Hỏi tư vấn phong cách ("tư vấn giúp mình đồ đi tiệc", "nên mặc gì đi
  // tiệc"): để nhánh AI trả lời, không được rơi xuống các nhánh tra cứu
  // catalog yếu bên dưới (vd. "có mẫu ... không").
  if (stylingCue && !slots.productReference) {
    return null;
  }

  if (searchHit) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      lastCardId,
    );
    return {
      intent: "db.catalog_search",
      missingParams,
      slots: referenceSlots(slots, reference, lastProductCardId),
    };
  }
  // "Tư vấn" kèm sản phẩm cụ thể (tên + màu + size) là yêu cầu thông tin
  // sản phẩm, trả DB luôn thay vì gọi LLM.
  const namedProduct =
    tokens.some((token) => PRODUCT_NOUNS.has(token)) ||
    findPhrase(tokens, PRODUCT_PHRASES) !== null;
  if (detectedProductInfoRequest(tokens.join(" "), namedProduct)) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      lastCardId,
    );
    return {
      intent: "db.product_info",
      missingParams,
      slots: referenceSlots(slots, reference, lastProductCardId),
    };
  }

  // Câu hỏi dạng "áo dài size M không?" vẫn là tra cứu, nhưng chỉ nhận khi
  // không có tín hiệu tư vấn ("nên mặc", "phối đồ"...) để tránh cướp nhánh AI.
  const hasAttributes = Boolean(slots.size || slots.color);
  const questionCue = tokens.includes("khong") || tokens.includes("chua");
  if (options.allowWeakSearch && slots.productReference && hasAttributes && questionCue) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      lastCardId,
    );
    return {
      intent: "db.catalog_search",
      missingParams,
      slots: referenceSlots(slots, reference, lastProductCardId),
    };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* AI                                                                         */
/* -------------------------------------------------------------------------- */

const AI_RULES: Array<{ intent: string; phrases: Phrase[] }> = [
  {
    intent: "ai.comparison",
    phrases: phrases(
      "so sanh",
      "khac nhau",
      "khac gi",
      "nen chon cai nao",
      "cai nao hon",
      "cai nao dep hon",
      "mau nao dep hon",
      "bo nao dep hon",
    ),
  },
  {
    intent: "ai.sizing",
    phrases: phrases(
      "size nao",
      "mac size gi",
      "chon size",
      "so do",
      "vua khong",
      "bi chat",
      "bi rong",
      "mac vua",
      "cao bao nhieu",
      "nang bao nhieu",
    ),
  },
  {
    intent: "ai.heritage",
    phrases: phrases(
      "nguon goc",
      "y nghia",
      "co phuc",
      "lich su",
      "chat lieu",
      "xuat xu",
      "truyen thong",
      "ao tu than",
      "nhat binh",
      "ao dai nam",
    ),
  },
  {
    intent: "ai.styling",
    phrases: phrases(
      "nen mac",
      "mac gi",
      "mac bo nao",
      "mac mau nao",
      "phoi do",
      "phoi",
      "mix do",
      "phu hop",
      "hop voi",
      "chup ky yeu",
      "di tiec",
      "dam cuoi",
      "du lich",
      "di lam",
      "le hoi",
      "su kien",
      "tiec",
      "ky yeu",
      "chup anh",
      "tu van",
      "goi y",
      "chon do",
      "chon bo",
      "chon mau",
      "dep khong",
      "co dep khong",
    ),
  },
];

/**
 * Khách không hỏi tư vấn, mà yêu cầu trích xuất/thông tin về một sản phẩm
 * cụ thể. Phải trả DB, không gọi LLM.
 */
const PRODUCT_INFO_PHRASES = phrases(
  "cho tôi thông tin về sản phẩm",
  "cho em thông tin về sản phẩm",
  "thông tin sản phẩm",
  "cho tôi sản phẩm",
  "cho em sản phẩm",
  "trích xuất thông tin sản phẩm",
);

const HEIGHT_WEIGHT_PATTERN =
  /\b(cao|nang)\s+\d|\b\d+\s*(kg|cm)\b|\b1m\d{2}\b/;

/**
 * Intent AI không liên quan tiền/cam kết, vẫn được tư vấn khi hội thoại đang
 * có handoff nhạy cảm (khiếu nại, hoàn tiền, thanh toán...).
 *
 * Chặn toàn bộ AI suốt TTL 24 giờ khiến khách hỏi "mặc gì đi tiệc" không nhận
 * được gợi ý nào. Các chủ đề phối đồ/chọn size/nguồn gốc không thể tạo cam kết
 * tài chính nên để AI trả lời; câu hỏi tiền cụ thể vẫn rơi vào STAFF/FAQ như cũ.
 */
const AI_INTENTS_SAFE_DURING_SENSITIVE_HANDOFF = new Set([
  "ai.styling",
  "ai.sizing",
  "ai.heritage",
  "ai.comparison",
]);


function matchAi(tokens: string[], normalized: string): { intent: string } | null {
  for (const rule of AI_RULES) {
    if (findPhrase(tokens, rule.phrases)) return { intent: rule.intent };
  }

  if (HEIGHT_WEIGHT_PATTERN.test(normalized)) return { intent: "ai.sizing" };

  return null;
}

/**
 * Khách từ chối/kết thúc ("ko", "không", "thôi"...). Đây là câu trả lời cho
 * lời mời của shop, không phải yêu cầu mới: cảm ơn và kết thúc, tuyệt đối
 * không chuyển nhân viên và không hỏi dồn.
 */
const DECLINE_ONLY_PATTERN = new RegExp(
  "^(?:" +
    "(?:khong|thoi|khong can|khong can dau|ko can|thoi khong can|khong lay|thoi a|thoi nhe|thoi shop|khong a|khong shop|khong nhe|khong dau|het roi)" +
    "(?: (?:a|nhe|nha|shop|ban|ad|admin|dau|roi))*" +
    ")$",
);

function isDeclineOnly(normalized: string): boolean {
  return DECLINE_ONLY_PATTERN.test(normalized);
}

/**
 * Hỏi còn size nào khác không. Phải trả danh sách size thật của mẫu đang xem,
 * không được rơi xuống tra catalog (dễ ra "chưa có mẫu phù hợp").
 */
const OTHER_SIZE_PHRASES = phrases(
  "size nao khac",
  "size khac",
  "con size nao",
  "co size nao khac",
  "size khac khong",
  "con size khac",
  "nhung size nao",
  "cac size",
  "size gi",
);

const GREETING_PATTERN =
  /^(chao|hello|hi|hey|alo)( shop| ban| ad| admin| nha| a)*$|^shop oi$/;

/**
 * Chỉ "cảm ơn" đứng riêng mới trả template ngắn.
 * "Ok, cảm ơn shop" vẫn là ACK (SKIP) theo yêu cầu giữ nguyên hành vi cũ.
 */
const THANKS_ONLY_PATTERN = new RegExp(
  "^cam on" +
    "(?: (?:shop|ban|ad|admin|nhe|nha|a|nhi|nhieu|rat nhieu))*" +
    "$",
);

/**
 * Cảm ơn "mở rộng": khách thường viết dài hơn whitelist ở trên —
 * "cảm ơn shop đã tư vấn", "cảm ơn shop nhìu", "cảm ơn shop ❤️".
 * Chỉ coi là cảm ơn khi câu mở đầu bằng từ cảm ơn và KHÔNG kèm yêu cầu
 * (giúp, gợi ý, hỏi giá, hỏi còn hàng...). Câu có yêu cầu vẫn đi tiếp
 * xuống DB/AI để không bỏ sót nhu cầu thật của khách.
 *
 * Hàm này chạy SAU các nhánh STAFF/FAQ/DB nên các câu "cảm ơn ... nhưng đơn
 * bị rách" hay "cảm ơn shop, cho hỏi giờ mở cửa" vẫn được xử lý đúng.
 */
const THANKS_LEAD_PATTERN = /^(?:cam on|thanks|thank you|tks|thank)\b/u;
const ADDRESS_LEAD_PATTERN = /^(?:shop|ad|admin|ban|em|anh|chi)\s+(?:oi|o|a)\s+/u;
const THANKS_REQUEST_PATTERN =
  /\b(giup|gium|goi y|cho minh|cho em|minh muon|em muon|minh can|em can|bao nhieu|the nao|khong|chua)\b/u;

function isThanksMessage(normalized: string): boolean {
  const cleaned = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return false;

  const withoutAddress = cleaned.replace(ADDRESS_LEAD_PATTERN, "");
  if (!THANKS_LEAD_PATTERN.test(withoutAddress)) return false;

  return !THANKS_REQUEST_PATTERN.test(withoutAddress);
}

/* -------------------------------------------------------------------------- */
/* SKIP                                                                       */
/* -------------------------------------------------------------------------- */

const ACK_ONLY_PATTERN = new RegExp(
  "^(?:" +
    "(?:ok|oke|okie|okey|okela|ok la|vang|vang a|da|da vang|da vang a|u|um|uhm|duoc|duoc a|roi|roi a|hieu roi|hieu a|biet roi)" +
    "(?: (?:shop|ban|ad|admin|nhe|nha|a|da|nhi|nhieu|rat nhieu))*" +
    "|(?:ok |oke |okie |da |vang )?(?:cam on)" +
    "(?: (?:shop|ban|ad|admin|nhe|nha|a|nhi|nhieu|rat nhieu))*" +
    ")$",
);

function isAckOnly(normalized: string): boolean {
  return ACK_ONLY_PATTERN.test(normalized);
}

/**
 * "Có" là câu trả lời đồng ý, không phải câu hỏi độc lập. Chỉ xử lý khi
 * tin trước của shop thực sự mời khách chọn một việc (xem danh mục/mẫu khác).
 */
const AFFIRMATIVE_PATTERN =
  /^(?:co|co a|co shop|co nhe|co nha|dung|dung roi|dung a|phai|phai roi)$/;

function isAffirmative(normalized: string): boolean {
  return AFFIRMATIVE_PATTERN.test(normalized);
}

/* -------------------------------------------------------------------------- */
/* Message type helpers                                                       */
/* -------------------------------------------------------------------------- */

function readString(
  source: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readProduct(
  metadata: Record<string, unknown> | null | undefined,
): ClassifierContext["lastProductCard"] {
  const product = metadata?.product;
  if (!product || typeof product !== "object") return null;

  const record = product as Record<string, unknown>;
  const id = readString(record, "id");
  if (!id) return null;

  const price = record.price;
  return {
    id,
    name: readString(record, "name"),
    size: readString(record, "size"),
    price: typeof price === "number" && Number.isFinite(price) ? price : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Result builders                                                            */
/* -------------------------------------------------------------------------- */

function staffResult(options: {
  reason: string;
  intent: string;
  matchedRule: string;
  sensitive: boolean;
  slots: ClassifierSlots;
  missingParams?: string[];
  faqKey?: string;
}): ClassifierResult {
  return {
    route: "STAFF",
    intent: options.intent,
    reason: options.reason,
    matchedRule: options.matchedRule,
    slots: options.slots,
    missingParams: options.missingParams ?? [],
    handoffReason: options.reason,
    sensitive: options.sensitive,
    requiresProductContext: false,
    ...(options.faqKey ? { faqKey: options.faqKey } : {}),
  };
}

function skipResult(reason: string, matchedRule: string, slots: ClassifierSlots = {}): ClassifierResult {
  return {
    route: "SKIP",
    intent: "skip",
    reason,
    matchedRule,
    slots,
    missingParams: [],
    sensitive: false,
    requiresProductContext: false,
  };
}

function templateResult(
  templateKey: string,
  reason: string,
  matchedRule: string,
  slots: ClassifierSlots = {},
): ClassifierResult {
  return {
    route: "TEMPLATE",
    intent: `template.${templateKey}`,
    reason,
    matchedRule,
    slots,
    missingParams: [],
    sensitive: false,
    requiresProductContext: false,
    templateKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function classifyMessage(
  trigger: ClassifierTrigger,
  context: ClassifierContext = {},
): ClassifierResult {
  const content = trigger.content ?? "";
  const messageType = (trigger.messageType ?? "text").toLowerCase();
  const normalized = normalizeForMatch(content);
  const tokens = toTokens(normalized);

  if (messageType === "booking_card") {
    const topic = readString(trigger.metadata, "topic");
    const isComplaint = topic === "complaint";
    return staffResult({
      reason: isComplaint ? "booking_card_complaint" : "booking_card_support",
      intent: isComplaint ? "staff.booking_card_complaint" : "staff.booking_card_support",
      matchedRule: "message_type.booking_card",
      sensitive: true,
      slots: {},
    });
  }

  if (messageType === "product_card") {
    const product = readProduct(trigger.metadata);
    if (!product) {
      return {
        route: "UNKNOWN",
        intent: "unknown",
        reason: "product_card_without_metadata",
        matchedRule: "message_type.product_card",
        slots: {},
        missingParams: ["product"],
        sensitive: false,
        requiresProductContext: true,
      };
    }

    return {
      route: "DB",
      intent: "db.product_card_detail",
      reason: "product_card",
      matchedRule: "message_type.product_card",
      slots: {
        lastProductCardId: product.id,
        productReference: "last_card",
        ...(product.size ? { size: product.size.toUpperCase() } : {}),
      },
      missingParams: [],
      sensitive: false,
      requiresProductContext: true,
    };
  }

  if (messageType === "image" || messageType === "video") {
    const captionTokens = toTokens(normalized);
    const captionStaff = matchStaffRule(captionTokens, extractQuantity(captionTokens));
    if (captionStaff) {
      return staffResult({
        reason: captionStaff.reason,
        intent: captionStaff.intent,
        matchedRule: "message_type.media_caption",
        sensitive: captionStaff.sensitive,
        slots: extractSlots(content, normalized, context),
      });
    }

    return staffResult({
      reason: "media_received",
      intent: "staff.media_received",
      matchedRule: "message_type.media",
      sensitive: false,
      slots: {},
    });
  }

  if (messageType !== "text") {
    return skipResult("unsupported_message_type", "message_type.unsupported");
  }

  if (!hasMeaningfulContent(content) || !normalized) {
    return skipResult("empty_or_emoji", "content.empty");
  }

  const slots = extractSlots(content, normalized, context);

  // Khách từ chối/kết thúc: cảm ơn, không chuyển nhân viên. Phải đứng trước
  // nhánh UNKNOWN, nếu không "ko"/"thôi" bị coi là không hiểu và mở handoff.
  if (isDeclineOnly(normalized)) {
    return templateResult(
      "decline",
      "decline_template",
      "ack.decline",
      slots,
    );
  }

  if (context.handoff?.open) {
    const followUp = findPhrase(tokens, SENSITIVE_FOLLOWUP_MATCHERS);
    if (followUp) {
      return staffResult({
        reason: "sensitive_followup",
        intent: "staff.sensitive_followup",
        matchedRule: `sensitive_followup:${followUp.phrase.raw}`,
        sensitive: true,
        slots,
      });
    }
  }

  const answeredQuestion = context.previousAssistantMessage?.content
    ? looksLikeQuestion(context.previousAssistantMessage.content)
    : false;

  // "Có" sau câu hỏi của shop: hiểu là khách đồng ý xem danh mục hoặc mẫu
  // khác, không chuyển STAFF oan.
  if (answeredQuestion && isAffirmative(normalized)) {
    const previous = context.previousAssistantMessage?.content;

    // Câu mời của shop có thể nhắc cả hai lựa chọn; danh mục là lựa chọn ưu
    // tiên vì luôn có dữ liệu, còn "mẫu khác" có thể rỗng.
    if (offeredCategories(previous)) {
      return {
        route: "DB",
        intent: "db.product_categories",
        reason: "affirmative_categories",
        matchedRule: "affirmative.category_offer",
        slots,
        missingParams: [],
        sensitive: false,
        requiresProductContext: false,
      };
    }

    if (offeredAlternatives(previous)) {
      const { reference, missingParams, lastProductCardId } = resolveProductReference(
        slots,
        context.lastProductCard?.id,
      );
      return {
        route: "DB",
        intent: "db.product_alternatives",
        reason: "affirmative_alternatives",
        matchedRule: "affirmative.alternative_offer",
        slots: referenceSlots(slots, reference, lastProductCardId),
        missingParams,
        sensitive: false,
        requiresProductContext: true,
      };
    }

    return templateResult(
      "contextual_reask",
      "affirmative_without_choice",
      "ack.affirmative_no_choice",
      slots,
    );
  }

  // Chào hỏi đứng riêng: template ngắn, không gọi LLM.
  // Chào kèm câu hỏi tư vấn vẫn rơi xuống các nhánh FAQ/DB/AI bên dưới.
  if (GREETING_PATTERN.test(normalized)) {
    return templateResult("greeting", "greeting_template", "template.greeting", slots);
  }

  // Cảm ơn đứng riêng: template ngắn, không gọi LLM.
  if (THANKS_ONLY_PATTERN.test(normalized)) {
    return templateResult("thanks", "thanks_template", "template.thanks", slots);
  }

  if (isAckOnly(normalized)) {
    // "Ok, cảm ơn shop" giữ nguyên là SKIP (không gửi thêm tin).
    if (normalized.includes("cam on")) {
      return skipResult("acknowledgement", "ack.only", slots);
    }

    if (answeredQuestion) {
      const hasDerivableSlot = Boolean(
        slots.size ||
          slots.color ||
          slots.quantity !== undefined ||
          slots.dateMentioned,
      );

      // Không suy ra được slot nào: không gọi LLM, không handoff, không ack.
      // Router sẽ hỏi lại ngắn đúng một lần (template contextual_reask).
      if (!hasDerivableSlot) {
        return templateResult(
          "contextual_reask",
          "contextual_answer_missing_slots",
          "ack.answers_previous_question_without_slot",
          slots,
        );
      }

      return {
        route: "DB",
        intent: "db.contextual_answer",
        reason: "contextual_answer",
        matchedRule: "ack.answers_previous_question",
        slots,
        missingParams: context.lastProductCard?.id ? [] : ["product"],
        sensitive: false,
        requiresProductContext: true,
      };
    }

    return skipResult("acknowledgement", "ack.only", slots);
  }

  // Câu trả lời ngắn cho câu hỏi ngay trước đó ("L", "đen", "size M") vẫn
  // phải được xử lý như dữ liệu thật, không bị SKIP.
  if (
    answeredQuestion &&
    tokens.length <= 4 &&
    (slots.size || slots.color || slots.quantity !== undefined || slots.dateMentioned)
  ) {
    return {
      route: "DB",
      intent: "db.contextual_answer",
      reason: "contextual_answer",
      matchedRule: "slot.answers_previous_question",
      slots,
      missingParams: context.lastProductCard?.id ? [] : ["product"],
      sensitive: false,
      requiresProductContext: true,
    };
  }

  const staffRule = matchStaffRule(tokens, slots.quantity);
  if (staffRule) {
    return staffResult({
      reason: staffRule.reason,
      intent: staffRule.intent,
      matchedRule: `staff.${staffRule.reason}`,
      sensitive: staffRule.sensitive,
      slots,
    });
  }

  if (slots.orderCode) {
    return staffResult({
      reason: "order_code_unsupported",
      intent: "staff.order_code_unsupported",
      matchedRule: "slot.order_code",
      sensitive: false,
      slots,
    });
  }

  if (slots.productCode) {
    return staffResult({
      reason: "product_code_unsupported",
      intent: "staff.product_code_unsupported",
      matchedRule: "slot.product_code",
      sensitive: false,
      slots,
    });
  }

  const faqTopics = matchFaqTopics(tokens);
  const hasProductReference = Boolean(slots.productReference);
  const askedCategory = askedForCategoryChoice(context.previousAssistantMessage?.content);

  // Hỏi còn size nào khác: trả danh sách size thật của mẫu đang xem. Đứng
  // trước nhánh catalog_search để không bị lọc thành "chưa có mẫu phù hợp".
  if (
    (slots.productReference || context.lastProductCard?.id) &&
    findPhrase(tokens, OTHER_SIZE_PHRASES)
  ) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      context.lastProductCard?.id,
    );
    return {
      route: "DB",
      intent: "db.product_sizes",
      reason: "db_product_sizes",
      matchedRule: "db.product_sizes",
      slots: referenceSlots(slots, reference, lastProductCardId),
      missingParams,
      sensitive: false,
      requiresProductContext: true,
    };
  }

  // Hỏi phụ kiện đi kèm của đúng mẫu đang xem: ưu tiên dữ liệu gắn với sản phẩm
  // hơn FAQ chung về dịch vụ phụ kiện.
  if (hasProductReference && findPhrase(tokens, PRODUCT_ACCESSORY_QUESTION_PHRASES)) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      context.lastProductCard?.id,
    );
    return {
      route: "DB",
      intent: "db.product_accessories",
      reason: "db_product_accessories",
      matchedRule: "db.product_accessories",
      slots: referenceSlots(slots, reference, lastProductCardId),
      missingParams,
      sensitive: false,
      requiresProductContext: true,
    };
  }

  // "Có mẫu khác không" → gợi ý mẫu khác cùng danh mục thay vì gọi LLM.
  if (findPhrase(tokens, PRODUCT_ALTERNATIVE_PHRASES)) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      context.lastProductCard?.id,
    );
    return {
      route: "DB",
      intent: "db.product_alternatives",
      reason: "db_product_alternatives",
      matchedRule: "db.product_alternatives",
      slots: referenceSlots(slots, reference, lastProductCardId),
      missingParams,
      sensitive: false,
      requiresProductContext: true,
    };
  }

  // Còn hàng theo ngày cụ thể: tra tồn kho thật thay vì chuyển staff.
  if (slots.dateMentioned && findPhrase(tokens, AVAILABILITY_PHRASES)) {
    const { reference, missingParams, lastProductCardId } = resolveProductReference(
      slots,
      context.lastProductCard?.id,
    );
    return {
      route: "DB",
      intent: "db.product_availability",
      reason: "db_product_availability",
      matchedRule: "db.product_availability",
      slots: referenceSlots(slots, reference, lastProductCardId),
      missingParams,
      sensitive: false,
      requiresProductContext: true,
    };
  }

  // "Shop có những sản phẩm gì" → liệt kê danh mục để khách chọn.
  if (findPhrase(tokens, CATEGORY_BROWSE_PHRASES)) {
    return {
      route: "DB",
      intent: "db.product_categories",
      reason: "db_product_categories",
      matchedRule: "db.product_categories",
      slots,
      missingParams: [],
      sensitive: false,
      requiresProductContext: false,
    };
  }

  // Sau khi shop liệt kê danh mục, câu ngắn như "áo dài"/"vest" là khách chọn
  // danh mục; handler sẽ khớp tên danh mục thật trong DB.
  if (askedCategory && tokens.length <= 6 && faqTopics.length === 0) {
    return {
      route: "DB",
      intent: "db.category_products",
      reason: "db_category_products",
      matchedRule: "db.category_products",
      slots,
      missingParams: [],
      sensitive: false,
      requiresProductContext: false,
    };
  }

  if (faqTopics.length > 0) {
    const primary = faqTopics[0];
    return {
      route: "FAQ",
      intent: primary.intent,
      reason: `faq_${primary.key}`,
      matchedRule: `faq.${primary.key}`,
      slots,
      missingParams: [],
      sensitive: false,
      requiresProductContext: false,
      faqKey: primary.key,
      ...(faqTopics.length > 1 ? { faqKeys: faqTopics.slice(0, 3).map((topic) => topic.key) } : {}),
    };
  }

  const aiHit = matchAi(tokens, normalized);

  const dbHit = detectDb(tokens, slots, context, { allowWeakSearch: !aiHit });
  if (dbHit) {
    return {
      route: "DB",
      intent: dbHit.intent,
      reason: "db_query",
      matchedRule: dbHit.intent,
      slots: dbHit.slots,
      missingParams: dbHit.missingParams,
      sensitive: false,
      requiresProductContext: dbHit.intent !== "db.order_status",
    };
  }

  // Cảm ơn kèm vài từ đệm ("đã tư vấn", "nhìu", emoji...) nhưng không có yêu
  // cầu gì thêm: trả template, tuyệt đối không gọi LLM chỉ vì chữ "tư vấn"
  // trong câu cảm ơn.
  if (isThanksMessage(normalized)) {
    return templateResult("thanks", "thanks_template", "template.thanks", slots);
  }

  if (aiHit) {
    if (
      context.handoff?.open &&
      isSensitiveHandoff(context.handoff.reason, context.handoff.sensitive) &&
      !AI_INTENTS_SAFE_DURING_SENSITIVE_HANDOFF.has(aiHit.intent)
    ) {
      return staffResult({
        reason: "handoff_sensitive_ai_block",
        intent: "staff.handoff_sensitive_ai_block",
        matchedRule: "handoff.sensitive_ai",
        sensitive: true,
        slots,
      });
    }

    return {
      route: "AI",
      intent: aiHit.intent,
      reason: "ai_required",
      matchedRule: aiHit.intent,
      slots,
      missingParams: [],
      sensitive: false,
      requiresProductContext: Boolean(context.lastProductCard?.id),
      aiRequest: content.trim(),
    };
  }

  return {
    route: "UNKNOWN",
    intent: "unknown",
    reason: "no_rule_matched",
    matchedRule: "fallback.unknown",
    slots,
    missingParams: [],
    sensitive: false,
    requiresProductContext: false,
  };
}

export function isRouteType(value: string): value is RouteType {
  return ["STAFF", "FAQ", "DB", "AI", "SKIP", "UNKNOWN", "TEMPLATE"].includes(value);
}
