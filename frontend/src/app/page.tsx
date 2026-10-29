"use client";

import Link from "next/link";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { OptimizedImage } from "@/components/common/optimized-image";
import { HeritageBootLoader } from "@/components/common/heritage-boot-loader";
import { SoundToggle } from "@/components/common/sound-toggle";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/common/scroll-reveal";
import { CountUp } from "@/components/common/count-up";
import { SilkParticles } from "@/components/common/silk-particles";
import { Heritage3DWorld } from "@/components/common/heritage-3d-world";
import { ScrollytellingChapters } from "@/components/common/scrollytelling-chapters";
import { CurtainRevealSlider } from "@/components/common/curtain-reveal-slider";
import { ImperialSeal } from "@/components/common/imperial-seal";
import { HeritageTimelineShowcase } from "@/components/common/heritage-timeline-showcase";
import { Heritage3dShowcaseCarousel } from "@/components/common/heritage-3d-showcase-carousel";
import { Hero3DStage } from "@/components/common/hero-3d-stage";
import { playWoodTap, playRoyalChime, playHoverTick, playWhoosh, playImperialStamp } from "@/lib/sound-fx";
import { cartCount } from "@/lib/cart";
import { useEffect, useMemo, useState } from "react";
import {
  Award,
  Sparkles,
  Compass,
  CheckCircle2,
  ShoppingBag,
  User,
  ArrowRight,
  ArrowUpRight,
  Cpu,
  Camera,
  Calendar,
  ShieldCheck,
  Tag,
  Search,
} from "lucide-react";

const publicNavItems = [
  { href: "/#scrolly-story", label: "Sử thi 4 Hồi" },
  { href: "/#bo-suu-tap-3d", label: "Bảo vật 3D" },
  { href: "/#bo-suu-tap", label: "Dòng thời gian" },
  { href: "/#quan-tri-erp", label: "Hệ thống ERP" },
];

interface TryonPreset {
  name: string;
  era: string;
  match: string;
  img: string;
  note: string;
}

const tryonPresets: Record<string, TryonPreset> = {
  nhatbinh: {
    name: "Nhật Bình Cung Đình Xanh Ngọc",
    era: "Triều Nguyễn",
    match: "99,4%",
    img: "https://cophuchoangthanhhue.com/wp-content/uploads/2024/10/Hinh-anh-34-1.jpeg",
    note: "Dải cổ ngũ sắc tương sinh và tỷ lệ thắt lưng hoàng tộc phục chế bảo tàng.",
  },
  aotac: {
    name: "Áo Tấc Nâu Trầm Quý Tộc",
    era: "Triều Nguyễn",
    match: "98,8%",
    img: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ-pX1xQ-4BgBfyqx_o0AijuaAJVPFxMjwkAk3ynAXZsgcayV_U-lJLkN4&s=10",
    note: "Dáng tay thụng trang trọng cho các nghi lễ truyền thống và gia tiên.",
  },
  nguthan: {
    name: "Áo Dài Nam Ngũ Thân Xanh Lá",
    era: "Cổ Phục Nam",
    match: "98,2%",
    img: "https://ecylctxtoznnjjcctlxx.supabase.co/storage/v1/object/public/products/1787712928267-2c3a0404-b128-4c0d-bf98-e9b94162642f.jpg",
    note: "Áo năm thân tay chẽn đi cùng khuy đồng đúc thủ công dành cho nam tử.",
  },
};

const originalPortrait =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80";

