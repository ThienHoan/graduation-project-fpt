"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Zap,
  Sparkles,
  Maximize2,
  RotateCcw,
  Camera,
  Download,
  Calendar,
  X,
  Split,
  Image as ImageIcon,
  Share2,
  Check,
  CheckCircle2,
  AlertTriangle,
  Shirt,
  Ruler,
  Compass,
  Activity,
  Layers,
} from "lucide-react";

type TryonResultViewerProps = {
  resultImageUrl: string;
  userImageBase64: string | null;
  referenceGarmentImageUrl?: string | null;
  garmentName: string;
  sizeLabel?: string | null;
  selectedSizeId?: string | null;
  isCached?: boolean;
  customerMeasurements?: {
    heightCm?: number | null;
    weightKg?: number | null;
    bustCm?: number | null;
    waistCm?: number | null;
    hipCm?: number | null;
    usualSize?: string | null;
  } | null;
  sizeMeasurements?: {
    shoulderCm?: number | null;
    bustCm?: number | null;
    waistCm?: number | null;
    hipCm?: number | null;
    lengthCm?: number | null;
    sleeveLengthCm?: number | null;
  } | null;
  categoryName?: string | null;
  availableSizes?: Array<{
    garmentSizeId: string;
    sizeLabel: string | null;
  }>;
  onChangeSize?: (garmentSizeId: string) => void;
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
  customerMeasurements,
  sizeMeasurements,
  categoryName,
  availableSizes = [],
  onChangeSize,
  onRetry,
  onReset,
}: TryonResultViewerProps) {
  const [viewMode, setViewMode] = useState<"result" | "side_by_side" | "original">("result");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const originalSrc = userImageBase64
    ? `data:image/jpeg;base64,${userImageBase64}`
    : referenceGarmentImageUrl ?? "";

  const handleShare = async () => {
    const shareData = {
      title: `Thử đồ AI: ${garmentName}`,
      text: `Xem tôi thử trang phục cổ phục "${garmentName}" bằng công nghệ AI Virtual Try-On!`,
      url: window.location.href,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(resultImageUrl || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // ── Tính toán phân tích độ vừa vặn trực quan ──
  const bustDiff =
    sizeMeasurements?.bustCm && customerMeasurements?.bustCm
      ? Number(sizeMeasurements.bustCm) - Number(customerMeasurements.bustCm)
      : null;

  const waistDiff =
    sizeMeasurements?.waistCm && customerMeasurements?.waistCm
      ? Number(sizeMeasurements.waistCm) - Number(customerMeasurements.waistCm)
      : null;

  // Chiều dài tà ước tính
  const estimatedClearance =
    customerMeasurements?.heightCm && sizeMeasurements?.lengthCm
      ? Math.max(0, Math.round(Number(customerMeasurements.heightCm) - 25 - Number(sizeMeasurements.lengthCm)))
      : null;

  // Gợi ý phụ kiện chuẩn theo loại cổ phục
  const accessoryAdvice = (() => {
    const cat = (categoryName ?? garmentName).toLowerCase();
    if (cat.includes("nhật bình") || cat.includes("nhat binh")) {
      return "Phối cùng hài thêu phượng, trâm cài hoa ngọc và kiềng chạm bạc để toát lên nét tôn quý cung đình.";
    }
    if (cat.includes("áo tấc") || cat.includes("ao tac") || cat.includes("ngũ thân")) {
      return "Phối cùng quạt lụa cầm tay, guốc mộc và khăn đóng/mấn tiệp màu tạo nét nho nhã, trang trọng.";
    }
    return "Phối cùng guốc mộc cao từ 5-7cm và nón quai thao hoặc mấn đội đầu tiệp màu để có diện mạo hoàn hảo nhất.";
  })();

  return (
    <div className="flex h-full flex-col justify-between p-4">
      {/* Top Header & View Mode Switcher */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-sand/70 pb-3">
        <div className="flex items-center gap-2">
          {isCached ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <Zap className="h-3.5 w-3.5 text-emerald-600" />
              Kết quả từ Cache (Tức thì)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-lotus/20 bg-lotus/10 px-2.5 py-1 text-xs font-semibold text-lotus">
              <Sparkles className="h-3.5 w-3.5" />
              AI tạo mới chuẩn phom
            </span>
          )}
          <span className="text-xs font-medium text-stone-600">
            {garmentName} {sizeLabel ? `(Size ${sizeLabel})` : ""}
          </span>
        </div>

        {/* Action Controls: Heatmap & View Mode */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Fit Heatmap Toggle (Ý tưởng 3) */}
          {viewMode === "result" && (
            <button
              type="button"
              onClick={() => setShowHeatmap((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                showHeatmap
                  ? "border-lotus bg-lotus text-white shadow-xs"
                  : "border-sand bg-white text-stone-700 hover:border-lotus/40 hover:text-lotus"
              }`}
              title="Quét độ căng / thụng phom dáng theo size"
            >
              <Activity className="h-3.5 w-3.5" />
              <span>{showHeatmap ? "Tắt Heatmap" : "Quét phom dáng"}</span>
            </button>
          )}

          {/* View mode toggle */}
          <div className="inline-flex rounded-lg border border-sand bg-mist p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setViewMode("result");
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                viewMode === "result" ? "bg-white text-lotus shadow-xs font-semibold" : "text-stone-600 hover:text-ink"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              Ảnh AI
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("side_by_side");
                setShowHeatmap(false);
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                viewMode === "side_by_side" ? "bg-white text-lotus shadow-xs font-semibold" : "text-stone-600 hover:text-ink"
              }`}
            >
              <Split className="h-3 w-3" />
              So sánh
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("original");
                setShowHeatmap(false);
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                viewMode === "original" ? "bg-white text-lotus shadow-xs font-semibold" : "text-stone-600 hover:text-ink"
              }`}
            >
              <ImageIcon className="h-3 w-3" />
              Ảnh gốc
            </button>
          </div>
        </div>
      </div>

      {/* Main Image Display Area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden py-2">
        {viewMode === "result" && (
          <div className="group relative flex max-h-[480px] w-full justify-center">
            <img
              src={resultImageUrl}
              alt="Kết quả thử đồ AI"
              className="max-h-[480px] w-auto rounded-xl object-contain shadow-md cursor-pointer transition hover:opacity-95"
              onClick={() => setIsLightboxOpen(true)}
            />

            {/* Fit Tension Heatmap Overlay (Ý tưởng 3) */}
            {showHeatmap && (
              <div className="pointer-events-none absolute inset-0 mx-auto flex max-h-[480px] w-full max-w-[360px] flex-col justify-between rounded-xl bg-black/25 p-3.5 backdrop-blur-[1px] text-white">
                {/* Header Tag */}
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
                    <Activity className="h-3.5 w-3.5 text-antique animate-pulse" />
                    Quét độ căng phom dáng theo Size
                  </span>
                  {sizeLabel && (
                    <span className="rounded-full bg-lotus px-2 py-0.5 text-[10px] font-bold">
                      Size {sizeLabel}
                    </span>
                  )}
                </div>

                {/* 3 Hotspot Tension Markers */}
                <div className="relative flex-1 w-full flex flex-col justify-around py-2">
                  {/* Zone 1: Chest & Shoulders */}
                  <div className="flex items-center justify-center">
                    {bustDiff !== null && bustDiff < 0 ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-red-400 bg-red-950/85 px-3 py-1.5 text-[11px] font-semibold text-red-200 shadow-lg animate-pulse">
                        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                        <span>Vùng ngực: Căng tức ({bustDiff}cm) · Bó chật</span>
                      </div>
                    ) : bustDiff !== null && bustDiff > 6 ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-blue-400 bg-blue-950/85 px-3 py-1.5 text-[11px] font-semibold text-blue-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                        <span>Vùng vai & ngực: Thùng thình (+{bustDiff}cm) · Vai trễ</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-950/85 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                        <span>Vùng ngực: Vừa vặn (+{bustDiff ?? 3}cm cử động)</span>
                      </div>
                    )}
                  </div>

                  {/* Zone 2: Waist */}
                  <div className="flex items-center justify-center">
                    {waistDiff !== null && waistDiff < 0 ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-red-400 bg-red-950/85 px-3 py-1.5 text-[11px] font-semibold text-red-200 shadow-lg animate-pulse">
                        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                        <span>Vùng eo: Bó sát ({waistDiff}cm) · Khó cử động</span>
                      </div>
                    ) : waistDiff !== null && waistDiff > 5 ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-blue-400 bg-blue-950/85 px-3 py-1.5 text-[11px] font-semibold text-blue-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                        <span>Vùng eo: Thùng thình (+{waistDiff}cm) · Dư vải</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-950/85 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                        <span>Vùng eo: Chuẩn phom thon gọn (+{waistDiff ?? 2}cm)</span>
                      </div>
                    )}
                  </div>

                  {/* Zone 3: Drape / Hem */}
                  <div className="flex items-center justify-center">
                    {estimatedClearance !== null && estimatedClearance < 5 ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-blue-400 bg-blue-950/85 px-3 py-1.5 text-[11px] font-semibold text-blue-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                        <span>Tà áo: Quét đất (&lt;5cm) · Quá dài do size to</span>
                      </div>
                    ) : estimatedClearance !== null && estimatedClearance > 20 ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-950/85 px-3 py-1.5 text-[11px] font-semibold text-amber-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                        <span>Tà áo: Lửng bắp chân (&gt;20cm) · Hơi cộc do size nhỏ</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-950/85 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 shadow-lg">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                        <span>Tà áo: Cách đất ~{estimatedClearance ?? 12}cm · Thướt tha chuẩn</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Heatmap Legend */}
                <div className="flex items-center justify-center gap-3 rounded-lg bg-black/80 px-3 py-1 text-[10px] text-stone-200 font-medium">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500" /> Bó chật
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Vừa in
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-blue-400" /> Rộng / Thùng thình
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsLightboxOpen(true)}
              className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white backdrop-blur-sm transition hover:bg-black/80"
              title="Phóng to"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        )}

        {viewMode === "original" && (
          <div className="flex max-h-[480px] w-full justify-center">
            {originalSrc ? (
              <img
                src={originalSrc}
                alt="Ảnh gốc của bạn"
                className="max-h-[480px] w-auto rounded-xl object-contain shadow-md"
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
                className="max-h-[420px] w-full rounded-xl object-contain shadow-xs border border-sand"
              />
            </div>
            <div className="flex flex-col items-center">
              <span className="mb-1 text-xs font-semibold text-lotus">Kết quả AI mặc thử</span>
              <img
                src={resultImageUrl}
                alt="Kết quả AI"
                className="max-h-[420px] w-full rounded-xl object-contain shadow-xs border border-lotus/30 cursor-pointer"
                onClick={() => setIsLightboxOpen(true)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Switch Size Quick Selector if multiple sizes exist */}
      {availableSizes.length > 1 && onChangeSize && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-sand bg-white px-3.5 py-2 text-xs shadow-2xs">
          <span className="font-medium text-stone-600 flex items-center gap-1.5">
            <Shirt className="h-3.5 w-3.5 text-lotus" />
            Thử so sánh với Size khác:
          </span>
          <div className="flex items-center gap-1.5">
            {availableSizes.map((s) => (
              <button
                key={s.garmentSizeId}
                type="button"
                onClick={() => onChangeSize(s.garmentSizeId)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  s.garmentSizeId === selectedSizeId
                    ? "bg-lotus text-white shadow-2xs"
                    : "border border-sand bg-parchment/60 text-stone-600 hover:bg-lotus/10 hover:text-lotus"
                }`}
              >
                Size {s.sizeLabel ?? "—"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bảng Phân Tích Độ Vừa Vặn & AI Stylist Advisor */}
      <div className="mt-3 rounded-xl border border-lotus/25 bg-parchment/80 p-3.5 text-xs text-stone-700 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between border-b border-sand/70 pb-2">
          <div className="flex items-center gap-2 font-bold text-lotus">
            <Sparkles className="h-4 w-4 text-antique" />
            <span>Phân tích phom dáng & phối đồ từ AI Stylist:</span>
          </div>
          {sizeLabel && (
            <span className="rounded-md bg-lotus/10 px-2 py-0.5 text-[11px] font-semibold text-lotus">
              Đang thử Size {sizeLabel}
            </span>
          )}
        </div>

        {/* 3 Metric Fit Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Drape */}
          <div className="rounded-lg border border-sand/80 bg-white/90 p-2.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 mb-0.5">
              <Ruler className="h-3 w-3 text-lotus" />
              <span>Độ dài tà áo</span>
            </div>
            <p className="font-semibold text-ink text-xs">
              {sizeMeasurements?.lengthCm ? `${sizeMeasurements.lengthCm}cm` : "Tiêu chuẩn"}
            </p>
            <p className="text-[11px] text-stone-500 mt-0.5">
              {estimatedClearance !== null ? (
                <>Cách mặt đất ~{estimatedClearance}cm (chấm mắt cá)</>
              ) : (
                <>Phủ tà tha thướt đoan trang</>
              )}
            </p>
          </div>

          {/* Bust fit */}
          <div className="rounded-lg border border-sand/80 bg-white/90 p-2.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 mb-0.5">
              <Shirt className="h-3 w-3 text-lotus" />
              <span>Độ ôm vòng ngực</span>
            </div>
            <p className="font-semibold text-ink text-xs">
              {sizeMeasurements?.bustCm ? `${sizeMeasurements.bustCm}cm` : "—"}
              {customerMeasurements?.bustCm ? ` (Số đo: ${customerMeasurements.bustCm}cm)` : ""}
            </p>
            <p className="text-[11px] mt-0.5 font-medium">
              {bustDiff !== null ? (
                bustDiff >= 1 && bustDiff <= 6 ? (
                  <span className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Vừa vặn (+{bustDiff}cm cử động)
                  </span>
                ) : bustDiff < 1 ? (
                  <span className="text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Ôm sát ngực
                  </span>
                ) : (
                  <span className="text-stone-600">Rộng rãi (+{bustDiff}cm)</span>
                )
              ) : (
                <span className="text-stone-500">Phom dáng thoải mái</span>
              )}
            </p>
          </div>

          {/* Waist fit */}
          <div className="rounded-lg border border-sand/80 bg-white/90 p-2.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 mb-0.5">
              <Compass className="h-3 w-3 text-lotus" />
              <span>Độ ôm vòng eo</span>
            </div>
            <p className="font-semibold text-ink text-xs">
              {sizeMeasurements?.waistCm ? `${sizeMeasurements.waistCm}cm` : "—"}
              {customerMeasurements?.waistCm ? ` (Số đo: ${customerMeasurements.waistCm}cm)` : ""}
            </p>
            <p className="text-[11px] mt-0.5 font-medium">
              {waistDiff !== null ? (
                waistDiff >= 1 && waistDiff <= 4 ? (
                  <span className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Chuẩn dáng eo thon
                  </span>
                ) : waistDiff < 1 ? (
                  <span className="text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Hơi ôm sát eo
                  </span>
                ) : (
                  <span className="text-stone-600">Rộng eo nhẹ (+{waistDiff}cm)</span>
                )
              ) : (
                <span className="text-stone-500">Tôn dáng tự nhiên</span>
              )}
            </p>
          </div>
        </div>

        {/* Styling text advice */}
        <p className="leading-relaxed text-stone-600 text-[11px] pt-0.5">
          {customerMeasurements?.heightCm ? (
            <>
              Dựa trên chiều cao <strong className="text-ink">{customerMeasurements.heightCm}cm</strong>
              {customerMeasurements.weightKg ? ` và cân nặng ${customerMeasurements.weightKg}kg` : ""}, 
              trang phục <strong className="text-lotus">{garmentName}</strong> {sizeLabel ? `(size ${sizeLabel})` : ""} có tỷ lệ cắt may hài hòa với phom người bạn.
            </>
          ) : (
            <>
              Phom dáng <strong className="text-lotus">{garmentName}</strong> {sizeLabel ? `(size ${sizeLabel})` : ""} giúp tôn vinh đường nét cơ thể thanh thoát, tà áo thướt tha mang đậm nét đoan trang truyền thống.
            </>
          )}
          {" "}{accessoryAdvice}
        </p>
      </div>

      {/* Action Toolbar */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 border-t border-sand/70 pt-4">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-lotus shadow-xs transition hover:bg-lotus/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Thử lại
        </button>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-xs transition hover:bg-stone-50"
        >
          <Camera className="h-3.5 w-3.5" />
          Đổi ảnh khác
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-xs transition hover:bg-stone-50"
          title="Chia sẻ kết quả thử đồ với bạn bè"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Share2 className="h-3.5 w-3.5 text-lotus" />}
          <span>{copied ? "Đã chép link!" : "Chia sẻ"}</span>
        </button>

        <a
          href={resultImageUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={`${garmentName.replace(/\s+/g, "_")}_tryon.png`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-xs transition hover:bg-stone-50"
        >
          <Download className="h-3.5 w-3.5" />
          Tải ảnh HD
        </a>

        <Link
          href={
            selectedSizeId
              ? `/booking/date-selection?garmentSizeId=${selectedSizeId}`
              : "/booking/date-selection"
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-lotus px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood"
        >
          <Calendar className="h-3.5 w-3.5" />
          Đặt lịch thuê size này
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
              className="max-h-[90vh] w-auto rounded-lg object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setIsLightboxOpen(false)}
              className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
              title="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
