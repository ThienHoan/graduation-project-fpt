"use client";

import Link from "next/link";
import { CustomerFooter } from "@/components/customer/footer";
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
  { href: "/#bo-suu-tap", label: "Bộ sưu tập" },
  { href: "/#thu-do-ai", label: "Thử đồ AI" },
  { href: "/#quy-trinh", label: "Hành trình thuê" },
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
    name: "Nhật Bình Hoàng Phái",
    era: "Triều Nguyễn",
    match: "98,4%",
    img: "https://lh3.googleusercontent.com/aida-public/AB6AXuDvowMvVYvat40td0eYsm2xOyewRYASe82qkNdpYOhmlGpLtvo-CY1thuEj3H0Ex3taiVfLTKX2ESAQ9rvq13OU7L69H-IJ4iocVq83idHbhAPZHBmozXmdoLqEf5PfXNcZXs7Uz2YmawbQoZwfIPGjesRNPzDQS18JSZs6OvqnDYS1j1ExtTh4ACDttytuJ5mfuT_RDObouB5E1zhQh92zf6X9GOwGBGbQXQXDpLMIfe9reSHCU63uycTGSdtwAwLtouKipe_UVc2k",
    note: "Tự động căn chỉnh dải cổ viền ngũ sắc và tỷ lệ vai theo phom dáng chuẩn bảo tàng.",
  },
  aotac: {
    name: "Áo Tấc Lam Thượng",
    era: "Triều Nguyễn",
    match: "99,1%",
    img: "https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O",
    note: "Nhận diện độ thụng tay áo cánh thụng và phom đứng trang nghiêm cho nghi lễ gia tiên.",
  },
  nguthan: {
    name: "Ngũ Thân Cát Tường",
    era: "Trang Phục Nam",
    match: "97,8%",
    img: "https://lh3.googleusercontent.com/aida-public/AB6AXuDpdew3ggLs6xlVpmJgHap9WUw51NiN8-SxZWc86HUd9JvUYXaAk5-M3DypF1FMxsO3kNu01OGy-kQjU1PAp0AXHNP7Jf7L9-ulP3kBMVjnSPdqbrW4WB_Klqenl5xpyMrEanc_WAZ9CVkvIEIlBxsT5uOv76VGhgt_WPLW3zGg_0HBn3ppgZUi3J1zHml8--uq-_9PpHGmkfACxuONpGtfDGiC9h0jrET4HMI_c6BDLqq37iaAcUrMvRKL2JuFJkLPnlJaEKugt7ic",
    note: "Căn chuẩn 5 vạt ngũ thân và cổ đứng 3 phân truyền thống dành cho nam.",
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

  // Trạng thái tương tác thử đồ AI
  const [activePreset, setActivePreset] = useState<string>("nhatbinh");
  const [isOriginalView, setIsOriginalView] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(true);

  // Cart badge
  useEffect(() => {
    setCartCountVal(cartCount());
    const interval = setInterval(() => setCartCountVal(cartCount()), 500);
    return () => clearInterval(interval);
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
    setActivePreset(key);
    setIsOriginalView(false);
    setIsScanning(false);
    setTimeout(() => setIsScanning(true), 50);
  };

  return (
    <div className="min-h-screen bg-mist text-ink antialiased">
      {/* 1. Header Di Sản */}
      <header className="sticky top-0 z-40 border-b border-sand bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="font-display text-2xl font-bold tracking-wide text-lotus sm:text-3xl"
            >
              Cổ Phục Rental
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
              {publicNavItems.map((item) => {
                const sectionId = item.href.split("#")[1] ?? "";
                const isActive = activeSection === sectionId;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      isActive
                        ? "border-b-2 border-lotus py-2 font-semibold text-lotus"
                        : "border-b-2 border-transparent py-2 text-stone-600 transition hover:text-lotus"
                    }
                    onClick={() => setActiveSection(sectionId)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/catalog"
              className="hidden items-center gap-2 rounded-lg bg-lotus px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98] sm:inline-flex"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Thuê Ngay</span>
            </Link>

            <Link
              href="/booking/date-selection"
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-sand text-ink transition hover:border-lotus"
              aria-label="Giỏ thuê đồ"
            >
              <ShoppingBag className="h-4 w-4" />
              {cartCountVal > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-lotus text-[11px] font-bold text-white">
                  {cartCountVal}
                </span>
              )}
            </Link>

            <Link
              href="/login"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-sand text-ink transition hover:border-lotus"
              aria-label="Tài khoản"
            >
              <User className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* 2. Hero 2 Cột (Di Sản & Tiêu Điểm Tác Phẩm) */}
      <section className="relative overflow-hidden border-b border-sand bg-gradient-to-b from-mist to-parchment py-16 lg:py-24">
        {/* Quầng sáng di sản ấm áp (Ambient Glow) */}
        <div className="animate-ambient-glow pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-red-200/35 blur-3xl" />
        <div
          className="animate-ambient-glow pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-amber-200/30 blur-3xl"
          style={{ animationDelay: "-4.5s" }}
        />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-sand bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-bronze shadow-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping-subtle absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
                </span>
                <Award className="h-4 w-4 text-lotus" />
                <span>Bảo tồn &amp; Phục dựng Di sản Triều Nguyễn</span>
              </div>

              <h1 className="text-balance mt-6 font-display text-4xl font-bold leading-tight tracking-tight text-oxblood sm:text-6xl">
                Vẻ Đẹp Hoàng Cung,
                <br />
                Hiện Hữu Trong Đời Sống
              </h1>

              <p className="mt-6 max-w-xl text-base leading-relaxed text-stone-600 sm:text-lg">
                Kho y phục truyền thống chuẩn tiêu chuẩn lưu trữ bảo tàng. Trải nghiệm trực quan với
                công nghệ Thử Đồ AI độc quyền trước khi quyết định đặt lịch.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/catalog"
                  className="inline-flex items-center gap-2 rounded-lg bg-lotus px-6 py-3.5 text-sm font-semibold tracking-wider text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98]"
                >
                  <Compass className="h-4 w-4" />
                  <span>Khám Phá Lưu Trữ</span>
                </Link>

                <a
                  href="#thu-do-ai"
                  className="inline-flex items-center gap-2 rounded-lg border border-sand bg-white px-6 py-3.5 text-sm font-semibold text-ink shadow-xs transition hover:border-lotus hover:text-lotus active:scale-[0.98]"
                >
                  <Sparkles className="h-4 w-4 text-lotus" />
                  <span>Trải Nghiệm Thử Đồ AI</span>
                </a>
              </div>
            </div>

            {/* Spotlight Card Y phục */}
            <div className="lg:col-span-5">
              <div className="relative overflow-hidden rounded-2xl border border-sand bg-white p-4 shadow-md transition-all duration-300 hover:border-lotus hover:shadow-xl">
                <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-stone-100">
                  <img
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuDvowMvVYvat40td0eYsm2xOyewRYASe82qkNdpYOhmlGpLtvo-CY1thuEj3H0Ex3taiVfLTKX2ESAQ9rvq13OU7L69H-IJ4iocVq83idHbhAPZHBmozXmdoLqEf5PfXNcZXs7Uz2YmawbQoZwfIPGjesRNPzDQS18JSZs6OvqnDYS1j1ExtTh4ACDttytuJ5mfuT_RDObouB5E1zhQh92zf6X9GOwGBGbQXQXDpLMIfe9reSHCU63uycTGSdtwAwLtouKipe_UVc2k"
                    alt="Nhật Bình Hoàng Phái"
                    className="h-full w-full object-cover object-top"
                  />
                  <span className="absolute left-3 top-3 rounded-md bg-black/75 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
                    Tiêu điểm phục dựng
                  </span>
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-widest text-bronze">
                        Triều Nguyễn
                      </span>
                      <h3 className="mt-0.5 font-display text-2xl font-bold text-oxblood">
                        Nhật Bình Hoàng Phái
                      </h3>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-stone-600">Giá thuê</span>
                      <div className="text-base font-bold text-lotus">
                        1.200.000đ<span className="text-xs font-normal text-stone-600">/ngày</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-sand pt-3 text-xs text-stone-600">
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Sẵn sàng cho thuê</span>
                    </span>
                    <span className="font-medium text-stone-700">Cọc: 3.500.000đ</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Băng Chỉ Số Uy Tín & Bảo Tồn */}
      <section className="border-b border-sand bg-white py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 divide-y divide-sand sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <div className="flex flex-col items-center p-3 text-center">
              <span className="font-display text-3xl font-bold text-lotus">100%</span>
              <span className="text-pretty mt-1 text-xs font-semibold text-stone-700">
                Tơ Tằm &amp; Thêu Tay Thủ Công
              </span>
            </div>
            <div className="flex flex-col items-center p-3 text-center">
              <span className="font-display text-3xl font-bold text-lotus">500+</span>
              <span className="text-pretty mt-1 text-xs font-semibold text-stone-700">
                Bộ Y Phục Di Sản Lưu Trữ
              </span>
            </div>
            <div className="flex flex-col items-center p-3 text-center">
              <span className="font-display text-3xl font-bold text-lotus">3 Triều Đại</span>
              <span className="text-pretty mt-1 text-xs font-semibold text-stone-700">
                Nguyễn · Lê Sơ · Áo Dài Đương Đại
              </span>
            </div>
            <div className="flex flex-col items-center p-3 text-center">
              <span className="font-display text-3xl font-bold text-lotus">24 Giờ</span>
              <span className="text-pretty mt-1 text-xs font-semibold text-stone-700">
                Bảo Quản &amp; Giao Nhận Toàn Quốc
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Bộ Sưu Tập Tuyển Chọn Theo Triều Đại */}
      <section id="bo-suu-tap" className="border-b border-sand bg-mist py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-4 border-b border-sand pb-6 md:flex-row md:items-end">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-bronze">
                Kho Lưu Trữ Di Sản
              </span>
              <h2 className="text-balance mt-1 font-display text-3xl font-bold text-oxblood sm:text-4xl">
                Bộ Sưu Tập Tiêu Biểu
              </h2>
            </div>
            <Link
              href="/catalog"
              className="inline-flex min-h-[32px] items-center gap-1.5 py-2 text-xs font-bold uppercase tracking-wider text-lotus hover:underline"
            >
              <span>Xem Tất Cả 48 Mẫu</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
            {/* Card 1 */}
            <div className="overflow-hidden rounded-xl border border-sand bg-white transition-all duration-300 hover:border-lotus hover:shadow-lg">
              <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O"
                  alt="Áo Tấc Lam Thượng"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <span className="shadow-xs absolute left-3 top-3 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800">
                  Triều Nguyễn
                </span>
              </div>
              <div className="p-5">
                <h3 className="font-display text-2xl font-bold text-oxblood">Áo Tấc Lam Thượng</h3>
                <p className="line-clamp-2 mt-2 text-xs leading-relaxed text-stone-600">
                  Sắc xanh trầm tôn nghiêm, phù hợp cho lễ gia tiên và chụp ảnh kỷ niệm nghệ thuật.
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-sand pt-3 text-xs">
                  <div>
                    <span className="font-medium text-stone-600">Giá thuê: </span>
                    <b className="text-sm font-bold text-lotus">800.000đ</b>/ngày
                  </div>
                  <span className="font-medium text-stone-600">Cọc 2.200.000đ</span>
                </div>
              </div>
            </div>

            {/* Card 2 */}
            <div className="overflow-hidden rounded-xl border border-sand bg-white transition-all duration-300 hover:border-lotus hover:shadow-lg">
              <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDS1o5lSmGpkTUXc5LH4apMFHlcKEbyL3m8Z8RgdQROFBvi-EDOwrPRIdNCQ9PXjHlWVZcnVBJitf0PhQPkfPCnb91euyVXyXmEjGH22LyYBCWx9tIZUtohpM8mddPADbGjhomL0P10yhDjoWJvUVy3zdHCEPBS6Jxc2dQXB9H04gP_Pc-tbIec8mGliSs3Ny9q-elFSPeu7fojwL3nKXsVaM970qq_IoiXasEdVlGaBNW-BdsVVcsi52wgkajLfqkJMTYSAX-fJaR9"
                  alt="Áo Dài Phụng Vũ"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <span className="shadow-xs absolute left-3 top-3 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800">
                  Lễ Phục Cưới
                </span>
              </div>
              <div className="p-5">
                <h3 className="font-display text-2xl font-bold text-oxblood">Áo Dài Phụng Vũ</h3>
                <p className="line-clamp-2 mt-2 text-xs leading-relaxed text-stone-600">
                  Lụa tơ tằm thêu phụng vàng kim, cấu trúc đứng dáng trang nhã cho cô dâu ngày trọng
                  đại.
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-sand pt-3 text-xs">
                  <div>
                    <span className="font-medium text-stone-600">Giá thuê: </span>
                    <b className="text-sm font-bold text-lotus">1.500.000đ</b>/ngày
                  </div>
                  <span className="font-medium text-stone-600">Cọc 4.000.000đ</span>
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="overflow-hidden rounded-xl border border-sand bg-white transition-all duration-300 hover:border-lotus hover:shadow-lg">
              <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDpdew3ggLs6xlVpmJgHap9WUw51NiN8-SxZWc86HUd9JvUYXaAk5-M3DypF1FMxsO3kNu01OGy-kQjU1PAp0AXHNP7Jf7L9-ulP3kBMVjnSPdqbrW4WB_Klqenl5xpyMrEanc_WAZ9CVkvIEIlBxsT5uOv76VGhgt_WPLW3zGg_0HBn3ppgZUi3J1zHml8--uq-_9PpHGmkfACxuONpGtfDGiC9h0jrET4HMI_c6BDLqq37iaAcUrMvRKL2JuFJkLPnlJaEKugt7ic"
                  alt="Ngũ Thân Cát Tường"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <span className="shadow-xs absolute left-3 top-3 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800">
                  Trang Phục Nam
                </span>
              </div>
              <div className="p-5">
                <h3 className="font-display text-2xl font-bold text-oxblood">Ngũ Thân Cát Tường</h3>
                <p className="line-clamp-2 mt-2 text-xs leading-relaxed text-stone-600">
                  Áo ngũ thân tay chẽn bằng gấm hoa văn chữ Thọ, chuẩn mực nho nhã của quý ông
                  truyền thống.
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-sand pt-3 text-xs">
                  <div>
                    <span className="font-medium text-stone-600">Giá thuê: </span>
                    <b className="text-sm font-bold text-lotus">950.000đ</b>/ngày
                  </div>
                  <span className="font-medium text-stone-600">Cọc 2.800.000đ</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Spotlight Trải Nghiệm Thử Đồ AI Trực Quan */}
      <section id="thu-do-ai" className="border-b border-sand bg-white py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3.5 py-1 text-xs font-semibold text-emerald-800">
                <Cpu className="h-4 w-4" />
                <span>Công Nghệ AI Virtual Try-On</span>
              </div>

              <h2 className="text-balance mt-4 font-display text-3xl font-bold text-oxblood sm:text-4xl">
                Thử Đồ Trước, Thuê An Tâm
              </h2>

              <p className="mt-4 text-base leading-relaxed text-stone-600">
                Không còn nỗi lo trang phục không vừa vặn hay lệch tông màu da. Công nghệ AI xưởng
                may ghép ảnh chân dung của bạn với y phục cổ trang chỉ trong 3 giây.
              </p>

              {/* Nút Chọn Mẫu Trực Tiếp Thử Nghiệm */}
              <div className="mt-6">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                  Chọn nhanh cổ phục để thử dáng AI:
                </span>
                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {Object.entries(tryonPresets).map(([key, data]) => {
                    const isSelected = activePreset === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleSelectPreset(key)}
                        className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                          isSelected
                            ? "border-lotus bg-lotus text-white shadow-xs"
                            : "border-stone-300 bg-white text-stone-700 hover:border-lotus hover:text-lotus"
                        }`}
                      >
                        {isSelected && <Sparkles className="h-3.5 w-3.5" />}
                        <span>{data.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-8 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-parchment text-xs font-bold text-lotus">
                    1
                  </div>
                  <div>
                    <b className="text-sm text-stone-900">Tải ảnh toàn thân hoặc chụp trực tiếp</b>
                    <p className="mt-0.5 text-xs text-stone-600">
                      Hệ thống tự động nhận diện dáng người và tư thế chuẩn xác.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-parchment text-xs font-bold text-lotus">
                    2
                  </div>
                  <div>
                    <b className="text-sm text-stone-900">Chọn mẫu y phục từ bộ sưu tập</b>
                    <p className="mt-0.5 text-xs text-stone-600">
                      Khám phá hơn 500 mẫu Nhật Bình, Áo Tấc, Ngũ Thân.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-parchment text-xs font-bold text-lotus">
                    3
                  </div>
                  <div>
                    <b className="text-sm text-stone-900">
                      Xem trước kết quả chân thực &amp; Lưu số đo
                    </b>
                    <p className="mt-0.5 text-xs text-stone-600">
                      Ướm dáng hoàn hảo trước khi thanh toán cọc.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <Link
                  href="/try-on"
                  className="inline-flex items-center gap-2 rounded-lg bg-lotus px-6 py-3.5 text-sm font-semibold text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98]"
                >
                  <Camera className="h-4 w-4" />
                  <span>Trải Nghiệm Thử Đồ Ngay</span>
                </Link>
              </div>
            </div>

            {/* Khung Demo Tương Tác AI Live Simulation */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-sand bg-mist p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-sand pb-4 text-xs font-semibold text-stone-700">
                  <span className="inline-flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping-subtle absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-800" />
                    </span>
                    <span>Mô Phỏng AI Trực Tuyến</span>
                  </span>

                  {/* Toggle Trước / Sau */}
                  <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setIsOriginalView(true)}
                      className={`min-h-[32px] rounded px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                        isOriginalView
                          ? "bg-stone-800 text-white"
                          : "text-stone-700 hover:text-stone-900"
                      }`}
                    >
                      Ảnh Gốc
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsOriginalView(false)}
                      className={`min-h-[32px] rounded px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                        !isOriginalView
                          ? "bg-emerald-800 text-white shadow-xs"
                          : "text-stone-700 hover:text-stone-900"
                      }`}
                    >
                      Kết Quả AI
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4">
                  {/* Ảnh chân dung nguồn */}
                  <div className="relative flex aspect-[3/4] flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-sand bg-white p-3 text-center">
                    <img
                      src={originalPortrait}
                      alt="Chân dung gốc"
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full rounded object-cover opacity-80"
                    />
                    <span className="shadow-xs absolute bottom-2 left-2 right-2 rounded bg-white/95 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
                      Ảnh gốc tải lên
                    </span>
                  </div>

                  {/* Ảnh kết quả AI Try-On với Scanning Beam */}
                  <div className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-sand bg-white p-2">
                    <img
                      src={isOriginalView ? originalPortrait : currentPresetData.img}
                      alt="AI Tryon Result"
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full rounded object-cover transition-opacity duration-300"
                    />
                    {!isOriginalView && isScanning && <div className="animate-ai-scan" />}
                    <span className="absolute bottom-2 left-2 right-2 rounded bg-black/80 px-2 py-1 text-center text-xs font-bold text-white backdrop-blur">
                      {isOriginalView ? "Ảnh gốc (chưa ướm)" : `Độ khớp: ${currentPresetData.match}`}
                    </span>
                  </div>
                </div>

                {/* Ghi chú thuật toán */}
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <Sparkles className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span className="text-pretty">{currentPresetData.note}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Quy Trình Thuê & Chăm Sóc Tiêu Chuẩn Bảo Tàng */}
      <section id="quy-trinh" className="border-b border-sand bg-parchment py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-bronze">
              Quy Trình Xưởng May
            </span>
            <h2 className="text-balance mt-1 font-display text-3xl font-bold text-oxblood sm:text-4xl">
              Chuẩn Mực Trong Từng Bước
            </h2>
            <p className="mt-3 text-sm text-stone-600">
              Mỗi bộ cổ phục được chuẩn bị tỉ mỉ, giặt ủi sinh học và khử khuẩn trước khi giao đến
              tay bạn.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="rounded-xl border border-sand bg-white p-6 text-center shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-parchment text-lotus">
                <Search className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-xl font-bold text-stone-900">
                1. Chọn Đồ &amp; Ướm Dáng AI
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-600">
                Tra cứu theo triều đại, sự kiện và xem trước bằng tính năng Thử Đồ AI để chọn kích
                cỡ vừa vặn.
              </p>
            </div>

            <div className="rounded-xl border border-sand bg-white p-6 text-center shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-parchment text-lotus">
                <Calendar className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-xl font-bold text-stone-900">
                2. Đặt Lịch &amp; Đặt Cọc An Toàn
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-600">
                Chọn khoảng ngày nhận - trả đồ với chính sách cọc minh bạch, tự động hoàn trả sau
                khi bàn giao.
              </p>
            </div>

            <div className="rounded-xl border border-sand bg-white p-6 text-center shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-parchment text-lotus">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-xl font-bold text-stone-900">
                3. Bàn Giao &amp; Chăm Sóc Y Phục
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-600">
                Trang phục được là ủi phẳng phiu, đóng hộp bảo quản chuyên dụng và hỗ trợ đổi size
                nếu cần.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Quản Trị ERP Cho Đối Tác & Studio */}
      <section id="quan-tri-erp" className="border-b border-sand bg-white py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-800">
                Vận Hành Chính Xác
              </span>
              <h2 className="text-balance mt-1 font-display text-3xl font-bold text-oxblood sm:text-4xl">
                Hệ Thống ERP Xưởng May
              </h2>
              <p className="mt-4 text-base text-stone-600">
                Theo dõi vòng đời từng chiếc áo: từ khâu giặt ủi, kiểm định hư hại AI đến điều phối
                logistics bàn giao.
              </p>
              <div className="mt-6 flex flex-wrap gap-4">
                <div className="flex items-center gap-2 rounded-lg border border-sand bg-mist px-3.5 py-2 text-xs font-semibold text-stone-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>Kiểm định tình trạng bằng AI</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-sand bg-mist px-3.5 py-2 text-xs font-semibold text-stone-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>Lịch giặt ủi &amp; hoàn cọc tự động</span>
                </div>
              </div>
              <div className="mt-8">
                <Link
                  href="/dashboard"
                  className="shadow-xs inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-sand bg-white px-5 py-2.5 text-xs font-bold text-stone-900 transition hover:border-lotus active:scale-[0.98]"
                >
                  <span>Đến Trang Quản Trị ERP</span>
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-xl border border-sand bg-mist p-5">
                <div className="flex items-center justify-between border-b border-sand pb-3">
                  <span className="text-xs font-bold text-stone-900">
                    Trạng Thái Tồn Kho Thực Tế
                  </span>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">
                    Hệ Thống Hoạt Động
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-sand bg-white p-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-stone-100">
                        <Tag className="h-4 w-4 text-stone-700" />
                      </span>
                      <div>
                        <b className="text-stone-900">CP-042: Nhật Bình Hoàng Phái</b>
                        <span className="mt-0.5 block text-xs text-stone-600">
                          Đã thuê · Trả ngày 16/10
                        </span>
                      </div>
                    </div>
                    <span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                      Đang thuê
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-sand bg-white p-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-stone-100">
                        <Tag className="h-4 w-4 text-stone-700" />
                      </span>
                      <div>
                        <b className="text-stone-900">AT-105: Áo Tấc Lam Thượng</b>
                        <span className="mt-0.5 block text-xs text-stone-600">
                          Khử khuẩn tiêu chuẩn
                        </span>
                      </div>
                    </div>
                    <span className="rounded bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-900">
                      Sẵn sàng
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Footer Chuẩn Khách Hàng */}
      <CustomerFooter />
    </div>
  );
}
