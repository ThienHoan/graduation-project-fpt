"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { Sparkles } from "lucide-react";

interface OptimizedImageProps extends Omit<ImageProps, "onError" | "onLoad"> {
  fallbackSrc?: string;
  fallbackText?: string;
  containerClassName?: string;
}

/**
 * Component hiển thị ảnh tối ưu hoá:
 * - Tự động chuyển đổi sang WebP & AVIF thông qua Next.js Image Optimization Pipeline
 * - Hỗ trợ Responsive srcset, Lazy load mặc định
 * - Smooth skeleton loading & graceful fallback nếu ảnh lỗi
 */
export function OptimizedImage({
  src,
  alt,
  className = "",
  containerClassName = "",
  fallbackSrc,
  fallbackText = "Cổ phục di sản",
  fill,
  width,
  height,
  priority = false,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  ...props
}: OptimizedImageProps) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Xử lý khi không có src hoặc lỗi ảnh
  if (!src || (error && !fallbackSrc)) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-stone-100 text-stone-400 ${containerClassName}`}
      >
        <div className="flex flex-col items-center gap-1.5 p-3 text-center">
          <Sparkles className="h-5 w-5 text-stone-300" />
          <span className="text-xs font-medium text-stone-500">{fallbackText}</span>
        </div>
      </div>
    );
  }

  const effectiveSrc = error && fallbackSrc ? fallbackSrc : src;

  return (
    <div
      className={`relative overflow-hidden ${
        fill ? "h-full w-full" : ""
      } ${containerClassName}`}
    >
      {/* Skeleton loading mượt mà */}
      {!loaded && (
        <div className="absolute inset-0 z-0 animate-pulse bg-gradient-to-tr from-stone-200 to-stone-100" />
      )}

      <Image
        src={effectiveSrc}
        alt={alt || "Ảnh trang phục cổ phục"}
        fill={fill}
        width={!fill ? width || 600 : undefined}
        height={!fill ? height || 800 : undefined}
        priority={priority}
        sizes={sizes}
        loading={priority ? undefined : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`transition-all duration-500 ease-out ${
          loaded ? "opacity-100 scale-100" : "opacity-0 scale-105"
        } ${className}`}
        {...props}
      />
    </div>
  );
}
