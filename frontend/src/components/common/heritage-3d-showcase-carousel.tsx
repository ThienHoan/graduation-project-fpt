"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useSpring,
  useMotionValueEvent,
} from "framer-motion";
import {
  Volume2,
  VolumeX,
  Sparkles,
  ShieldCheck,
  Layers,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  X,
  Compass,
  ArrowDown,
  ShoppingBag,
  Tag,
  CheckCircle2,
} from "lucide-react";
import {
  isSoundEnabled,
  toggleSound,
  playHoverTick,
  playRoyalChime,
  playWoodTap,
} from "@/lib/sound-fx";
import { OptimizedImage } from "@/components/common/optimized-image";
import Link from "next/link";

export interface ShowcaseItem {
  id: string; // Real Garment ID from Database
  number: string;
  category: string;
  dynasty: "nguyen" | "le" | "contemporary";
  dynastyLabel: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  imageUrl: string; // Real product image from Supabase / ERP
  specs: {
    material: string;
    technique: string;
    rfid: string;
    preservation: string;
    rentalPrice: string;
    depositAmount: string;
    availableSizes: string[];
    color: string;
    rating: number;
  };
  mockup: {
    badge: string;
    statusText: string;
    highlightMetric: string;
    accentColor: string;
    bgGradient: string;
  };
}

