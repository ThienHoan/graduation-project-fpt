"use client";

import { Search, X, SlidersHorizontal, Image, Check } from "lucide-react";

export type ReviewFilterBarProps = {
  activeRating?: number;
  hasMedia?: boolean;
  activeFit?: string;
  sortBy?: string;
  search?: string;
  ratingCounts?: Record<number, number>;
  mediaCount?: number;
  onRatingChange: (rating?: number) => void;
  onMediaChange: (hasMedia?: boolean) => void;
  onFitChange: (fit?: string) => void;
  onSortChange: (sortBy: string) => void;
  onSearchChange: (search: string) => void;
  onResetFilters: () => void;
  className?: string;
};

const SORT_OPTIONS = [
  { value: "newest", label: "Mới nhất" },
  { value: "highest_rating", label: "Đánh giá cao nhất" },
  { value: "lowest_rating", label: "Đánh giá thấp nhất" },
  { value: "media_first", label: "Có ảnh/video trước" },
  { value: "oldest", label: "Cũ nhất" },
];

export function ReviewFilterBar({
  activeRating,
  hasMedia,
  activeFit,
  sortBy = "newest",
  search = "",
  ratingCounts,
  mediaCount,
  onRatingChange,
  onMediaChange,
  onFitChange,
  onSortChange,
  onSearchChange,
  onResetFilters,
  className = "",
}: ReviewFilterBarProps) {
  const hasActiveFilters =
    activeRating !== undefined ||
    hasMedia !== undefined ||
    activeFit !== undefined ||
    (search && search.trim().length > 0);

  return (
    <div className={`space-y-3 ${className}`} data-testid="review-filter-bar">
      {/* Top row: Search input + Sorting selector */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm theo nội dung đánh giá hoặc tên người dùng..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-neutral-200 rounded-xl placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600 rounded"
              title="Xóa tìm kiếm"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <SlidersHorizontal className="w-4 h-4 text-neutral-400 shrink-0" />
          <label htmlFor="review-sort-select" className="text-xs text-neutral-500 font-medium whitespace-nowrap">
            Sắp xếp:
          </label>
          <select
            id="review-sort-select"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            className="text-xs bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 font-medium text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bottom row: Filter Chips */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-neutral-100">
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mr-1">
          Lọc:
        </span>

        {/* All Reviews */}
        <button
          type="button"
          onClick={() => onRatingChange(undefined)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            activeRating === undefined && !hasMedia && !activeFit
              ? "bg-neutral-900 text-white shadow-2xs"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          }`}
        >
          Tất cả
        </button>

        {/* 5 -> 1 Star Chips */}
        {[5, 4, 3, 2, 1].map((star) => {
          const isSelected = activeRating === star;
          const count = ratingCounts?.[star];
          return (
            <button
              key={star}
              type="button"
              onClick={() => onRatingChange(isSelected ? undefined : star)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                isSelected
                  ? "bg-amber-500 text-white shadow-2xs"
                  : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              <span>{star} sao</span>
              {count !== undefined && (
                <span className={`text-[10px] ${isSelected ? "text-amber-100" : "text-neutral-400"}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}

        {/* Media filter chip */}
        <button
          type="button"
          onClick={() => onMediaChange(hasMedia ? undefined : true)}
          className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            hasMedia
              ? "bg-sky-600 text-white shadow-2xs"
              : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <Image className="w-3.5 h-3.5" />
          <span>Có ảnh / Video</span>
          {mediaCount !== undefined && (
            <span className={`text-[10px] ${hasMedia ? "text-sky-100" : "text-neutral-400"}`}>
              ({mediaCount})
            </span>
          )}
        </button>

        {/* Fit Chips */}
        <div className="h-4 w-px bg-neutral-200 mx-1 hidden sm:block" />

        {[
          { key: "true_to_size", label: "Vừa vặn" },
          { key: "tight", label: "Hơi chật" },
          { key: "loose", label: "Hơi rộng" },
        ].map((fit) => {
          const isSelected = activeFit === fit.key;
          return (
            <button
              key={fit.key}
              type="button"
              onClick={() => onFitChange(isSelected ? undefined : fit.key)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                isSelected
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {isSelected && <Check className="w-3 h-3" />}
              <span>{fit.label}</span>
            </button>
          );
        })}

        {/* Reset filter button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium ml-auto px-2 py-1 rounded hover:bg-rose-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Xóa bộ lọc</span>
          </button>
        )}
      </div>
    </div>
  );
}

