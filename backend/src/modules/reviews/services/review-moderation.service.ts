import { Injectable, BadRequestException } from '@nestjs/common';
import {
  extractFitFeedback,
  embedFitFeedback,
  moderateReviewContent,
  ModerationResult,
} from '../utils/content-moderator';

export type EnhancedModerationResult = ModerationResult & {
  sentiment: 'positive' | 'neutral' | 'negative';
  containsSpamLinks: boolean;
  containsPhoneNumber: boolean;
  hasExcessiveRepeats: boolean;
};

// Mẫu phát hiện số điện thoại tại Việt Nam
const PHONE_PATTERN = /(?:\+?84|0)(?:3[2-9]|5[6|8|9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}\b/;

// Mẫu phát hiện lặp ký tự bất thường (ví dụ: aaaaaaaa, !!!!!!!!)
const EXCESSIVE_REPEAT_PATTERN = /(.)\1{6,}/;

// Từ khóa tích cực và tiêu cực phổ biến trong đánh giá trang phục
const POSITIVE_KEYWORDS = [
  'đẹp',
  'tinh xảo',
  'rất thích',
  'ưng ý',
  'hài lòng',
  'vừa vặn',
  'chất lượng',
  'xuất sắc',
  'tuyệt vời',
  'sang trọng',
  'nhiệt tình',
  'ủng hộ',
  'chu đáo',
];

const NEGATIVE_KEYWORDS = [
  'xấu',
  'chật',
  'rách',
  'bẩn',
  'thất vọng',
  'kém',
  'tệ',
  'cũ',
  'mùi hôi',
  'nhàu',
  'không đúng',
  'chậm trễ',
];

@Injectable()
export class ReviewModerationService {
  /**
   * Phân tích kiểm duyệt toàn diện nội dung đánh giá
   */
  moderateContent(comment?: string | null): EnhancedModerationResult {
    const baseModeration = moderateReviewContent(comment);

    if (!comment || typeof comment !== 'string') {
      return {
        ...baseModeration,
        sentiment: 'neutral',
        containsSpamLinks: false,
        containsPhoneNumber: false,
        hasExcessiveRepeats: false,
      };
    }

    const normalized = comment.toLowerCase();
    const containsPhoneNumber = PHONE_PATTERN.test(normalized);
    const hasExcessiveRepeats = EXCESSIVE_REPEAT_PATTERN.test(normalized);
    const containsSpamLinks = /(https?:\/\/[^\s]+)/i.test(normalized);

    let flaggedReason = baseModeration.flaggedReason;
    let isClean = baseModeration.isClean;

    if (!flaggedReason && containsPhoneNumber) {
      isClean = false;
      flaggedReason = 'Nội dung chứa số điện thoại liên hệ cá nhân/quảng cáo';
    }

    if (!flaggedReason && hasExcessiveRepeats) {
      isClean = false;
      flaggedReason = 'Nội dung chứa ký tự lặp bất thường (nghi vấn spam)';
    }

    // Xác định sentiment sơ bộ
    let positiveScore = 0;
    let negativeScore = 0;

    for (const kw of POSITIVE_KEYWORDS) {
      if (normalized.includes(kw)) positiveScore++;
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (normalized.includes(kw)) negativeScore++;
    }

    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (positiveScore > negativeScore) {
      sentiment = 'positive';
    } else if (negativeScore > positiveScore) {
      sentiment = 'negative';
    }

    return {
      isClean,
      shouldBlock: baseModeration.shouldBlock,
      flaggedReason,
      sentiment,
      containsSpamLinks,
      containsPhoneNumber,
      hasExcessiveRepeats,
    };
  }

  /**
   * Kiểm tra và ném lỗi trực tiếp nếu nội dung vi phạm tiêu chuẩn cộng đồng mức độ nghiêm trọng
   */
  assertContentAllowed(comment?: string | null): EnhancedModerationResult {
    const result = this.moderateContent(comment);
    if (result.shouldBlock) {
      throw new BadRequestException(
        `Bình luận vi phạm tiêu chuẩn cộng đồng: ${result.flaggedReason}. Vui lòng sử dụng ngôn từ phù hợp.`,
      );
    }
    return result;
  }

  /**
   * Xử lý nhãn độ vừa vặn và nội dung bình luận
   */
  embedFitFeedback(comment?: string | null, fitFeedback?: string | null): string | null {
    return embedFitFeedback(comment, fitFeedback);
  }

  /**
   * Trích xuất thông tin độ vừa vặn và nội dung bình luận sạch
   */
  extractFitFeedback(rawComment?: string | null) {
    return extractFitFeedback(rawComment);
  }
}

