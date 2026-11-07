"use client";

import { MessageSquareOff, RotateCcw } from "lucide-react";

export type ReviewEmptyStateProps = {
  hasFilterActive?: boolean;
  onResetFilters?: () => void;
  title?: string;
  description?: string;
  className?: string;
};

export function ReviewEmptyState({
  hasFilterActive = false,
  onResetFilters,
  title,
  description,
  className = "",
}: ReviewEmptyStateProps) {
  const defaultTitle = hasFilterActive
    ? "Không tìm thấy đánh giá phù hợp"
    : "Chưa có đánh giá nào cho trang phục này";

  const defaultDescription = hasFilterActive
    ? "Thử thay đổi số sao hoặc xóa bớt tiêu chí lọc để xem thêm đánh giá."
    : "Hãy là người đầu tiên thuê và chia sẻ cảm nhận thực tế về bộ trang phục này nhé!";

  return (
    <div
      className={`text-center py-12 px-4 bg-neutral-50/50 rounded-2xl border border-dashed border-neutral-200 ${className}`}
      data-testid="review-empty-state"
    >
      <div className="mx-auto w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-400 mb-3 shadow-2xs">
        <MessageSquareOff className="w-6 h-6" />
      </div>

      <h4 className="text-base font-semibold text-neutral-800 mb-1">
        {title || defaultTitle}
      </h4>

      <p className="text-sm text-neutral-500 max-w-sm mx-auto mb-4">
        {description || defaultDescription}
      </p>

      {hasFilterActive && onResetFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-xl shadow-2xs transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Xóa toàn bộ bộ lọc</span>
        </button>
      )}
    </div>
  );
}

