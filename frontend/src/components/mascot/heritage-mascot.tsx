"use client";

import { motion, type TargetAndTransition, type Easing } from "framer-motion";
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

export type MascotMood =
  | "idle"
  | "happy"
  | "wave"
  | "magic"
  | "celebrate"
  | "curious"
  | "empty";

export type MascotSize = "xs" | "sm" | "md" | "lg" | "xl";

interface HeritageMascotProps {
  mood?: MascotMood;
  size?: MascotSize;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
  showSparkles?: boolean;
  isHovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
}

const sizeMap: Record<MascotSize, { width: number; height: number; pixelClass: string }> = {
  xs: { width: 42, height: 46, pixelClass: "w-[42px] h-[46px]" },
  sm: { width: 68, height: 74, pixelClass: "w-[68px] h-[74px]" },
  md: { width: 104, height: 114, pixelClass: "w-[104px] h-[114px]" },
  lg: { width: 150, height: 164, pixelClass: "w-[150px] h-[164px]" },
  xl: { width: 210, height: 230, pixelClass: "w-[210px] h-[230px]" },
};

/**
 * Bé Nghê Cổ Phục (Imperial Heritage Nghê Mascot)
 * Linh vật thuần Việt biểu trưng cho sự thông tuệ, trung thành và cát tường chốn hoàng triều.
 * Được dựng bằng SVG vector tối ưu, animation sống động với Framer Motion.
 */
