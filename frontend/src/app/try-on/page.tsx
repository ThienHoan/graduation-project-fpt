"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { CameraCapture } from "@/components/try-on/camera-capture";
import { ImageUpload } from "@/components/try-on/image-upload";
import { SimilarGarments } from "@/components/try-on/similar-garments";
import { TryonResultViewer } from "@/components/try-on/tryon-result-viewer";
import { RealtimeTryOnModal } from "@/components/try-on/realtime-tryon-modal";
import { HeritageMascot } from "@/components/mascot";
import { AnimatedCamera, AnimatedSparkles, AnimatedShield, AnimatedCheckCircle } from "@/components/common/animated-icons";
import {
  Sparkles,
  Zap,
  Smile,
  User,
  Upload,
  Camera,
  AlertCircle,
  RotateCcw,
  Clock,
  ShieldCheck,
  CheckCircle2,
  Image as ImageIcon,
  ChevronDown,
  Maximize2,
  EyeOff,
  X,
  History,
  Ruler,
  Shirt,
  BookOpen,
} from "lucide-react";
import {
  getGarmentsGrouped,
  getMyMeasurements,
  getTryonHistory,
  getTryonQuota,
  getTryonStatus,
  hideTryonHistoryItem,
  submitTryon,
  type CustomerMeasurement,
  type GarmentGrouped,
  type TryonHistoryItem,
  type TryonMode,
  type TryonQuota,
  type TryonSource,
} from "@/lib/api";
import { readStoredAccessToken } from "@/lib/auth";

type ViewState = "setup" | "processing" | "result";

function computeRecommendedSize(
  sizes: GarmentGrouped["sizes"],
  customer: CustomerMeasurement | null,
): string | null {
  if (!customer || !sizes || sizes.length === 0) return null;

  let bestSizeId: string | null = null;
  let bestScore = -Infinity;

  for (const s of sizes) {
    let score = 100;
    const m = s.measurements;
    if (m?.bustCm && customer.bustCm) {
      const diff = Number(m.bustCm) - Number(customer.bustCm);
      // Áo cổ phục thường cần độ cử động ngực khoảng 2 - 5cm
      if (diff >= 2 && diff <= 5) score += 25;
      else if (diff >= 0 && diff < 2) score += 10;
      else if (diff < 0) score -= Math.abs(diff) * 15; // Quá chật ngực
      else score -= (diff - 5) * 5; // Rộng ngực
    }

    if (m?.waistCm && customer.waistCm) {
      const diff = Number(m.waistCm) - Number(customer.waistCm);
      // Cử động eo khoảng 1 - 4cm
      if (diff >= 1 && diff <= 4) score += 25;
      else if (diff >= 0 && diff < 1) score += 10;
      else if (diff < 0) score -= Math.abs(diff) * 15;
      else score -= (diff - 4) * 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestSizeId = s.garmentSizeId;
    }
  }

  return bestSizeId;
}