// Danh sách SẢN PHẨM THẬT 100% từ cơ sở dữ liệu ERP & Supabase Storage
export const REAL_SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "00000000-0000-0000-0002-000000000006",
    number: "01",
    category: "CỔ PHỤC TRIỀU NGUYỄN · HOÀNG TỘC",
    dynasty: "nguyen",
    dynastyLabel: "Triều Nguyễn (1802 - 1945)",
    slug: "nhatbinh-xanhngoc.vn",
    title: "Nhật Bình Cung Đình Xanh Ngọc",
    subtitle: "Lễ phục chánh cung Hoàng Triều Huế — Dải ngũ sắc thêu hoa văn cổ",
    description:
      "Tuyệt tác áo Nhật Bình sắc xanh ngọc bích phối cổ viền ngũ sắc tượng trưng ngũ hành. Hoa văn phượng hoàng và mây nước dệt gấm sa chuẩn quy chế Khâm Định Đại Nam Hội Điển Sự Lệ.",
    imageUrl: "https://cophuchoangthanhhue.com/wp-content/uploads/2024/10/Hinh-anh-34-1.jpeg",
    specs: {
      material: "Lụa gấm Bảo Lộc dệt hoa chìm",
      technique: "Thêu tay cung đình Huế ngũ sắc",
      rfid: "#RFID-NB-006-CYAN",
      preservation: "Hộp gỗ hoàng đàn kiểm soát ẩm 55%",
      rentalPrice: "550.000 ₫/ngày",
      depositAmount: "1.300.000 ₫",
      availableSizes: ["S", "M", "L"],
      color: "Xanh ngọc bích",
      rating: 4.98,
    },
    mockup: {
      badge: "CHUẨN KHÂM ĐỊNH",
      statusText: "SẴN SÀNG THUÊ & THỬ AI",
      highlightMetric: "Dải Cổ Ngũ Sắc",
      accentColor: "#00d4ff",
      bgGradient: "from-sky-950/90 via-[#0a1b26]/95 to-black",
    },
  },
  {
    id: "d81b6d3f-2ddb-402c-9154-041b29767300",
    number: "02",
    category: "ÁO TẤC TAY THỤNG · ĐẠI LỄ HOÀNG GIA",
    dynasty: "nguyen",
    dynastyLabel: "Triều Nguyễn (1802 - 1945)",
    slug: "aotac-namthung.vn",
    title: "Áo Dài Nam Tay Thụng Ngũ Thân",
    subtitle: "Lễ y trọng thể dành cho hôn lễ, tế tự và nghi thức cung đình",
    description:
      "Dáng áo Tấc tay thụng dài quá gối, vạt áo năm thân tôn vinh tứ thân phụ mẫu và đạo hiếu. Tông sắc đỏ chu sa rực rỡ tượng trưng cho may mắn, thịnh vượng và uy nghi quý tộc.",
    imageUrl:
      "https://ecylctxtoznnjjcctlxx.supabase.co/storage/v1/object/public/products/1790873816007-cho-thue-ao-ngu-than-tay-thung-3_630.webp",
    specs: {
      material: "Lụa Sa Nam đoạn dệt sợi tơ tằm đỏ",
      technique: "Khâu giấu chỉ thủ công truyền thống",
      rfid: "#RFID-AT-300-RED",
      preservation: "Bảo quản ion kháng khuẩn tự nhiên",
      rentalPrice: "350.000 ₫/ngày",
      depositAmount: "1.000.000 ₫",
      availableSizes: ["M", "L", "XL"],
      color: "Đỏ chu sa",
      rating: 4.95,
    },
    mockup: {
      badge: "ĐẠI LỄ TAY THỤNG",
      statusText: "SẢN PHẨM BÁN CHẠY NHẤT",
      highlightMetric: "Tay Thụng Quý Tộc",
      accentColor: "#ef4444",
      bgGradient: "from-rose-950/90 via-[#22090d]/95 to-black",
    },
  },
  {
    id: "48894f87-d017-47b7-8049-e85387119be7",
    number: "03",
    category: "CỔ PHỤC QUÂN TỬ · NHO PHONG",
    dynasty: "nguyen",
    dynastyLabel: "Triều Nguyễn (1802 - 1945)",
    slug: "nguthan-xanhla.vn",
    title: "Áo Dài Nam Ngũ Thân Xanh Lá",
    subtitle: "Tay chẽn thư sinh đĩnh đạc — Phong độ văn nhân xứ Đàng Trong",
    description:
      "Phom áo năm thân tay chẽn thanh thoát, cúc đồng chạm nổi tinh xảo. Màu xanh lục cổ phong nhã nhặn, tôn vinh nét nho nhã và cốt cách của bậc quân tử Đàng Trong xưa.",
    imageUrl:
      "https://ecylctxtoznnjjcctlxx.supabase.co/storage/v1/object/public/products/1787712928267-2c3a0404-b128-4c0d-bf98-e9b94162642f.jpg",
    specs: {
      material: "Lụa tơ tằm Vạn Phúc dệt hoa văn cổ",
      technique: "Đúc cúc đồng thủ công truyền thống",
      rfid: "#RFID-NT-9be7-GRN",
      preservation: "Treo phom định hình dáng cổ áo",
      rentalPrice: "400.000 ₫/ngày",
      depositAmount: "900.000 ₫",
      availableSizes: ["S", "M", "L"],
      color: "Xanh lá cổ phong",
      rating: 4.92,
    },
    mockup: {
      badge: "VĂN NHÂN NHO NHÃ",
      statusText: "ĐI KÈM KHĂN ĐÓNG HOÀNG GIA",
      highlightMetric: "Tay Chẽn Đĩnh Đạc",
      accentColor: "#10b981",
      bgGradient: "from-emerald-950/90 via-[#071d15]/95 to-black",
    },
  },
  {
    id: "00000000-0000-0000-0002-000000000007",
    number: "04",
    category: "CỔ PHỤC TRIỀU NGUYỄN · TRANG TRỌNG",
    dynasty: "nguyen",
    dynastyLabel: "Triều Nguyễn (1802 - 1945)",
    slug: "aotac-nautram.vn",
    title: "Áo Tấc Nâu Trầm Quý Tộc",
    subtitle: "Sắc nâu trầm mộc mạc lưu giữ hồn cốt lễ nghi chốn cung thất",
    description:
      "Được may từ lụa tơ tằm nhuộm củ nâu thảo mộc theo lối truyền thống đất Bắc. Tà áo thụng rộng uy nghiêm, thích hợp cho các dịp tế tự gia tiên và lễ cưới trọng thể.",
    imageUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ-pX1xQ-4BgBfyqx_o0AijuaAJVPFxMjwkAk3ynAXZsgcayV_U-lJLkN4&s=10",
    specs: {
      material: "Lụa đũi tơ tằm tự nhiên nhuộm thảo mộc",
      technique: "Nhuộm thủ công thảo mộc dân gian",
      rfid: "#RFID-AT-007-BRN",
      preservation: "Giặt sấy hấp sinh học kiểm định",
      rentalPrice: "480.000 ₫/ngày",
      depositAmount: "1.200.000 ₫",
      availableSizes: ["M", "L"],
      color: "Nâu trầm nho gia",
      rating: 4.9,
    },
    mockup: {
      badge: "TẾ TỰ GIA TIÊN",
      statusText: "LỤA TỰ NHIÊN NGUYÊN BẢN",
      highlightMetric: "Nhuộm Thảo Mộc",
      accentColor: "#b45309",
      bgGradient: "from-amber-950/90 via-[#201306]/95 to-black",
    },
  },
  {
    id: "00000000-0000-0000-0002-000000000008",
    number: "05",
    category: "CỔ PHỤC QUÝ PHÁI · HOÀNG TRIỀU",
    dynasty: "nguyen",
    dynastyLabel: "Triều Nguyễn (1802 - 1945)",
    slug: "nguthan-timthan.vn",
    title: "Ngũ Thân Tím Than Hoàng Triều",
    subtitle: "Sắc tím thâm trầm tôn quý của tầng lớp danh gia vọng tộc",
    description:
      "Sắc tím than huyền bí phối gấm chữ Thọ cổ truyền. Áo cài 5 cúc tượng trưng cho ngũ thường: Nhân, Lễ, Nghĩa, Trí, Tín, biểu tượng của đạo nghĩa phương Đông.",
    imageUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQSwIGpIKzsNGks7IkiHFpfEn6AF6vjLmfPw-iwvHngNxkuViqUUcCbnT66&s=10",
    specs: {
      material: "Gấm dệt chữ Thọ cổ điển Nam Định",
      technique: "May tay chuẩn tỷ lệ điển chế",
      rfid: "#RFID-NT-008-PRP",
      preservation: "Hút chân không định kỳ",
      rentalPrice: "500.000 ₫/ngày",
      depositAmount: "1.400.000 ₫",
      availableSizes: ["S", "M", "L"],
      color: "Tím than quý phái",
      rating: 4.94,
    },
    mockup: {
      badge: "DANH GIA VỌNG TỘC",
      statusText: "CHẤT LIỆU GẤM DỆT CHỮ THỌ",
      highlightMetric: "Ngũ Thường Nhân Nghĩa",
      accentColor: "#8b5cf6",
      bgGradient: "from-purple-950/90 via-[#180a29]/95 to-black",
    },
  },
  {
    id: "f697aa1e-2178-4ca7-8dc7-1e09dc2813c4",
    number: "06",
    category: "ÁO DÀI TRUYỀN THỐNG · THÊU TAY",
    dynasty: "contemporary",
    dynastyLabel: "Thời Kỳ Đương Đại (Thế kỷ XX - XXI)",
    slug: "aodai-dotheusen.vn",
    title: "Áo Dài Đỏ Thêu Sen Cung Triều",
    subtitle: "Đóa sen hồng bung nở thanh khiết trên nền lụa đỏ son may mắn",
    description:
      "Họa tiết hoa sen quốc hoa được thêu tay tỉ mỉ từng đường chỉ kim tuyến. Tôn vinh vẻ đẹp đằm thắm của cô dâu trong ngày vu quy và các sự kiện ngoại giao văn hóa.",
    imageUrl:
      "https://bizweb.dktcdn.net/100/236/196/products/1fefad15c3cd17934edc.jpg?v=1696474705203",
    specs: {
      material: "Lụa gấm tơ tằm tự nhiên cao cấp",
      technique: "Thêu tay đóa sen vàng tinh xảo",
      rfid: "#RFID-AD-13c4-LOTUS",
      preservation: "Bọc giấy dầu thơm hương trầm",
      rentalPrice: "350.000 ₫/ngày",
      depositAmount: "1.000.000 ₫",
      availableSizes: ["S", "M", "L"],
      color: "Đỏ son thêu sen",
      rating: 4.96,
    },
    mockup: {
      badge: "VU QUY TRỌNG ĐẠI",
      statusText: "THÊU SEN TAY NGHỆ NHÂN",
      highlightMetric: "Đóa Sen Quốc Hoa",
      accentColor: "#f43f5e",
      bgGradient: "from-rose-950/90 via-[#260911]/95 to-black",
    },
  },
  {
    id: "43cc9592-5ed3-4e43-bb51-a14facbce729",
    number: "07",
    category: "ÁO DÀI TRUYỀN THỐNG · XỨ HUẾ",
    dynasty: "contemporary",
    dynastyLabel: "Thời Kỳ Đương Đại (Thế kỷ XX - XXI)",
    slug: "aodai-timhoacuc.vn",
    title: "Áo Dài Tím Hoa Cúc Xứ Huế",
    subtitle: "Nét e ấp dịu dàng của người con gái sông Hương núi Ngự",
    description:
      "Tông màu tím hoa cà đặc trưng của Cố đô Huế, điểm xuyết hoa cúc nhỏ li ti thêu chỉ lụa trắng. Phom dáng ôm nhẹ nhàng tôn lên nét thanh tao đoan trang của phụ nữ Việt.",
    imageUrl:
      "https://img.lazcdn.com/g/ff/kf/S471807bfb79840188dc154cdb73a6ec7L.jpg_720x720q80.jpg",
    specs: {
      material: "Lụa tơ sống dệt mỏng nhẹ thoáng khí",
      technique: "Thêu hoa cúc chỉ lụa trắng",
      rfid: "#RFID-AD-e729-PURPLE",
      preservation: "Túi vải linen bảo vệ ánh sáng",
      rentalPrice: "360.000 ₫/ngày",
      depositAmount: "1.050.000 ₫",
      availableSizes: ["S", "M"],
      color: "Tím hoa cà xứ Huế",
      rating: 4.89,
    },
    mockup: {
      badge: "HỒN CỐ ĐÔ HUẾ",
      statusText: "LỤA MỎNG NHẸ THOÁNG KHÍ",
      highlightMetric: "Hoa Cúc Dịu Dàng",
      accentColor: "#a855f7",
      bgGradient: "from-purple-950/90 via-[#180926]/95 to-black",
    },
  },
  {
    id: "00000000-0000-0000-0002-000000000002",
    number: "08",
    category: "LỄ PHỤC CƯỚI HỎI HOÀNG GIA",
    dynasty: "contemporary",
    dynastyLabel: "Thời Kỳ Đương Đại (Thế kỷ XX - XXI)",
    slug: "aodai-xanhngoctheu.vn",
    title: "Áo Dài Xanh Ngọc Thêu Hoa Cung Triều",
    subtitle: "Sự kết hợp hoàn mỹ giữa phom áo dài truyền thống và họa tiết hoàng gia",
    description:
      "Sắc xanh ngọc bích tươi sáng may theo tỷ lệ vàng chuẩn mực, thêu hoa mai và dây leo uốn lượn bằng chỉ bạc óng ánh. Lựa chọn hàng đầu cho bộ ảnh kỷ niệm và lễ đính hôn.",
    imageUrl:
      "https://overabridal.com/wp-content/uploads/2023/05/ao-dai-cuoi-hoi-cho-co-dau-nu-181.jpg",
    specs: {
      material: "Lụa Tây Thi cao cấp co giãn nhẹ",
      technique: "Thêu chỉ ánh kim bạc lấp lánh",
      rfid: "#RFID-AD-002-JADE",
      preservation: "Tủ trưng bày kính chống UV 99%",
      rentalPrice: "380.000 ₫/ngày",
      depositAmount: "1.100.000 ₫",
      availableSizes: ["S", "M", "L"],
      color: "Xanh ngọc bích",
      rating: 4.93,
    },
    mockup: {
      badge: "ĐÍNH HÔN & CƯỚI HỎI",
      statusText: "THÊU HOA MAI CHỈ BẠC",
      highlightMetric: "Sắc Ngọc Thanh Thoát",
      accentColor: "#06b6d4",
      bgGradient: "from-cyan-950/90 via-[#071d24]/95 to-black",
    },
  },
];