export function HeritageMascot({
  mood = "idle",
  size = "md",
  className = "",
  onClick,
  interactive = true,
  showSparkles = false,
  isHovered: externalHovered,
  onHoverChange,
}: HeritageMascotProps) {
  const { width, height } = sizeMap[size];
  const [internalHovered, setInternalHovered] = useState(false);

  const isHovered = externalHovered !== undefined ? externalHovered : internalHovered;
  const effectiveMood = isHovered ? (mood === "empty" ? "curious" : "happy") : mood;

  // Motion variants for breathing & floating
  const floatAnim = useMemo((): TargetAndTransition => {
    const ease: Easing = "easeInOut";
    if (isHovered) {
      return {
        y: [0, -7, 0],
        rotate: [0, 2, -2, 0],
        scale: 1.08,
        transition: { duration: 1.2, repeat: Infinity, ease },
      };
    }

    switch (effectiveMood) {
      case "happy":
      case "celebrate":
        return {
          y: [0, -8, 0, -5, 0],
          rotate: [0, -2, 2, -1, 0],
          transition: { duration: 2.2, repeat: Infinity, ease },
        };
      case "magic":
        return {
          y: [0, -6, 0],
          scale: [1, 1.03, 1],
          transition: { duration: 1.8, repeat: Infinity, ease },
        };
      case "curious":
        return {
          rotate: [-4, 4, -4],
          y: [0, -3, 0],
          transition: { duration: 2.8, repeat: Infinity, ease },
        };
      case "empty":
        return {
          y: [0, 3, 0],
          transition: { duration: 3.5, repeat: Infinity, ease },
        };
      default:
        return {
          y: [0, -4, 0],
          transition: { duration: 3, repeat: Infinity, ease },
        };
    }
  }, [effectiveMood, isHovered]);

  function handleHoverStart() {
    if (!interactive) return;
    setInternalHovered(true);
    onHoverChange?.(true);
  }

  function handleHoverEnd() {
    if (!interactive) return;
    setInternalHovered(false);
    onHoverChange?.(false);
  }

  return (
    <motion.div
      className={`relative inline-flex items-center justify-center select-none ${interactive ? "cursor-pointer" : ""} ${className}`}
      style={{ width, height }}
      animate={floatAnim}
      onHoverStart={handleHoverStart}
      onHoverEnd={handleHoverEnd}
      whileTap={interactive ? { scale: 0.93 } : undefined}
      onClick={onClick}
    >
      {/* Background Magic Glow & Sparkles */}
      {(showSparkles || isHovered || effectiveMood === "magic" || effectiveMood === "celebrate") && (
        <>
          <motion.div
            className="absolute -inset-3 rounded-full bg-radial from-antique/40 via-lotus/20 to-transparent blur-md pointer-events-none"
            animate={{ opacity: isHovered ? [0.7, 1, 0.7] : [0.4, 0.9, 0.4], scale: isHovered ? [1.05, 1.2, 1.05] : [0.95, 1.1, 0.95] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -top-2 -right-1 text-antique pointer-events-none"
            animate={{ rotate: 360, scale: isHovered ? [1, 1.4, 1] : [0.8, 1.2, 0.8] }}
            transition={{ duration: isHovered ? 2.5 : 4, repeat: Infinity, ease: "linear" }}
          >
            <Sparkles className="w-5 h-5 fill-antique/70" />
          </motion.div>
        </>
      )}

      {/* Main Mascot SVG */}
      <svg
        viewBox="0 0 160 176"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-md overflow-visible"
      >
        <defs>
          {/* Nghê Body Gradients */}
          <linearGradient id="ngheBodyGrad" x1="40" y1="40" x2="120" y2="160" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fbf6ee" />
            <stop offset="60%" stopColor="#ecdcc8" />
            <stop offset="100%" stopColor="#d8bf9f" />
          </linearGradient>

          {/* Royal Antique Gold Accent */}
          <linearGradient id="goldManeGrad" x1="20" y1="10" x2="140" y2="110" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#e8cf92" />
            <stop offset="45%" stopColor="#c6a664" />
            <stop offset="100%" stopColor="#8d6e35" />
          </linearGradient>

          {/* Royal Lotus Red Accent */}
          <linearGradient id="lotusRibbonGrad" x1="40" y1="100" x2="120" y2="150" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#a92a2a" />
            <stop offset="60%" stopColor="#8b1e1e" />
            <stop offset="100%" stopColor="#5c1212" />
          </linearGradient>

          {/* Jade Accent */}
          <linearGradient id="jadePendantGrad" x1="70" y1="110" x2="90" y2="135" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#36867a" />
            <stop offset="100%" stopColor="#1a4d46" />
          </linearGradient>

          {/* Soft Shadow */}
          <filter id="shadowFilter" x="-10%" y="-10%" width="120%" height="130%" filterUnits="objectBoundingBox">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#251917" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* 1. Fluffy Cloud Tail (Đuôi mây cuộn xoắn) */}
        <motion.g
          style={{ transformOrigin: "135px 125px" }}
          animate={
            isHovered || effectiveMood === "happy" || effectiveMood === "celebrate"
              ? { rotate: [-14, 18, -14] }
              : { rotate: [-4, 6, -4] }
          }
          transition={{ duration: isHovered ? 1.2 : 1.8, repeat: Infinity, ease: "easeInOut" } as any}
        >
          <path
            d="M125 118C138 112 152 118 152 130C152 142 139 148 131 142C128 140 128 135 133 133C138 131 143 135 141 129C139 125 131 126 126 128Z"
            fill="url(#goldManeGrad)"
          />
          <path
            d="M135 125C141 120 148 123 147 130"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
        </motion.g>

        {/* 2. Rear Paws / Legs */}
        <ellipse cx="50" cy="148" rx="14" ry="10" fill="#d4bc9a" />
        <ellipse cx="110" cy="148" rx="14" ry="10" fill="#d4bc9a" />

        {/* 3. Plump Body (Thân mình tròn trĩnh phúc hậu) */}
        <path
          d="M44 100C44 76 60 68 80 68C100 68 116 76 116 100C116 126 105 152 80 152C55 152 44 126 44 100Z"
          fill="url(#ngheBodyGrad)"
          stroke="#c9b394"
          strokeWidth="2"
        />

        {/* Royal Belly Cloud Motif (Vân mây bụng) */}
        <path
          d="M72 125C76 121 84 121 88 125C91 128 89 133 80 133C71 133 69 128 72 125Z"
          fill="#fdfbf7"
          opacity="0.8"
        />

        {/* 4. Royal Mane & Head Cloud Horns (Bờm & Tai mây thuần Việt) */}
        {/* Left Cloud Ear */}
        <path
          d="M38 52C28 42 30 26 42 28C50 30 52 40 48 48C45 52 41 53 38 52Z"
          fill="url(#goldManeGrad)"
        />
        <path
          d="M37 38C40 34 45 35 44 41"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
        />

        {/* Right Cloud Ear */}
        <path
          d="M122 52C132 42 130 26 118 28C110 30 108 40 112 48C115 52 119 53 122 52Z"
          fill="url(#goldManeGrad)"
        />
        <path
          d="M123 38C120 34 115 35 116 41"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
        />

        {/* Top Heritage Cloud Tuft / Horn (Chỏm mây sừng cát tường trên đỉnh đầu) */}
        <path
          d="M80 16C86 16 93 21 91 29C89 36 84 37 80 37C76 37 71 36 69 29C67 21 74 16 80 16Z"
          fill="url(#goldManeGrad)"
        />
        <circle cx="80" cy="24" r="3.5" fill="#fdfaf3" opacity="0.85" />

        {/* 5. Chubby Head (Đầu tròn thông minh) */}
        <ellipse
          cx="80"
          cy="62"
          rx="38"
          ry="32"
          fill="url(#ngheBodyGrad)"
          stroke="#c9b394"
          strokeWidth="2"
        />

        {/* Cute Pink Cheeks (Má hồng đào phúc hậu) */}
        <ellipse cx="53" cy="71" rx="6" ry="3.5" fill="#e98585" opacity="0.45" />
        <ellipse cx="107" cy="71" rx="6" ry="3.5" fill="#e98585" opacity="0.45" />

        {/* 6. Eyes (Đôi mắt biểu cảm linh động) */}
        {effectiveMood === "happy" || effectiveMood === "celebrate" ? (
          // Happy Eyes (Mắt cười trăng khuyết tít mắt)
          <g stroke="#3a251b" strokeWidth="3" strokeLinecap="round">
            <path d="M59 62C61 58 67 58 69 62" />
            <path d="M91 62C93 58 99 58 101 62" />
          </g>
        ) : effectiveMood === "empty" ? (
          // Empty/Concerned Eyes
          <g>
            <ellipse cx="64" cy="62" rx="4.5" ry="5.5" fill="#3a251b" />
            <ellipse cx="96" cy="62" rx="4.5" ry="5.5" fill="#3a251b" />
            <circle cx="66" cy="60" r="1.5" fill="#fff" />
            <circle cx="98" cy="60" r="1.5" fill="#fff" />
            <path d="M60 55L68 57" stroke="#3a251b" strokeWidth="2" strokeLinecap="round" />
            <path d="M100 55L92 57" stroke="#3a251b" strokeWidth="2" strokeLinecap="round" />
          </g>
        ) : (
          // Sparkling Smart Eyes (Mắt long lanh)
          <g>
            <ellipse cx="64" cy="62" rx="5" ry="6" fill="#2a1810" />
            <ellipse cx="96" cy="62" rx="5" ry="6" fill="#2a1810" />
            {/* Eye Highlights */}
            <circle cx="66" cy="60" r="2.2" fill="#ffffff" />
            <circle cx="62" cy="64" r="1.1" fill="#ffffff" />
            <circle cx="98" cy="60" r="2.2" fill="#ffffff" />
            <circle cx="94" cy="64" r="1.1" fill="#ffffff" />
          </g>
        )}

        {/* 7. Cute Lion/Nghê Nose (Mũi Nghê đặc trưng) */}
        <path
          d="M76 68C76 66 84 66 84 68C84 71 81 73 80 73C79 73 76 71 76 68Z"
          fill="#7d4e32"
        />

        {/* 8. Mouth (Nụ cười cát tường) */}
        {effectiveMood === "celebrate" || effectiveMood === "happy" ? (
          // Big joyous open mouth
          <path
            d="M72 75C73 82 87 82 88 75C88 78 85 83 80 83C75 83 72 78 72 75Z"
            fill="#a83232"
          />
        ) : effectiveMood === "empty" ? (
          // Small bewildered mouth
          <ellipse cx="80" cy="77" rx="3" ry="2.5" fill="#7d4e32" />
        ) : (
          // Gentle contented smile
          <path
            d="M74 74C76 77 84 77 86 74"
            stroke="#4d2c1d"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* 9. Royal Lotus Collar & Bell (Vòng cổ chuông đồng hoàng gia) */}
        {/* Lotus Ribbon */}
        <path
          d="M48 93C62 101 98 101 112 93C114 97 106 106 80 106C54 106 46 97 48 93Z"
          fill="url(#lotusRibbonGrad)"
        />
        {/* Golden Bell (Lục lạc vàng lắc lư vui tai) */}
        <motion.g
          style={{ transformOrigin: "80px 106px" }}
          animate={isHovered ? { rotate: [-16, 16, -12, 12, 0] } : { rotate: 0 }}
          transition={{ duration: 0.8, repeat: isHovered ? Infinity : 0, ease: "easeInOut" } as any}
        >
          <circle cx="80" cy="106" r="8.5" fill="url(#goldManeGrad)" stroke="#744e1d" strokeWidth="1.2" />
          <circle cx="80" cy="106" r="3" fill="#fdf6db" />
          <line x1="80" y1="109" x2="80" y2="114" stroke="#4d2c1d" strokeWidth="1.5" strokeLinecap="round" />
        </motion.g>

        {/* 10. Front Paws (Hai chân trước tròn xinh) */}
        {effectiveMood === "wave" || isHovered ? (
          <>
            {/* Left paw on ground */}
            <ellipse cx="64" cy="144" rx="10" ry="8" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
            {/* Right paw waving */}
            <motion.g
              style={{ transformOrigin: "105px 115px" }}
              animate={{ rotate: [-15, 25, -15] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" } as any}
            >
              <ellipse cx="108" cy="112" rx="10" ry="8" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
              <path d="M104 110L106 114M108 109L109 114M112 110L111 114" stroke="#c9b394" strokeWidth="1.2" strokeLinecap="round" />
            </motion.g>
          </>
        ) : effectiveMood === "celebrate" ? (
          <>
            {/* Holding Royal Jade Tablet / Scroll (Cầm thẻ ngọc hoặc chiếu chỉ) */}
            <g transform="translate(68, 120)">
              <rect x="0" y="0" width="24" height="20" rx="3" fill="url(#goldManeGrad)" stroke="#694819" strokeWidth="1" />
              <text x="12" y="14" fontSize="8" fontWeight="bold" fill="#581616" textAnchor="middle" fontFamily="sans-serif">
                CÁT TƯỜNG
              </text>
            </g>
            <ellipse cx="66" cy="132" rx="7" ry="6" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
            <ellipse cx="94" cy="132" rx="7" ry="6" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
          </>
        ) : effectiveMood === "curious" ? (
          <>
            {/* Curious Paw scratching chin */}
            <ellipse cx="62" cy="144" rx="10" ry="8" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
            <ellipse cx="96" cy="134" rx="9" ry="8" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
          </>
        ) : (
          <>
            {/* Default Rest Paws */}
            <ellipse cx="64" cy="144" rx="10" ry="8" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
            <ellipse cx="96" cy="144" rx="10" ry="8" fill="#ecdcc8" stroke="#c9b394" strokeWidth="1.5" />
            {/* Toe lines */}
            <path d="M60 146L61 149M64 146L64 150M68 146L67 149" stroke="#c9b394" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M92 146L93 149M96 146L96 150M100 146L99 149" stroke="#c9b394" strokeWidth="1.2" strokeLinecap="round" />
          </>
        )}
      </svg>
    </motion.div>
  );
}

