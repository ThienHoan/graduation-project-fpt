"use client";

import { useState } from "react";
import Link from "next/link";

type TryonResultViewerProps = {
  resultImageUrl: string;
  userImageBase64: string | null;
  referenceGarmentImageUrl?: string | null;
  garmentName: string;
  sizeLabel?: string | null;
  selectedSizeId?: string | null;
  isCached?: boolean;
  onRetry: () => void;
  onReset: () => void;
};

export function TryonResultViewer({
  resultImageUrl,
  userImageBase64,
  referenceGarmentImageUrl,
  garmentName,
  sizeLabel,
  selectedSizeId,
  isCached = false,
  onRetry,
  onReset,
}: TryonResultViewerProps) {
  const [viewMode, setViewMode] = useState<"result" | "side_by_side" | "original">("result");
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const originalSrc = userImageBase64
    ? `data:image/jpeg;base64,${userImageBase64}`
    : referenceGarmentImageUrl ?? "";

  return (
    <div className="flex h-full flex-col justify-between p-4">
      {/* Top Header & View Mode Switcher */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-sand pb-3">
        <div className="flex items-center gap-2">
          {isCached ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              Kết quả từ Cache (Tức thì)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-800">
              <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
              AI tạo mới
            </span>
          )}
          <span className="text-xs font-medium text-stone-600">
            {garmentName} {sizeLabel ? `(Size ${sizeLabel})` : ""}
          </span>
        </div>

        {/* View mode toggle */}
        <div className="inline-flex rounded-lg border border-sand bg-mist p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("result")}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "result" ? "bg-white text-lotus shadow-sm" : "text-stone-600 hover:text-ink"
            }`}
          >
            Ảnh AI
          </button>
          <button
            type="button"
            onClick={() => setViewMode("side_by_side")}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "side_by_side" ? "bg-white text-lotus shadow-sm" : "text-stone-600 hover:text-ink"
            }`}
          >
            So sánh song song
          </button>
          <button
            type="button"
            onClick={() => setViewMode("original")}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "original" ? "bg-white text-lotus shadow-sm" : "text-stone-600 hover:text-ink"
            }`}
          >
            Ảnh gốc
          </button>
        </div>
      </div>

      {/* Main Image Display Area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden py-2">
        {viewMode === "result" && (
          <div className="group relative flex max-h-[500px] w-full justify-center">
            <img
              src={resultImageUrl}
              alt="Kết quả thử đồ AI"
              className="max-h-[500px] w-auto rounded-lg object-contain shadow-md cursor-pointer transition hover:opacity-95"
              onClick={() => setIsLightboxOpen(true)}
            />
            <button
              type="button"
              onClick={() => setIsLightboxOpen(true)}
              className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white backdrop-blur-sm transition hover:bg-black/80"
              title="Phóng to"
            >
              <span className="material-symbols-outlined text-[18px]">zoom_in</span>
            </button>
          </div>
        )}

        {viewMode === "original" && (
          <div className="flex max-h-[500px] w-full justify-center">
            {originalSrc ? (
              <img
                src={originalSrc}
                alt="Ảnh gốc của bạn"
                className="max-h-[500px] w-auto rounded-lg object-contain shadow-md"
              />
            ) : (
              <p className="text-sm text-stone-400">Không có ảnh gốc</p>
            )}
          </div>
        )}

        {viewMode === "side_by_side" && (
          <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
            <div className="flex flex-col items-center">
              <span className="mb-1 text-xs font-medium text-stone-500">Ảnh gốc</span>
              <img
                src={originalSrc}
                alt="Ảnh gốc"
                className="max-h-[440px] w-full rounded-lg object-contain shadow-sm"
              />
            </div>
            <div className="flex flex-col items-center">
              <span className="mb-1 text-xs font-medium text-lotus font-semibold">Kết quả AI mặc thử</span>
              <img
                src={resultImageUrl}
                alt="Kết quả AI"
                className="max-h-[440px] w-full rounded-lg object-contain shadow-sm cursor-pointer"
                onClick={() => setIsLightboxOpen(true)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 border-t border-sand pt-4">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-lotus shadow-sm transition hover:bg-lotus/10"
        >
          <span className="material-symbols-outlined text-[16px]">autorenew</span>
          Thử lại
        </button>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50"
        >
          <span className="material-symbols-outlined text-[16px]">photo_camera</span>
          Đổi ảnh khác
        </button>

        <a
          href={resultImageUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={`${garmentName.replace(/\s+/g, "_")}_tryon.png`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          Tải ảnh HD
        </a>

        <Link
          href={
            selectedSizeId
              ? `/booking/date-selection?garmentSizeId=${selectedSizeId}`
              : "/booking/date-selection"
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-lotus px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow transition hover:bg-oxblood"
        >
          <span className="material-symbols-outlined text-[16px]">calendar_month</span>
          Đặt lịch thuê mẫu này
        </Link>
      </div>

      {/* Fullscreen Lightbox Modal */}
      {isLightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
          onClick={() => setIsLightboxOpen(false)}
        >
          <div className="relative max-h-screen max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={resultImageUrl}
              alt="Kết quả thử đồ AI toàn màn hình"
              className="max-h-[90vh] w-auto rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setIsLightboxOpen(false)}
              className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
              title="Đóng"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
