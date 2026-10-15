"use client";

import { ChangeEvent, useRef, useState } from "react";
import { UploadCloud, RefreshCw, Trash2, AlertCircle, Sparkles } from "lucide-react";

type ImageUploadProps = {
  onUpload: (base64: string) => void;
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

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setErrorMsg(null);

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
      onUpload(stripDataUriPrefix(dataUrl));
    };
    reader.onerror = () => setErrorMsg("Không thể đọc ảnh. Vui lòng chọn ảnh khác.");
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setPreviewUrl(null);
    setFileName(null);
    setErrorMsg(null);
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
          <div className="overflow-hidden rounded-xl border border-sand bg-mist shadow-sm">
            <img src={previewUrl} alt={fileName ?? "Ảnh đã upload"} className="aspect-[3/4] w-full object-cover" />
          </div>
          {fileName && (
            <p className="flex items-center gap-1.5 text-xs text-stone-500">
              <Sparkles className="h-3.5 w-3.5 text-antique" />
              <span>Đã chọn: <strong className="font-semibold text-ink">{fileName}</strong></span>
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-4 py-2 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-antique hover:bg-stone-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Chọn ảnh khác
            </button>
            <button
              type="button"
              onClick={clearImage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 shadow-sm transition hover:border-red-400 hover:bg-red-50"
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
        Ảnh chụp góc chính diện, rõ mặt và ánh sáng đều sẽ giúp AI tái hiện dáng vẻ trang phục tự nhiên nhất.
      </p>
    </div>
  );
}
