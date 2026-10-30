"use client";

import { motion, type TargetAndTransition } from "framer-motion";
import { type ReactNode, useState } from "react";

export type AnimationType =
  | "bounce"
  | "wiggle"
  | "pulse"
  | "spin"
  | "tilt"
  | "glow"
  | "float";

interface AnimatedIconWrapperProps {
  children: ReactNode;
  animation?: AnimationType;
  trigger?: "hover" | "always" | "click";
  className?: string;
  size?: number | string;
  onClick?: () => void;
}

/**
 * Universal Animated Icon Wrapper inspired by AnimatedIcons.co & micro-interactions.
 * Wraps any SVG or Lucide icon to add spring physics, rotations, bounces and glows.
 */
export function AnimatedIconWrapper({
  children,
  animation = "bounce",
  trigger = "hover",
  className = "",
  size,
  onClick,
}: AnimatedIconWrapperProps) {
  const [isClicked, setIsClicked] = useState(false);

  const getAnimationVariants = (): {
    hover?: TargetAndTransition;
    animate?: TargetAndTransition;
    tap?: TargetAndTransition;
  } => {
    switch (animation) {
      case "wiggle":
        return {
          hover: {
            rotate: [0, -14, 12, -8, 6, 0],
            transition: { duration: 0.5, ease: "easeInOut" },
          },
          animate:
            trigger === "always"
              ? {
                  rotate: [0, -10, 10, -5, 5, 0],
                  transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                }
              : undefined,
          tap: { scale: 0.88, rotate: -15 },
        };

      case "pulse":
        return {
          hover: {
            scale: [1, 1.2, 1, 1.15, 1],
            transition: { duration: 0.6, ease: "easeInOut" },
          },
          animate:
            trigger === "always"
              ? {
                  scale: [1, 1.1, 1],
                  transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
                }
              : undefined,
          tap: { scale: 0.9 },
        };

      case "spin":
        return {
          hover: {
            rotate: 360,
            transition: { duration: 0.7, ease: "easeInOut" },
          },
          animate:
            trigger === "always"
              ? {
                  rotate: 360,
                  transition: { duration: 6, repeat: Infinity, ease: "linear" },
                }
              : undefined,
          tap: { rotate: 180, scale: 0.9 },
        };

      case "tilt":
        return {
          hover: {
            rotate: [0, -15, 0],
            y: -2,
            transition: { duration: 0.3, ease: "easeOut" },
          },
          tap: { rotate: 10, scale: 0.92 },
        };

      case "glow":
        return {
          hover: {
            scale: 1.12,
            filter: "drop-shadow(0 0 8px rgba(198, 166, 100, 0.75))",
            transition: { duration: 0.3 },
          },
          animate:
            trigger === "always"
              ? {
                  filter: [
                    "drop-shadow(0 0 2px rgba(198, 166, 100, 0.3))",
                    "drop-shadow(0 0 8px rgba(198, 166, 100, 0.8))",
                    "drop-shadow(0 0 2px rgba(198, 166, 100, 0.3))",
                  ],
                  transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                }
              : undefined,
          tap: { scale: 0.95 },
        };

      case "float":
        return {
          hover: {
            y: [-2, -6, -2],
            transition: { duration: 0.6, repeat: Infinity, ease: "easeInOut" },
          },
          animate:
            trigger === "always"
              ? {
                  y: [0, -4, 0],
                  transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                }
              : undefined,
          tap: { y: 2 },
        };

      case "bounce":
      default:
        return {
          hover: {
            y: [0, -6, 0, -2, 0],
            scale: [1, 1.1, 0.96, 1.04, 1],
            transition: { duration: 0.5, ease: "easeInOut" },
          },
          animate:
            trigger === "always"
              ? {
                  y: [0, -3, 0],
                  transition: { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
                }
              : undefined,
          tap: { scale: 0.88, y: 1 },
        };
    }
  };

  const variants = getAnimationVariants();

  return (
    <motion.span
      className={`inline-flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
      whileHover={trigger === "hover" ? variants.hover : undefined}
      whileTap={variants.tap}
      animate={variants.animate}
      onClick={() => {
        setIsClicked(true);
        onClick?.();
      }}
    >
      {children}
    </motion.span>
  );
}

