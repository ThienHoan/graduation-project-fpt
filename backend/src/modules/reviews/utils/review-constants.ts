/**
 * Review Module Constants & Enums
 * Định nghĩa các hằng số, giới hạn và kiểu dữ liệu chuẩn dùng chung cho module Review
 */

export enum ReviewSortBy {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  HIGHEST_RATING = 'highest_rating',
  LOWEST_RATING = 'lowest_rating',
  MEDIA_FIRST = 'media_first',
}

export type FitFeedbackType = 'tight' | 'true_to_size' | 'loose';

export const VALID_FIT_FEEDBACKS: readonly FitFeedbackType[] = [
  'tight',
  'true_to_size',
  'loose',
] as const;

export const FIT_FEEDBACK_LABELS: Record<FitFeedbackType, string> = {
  tight: 'Hơi chật',
  true_to_size: 'Vừa vặn chuẩn size',
  loose: 'Hơi rộng',
};

export const REVIEW_LIMITS = {
  MIN_RATING: 1,
  MAX_RATING: 5,
  MAX_IMAGES: 5,
  MAX_VIDEO_COUNT: 1,
  MAX_COMMENT_LENGTH: 1000,
  MAX_EDIT_COUNT: 3,
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_PAGE_LIMIT: 50,
} as const;

export const REVIEW_ERROR_MESSAGES = {
  NOT_FOUND: 'Đánh giá không tồn tại',
  LOCKED: 'Đánh giá này đã bị khóa vĩnh viễn và không thể chỉnh sửa',
  FORBIDDEN_UPDATE: 'Bạn chỉ có quyền chỉnh sửa đánh giá của chính mình',
  FORBIDDEN_DELETE: 'Bạn không có quyền xóa đánh giá này',
  BOOKING_NOT_FOUND: 'Không tìm thấy thông tin đơn đặt đồ',
  BOOKING_NOT_OWNED: 'Bạn chỉ có thể đánh giá các đơn đặt đồ của chính mình',
  GARMENT_NOT_IN_BOOKING: 'Sản phẩm này không nằm trong đơn đặt đồ đã chỉ định',
  BOOKING_NOT_COMPLETED: 'Bạn chỉ có thể đánh giá trang phục sau khi đơn thuê đã hoàn thành hoặc đã trả đồ',
  DUPLICATE_REVIEW: 'Bạn đã đánh giá trang phục này trong đơn thuê này rồi',
  NO_ELIGIBLE_BOOKING: 'Bạn chưa từng thuê hoặc đã đánh giá tất cả các đơn hàng cho sản phẩm này',
  MAX_EDITS_EXCEEDED: 'Bạn đã vượt quá số lần cho phép chỉnh sửa đánh giá (tối đa 3 lần)',
  COMMENT_TOO_LONG: `Nội dung đánh giá không được vượt quá ${REVIEW_LIMITS.MAX_COMMENT_LENGTH} ký tự`,
  TOO_MANY_IMAGES: `Chỉ được tải lên tối đa ${REVIEW_LIMITS.MAX_IMAGES} hình ảnh`,
} as const;

