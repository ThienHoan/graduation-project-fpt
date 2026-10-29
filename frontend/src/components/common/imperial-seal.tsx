"use client";

import React, { useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { playImperialStamp } from "@/lib/sound-fx";

interface ImperialSealProps {
  title?: string;
  subtitle?: string;
  year?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * ImperialSeal — Con Dấu Triện Hoàng Gia Đóng Dấu Xác Thực Di Sản
 * Hiệu ứng rơi đập mạnh (Stamp down) khi cuộn vào viewport kèm âm thanh gõ mộc / ngọc tỷ.
 * Có thể nhấp chuột để đóng dấu lại và nghe âm thanh xúc giác.
 */
export function ImperialSeal({
  title = "NGUYỄN TRIỀU",
  subtitle = "BẢO ĐỊNH DI SẢN",
  year = "GIÁP THÌN",
  className = "",
  size = "md",
}: ImperialSealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, amount: 0.6 });
  const shouldReduceMotion = useReducedMotion();
  const hasPlayedSound = useRef(false);
  const [clickCount, setClickCount] = useState(0);

  // Kích hoạt âm thanh khi cuộn vào tầm nhìn lần đầu
  React.useEffect(() => {
    if (isInView && !hasPlayedSound.current && !shouldReduceMotion) {
      hasPlayedSound.current = true;
      // Trễ 150ms để khớp với khoảnh khắc con dấu chạm mặt giấy
      const timer = setTimeout(() => {
        playImperialStamp();
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isInView, shouldReduceMotion]);

  const handleManualStamp = (e: React.MouseEvent) => {
    playImperialStamp({ event: e });
    setClickCount((c) => c + 1);
  };

  const sizeClasses = {
    sm: "h-20 w-20 text-[9px]",
    md: "h-28 w-28 text-[11px]",
    lg: "h-36 w-36 text-xs",
  }[size];

  if (shouldReduceMotion) {
    return (
      <div className={`relative inline-flex items-center justify-center ${className}`}>
        <div className={`flex flex-col items-center justify-center rounded border-2 border-red-700 bg-red-50/70 p-2 text-center font-bold text-red-800 ${sizeClasses}`}>
          <span>{title}</span>
          <span className="my-0.5 border-t border-b border-red-700/60 py-0.5 text-[9px]">{subtitle}</span>
          <span>{year}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <motion.button
        type="button"
        key={clickCount}
        onClick={handleManualStamp}
        initial={{
          opacity: 0,
          scale: 2.2,
          y: -40,
          rotate: -15,
        }}
        animate={
          isInView
            ? {
                opacity: 0.95,
                scale: 1,
                y: 0,
                rotate: -3,
              }
            : {}
        }
        transition={{
          type: "spring",
          stiffness: 450,
          damping: 24,
          mass: 1.2,
          delay: 0.1,
        }}
        whileHover={{
          scale: 1.05,
          rotate: 0,
          transition: { duration: 0.2 },
        }}
        whileTap={{
          scale: 0.95,
          rotate: -6,
        }}
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed border-red-700/80 bg-red-100/35 p-3 text-center font-serif font-black tracking-widest text-red-800 shadow-[inset_0_0_12px_rgba(185,28,28,0.2),0_4px_14px_rgba(185,28,28,0.25)] backdrop-blur-2xs select-none transition-shadow hover:shadow-[0_0_20px_rgba(220,38,38,0.4)] ${sizeClasses}`}
        title="Nhấp để đóng dấu ấn Hoàng Cung"
      >
        {/* Viền đôi thư pháp phong cách ấn triện */}
        <div className="pointer-events-none absolute inset-1 rounded-xs border border-red-800/70" />

        {/* Chữ Triện Son */}
        <span className="relative z-10 font-bold uppercase tracking-wider text-red-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
          {title}
        </span>
        <div className="relative z-10 my-1 w-full border-t border-b border-red-800/50 py-0.5 text-[9px] font-semibold text-red-800">
          {subtitle}
        </div>
        <span className="relative z-10 text-[9px] font-bold text-red-900/90">
          {year}
        </span>

        {/* Hạt mực son nhòe tự nhiên (Cinnabar Ink Texture) */}
        <div className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-red-700/20 blur-xs" />
        <div className="pointer-events-none absolute -top-1 -left-1 h-2 w-2 rounded-full bg-red-800/25 blur-xs" />
      </motion.button>
    </div>
  );
}
