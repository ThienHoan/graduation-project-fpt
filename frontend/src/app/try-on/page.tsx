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
        {/* Header */}
        <section className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-5xl text-lotus sm:text-6xl">Thử Đồ AI</h1>
          <p className="mt-5 text-base leading-8 text-stone-600 sm:text-lg">
            Chụp hoặc tải ảnh chân dung để AI ghép bạn vào trang phục cổ phục truyền thống.
            Trải nghiệm chân thực, nhanh chóng và mượt mà trước khi đặt lịch thuê.
          </p>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          {/* LEFT: Settings */}
          <div className="space-y-6">
            {/* Garment selector */}
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-display text-2xl text-ink">1. Chọn trang phục</h2>
              {groups.length > 0 ? (
                <div className="space-y-4">
                  <select
                    value={selectedGroupIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSelectedGroupIdx(idx);
                      const firstSize = groups[idx]?.sizes[0]?.garmentSizeId ?? null;
                      setSelectedSizeId(firstSize);
                    }}
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-antique"
                  >
                    {groups.map((g, i) => (
                      <option key={g.slug} value={i}>{g.name}</option>
                    ))}
                  </select>

                  {/* Size selection */}
                  {selectedGroup && selectedGroup.sizes.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-stone-500">Size:</span>
                      {selectedGroup.sizes.map((s) => (
                        <button
                          key={s.garmentSizeId}
                          type="button"
                          onClick={() => setSelectedSizeId(s.garmentSizeId)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                            selectedSizeId === s.garmentSizeId
                              ? "bg-lotus text-white"
                              : "bg-parchment text-stone-600 hover:bg-lotus/20"
                          }`}
                        >
                          {s.sizeLabel ?? "—"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Garment Preview Card */}
                  {selectedGroup && (
                    <div className="flex items-center gap-3.5 rounded-xl border border-sand bg-parchment/60 p-3.5">
                      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-sand bg-white">
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
                        <p className="font-semibold text-ink">{selectedGroup.name}</p>
                        <p className="mt-0.5 text-stone-500">
                          {selectedGroup.categoryName ? `${selectedGroup.categoryName} • ` : ""}
                          {selectedGroup.color ? `Màu ${selectedGroup.color}` : ""}
                        </p>
                        {selectedSize && (
                          <p className="mt-1 font-semibold text-lotus">
                            Thuê: {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedSize.dailyPrice)}/ngày
                            <span className="font-normal text-stone-400"> • Cọc: {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedSize.depositAmount)}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-400">Đang tải danh sách trang phục...</p>
              )}
            </section>

            {/* Mode selector */}
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-display text-2xl text-ink">2. Chế độ thử đồ</h2>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: "face_swap", label: "Khuôn mặt", desc: "AI ghép khuôn mặt bạn vào người mẫu", icon: "face" },
                  { key: "full_body", label: "Toàn thân", desc: "AI dựng toàn bộ cơ thể với trang phục", icon: "accessibility_new" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setMode(opt.key)}
                    className={`rounded-xl border p-4 text-left transition ${
                      mode === opt.key
                        ? "border-lotus bg-parchment"
                        : "border-sand bg-white hover:border-antique"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-2xl mb-2 block ${mode === opt.key ? "text-lotus" : "text-stone-400"}`}>
                      {opt.icon}
                    </span>
                    <h3 className="font-semibold text-ink text-sm">{opt.label}</h3>
                    <p className="mt-1 text-xs text-stone-500">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </section>

            {/* Image source + Capture/Upload */}
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-display text-2xl text-ink">3. Ảnh của bạn</h2>

              {/* Source toggle */}
              <div className="mb-4 flex rounded-lg border border-sand bg-mist p-1">
                {([
                  { key: "upload", label: "Upload ảnh", icon: "upload" },
                  { key: "camera", label: "Chụp ảnh", icon: "photo_camera" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setImageSource(opt.key); setImageBase64(null); }}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition ${
                      imageSource === opt.key ? "bg-white text-lotus shadow-sm" : "text-stone-500 hover:text-stone-700"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Camera or Upload */}
              {imageSource === "camera" ? (
                <CameraCapture onCapture={handleImageData} />
              ) : (
                <ImageUpload onUpload={handleImageData} />
              )}
            </section>

            {/* Consent + Submit */}
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <label className="flex items-start gap-3 text-sm leading-7 text-stone-600 cursor-pointer">
                <input
                  className="mt-1 h-5 w-5 rounded border-sand text-lotus focus:ring-lotus"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>Tôi đồng ý cho hệ thống sử dụng ảnh này để tạo bản xem thử kỹ thuật số. Ảnh chỉ được xử lý tạm thời và bảo mật.</span>
              </label>

              {errorMsg && (
                <p className="mt-4 text-sm text-red-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {errorMsg}
                </p>
              )}

              <button
                type="button"
                disabled={!canSubmit || viewState === "processing"}
                onClick={handleTryOn}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-oxblood disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                {viewState === "processing" ? "Đang xử lý..." : "Tạo hình ảnh thử đồ"}
              </button>
            </section>
          </div>

          {/* RIGHT: Preview / Result Display */}
          <div className="flex flex-col gap-6">
            <section className="relative min-h-[600px] overflow-hidden rounded-xl border border-sand bg-lotus/10">
              {viewState === "setup" && !imageBase64 && (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <span className="material-symbols-outlined text-6xl text-stone-300">imagesmode</span>
                  <p className="mt-4 max-w-md text-base leading-8 text-stone-500">
                    Hình ảnh thử đồ của bạn sẽ xuất hiện ở đây sau khi bạn chọn ảnh và bấm &quot;Tạo hình ảnh thử đồ&quot;.
                  </p>
                </div>
              )}

              {viewState === "setup" && imageBase64 && (
                <div className="flex h-full flex-col items-center justify-center p-4">
                  <img
                    src={`data:image/jpeg;base64,${imageBase64}`}
                    alt="Ảnh của bạn"
                    className="max-h-[500px] w-full rounded-lg object-contain shadow-md"
                  />
                  <p className="mt-4 text-sm text-stone-500">
                    Ảnh của bạn đã sẵn sàng — bấm &quot;Tạo hình ảnh thử đồ&quot; để AI xử lý
                  </p>
                </div>
              )}

              {viewState === "processing" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-8 text-center backdrop-blur-sm">
                  <div className="relative flex items-center justify-center">
                    <div className="h-24 w-24 animate-spin rounded-full border-4 border-stone-200 border-t-lotus" />
                    <span className="material-symbols-outlined absolute text-3xl text-lotus animate-pulse">auto_awesome</span>
                  </div>

                  <h2 className="mt-6 font-display text-3xl text-lotus">Đang dệt nên hình ảnh...</h2>
                  
                  {queuePosition > 1 && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      <span className="material-symbols-outlined text-[14px]">schedule</span>
                      Hàng đợi: Vị trí #{queuePosition}
                    </span>
                  )}

                  <p className="mt-3 max-w-sm text-sm leading-6 text-stone-600">
                    {processingStatusText}
                  </p>
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
        <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-ink">Lịch sử thử đồ gần đây</h2>
              <p className="mt-1 text-sm text-stone-500">
                Các ảnh AI đã tạo được lưu tại đây để bạn xem lại, tải về hoặc tiếp tục thử đồ.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={!hasAccessToken || isHistoryLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-sand px-4 py-2 text-xs font-semibold text-stone-600 transition hover:border-antique disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              {isHistoryLoading ? "Đang tải..." : "Làm mới"}
            </button>
          </div>

          {isHistoryLoading && historyItems.length === 0 ? (
            <p className="mt-5 text-sm text-stone-400">Đang tải lịch sử thử đồ...</p>
          ) : historyItems.length > 0 ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {historyItems.map((item) => (
                <article
                  key={item.id}
                  className="group flex flex-col justify-between overflow-hidden rounded-xl border border-sand bg-mist transition hover:border-lotus/40 hover:shadow-sm"
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
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-stone-400">
                        Chưa có ảnh kết quả
                      </div>
                    )}
                    <span className="absolute bottom-2 right-2 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100">
                      <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-3">
                    <div>
                      <h3 className="line-clamp-1 text-xs font-semibold text-ink" title={item.garmentName}>
                        {item.garmentName}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-stone-500">
                        {new Date(item.createdAt).toLocaleString("vi-VN")}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-sand/60 pt-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleSelectGarmentByName(item.garmentName)}
                        className="font-medium text-lotus transition hover:text-oxblood"
                      >
                        Thử lại mẫu này
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleHideHistoryItem(item.id)}
                        className="text-stone-400 transition hover:text-red-500"
                        title="Ẩn khỏi lịch sử"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility_off</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : !hasAccessToken ? (
            <p className="mt-5 text-sm text-stone-400">Vui lòng đăng nhập để xem lịch sử thử đồ của bạn.</p>
          ) : (
            <p className="mt-5 text-sm text-stone-400">Bạn chưa có ảnh thử đồ nào.</p>
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
              className="max-h-[90vh] w-auto rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setLightboxImageUrl(null)}
              className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
              title="Đóng"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
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
