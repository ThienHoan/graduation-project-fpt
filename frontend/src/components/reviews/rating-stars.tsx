"use client";

import { useState } from "react";
import { Star } from "lucide-react";

export type RatingStarsSize = "xs" | "sm" | "md" | "lg";

export type RatingStarsProps = {
  value: number;
  max?: number;
  size?: RatingStarsSize;
  interactive?: boolean;
  onChange?: (value: number) => void;
  showScore?: boolean;
  showTooltip?: boolean;
  className?: string;
};

const RATING_LABELS: Record<number, string> = {
  1: "Rất không hài lòng",
  2: "Chưa hài lòng",
  3: "Bình thường",
  4: "Hài lòng",
  5: "Rất hài lòng",
};

const SIZE_MAP: Record<RatingStarsSize, { icon: string; text: string }> = {
  xs: { icon: "w-3.5 h-3.5", text: "text-xs" },
  sm: { icon: "w-4 h-4", text: "text-sm" },
  md: { icon: "w-5 h-5", text: "text-base" },
  lg: { icon: "w-7 h-7", text: "text-lg" },
};

export function RatingStars({
  value,
  max = 5,
  size = "md",
  interactive = false,
  onChange,
  showScore = false,
  showTooltip = false,
  className = "",
}: RatingStarsProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const activeValue = interactive && hoverValue !== null ? hoverValue : value;
  const currentSize = SIZE_MAP[size];

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`} role={interactive ? "radiogroup" : "img"} aria-label={`Đánh giá: ${value} trên ${max} sao`}>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: max }, (_, index) => {
          const starNumber = index + 1;
          const isFilled = starNumber <= activeValue;

          if (interactive) {
            return (
              <button
                key={starNumber}
                type="button"
                role="radio"
                aria-checked={value === starNumber}
                aria-label={`${starNumber} sao - ${RATING_LABELS[starNumber] || ""}`}
                onClick={() => onChange?.(starNumber)}
                onMouseEnter={() => setHoverValue(starNumber)}
                onMouseLeave={() => setHoverValue(null)}
                className="p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
              >
                <Star
                  className={`${currentSize.icon} transition-colors ${
                    isFilled
                      ? "fill-amber-400 text-amber-400"
                      : "text-neutral-300 fill-transparent hover:text-amber-300"
                  }`}
                />
              </button>
            );
          }

          return (
            <Star
              key={starNumber}
              className={`${currentSize.icon} ${
                isFilled
                  ? "fill-amber-400 text-amber-400"
                  : "text-neutral-300 fill-transparent"
              }`}
            />
          );
        })}
      </div>

      {showScore && (
        <span className={`font-semibold text-neutral-800 ${currentSize.text}`}>
          {value.toFixed(1)}
        </span>
      )}

      {showTooltip && interactive && activeValue > 0 && (
        <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
          {RATING_LABELS[activeValue]}
        </span>
      )}
    </div>
  );
}

