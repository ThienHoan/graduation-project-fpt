"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedShoppingBagProps {
  className?: string;
  size?: number;
  color?: string;
  count?: number;
  trigger?: "hover" | "always";
}

/**
 * Animated Shopping Bag Icon (E-Commerce & Rental Cart)
 * Inspired by AnimatedIcons.co. Bag body bounces and handles swing realistically.
 */
export function AnimatedShoppingBag({
  className = "",
  size = 20,
  color = "currentColor",
  count,
  trigger = "hover",
}: AnimatedShoppingBagProps) {
  const [isHovered, setIsHovered] = useState(false);
  const active = trigger === "always" || isHovered;

  return (
    <motion.span
      className={`relative inline-flex items-center justify-center ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileTap={{ scale: 0.9 }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="overflow-visible"
        animate={
          active
            ? {
                y: [0, -4, 0, -1.5, 0],
                rotate: [0, -3, 3, -1, 0],
              }
            : { y: 0, rotate: 0 }
        }
        transition={{
          duration: 0.6,
          repeat: active ? Infinity : 0,
          repeatDelay: 0.8,
          ease: "easeInOut",
        }}
        style={{ transformOrigin: "12px 20px" }}
      >
        {/* Bag Body */}
        <path
          d="M6 8H18L19.2 20C19.3 20.6 18.8 21 18.2 21H5.8C5.2 21 4.7 20.6 4.8 20L6 8Z"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? color : "none"}
          fillOpacity={active ? 0.08 : 0}
        />

        {/* Bag Handles (Swinging on hover) */}
        <motion.path
          d="M9 10V6C9 4.34315 10.3431 3 12 3C13.6569 3 15 4.34315 15 6V10"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={
            active
              ? {
                  scaleY: [1, 0.85, 1.1, 0.95, 1],
                  rotate: [0, -8, 8, -4, 0],
                }
              : { scaleY: 1, rotate: 0 }
          }
          transition={{ duration: 0.6, repeat: active ? Infinity : 0, repeatDelay: 0.8, ease: "easeInOut" }}
          style={{ transformOrigin: "12px 10px" }}
        />
      </motion.svg>

      {/* Cart Count Badge with spring pop animation */}
      {typeof count === "number" && count > 0 && (
        <motion.span
          key={count}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-lotus px-1 text-[10px] font-bold text-white shadow-xs"
        >
          {count}
        </motion.span>
      )}
    </motion.span>
  );
}

