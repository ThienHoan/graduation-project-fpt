import type { IntentResult } from "../interfaces/ai-response.interface";
import { isBrowseQuestion } from "./browse-detector";
//import type {  IntentType } from "../interfaces/ai-response.interface";
// \b does not work with Vietnamese characters (non-ASCII \W).
// Use (?:^|(?<=\s)) as left-boundary and (?=\s|$|[.,;:!?]) as right-boundary.

const PRODUCT_KEYWORDS = /(?:^|(?<=\s))(áo|váy|váy cưới|quần|sản phẩm|mẫu|bộ|trang phục|cổ phục|đầm|jupe|chân váy|vest|suit|size|cỡ|đẹp)(?=\s|$|[.,;:!?])/i;
const COLOR_WORDS = /(?:^|(?<=\s))(tím|đỏ|hồng|xanh|trắng|đen|vàng|nâu|kem|be|bạc|ghi|xám|cam|chàm)(?=\s|$|[.,;:!?])/i;
const BUDGET_PATTERN = /(?:^|(?<=\s))(dưới|trên|khoảng|từ|đến|giá|tiền|budget|ngân sách)(?=\s|$|[.,;:!?])/i;
const SIZE_PATTERN = /(?:^|(?<=\s))(size|cỡ|số)\s*[smlxl]+(?=\s|$|[.,;:!?])/i;
const SEARCH_QUESTION = /có\s+.+không|còn\s+.+không|có\s+.+ko|còn\s+.+ko/i;
const CATEGORY_REFERENCE = /(?:^|(?<=\s))(áo dài|cổ phục|váy cưới|váy|quần|đầm|vest|suit)(?=\s|$|[.,;:!?])/i;
const RENTAL_ACTION = /(?:^|(?<=\s))(thuê|mướn|cho thuê|giá thuê)(?=\s|$|[.,;:!?])/i;

const GENERAL_QUESTION = /(?:^|(?<=\s))(mấy giờ|giờ mở cửa|ở đâu|địa chỉ|liên hệ|giao hàng|vận chuyển|thanh toán|chuyển khoản|đổi trả|bảo hành|chính sách|hủy|hoàn tiền|khiếu nại)(?=\s|$|[.,;:!?])/i;

export function detectIntent(message: string): IntentResult {
  const text = message.toLowerCase().trim();
  if (!text) return { intent: "other", confidence: 1 };

  // General questions about store policies, hours, etc.
  if (GENERAL_QUESTION.test(text)) {
    return { intent: "general", confidence: 0.9 };
  }

  // Price-only question without product reference
  if (/^giá\s+(bao nhiêu|thế nào|sao)(?=\s|$|[.,;:!?])/i.test(text) && !CATEGORY_REFERENCE.test(text)) {
    return { intent: "general", confidence: 0.7 };
  }

  // Check for product search signals
  let searchScore = 0;

  if (SEARCH_QUESTION.test(text)) searchScore += 2;
  if (PRODUCT_KEYWORDS.test(text)) searchScore += 3;
  if (isBrowseQuestion(text)) searchScore += 3;
  if (COLOR_WORDS.test(text) && CATEGORY_REFERENCE.test(text)) searchScore += 3;
  if (BUDGET_PATTERN.test(text) && PRODUCT_KEYWORDS.test(text)) searchScore += 2;
  if (SIZE_PATTERN.test(text)) searchScore += 2;
  if (RENTAL_ACTION.test(text)) searchScore += 1;
  if (CATEGORY_REFERENCE.test(text)) searchScore += 1;
  if (/hỏi/i.test(text) && PRODUCT_KEYWORDS.test(text)) searchScore += 1;

  if (searchScore >= 3) {
    return { intent: "search", confidence: Math.min(searchScore / 5, 1) };
  }

  // Short messages (1-2 words) with product reference
  if (text.split(/\s+/).length <= 3 && CATEGORY_REFERENCE.test(text)) {
    return { intent: "search", confidence: 0.6 };
  }

  // General question with question words but no product reference
  if (/(?:^|(?<=\s))(gì|nào|bao nhiêu|sao|khi nào|mấy|à|nhỉ|hả)(?=\s|$|[.,;:!?])/i.test(text) && !CATEGORY_REFERENCE.test(text)) {
    return { intent: "general", confidence: 0.6 };
  }

  return { intent: "other", confidence: 0.5 };
}
