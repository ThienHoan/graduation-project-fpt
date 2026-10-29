"use client";

import React, { useRef, useState, useMemo } from "react";
import Link from "next/link";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useMotionValueEvent,
  useReducedMotion,
  AnimatePresence,
} from "framer-motion";
import { OptimizedImage } from "@/components/common/optimized-image";
import { CurtainRevealSlider } from "@/components/common/curtain-reveal-slider";
import { ImperialSeal } from "@/components/common/imperial-seal";
import { playWoodTap, playRoyalChime, playHoverTick, playWhoosh } from "@/lib/sound-fx";
import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Award,
  Box,
  Compass,
  Search,
  Eye,
  Sliders,
  CheckCircle2,
  Maximize2,
  ZoomIn,
} from "lucide-react";

interface ScrollytellingChaptersProps {
  originalPortrait: string;
  tryonPreset: {
    name: string;
    era: string;
    match: string;
    img: string;
    note: string;
  };
  onSelectPreset?: (key: string) => void;
  activePresetKey?: string;
  presetList?: Record<string, { name: string; era: string; match: string; img: string; note: string }>;
}

// Dữ liệu các lớp dệt thêu cho Chương 02
const WEAVE_LAYERS = [
  {
    id: "gam-sa",
    name: "Nhật Bình Xanh Ngọc",
    origin: "Hoàng Thành Huế (Cố Đô)",
    density: "220 sợi/cm²",
    goldType: "Chỉ dát vàng sa 18K",
    desc: "Nền lụa dệt đôi thấu quang với hoa văn phượng hoàng và mây nước chìm, viền cổ ngũ sắc chuẩn Khâm Định.",
    textureImg: "https://cophuchoangthanhhue.com/wp-content/uploads/2024/10/Hinh-anh-34-1.jpeg",
    accentColor: "#00d4ff",
  },
  {
    id: "lua-to-tam",
    name: "Áo Tấc Đỏ Tay Thụng",
    origin: "Làng Dệt Vạn Phúc & Nha Xá",
    density: "180 sợi/cm²",
    goldType: "Sa Nam đoạn dệt tơ tằm đỏ",
    desc: "100% sợi tơ nguyên bản đỏ chu sa rực rỡ, tay thụng uy nghiêm dành cho hôn lễ và đại lễ gia tiên.",
    textureImg:
      "https://ecylctxtoznnjjcctlxx.supabase.co/storage/v1/object/public/products/1790873816007-cho-thue-ao-ngu-than-tay-thung-3_630.webp",
    accentColor: "#ef4444",
  },
  {
    id: "doan-hoa-chim",
    name: "Áo Dài Đỏ Thêu Sen",
    origin: "Thêu Tay Quất Động Phục Chế",
    density: "260 sợi/cm²",
    goldType: "Thêu tay sen vàng kim tuyến",
    desc: "Kỹ thuật thêu tay truyền thống đóa sen quốc hoa bung nở trên nền lụa đỏ son may mắn, tôn vinh nét đài các.",
    textureImg:
      "https://bizweb.dktcdn.net/100/236/196/products/1fefad15c3cd17934edc.jpg?v=1696474705203",
    accentColor: "#f43f5e",
  },
];

// Các điểm chạm khảo cổ (Hotspot Pins) trên áo
const ARCHAEOLOGICAL_PINS = [
  {
    id: "co-ngu-sac",
    title: "Cổ Áo Ngũ Sắc",
    category: "TRIỀU NGUYỄN",
    top: "22%",
    left: "50%",
    detail:
      "Năm dải màu vàng, lục, lam, hồng, đen tượng trưng cho Ngũ Hành tương sinh, biểu thị trật tự vũ trụ thanh bình.",
  },
  {
    id: "phuong-hoang-kim",
    title: "Ngũ Phụng Triều Dương",
    category: "CHỈ VÀNG 18K",
    top: "44%",
    left: "48%",
    detail:
      "Từng đường kim thêu tay thủ công hơn 120 giờ của nghệ nhân Huế với chỉ tơ dát vàng kim sa bắt sáng lộng lẫy.",
  },
  {
    id: "thuy-ba-song-nuoc",
    title: "Thủy Ba & Tam Sơn",
    category: "HOA VĂN ĐẠI TRIỀU",
    top: "76%",
    left: "52%",
    detail:
      "Dải sóng nước ngũ sắc cuộn dâng biểu thị sự trường tồn vĩnh cửu của giang sơn gấm vóc non sông Đại Việt.",
  },
];

