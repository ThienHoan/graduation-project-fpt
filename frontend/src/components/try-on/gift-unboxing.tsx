"use client";

import React, { useState, useId } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Tag,
  Clock,
  Copy,
  Check,
  ShoppingBag,
  Gift,
  ArrowRight,
  RotateCcw,
} from "lucide-react";

interface GiftUnboxingProps {
  voucherCode: string;
  discountLabel?: string;
  expiresIn?: string;
  onCopyVoucher: () => void;
  voucherCopied: boolean;
  selectedGarment?: { slug?: string; name?: string; [key: string]: unknown } | null;
  onClose: () => void;
  remainingSessionsToday?: number | null;
  onRestartLive?: () => void;
}

// Hàm phát âm thanh mừng khai tiệc cổ phục bằng Web Audio API thuần (không phụ thuộc file mp3 ngoài)
function playCelebrationSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    const chordFrequencies = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 (Hợp âm Đô trưởng vang thanh thoát)
    chordFrequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.08 + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + idx * 0.08);
      osc.stop(ctx.currentTime + idx * 0.08 + 0.56);
    });
  } catch {
    // Không làm gián đoạn nếu trình duyệt chặn autoplay âm thanh
  }
}

// 40 mảnh pháo giấy confetti đa sắc bay tứ phía khi nắp hộp mở
const CONFETTI_PARTICLES = Array.from({ length: 36 }).map((_, i) => {
  const angle = (i / 36) * 360 + (Math.random() * 20 - 10);
  const distance = 90 + Math.random() * 140;
  const rad = (angle * Math.PI) / 180;
  const colors = [
    "#F59E0B", // Hổ phách hoàng triều
    "#FDE68A", // Vàng ánh kim
    "#B91C1C", // Đỏ trầm hoa sen (Lotus)
    "#E11D48", // Đỏ hồng thắm
    "#10B981", // Ngọc bích
    "#60A5FA", // Lam ngọc
    "#FFFFFF", // Kim tuyến bạc
  ];
  return {
    id: i,
    x: Math.cos(rad) * distance,
    y: Math.sin(rad) * distance - 30, // Hướng hơi hếch lên trên
    scale: 0.5 + Math.random() * 0.8,
    color: colors[i % colors.length],
    rotation: Math.random() * 720 - 360,
    delay: Math.random() * 0.1,
  };
});

