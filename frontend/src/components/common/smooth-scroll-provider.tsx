"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * SmoothScrollProvider — Lớp cuộn mượt quán tính kiểu XimiTech tích hợp GSAP ScrollTrigger
 *
 * Kết nối hoàn hảo giữa Lenis Smooth Scroll và GSAP Ticker:
 * - Đồng bộ nhịp quét màn hình (120fps trên ProMotion)
 * - Tự động cập nhật ScrollTrigger khi Lenis cuộn trang
 * - Tôn trọng prefers-reduced-motion
 * - Tự động tắt trên /dashboard để đảm bảo native scroll ổn định cho bảng và modal
 */
export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    gsap.registerPlugin(ScrollTrigger);

    // Không chạy Lenis trên các trang dashboard (customer, staff, manager, admin)
    // để tránh xung đột với sticky headers, sidebars, và modals
    if (pathname?.startsWith("/dashboard")) {
      return;
    }

    // Tôn trọng thiết lập giảm chuyển động của hệ điều hành
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const lenis = new Lenis({
      duration: 1.18,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.5,
      smoothWheel: true,
      syncTouch: false,
    });

    lenisRef.current = lenis;

    // Đồng bộ sự kiện cuộn Lenis vào GSAP ScrollTrigger
    lenis.on("scroll", ScrollTrigger.update);

    // Vòng lặp tick của GSAP trực tiếp điều phối Lenis (chuẩn GSAP + Lenis integration)
    const updateTicker = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(updateTicker);
    gsap.ticker.lagSmoothing(0);

    // Xử lý cuộn tới anchor khi click vào link có hash (#)
    function handleHashClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const anchor = target.closest<HTMLAnchorElement>("a[href^='#'], a[href*='/#']");
      if (!anchor) return;

      const href = anchor.getAttribute("href") || "";
      const hash = href.includes("#") ? href.split("#")[1] : "";
      if (!hash) return;

      const el = document.getElementById(hash);
      if (el) {
        e.preventDefault();
        lenis.scrollTo(el, { offset: -80 }); // Offset cho sticky header
      }
    }
    document.addEventListener("click", handleHashClick);

    return () => {
      document.removeEventListener("click", handleHashClick);
      gsap.ticker.remove(updateTicker);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [pathname]);

  return <>{children}</>;
}
