"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { HeritageMascot, type MascotMood } from "./heritage-mascot";
import { MascotSpeechBubble, type MascotAction } from "./mascot-speech-bubble";
import { useAuth } from "@/components/auth/auth-provider";
import { playRoyalChime, playWoodTap, playHoverTick } from "@/lib/sound-fx";
import { Sparkles, Minus, ChevronRight } from "lucide-react";

interface TriviaItem {
  mood: MascotMood;
  title: string;
  msg: string;
  hint: string;
  actions?: MascotAction[];
}

const CULTURAL_TRIVIA: TriviaItem[] = [
  {
    mood: "happy",
    title: "Điển Tích Áo Nhật Bình",
    hint: "Dải cổ Ngũ Hành tương sinh triều Nguyễn!",
    msg: "Hoa văn dải cổ áo tượng trưng cho Ngũ Hành tương sinh (Kim - Mộc - Thủy - Hỏa - Thổ), vốn là thường phục cao quý của Hoàng hậu, Công chúa triều Nguyễn đấy!",
    actions: [{ label: "Thử áo Nhật Bình", href: "/try-on", primary: true }],
  },
  {
    mood: "magic",
    title: "Ý Nghĩa Áo Ngũ Thân",
    hint: "Tứ thân phụ mẫu & tấm lòng hiếu thảo!",
    msg: "Năm thân áo tượng trưng cho Tứ thân phụ mẫu (cha mẹ hai bên) ôm ấp lấy thân con ở giữa. Một biểu trưng tuyệt đẹp về đạo hiếu và nếp sống người Việt xưa!",
    actions: [{ label: "Xem bộ sưu tập", href: "/catalog" }],
  },
  {
    mood: "curious",
    title: "Mẹo Giữ Cổ Phục Chuẩn Xưởng",
    hint: "Bảo quản lụa tơ tằm bằng móc gỗ đệm vai!",
    msg: "Cổ phục lụa tơ tằm nên được treo bằng móc gỗ đệm vai bản rộng và tránh xịt nước hoa trực tiếp lên sợi tơ tự nhiên để giữ độ óng ả lâu dài nhé!",
  },
  {
    mood: "celebrate",
    title: "Lời Chúc Hoàng Triều",
    hint: "Cát tường như ý, phong thái rạng ngời!",
    msg: "Bé Nghê kính chúc bạn một ngày an khang cát tường, khí chất uy nghiêm rạng rỡ khi khoác lên mình tà cổ phục Việt Nam!",
  },
];

export interface FloatingHeritageCompanionProps {
  className?: string;
}

