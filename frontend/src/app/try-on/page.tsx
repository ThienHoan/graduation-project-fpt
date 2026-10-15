"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { CameraCapture } from "@/components/try-on/camera-capture";
import { ImageUpload } from "@/components/try-on/image-upload";
import { SimilarGarments } from "@/components/try-on/similar-garments";
import { TryonResultViewer } from "@/components/try-on/tryon-result-viewer";
import {
  Sparkles,
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
} from "lucide-react";
import {
  getGarmentsGrouped,
  getTryonHistory,
  getTryonStatus,
  hideTryonHistoryItem,
  submitTryon,
  type GarmentGrouped,
  type TryonHistoryItem,
  type TryonMode,
  type TryonSource,
} from "@/lib/api";
import { readStoredAccessToken } from "@/lib/auth";

type ViewState = "setup" | "processing" | "result";

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
    if (token) void loadHistory();
  }, []);

  const selectedGroup = groups[selectedGroupIdx] ?? null;
  const selectedSize = selectedGroup?.sizes.find((s) => s.garmentSizeId === selectedSizeId) ?? selectedGroup?.sizes[0];

  const canSubmit = selectedSizeId && imageBase64 && consent;

  function handleImageData(base64: string) {
    setImageBase64(base64);
    setViewState("setup");
    setErrorMsg(null);
  }

  async function handleTryOn() {
    if (!canSubmit) return;
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
        setResultImage(current.resultImageUrl);
        setIsCachedResult(Boolean(current.isCached));
        setViewState("result");
        void loadHistory();
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

                  {/* Size selection */}
                  {selectedGroup && selectedGroup.sizes.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-stone-500">Kích thước:</span>
                      {selectedGroup.sizes.map((s) => (
                        <button
                          key={s.garmentSizeId}
                          type="button"
                          onClick={() => setSelectedSizeId(s.garmentSizeId)}
                          className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                            selectedSizeId === s.garmentSizeId
                              ? "bg-lotus text-white shadow-xs"
                              : "border border-sand bg-parchment/60 text-stone-600 hover:border-lotus/40 hover:bg-lotus/10"
                          }`}
                        >
                          Size {s.sizeLabel ?? "—"}
                        </button>
                      ))}
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
                      className={`rounded-xl border p-4 text-left transition ${
                        isSelected
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
                      className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
                        isSelected ? "bg-white text-lotus shadow-xs" : "text-stone-600 hover:text-ink"
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

              <button
                type="button"
                disabled={!canSubmit || viewState === "processing"}
                onClick={handleTryOn}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-md transition hover:bg-oxblood disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="h-4 w-4" />
                {viewState === "processing" ? "Đang xử lý hình ảnh..." : "Bắt đầu mặc thử AI"}
              </button>
            </section>
          </div>

          {/* RIGHT: Preview / Result Display */}
          <div className="flex flex-col gap-6">
            <section className="relative min-h-[580px] overflow-hidden rounded-2xl border border-sand bg-white shadow-sm flex flex-col">
              {viewState === "setup" && !imageBase64 && (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-mist/30">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-lotus/5 text-lotus mb-4 border border-sand/80">
                    <ImageIcon className="h-9 w-9 text-antique" />
                  </div>
                  <h3 className="font-display text-2xl font-semibold text-ink">Khung xem thử AI</h3>
                  <p className="mt-2 max-w-md text-xs leading-relaxed text-stone-500">
                    Hình ảnh mặc thử cổ phục của bạn sẽ xuất hiện tại đây sau khi bạn chọn ảnh và bấm &quot;Bắt đầu mặc thử AI&quot;.
                  </p>
                  <div className="mt-6 flex items-center gap-4 text-xs text-stone-400">
                    <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-jade" /> Bảo mật thông tin</span>
                    <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-antique" /> AI thế hệ mới</span>
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
                  <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-stone-600">
                    <CheckCircle2 className="h-4 w-4 text-jade" />
                    Ảnh của bạn đã sẵn sàng — bấm &quot;Bắt đầu mặc thử AI&quot; để tiến hành
                  </p>
                </div>
              )}

              {viewState === "processing" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-8 text-center backdrop-blur-md">
                  {/* Glowing pulse ring & laser scan */}
                  <div className="relative flex items-center justify-center">
                    <div className="h-28 w-28 animate-spin rounded-full border-4 border-stone-200 border-t-lotus" />
                    <Sparkles className="absolute h-9 w-9 text-lotus animate-pulse" />
                  </div>

                  <h2 className="mt-6 font-display text-3xl font-semibold text-lotus">Đang dệt nên sắc phục...</h2>
                  
                  {queuePosition > 1 && (
                    <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                      <Clock className="h-3.5 w-3.5" />
                      Hàng đợi: Vị trí #{queuePosition}
                    </span>
                  )}

                  <p className="mt-3 max-w-sm text-xs leading-relaxed text-stone-600">
                    {processingStatusText}
                  </p>

                  <div className="mt-8 flex items-center gap-2 text-[11px] text-stone-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-lotus animate-ping" />
                    <span>Hệ thống AI xử lý theo tiêu chuẩn thẩm mỹ cổ phục</span>
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