const AO_DAI_HISTORICAL_FACTS = [
  {
    title: "Khởi nguồn từ Áo Ngũ Thân (Năm 1744)",
    tag: "Khởi nguồn lịch sử",
    content: "Tiền thân của chiếc áo dài Việt Nam chính là áo ngũ thân lập lĩnh, được định hình chính thức bởi sắc dụ cải cách trang phục của Chúa Nguyễn Phúc Khoát vào năm 1744 tại Đàng Trong nhằm khẳng định bản sắc văn hóa độc lập và phong nhã của dân tộc.",
  },
  {
    title: "Ý nghĩa triết lý 'Tứ thân phụ mẫu'",
    tag: "Đạo hiếu sâu sắc",
    content: "Năm thân của áo ngũ thân mang triết lý nhân sinh: 4 thân ngoài tượng trưng cho 'tứ thân phụ mẫu' (cha mẹ đẻ và cha mẹ chồng/vợ), thân thứ năm ẩn bên trong tượng trưng cho người mặc. Cấu trúc này nhắc nhở con cháu luôn được gia đình bao bọc và trọn lòng hiếu kính.",
  },
  {
    title: "Năm hạt ngọc Ngũ Thường",
    tag: "Cốt cách người xưa",
    content: "Hàng cúc 5 khuy cài chéo truyền thống tượng trưng cho đạo Ngũ Thường của người phương Đông: Nhân - Lễ - Nghĩa - Trí - Tín. Mỗi khi cài khuy áo, người xưa tự nhắc nhở giữ trọn phẩm hạnh, phong thái đĩnh đạc và chuẩn mực đoan chính.",
  },
  {
    title: "Dấu ấn canh tân Áo dài Le Mur (1930)",
    tag: "Bước ngoặt hiện đại",
    content: "Năm 1930, họa sĩ Cát Tường (Le Mur) cùng nhóm Tự Lực Văn Đoàn đã sáng tạo cải biến áo ngũ thân thành áo dài tân thời ôm sát dáng người thanh tân, mở ra thời kỳ rực rỡ của tà áo dài Việt Nam vươn tầm quốc tế.",
  },
  {
    title: "Áo Nhật Bình - Tuyệt tác Hoàng triều",
    tag: "Di sản cung đình",
    content: "Áo Nhật Bình là thường phục cao quý của Hoàng thái hậu, Hoàng hậu và Công chúa triều Nguyễn. Cổ áo hình chữ nhật viền thêu chỉ vàng lộng lẫy cùng dải ngũ sắc tượng trưng cho vẻ đẹp quyền quý, đoan trang bậc nhất cung đình Huế.",
  },
  {
    title: "Áo Tấc - Lễ phục tôn nghiêm",
    tag: "Lễ nhạc truyền thống",
    content: "Áo tấc (áo ngũ thân tay thụng) là bộ lễ phục trang trọng nhất thời xưa trong các dịp tế tự, hôn lễ và yết bái. Phần tay áo thụng rộng một tấc (40cm), hai tay chắp trang nghiêm trước ngực thể hiện sự tôn kính trời đất, tổ tiên.",
  },
  {
    title: "Hồn cốt lụa tơ tằm Vạn Phúc & Hà Đông",
    tag: "Tinh hoa làng nghề",
    content: "Cổ phục Việt Nam gắn liền với các làng nghề dệt lụa tơ tằm thủ công nghìn năm tuổi: mùa hè mặc vào mát rượi làn da, mùa đông ấm áp, mềm rủ óng ả tự nhiên và mang lại cảm giác dễ chịu tuyệt đối cho người mặc.",
  },
  {
    title: "Vẻ đẹp kín đáo mà thanh thoát kiêu sa",
    tag: "Niềm tự hào dân tộc",
    content: "Áo dài Việt Nam được bạn bè quốc tế ca ngợi là một trong những trang phục truyền thống tao nhã nhất: trang nhã, kín đáo từ cổ đến chân nhưng vạt tà xẻ cao uyển chuyển lại tôn vinh từng bước đi nhẹ nhàng, duyên dáng của người Việt.",
  },
];