export function FloatingHeritageCompanion({ className = "" }: FloatingHeritageCompanionProps) {
  const rawPathname = usePathname();
  const pathname = rawPathname ?? "";
  const { session } = useAuth();

  // Guard against SSR / Hydration Mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showAutoHint, setShowAutoHint] = useState(false);
  const [triviaIndex, setTriviaIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);

  const autoHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHintTimers() {
    if (autoHintTimerRef.current) {
      clearTimeout(autoHintTimerRef.current);
      autoHintTimerRef.current = null;
    }
    if (hideHintTimerRef.current) {
      clearTimeout(hideHintTimerRef.current);
      hideHintTimerRef.current = null;
    }
  }

  // Path-based dynamic greetings for Customers
  const currentContext = useMemo((): TriviaItem => {
    if (pathname === "/" || pathname === "") {
      return {
        mood: "wave",
        title: "Bé Nghê Hoàng Triều",
        hint: "Bấm vào tớ để khám phá Cố Đô!",
        msg: "Chào mừng quý khách đến với không gian Cổ Phục! Bạn muốn thử đồ AI hay dạo xem bảo vật 3D trước?",
        actions: [
          { label: "Thử đồ AI ngay", href: "/try-on", primary: true },
          { label: "Xem bộ sưu tập", href: "/catalog" },
        ],
      };
    }
    if (pathname.startsWith("/catalog")) {
      return {
        mood: "curious",
        title: "Trợ Lý Chọn Phục Trang",
        hint: "Cần gợi ý chọn dáng áo phù hợp?",
        msg: "Bé Nghê có thể gợi ý dáng áo theo vóc dáng và dịp lễ (chụp kỷ yếu, cưới hỏi, lễ gia tiên). Cần tớ chỉ điểm cứ bấm nhé!",
        actions: [{ label: "Thử đồ AI ướm dáng", href: "/try-on", primary: true }],
      };
    }
    if (pathname.startsWith("/try-on")) {
      return {
        mood: "magic",
        title: "Kính Vạn Hoa AI",
        hint: "Mẹo nhỏ giúp AI lên dáng chuẩn nhất!",
        msg: "Mẹo nhỏ: Chụp ảnh đứng thẳng, ánh sáng tự nhiên sẽ giúp AI của xưởng khoác tà áo vừa vặn nhất!",
        actions: [{ label: "Đổi câu chuyện khác", onClick: () => handleNextTrivia() }],
      };
    }
    if (pathname.startsWith("/booking")) {
      return {
        mood: "celebrate",
        title: "Đồng Hành Đặt Lịch",
        hint: "Mỗi bộ áo đều được niêm phong kỹ!",
        msg: "Mỗi bộ cổ phục trước giờ giao đều được nghệ nhân là ủi thủ công và niêm phong ấn chỉ xưởng nghiêm ngặt.",
      };
    }
    if (pathname.startsWith("/dashboard/customer")) {
      return {
        mood: "happy",
        title: "Thư Phòng Của Bạn",
        hint: "Hồ sơ số đo & lịch hẹn của bạn!",
        msg: "Mọi lịch hẹn và hồ sơ số đo của bạn đều được lưu giữ tại đây. Bé Nghê luôn sẵn sàng hỗ trợ!",
      };
    }

    return CULTURAL_TRIVIA[0];
  }, [pathname]);

  // =========================================================================
  // RULE PHÂN QUYỀN HIỂN THỊ:
  // CHỈ hiển thị cho Khách hàng (Customer) và Khách vãng lai (Guest).
  // ẨN HOÀN TOÀN với Staff, Manager, Admin hoặc các trang quản trị nghiệp vụ.
  // =========================================================================
  const isInternalStaff = Boolean(session && session.user.role !== "customer");
  const isDashboardBackend =
    pathname.startsWith("/dashboard/admin") ||
    pathname.startsWith("/dashboard/staff") ||
    pathname.startsWith("/dashboard/manager");

  // Auto-hint sau 4s nếu khách chưa tương tác để tăng độ nổi bật
  useEffect(() => {
    if (!mounted || isInternalStaff || isDashboardBackend || hasInteracted) return;

    clearHintTimers();

    autoHintTimerRef.current = setTimeout(() => {
      setShowAutoHint(true);
      hideHintTimerRef.current = setTimeout(() => {
        setShowAutoHint(false);
      }, 6000);
    }, 4000);

    return () => {
      clearHintTimers();
    };
  }, [pathname, mounted, isInternalStaff, isDashboardBackend, hasInteracted]);

  // If not mounted or excluded role/route, render nothing
  if (!mounted || isInternalStaff || isDashboardBackend) {
    return null;
  }

  function handleMascotClick() {
    clearHintTimers();
    try {
      playRoyalChime();
    } catch {}
    setHasInteracted(true);
    setShowAutoHint(false);
    if (!isOpen) {
      setIsOpen(true);
    } else {
      handleNextTrivia();
    }
  }

  function handleNextTrivia() {
    try {
      playWoodTap();
    } catch {}
    setTriviaIndex((prev) => (prev + 1) % CULTURAL_TRIVIA.length);
  }

  function handleMouseEnter() {
    setIsHovered(true);
    try {
      playHoverTick();
    } catch {}
  }

  function handleMouseLeave() {
    setIsHovered(false);
  }

  const displayData = hasInteracted ? CULTURAL_TRIVIA[triviaIndex] : currentContext;

  // Trạng thái thu gọn thành "Thẻ Bài Ngọc" (Mini Jade Seal) nép sát cạnh trái
  if (isMinimized) {
    return (
      <aside aria-label="Linh vật Bé Nghê (Thu nhỏ)" className={`fixed bottom-4 left-2 sm:bottom-6 sm:left-2 z-40 ${className}`}>
        <motion.button
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            try {
              playWoodTap();
            } catch {}
            setIsMinimized(false);
          }}
          className="flex items-center gap-1.5 rounded-full border border-antique/60 bg-parchment/95 px-3 py-1.5 text-xs font-bold text-ink shadow-lg backdrop-blur-md hover:border-antique hover:bg-white transition cursor-pointer"
          title="Mở rộng Bé Nghê Cổ Phục"
        >
          <Sparkles className="h-3 w-3 text-antique animate-spin" />
          <span>Bé Nghê</span>
          <ChevronRight className="h-3 w-3 text-stone-400" />
        </motion.button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Linh vật Bé Nghê Cổ Phục"
      className={`fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-40 flex flex-col items-start pointer-events-none select-none ${className}`}
    >
      {/* 1. Full Speech Bubble Dialog (Opens on Click) */}
      <div className="pointer-events-auto mb-3">
        <AnimatePresence>
          {isOpen && (
            <MascotSpeechBubble
              title={displayData.title}
              subtitle="Sứ Giả Hoàng Triều • Bé Nghê"
              message={displayData.msg}
              actions={[
                ...(displayData.actions || []),
                {
                  label: "Điển tích khác ✦",
                  onClick: handleNextTrivia,
                },
              ]}
              onClose={() => setIsOpen(false)}
              position="top-left"
            />
          )}
        </AnimatePresence>
      </div>

      {/* 2. Interactive Mascot & Royal Pedestal (Bệ đài Cung đình Nổi bật) */}
      <div
        className="pointer-events-auto relative flex flex-col items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Mascot Avatar Figure */}
        <div className="relative group cursor-pointer" onClick={handleMascotClick}>
          {/* Subtle Royal Halo Aura on Hover / Sparkle */}
          <motion.div
            className="absolute -inset-3 rounded-full bg-radial from-antique/50 via-lotus/20 to-transparent blur-md pointer-events-none"
            animate={{
              opacity: isHovered ? 1 : 0.45,
              scale: isHovered ? 1.3 : 1,
            }}
            transition={{ duration: 0.3 }}
          />

          <HeritageMascot
            mood={isOpen ? displayData.mood : "wave"}
            size="sm"
            isHovered={isHovered}
            interactive={true}
            showSparkles={true}
            className="filter drop-shadow-xl transition-transform duration-300 group-hover:scale-[1.12]"
          />

          {/* First-time Notification Badge */}
          {!hasInteracted && !isOpen && (
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lotus opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-lotus items-center justify-center text-[8px] font-bold text-white">
                ✦
              </span>
            </span>
          )}
        </div>

        {/* 3. Bệ Đài Hoàng Gia (Royal Pedestal Base) giúp Bé Nghê vô cùng nổi bật & sang trọng */}
        <div className="mt-1 flex items-center gap-1 rounded-full border border-antique/60 bg-gradient-to-r from-parchment via-white to-parchment px-2.5 py-0.5 shadow-md backdrop-blur-sm">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-antique/20 text-antique text-[9px]">
            ✦
          </span>
          <span className="font-display text-[11px] font-bold tracking-wide text-ink">
            Bé Nghê Cổ Phục
          </span>
          {/* Nút thu nhỏ kín đáo */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clearHintTimers();
              setShowAutoHint(false);
              try {
                playHoverTick();
              } catch {}
              setIsMinimized(true);
            }}
            className="ml-0.5 rounded-full p-0.5 text-stone-400 hover:bg-sand/60 hover:text-stone-700 transition cursor-pointer"
            title="Thu nhỏ lại góc"
          >
            <Minus className="h-2.5 w-2.5" />
          </button>
        </div>

        {/* 4. Hover Speech Pill hoặc Auto-Hint (Trượt ra khi di chuột hoặc gợi ý tự động) */}
        <AnimatePresence>
          {!isOpen && (isHovered || showAutoHint) && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: -4, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={handleMascotClick}
              className="absolute -top-20 left-0 cursor-pointer rounded-2xl border border-antique/50 bg-parchment/95 p-2.5 text-ink shadow-xl backdrop-blur-md w-56 pointer-events-auto"
            >
              <div className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-antique/20 text-antique">
                  <Sparkles className="h-2.5 w-2.5" />
                </span>
                <span className="font-display text-xs font-bold text-ink">
                  Bé Nghê mách bạn:
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-stone-700">
                {displayData.hint}
              </p>
              <span className="mt-1 block text-[9px] font-semibold text-lotus">
                ✦ Bấm vào tớ để xem chi tiết
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
