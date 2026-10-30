"use client";

import { motion } from "framer-motion";
interface AnimatedCalendarProps {
  className?: string;
  size?: number;
  /** Màu chủ đạo – mặc định dùng màu jade */
  color?: string;
  /** Kích hoạt animation liên tục */
  animate?: boolean;
}

/**
 * AnimatedCalendar – biểu tượng lịch với animation:
 * - Thân lịch nảy nhẹ khi hover
 * - Hai vòng gáy lịch lắc lư
 * - Các chấm ngày tháng xuất hiện từng cái (cascade)
 */
export function AnimatedCalendar({
  className,
  size = 24,
  color = "currentColor",
  animate = false,
}: AnimatedCalendarProps) {
  const ringVariants = {
    idle: { rotate: 0 },
    wiggle: {
      rotate: [0, -15, 15, -10, 10, 0],
      transition: { duration: 0.6, ease: "easeInOut" as const },
    },
  };

  const bodyVariants = {
    idle: { y: 0 },
    bounce: {
      y: [0, -3, 0],
      transition: { duration: 0.4, ease: "easeOut" as const },
    },
  };

  const dotVariants = {
    hidden: { opacity: 0, scale: 0 },
    visible: (i: number) => ({
      opacity: 1,
      scale: 1,
      transition: { delay: i * 0.08, duration: 0.25, ease: "backOut" as const },
    }),
  };

  const dots = [
    { cx: 8, cy: 14 },
    { cx: 12, cy: 14 },
    { cx: 16, cy: 14 },
    { cx: 8, cy: 18 },
    { cx: 12, cy: 18 },
    { cx: 16, cy: 18 },
  ];

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["inline-block", className].filter(Boolean).join(" ")}
      whileHover="bounce"
      animate={animate ? "bounce" : "idle"}
      variants={bodyVariants}
    >
      {/* Thân lịch */}
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      {/* Thanh tiêu đề */}
      <line x1="3" y1="9" x2="21" y2="9" />

      {/* Vòng gáy trái */}
      <motion.line
        x1="8"
        y1="2"
        x2="8"
        y2="6"
        style={{ transformOrigin: "8px 4px" }}
        variants={ringVariants}
        whileHover="wiggle"
      />
      {/* Vòng gáy phải */}
      <motion.line
        x1="16"
        y1="2"
        x2="16"
        y2="6"
        style={{ transformOrigin: "16px 4px" }}
        variants={ringVariants}
        whileHover="wiggle"
      />

      {/* Các chấm ngày */}
      {dots.map((dot, i) => (
        <motion.circle
          key={i}
          cx={dot.cx}
          cy={dot.cy}
          r={1}
          fill={color}
          stroke="none"
          custom={i}
          initial="hidden"
          animate="visible"
          variants={dotVariants}
        />
      ))}
    </motion.svg>
  );
}
