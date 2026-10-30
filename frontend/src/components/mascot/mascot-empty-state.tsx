"use client";

import Link from "next/link";
import { HeritageMascot, type MascotMood } from "./heritage-mascot";
import { ArrowRight, RotateCcw } from "lucide-react";
import { playWoodTap } from "@/lib/sound-fx";

interface MascotEmptyStateProps {
  mood?: MascotMood;
  title: string;
  description: string;
  actionText?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
}

export function MascotEmptyState({
  mood = "empty",
  title,
  description,
  actionText,
  actionHref,
  onAction,
  className = "",
}: MascotEmptyStateProps) {
  function handleActionClick() {
    try {
      playWoodTap();
    } catch {}
    if (onAction) onAction();
  }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-3xl border border-sand/80 bg-gradient-to-b from-white to-parchment/40 px-6 py-12 text-center shadow-xs ${className}`}
    >
      {/* Mascot Graphic */}
      <div className="relative mb-3">
        <HeritageMascot
          mood={mood}
          size="md"
          interactive={true}
          showSparkles={mood === "magic" || mood === "celebrate"}
          onClick={() => {
            try {
              playWoodTap();
            } catch {}
          }}
        />
      </div>

      {/* Title */}
      <h3 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-ink">
        {title}
      </h3>

      {/* Description */}
      <p className="mt-2 max-w-md text-xs sm:text-sm leading-relaxed text-stone-600">
        {description}
      </p>

      {/* Action Button */}
      {actionText && (
        <div className="mt-6">
          {actionHref ? (
            <Link
              href={actionHref}
              onClick={handleActionClick}
              className="inline-flex items-center gap-2 rounded-xl bg-lotus px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
            >
              <span>{actionText}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleActionClick}
              className="inline-flex items-center gap-2 rounded-xl border border-antique/60 bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-800 shadow-xs transition hover:border-lotus hover:text-lotus"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{actionText}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