function TryOnInner() {
  const searchParams = useSearchParams();
  const preselectedGarmentSizeId = searchParams.get("garmentSizeId") ?? "";

  // Garment selection
  const [groups, setGroups] = useState<GarmentGrouped[]>([]);
  const [selectedGroupIdx, setSelectedGroupIdx] = useState(0);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);

  // Mode & source
  const [mode, setMode] = useState<TryonMode>("face_swap");
  const [imageSource, setImageSource] = useState<TryonSource>("upload");

  // Image
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // States
  const [viewState, setViewState] = useState<ViewState>("setup");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isCachedResult, setIsCachedResult] = useState(false);
  const [queuePosition, setQueuePosition] = useState(0);
  const [processingStatusText, setProcessingStatusText] = useState("Đang gửi yêu cầu...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [consent, setConsent] = useState(true);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [historyItems, setHistoryItems] = useState<TryonHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [customerMeasurements, setCustomerMeasurements] = useState<CustomerMeasurement | null>(null);
  const [quota, setQuota] = useState<TryonQuota | null>(null);
  const [factIndex, setFactIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(15);
  const [isRealtimeModalOpen, setIsRealtimeModalOpen] = useState(false);

  async function loadQuota() {
    if (!readStoredAccessToken()) {
      setQuota(null);
      return;
    }
    const res = await getTryonQuota();
    if (res.success && res.data) {
      setQuota(res.data);
    }
  }

  async function loadHistory() {
    if (!readStoredAccessToken()) {
      setHistoryItems([]);
      return;
    }

    setIsHistoryLoading(true);
    const res = await getTryonHistory();
    if (res.success && res.data) {
      setHistoryItems(res.data);
    }
    setIsHistoryLoading(false);
  }

  // Timer giả lập tiến trình dệt sắc phục và luân phiên các mẩu chuyện văn hóa
  useEffect(() => {
    if (viewState !== "processing") {
      setProgressPercent(15);
      return;
    }

    const progressTimer = setInterval(() => {
      setProgressPercent((prev) => {
        if (prev >= 92) return 92;
        const inc = Math.floor(Math.random() * 4) + 2;
        return Math.min(prev + inc, 92);
      });
    }, 600);

    const factTimer = setInterval(() => {
      setFactIndex((prev) => (prev + 1) % AO_DAI_HISTORICAL_FACTS.length);
    }, 4500);

    return () => {
      clearInterval(progressTimer);
      clearInterval(factTimer);
    };
  }, [viewState]);

  // Load garments + pre-select from URL
  useEffect(() => {
    getGarmentsGrouped().then((res) => {
      if (res.success && res.data) {
        setGroups(res.data);

        // Tìm group + size từ URL param
        if (preselectedGarmentSizeId) {
          for (let i = 0; i < res.data.length; i++) {
            const g = res.data[i];
            const found = g.sizes.find((s) => s.garmentSizeId === preselectedGarmentSizeId);
            if (found) {
              setSelectedGroupIdx(i);
              setSelectedSizeId(preselectedGarmentSizeId);
              return;
            }
          }
        }

        // Fallback: chọn món đầu tiên
        if (res.data.length > 0 && res.data[0].sizes.length > 0) {
          setSelectedSizeId(res.data[0].sizes[0].garmentSizeId);
        }
      }
    });
  }, [preselectedGarmentSizeId]);

  useEffect(() => {
    const token = readStoredAccessToken();
    setHasAccessToken(Boolean(token));
    if (token) {
      void loadHistory();
      void loadQuota();
      void getMyMeasurements().then((res) => {
        if (res.success && res.data) {
          setCustomerMeasurements(res.data);
        }
      });
    }
  }, []);

  const selectedGroup = groups[selectedGroupIdx] ?? null;

  // Gợi ý size chuẩn dựa theo số đo khách hàng
  const recommendedSizeId = useMemo(() => {
    return computeRecommendedSize(selectedGroup?.sizes ?? [], customerMeasurements);
  }, [selectedGroup, customerMeasurements]);

  // Tự động chuyển sang size vừa nhất nếu khách có số đo và chưa chỉ định từ URL
  useEffect(() => {
    if (recommendedSizeId && !preselectedGarmentSizeId) {
      setSelectedSizeId(recommendedSizeId);
    }
  }, [recommendedSizeId, preselectedGarmentSizeId]);

  const selectedSize =
    selectedGroup?.sizes.find((s) => s.garmentSizeId === selectedSizeId) ??
    selectedGroup?.sizes[0] ??
    null;

  // Sizing comparison metrics for currently selected size
  const selectedSizeBustDiff =
    selectedSize?.measurements?.bustCm && customerMeasurements?.bustCm
      ? Number(selectedSize.measurements.bustCm) - Number(customerMeasurements.bustCm)
      : null;

  const selectedSizeWaistDiff =
    selectedSize?.measurements?.waistCm && customerMeasurements?.waistCm
      ? Number(selectedSize.measurements.waistCm) - Number(customerMeasurements.waistCm)
      : null;

  const selectedSizeDrapeClearance =
    selectedSize?.measurements?.lengthCm && customerMeasurements?.heightCm
      ? Math.max(0, Math.round(Number(customerMeasurements.heightCm) - 25 - Number(selectedSize.measurements.lengthCm)))
      : null;

  const canSubmit = Boolean(selectedSizeId && imageBase64 && consent);

  function handleImageData(base64: string) {
    setImageBase64(base64);
    setViewState("setup");
    setErrorMsg(null);
  }

  async function handleTryOn() {
    if (!canSubmit || !imageBase64 || !selectedSizeId) return;
    if (!readStoredAccessToken()) {
      setErrorMsg("Vui lòng đăng nhập để sử dụng tính năng thử đồ AI và lưu lịch sử.");
      return;
    }

    setViewState("processing");
    setErrorMsg(null);
    setQueuePosition(0);
    setIsCachedResult(false);
    setProcessingStatusText("Đang kiểm tra yêu cầu và dữ liệu ảnh...");

    const res = await submitTryon({
      garmentSizeId: selectedSizeId,
      mode,
      imageBase64,
      source: imageSource,
    });

    if (!res.success || !res.data) {
      setErrorMsg(res.message ?? "Không thể gửi yêu cầu thử đồ. Vui lòng thử lại.");
      setViewState("setup");
      return;
    }

    // Trường hợp 1: Cache HIT -> Hoàn tất ngay lập tức
    if (res.data.status === "completed" && res.data.resultImageUrl) {
      setResultImage(res.data.resultImageUrl);
      setIsCachedResult(Boolean(res.data.isCached));
      setViewState("result");
      void loadHistory();
      void loadQuota();
      return;
    }

    // Trường hợp 2: Cache MISS -> Vào hàng đợi và Polling
    const requestId = res.data.id;
    setQueuePosition(res.data.queuePosition ?? 1);
    setProcessingStatusText("Đang trong hàng đợi xử lý...");

    const pollInterval = window.setInterval(async () => {
      const statusRes = await getTryonStatus(requestId);
      if (!statusRes.success || !statusRes.data) return;

      const current = statusRes.data;
      if (current.status === "pending") {
        setQueuePosition(current.queuePosition);
        setProcessingStatusText(
          current.queuePosition > 1
            ? `Đang xếp hàng chờ xử lý (Vị trí #${current.queuePosition})...`
            : "Đang chuẩn bị khởi tạo AI...",
        );
      } else if (current.status === "processing") {
        setProcessingStatusText(
          mode === "face_swap"
            ? "AI đang ghép khuôn mặt bạn vào người mẫu (khoảng 10-15 giây)..."
            : "AI đang dựng toàn thân với trang phục (khoảng 15-20 giây)...",
        );
      } else if (current.status === "completed" && current.resultImageUrl) {
        window.clearInterval(pollInterval);
        setProgressPercent(100);
        setResultImage(current.resultImageUrl);
        setIsCachedResult(Boolean(current.isCached));
        setViewState("result");
        void loadHistory();
        void loadQuota();
      } else if (current.status === "failed") {
        window.clearInterval(pollInterval);
        setErrorMsg(current.errorMessage ?? "Quá trình tạo ảnh thất bại. Vui lòng thử lại.");
        setViewState("setup");
      }
    }, 2000);

    // Timeout an toàn sau 180s
    window.setTimeout(() => {
      window.clearInterval(pollInterval);
    }, 180000);
  }

  async function handleHideHistoryItem(id: string) {
    const res = await hideTryonHistoryItem(id);
    if (res.success) {
      setHistoryItems((items) => items.filter((item) => item.id !== id));
    } else {
      setErrorMsg(res.message ?? "Không thể ẩn ảnh này khỏi lịch sử.");
    }
  }

  function handleReset() {
    setViewState("setup");
    setImageBase64(null);
    setResultImage(null);
    setIsCachedResult(false);
    setErrorMsg(null);
    void loadQuota();
  }

  function handleSelectSimilarGarment(garmentId: string) {
    const idx = groups.findIndex((g) => g.garmentId === garmentId);
    if (idx !== -1) {
      setSelectedGroupIdx(idx);
      const firstSize = groups[idx]?.sizes[0]?.garmentSizeId ?? null;
      setSelectedSizeId(firstSize);
      window.scrollTo({ top: 100, behavior: "smooth" });
    }
  }

  function handleSelectGarmentByName(garmentName: string) {
    const idx = groups.findIndex((g) => g.name.toLowerCase().includes(garmentName.toLowerCase()));
    if (idx !== -1) {
      setSelectedGroupIdx(idx);
      const firstSize = groups[idx]?.sizes[0]?.garmentSizeId ?? null;
      setSelectedSizeId(firstSize);
      window.scrollTo({ top: 100, behavior: "smooth" });
    }
  }

  return (
    <div className="min-h-screen bg-mist text-ink">
      <CustomerNavbar active="tryon" />

      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-24 pt-24 sm:px-6 lg:px-8 lg:pt-28">
        {/* Header Banner */}
        <section className="relative mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-sand bg-white/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-lotus backdrop-blur-sm shadow-xs">
            <Sparkles className="h-3.5 w-3.5 text-antique" />
            <span>Phòng Thử Đồ AI Trực Tuyến</span>
          </div>
          <h1 className="mt-4 font-display text-4xl text-ink sm:text-5xl lg:text-6xl font-semibold">
            Trải Nghiệm <span className="text-lotus">Thử Đồ AI</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-stone-600 sm:text-lg">
            Chụp hoặc tải ảnh chân dung để công nghệ AI hòa quyện dung mạo của bạn vào từng tà áo cổ phục Việt Nam.
            Trải nghiệm chân thực, chuẩn dáng sắc sảo trước khi quyết định đặt thuê.
          </p>

          {/* Daily Quota Badge */}
          {hasAccessToken && quota && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold shadow-xs transition ${quota.remaining > 1
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : quota.remaining === 1
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-rose-300 bg-rose-50 text-rose-800"
                  }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${quota.remaining > 0 ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                    }`}
                />
                <span>Hôm nay bạn còn:</span>
                <span className={`font-bold ${quota.remaining > 0 ? "text-lotus" : "text-rose-600"}`}>
                  {quota.remaining}/{quota.limit} lượt thử đồ AI
                </span>
                <span className="text-[10px] text-stone-400 font-normal">· Làm mới sau 00:00</span>
              </div>
            </div>
          )}
        </section>

        {/* Realtime Live Virtual Try-On Banner */}
        <section className="relative overflow-hidden rounded-3xl border border-sand bg-gradient-to-br from-white via-parchment/60 to-amber-50/40 p-6 sm:p-8 shadow-sm">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 h-48 w-48 rounded-full bg-lotus/5 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-lotus/10 px-3 py-1 text-xs font-bold text-lotus ring-1 ring-lotus/20">
                <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                <span>MỚI • CÔNG NGHỆ DECART WEBRTC</span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
                Gương Soi Thử Đồ Trực Tiếp Qua Webcam (Real-time Live)
              </h2>
              <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
                Không cần tải ảnh hay chờ đợi tạo ảnh tĩnh. Bật webcam để AI khoác ngay tà áo cổ phục lên cơ thể bạn theo thời gian thực (Gương soi Flash 15s), tặng ngay Voucher giảm 10% khi hoàn tất trải nghiệm!
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                type="button"
                onClick={() => setIsRealtimeModalOpen(true)}
                className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-lotus px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-lotus/25 hover:bg-lotus/90 transition transform active:scale-95"
              >
                <Camera className="h-4 w-4" />
                <span>Bật Gương Soi Live</span>
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          {/* LEFT: Configuration Steps */}
          <div className="space-y-6">
            {/* 1. Garment selector */}
            <section className="rounded-2xl border border-sand bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-ink">1. Chọn cổ phục</h2>
                <span className="text-xs font-semibold uppercase tracking-wider text-lotus">Bước 1</span>
              </div>

              {groups.length > 0 ? (
                <div className="space-y-4">
                  <div className="relative">
                    <select
                      value={selectedGroupIdx}
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        setSelectedGroupIdx(idx);
                        const firstSize = groups[idx]?.sizes[0]?.garmentSizeId ?? null;
                        setSelectedSizeId(firstSize);
                      }}
                      className="w-full appearance-none rounded-xl border border-sand bg-white px-4 py-3 text-sm font-medium text-ink outline-none transition focus:border-lotus focus:ring-1 focus:ring-lotus"
                    >
                      {groups.map((g, i) => (
                        <option key={g.slug} value={i}>{g.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  </div>

                  {/* Size selection & Fit Indicator */}
                  {selectedGroup && selectedGroup.sizes.length > 0 && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                            <Shirt className="h-3.5 w-3.5 text-lotus" />
                            Kích thước áo:
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {selectedGroup.sizes.map((s) => {
                            const isSelected = selectedSizeId === s.garmentSizeId;
                            const isRec = s.garmentSizeId === recommendedSizeId;
                            return (
                              <button
                                key={s.garmentSizeId}
                                type="button"
                                onClick={() => setSelectedSizeId(s.garmentSizeId)}
                                className={`relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${isSelected
                                    ? "bg-lotus text-white shadow-xs"
                                    : isRec
                                      ? "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                      : "border border-sand bg-parchment/60 text-stone-600 hover:border-lotus/40 hover:bg-lotus/10"
                                  }`}
                              >
                                <span>Size {s.sizeLabel ?? "—"}</span>
                                {isRec && (
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isSelected ? "bg-white/20 text-white" : "bg-amber-200 text-amber-950"
                                      }`}
                                  >
                                    ⭐ Vừa nhất
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sizing Fit Card */}
                      <div className="rounded-xl border border-sand bg-parchment/60 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between border-b border-sand/60 pb-1.5">
                          <span className="font-semibold text-stone-700 flex items-center gap-1.5">
                            <Ruler className="h-3.5 w-3.5 text-lotus" />
                            Thông số may Size {selectedSize?.sizeLabel ?? "—"}:
                          </span>
                          {customerMeasurements ? (
                            <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Đã so khớp số đo của bạn
                            </span>
                          ) : (
                            <Link
                              href="/dashboard/customer/measurements"
                              className="text-[11px] font-semibold text-lotus hover:underline"
                            >
                              + Nhập số đo để tự động chọn size chuẩn
                            </Link>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                          <div className="rounded-lg bg-white/80 p-2 border border-sand/60">
                            <span className="text-[10px] text-stone-400 block font-medium">Vòng ngực</span>
                            <span className="font-semibold text-ink text-xs">
                              {selectedSize?.measurements?.bustCm ? `${selectedSize.measurements.bustCm}cm` : "Tiêu chuẩn"}
                            </span>
                            {selectedSizeBustDiff !== null && (
                              <span className="block text-[10px] text-stone-500 font-medium">
                                {selectedSizeBustDiff >= 2 && selectedSizeBustDiff <= 5
                                  ? `+${selectedSizeBustDiff}cm (vừa vặn)`
                                  : selectedSizeBustDiff > 5
                                    ? `+${selectedSizeBustDiff}cm (thùng thình)`
                                    : `${selectedSizeBustDiff}cm (bó chật)`}
                              </span>
                            )}
                          </div>

                          <div className="rounded-lg bg-white/80 p-2 border border-sand/60">
                            <span className="text-[10px] text-stone-400 block font-medium">Vòng eo</span>
                            <span className="font-semibold text-ink text-xs">
                              {selectedSize?.measurements?.waistCm ? `${selectedSize.measurements.waistCm}cm` : "Tiêu chuẩn"}
                            </span>
                            {selectedSizeWaistDiff !== null && (
                              <span className="block text-[10px] text-stone-500 font-medium">
                                {selectedSizeWaistDiff >= 1 && selectedSizeWaistDiff <= 4
                                  ? `+${selectedSizeWaistDiff}cm (vừa vặn)`
                                  : selectedSizeWaistDiff > 4
                                    ? `+${selectedSizeWaistDiff}cm (rộng eo)`
                                    : `${selectedSizeWaistDiff}cm (ôm sát)`}
                              </span>
                            )}
                          </div>

                          <div className="rounded-lg bg-white/80 p-2 border border-sand/60">
                            <span className="text-[10px] text-stone-400 block font-medium">Vòng mông</span>
                            <span className="font-semibold text-ink text-xs">
                              {selectedSize?.measurements?.hipCm ? `${selectedSize.measurements.hipCm}cm` : "Tà xẻ tự do"}
                            </span>
                            <span className="block text-[10px] text-stone-500">Thả tà thoải mái</span>
                          </div>

                          <div className="rounded-lg bg-white/80 p-2 border border-sand/60">
                            <span className="text-[10px] text-stone-400 block font-medium">Chiều dài tà</span>
                            <span className="font-semibold text-ink text-xs">
                              {selectedSize?.measurements?.lengthCm ? `${selectedSize.measurements.lengthCm}cm` : "135cm"}
                            </span>
                            {selectedSizeDrapeClearance !== null && (
                              <span className="block text-[10px] text-stone-500">
                                Cách đất ~{selectedSizeDrapeClearance}cm
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Garment Preview Card */}
                  {selectedGroup && (
                    <div className="flex items-center gap-4 rounded-xl border border-sand bg-parchment/50 p-3.5">
                      <div className="relative h-20 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-sand bg-white shadow-xs">
                        {selectedGroup.imageUrl ? (
                          <img
                            src={selectedGroup.imageUrl}
                            alt={selectedGroup.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                            Không có ảnh
                          </div>
                        )}
                      </div>
                      <div className="flex-1 text-xs">
                        <p className="font-semibold text-sm text-ink">{selectedGroup.name}</p>
                        <p className="mt-0.5 text-stone-500">
                          {selectedGroup.categoryName ? `${selectedGroup.categoryName} • ` : ""}
                          {selectedGroup.color ? `Màu ${selectedGroup.color}` : ""}
                        </p>
                        {selectedSize && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-lotus text-xs">
                              {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedSize.dailyPrice)}/ngày
                            </span>
                            <span className="text-stone-300">•</span>
                            <span className="text-stone-500">
                              Cọc: {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedSize.depositAmount)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-400">Đang tải danh sách trang phục...</p>
              )}
            </section>

            {/* 2. Mode selector */}
            <section className="rounded-2xl border border-sand bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-ink">2. Chế độ thử đồ</h2>
                <span className="text-xs font-semibold uppercase tracking-wider text-lotus">Bước 2</span>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                {([
                  {
                    key: "face_swap",
                    label: "Ghép khuôn mặt",
                    desc: "AI ghép nét mặt bạn vào mẫu mặc trang phục",
                    icon: Smile,
                  },
                  {
                    key: "full_body",
                    label: "Dựng toàn thân",
                    desc: "AI tạo dáng vóc toàn diện cùng trang phục",
                    icon: User,
                  },
                ] as const).map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = mode === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setMode(opt.key)}
                      className={`rounded-xl border p-4 text-left transition ${isSelected
                          ? "border-lotus bg-parchment/60 ring-1 ring-lotus/30 shadow-xs"
                          : "border-sand bg-white hover:border-antique/80 hover:bg-mist/40"
                        }`}
                    >
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg mb-2.5 ${isSelected ? "bg-lotus text-white" : "bg-stone-100 text-stone-500"}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="font-semibold text-ink text-sm">{opt.label}</h3>
                      <p className="mt-1 text-xs text-stone-500 leading-snug">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 3. Image source + Capture/Upload */}
            <section className="rounded-2xl border border-sand bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-ink">3. Ảnh của bạn</h2>
                <span className="text-xs font-semibold uppercase tracking-wider text-lotus">Bước 3</span>
              </div>

              {/* Source toggle */}
              <div className="mb-4 flex rounded-xl border border-sand bg-mist p-1">
                {([
                  { key: "upload", label: "Tải ảnh lên", icon: Upload },
                  { key: "camera", label: "Chụp trực tiếp", icon: Camera },
                ] as const).map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = imageSource === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => { setImageSource(opt.key); setImageBase64(null); }}
                      className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${isSelected ? "bg-white text-lotus shadow-xs" : "text-stone-600 hover:text-ink"
                        }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Camera or Upload component */}
              {imageSource === "camera" ? (
                <CameraCapture onCapture={handleImageData} />
              ) : (
                <ImageUpload onUpload={handleImageData} />
              )}
            </section>

            {/* 4. Consent + Submit */}
            <section className="rounded-2xl border border-sand bg-white p-6 shadow-sm">
              <label className="flex items-start gap-3 text-xs leading-5 text-stone-600 cursor-pointer">
                <input
                  className="mt-0.5 h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  Tôi đồng ý cho hệ thống sử dụng ảnh này để tạo hình xem thử kỹ thuật số. Ảnh chỉ được xử lý tạm thời và tuyệt đối bảo mật.
                </span>
              </label>

              {errorMsg && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {quota && quota.remaining <= 0 && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    Bạn đã sử dụng hết {quota.limit}/{quota.limit} lượt thử đồ AI hôm nay. Bạn vẫn có thể xem lại ảnh đã tạo trong Lịch sử hoặc quay lại thử mới sau 00:00!
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={!canSubmit || viewState === "processing" || (quota !== null && quota.remaining <= 0)}
                onClick={handleTryOn}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-md transition hover:bg-oxblood disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="h-4 w-4" />
                {viewState === "processing"
                  ? "Đang dệt nên sắc phục..."
                  : quota && quota.remaining <= 0
                    ? "Đã dùng hết lượt thử hôm nay"
                    : "Bắt đầu mặc thử AI"}
              </button>
            </section>
          </div>

          {/* RIGHT: Preview / Result Display */}
          <div className="flex flex-col gap-6">
            <section className="relative min-h-[580px] overflow-hidden rounded-2xl border border-sand bg-white shadow-sm flex flex-col">
              {viewState === "setup" && !imageBase64 && (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-mist/30">
                  <HeritageMascot mood="wave" size="md" showSparkles={true} />
                  <h3 className="font-display text-2xl font-semibold text-ink mt-2">Khung xem thử AI</h3>
                  <p className="mt-2 max-w-md text-xs leading-relaxed text-stone-500">
                    Hình ảnh mặc thử cổ phục của bạn sẽ xuất hiện tại đây sau khi bạn chọn ảnh và bấm &quot;Bắt đầu mặc thử AI&quot;.
                  </p>
                  <div className="mt-6 flex items-center gap-4 text-xs text-stone-500">
                    <span className="flex items-center gap-1.5"><AnimatedShield size={16} color="#225d55" /> Bảo mật thông tin</span>
                    <span className="flex items-center gap-1.5"><AnimatedSparkles size={16} color="#c6a664" trigger="always" /> AI thế hệ mới</span>
                  </div>
                </div>
              )}

              {viewState === "setup" && imageBase64 && (
                <div className="flex flex-1 flex-col items-center justify-center p-6 bg-mist/20">
                  <img
                    src={`data:image/jpeg;base64,${imageBase64}`}
                    alt="Ảnh của bạn"
                    className="max-h-[460px] w-auto rounded-xl object-contain shadow-md border border-sand"
                  />
                  <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-stone-700">
                    <AnimatedCheckCircle size={16} color="#225d55" trigger="always" />
                    Ảnh của bạn đã sẵn sàng — bấm &quot;Bắt đầu mặc thử AI&quot; để tiến hành
                  </p>
                </div>
              )}

              {viewState === "processing" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-6 sm:p-8 text-center backdrop-blur-md overflow-y-auto">
                  {/* Mascot doing magic while waiting */}
                  <HeritageMascot mood="magic" size="lg" showSparkles={true} />

                  <h2 className="mt-3 font-display text-2xl sm:text-3xl font-semibold text-lotus">
                    Đang dệt nên sắc phục...
                  </h2>

                  {queuePosition > 1 && (
                    <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                      <Clock className="h-3.5 w-3.5" />
                      Hàng đợi: Vị trí #{queuePosition}
                    </span>
                  )}

                  {/* Thanh tiến trình giả lập mượt mà */}
                  <div className="mt-4 w-full max-w-md">
                    <div className="flex items-center justify-between text-[11px] font-medium text-stone-500 mb-1.5">
                      <span>{processingStatusText}</span>
                      <span className="font-semibold text-lotus">{progressPercent}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100 p-0.5 border border-sand">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-antique to-lotus transition-all duration-500 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Cổ phục & Áo dài: Có thể bạn chưa biết? */}
                  <div className="mt-5 w-full max-w-lg rounded-2xl border border-sand/80 bg-parchment/70 p-4 text-left shadow-xs backdrop-blur-xs">
                    <div className="flex items-center justify-between border-b border-sand/60 pb-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-lotus">
                        <BookOpen className="h-4 w-4 text-antique" />
                        <span>Có thể bạn chưa biết?</span>
                        <span className="rounded-full bg-lotus/10 px-2 py-0.5 text-[10px] font-medium text-lotus">
                          {AO_DAI_HISTORICAL_FACTS[factIndex].tag}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium text-stone-400">
                        {factIndex + 1}/{AO_DAI_HISTORICAL_FACTS.length}
                      </span>
                    </div>
                    <div className="mt-2.5 min-h-[76px]">
                      <h4 className="text-xs font-bold text-ink">
                        {AO_DAI_HISTORICAL_FACTS[factIndex].title}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-stone-600 transition-opacity duration-300">
                        {AO_DAI_HISTORICAL_FACTS[factIndex].content}
                      </p>
                    </div>

                    {/* Navigation Dots */}
                    <div className="mt-3 flex items-center justify-center gap-1.5 pt-1">
                      {AO_DAI_HISTORICAL_FACTS.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setFactIndex(i)}
                          className={`h-1.5 rounded-full transition-all ${i === factIndex ? "w-5 bg-lotus" : "w-1.5 bg-stone-300 hover:bg-stone-400"
                            }`}
                          title={`Chuyện xưa ${i + 1}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-2 text-[11px] text-stone-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-lotus animate-ping" />
                    <span>Hệ thống AI xử lý theo chuẩn mực văn hoá và thẩm mỹ cổ phục Việt</span>
                  </div>
                </div>
              )}

              {viewState === "result" && resultImage && (
                <TryonResultViewer
                  resultImageUrl={resultImage}
                  userImageBase64={imageBase64}
                  referenceGarmentImageUrl={selectedGroup?.imageUrl ?? null}
                  garmentName={selectedGroup?.name ?? "Trang phục"}
                  sizeLabel={selectedSize?.sizeLabel ?? null}
                  selectedSizeId={selectedSizeId}
                  isCached={isCachedResult}
                  customerMeasurements={customerMeasurements}
                  sizeMeasurements={selectedSize?.measurements ?? null}
                  categoryName={selectedGroup?.categoryName ?? null}
                  availableSizes={selectedGroup?.sizes.map((s) => ({
                    garmentSizeId: s.garmentSizeId,
                    sizeLabel: s.sizeLabel,
                  }))}
                  onChangeSize={(newSizeId) => setSelectedSizeId(newSizeId)}
                  onRetry={handleTryOn}
                  onReset={handleReset}
                />
              )}
            </section>

            {/* Similar Garments Section */}
            <SimilarGarments
              currentGarmentId={selectedGroup?.garmentId ?? null}
              onSelectGarment={handleSelectSimilarGarment}
            />
          </div>
        </div>

        {/* Try-on History Section */}
        <section className="rounded-2xl border border-sand bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/70 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                <History className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-semibold text-ink">Lịch sử thử đồ gần đây</h2>
                <p className="text-xs text-stone-500">
                  Các ảnh AI đã tạo được lưu trữ bảo mật để bạn xem lại, tải về hoặc tiếp tục thử đồ.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={!hasAccessToken || isHistoryLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2 text-xs font-semibold text-stone-700 shadow-xs transition hover:border-antique hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${isHistoryLoading ? "animate-spin" : ""}`} />
              {isHistoryLoading ? "Đang tải..." : "Làm mới"}
            </button>
          </div>

          {isHistoryLoading && historyItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-stone-400">Đang tải lịch sử thử đồ...</div>
          ) : historyItems.length > 0 ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {historyItems.map((item) => (
                <article
                  key={item.id}
                  className="group flex flex-col justify-between overflow-hidden rounded-xl border border-sand bg-mist/40 transition-colors duration-200 hover:border-lotus hover:shadow-md"
                >
                  <div
                    className="relative aspect-[3/4] cursor-pointer overflow-hidden bg-lotus/10"
                    onClick={() => {
                      if (item.resultImageUrl) setLightboxImageUrl(item.resultImageUrl);
                    }}
                  >
                    {item.resultImageUrl ? (
                      <img
                        src={item.resultImageUrl}
                        alt={item.garmentName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-stone-400">
                        Chưa có ảnh kết quả
                      </div>
                    )}
                    <span className="absolute bottom-2.5 right-2.5 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100 backdrop-blur-xs">
                      <Maximize2 className="h-4 w-4" />
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-3.5">
                    <div>
                      <h3 className="line-clamp-1 text-xs font-semibold text-ink" title={item.garmentName}>
                        {item.garmentName}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-stone-500">
                        {new Date(item.createdAt).toLocaleString("vi-VN")}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-sand/70 pt-2.5 text-xs">
                      <button
                        type="button"
                        onClick={() => handleSelectGarmentByName(item.garmentName)}
                        className="font-semibold text-lotus transition hover:text-oxblood"
                      >
                        Thử lại mẫu này
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleHideHistoryItem(item.id)}
                        className="text-stone-400 transition hover:text-red-500 p-1 rounded"
                        title="Ẩn khỏi lịch sử"
                      >
                        <EyeOff className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : !hasAccessToken ? (
            <div className="py-8 text-center text-xs text-stone-500">
              Vui lòng đăng nhập để xem lịch sử thử đồ của bạn.
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-stone-400">
              Bạn chưa có ảnh thử đồ nào trong bộ sưu tập.
            </div>
          )}
        </section>
      </main>

      {/* History Lightbox Modal */}
      {lightboxImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
          onClick={() => setLightboxImageUrl(null)}
        >
          <div className="relative max-h-screen max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxImageUrl}
              alt="Ảnh thử đồ phóng to"
              className="max-h-[90vh] w-auto rounded-xl object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setLightboxImageUrl(null)}
              className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
              title="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Realtime Decart Try-On Modal */}
      <RealtimeTryOnModal
        isOpen={isRealtimeModalOpen}
        onClose={() => setIsRealtimeModalOpen(false)}
        initialGarment={groups[selectedGroupIdx] ?? null}
        garments={groups}
      />

      <CustomerFooter />
    </div>
  );
}

export default function TryOnPage() {
  return (
    <Suspense>
      <TryOnInner />
    </Suspense>
  );
}
