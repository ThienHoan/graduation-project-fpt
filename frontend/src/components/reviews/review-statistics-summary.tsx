"use client";

import { RatingStars } from "./rating-stars";
import { ThumbsUp, Camera, CheckCircle2 } from "lucide-react";

export type ReviewStatisticsSummaryProps = {
  averageRating: number;
  total: number;
  recommendPercentage?: number;
  ratingCounts: Record<number, number>;
  ratingPercentages?: Record<number, number>;
  fitCounts?: Record<string, number>;
  fitPercentages?: Record<string, number>;
  mediaCount?: number;
  onSelectRatingFilter?: (rating?: number) => void;
  activeRatingFilter?: number;
  className?: string;
};

export function ReviewStatisticsSummary({
  averageRating,
  total,
  recommendPercentage = 0,
  ratingCounts,
  ratingPercentages,
  fitCounts,
  fitPercentages,
  mediaCount = 0,
  onSelectRatingFilter,
  activeRatingFilter,
  className = "",
}: ReviewStatisticsSummaryProps) {
  const starsList = [5, 4, 3, 2, 1];

  return (
    <div
      className={`bg-neutral-50/80 border border-neutral-200/80 rounded-2xl p-6 shadow-sm ${className}`}
      data-testid="review-statistics-summary"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Left Column: Overall Score & Recommendation */}
        <div className="md:col-span-4 flex flex-col items-center md:items-start text-center md:text-left border-b md:border-b-0 md:border-r border-neutral-200 pb-6 md:pb-0 md:pr-6">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tracking-tight text-neutral-900" data-testid="average-rating-display">
              {averageRating.toFixed(1)}
            </span>
            <span className="text-xl font-medium text-neutral-400">/ 5</span>
          </div>

          <div className="mt-2">
            <RatingStars value={Math.round(averageRating)} size="md" />
          </div>

          <p className="mt-2 text-sm text-neutral-600">
            Dựa trên <span className="font-semibold text-neutral-900">{total}</span> lượt đánh giá thực tế
          </p>

          {recommendPercentage > 0 && (
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-full border border-emerald-200">
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>{recommendPercentage}% khách thuê khuyên dùng</span>
            </div>
          )}

          {mediaCount > 0 && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <Camera className="w-3.5 h-3.5 text-neutral-400" />
              <span>{mediaCount} đánh giá có hình ảnh / video</span>
            </div>
          )}
        </div>

        {/* Middle Column: Star Breakdown Progress Bars */}
        <div className="md:col-span-5 space-y-2">
          {starsList.map((star) => {
            const count = ratingCounts[star] || 0;
            const percentage = ratingPercentages?.[star] ?? (total > 0 ? (count / total) * 100 : 0);
            const isFilterActive = activeRatingFilter === star;

            return (
              <button
                key={star}
                type="button"
                onClick={() => onSelectRatingFilter?.(isFilterActive ? undefined : star)}
                className={`w-full flex items-center gap-2 group text-left p-1 rounded-lg transition-colors ${
                  isFilterActive ? "bg-amber-100/70" : "hover:bg-neutral-100"
                }`}
                title={`Lọc đánh giá ${star} sao`}
              >
                <span className="text-xs font-medium text-neutral-600 w-10 flex items-center gap-1">
                  <span>{star}</span>
                  <span className="text-amber-500">★</span>
                </span>

                <div className="flex-1 h-2.5 bg-neutral-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-300 rounded-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>

                <span className="text-xs text-neutral-500 w-12 text-right tabular-nums">
                  {count} <span className="text-neutral-400">({Math.round(percentage)}%)</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Column: Fit Feedback Insight */}
        <div className="md:col-span-3 border-t md:border-t-0 md:border-l border-neutral-200 pt-6 md:pt-0 md:pl-6">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-3">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span>Độ vừa vặn (Fit)</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="p-2.5 rounded-xl bg-white border border-neutral-200/80 shadow-2xs">
              <div className="flex justify-between items-center text-neutral-700 mb-1">
                <span className="font-medium text-emerald-700">Vừa vặn chuẩn size</span>
                <span className="font-bold text-neutral-900 tabular-nums">
                  {fitPercentages?.true_to_size ?? 0}%
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                {fitCounts?.true_to_size || 0} khách hàng xác nhận
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-lg bg-white border border-neutral-200/60 text-center">
                <div className="text-neutral-500 text-[11px]">Hơi chật</div>
                <div className="font-semibold text-neutral-800 tabular-nums">
                  {fitPercentages?.tight ?? 0}%
                </div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-neutral-200/60 text-center">
                <div className="text-neutral-500 text-[11px]">Hơi rộng</div>
                <div className="font-semibold text-neutral-800 tabular-nums">
                  {fitPercentages?.loose ?? 0}%
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

