"use client";

import { ChangeEvent, useRef, useState } from "react";
import {
  UploadCloud,
  RefreshCw,
  Trash2,
  AlertCircle,
  Sparkles,
  Crop,
  CheckCircle2,
  Sun,
  ShieldCheck,
} from "lucide-react";

type ImageUploadProps = {
  onUpload: (base64: string) => void;
};

type ImageAnalysis = {
  width: number;
  height: number;
  aspectRatio: number;
  is3to4: boolean;
  brightness: "good" | "dark" | "bright";
};

const MAX_IMAGE_MB = 8;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function stripDataUriPrefix(dataUrl: string) {
  return dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
}

export function ImageUpload({ onUpload }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [isAutoCropped, setIsAutoCropped] = useState(false);

  function analyzeImageProperties(dataUrl: string) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const ratio = w / h;
      const is3to4 = Math.abs(ratio - 0.75) < 0.08;

      // Sample brightness
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      let brightnessRating: "good" | "dark" | "bright" = "good";

      if (ctx) {
        ctx.drawImage(img, 0, 0, 64, 64);
        const data = ctx.getImageData(0, 0, 64, 64).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          total += data[i] + data[i + 1] + data[i + 2];
        }
        const avg = total / (data.length / 4) / 3;
        if (avg < 50) brightnessRating = "dark";
        else if (avg > 230) brightnessRating = "bright";
      }

      setAnalysis({
        width: w,
        height: h,
        aspectRatio: ratio,
        is3to4,
        brightness: brightnessRating,
      });
    };
    img.src = dataUrl;
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setErrorMsg(null);
    setIsAutoCropped(false);

    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrorMsg("Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setErrorMsg(`Ảnh không được vượt quá ${MAX_IMAGE_MB}MB.`);
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        setErrorMsg("Không thể đọc ảnh. Vui lòng chọn ảnh khác.");
        return;
      }
      setPreviewUrl(dataUrl);
      setFileName(file.name);
      analyzeImageProperties(dataUrl);
      onUpload(stripDataUriPrefix(dataUrl));
    };
    reader.onerror = () => setErrorMsg("Không thể đọc ảnh. Vui lòng chọn ảnh khác.");
    reader.readAsDataURL(file);
  }

  function handleAutoCropTo34() {
    if (!previewUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      // Target aspect ratio 3:4 (w/h = 0.75)
      let cropW = origW;
      let cropH = origH;
      let startX = 0;
      let startY = 0;

      if (origW / origH > 0.75) {
        // Image is wider than 3:4 -> crop sides
        cropW = origH * 0.75;
        startX = (origW - cropW) / 2;
      } else {
        // Image is taller than 3:4 -> crop top/bottom with bias towards upper body
        cropH = origW / 0.75;
        startY = (origH - cropH) * 0.25; // keep face/shoulders visible
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cropW);
      canvas.height = Math.round(cropH);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, startX, startY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.92);

      setPreviewUrl(croppedDataUrl);
      setIsAutoCropped(true);
      analyzeImageProperties(croppedDataUrl);
      onUpload(stripDataUriPrefix(croppedDataUrl));
    };
    img.src = previewUrl;
  }

  function clearImage() {
    setPreviewUrl(null);
    setFileName(null);
    setErrorMsg(null);
    setAnalysis(null);
    setIsAutoCropped(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {previewUrl ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl border border-sand bg-mist shadow-sm">
            <img src={previewUrl} alt={fileName ?? "Ảnh đã upload"} className="aspect-[3/4] w-full object-cover" />

            {isAutoCropped && (
              <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm shadow-xs">
                <CheckCircle2 className="h-3 w-3" />
                Đã căn chỉnh tỉ lệ chuẩn 3:4
              </span>
            )}
          </div>

          {/* AI Readiness Pre-flight Check */}
          {analysis && (
            <div className="rounded-xl border border-sand bg-parchment/70 p-3 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-stone-700 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-lotus" />
                  Đánh giá độ chuẩn hóa ảnh cho AI:
                </span>
                <span className="text-[11px] text-stone-400 font-mono">
                  {analysis.width}×{analysis.height}px
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {/* Aspect ratio badge */}
                {analysis.is3to4 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    Tỉ lệ 3:4 hoàn hảo cho mặc thử
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAutoCropTo34}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100"
                    title="Bấm để tự động cắt ảnh căn giữa người theo tỉ lệ 3:4 chuẩn cho AI"
                  >
                    <Crop className="h-3.5 w-3.5 text-amber-700" />
                    <span>Cắt căn giữa chuẩn tỉ lệ 3:4 ngay</span>
                  </button>
                )}

                {/* Brightness badge */}
                {analysis.brightness === "good" ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    <Sun className="h-3 w-3 text-emerald-600" />
                    Độ sáng đạt chuẩn
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    <AlertCircle className="h-3 w-3 text-amber-600" />
                    {analysis.brightness === "dark" ? "Ảnh hơi tối (khuyên chụp sáng hơn)" : "Ảnh hơi chói sáng"}
                  </span>
                )}
              </div>
            </div>
          )}

          {fileName && (
            <p className="flex items-center gap-1.5 text-xs text-stone-500">
              <Sparkles className="h-3.5 w-3.5 text-antique" />
              <span>
                Đã chọn: <strong className="font-semibold text-ink">{fileName}</strong>
              </span>
            </p>
          )}

          <div className="flex flex-wrap gap-2.5">
            {!analysis?.is3to4 && !isAutoCropped && (
              <button
                type="button"
                onClick={handleAutoCropTo34}
                className="inline-flex items-center gap-1.5 rounded-lg border border-lotus/40 bg-lotus/10 px-3.5 py-2 text-xs font-semibold text-lotus shadow-xs transition hover:bg-lotus hover:text-white"
              >
                <Crop className="h-3.5 w-3.5" />
                Căn chỉnh chuẩn 3:4
              </button>
            )}

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-xs transition hover:border-antique hover:bg-stone-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Chọn ảnh khác
            </button>

            <button
              type="button"
              onClick={clearImage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-600 shadow-xs transition hover:border-red-400 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xoá ảnh
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-antique/50 bg-mist/60 px-6 py-10 text-center transition hover:border-lotus hover:bg-parchment"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-antique/10 text-antique transition group-hover:scale-105 group-hover:bg-lotus/10 group-hover:text-lotus">
            <UploadCloud className="h-6 w-6" />
          </div>
          <span className="mt-3 text-sm font-semibold text-ink">Chọn ảnh chân dung từ thiết bị</span>
          <span className="mt-1 text-xs text-stone-500">JPG, PNG hoặc WebP · tối đa {MAX_IMAGE_MB}MB</span>
        </button>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <p className="text-xs leading-5 text-stone-500">
        Ảnh chụp góc chính diện, đứng thẳng người, rõ mặt và ánh sáng đều sẽ giúp AI IDM-VTON đổ bóng và nếp gấp tà áo chân thực nhất.
      </p>
    </div>
  );
}