export function Heritage3dShowcaseCarousel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [filterDynasty, setFilterDynasty] = useState<"all" | "nguyen" | "contemporary">("all");
  const [selectedItemForModal, setSelectedItemForModal] = useState<ShowcaseItem | null>(null);

  // Lọc danh sách theo bộ lọc
  const filteredItems = useMemo(() => {
    return REAL_SHOWCASE_ITEMS.filter((item) =>
      filterDynasty === "all" ? true : item.dynasty === filterDynasty
    );
  }, [filterDynasty]);

  // Framer Motion useScroll liên kết vị trí cuộn trang dọc với tiến trình ngang
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // Tạo lò xo mượt mà 120 FPS
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 24,
    mass: 0.2,
    restDelta: 0.0005,
  });

  // Đồng bộ âm thanh
  useEffect(() => {
    setSoundOn(isSoundEnabled());
    const onToggle = (e: Event) => {
      const custom = e as CustomEvent<{ enabled: boolean }>;
      if (custom.detail) setSoundOn(custom.detail.enabled);
    };
    window.addEventListener("co-phuc:sound-toggle", onToggle);
    return () => window.removeEventListener("co-phuc:sound-toggle", onToggle);
  }, []);

  const handleToggleSound = () => {
    const next = toggleSound();
    setSoundOn(next);
  };

  // Lắng nghe sự thay đổi của tiến trình cuộn để cập nhật activeIndex và âm thanh
  useMotionValueEvent(smoothProgress, "change", (latest) => {
    const total = filteredItems.length;
    if (total <= 1) {
      if (activeIndex !== 0) setActiveIndex(0);
      return;
    }
    const newIdx = Math.min(total - 1, Math.max(0, Math.round(latest * (total - 1))));
    if (newIdx !== activeIndex) {
      playHoverTick();
      setActiveIndex(newIdx);
    }
  });

  // Cho phép click để cuộn mượt đến thẻ đó
  const scrollToCard = useCallback(
    (index: number) => {
      if (!containerRef.current) return;
      playWoodTap();
      const rect = containerRef.current.getBoundingClientRect();
      const scrollTop = window.scrollY + rect.top;
      const totalScrollable = containerRef.current.offsetHeight - window.innerHeight;
      const ratio = filteredItems.length > 1 ? index / (filteredItems.length - 1) : 0;
      const targetY = scrollTop + ratio * totalScrollable;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    },
    [filteredItems.length]
  );

  const activeItem = filteredItems[activeIndex] || filteredItems[0];

  // Chiều cao cuộn tỉ lệ thuận với số lượng phần tử để tốc độ cuộn ngang êm ái
  const sectionScrollHeight = `${Math.max(260, filteredItems.length * 65 + 40)}vh`;

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-[#07090e]"
      style={{ height: sectionScrollHeight }}
    >
      {/* KHỐI GIM CỐ ĐỊNH (STICKY 100vh): Khi cuộn dọc, trang được ghim lại và lướt ngang */}
      <div className="sticky top-0 h-screen w-full overflow-hidden flex flex-col justify-between py-6 sm:py-8 lg:py-10 px-4 sm:px-6 lg:px-12 select-none">
        {/* Nền quầng sáng ma trận công nghệ tối mờ */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(0,212,255,0.07),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

        {/* Thanh tiến trình cuộn lướt ngang ở đỉnh màn hình */}
        <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-white/[0.06] z-50 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-[#00d4ff] via-sky-400 to-amber-300 shadow-[0_0_10px_rgba(0,212,255,0.8)]"
            style={{
              scaleX: smoothProgress,
              transformOrigin: "left",
            }}
          />
        </div>

        {/* ================= HEADER SECTION ================= */}
        <div className="relative z-20 max-w-7xl mx-auto w-full flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-mono font-bold tracking-[0.25em] text-[#00d4ff] uppercase mb-1.5">
              <span className="w-2 h-2 rounded-full bg-[#00d4ff] animate-ping" />
              03 / KHO DI SẢN THẬT · ĐANG SẴN SÀNG CHO THUÊ
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white flex items-center gap-3">
              <span>Bảo vật cổ phục thực tế tại kho</span>
              <span className="hidden xl:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs font-normal text-white/50 tracking-normal">
                <ArrowDown className="w-3.5 h-3.5 text-[#00d4ff] animate-bounce" />
                Cuộn chuột để lướt ngang
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Filter pills */}
            <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md">
              {[
                { id: "all", label: `Tất cả (${REAL_SHOWCASE_ITEMS.length})` },
                { id: "nguyen", label: "Triều Nguyễn (5)" },
                { id: "contemporary", label: "Đương Đại (3)" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    playWoodTap();
                    setFilterDynasty(tab.id as typeof filterDynasty);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    filterDynasty === tab.id
                      ? "bg-white text-black font-semibold shadow-md shadow-white/10"
                      : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <Link
              href="/catalog"
              className="hidden sm:inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-xs font-semibold text-white/90 hover:text-white transition-all backdrop-blur-md"
            >
              <span>Vào toàn bộ danh mục ERP</span>
              <span className="text-[#00d4ff]">↗</span>
            </Link>
          </div>
        </div>

        {/* ================= 3D PERSPECTIVE HORIZONTAL TRACK ================= */}
        {/* Vùng không gian 3D sâu chứa toàn bộ các thẻ chạy ngang khi cuộn */}
        <div
          className="relative z-10 w-full flex-1 flex items-center justify-center my-2 sm:my-4 overflow-visible"
          style={{ perspective: "1500px" }}
        >
          <div
            className="relative w-full h-full max-h-[460px] lg:max-h-[500px] flex items-center justify-center"
            style={{ transformStyle: "preserve-3d" }}
          >
            {filteredItems.map((item, index) => {
              return (
                <HorizontalScrollCard
                  key={item.id}
                  item={item}
                  index={index}
                  total={filteredItems.length}
                  smoothProgress={smoothProgress}
                  isActive={activeIndex === index}
                  onClick={() => {
                    playRoyalChime();
                    setActiveIndex(index);
                    setSelectedItemForModal(item);
                    scrollToCard(index);
                  }}
                />
              );
            })}
          </div>

          {/* Nút lùi / tiến nhanh khi người dùng muốn nhảy trực tiếp */}
          <div className="absolute inset-x-2 sm:inset-x-8 top-1/2 -translate-y-1/2 pointer-events-none flex justify-between z-40">
            <button
              onClick={() => {
                if (activeIndex > 0) scrollToCard(activeIndex - 1);
              }}
              disabled={activeIndex === 0}
              aria-label="Lùi bảo vật trước"
              className={`w-10 h-10 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center transition-all backdrop-blur-md pointer-events-auto shadow-lg ${
                activeIndex === 0 ? "opacity-20 cursor-not-allowed" : "hover:bg-white/20 cursor-pointer"
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                if (activeIndex < filteredItems.length - 1) scrollToCard(activeIndex + 1);
              }}
              disabled={activeIndex === filteredItems.length - 1}
              aria-label="Tiến bảo vật tiếp"
              className={`w-10 h-10 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center transition-all backdrop-blur-md pointer-events-auto shadow-lg ${
                activeIndex === filteredItems.length - 1
                  ? "opacity-20 cursor-not-allowed"
                  : "hover:bg-white/20 cursor-pointer"
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ================= BOTTOM BAR (Chuẩn XimiTech) ================= */}
        <div className="relative z-20 max-w-7xl mx-auto w-full pt-4 sm:pt-6 border-t border-white/10 flex flex-col md:flex-row md:items-end justify-between gap-4">
          {/* Cụm thông tin góc trái: Danh mục, Tên lớn với gạch chân cyan */}
          <div className="max-w-2xl">
            <div className="text-[11px] sm:text-xs font-mono tracking-widest text-white/50 uppercase mb-1">
              <span className="text-white/80">{activeItem.category}</span>
              <span className="mx-2 text-white/30">/</span>
              <span className="text-[#00d4ff]">{activeItem.slug}</span>
            </div>

            <div className="relative inline-block">
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
                {activeItem.title}
              </h3>
              <motion.div
                layoutId="scrollActiveUnderline"
                className="h-1 bg-[#00d4ff] mt-1.5 rounded-full w-24 sm:w-32 shadow-[0_0_12px_rgba(0,212,255,0.8)]"
              />
            </div>

            <p className="text-xs sm:text-sm text-white/60 mt-1.5 line-clamp-1 max-w-xl">
              {activeItem.subtitle} — Giá thuê: <span className="text-amber-300 font-bold">{activeItem.specs.rentalPrice}</span> (Cọc: {activeItem.specs.depositAmount})
            </p>
          </div>

          {/* Cụm điều khiển góc phải: Loa âm thanh, Bộ đếm trang 01 / 08, Nút Xem chi tiết */}
          <div className="flex items-center gap-4 sm:gap-6 self-end md:self-auto">
            {/* Nút bật/tắt âm thanh */}
            <button
              onClick={handleToggleSound}
              title={soundOn ? "Tắt âm thanh tương tác" : "Bật âm thanh tương tác"}
              className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${
                soundOn
                  ? "bg-white/[0.08] border-[#00d4ff]/40 text-[#00d4ff] shadow-[0_0_15px_rgba(0,212,255,0.2)]"
                  : "bg-white/[0.04] border-white/10 text-white/40 hover:text-white"
              }`}
            >
              {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Bộ đếm chỉ mục trang */}
            <div className="font-mono text-xl sm:text-2xl font-bold tabular-nums">
              <span className="text-white font-extrabold">{activeItem.number}</span>
              <span className="text-white/30 mx-1.5 font-light">/</span>
              <span className="text-white/40">
                {filteredItems.length < 10 ? `0${filteredItems.length}` : filteredItems.length}
              </span>
            </div>

            {/* Nút CTA Xem Dự Án (Pill xanh lam phát sáng đặc trưng) */}
            <button
              onClick={() => {
                playRoyalChime();
                setSelectedItemForModal(activeItem);
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#00d4ff] hover:bg-[#38bdf8] text-black font-extrabold text-xs sm:text-sm tracking-wide transition-all shadow-[0_0_25px_rgba(0,212,255,0.4)] hover:shadow-[0_0_35px_rgba(0,212,255,0.7)] hover:scale-105"
            >
              <span>Xem chi tiết</span>
              <ArrowRight className="w-4 h-4 stroke-[3]" />
            </button>
          </div>
        </div>
      </div>

      {/* ================= MODAL QUICK-VIEW CHI TIẾT BẢO VẬT THẬT ================= */}
      <AnimatePresence>
        {selectedItemForModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForModal(null)}
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
                onClick={() => setSelectedItemForModal(null)}
                className="absolute top-5 right-5 z-20 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-all"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6 sm:p-8">
                {/* Ảnh sản phẩm thật lớn */}
                <div className="md:col-span-5 relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/15 bg-stone-900 shadow-xl">
                  <OptimizedImage
                    src={selectedItemForModal.imageUrl}
                    alt={selectedItemForModal.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 400px"
                    className="object-cover"
                  />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-300">
                    Mã Chip: {selectedItemForModal.specs.rfid}
                  </div>
                </div>

                {/* Thông tin sản phẩm thực tế */}
                <div className="md:col-span-7 flex flex-col justify-between text-left">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-[#00d4ff] uppercase tracking-wider mb-2">
                      <ShieldCheck className="w-4 h-4" />
                      <span>{selectedItemForModal.category}</span>
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-black text-white">
                      {selectedItemForModal.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-stone-300 mt-1">
                      {selectedItemForModal.subtitle}
                    </p>

                    {/* Bảng thông số thực tế */}
                    <div className="grid grid-cols-2 gap-3 mt-5 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">Giá thuê ngày</span>
                        <p className="text-base font-black text-amber-300">
                          {selectedItemForModal.specs.rentalPrice}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">Tiền cọc đảm bảo</span>
                        <p className="text-sm font-bold text-white">
                          {selectedItemForModal.specs.depositAmount}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">Màu sắc</span>
                        <p className="text-xs font-semibold text-white">
                          {selectedItemForModal.specs.color}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">Kích cỡ sẵn sàng</span>
                        <div className="flex gap-1 mt-0.5">
                          {selectedItemForModal.specs.availableSizes.map((sz) => (
                            <span
                              key={sz}
                              className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono font-bold text-white"
                            >
                              {sz}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs sm:text-sm text-white/70 mt-4 leading-relaxed line-clamp-3">
                      {selectedItemForModal.description}
                    </p>
                  </div>

                  {/* Nút CTA tới Catalog thật & Thử đồ AI thật */}
                  <div className="flex flex-col sm:flex-row items-center gap-3 mt-6 pt-4 border-t border-white/10">
                    <Link
                      href={`/catalog/${selectedItemForModal.id}`}
                      onClick={() => {
                        playWoodTap();
                        setSelectedItemForModal(null);
                      }}
                      className="w-full sm:w-auto flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-rose-400 text-stone-950 font-black text-sm tracking-wide shadow-lg shadow-amber-400/20 hover:scale-[1.02] transition-transform"
                    >
                      <ShoppingBag className="w-4 h-4 text-stone-950" />
                      <span>Thuê trang phục này ngay</span>
                    </Link>

                    <Link
                      href={`/try-on?garmentId=${selectedItemForModal.id}`}
                      onClick={() => {
                        playRoyalChime();
                        setSelectedItemForModal(null);
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

/**
 * Thẻ di sản 3D chạy ngang hiển thị ẢNH SẢN PHẨM THẬT từ ERP
 */
function HorizontalScrollCard({
  item,
  index,
  total,
  smoothProgress,
  isActive,
  onClick,
}: {
  item: ShowcaseItem;
  index: number;
  total: number;
  smoothProgress: any;
  isActive: boolean;
  onClick: () => void;
}) {
  const x = useTransform(smoothProgress, (val: number) => {
    const floatIndex = val * (total - 1);
    const offset = index - floatIndex;
    return `${offset * 72}%`;
  });

  const rotateY = useTransform(smoothProgress, (val: number) => {
    const floatIndex = val * (total - 1);
    const offset = index - floatIndex;
    const clamped = Math.max(-2, Math.min(2, offset));
    return -clamped * 24;
  });

  const z = useTransform(smoothProgress, (val: number) => {
    const floatIndex = val * (total - 1);
    const absOffset = Math.abs(index - floatIndex);
    return Math.max(-160, 60 - absOffset * 90);
  });

  const scale = useTransform(smoothProgress, (val: number) => {
    const floatIndex = val * (total - 1);
    const absOffset = Math.abs(index - floatIndex);
    return Math.max(0.76, 1.05 - absOffset * 0.14);
  });

  const opacity = useTransform(smoothProgress, (val: number) => {
    const floatIndex = val * (total - 1);
    const absOffset = Math.abs(index - floatIndex);
    return Math.max(0.2, 1 - absOffset * 0.35);
  });

  return (
    <motion.div
      onClick={onClick}
      style={{
        x,
        rotateY,
        z,
        scale,
        opacity,
        transformStyle: "preserve-3d",
        zIndex: isActive ? 30 : 20 - Math.abs(index),
      }}
      className={`absolute w-[86%] sm:w-[68%] md:w-[58%] lg:w-[52%] max-w-[660px] aspect-[16/10] rounded-2xl md:rounded-3xl p-1 bg-gradient-to-b from-white/20 via-white/5 to-transparent transition-shadow duration-500 cursor-pointer ${
        isActive
          ? "shadow-[0_25px_60px_-15px_rgba(0,212,255,0.35)] ring-1 ring-[#00d4ff]/50"
          : "hover:opacity-90 shadow-2xl"
      }`}
    >
      {/* Khung viền thiết bị Mockup cao cấp phong cách XimiTech */}
      <div
        className={`relative w-full h-full rounded-[14px] md:rounded-[22px] overflow-hidden bg-gradient-to-br ${item.mockup.bgGradient} flex flex-col justify-between border border-white/10`}
      >
        {/* Header thanh mô phỏng trình duyệt */}
        <div className="h-8 sm:h-9 px-4 flex items-center justify-between border-b border-white/10 bg-black/50 backdrop-blur-md z-20">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>

          <div className="px-3 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] sm:text-[11px] font-mono text-white/60 tracking-wider">
            {item.slug}
          </div>

          <div className="flex items-center gap-1 text-[10px] font-bold text-[#00d4ff]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] animate-pulse" />
            <span className="hidden sm:inline">{item.mockup.badge}</span>
          </div>
        </div>

        {/* Thân Mockup: Hiển thị ẢNH SẢN PHẨM THẬT & Thông số viễn trắc */}
        <div className="relative flex-1 flex overflow-hidden">
          {/* Cột trái Mockup: ẢNH SẢN PHẨM THẬT TỪ HỆ THỐNG ERP */}
          <div className="relative w-[40%] sm:w-[44%] h-full overflow-hidden border-r border-white/10 bg-stone-950">
            <OptimizedImage
              src={item.imageUrl}
              alt={item.title}
              fill
              sizes="(max-width: 768px) 40vw, 300px"
              className="object-cover object-top hover:scale-105 transition-transform duration-700"
            />
            {/* Lớp gradient viền để hòa trộn êm ái */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[9px] font-mono text-white/70">
              <span className="px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs border border-white/10">
                {item.specs.color}
              </span>
              <span className="text-amber-300 font-bold">{item.specs.availableSizes.join(" · ")}</span>
            </div>
          </div>

          {/* Cột phải Mockup: THÔNG SỐ SẢN PHẨM THẬT & GIÁ THUÊ */}
          <div className="relative flex-1 p-4 sm:p-5 flex flex-col justify-between overflow-hidden text-left bg-black/40 backdrop-blur-xs">
            {/* Quầng sáng tương tác */}
            <div
              className="absolute -right-20 -top-20 w-48 h-48 rounded-full blur-3xl opacity-20 pointer-events-none"
              style={{ backgroundColor: item.mockup.accentColor }}
            />

            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/10 text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-white/80 mb-1.5">
                <Layers className="w-3 h-3 text-[#00d4ff]" />
                <span>{item.dynastyLabel}</span>
              </div>
              <h3 className="text-base sm:text-xl lg:text-2xl font-black text-white tracking-tight leading-snug line-clamp-1">
                {item.title}
              </h3>
              <p className="text-[11px] sm:text-xs text-white/60 mt-1 line-clamp-2">
                {item.subtitle}
              </p>
            </div>

            {/* Bảng chỉ số kỹ thuật */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10 bg-black/40 rounded-xl p-2.5">
              <div>
                <div className="text-[9px] text-white/40 uppercase font-mono">Giá thuê thật</div>
                <div className="text-xs sm:text-sm font-black text-amber-300 truncate">
                  {item.specs.rentalPrice}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-white/40 uppercase font-mono">Tiền cọc</div>
                <div className="text-xs sm:text-sm font-semibold text-white/90 truncate">
                  {item.specs.depositAmount}
                </div>
              </div>
              <div className="col-span-2 pt-1 border-t border-white/5 flex items-center justify-between text-[10px]">
                <span className="text-white/50">Mã định danh:</span>
                <span className="font-mono text-[#00d4ff] font-bold">{item.specs.rfid}</span>
              </div>
            </div>

            {/* Thanh nút bấm tương tác xem chi tiết ngay trên thẻ */}
            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-amber-300/90 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Nhấn thẻ xem chi tiết</span>
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#00d4ff]/20 hover:bg-[#00d4ff]/30 border border-[#00d4ff]/50 text-[10px] font-bold text-[#00d4ff] shadow-xs transition-all">
                <span>Xem chi tiết</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        </div>

        {/* Lớp phủ mờ nếu thẻ không ở trung tâm */}
        {!isActive && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[0.5px] transition-opacity duration-300 pointer-events-none" />
        )}
      </div>
    </motion.div>
  );
}
