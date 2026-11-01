"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

interface CountUpProps {
  end: number;
  start?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

/**
 * CountUp — Đếm số tăng dần kiểu XimiTech khi phần tử cuộn vào viewport
 * Hỗ trợ định dạng số, prefix/suffix, và tự tắt khi prefers-reduced-motion
 */
export function CountUp({
  end,
  start = 0,
  duration = 2,
  prefix = "",
  suffix = "",
  decimals = 0,
  className = "",
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const shouldReduceMotion = useReducedMotion();
  // Khởi tạo luôn bằng `start` để server và client render giống nhau.
  // `useReducedMotion()` trả null ở server nên không được dùng để khởi tạo state
  // (sẽ gây lỗi hydration: server render 0, client render end).
  const [displayValue, setDisplayValue] = useState(start);

  useEffect(() => {
    if (!isInView || shouldReduceMotion) {
      if (shouldReduceMotion) setDisplayValue(end);
      return;
    }

    let startTime: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);

      // Ease-out expo curve for crisp deceleration
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = start + (end - start) * easeProgress;

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setDisplayValue(end);
      }
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isInView, end, start, duration, shouldReduceMotion]);

  // Format số thủ công thay vì toLocaleString: server (Node ICU) và browser có thể
  // dùng bộ dữ liệu locale khác nhau, gây mismatch text trong quá trình hydration.
  const formatted = formatNumber(displayValue, decimals);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/**
 * Định dạng số kiểu vi-VN (dấu chấm phân tách nghìn) một cách tất định,
 * không phụ thuộc vào ICU của runtime.
 */
function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "0";

  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, fracPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value < 0 ? "-" : "";

  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}
