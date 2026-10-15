export type ModerationResult = {
  isClean: boolean;
  flaggedReason?: string;
  shouldBlock: boolean;
};

// Danh sách các từ ngữ thô tục, xúc phạm hoặc lừa đảo phổ biến cần chặn
const SEVERE_TOXIC_PATTERNS = [
  /\b(địt|đụ|đụ mẹ|đm|đcm|đmm|vcl|vl|clmm|cặc|lồn|buồi|đéo|mẹ kiếp|chó chết)\b/i,
  /\b(lừa đảo|scam|ăn cướp|đĩ|con phò|bitch|fuck)\b/i,
];

// Danh sách từ khóa nghi vấn (quảng cáo cờ bạc, link lừa đảo)
const SUSPICIOUS_PATTERNS = [
  /(https?:\/\/[^\s]+)/i, // chứa link lạ
  /\b(cá cược|kèo bóng|tài xỉu|nổ hũ|kubet|thabet)\b/i,
];

/**
 * AI Content Moderation cho Review
 * Phân tích nội dung bình luận để phát hiện từ ngữ phản cảm hoặc hành vi spam
 */
export function moderateReviewContent(comment?: string | null): ModerationResult {
  if (!comment || typeof comment !== "string") {
    return { isClean: true, shouldBlock: false };
  }

  const normalized = comment.toLowerCase();

  // 1. Kiểm tra từ ngữ thô tục mức độ nghiêm trọng -> Chặn trực tiếp
  for (const pattern of SEVERE_TOXIC_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        isClean: false,
        shouldBlock: true,
        flaggedReason: "Phát hiện từ ngữ thô tục, xúc phạm hoặc vi phạm chuẩn mực văn hóa",
      };
    }
  }

  // 2. Kiểm tra link quảng cáo / cờ bạc -> Tự động gắn cờ cho Staff duyệt
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        isClean: false,
        shouldBlock: false,
        flaggedReason: "Phát hiện link liên kết hoặc nội dung nghi vấn quảng cáo / spam",
      };
    }
  }

  return { isClean: true, shouldBlock: false };
}

/**
 * Trích xuất nhãn độ vừa vặn (Fit Feedback) từ comment nếu có
 * Định dạng: [FIT:true_to_size] hoặc [FIT:tight] hoặc [FIT:loose]
 */
export function extractFitFeedback(rawComment?: string | null): {
  cleanComment: string | null;
  fitFeedback: "tight" | "true_to_size" | "loose" | null;
} {
  if (!rawComment) return { cleanComment: null, fitFeedback: null };

  const match = rawComment.match(/^\[FIT:(tight|true_to_size|loose)\]\s*(.*)$/s);
  if (match) {
    return {
      fitFeedback: match[1] as "tight" | "true_to_size" | "loose",
      cleanComment: match[2].trim() || null,
    };
  }

  return { cleanComment: rawComment, fitFeedback: null };
}

/**
 * Gắn nhãn Fit Feedback vào comment trước khi lưu database
 */
export function embedFitFeedback(comment: string | undefined | null, fitFeedback?: string | null): string | null {
  const baseComment = comment?.trim() ?? "";
  if (!fitFeedback || !["tight", "true_to_size", "loose"].includes(fitFeedback)) {
    return baseComment || null;
  }
  return `[FIT:${fitFeedback}] ${baseComment}`.trim();
}
