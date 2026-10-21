"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { playHoverTick, playWhoosh } from "@/lib/sound-fx";
import { Sparkles } from "lucide-react";

interface CurtainRevealSliderProps {
  originalImage: string;
  costumeImage: string;
  originalLabel?: string;
  costumeLabel?: string;
  matchScore?: string;
  aspectRatio?: string;
  className?: string;
}

/**
 * CurtainRevealSlider — "Gương Thần AI" Rèm Kéo Biến Hình Trực Quan
 * Cho phép kéo vuốt chia đôi ảnh (Split-screen) so sánh trước và sau khi ướm cổ phục AI.
 * Có đường quét laser sinh học, huy hiệu vàng son, và tương tác âm thanh.
 */
export function CurtainRevealSlider({
  originalImage,
  costumeImage,
  originalLabel = "Đời thường",
  costumeLabel = "Cổ phục Hoàng Cung",
  matchScore = "98.5%",
  aspectRatio = "aspect-[3/4]",
  className = "",
}: CurtainRevealSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSoundTime = useRef(0);

  // Xử lý tính toán vị trí % từ tọa độ chuột / touch
  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(5, Math.min(95, (x / rect.width) * 100));
    setSliderPosition(percentage);

    // Kích hoạt âm thanh tick nhẹ định kỳ khi kéo
    const now = Date.now();
    if (now - lastSoundTime.current > 70) {
      playHoverTick({ pan: (percentage / 100) * 1.6 - 0.8 });
      lastSoundTime.current = now;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length > 0) {
      handleMove(e.touches[0].clientX);
    }
  }, [handleMove]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    handleMove(e.clientX);
  }, [handleMove]);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleEnd);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", handleEnd);
  }, [handleMouseMove, handleTouchMove]);

  const handleStart = (clientX: number) => {
    setIsDragging(true);
    setHasInteracted(true);
    playWhoosh({ pan: (sliderPosition / 100) * 1.6 - 0.8 });
    handleMove(clientX);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleEnd);
  };

  // Tự động lướt demo nhẹ nhàng khi mới vào màn hình nếu người dùng chưa tương tác
  useEffect(() => {
    if (hasInteracted) return;
    let frame: number;
    let start: number | null = null;
    const duration = 2800;

    const animatePeek = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = (timestamp - start) / duration;

      if (progress < 1 && !hasInteracted) {
        // Dao động hình sin nhẹ nhàng 50% -> 68% -> 32% -> 50%
        const offset = Math.sin(progress * Math.PI * 2) * 16;
        setSliderPosition(50 + offset);
        frame = requestAnimationFrame(animatePeek);
      } else if (!hasInteracted) {
        setSliderPosition(50);
      }
    };

    const timer = setTimeout(() => {
      frame = requestAnimationFrame(animatePeek);
    }, 800);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [hasInteracted]);

  return (
    <div
      ref={containerRef}
      className={`relative select-none overflow-hidden rounded-2xl border-2 border-sand bg-stone-900 shadow-xl ${aspectRatio} ${className}`}
      onMouseDown={(e) => handleStart(e.clientX)}
      onTouchStart={(e) => {
        if (e.touches.length > 0) handleStart(e.touches[0].clientX);
      }}
      role="slider"
      aria-valuenow={Math.round(sliderPosition)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Kéo thanh trượt để so sánh ảnh gốc và ảnh AI Cổ Phục"
      tabIndex={0}
    >
      {/* 1. Lớp ảnh gốc (Hiện đại - Bên trái) */}
      <img
        src={originalImage}
        alt="Chân dung đời thường"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />

      {/* 2. Lớp ảnh Cổ Phục AI (Bên phải - Cắt theo clipPath) */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)`,
        }}
      >
        <img
          src={costumeImage}
          alt="Cổ phục hoàng cung phục dựng AI"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>

      {/* 3. Tia sáng Laser AI Hologram & Đường Rèm Phân Cách */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-gradient-to-b from-amber-300 via-white to-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.9)]"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Hào quang quét laser */}
        <div className="absolute inset-y-0 -left-1 -right-1 bg-amber-400/30 blur-xs" />
      </div>

      {/* 4. Con thoi kéo vàng kim (Imperial Brass Knob) */}
      <div
        className={`absolute top-1/2 z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-amber-200 bg-gradient-to-br from-amber-500 via-lotus to-oxblood text-white shadow-2xl transition-transform ${
          isDragging ? "scale-115 shadow-[0_0_20px_rgba(217,119,6,0.8)]" : "hover:scale-105"
        }`}
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Biểu tượng 2 mũi tên kéo đối xứng */}
        <svg
          className="h-5 w-5 fill-current drop-shadow-xs"
          viewBox="0 0 24 24"
        >
          <path d="M8.5 7l-5 5 5 5v-3h7v3l5-5-5-5v3h-7V7z" />
        </svg>
      </div>

      {/* 5. Huy hiệu nhãn mác hai bên */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 rounded-md bg-stone-900/80 px-2.5 py-1 text-[11px] font-bold text-stone-200 backdrop-blur-md shadow-xs border border-white/10">
        {originalLabel}
      </div>

      <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md bg-lotus/90 px-2.5 py-1 text-[11px] font-bold text-amber-100 backdrop-blur-md shadow-xs border border-amber-300/30">
        <Sparkles className="h-3 w-3 text-amber-300" />
        <span>{costumeLabel}</span>
      </div>

      {/* 6. Thanh chỉ số độ khớp AI đáy */}
      <div className="pointer-events-none absolute bottom-3 inset-x-3 z-10 flex items-center justify-between rounded-lg bg-black/75 px-3 py-1.5 text-xs text-white backdrop-blur-md border border-white/15">
        <span className="flex items-center gap-1.5 text-stone-300 text-[11px]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping-subtle absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Kéo con thoi để biến hình
        </span>
        <span className="font-bold text-amber-300">
          Độ khớp AI: <span className="text-white">{matchScore}</span>
        </span>
      </div>
    </div>
  );
}