export function ScrollytellingChapters({
  originalPortrait,
  tryonPreset,
  onSelectPreset,
  activePresetKey = "nhatbinh",
  presetList,
}: ScrollytellingChaptersProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  // State tương tác cho Chương 02
  const [selectedWeaveIndex, setSelectedWeaveIndex] = useState(0);
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const [isMagnifierMode, setIsMagnifierMode] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState({ x: 50, y: 50 });

  // Theo dõi tiến độ cuộn qua toàn bộ container
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 160,
    damping: 26,
    restDelta: 0.0005,
  });

  // Chuyển đổi tiến độ cuộn cho 4 chương rõ ràng không bị đè chữ
  // Chương 1: [0, 0.21]
  const opacity1 = useTransform(smoothProgress, [0, 0.15, 0.21], [1, 1, 0]);
  const y1 = useTransform(smoothProgress, [0, 0.21], [0, -40]);

  // Chương 2: [0.23, 0.49] -> TÍCH HỢP ZOOM CAMERA & HIỆU ỨNG TÁCH LỚP ĐỘNG
  const opacity2 = useTransform(smoothProgress, [0.23, 0.28, 0.45, 0.49], [0, 1, 1, 0]);
  const y2 = useTransform(smoothProgress, [0.23, 0.28, 0.49], [40, 0, -40]);
  // Camera Zoom từ toàn thân áo phóng to vào cổ áo và ngực thêu
  const chapter2Zoom = useTransform(smoothProgress, [0.28, 0.43], [1, 1.25]);
  const chapter2PanY = useTransform(smoothProgress, [0.28, 0.43], ["0%", "-10%"]);
  // Độ rực của sợi chỉ vàng tăng dần khi cuộn
  const goldThreadGlow = useTransform(
    smoothProgress,
    [0.28, 0.36, 0.46],
    [0.2, 0.8, 0.4]
  );

  // Chương 3: [0.51, 0.74]
  const opacity3 = useTransform(smoothProgress, [0.51, 0.56, 0.7, 0.74], [0, 1, 1, 0]);
  const y3 = useTransform(smoothProgress, [0.51, 0.56, 0.74], [40, 0, -40]);

  // Chương 4: [0.76, 1]
  const opacity4 = useTransform(smoothProgress, [0.76, 0.82, 1], [0, 1, 1]);
  const y4 = useTransform(smoothProgress, [0.76, 0.82], [40, 0]);

  // Thanh tiến trình
  const progressPercent = useTransform(smoothProgress, [0, 1], ["0%", "100%"]);

  // Chuyển nhanh tới chương bất kỳ
  const scrollToChapter = (index: number) => {
    if (!containerRef.current) return;
    playWoodTap();
    const rect = containerRef.current.getBoundingClientRect();
    const scrollTop = window.scrollY + rect.top;
    const scrollDistance = containerRef.current.offsetHeight - window.innerHeight;
    const targetY = scrollTop + (index / 3) * scrollDistance;
    window.scrollTo({ top: targetY, behavior: "smooth" });
  };

  const currentWeave = WEAVE_LAYERS[selectedWeaveIndex];

  return (
    <div ref={containerRef} className="relative h-[420vh] bg-[#07090e] text-stone-100 select-none">
      {/* Khung dính toàn màn hình (Sticky 100vh Frame) */}
      <div className="sticky top-0 flex h-screen w-full flex-col justify-between overflow-hidden px-4 py-6 sm:px-8 lg:px-14">
        {/* Quầng sáng nền động theo nhịp chương */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_35%,rgba(217,119,6,0.08),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

        {/* 1. Header Dẫn Truyện & Bộ Chọn Chương Nhanh */}
        <div className="relative z-30 mx-auto flex w-full max-w-7xl items-center justify-between border-b border-white/10 pb-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)] animate-pulse" />
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-amber-300">
              Sử Thi Di Sản Cuộn Trang
            </span>
          </div>

          {/* Dải 4 Tab Chương có thể click để nhảy đến */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-medium">
            {[
              { id: 0, label: "01 Khởi Nguyên" },
              { id: 1, label: "02 Tuyệt Kỹ Dệt Thêu" },
              { id: 2, label: "03 Gương Thần AI" },
              { id: 3, label: "04 Bàn Giao" },
            ].map((chap) => (
              <button
                key={chap.id}
                onClick={() => scrollToChapter(chap.id)}
                className="px-3 py-1 rounded-full text-stone-400 hover:text-amber-200 hover:bg-white/[0.06] transition-all"
              >
                {chap.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-stone-400 hidden sm:inline">Tiến trình</span>
            <div className="h-1.5 w-24 sm:w-32 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full bg-gradient-to-r from-amber-400 via-rose-500 to-[#00d4ff] shadow-[0_0_8px_rgba(251,191,36,0.9)]"
                style={{ width: progressPercent }}
              />
            </div>
          </div>
        </div>

        {/* 2. Khu Vực Trình Diễn 4 Chương Kể Chuyện */}
        <div className="relative mx-auto flex h-full w-full max-w-7xl items-center justify-center">
          {/* ================= CHƯƠNG 01: KHỞI NGUYÊN DI SẢN ================= */}
          <motion.div
            style={shouldReduceMotion ? {} : { opacity: opacity1, y: y1 }}
            className="absolute inset-0 flex flex-col justify-center items-center text-center px-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-semibold text-amber-300 backdrop-blur-md shadow-lg">
              <Award className="h-4 w-4 text-amber-400" />
              <span>Chương 01 — Dấu Ấn Hoàng Triều</span>
            </div>

            <h2 className="mt-5 font-display text-4xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">
              Một Bước Chạm Vào
              <br />
              <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-rose-400 bg-clip-text text-transparent drop-shadow-[0_4px_24px_rgba(251,191,36,0.4)]">
                Nghìn Năm Vàng Son
              </span>
            </h2>

            <p className="mt-4 max-w-2xl text-sm sm:text-base text-stone-300 leading-relaxed">
              Từ kinh kỳ Thăng Long nghìn năm văn vật đến cung cấm Huế ngát hương sen. Mỗi bộ y phục
              được tái hiện chuẩn điển chế lịch sử với linh hồn của người thợ thủ công xưa.
            </p>

            <div className="mt-7 flex items-center gap-4">
              <ImperialSeal size="md" title="NGUYỄN TRIỀU" subtitle="BẢO ĐỊNH DI SẢN" year="GIÁP THÌN" />
            </div>

            <div className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-amber-300/80 animate-bounce">
              <span>Cuộn chuột để khám phá Tuyệt Kỹ Dệt Thêu</span>
              <span>↓</span>
            </div>
          </motion.div>

          {/* ================= CHƯƠNG 02: TUYỆT KỸ DỆT THÊU & MỔ XẺ CHI TIẾT ================= */}
          <motion.div
            style={shouldReduceMotion ? {} : { opacity: opacity2, y: y2 }}
            className="pointer-events-auto absolute inset-0 grid grid-cols-1 items-center gap-6 lg:grid-cols-12 px-4 max-w-7xl mx-auto w-full"
          >
            {/* Cột 1 (4 cols): Nội dung thuyết minh & Bộ chọn cấu trúc dệt tương tác */}
            <div className="lg:col-span-4 text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-semibold text-amber-300 backdrop-blur-md mb-2">
                <Layers className="h-4 w-4 text-amber-400" />
                <span>Chương 02 — Tuyệt Kỹ Dệt Thêu Di Sản</span>
              </div>

              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight text-white">
                Tơ Sen, Gấm Quý
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-rose-400">
                  &amp; Chỉ Vàng Kim Tuyến
                </span>
              </h2>

              <p className="mt-2.5 text-xs sm:text-sm text-stone-300 leading-relaxed">
                Không dùng sợi công nghiệp. 100% y phục dệt từ tơ tằm nguyên bản nhuộm thảo mộc tự nhiên theo phương pháp bí truyền lưu trữ tại bảo tàng.
              </p>

              {/* Bộ chọn Cấu trúc Dệt Vải (Weave Selector Tabs) */}
              <div className="mt-4 p-3 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md">
                <span className="text-[10px] font-mono uppercase text-white/50 tracking-wider block mb-2">
                  Cấu Trúc Lớp Vải Hoàng Tộc:
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {WEAVE_LAYERS.map((weave, idx) => (
                    <button
                      key={weave.id}
                      onClick={() => {
                        playWoodTap();
                        setSelectedWeaveIndex(idx);
                      }}
                      className={`px-2.5 py-2 rounded-xl text-left transition-all ${
                        selectedWeaveIndex === idx
                          ? "bg-amber-400/20 border border-amber-400/60 shadow-lg"
                          : "bg-white/[0.03] border border-transparent hover:bg-white/[0.08]"
                      }`}
                    >
                      <div className="text-[11px] font-bold text-white truncate">{weave.name}</div>
                      <div className="text-[9px] text-amber-300/80 font-mono mt-0.5">{weave.density}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-2 pt-2 border-t border-white/10 text-xs text-stone-300">
                  <span className="font-semibold text-amber-300">{currentWeave.goldType}: </span>
                  <span className="text-[11px] text-stone-300 line-clamp-2">{currentWeave.desc}</span>
                </div>
              </div>

              {/* Thông số kiểm định bảo tàng */}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
                  <div className="font-mono text-xl sm:text-2xl font-black text-amber-300">100%</div>
                  <div className="text-[10px] sm:text-[11px] text-stone-300">Tơ tằm &amp; thêu tay thủ công</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
                  <div className="font-mono text-xl sm:text-2xl font-black text-rose-300">45 Ngày</div>
                  <div className="text-[10px] sm:text-[11px] text-stone-300">Thời gian phục chế một bộ</div>
                </div>
              </div>
            </div>

            {/* Cột 2 (5 cols): Khung Trưng Bày Phóng Đại Động & Các Điểm Chạm Khảo Cổ (Hotspots) */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center">
              <div className="relative w-full max-w-[420px] aspect-[4/4.9] rounded-3xl overflow-hidden border border-amber-500/40 bg-stone-950 p-2 shadow-[0_0_50px_rgba(245,158,11,0.2)]">
                {/* Lớp hiển thị ảnh y phục với chuyển động zoom camera liên kết khi cuộn */}
                <motion.div
                  style={{
                    scale: shouldReduceMotion ? 1 : chapter2Zoom,
                    y: shouldReduceMotion ? 0 : chapter2PanY,
                  }}
                  className="relative w-full h-full rounded-2xl overflow-hidden"
                >
                  <OptimizedImage
                    src={currentWeave.textureImg}
                    alt="Phẩm phục hoàng triều"
                    fill
                    sizes="(max-width: 768px) 100vw, 450px"
                    className="object-cover object-top"
                  />

                  {/* Lớp phủ óng ánh vàng kim tuyến tăng giảm theo độ cuộn */}
                  <motion.div
                    style={{ opacity: goldThreadGlow }}
                    className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.35),transparent_70%)] pointer-events-none mix-blend-color-dodge"
                  />

                  {/* Các Điểm Chạm Khảo Cổ (Interactive Hotspot Pins) */}
                  {ARCHAEOLOGICAL_PINS.map((pin) => {
                    const isPinActive = activeHotspot === pin.id;
                    return (
                      <div
                        key={pin.id}
                        style={{ top: pin.top, left: pin.left }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 z-30"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            playRoyalChime();
                            setActiveHotspot(isPinActive ? null : pin.id);
                          }}
                          className="group relative flex items-center justify-center"
                          aria-label={pin.title}
                        >
                          <span className="absolute w-8 h-8 rounded-full bg-amber-400/30 animate-ping" />
                          <span className="relative w-5 h-5 rounded-full bg-amber-400 border-2 border-black flex items-center justify-center shadow-lg group-hover:scale-125 transition-transform">
                            <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                          </span>
                        </button>

                        {/* Hộp thông tin chi tiết của điểm chạm */}
                        <AnimatePresence>
                          {isPinActive && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9, y: 10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: 10 }}
                              className="absolute top-7 left-1/2 -translate-x-1/2 w-56 sm:w-64 p-3 rounded-2xl bg-black/90 border border-amber-400/60 shadow-2xl backdrop-blur-xl text-left z-40"
                            >
                              <div className="text-[10px] font-mono text-amber-400 uppercase tracking-widest font-bold">
                                {pin.category}
                              </div>
                              <div className="text-xs font-bold text-white mt-0.5">{pin.title}</div>
                              <p className="text-[11px] text-stone-300 mt-1 leading-snug">{pin.detail}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </motion.div>

                {/* Thanh điều khiển góc dưới */}
                <div className="absolute bottom-3 inset-x-3 z-20 rounded-xl bg-black/85 p-2.5 backdrop-blur-md border border-white/15 flex items-center justify-between gap-2">
                  <div className="text-left flex-1 min-w-0">
                    <span className="text-[9px] font-mono uppercase text-amber-400 font-bold block truncate">
                      Nhật Bình Cung Đình Xanh Ngọc
                    </span>
                    <span className="text-[10px] text-stone-300 line-clamp-1">
                      Giá thuê: 550.000đ/ngày · Cọc 1.300.000đ
                    </span>
                  </div>

                  <Link
                    href="/catalog/00000000-0000-0000-0002-000000000006"
                    onClick={(e) => playRoyalChime({ event: e })}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-stone-950 font-black text-[11px] shadow-sm transition-all shrink-0 hover:scale-105"
                  >
                    <span>Xem chi tiết</span>
                    <ArrowRight className="w-3 h-3 stroke-[3]" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Cột 3 (3 cols): Kính Hiển Vi Thớ Sợi & Viễn Trắc Khảo Cổ Chi Tiết */}
            <div className="hidden lg:flex lg:col-span-3 flex-col gap-3 text-left">
              {/* Box 1: Kính Hiển Vi Thớ Chỉ 18K */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono uppercase text-[#00d4ff] font-bold tracking-wider">
                    Soi Vi Mô Thớ Chỉ
                  </span>
                  <ZoomIn className="w-4 h-4 text-amber-400" />
                </div>

                <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-amber-400/30 bg-stone-900 mb-3">
                  <OptimizedImage
                    src={currentWeave.textureImg}
                    alt="Cận cảnh sợi dệt"
                    fill
                    sizes="260px"
                    className="object-cover scale-150"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2.5">
                    <span className="text-[10px] font-mono text-amber-300">
                      Độ phóng đại: 250X · 18K Gold Couched
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-stone-400">Xuất xứ:</span>
                    <span className="font-semibold text-white">{currentWeave.origin}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Mật độ sợi:</span>
                    <span className="font-mono font-bold text-amber-300">{currentWeave.density}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Chỉ dát vàng:</span>
                    <span className="font-semibold text-emerald-300">18K Chuẩn Cổ</span>
                  </div>
                </div>
              </div>

              {/* Box 2: Chỉ dẫn điểm chạm khảo cổ */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
                <span className="text-[10px] font-mono uppercase text-amber-400 font-bold tracking-wider block mb-2">
                  Danh Mục Điểm Chạm (3)
                </span>
                <div className="space-y-2">
                  {ARCHAEOLOGICAL_PINS.map((pin) => (
                    <button
                      key={pin.id}
                      onClick={() => {
                        playRoyalChime();
                        setActiveHotspot(pin.id);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-all text-xs flex items-center justify-between ${
                        activeHotspot === pin.id
                          ? "bg-amber-400/20 border border-amber-400/40 text-amber-200"
                          : "bg-white/[0.02] hover:bg-white/[0.06] text-stone-300"
                      }`}
                    >
                      <span className="font-medium truncate">{pin.title}</span>
                      <span className="text-[10px] font-mono text-stone-400">Xem ↗</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* ================= CHƯƠNG 03: GƯƠNG THẦN AI ================= */}
          <motion.div
            style={shouldReduceMotion ? {} : { opacity: opacity3, y: y3 }}
            className="pointer-events-auto absolute inset-0 grid grid-cols-1 items-center gap-8 lg:grid-cols-12 px-4"
          >
            <div className="lg:col-span-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300 backdrop-blur-md">
                <Cpu className="h-4 w-4 text-emerald-400" />
                <span>Chương 03 — Gương Thần AI Virtual Try-On</span>
              </div>

              <h2 className="mt-4 font-display text-2xl sm:text-4xl font-bold leading-tight text-white">
                Ướm Thử Dáng Vóc
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-amber-200">
                  Chỉ Trong 3 Giây
                </span>
              </h2>

              <p className="mt-3 text-xs sm:text-sm text-stone-300 leading-relaxed">
                Mô phỏng chính xác độ rủ của lụa tơ tằm theo đường cong cơ thể. Kéo con thoi laser vàng qua lại để so sánh trực quan ảnh đời thường và khi khoác lên mình cổ phục hoàng cung.
              </p>

              {/* Nút Chọn Mẫu Trực Tiếp */}
              {presetList && onSelectPreset && (
                <div className="mt-5">
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-400 block mb-2">
                    Chọn nhanh mẫu cổ phục để thử:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(presetList).map(([key, data]) => {
                      const isSelected = activePresetKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            playRoyalChime();
                            onSelectPreset(key);
                          }}
                          onMouseEnter={(e) => playHoverTick({ event: e })}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            isSelected
                              ? "border-amber-400 bg-amber-400 text-stone-900 shadow-md font-bold"
                              : "border-white/20 bg-white/5 text-stone-300 hover:border-amber-400"
                          }`}
                        >
                          {data.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-7 flex justify-center">
              <div className="w-full max-w-lg">
                <CurtainRevealSlider
                  originalImage={originalPortrait}
                  costumeImage={tryonPreset.img}
                  originalLabel="Ảnh đời thường"
                  costumeLabel={tryonPreset.name}
                  matchScore={tryonPreset.match}
                  aspectRatio="aspect-[4/5] sm:aspect-[4/3.8]"
                />
              </div>
            </div>
          </motion.div>

          {/* ================= CHƯƠNG 04: NGHI THỨC BÀN GIAO ================= */}
          <motion.div
            style={shouldReduceMotion ? {} : { opacity: opacity4, y: y4 }}
            className="pointer-events-auto absolute inset-0 flex flex-col justify-center items-center text-center px-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-semibold text-amber-300 backdrop-blur-md">
              <Box className="h-4 w-4 text-amber-400" />
              <span>Chương 04 — Nghi Thức Bàn Giao Hoàng Triều</span>
            </div>

            <h2 className="mt-4 font-display text-2xl sm:text-5xl font-black text-white">
              Đóng Hộp Gỗ Hoàng Đàn
              <br />
              <span className="bg-gradient-to-r from-amber-300 via-rose-300 to-amber-200 bg-clip-text text-transparent">
                Trao Tay Toàn Quốc Trong 24 Giờ
              </span>
            </h2>

            <p className="mt-3 max-w-2xl text-xs sm:text-sm text-stone-300 leading-relaxed">
              Mỗi đơn thuê được kiểm định bằng AI, giặt hấp sinh học khử khuẩn ion bạc, bọc giấy dầu thơm
              và đặt vào hộp gỗ sơn mài chuyên dụng kèm ấn niêm phong.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-3xl w-full">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md text-left">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <b className="mt-2.5 block text-sm text-white">Khử Khuẩn Sinh Học</b>
                <p className="mt-1 text-xs text-stone-400">An toàn tuyệt đối cho làn da nhạy cảm.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md text-left">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300">
                  <Box className="h-4 w-4" />
                </div>
                <b className="mt-2.5 block text-sm text-white">Hộp Gỗ Sơn Mài</b>
                <p className="mt-1 text-xs text-stone-400">Chống ẩm mốc và giữ nếp tà áo nguyên vẹn.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md text-left">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                  <Compass className="h-4 w-4" />
                </div>
                <b className="mt-2.5 block text-sm text-white">Hoàn Cọc Tự Động</b>
                <p className="mt-1 text-xs text-stone-400">Hệ thống ERP giải ngân tiền cọc trong 2 giờ.</p>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/catalog"
                onClick={(e) => playWoodTap({ event: e })}
                onMouseEnter={(e) => playHoverTick({ event: e })}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-rose-600 px-6 py-3.5 text-sm font-bold text-stone-900 shadow-xl transition hover:opacity-90 active:scale-[0.98]"
              >
                <Sparkles className="h-4 w-4 text-stone-900" />
                <span>Khám Phá Toàn Bộ Kho Cổ Phục</span>
              </Link>
            </div>
          </motion.div>
        </div>

        {/* 3. Footer Dẫn Truyền Khi Cuộn */}
        <div className="relative z-30 mx-auto flex w-full max-w-7xl items-center justify-between border-t border-white/10 pt-3 text-[11px] text-stone-400">
          <span>Hệ Thống ERP &amp; Bảo Tàng Số Cổ Phục Việt Nam</span>
          <span className="font-mono text-amber-300/80">3 Triều Đại · 500+ Phẩm Phục · 100% Tơ Tằm</span>
        </div>
      </div>
    </div>
  );
}
