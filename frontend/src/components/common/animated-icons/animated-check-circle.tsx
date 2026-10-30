"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedCheckCircleProps {
  className?: string;
  size?: number;
  color?: string;
  trigger?: "hover" | "always";
}

/**
 * Animated Check Circle Icon (Success & Verified Status)
 * Inspired by AnimatedIcons.co. Features draw-path stroke animation and pop bounce.
 */
export function AnimatedCheckCircle({
  className = "",
  size = 20,
  color = "currentColor",
  trigger = "hover",
}: AnimatedCheckCircleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const active = trigger === "always" || isHovered;

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block overflow-visible ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      animate={active ? { scale: [1, 1.15, 0.95, 1.05, 1] } : { scale: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Outer Circle with Dashoffset draw */}
      <motion.circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        initial={{ pathLength: 1 }}
        animate={active ? { pathLength: [0.3, 1], rotate: [0, 360] } : { pathLength: 1, rotate: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{ transformOrigin: "12px 12px" }}
      />

      {/* Checkmark tick with spring snap */}
      <motion.path
        d="M8 12L11 15L16 9"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 1 }}
        animate={
          active
            ? {
                pathLength: [0, 1],
                strokeWidth: [1.5, 2.5, 2],
              }
            : { pathLength: 1, strokeWidth: 2 }
        }
        transition={{ duration: 0.45, ease: "easeOut", delay: active ? 0.2 : 0 }}
      />
    </motion.svg>
  );
}

