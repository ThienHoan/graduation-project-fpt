"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { playWoodTap, playRoyalChime, playHoverTick } from "@/lib/sound-fx";
import { OptimizedImage } from "@/components/common/optimized-image";
import { ArrowRight, Sparkles, BookOpen, Clock, CheckCircle2, X, ShoppingBag, ShieldCheck } from "lucide-react";

interface CostumeItem {
  id: string;
  name: string;
  category: string;
  image: string;
  description: string;
  historicalContext: string;
  material: string;
  pricePerDay: string;
  deposit: string;
}

interface DynastyEpoch {
  id: string;
  name: string;
  period: string;
  title: string;
  quote: string;
  source: string;
  accentColor: string;
  badgeBg: string;
  costumes: CostumeItem[];
}

const dynastyEpochs: DynastyEpoch[] = [
  {
    id: "nguyen",
    name: "Triều Nguyễn",
    period: "1802 — 1945",
    title: "Vàng Son Hoàng Triều & Điển Chuẩn Cung Đình",
    quote: "Phẩm phục định rõ tôn ti, áo Nhật Bình thêu phụng rực rỡ nơi cung cấm.",
    source: "Khâm Định Đại Nam Hội Điển Sự Lệ",
    accentColor: "text-amber-600 border-amber-500",
    badgeBg: "bg-amber-100 text-amber-900",
    costumes: [
      {
        id: "nhat-binh",
        name: "Nhật Bình Hoàng Phái",
        category: "Lễ phục Hậu phi",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuDvowMvVYvat40td0eYsm2xOyewRYASe82qkNdpYOhmlGpLtvo-CY1thuEj3H0Ex3taiVfLTKX2ESAQ9rvq13OU7L69H-IJ4iocVq83idHbhAPZHBmozXmdoLqEf5PfXNcZXs7Uz2YmawbQoZwfIPGjesRNPzDQS18JSZs6OvqnDYS1j1ExtTh4ACDttytuJ5mfuT_RDObouB5E1zhQh92zf6X9GOwGBGbQXQXDpLMIfe9reSHCU63uycTGSdtwAwLtouKipe_UVc2k",
        description: "Cổ áo hình chữ nhật viền hoa văn thủy ba, ngũ sắc lộng lẫy dành riêng cho các dịp tế lễ cung đình.",
        historicalContext: "Phục dựng nguyên bản theo trang phục hoàng tộc triều vua Đồng Khánh.",
        material: "Gấm dệt tơ tằm thủ công Hà Đông, chỉ thêu kim tuyến",
        pricePerDay: "1.200.000đ",
        deposit: "3.500.000đ",
      },
      {
        id: "ao-tac",
        name: "Áo Tấc Lam Thượng",
        category: "Lễ phục Thường nhật",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O",
        description: "Tay thụng rộng trang trọng, sắc xanh chàm sâu lắng dành cho lễ gia tiên và nghi thức trọng đại.",
        historicalContext: "Trang phục chuẩn mực của tầng lớp trí thức và quan lại thời Nguyễn.",
        material: "Lụa tơ tằm nhuộm thảo mộc tự nhiên",
        pricePerDay: "800.000đ",
        deposit: "2.200.000đ",
      },
      {
        id: "ngu-than",
        name: "Ngũ Thân Tay Chẽn Cát Tường",
        category: "Trang phục Nam",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuDpdew3ggLs6xlVpmJgHap9WUw51NiN8-SxZWc86HUd9JvUYXaAk5-M3DypF1FMxsO3kNu01OGy-kQjU1PAp0AXHNP7Jf7L9-ulP3kBMVjnSPdqbrW4WB_Klqenl5xpyMrEanc_WAZ9CVkvIEIlBxsT5uOv76VGhgt_WPLW3zGg_0HBn3ppgZUi3J1zHml8--uq-_9PpHGmkfACxuONpGtfDGiC9h0jrET4HMI_c6BDLqq37iaAcUrMvRKL2JuFJkLPnlJaEKugt7ic",
        description: "Cấu trúc 5 thân tượng trưng tứ thân phụ mẫu và bản thân, đoan trang nho nhã của quý ông truyền thống.",
        historicalContext: "Nghị định cải cách y phục của chúa Nguyễn Phúc Khoát năm 1744.",
        material: "Gấm hoa văn chữ Thọ, khuy cài đồng nguyên khối",
        pricePerDay: "950.000đ",
        deposit: "2.800.000đ",
      },
    ],
  },
  {
    id: "le-so",
    name: "Triều Lê Sơ",
    period: "1428 — 1527",
    title: "Khí Phách Ngàn Năm & Phong Cốt Thuần Việt",
    quote: "Áo giao lĩnh tay rộng, vạt áo buông dài tôn vinh nét thanh nhã phóng khoáng.",
    source: "Đại Việt Sử Ký Toàn Thư",
    accentColor: "text-emerald-700 border-emerald-600",
    badgeBg: "bg-emerald-100 text-emerald-900",
    costumes: [
      {
        id: "giao-linh",
        name: "Giao Lĩnh Thủy Nguyệt",
        category: "Cổ phục Đại Việt",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O",
        description: "Hai vạt chéo giao nhau nơi cổ áo, thắt lưng lụa buông rủ mang khí thái phong nhã ngàn xưa.",
        historicalContext: "Dựa trên hiện vật lăng mộ quan lại thời Hậu Lê thế kỷ 15-16.",
        material: "Đũi tơ tằm thô dệt tay, mềm mát và bay tà",
        pricePerDay: "1.100.000đ",
        deposit: "3.200.000đ",
      },
      {
        id: "vien-linh",
        name: "Viên Lĩnh Bổ Phục",
        category: "Triều phục Cung đình",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuDvowMvVYvat40td0eYsm2xOyewRYASe82qkNdpYOhmlGpLtvo-CY1thuEj3H0Ex3taiVfLTKX2ESAQ9rvq13OU7L69H-IJ4iocVq83idHbhAPZHBmozXmdoLqEf5PfXNcZXs7Uz2YmawbQoZwfIPGjesRNPzDQS18JSZs6OvqnDYS1j1ExtTh4ACDttytuJ5mfuT_RDObouB5E1zhQh92zf6X9GOwGBGbQXQXDpLMIfe9reSHCU63uycTGSdtwAwLtouKipe_UVc2k",
        description: "Cổ tròn đóng kín, ngực thêu Bổ tử hình chim công tượng trưng cho phẩm trật trang nghiêm.",
        historicalContext: "Bản phục chế chuẩn bảo tàng y phục Lê Sơ sơ kỳ.",
        material: "Sa hàn lụa quý, hoa văn mây ngũ sắc dệt chìm",
        pricePerDay: "1.350.000đ",
        deposit: "4.000.000đ",
      },
    ],
  },
  {
    id: "duong-dai",
    name: "Đương Đại & Tân Thời",
    period: "1930 — Nay",
    title: "Giao Thoa Kim Cổ & Vẻ Đẹp Vĩnh Cửu",
    quote: "Chiếc áo dài tôn vinh đường nét người phụ nữ Việt Nam qua bao biến thiên lịch sử.",
    source: "Tư liệu Mỹ Thuật Đông Dương",
    accentColor: "text-rose-700 border-rose-600",
    badgeBg: "bg-rose-100 text-rose-900",
    costumes: [
      {
        id: "ao-dai-phung-vu",
        name: "Áo Dài Phụng Vũ Vàng Kim",
        category: "Lễ Phục Cưới Hoàng Gia",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuDS1o5lSmGpkTUXc5LH4apMFHlcKEbyL3m8Z8RgdQROFBvi-EDOwrPRIdNCQ9PXjHlWVZcnVBJitf0PhQPkfPCnb91euyVXyXmEjGH22LyYBCWx9tIZUtohpM8mddPADbGjhomL0P10yhDjoWJvUVy3zdHCEPBS6Jxc2dQXB9H04gP_Pc-tbIec8mGliSs3Ny9q-elFSPeu7fojwL3nKXsVaM970qq_IoiXasEdVlGaBNW-BdsVVcsi52wgkajLfqkJMTYSAX-fJaR9",
        description: "Lụa tơ tằm thêu phụng vàng kim tinh xảo, cấu trúc đứng dáng trang nhã cho ngày trọng đại nhất cuộc đời.",
        historicalContext: "Kế thừa phom dáng áo dài Lemur thập niên 1930 kết hợp họa tiết thêu hoàng tộc.",
        material: "Lụa gấm satin tơ tằm 100%, chỉ thêu ánh kim",
        pricePerDay: "1.500.000đ",
        deposit: "4.000.000đ",
      },
      {
        id: "ao-dai-lam-vien",
        name: "Áo Dài Tân Thời Lam Viên",
        category: "Dạ tiệc & Kỷ niệm",
        image:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O",
        description: "Tà áo thướt tha, viền cổ cao thanh mảnh, sắc xanh ngọc bích tôn sáng làn da Á Đông.",
        historicalContext: "Phong cách tiểu thư Hà thành xưa, vừa đoan trang vừa hiện đại.",
        material: "Tơ sen thủ công, thoáng mát và tôn dáng",
        pricePerDay: "900.000đ",
        deposit: "2.500.000đ",
      },
    ],
  },
];

