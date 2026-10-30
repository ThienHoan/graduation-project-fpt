"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedCompassProps {
  className?: string;
  size?: number;
  color?: string;
  trigger?: "hover" | "always";
}

/**
 * Animated Compass Icon (Heritage Discovery & Navigation)
 * Inspired by AnimatedIcons.co. Needle oscillates and aligns dynamically.
 */
export function AnimatedCompass({
  className = "",
  size = 20,
  color = "currentColor",
  trigger = "hover",
}: AnimatedCompassProps) {
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
    >
      {/* Outer Dial Circle */}
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" />

      {/* Compass Needle (Wobbling & finding North) */}
      <motion.polygon
        points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? color : "none"}
        fillOpacity={active ? 0.25 : 0}
        animate={
          active
            ? {
                rotate: [0, 60, -35, 15, -5, 0],
              }
            : { rotate: 0 }
        }
        transition={{ duration: 1.2, ease: "easeOut" }}
        style={{ transformOrigin: "12px 12px" }}
      />
    </motion.svg>
  );
}

