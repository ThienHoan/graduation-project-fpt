"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
  itemLabel?: string;
  hideOnSinglePage?: boolean;
}

/**
 * Reusable Heritage-styled Pagination component:
 * - Dynamic page windows with ellipsis (1 ... 4 5 6 ... 10)
 * - Clear Vietnamese labels & item counters
 * - Keyboard accessible, smooth hover/focus transitions
 */
export function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  className = "",
  itemLabel = "mục",
  hideOnSinglePage = true,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | "ellipsis-left" | "ellipsis-right")[] = [1];

    if (currentPage > 3) {
      pages.push("ellipsis-left");
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push("ellipsis-right");
    }

    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  if (totalItems === 0 || (hideOnSinglePage && totalPages <= 1)) {
    return null;
  }

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-sand bg-stone-50/70 text-xs sm:text-sm text-stone-600 ${className}`}
      aria-label="Phân trang"
    >
      <div className="font-medium text-stone-500 text-xs">
        Hiển thị <span className="font-semibold text-ink">{startItem}</span> -{" "}
        <span className="font-semibold text-ink">{endItem}</span> trong tổng số{" "}
        <span className="font-semibold text-ink">{totalItems}</span> {itemLabel}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Trang trước"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sand bg-white text-stone-700 font-medium transition hover:bg-stone-100 disabled:opacity-40 disabled:pointer-events-none active:scale-95"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Trước</span>
        </button>

        <div className="flex items-center gap-1">
          {pageNumbers.map((p, idx) => {
            if (p === "ellipsis-left" || p === "ellipsis-right") {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="px-2 py-1 text-stone-400 select-none"
                >
                  …
                </span>
              );
            }

            const isCurrent = p === currentPage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={isCurrent ? "page" : undefined}
                className={`min-w-[32px] h-8 px-2 rounded-lg font-semibold text-xs sm:text-sm transition-all duration-150 flex items-center justify-center ${
                  isCurrent
                    ? "bg-lotus text-white shadow-xs"
                    : "border border-sand bg-white text-stone-700 hover:bg-mist hover:border-antique/50 active:scale-95"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Trang sau"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sand bg-white text-stone-700 font-medium transition hover:bg-stone-100 disabled:opacity-40 disabled:pointer-events-none active:scale-95"
        >
          <span className="hidden sm:inline">Sau</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
