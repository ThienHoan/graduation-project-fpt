"use client";

import React from "react";

interface BodySilhouetteGuideProps {
  /** Text hướng dẫn ở dưới khung hình (mặc định "Lùi lại một chút / Step back") */
  label?: string;
  subLabel?: string;
  className?: string;
  footerClassName?: string;
}

export function BodySilhouetteGuide({
  label = "Lùi lại một chút (Step back)",
  subLabel = "Đứng cách camera 1.5m – 2m để AI nhận diện trọn vẹn dáng người",
  className = "",
  footerClassName = "mb-6",
}: BodySilhouetteGuideProps) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-between overflow-hidden select-none ${className}`}
    >
      {/* Khung viền Silhouette SVG */}
      <div className="relative flex-1 w-full flex items-center justify-center">
        <svg
          viewBox="0 0 400 600"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full max-h-[88%] max-w-[420px] drop-shadow-[0_0_12px_rgba(255,255,255,0.18)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Lớp nền vignette mờ nhẹ bên ngoài vùng căn chỉnh để nổi bật tư thế */}
          <defs>
            <radialGradient id="guideGlow" cx="50%" cy="30%" r="50%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.08)" />
              <stop offset="100%" stopColor="rgba(0, 0, 0, 0.45)" />
            </radialGradient>
            <linearGradient id="strokeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.75)" />
              <stop offset="65%" stopColor="rgba(255, 255, 255, 0.55)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0.15)" />
            </linearGradient>
          </defs>

          {/* Đường viền khung người chuẩn xác theo mẫu (Đầu tròn, cổ có gấc, vai thoải tự nhiên, thân thẳng) */}
          <path
            d="
              M 200 45
              A 54 54 0 1 1 199.9 45
              M 183 150
              L 183 190
              L 165 198
              C 130 215, 95 255, 82 320
              C 74 365, 72 450, 72 600
              M 217 150
              L 217 190
              L 235 198
              C 270 215, 305 255, 318 320
              C 326 365, 328 450, 328 600
            "
            stroke="url(#strokeGradient)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Đường tâm dọc & trục ngực hỗ trợ căn giữa (mảnh, mờ) */}
          <line
            x1="200"
            y1="35"
            x2="200"
            y2="580"
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth="1"
            strokeDasharray="4 6"
          />
          <line
            x1="120"
            y1="250"
            x2="280"
            y2="250"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="1"
            strokeDasharray="4 6"
          />
        </svg>
      </div>

      {/* Nhãn hướng dẫn ở chân khung hình (Đúng vị trí Step back trong ảnh) */}
      <div className={`${footerClassName} flex flex-col items-center gap-1 px-4 text-center transition-all`}>
        <div className="rounded-full bg-black/75 px-4 py-1.5 text-xs font-semibold text-white/95 backdrop-blur-md border border-white/20 shadow-xl tracking-wide">
          {label}
        </div>
        {subLabel && (
          <p className="text-[11px] font-medium text-white/80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] max-w-xs">
            {subLabel}
          </p>
        )}
      </div>
    </div>
  );
}
