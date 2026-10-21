"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";

/**
 * SmoothScrollProvider — Lớp cuộn mượt quán tính kiểu XimiTech
 *
 * Thay thế cơ chế cuộn mặc định (giật nấc) bằng Lenis Smooth Scroll:
 * - Cuộn có quán tính vật lý (momentum), mượt mà trên mọi thiết bị
 * - Đồng bộ requestAnimationFrame với nhịp quét màn hình (120fps trên ProMotion)
 * - Tôn trọng prefers-reduced-motion: tự động tắt khi hệ thống yêu cầu giảm chuyển động
 * - Hỗ trợ data-lenis-prevent trên các phần tử có scroll riêng (modal, dropdown)
 */
export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    // Tôn trọng thiết lập giảm chuyển động của hệ điều hành
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const lenis = new Lenis({
      duration: 1.15,             // Thời gian quán tính (giây) — cân bằng giữa mượt mà và phản hồi
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Exponential easing — tự nhiên như iOS
      touchMultiplier: 1.5,       // Nhân hệ số cuộn cảm ứng trên mobile
      smoothWheel: true,          // Bật smooth scroll cho chuột
      syncTouch: false,           // Không ghi đè touch scroll native (giữ UX di động tự nhiên)
    });

    lenisRef.current = lenis;

    // Vòng lặp requestAnimationFrame đồng bộ với nhịp quét màn hình
    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

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
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <>{children}</>;
}
