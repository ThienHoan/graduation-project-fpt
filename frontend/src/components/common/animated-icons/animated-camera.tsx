"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedCameraProps {
  className?: string;
  size?: number;
  color?: string;
  trigger?: "hover" | "always";
}

/**
 * Animated Camera Icon (AI Virtual Try-On)
 * Inspired by AnimatedIcons.co. Features rotating shutter lens and camera flash effect.
 */
export function AnimatedCamera({
  className = "",
  size = 20,
  color = "currentColor",
  trigger = "hover",
}: AnimatedCameraProps) {
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
              scale: [1, 1.08, 0.96, 1.02, 1],
            }
          : { scale: 1 }
      }
      transition={{ duration: 0.5, repeat: active ? Infinity : 0, repeatDelay: 1 }}
    >
      {/* Camera Body */}
      <path
        d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Camera Flash LED */}
      <motion.circle
        cx="18.5"
        cy="9.5"
        r="1"
        fill={active ? color : "none"}
        stroke={color}
        strokeWidth="1"
        animate={
          active
            ? {
                opacity: [0.3, 1, 0.3],
                scale: [0.8, 1.4, 0.8],
              }
            : { opacity: 0.5, scale: 1 }
        }
        transition={{ duration: 0.8, repeat: active ? Infinity : 0 }}
      />

      {/* Central Aperture Shutter Lens */}
      <motion.circle
        cx="12"
        cy="13"
        r="4"
        stroke={color}
        strokeWidth="1.8"
        animate={
          active
            ? {
                scale: [1, 1.2, 0.9, 1],
                strokeWidth: [1.8, 2.4, 1.8],
              }
            : { scale: 1, strokeWidth: 1.8 }
        }
        transition={{ duration: 0.7, repeat: active ? Infinity : 0, repeatDelay: 0.6 }}
        style={{ transformOrigin: "12px 13px" }}
      />

      {/* Inner Pupil dot */}
      <motion.circle
        cx="12"
        cy="13"
        r="1.5"
        fill={color}
        animate={
          active
            ? {
                scale: [0.8, 1.3, 0.8],
              }
            : { scale: 1 }
        }
        transition={{ duration: 0.7, repeat: active ? Infinity : 0, repeatDelay: 0.6 }}
        style={{ transformOrigin: "12px 13px" }}
      />
    </motion.svg>
  );
}

