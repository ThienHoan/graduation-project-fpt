"use client";

import Link from "next/link";
import { HeritageMascot } from "@/components/mascot";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { ArrowLeft, Compass, Sparkles } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink">
      <CustomerNavbar />

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="relative mx-auto max-w-lg text-center">
          {/* Subtle Ambient Light */}
          <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-radial from-antique/20 to-transparent blur-3xl" />

          {/* Mascot in Curious / Lost state */}
          <div className="relative mb-6 flex justify-center">
            <HeritageMascot mood="curious" size="xl" showSparkles={true} />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-antique/40 bg-antique/10 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.2em] text-antique">
            <Compass className="h-3.5 w-3.5" />
            <span>404 • Lạc Lối Giữa Cố Đô</span>
          </span>

          <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-ink">
            Nơi Này Chưa Được Khai Mở
          </h1>

          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-stone-600">
            Bé Nghê đã lùng sục khắp các cung điện và kho tàng nhưng không tìm thấy lối đi này. Đừng lo, để Bé Nghê dẫn đường bạn trở về sảnh chính nhé!
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl bg-lotus px-6 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Trở về Trang Chủ</span>
            </Link>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2 rounded-xl border border-antique/60 bg-white px-6 py-3 text-xs font-semibold uppercase tracking-wider text-stone-800 shadow-xs transition hover:border-lotus hover:text-lotus"
            >
              <Sparkles className="h-3.5 w-3.5 text-antique" />
              <span>Khám phá Cổ Phục</span>
            </Link>
          </div>
        </div>
      </main>

      <CustomerFooter />
    </div>
  );
}

