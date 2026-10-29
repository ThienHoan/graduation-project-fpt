"use client";

import { useEffect, useState, useRef } from "react";
import { Sparkles } from "lucide-react";
import { playRoyalChime } from "@/lib/sound-fx";

const HERITAGE_TIPS = [
  "Khởi tạo kho lưu trữ y phục Triều Nguyễn...",
  "Chuẩn hóa tỷ lệ Nhật Bình & Áo Tấc chuẩn tư liệu...",
  "Kích hoạt mô hình Thử Đồ AI đa chiều độc quyền...",
  "Sẵn sàng mở cửa không gian Di sản Cung Đình...",
];

export function HeritageBootLoader() {
  const [mounted, setMounted] = useState(false);
  const [percent, setPercent] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isDestroyed, setIsDestroyed] = useState(false);

  const reqIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Kiểm tra xem trong session này đã xem bootloader chưa
    if (typeof window !== "undefined") {
      const alreadyShown = sessionStorage.getItem("co-phuc:boot-loaded");
      if (alreadyShown === "true") {
        setIsDestroyed(true);
        return;
      }
    }

    setMounted(true);

    let progress = 0;
    let target = 0;
    const startTime = performance.now();
    const duration = 1400; // 1.4s nạp mượt mà, ấn tượng mà không bắt người dùng đợi lâu

    const updateLoop = (now: number) => {
      const elapsed = now - startTime;
      const linearPct = Math.min(100, (elapsed / duration) * 100);

      // Easing curve nhẹ nhàng
      target = linearPct;
      progress += (target - progress) * 0.18;

      if (progress >= 99.5) {
        progress = 100;
        setPercent(100);
        setIsFinishing(true);
        sessionStorage.setItem("co-phuc:boot-loaded", "true");

        // Ngân chuông khánh hoàng cung khi tải xong
        setTimeout(() => {
          playRoyalChime();
        }, 50);

        setTimeout(() => {
          setIsDestroyed(true);
        }, 550);
        return;
      }

      setPercent(Math.floor(progress));

      // Đổi câu chúc/tip theo mốc
      if (progress > 75) setTipIndex(3);
      else if (progress > 50) setTipIndex(2);
      else if (progress > 25) setTipIndex(1);

      reqIdRef.current = requestAnimationFrame(updateLoop);
    };

    reqIdRef.current = requestAnimationFrame(updateLoop);

    return () => {
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
    };
  }, []);

  if (!mounted || isDestroyed) return null;

  return (
    <div
      role="progressbar"
      aria-label="Đang nạp không gian di sản"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#181110] text-amber-50 select-none transition-all duration-500 ease-out ${
        isFinishing ? "opacity-0 scale-105 pointer-events-none" : "opacity-100 scale-100"
      }`}
    >
      {/* Quầng sáng hoàng gia phía sau */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(180,83,9,0.18)_0%,transparent_65%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(217,119,6,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(217,119,6,0.03)_1px,transparent_1px)] bg-[size:36px_36px] pointer-events-none" />

      <div className="relative flex flex-col items-center max-w-sm px-6 text-center">
        {/* Biểu tượng Hoàng Tộc thở nhẹ */}
        <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-amber-500/30 bg-amber-500/10 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/50 bg-gradient-to-br from-amber-600/30 to-rose-950/60 shadow-[0_0_25px_rgba(217,119,6,0.35)] backdrop-blur-md">
            <Sparkles className="h-8 w-8 text-amber-300 animate-[pulse_2s_ease-in-out_infinite]" />
          </div>
        </div>

        {/* Tên thương hiệu & định vị */}
        <h2 className="font-display text-2xl font-bold tracking-wider text-amber-100 sm:text-3xl">
          CỔ PHỤC RENTAL
        </h2>
        <p className="mt-1 text-xs font-medium tracking-widest text-amber-400/80 uppercase">
          Bảo Tồn Di Sản &amp; Thử Đồ AI
        </p>

        {/* Con số % mạ vàng */}
        <div className="mt-8 flex items-baseline gap-1">
          <span className="font-display text-5xl font-black tracking-tight text-white tabular-nums drop-shadow-[0_2px_12px_rgba(251,191,36,0.3)]">
            {percent}
          </span>
          <span className="text-xl font-bold text-amber-400">%</span>
        </div>

        {/* Thanh tiến trình ánh kim Shimmer */}
        <div className="relative mt-4 h-1.5 w-64 overflow-hidden rounded-full bg-stone-800/80 border border-amber-900/40">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-600 via-amber-400 to-rose-400 transition-all duration-75 ease-out shadow-[0_0_12px_rgba(245,158,11,0.6)]"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Dòng trạng thái di sản */}
        <p className="mt-4 min-h-[20px] text-xs font-medium tracking-wide text-stone-400 animate-pulse">
          {HERITAGE_TIPS[tipIndex]}
        </p>
      </div>

      {/* Chân trang màn loader */}
      <div className="absolute bottom-6 text-[11px] tracking-widest uppercase text-stone-500 font-medium">
        Đồ Án Tốt Nghiệp · FPT University
      </div>
    </div>
  );
}
