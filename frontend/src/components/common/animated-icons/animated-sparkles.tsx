"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedSparklesProps {
  className?: string;
  size?: number;
  color?: string;
  trigger?: "hover" | "always";
}

/**
 * Animated Sparkles Icon (Magic & AI)
 * Inspired by AnimatedIcons.co. 4-pointed stars rotate, scale and twinkle independently.
 */
export function AnimatedSparkles({
  className = "",
  size = 20,
  color = "currentColor",
  trigger = "hover",
}: AnimatedSparklesProps) {
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
      {/* 1. Big Center Star */}
      <motion.path
        d="M12 2L14.2 8.8L21 11L14.2 13.2L12 20L9.8 13.2L3 11L9.8 8.8L12 2Z"
        fill={color}
        fillOpacity={0.15}
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={
          active
            ? {
                scale: [1, 1.18, 0.95, 1.1, 1],
                rotate: [0, 15, -10, 5, 0],
              }
            : { scale: 1, rotate: 0 }
        }
        transition={{
          duration: 1.4,
          repeat: active ? Infinity : 0,
          ease: "easeInOut",
        }}
        style={{ transformOrigin: "12px 11px" }}
      />

      {/* 2. Top-Right Mini Star */}
      <motion.path
        d="M18.5 2L19.3 4.2L21.5 5L19.3 5.8L18.5 8L17.7 5.8L15.5 5L17.7 4.2L18.5 2Z"
        fill={color}
        fillOpacity={0.3}
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={
          active
            ? {
                scale: [0.6, 1.3, 0.6],
                opacity: [0.4, 1, 0.4],
                rotate: [0, 90, 180],
              }
            : { scale: 0.9, opacity: 0.7, rotate: 0 }
        }
        transition={{
          duration: 1.2,
          repeat: active ? Infinity : 0,
          ease: "easeInOut",
          delay: 0.2,
        }}
        style={{ transformOrigin: "18.5px 5px" }}
      />

      {/* 3. Bottom-Left Micro Star */}
      <motion.path
        d="M5.5 16L6.1 17.4L7.5 18L6.1 18.6L5.5 20L4.9 18.6L3.5 18L4.9 17.4L5.5 16Z"
        fill={color}
        fillOpacity={0.4}
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={
          active
            ? {
                scale: [0.8, 1.4, 0.8],
                opacity: [0.3, 1, 0.3],
              }
            : { scale: 0.85, opacity: 0.6 }
        }
        transition={{
          duration: 1.6,
          repeat: active ? Infinity : 0,
          ease: "easeInOut",
          delay: 0.4,
        }}
        style={{ transformOrigin: "5.5px 18px" }}
      />
    </motion.svg>
  );
}

