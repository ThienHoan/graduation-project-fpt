"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isSoundEnabled, toggleSound } from "@/lib/sound-fx";

interface SoundToggleProps {
  className?: string;
  variant?: "floating" | "compact";
}

export function SoundToggle({ className = "", variant = "floating" }: SoundToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setEnabled(isSoundEnabled());

    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<{ enabled: boolean }>;
      if (customEvent.detail) {
        setEnabled(customEvent.detail.enabled);
      }
    };

    window.addEventListener("co-phuc:sound-toggle", handleToggle);
    return () => window.removeEventListener("co-phuc:sound-toggle", handleToggle);
  }, []);

  if (!mounted) return null;

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={() => toggleSound()}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-sand bg-white/90 p-2 sm:px-2.5 sm:py-1 text-xs font-medium text-stone-700 transition hover:border-lotus hover:text-lotus active:scale-95 ${className}`}
        title={enabled ? "Tắt âm thanh di sản" : "Bật âm thanh di sản"}
        aria-label={enabled ? "Tắt âm thanh di sản" : "Bật âm thanh di sản"}
      >
        {enabled ? (
          <>
            <Volume2 className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="hidden 2xl:inline text-[11px] font-semibold text-amber-800 whitespace-nowrap">Âm thanh: Bật</span>
          </>
        ) : (
          <>
            <VolumeX className="h-4 w-4 shrink-0 text-stone-400" />
            <span className="hidden 2xl:inline text-[11px] text-stone-500 whitespace-nowrap">Âm thanh: Tắt</span>
          </>
        )}
      </button>
    );
  }

  // Floating variant (Đặt ở góc dưới bên phải nhưng dời sang trái cạnh logo chat, không đè lên chat và tránh dev badge góc trái)
  return (
    <aside aria-label="Điều khiển âm thanh" className="fixed bottom-5 right-20 sm:bottom-5.5 sm:right-22 z-40">
      <button
        type="button"
        onClick={() => toggleSound()}
        className={`group relative flex items-center gap-2.5 rounded-full border border-amber-300/60 bg-white/90 px-3.5 py-2.5 shadow-lg backdrop-blur-md transition-all duration-300 hover:border-amber-500 hover:shadow-xl active:scale-95 ${
          enabled ? "ring-2 ring-amber-400/30" : "opacity-80"
        } ${className}`}
        title={enabled ? "Tắt âm thanh trải nghiệm" : "Bật âm thanh trải nghiệm di sản"}
        aria-label={enabled ? "Tắt âm thanh trải nghiệm" : "Bật âm thanh trải nghiệm di sản"}
      >
        {enabled ? (
          <div className="flex items-center gap-2">
            <div className="relative flex h-5 w-5 items-center justify-center">
              <Volume2 className="h-4 w-4 text-amber-700 transition-transform group-hover:scale-110" />
            </div>
            {/* Thanh equalizer sóng âm nhịp nhàng */}
            <div className="flex items-end gap-0.5 h-3.5">
              <span className="w-0.5 bg-amber-600 rounded-full animate-[soundwave_0.8s_ease-in-out_infinite] h-2" />
              <span className="w-0.5 bg-amber-600 rounded-full animate-[soundwave_1.1s_ease-in-out_infinite_0.15s] h-3.5" />
              <span className="w-0.5 bg-amber-600 rounded-full animate-[soundwave_0.9s_ease-in-out_infinite_0.3s] h-1.5" />
            </div>
            <span className="text-xs font-semibold tracking-wide text-amber-900 pr-1">
              Âm thanh Di Sản
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <VolumeX className="h-4 w-4 text-stone-400" />
            <span className="text-xs font-medium text-stone-500 pr-1">
              Bật âm thanh
            </span>
          </div>
        )}
      </button>
    </aside>
  );
}