export function GiftUnboxing({
  voucherCode,
  discountLabel = "10%",
  expiresIn = "24 giờ",
  onCopyVoucher,
  voucherCopied,
  selectedGarment,
  onClose,
  remainingSessionsToday,
  onRestartLive,
}: GiftUnboxingProps) {
  const [isOpened, setIsOpened] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const titleId = useId();

  const handleOpenBox = () => {
    if (isOpened || isOpening) return;
    setIsOpening(true);
    playCelebrationSound();

    setTimeout(() => {
      setIsOpened(true);
      setIsOpening(false);
    }, 450);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-y-auto bg-zinc-950/95 p-4 sm:p-6 backdrop-blur-md">
      {/* Nền hiệu ứng hào quang tia sáng xoay nhẹ */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          className={`h-[480px] w-[480px] rounded-full bg-gradient-to-tr from-amber-500/10 via-lotus/20 to-amber-400/15 blur-3xl transition-all duration-1000 ${
            isOpened ? "scale-125 opacity-70" : "scale-100 opacity-40 animate-pulse"
          }`}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <AnimatePresence mode="wait">
          {!isOpened ? (
            /* ========================================================
               GIAI ĐOẠN 1: HỘP QUÀ BÍ ẨN CHỜ KHÁCH BẤM MỞ
               ======================================================== */
            <motion.div
              key="mystery-box"
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: -20 }}
              transition={{ type: "spring", damping: 20, stiffness: 260 }}
              className="flex w-full flex-col items-center"
            >
              {/* Huy hiệu kết thúc phiên */}
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-3.5 py-1 text-xs font-semibold text-amber-300 shadow-sm backdrop-blur-md">
                <Sparkles className="h-3.5 w-3.5 text-amber-300 animate-spin" style={{ animationDuration: "3s" }} />
                <span>Hoàn tất phiên thử 15s • Nhận quà may mắn</span>
              </div>

              <h2 id={titleId} className="mt-3 text-lg sm:text-xl font-bold tracking-tight text-zinc-100">
                Bạn vừa mở khoá một hộp quà tri ân!
              </h2>
              <p className="mt-1 text-xs text-zinc-400 max-w-xs">
                Chạm vào hộp quà hoàng kim để nhận đặc quyền giảm giá khi thuê bộ cổ phục này.
              </p>

              {/* Chiếc hộp quà tương tác 3D */}
              <div className="relative my-7 flex items-center justify-center">
                {/* Vầng hào quang xoay tròn */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
                  className="absolute -inset-10 rounded-full bg-[conic-gradient(from_0deg,transparent_0_300deg,rgba(245,158,11,0.25)_360deg)] pointer-events-none"
                />

                {/* Hộp quà có thể bấm vào */}
                <motion.button
                  type="button"
                  onClick={handleOpenBox}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.94 }}
                  animate={
                    isOpening
                      ? { scale: [1, 1.15, 0.95], rotate: [0, -6, 6, -3, 3, 0] }
                      : { y: [0, -8, 0], rotate: [-1.5, 1.5, -1.5] }
                  }
                  transition={
                    isOpening
                      ? { duration: 0.45 }
                      : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }
                  }
                  className="group relative flex h-36 w-36 sm:h-40 sm:w-40 cursor-pointer flex-col items-center justify-center focus:outline-none"
                >
                  {/* Bóng đổ dưới chân hộp quà */}
                  <div className="absolute -bottom-2 h-5 w-28 rounded-full bg-black/60 blur-md transition-all group-hover:w-32 group-hover:bg-black/80" />

                  {/* Nắp hộp quà */}
                  <motion.div
                    animate={isOpening ? { y: -60, rotate: -25, opacity: 0 } : { y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="relative z-20 flex h-11 w-36 sm:w-40 items-center justify-center rounded-xl bg-gradient-to-r from-amber-600 via-amber-500 to-lotus shadow-xl border-t border-amber-300/60"
                  >
                    {/* Dải nơ ruy băng vàng */}
                    <div className="absolute inset-y-0 w-6 bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 shadow-md" />
                    {/* Bông nơ hoàng triều */}
                    <div className="absolute -top-3 flex items-center justify-center">
                      <div className="h-6 w-6 rounded-full bg-amber-300 shadow-lg border border-amber-100 flex items-center justify-center">
                        <Gift className="h-3.5 w-3.5 text-zinc-950" />
                      </div>
                    </div>
                  </motion.div>

                  {/* Thân hộp quà */}
                  <div className="relative z-10 -mt-1 flex h-24 w-32 sm:h-28 sm:w-36 items-center justify-center rounded-b-2xl bg-gradient-to-b from-red-950 via-lotus to-zinc-950 p-2 shadow-2xl border-x border-b border-amber-500/30 overflow-hidden">
                    {/* Vân ruy băng dọc thân */}
                    <div className="absolute inset-y-0 w-6 bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 shadow-md" />
                    {/* Biểu tượng cổ phong lấp lánh */}
                    <Sparkles className="relative z-10 h-7 w-7 text-amber-200 group-hover:scale-110 transition" />
                  </div>
                </motion.button>
              </div>

              {/* Nút hành động Mở Quà Ngay */}
              <button
                type="button"
                onClick={handleOpenBox}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-lotus px-7 py-3 text-sm font-bold text-zinc-950 shadow-xl shadow-amber-500/25 transition hover:brightness-110 active:scale-95 animate-bounce"
                style={{ animationDuration: "2s" }}
              >
                <Gift className="h-4 w-4" />
                <span>Chạm để mở Hộp Quà</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          ) : (
            /* ========================================================
               GIAI ĐOẠN 2: HOA GIẤY BÙNG NỔ & THẺ VOUCHER TRỒI LÊN
               ======================================================== */
            <motion.div
              key="opened-reward"
              initial={{ opacity: 0, scale: 0.7, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", damping: 18, stiffness: 220 }}
              className="relative flex w-full flex-col items-center"
            >
              {/* Pháo hoa Confetti bay tung tóe ra tứ phía */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                {CONFETTI_PARTICLES.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
                    animate={{
                      x: p.x,
                      y: p.y,
                      scale: [0, p.scale, p.scale * 0.7],
                      opacity: [1, 1, 0],
                      rotate: p.rotation,
                    }}
                    transition={{
                      duration: 1.4,
                      delay: p.delay,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    className="absolute h-3 w-3 rounded-sm shadow-sm"
                    style={{ backgroundColor: p.color }}
                  />
                ))}
              </div>

              {/* Huy hiệu chúc mừng */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.1, stiffness: 300, damping: 15 }}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-1 text-xs font-bold text-emerald-400 shadow-md backdrop-blur-md"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                <span>Mở quà thành công! Chúc mừng quý khách</span>
              </motion.div>

              <h2 className="mt-2 text-lg sm:text-xl font-extrabold tracking-tight text-zinc-100">
                Ưu Đãi Độc Quyền Giảm {discountLabel}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400 max-w-sm">
                Mã giảm giá đã được liên kết với tài khoản của bạn, tự động kích hoạt khi thanh toán.
              </p>

              {/* Thẻ Voucher Hoàng Kim Sang Trọng */}
              <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.4 }}
                className="relative mt-4 w-full rounded-2xl border-2 border-amber-400/50 bg-gradient-to-b from-amber-500/20 via-zinc-900/90 to-zinc-950 p-4 text-left shadow-2xl backdrop-blur-xl overflow-hidden"
              >
                {/* Vân mây góc phong cách cung đình */}
                <div className="absolute top-0 right-0 -mr-6 -mt-6 h-20 w-20 rounded-full bg-amber-400/10 blur-xl pointer-events-none" />

                <div className="flex items-center justify-between border-b border-amber-400/20 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/20 text-amber-300 border border-amber-400/30">
                      <Tag className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        Voucher Giảm {discountLabel}
                      </span>
                      <p className="text-[10px] text-zinc-400">Áp dụng cho mọi bộ cổ phục</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-400/20">
                    <Clock className="h-3 w-3 text-amber-400" />
                    <span>Hạn dùng {expiresIn}</span>
                  </div>
                </div>

                {/* Hộp mã code & Nút Sao Chép */}
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-black/75 px-4 py-3 shadow-inner">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                      Mã ưu đãi của bạn
                    </span>
                    <div className="font-mono text-lg font-black tracking-widest text-amber-300">
                      {voucherCode}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onCopyVoucher}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                      voucherCopied
                        ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105"
                        : "bg-amber-400 text-zinc-950 hover:bg-amber-300 active:scale-95 shadow-md shadow-amber-400/20"
                    }`}
                  >
                    {voucherCopied ? (
                      <>
                        <Check className="h-4 w-4" />
                        <span>Đã chép!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>Sao chép</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>

              {/* Các nút điều hướng chuyển đổi (Call to action) */}
              <div className="mt-4 flex w-full flex-col sm:flex-row items-center gap-2.5">
                {selectedGarment?.slug ? (
                  <Link
                    href={`/catalog/${selectedGarment.slug}`}
                    onClick={() => {
                      onCopyVoucher();
                      onClose();
                    }}
                    className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-2.5 text-xs font-bold text-white hover:bg-lotus/90 transition shadow-lg shadow-lotus/25"
                  >
                    <ShoppingBag className="h-4 w-4 text-amber-200" />
                    <span>Thuê ngay bộ này (-{discountLabel})</span>
                  </Link>
                ) : (
                  <Link
                    href="/catalog"
                    onClick={() => {
                      onCopyVoucher();
                      onClose();
                    }}
                    className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-2.5 text-xs font-bold text-white hover:bg-lotus/90 transition shadow-lg shadow-lotus/25"
                  >
                    <ShoppingBag className="h-4 w-4 text-amber-200" />
                    <span>Dùng mã ở Bộ Sưu Tập</span>
                  </Link>
                )}

                <Link
                  href="/try-on"
                  onClick={onClose}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span>Thử ảnh tĩnh</span>
                </Link>
              </div>

              {/* Tùy chọn mở thêm phiên hoặc đóng */}
              <div className="mt-3 flex items-center justify-center gap-4">
                {typeof remainingSessionsToday === "number" && remainingSessionsToday > 0 && onRestartLive ? (
                  <button
                    type="button"
                    onClick={onRestartLive}
                    className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Thử thêm áo khác (còn {remainingSessionsToday} lượt)</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                >
                  Đóng cửa sổ
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