export default function HomePage() {
  const publicSectionIds = useMemo(
    () => publicNavItems.map((item) => item.href.split("#")[1]).filter(Boolean),
    [],
  );
  const [activeSection, setActiveSection] = useState(publicSectionIds[0] ?? "");
  const [cartCountVal, setCartCountVal] = useState(0);

  // Trạng thái tương tác thử đồ AI & Tab Hero
  const [heroVisualTab, setHeroVisualTab] = useState<"3d" | "garment">("3d");
  const [activePreset, setActivePreset] = useState<string>("nhatbinh");
  const [isOriginalView, setIsOriginalView] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(true);

  // Cart badge
  useEffect(() => {
    const updateCount = () => setCartCountVal(cartCount());
    updateCount();
    window.addEventListener("cart:updated", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      window.removeEventListener("cart:updated", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, []);

  // Section scroll tracking
  useEffect(() => {
    function syncActiveSectionFromViewport() {
      const sections = publicSectionIds
        .map((id) => document.getElementById(id))
        .filter((section): section is HTMLElement => section instanceof HTMLElement);
      const visibleSection = sections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= 200 && rect.bottom >= 200;
      });
      if (visibleSection) {
        setActiveSection(visibleSection.id);
        return;
      }
      if (window.scrollY < 120 && publicSectionIds[0]) {
        setActiveSection(publicSectionIds[0]);
      }
    }

    function syncActiveSectionFromHash() {
      const currentHash = window.location.hash.replace("#", "");
      if (currentHash && publicSectionIds.includes(currentHash)) {
        setActiveSection(currentHash);
        return;
      }
      syncActiveSectionFromViewport();
    }

    syncActiveSectionFromHash();
    window.addEventListener("scroll", syncActiveSectionFromViewport, { passive: true });
    window.addEventListener("hashchange", syncActiveSectionFromHash);
    return () => {
      window.removeEventListener("scroll", syncActiveSectionFromViewport);
      window.removeEventListener("hashchange", syncActiveSectionFromHash);
    };
  }, [publicSectionIds]);

  const currentPresetData = tryonPresets[activePreset] ?? tryonPresets.nhatbinh;

  const handleSelectPreset = (key: string) => {
    playRoyalChime();
    setActivePreset(key);
    setIsOriginalView(false);
    setIsScanning(false);
    setTimeout(() => setIsScanning(true), 50);
  };

  return (
    <div className="min-h-screen bg-[#09090c] text-stone-100 antialiased selection:bg-amber-500/30 selection:text-amber-200">
      {/* 0. Màn Chờ Khởi Động Hoàng Cung & Bộ Đếm % Thời Gian Thực */}
      <HeritageBootLoader />

      {/* 1. Header Kính Mờ Đẳng Cấp Hoàng Cung (Đồng bộ với toàn bộ hệ thống) */}
      <CustomerNavbar active="home" variant="dark" showSoundToggle={true} />

      {/* 2. Hero Cinematic Toàn Màn Hình Với Three.js 3D World (Scroll-Craft Layered Depth) */}
      <section className="relative min-h-[94vh] flex items-center overflow-hidden border-b border-white/10 py-16 lg:py-24">
        {/* Plane 0 & 1: Canvas 3D Bảo Vật Kim Bảo Hoàng Gia, Dải Lụa Sóng Đôi & Bụi Vàng (Three.js 120fps) */}
        <Heritage3DWorld showCenterpiece={true} intensity={1.15} />

        {/* Quầng sáng di sản ấm áp (Ambient Radial Flares) */}
        <div className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full bg-rose-600/15 blur-[130px]" />
        <div className="pointer-events-none absolute -bottom-28 -right-28 h-[420px] w-[420px] rounded-full bg-amber-500/15 blur-[140px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 h-80 w-80 rounded-full bg-cyan-500/10 blur-[150px]" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            {/* Plane 3: Khối Nội Dung & Typography Hoàng Cung */}
            <div className="lg:col-span-7">
              <ScrollReveal variant="fade-down" delay={0.05}>
                <div className="inline-flex items-center gap-2.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-4 py-1.5 text-xs font-semibold text-amber-300 shadow-xl backdrop-blur-md">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping-subtle absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                  <Award className="h-4 w-4 text-amber-400" />
                  <span>Bảo Tồn &amp; Phục Dựng Di Sản Triều Nguyễn</span>
                </div>
              </ScrollReveal>

              <ScrollReveal variant="fade-up" delay={0.15}>
                <h1 className="text-balance mt-6 font-display text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl">
                  Vẻ Đẹp Hoàng Cung,
                  <br />
                  <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-rose-400 bg-clip-text text-transparent drop-shadow-[0_4px_28px_rgba(251,191,36,0.4)]">
                    Hiện Hữu Trong Đời Sống
                  </span>
                </h1>
              </ScrollReveal>

              <ScrollReveal variant="fade-up" delay={0.25}>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg">
                  Kho y phục truyền thống chuẩn tiêu chuẩn lưu trữ bảo tàng. Tận hưởng không gian 3D tương tác sống động cùng công nghệ Thử Đồ AI độc quyền trước khi quyết định đặt lịch.
                </p>
              </ScrollReveal>

              {/* Tag di sản triều đại nhanh */}
              <ScrollReveal variant="fade-up" delay={0.3}>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-stone-400">Triều đại lưu trữ:</span>
                  {["Triều Nguyễn", "Triều Lê Sơ", "Áo Dài Đương Đại"].map((era) => (
                    <span
                      key={era}
                      className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-amber-200/90 backdrop-blur-xs"
                    >
                      {era}
                    </span>
                  ))}
                </div>
              </ScrollReveal>

              <ScrollReveal variant="fade-up" delay={0.35}>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link
                    href="/catalog"
                    onClick={(e) => playWoodTap({ event: e })}
                    onMouseEnter={(e) => playHoverTick({ event: e })}
                    className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-rose-500 px-7 py-4 text-sm font-bold tracking-wider text-stone-950 shadow-[0_0_24px_rgba(245,158,11,0.35)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_32px_rgba(245,158,11,0.5)] active:scale-[0.98]"
                  >
                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
                    <Compass className="h-4 w-4 transition-transform group-hover:rotate-45" />
                    <span>Khám Phá Lưu Trữ</span>
                  </Link>

                  <a
                    href="#scrolly-story"
                    onClick={(e) => playRoyalChime({ event: e })}
                    onMouseEnter={(e) => playHoverTick({ event: e })}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-4 text-sm font-semibold text-white backdrop-blur-md shadow-xs transition hover:border-amber-400 hover:bg-white/10 hover:text-amber-300 active:scale-[0.98]"
                  >
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    <span>Xem Sử Thi Cuộn Trang</span>
                  </a>
                </div>
              </ScrollReveal>
            </div>

            {/* Plane 2 & 3: Hero 3D Stage & Spotlight Card với Bộ Chuyển Chế Độ Tương Tác */}
            <div className="relative lg:col-span-5 flex flex-col items-center">
              {/* Tab Switcher: Chuyển đổi giữa Bảo Vật 3D & Y Phục Thực Tế */}
              <div className="mb-4 inline-flex items-center gap-1 rounded-2xl border border-white/15 bg-black/60 p-1.5 shadow-xl backdrop-blur-xl">
                <button
                  onClick={() => {
                    playWoodTap();
                    setHeroVisualTab("3d");
                  }}
                  onMouseEnter={() => playHoverTick()}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                    heroVisualTab === "3d"
                      ? "bg-gradient-to-r from-amber-500 to-rose-600 text-stone-950 shadow-md scale-100"
                      : "text-stone-300 hover:text-amber-200"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Bảo Vật 3D 360°</span>
                </button>
                <button
                  onClick={() => {
                    playWoodTap();
                    setHeroVisualTab("garment");
                  }}
                  onMouseEnter={() => playHoverTick()}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                    heroVisualTab === "garment"
                      ? "bg-gradient-to-r from-amber-500 to-rose-600 text-stone-950 shadow-md scale-100"
                      : "text-stone-300 hover:text-amber-200"
                  }`}
                >
                  <Tag className="h-3.5 w-3.5" />
                  <span>Y Phục Sẵn Sàng</span>
                </button>
              </div>

              {/* View 1: 3D Stage Interactive Centerpiece */}
              {heroVisualTab === "3d" && (
                <ScrollReveal variant="zoom-in" delay={0.1}>
                  <Hero3DStage className="w-full" />
                </ScrollReveal>
              )}

              {/* View 2: Spotlight Card Y Phục Kính Mờ Sơn Mài */}
              {heroVisualTab === "garment" && (
                <ScrollReveal variant="zoom-in" delay={0.1}>
                  <Link
                    href="/catalog/00000000-0000-0000-0002-000000000006"
                    onMouseEnter={(e) => playHoverTick({ event: e })}
                    className="heritage-card-interactive group block relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04] p-4 shadow-2xl backdrop-blur-xl hover:border-amber-400/60 transition-all duration-300"
                  >
                    <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-stone-900">
                      <OptimizedImage
                        src="https://cophuchoangthanhhue.com/wp-content/uploads/2024/10/Hinh-anh-34-1.jpeg"
                        alt="Nhật Bình Cung Đình Xanh Ngọc"
                        fill
                        priority
                        sizes="(max-width: 1024px) 100vw, 40vw"
                        className="h-full w-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                      />
                      <span className="absolute left-3 top-3 z-10 rounded-md bg-black/80 px-2.5 py-1 text-xs font-semibold text-amber-200 backdrop-blur-md border border-white/15">
                        Sản phẩm sẵn sàng thuê
                      </span>
                      <div className="absolute right-2.5 top-2.5 z-20 drop-shadow-md">
                        <ImperialSeal size="sm" title="HOÀNG TRIỀU" subtitle="NGUYỄN ĐỊNH" year="GIÁP THÌN" />
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-widest text-amber-400">
                            Triều Nguyễn · Cổ Phục
                          </span>
                          <h3 className="mt-0.5 font-display text-2xl font-bold text-white group-hover:text-amber-200 transition-colors">
                            Nhật Bình Cung Đình Xanh Ngọc
                          </h3>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-stone-400">Giá thuê</span>
                          <div className="text-base font-bold text-amber-300">
                            550.000đ<span className="text-xs font-normal text-stone-400">/ngày</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-stone-300">
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Kho sẵn hàng · Size S, M, L</span>
                        </span>
                        <span className="font-medium text-stone-400">Cọc: 1.300.000đ</span>
                      </div>
                    </div>
                  </Link>
                </ScrollReveal>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Băng Chỉ Số Uy Tín & Bảo Tồn — Kính Mờ Hổ Phách CountUp */}
      <section className="border-b border-white/10 bg-[#0c0c12]/80 py-10 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal variant="fade-up">
            <div className="grid grid-cols-2 divide-y divide-white/10 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              <div className="flex flex-col items-center p-3 text-center">
                <span className="font-display text-3xl font-bold text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.3)]">
                  <CountUp end={100} suffix="%" duration={1.6} />
                </span>
                <span className="text-pretty mt-1 text-xs font-semibold text-stone-300">
                  Tơ Tằm &amp; Thêu Tay Thủ Công
                </span>
              </div>
              <div className="flex flex-col items-center p-3 text-center">
                <span className="font-display text-3xl font-bold text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.3)]">
                  <CountUp end={500} suffix="+" duration={1.8} />
                </span>
                <span className="text-pretty mt-1 text-xs font-semibold text-stone-300">
                  Bộ Y Phục Di Sản Lưu Trữ
                </span>
              </div>
              <div className="flex flex-col items-center p-3 text-center">
                <span className="font-display text-3xl font-bold text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.3)]">
                  <CountUp end={3} duration={1.2} /> Triều Đại
                </span>
                <span className="text-pretty mt-1 text-xs font-semibold text-stone-300">
                  Nguyễn · Lê Sơ · Áo Dài Đương Đại
                </span>
              </div>
              <div className="flex flex-col items-center p-3 text-center">
                <span className="font-display text-3xl font-bold text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.3)]">
                  <CountUp end={24} duration={1.4} /> Giờ
                </span>
                <span className="text-pretty mt-1 text-xs font-semibold text-stone-300">
                  Bảo Quản &amp; Giao Nhận Toàn Quốc
                </span>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 4. Hành Trình Kể Chuyện Cuộn Trang 4 Chương Sử Thi (Sticky Scrollytelling kiểu XimiTech) */}
      <div id="scrolly-story">
        <ScrollytellingChapters
          originalPortrait={originalPortrait}
          tryonPreset={currentPresetData}
          onSelectPreset={handleSelectPreset}
          activePresetKey={activePreset}
          presetList={tryonPresets}
        />
      </div>

      {/* 5. Bộ Sưu Tập 3D Perspective Curved Carousel (Chuẩn 100% Giao Diện & Tương Tác XimiTech) */}
      <div id="bo-suu-tap-3d">
        <Heritage3dShowcaseCarousel />
      </div>

      {/* 6. Khám Phá Kho Tàng Cổ Phục Theo Triều Đại (Heritage Timeline Showcase) */}
      <section id="bo-suu-tap" className="border-b border-white/10 bg-[#0c0c12] py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal variant="fade-up">
            <div className="mb-10 flex flex-col items-start justify-between gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-amber-400">
                  Hành Trình Vàng Son Qua Các Triều Đại
                </span>
                <h2 className="text-balance mt-1 font-display text-3xl font-bold text-white sm:text-4xl">
                  Kho Tàng Cổ Phục Lưu Trữ
                </h2>
                <p className="mt-2 text-xs sm:text-sm text-stone-300 max-w-xl">
                  Chọn từng triều đại để lướt qua các tác phẩm phục dựng chuẩn điển chế lịch sử, từ Lễ phục Hậu phi triều Nguyễn đến trang phục Đại Việt thời Lê Sơ.
                </p>
              </div>
              <Link
                href="/catalog"
                onClick={(e) => playWoodTap({ event: e })}
                onMouseEnter={(e) => playHoverTick({ event: e })}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-300 shadow-2xs transition hover:border-amber-400 hover:bg-amber-400 hover:text-stone-900"
              >
                <span>Khám phá 48 mẫu</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </ScrollReveal>

          {/* Dòng Thời Gian Triều Đại Xuyên Không */}
          <HeritageTimelineShowcase />
        </div>
      </section>

      {/* 6. Quản Trị ERP Cho Đối Tác & Studio (Trung Tâm Vận Hành Kính Mờ) */}
      <section id="quan-tri-erp" className="border-b border-white/10 bg-[#09090c] py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <ScrollReveal variant="fade-right">
                <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                  Vận Hành Chính Xác
                </span>
                <h2 className="text-balance mt-1 font-display text-3xl font-bold text-white sm:text-4xl">
                  Hệ Thống ERP Xưởng May
                </h2>
                <p className="mt-4 text-base text-stone-300 leading-relaxed">
                  Theo dõi vòng đời từng chiếc áo: từ khâu giặt ủi sinh học, kiểm định hư hại AI đến điều phối
                  logistics bàn giao toàn quốc.
                </p>
                <div className="mt-6 flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-stone-200 backdrop-blur-md">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>Kiểm định tình trạng bằng AI</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-stone-200 backdrop-blur-md">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>Lịch giặt ủi &amp; hoàn cọc tự động</span>
                  </div>
                </div>
                <div className="mt-8">
                  <Link
                    href="/dashboard"
                    onClick={(e) => playWoodTap({ event: e })}
                    onMouseEnter={(e) => playHoverTick({ event: e })}
                    className="shadow-md inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-2.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500 hover:text-stone-900 active:scale-[0.98]"
                  >
                    <span>Đến Trang Quản Trị ERP</span>
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </ScrollReveal>
            </div>

            <div className="lg:col-span-6">
              <ScrollReveal variant="fade-left" delay={0.2}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl shadow-2xl">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <span className="text-xs font-bold text-white">
                      Trạng Thái Tồn Kho Thực Tế (Live Telemetry)
                    </span>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                      Hệ Thống Hoạt Động
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3.5 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded bg-white/10">
                          <Tag className="h-4 w-4 text-amber-300" />
                        </span>
                        <div>
                          <b className="text-white">CP-042: Nhật Bình Hoàng Phái</b>
                          <span className="mt-0.5 block text-xs text-stone-400">
                            Đã thuê · Trả ngày 16/10
                          </span>
                        </div>
                      </div>
                      <span className="rounded bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-300 border border-amber-500/30">
                        Đang thuê
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3.5 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded bg-white/10">
                          <Tag className="h-4 w-4 text-emerald-400" />
                        </span>
                        <div>
                          <b className="text-white">AT-105: Áo Tấc Lam Thượng</b>
                          <span className="mt-0.5 block text-xs text-stone-400">
                            Khử khuẩn tiêu chuẩn ion bạc
                          </span>
                        </div>
                      </div>
                      <span className="rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                        Sẵn sàng
                      </span>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Footer Chuẩn Khách Hàng */}
      <CustomerFooter />

      {/* 8. Nút Âm Thanh Di Sản Nổi (Floating Heritage Sound Controller) */}
      <SoundToggle variant="floating" />
    </div>
  );
}
