"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedShieldProps {
  className?: string;
  size?: number;
  color?: string;
  trigger?: "hover" | "always";
}

/**
 * Animated Shield Icon (Protection & Quality Assurance)
 * Inspired by AnimatedIcons.co. Glows with protective pulses and checkmark expansion.
 */
export function AnimatedShield({
  className = "",
  size = 20,
  color = "currentColor",
  trigger = "hover",
}: AnimatedShieldProps) {
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
      animate={
        active
          ? {
              scale: [1, 1.1, 1],
              filter: ["drop-shadow(0 0 0 rgba(34,93,85,0))", "drop-shadow(0 0 6px rgba(34,93,85,0.6))", "drop-shadow(0 0 0 rgba(34,93,85,0))"],
            }
          : { scale: 1, filter: "none" }
      }
      transition={{ duration: 1.2, repeat: active ? Infinity : 0 }}
    >
      {/* Shield Body */}
      <path
        d="M12 22S20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? color : "none"}
        fillOpacity={active ? 0.12 : 0}
      />

      {/* Internal Security Checkmark */}
      <motion.path
        d="M9 12L11 14L15 10"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={active ? { pathLength: [0.6, 1], scale: [0.9, 1.15, 1] } : { pathLength: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        style={{ transformOrigin: "12px 12px" }}
      />
    </motion.svg>
  );
}