/**
 * HeritageTimelineShowcase — "Hành Trình Vàng Son" Sticky Timeline Triều Đại
 * Biến khu vực Bộ Sưu Tập thành dòng thời gian xuyên không:
 * - Chọn triều đại để xem tác phẩm tiêu biểu kèm trích dẫn điển tích lịch sử
 * - Chuyển cảnh mượt mà bằng AnimatePresence
 * - Âm thanh khánh chuông & gõ mộc theo tọa độ
 */
export function HeritageTimelineShowcase() {
  const [activeEpochIndex, setActiveEpochIndex] = useState(0);
  const [selectedCostume, setSelectedCostume] = useState<CostumeItem | null>(null);
  const activeEpoch = dynastyEpochs[activeEpochIndex];

  const handleSelectEpoch = (index: number, e: React.MouseEvent) => {
    if (index === activeEpochIndex) return;
    playRoyalChime({ event: e });
    setActiveEpochIndex(index);
  };

  return (
    <div className="relative">
      {/* 1. Thanh Dòng Thời Gian Xuyên Không (Chronological Dynasty Timeline Navigator) */}
      <div className="relative mx-auto mb-10 max-w-4xl">
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row sm:gap-2">
          {dynastyEpochs.map((epoch, index) => {
            const isActive = index === activeEpochIndex;
            return (
              <button
                key={epoch.id}
                type="button"
                onClick={(e) => handleSelectEpoch(index, e)}
                onMouseEnter={(e) => playHoverTick({ event: e })}
                className={`group relative flex w-full flex-1 flex-col items-center rounded-xl border p-3.5 text-center transition-all duration-300 sm:w-auto ${
                  isActive
                    ? "border-lotus bg-white shadow-md ring-2 ring-lotus/20 scale-[1.02]"
                    : "border-sand bg-white/70 hover:border-stone-400 hover:bg-white"
                }`}
              >
                {/* Dấu chấm mốc thời gian */}
                <div className="mb-2 flex items-center gap-1.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition-transform ${
                      isActive ? "bg-lotus scale-125" : "bg-stone-300 group-hover:bg-stone-500"
                    }`}
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-stone-600">
                    {epoch.period}
                  </span>
                </div>

                <span
                  className={`font-display text-lg font-bold transition-colors ${
                    isActive ? "text-oxblood" : "text-stone-700 group-hover:text-ink"
                  }`}
                >
                  {epoch.name}
                </span>

                {/* Thanh chỉ báo active phía dưới */}
                {isActive && (
                  <motion.div
                    layoutId="activeTimelineBar"
                    className="absolute -bottom-1 h-1 w-12 rounded-full bg-lotus"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Banner Điển Tích & Trích Dẫn Lịch Sử Của Triều Đại */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeEpoch.id}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8 rounded-xl border border-sand bg-white/90 p-5 backdrop-blur-xs shadow-2xs"
        >
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2.5 py-0.5 text-xs font-bold ${activeEpoch.badgeBg}`}>
                  Niên biểu {activeEpoch.period}
                </span>
                <span className="text-xs font-semibold text-stone-600">
                  {activeEpoch.costumes.length} mẫu tiêu biểu trong kho
                </span>
              </div>
              <h3 className="mt-1.5 font-display text-2xl font-bold text-oxblood">
                {activeEpoch.title}
              </h3>
            </div>

            <div className="max-w-md border-l-2 border-lotus/40 pl-3.5 text-xs italic text-stone-600">
              <p>&ldquo;{activeEpoch.quote}&rdquo;</p>
              <span className="mt-1 block font-semibold text-stone-800 not-italic">
                — {activeEpoch.source}
              </span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* 3. Lưới Các Tác Phẩm Cổ Phục Của Triều Đại Được Chọn */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeEpoch.id + "-grid"}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3"
        >
          {activeEpoch.costumes.map((costume) => (
            <div
              key={costume.id}
              onClick={() => {
                playRoyalChime();
                setSelectedCostume(costume);
              }}
              onMouseEnter={(e) => playHoverTick({ event: e })}
              className="heritage-card-interactive group flex flex-col justify-between overflow-hidden rounded-2xl border border-sand bg-white shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-xl cursor-pointer"
            >
              <div>
                {/* Khung ảnh cổ phục */}
                <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
                  <OptimizedImage
                    src={costume.image}
                    alt={costume.name}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute left-3 top-3 z-10 flex gap-1.5">
                    <span className="rounded bg-black/75 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
                      {activeEpoch.name}
                    </span>
                    <span className="rounded bg-white/90 px-2 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
                      {costume.category}
                    </span>
                  </div>
                </div>

                {/* Thông tin di sản */}
                <div className="p-5">
                  <h4 className="font-display text-2xl font-bold text-oxblood">
                    {costume.name}
                  </h4>
                  <p className="mt-2 text-xs leading-relaxed text-stone-600 line-clamp-2">
                    {costume.description}
                  </p>

                  {/* Điển tích phục dựng */}
                  <div className="mt-3.5 space-y-1.5 rounded-lg bg-stone-50 p-2.5 text-[11px] text-stone-600 border border-sand/60">
                    <div className="flex items-start gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-bronze mt-0.5" />
                      <span>{costume.historicalContext}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
                      <span>{costume.material}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Băng giá thuê và nút xem chi tiết */}
              <div className="border-t border-sand p-5 pt-3">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="text-stone-500 text-[11px]">Giá thuê: </span>
                    <b className="text-base font-bold text-lotus">{costume.pricePerDay}</b>
                    <span className="text-stone-500 text-[11px]">/ngày</span>
                  </div>
                  <span className="font-medium text-stone-600 text-[11px]">
                    Cọc: {costume.deposit}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sẵn sàng lưu kho
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playRoyalChime();
                      setSelectedCostume(costume);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-lotus hover:underline cursor-pointer"
                  >
                    <span>Xem chi tiết</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Quick-View Modal Chi Tiết Cổ Phục Theo Triều Đại */}
      <AnimatePresence>
        {selectedCostume && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCostume(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="relative w-full max-w-4xl rounded-3xl bg-[#0c121e] border border-white/15 shadow-[0_25px_80px_rgba(0,0,0,0.8)] overflow-hidden text-white"
            >
              <button
                onClick={() => setSelectedCostume(null)}
                className="absolute top-5 right-5 z-20 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6 sm:p-8">
                <div className="md:col-span-5 relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/15 bg-stone-900 shadow-xl">
                  <OptimizedImage
                    src={selectedCostume.image}
                    alt={selectedCostume.name}
                    fill
                    sizes="(max-width: 768px) 100vw, 400px"
                    className="object-cover"
                  />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-300">
                    {activeEpoch.name} · {selectedCostume.category}
                  </div>
                </div>

                <div className="md:col-span-7 flex flex-col justify-between text-left">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-amber-400 uppercase tracking-wider mb-2">
                      <ShieldCheck className="w-4 h-4" />
                      <span>{activeEpoch.name} ({activeEpoch.period})</span>
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-black text-white">
                      {selectedCostume.name}
                    </h3>
                    <p className="text-xs sm:text-sm text-stone-300 mt-2 leading-relaxed">
                      {selectedCostume.description}
                    </p>

                    <div className="mt-4 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2 text-xs text-stone-300">
                      <div className="flex items-start gap-2">
                        <BookOpen className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-amber-300">Điển tích lịch sử: </span>
                          <span>{selectedCostume.historicalContext}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-amber-300">Chất liệu chế tác: </span>
                          <span>{selectedCostume.material}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">Giá thuê ngày</span>
                        <p className="text-base font-black text-amber-300">
                          {selectedCostume.pricePerDay}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">Tiền cọc đảm bảo</span>
                        <p className="text-sm font-bold text-white">
                          {selectedCostume.deposit}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3 mt-6 pt-4 border-t border-white/10">
                    <Link
                      href="/catalog"
                      onClick={() => {
                        playWoodTap();
                        setSelectedCostume(null);
                      }}
                      className="w-full sm:w-auto flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-rose-400 text-stone-950 font-black text-sm tracking-wide shadow-lg shadow-amber-400/20 hover:scale-[1.02] transition-transform"
                    >
                      <ShoppingBag className="w-4 h-4 text-stone-950" />
                      <span>Đặt thuê trong danh mục ERP</span>
                    </Link>

                    <Link
                      href="/try-on"
                      onClick={() => {
                        playRoyalChime();
                        setSelectedCostume(null);
                      }}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold text-xs sm:text-sm tracking-wide transition-all"
                    >
                      <Sparkles className="w-4 h-4 text-[#00d4ff]" />
                      <span>Thử AI Virtual Try-On</span>
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
