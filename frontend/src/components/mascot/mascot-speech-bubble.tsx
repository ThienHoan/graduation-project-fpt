"use client";

import { motion } from "framer-motion";
import { X, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";
import { playHoverTick } from "@/lib/sound-fx";

export interface MascotAction {
  label: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
}

interface MascotSpeechBubbleProps {
  title?: string;
  subtitle?: string;
  message: string;
  actions?: MascotAction[];
  onClose?: () => void;
  position?: "top" | "top-left" | "left" | "right";
  className?: string;
}

export function MascotSpeechBubble({
  title = "Bé Nghê Cổ Phục",
  subtitle = "Sứ Giả Hoàng Triều",
  message,
  actions,
  onClose,
  position = "top-left",
  className = "",
}: MascotSpeechBubbleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`relative z-50 w-72 sm:w-80 rounded-2xl border border-antique/40 bg-parchment/95 p-4 text-ink shadow-lg backdrop-blur-md ${className}`}
    >
        {/* Pointer Arrow */}
        {position === "top" && (
          <div className="absolute -bottom-2 right-8 h-4 w-4 rotate-45 border-b border-r border-antique/40 bg-parchment/95" />
        )}
        {position === "top-left" && (
          <div className="absolute -bottom-2 left-8 h-4 w-4 rotate-45 border-b border-r border-antique/40 bg-parchment/95" />
        )}
        {position === "left" && (
          <div className="absolute top-6 -right-2 h-4 w-4 rotate-45 border-t border-r border-antique/40 bg-parchment/95" />
        )}
        {position === "right" && (
          <div className="absolute top-6 -left-2 h-4 w-4 rotate-45 border-b border-l border-antique/40 bg-parchment/95" />
        )}

        {/* Header */}
        <div className="flex items-center justify-between border-b border-sand/60 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-antique/20 text-antique">
              <Sparkles className="h-3 w-3" />
            </span>
            <div>
              <h4 className="font-display text-sm font-bold leading-tight text-ink">
                {title}
              </h4>
              {subtitle && (
                <p className="text-[10px] font-medium tracking-wide text-stone-500 uppercase">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={() => {
                try {
                  playHoverTick();
                } catch {}
                onClose();
              }}
              className="rounded-full p-1 text-stone-400 hover:bg-sand/40 hover:text-stone-700 transition"
              aria-label="Đóng lời khuyên"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <p className="mt-2 text-xs leading-relaxed text-stone-700">
          {message}
        </p>

        {/* Action Badges / Buttons */}
        {actions && actions.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-1">
            {actions.map((act, index) => {
              const baseClass = act.primary
                ? "inline-flex items-center gap-1 rounded-lg bg-lotus px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-oxblood transition"
                : "inline-flex items-center gap-1 rounded-lg border border-antique/40 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-stone-700 hover:bg-white hover:text-lotus transition";

              if (act.href) {
                return (
                  <Link
                    key={index}
                    href={act.href}
                    onClick={() => {
                      try {
                        playHoverTick();
                      } catch {}
                      if (act.onClick) act.onClick();
                    }}
                    className={baseClass}
                  >
                    <span>{act.label}</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                );
              }

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    try {
                      playHoverTick();
                    } catch {}
                    if (act.onClick) act.onClick();
                  }}
                  className={baseClass}
                >
                  <span>{act.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
  );
}

