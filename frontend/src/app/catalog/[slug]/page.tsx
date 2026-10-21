"use client";

import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getGarmentsGrouped,
  getGarmentReviews,
  getMyMeasurements,
  getSizeAvailabilityCalendar,
  trackGarmentView,
  type CustomerMeasurement,
  type GarmentGrouped,
  type GarmentReviewsData,
  type GroupedGarmentAccessory,
  type ReviewResponse,
} from "@/lib/api";
import { RentalDateCalendar } from "@/components/customer/rental-date-calendar";
import { addToCart, cartCount } from "@/lib/cart";
import { getMyChatConversation, sendProductCardMessage } from "@/lib/chat";
import { ReviewModal } from "@/components/customer/review-modal";
import { OptimizedImage } from "@/components/common/optimized-image";
import {
  ChevronRight,
  ChevronLeft,
  ShoppingBag,
  Sparkles,
  Camera,
  Calendar,
  ShieldCheck,
  Headphones,
  Star,
  CheckCircle2,
  Check,
  Plus,
  ArrowRight,
  Loader2,
  AlertTriangle,
  TrendingUp,
  ThumbsUp,
  Filter,
} from "lucide-react";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function GarmentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: garmentId } = use(params);
  const router = useRouter();

  const [group, setGroup] = useState<GarmentGrouped | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundFlag, setNotFoundFlag] = useState(false);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(null);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [consultMsg, setConsultMsg] = useState<string | null>(null);
  const [isConsulting, setIsConsulting] = useState(false);
  const [reviewsData, setReviewsData] = useState<GarmentReviewsData | null>(null);
  const [reviewFilter, setReviewFilter] = useState<{
    rating?: number;
    hasMedia?: boolean;
    fit?: string;
  }>({});
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Số đo người dùng & Smart Size Matching
  const [customerMeas, setCustomerMeas] = useState<CustomerMeasurement | null>(null);
  const [measLoading, setMeasLoading] = useState(false);

  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 2));
  const maxDate = addDays(today, 365);
  const [fullyBookedDates, setFullyBookedDates] = useState<Set<string>>(new Set());
  const [calLoading, setCalLoading] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setCustomerMeas(null);
      return;
    }
    setMeasLoading(true);
    getMyMeasurements()
      .then((res) => {
        if (res.success && res.data) {
          setCustomerMeas(res.data);
        }
      })
      .finally(() => setMeasLoading(false));
  }, [user]);

  // Thuật toán đối chiếu số đo thông minh (Smart Size Matching)
  const sizeRecommendations = useMemo(() => {
    if (!group || !group.sizes || !customerMeas) return null;

    const hasAnyMeasurement = Boolean(
      customerMeas.bustCm || customerMeas.waistCm || customerMeas.hipCm || customerMeas.usualSize
    );
    if (!hasAnyMeasurement) return null;

    const scoredSizes = group.sizes.map((s) => {
      const m = s.measurements;
      let score = 80;
      const warnings: string[] = [];
      const fits: string[] = [];

      if (m) {
        // Vòng ngực
        if (m.bustCm != null && customerMeas.bustCm != null) {
          const diff = m.bustCm - customerMeas.bustCm;
          if (diff < -2) {
            score -= 35;
            warnings.push(`Vòng ngực áo (${m.bustCm}cm) chật hơn ngực bạn (${customerMeas.bustCm}cm)`);
          } else if (diff < 0) {
            score -= 15;
            warnings.push(`Vòng ngực ôm sát (${m.bustCm}cm so với ${customerMeas.bustCm}cm)`);
          } else if (diff <= 5) {
            score += 15;
            fits.push(`Vòng ngực vừa vặn lý tưởng (+${diff.toFixed(0)}cm)`);
          } else if (diff <= 9) {
            score += 5;
            fits.push(`Vòng ngực thoải mái (+${diff.toFixed(0)}cm)`);
          } else {
            score -= 15;
            warnings.push(`Vòng ngực hơi rộng (+${diff.toFixed(0)}cm)`);
          }
        }

        // Vòng eo
        if (m.waistCm != null && customerMeas.waistCm != null) {
          const diff = m.waistCm - customerMeas.waistCm;
          if (diff < -2) {
            score -= 35;
            warnings.push(`Vòng eo áo (${m.waistCm}cm) chật hơn eo bạn (${customerMeas.waistCm}cm)`);
          } else if (diff < 0) {
            score -= 15;
            warnings.push(`Vòng eo ôm sát (${m.waistCm}cm so với ${customerMeas.waistCm}cm)`);
          } else if (diff <= 4) {
            score += 15;
            fits.push(`Vòng eo chiết eo chuẩn dáng (+${diff.toFixed(0)}cm)`);
          } else if (diff <= 8) {
            score += 5;
          } else {
            score -= 15;
            warnings.push(`Vòng eo hơi rộng (+${diff.toFixed(0)}cm)`);
          }
        }

        // Vòng hông
        if (m.hipCm != null && customerMeas.hipCm != null) {
          const diff = m.hipCm - customerMeas.hipCm;
          if (diff < -2) {
            score -= 25;
            warnings.push(`Vòng hông áo (${m.hipCm}cm) có thể kích so với hông bạn (${customerMeas.hipCm}cm)`);
          } else if (diff <= 6) {
            score += 10;
          }
        }
      }

      if (customerMeas.usualSize && s.sizeLabel && s.sizeLabel.toUpperCase() === customerMeas.usualSize.toUpperCase()) {
        score += 10;
        fits.push(`Trùng với size bạn thường mặc (${customerMeas.usualSize})`);
      }

      const clampedScore = Math.max(30, Math.min(99, score));
      return {
        garmentSizeId: s.garmentSizeId,
        sizeLabel: s.sizeLabel,
        score: clampedScore,
        warnings,
        fits,
      };
    });

    scoredSizes.sort((a, b) => b.score - a.score);
    const best = scoredSizes[0];
    return {
      best,
      bySizeId: new Map(scoredSizes.map((s) => [s.garmentSizeId, s])),
    };
  }, [group, customerMeas]);

  const currentSizeRec = sizeRecommendations?.bySizeId.get(selectedGarmentId ?? "");

  const hasPublicReview = Boolean(
    user && reviewsData?.reviews.some((r) => r.customerId === user.id),
  );

  useEffect(() => {
    getGarmentsGrouped().then((res) => {
      if (res.success && res.data) {
        for (const g of res.data) {
          // 1. Kiểm tra nếu garmentId khớp với garmentSizeId hoặc garmentId của size
          const foundSize = g.sizes.find(
            (s) => s.garmentSizeId === garmentId || s.garmentId === garmentId
          );
          // 2. Hoặc garmentId khớp với ID sản phẩm mẹ (garmentId) hoặc slug URL
          const matchesGroup =
            g.garmentId === garmentId ||
            g.slug === garmentId ||
            encodeURIComponent(g.slug) === garmentId;

          if (foundSize || matchesGroup) {
            setGroup(g);
            // Ưu tiên size tìm được, nếu không thì lấy size đầu tiên khả dụng
            const initialSizeId = foundSize
              ? foundSize.garmentSizeId
              : g.sizes[0]?.garmentSizeId || null;
            setSelectedGarmentId(initialSizeId);
            setLoading(false);

            if (g.garmentId) {
              trackGarmentView(g.garmentId);
              getGarmentReviews(g.garmentId).then((revRes) => {
                if (revRes.success && revRes.data) {
                  setReviewsData(revRes.data);
                }
              });
            }
            return;
          }
        }
        setNotFoundFlag(true);
      } else {
        setNotFoundFlag(true);
      }
      setLoading(false);
    });
  }, [garmentId]);

  useEffect(() => {
    if (!selectedGarmentId) return;
    let cancelled = false;
    setCalLoading(true);
    getSizeAvailabilityCalendar(selectedGarmentId, today, maxDate).then((res) => {
      if (cancelled) return;
      setCalLoading(false);
      if (res.success && res.data) {
        setFullyBookedDates(
          new Set(res.data.days.filter((d) => !d.available).map((d) => d.date)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedGarmentId]);

  useEffect(() => {
    if (fullyBookedDates.size === 0) return;
    if (startDate >= today && !fullyBookedDates.has(startDate)) return;
    let d = today;
    while (d <= maxDate && fullyBookedDates.has(d)) {
      d = addDays(d, 1);
    }
    if (d <= maxDate && !fullyBookedDates.has(d)) {
      setStartDate(d);
      setEndDate(d);
    }
  }, [fullyBookedDates]);

  const blockedInRange = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return [];
    const out: string[] = [];
    let d = startDate;
    while (d <= endDate) {
      if (fullyBookedDates.has(d)) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }, [startDate, endDate, fullyBookedDates]);

  function formatShortDate(iso: string) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  if (notFoundFlag) notFound();

  const selectedSize =
    group?.sizes.find((s) => s.garmentSizeId === selectedGarmentId) ?? group?.sizes[0];

  async function handleConsult() {
    if (!group || !selectedSize || isConsulting) return;
    setIsConsulting(true);
    try {
      const convRes = await getMyChatConversation();
      if (!convRes.success || !convRes.data) {
        setConsultMsg("Vui lòng đăng nhập tài khoản khách hàng để kết nối tư vấn trực tuyến.");
        setTimeout(() => setConsultMsg(null), 3500);
        return;
      }
      const sendRes = await sendProductCardMessage({
        conversationId: convRes.data.id,
        productId: group.garmentId,
      });
      if (sendRes.success) {
        setConsultMsg("Đã gửi thông tin trang phục vào khung chat tư vấn!");
        // Mở khung chat nổi của khách hàng ngay trên trang chi tiết sản phẩm
        window.dispatchEvent(new CustomEvent("chat:open"));
      } else {
        setConsultMsg(sendRes.message ?? "Không thể gửi tin nhắn tư vấn. Vui lòng thử lại.");
      }
      setTimeout(() => setConsultMsg(null), 3500);
    } catch {
      setConsultMsg("Lỗi khi kết nối tới hệ thống tư vấn.");
      setTimeout(() => setConsultMsg(null), 3500);
    } finally {
      setIsConsulting(false);
    }
  }

  function handleAddToCart() {
    if (!group || !selectedSize) return;
    addToCart({
      garmentSizeId: selectedSize.garmentSizeId,
      garmentId: group.garmentId,
      name: group.name + (selectedSize.sizeLabel ? ` (Size ${selectedSize.sizeLabel})` : ""),
      sizeLabel: selectedSize.sizeLabel,
      dailyPrice: selectedSize.dailyPrice,
      depositAmount: selectedSize.depositAmount,
      imageUrl: group.imageUrl,
    });
    setAddedMsg(`Đã thêm "${group.name}" vào giỏ`);
    setTimeout(() => setAddedMsg(null), 2500);
  }

  function handleBookNow() {
    if (!group || !selectedSize) return;
    addToCart({
      garmentSizeId: selectedSize.garmentSizeId,
      garmentId: group.garmentId,
      name: group.name + (selectedSize.sizeLabel ? ` (Size ${selectedSize.sizeLabel})` : ""),
      sizeLabel: selectedSize.sizeLabel,
      dailyPrice: selectedSize.dailyPrice,
      depositAmount: selectedSize.depositAmount,
      imageUrl: group.imageUrl,
    });
    const p = new URLSearchParams({ startDate, endDate });
    router.push(`/booking/date-selection?${p.toString()}`);
  }

  return (
    <div className="min-h-screen bg-mist text-ink antialiased">
      <CustomerNavbar active="collection" cartHref="/booking/date-selection" />

      {/* Toast thông báo */}
      {addedMsg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-emerald-300 bg-emerald-800 px-6 py-3 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            <span>{addedMsg}</span>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        {/* Breadcrumb di sản */}
        <nav className="mb-8 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-stone-500">
          <Link href="/" className="transition hover:text-lotus">
            Trang chủ
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-stone-400" />
          <Link href="/catalog" className="transition hover:text-lotus">
            Bộ sưu tập
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-bronze font-semibold">{group?.categoryName ?? "Cổ phục"}</span>
          <ChevronRight className="h-3.5 w-3.5 text-stone-400" />
          <span className="truncate font-bold text-ink">{loading ? "Đang tải..." : group?.name}</span>
        </nav>

        {loading ? (
          <div className="flex h-96 items-center justify-center text-sm text-stone-400">
            Đang tải dữ liệu y phục...
          </div>
        ) : group ? (
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            {/* Gallery ảnh y phục */}
            <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              {/* Ảnh chính */}
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-sand bg-white p-2 shadow-sm">
                <div className="relative h-full w-full overflow-hidden rounded-xl bg-stone-100">
                  {group.images && group.images.length > 0 ? (
                    <>
                      <OptimizedImage
                        src={group.images[activeImageIdx]?.imageUrl ?? group.imageUrl ?? ""}
                        alt={group.name}
                        fill
                        priority
                        sizes="(max-width: 1024px) 100vw, 55vw"
                        className="object-cover transition-opacity duration-300"
                      />
                      {group.images.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveImageIdx(
                                (i) => (i - 1 + group.images.length) % group.images.length,
                              )
                            }
                            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-sand bg-white/90 p-2 text-ink shadow-md backdrop-blur-xs transition hover:bg-white"
                            aria-label="Ảnh trước"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveImageIdx((i) => (i + 1) % group.images.length)
                            }
                            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-sand bg-white/90 p-2 text-ink shadow-md backdrop-blur-xs transition hover:bg-white"
                            aria-label="Ảnh tiếp"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                            {group.images.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setActiveImageIdx(idx)}
                                className={`h-1.5 rounded-full transition-all ${
                                  idx === activeImageIdx ? "w-5 bg-white" : "w-1.5 bg-white/60"
                                }`}
                                aria-label={`Ảnh ${idx + 1}`}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : group.imageUrl ? (
                    <OptimizedImage
                      src={group.imageUrl}
                      alt={group.name}
                      fill
                      priority
                      sizes="(max-width: 1024px) 100vw, 55vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-stone-300">
                      Cổ phục hoàng cung
                    </div>
                  )}

                  <span className="shadow-xs absolute left-3 top-3 z-10 rounded bg-white/95 px-3 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
                    {group.categoryName ?? "Triều Nguyễn"}
                  </span>
                </div>
              </div>

              {/* Dải ảnh thu nhỏ (Thumbnails) */}
              {group.images && group.images.length > 1 && (
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {group.images.map((img, idx) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setActiveImageIdx(idx)}
                      className={`relative h-20 w-16 flex-none overflow-hidden rounded-lg border-2 transition ${
                        idx === activeImageIdx
                          ? "border-lotus shadow-xs"
                          : "border-sand hover:border-antique"
                      }`}
                      aria-label={`Xem ảnh ${idx + 1}`}
                    >
                      <OptimizedImage
                        src={img.imageUrl}
                        alt={img.altText ?? group.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chi tiết & Đặt thuê */}
            <div className="space-y-8">
              {/* Tiêu đề & Đơn giá */}
              <div className="border-b border-sand pb-6">
                <span className="text-xs font-bold uppercase tracking-widest text-bronze">
                  {group.categoryName ?? "Lưu Trữ Di Sản"} · Triều Đình
                </span>
                <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-oxblood sm:text-5xl">
                  {group.name}
                </h1>

                {/* Rating review tóm tắt */}
                {reviewsData && reviewsData.total > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <div className="flex text-amber-500">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${
                            i < Math.round(reviewsData.averageRating)
                              ? "fill-amber-400 text-amber-400"
                              : "text-stone-300"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="font-bold text-ink">
                      {reviewsData.averageRating.toFixed(1)}
                    </span>
                    <span className="text-stone-500">({reviewsData.total} đánh giá)</span>
                  </div>
                )}

                {/* Khung Giá & Cọc Nổi Bật */}
                <div className="mt-6 rounded-2xl border border-sand bg-parchment/60 p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-4">
                    <div>
                      <span className="block text-xs font-medium text-stone-600">
                        Giá thuê theo ngày
                      </span>
                      <div className="mt-1 font-display text-3xl font-bold text-lotus sm:text-4xl">
                        {selectedSize ? formatVND(selectedSize.dailyPrice) : "—"}
                        <span className="text-xs font-normal text-stone-600">/ngày</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="block text-xs font-medium text-stone-600">
                        Tiền cọc minh bạch
                      </span>
                      <div className="mt-1 text-base font-bold text-ink">
                        {selectedSize ? formatVND(selectedSize.depositAmount) : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 border-t border-sand/70 pt-3 text-xs text-stone-700">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    <span>Miễn phí giặt ủi sinh học &amp; đóng hộp bảo quản tiêu chuẩn bảo tàng.</span>
                  </div>
                </div>
              </div>

              {/* Thông số chất liệu & Dịp mặc */}
              <div className="border-b border-sand pb-6">
                <h2 className="font-display text-2xl font-bold text-oxblood">Quy Cách &amp; Chất Liệu</h2>
                {(() => {
                  const specs: Array<{ label: string; value: string }> = [];
                  if (group.description) specs.push({ label: "Mô tả phục dựng", value: group.description });
                  if (group.color) specs.push({ label: "Màu sắc sắc độ", value: group.color });
                  if ((group.material ?? []).length > 0)
                    specs.push({ label: "Chất liệu gấm / tơ", value: group.material.join(", ") });
                  if ((group.occasion ?? []).length > 0)
                    specs.push({ label: "Dịp nghi lễ phù hợp", value: group.occasion.join(", ") });

                  return specs.length > 0 ? (
                    <dl className="mt-4 space-y-3 text-xs sm:text-sm">
                      {specs.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-start justify-between gap-4 border-b border-sand/50 pb-2.5"
                        >
                          <dt className="font-medium text-stone-500">{item.label}</dt>
                          <dd className="max-w-xs text-right font-semibold text-ink">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-3 text-xs text-stone-500">
                      Xưởng may đang hoàn thiện tài liệu lưu trữ số hóa cho mẫu này.
                    </p>
                  );
                })()}
              </div>

              {/* Lựa chọn Kích Thước (Size Selector) & Smart Size Recommendation */}
              <div className="border-b border-sand pb-6">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-800">
                    Chọn Kích Cỡ:
                  </label>
                  <Link
                    href="/dashboard/customer/measurements"
                    className="text-xs font-semibold text-lotus hover:underline"
                  >
                    {customerMeas ? "Số đo của bạn (Chỉnh sửa)" : "Thiết lập số đo của tôi"}
                  </Link>
                </div>

                {/* Khối gợi ý size thông minh (Smart Size Recommendation) */}
                {sizeRecommendations?.best && (
                  <div className="mt-3 rounded-xl border border-lotus/25 bg-lotus/5 p-4 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lotus text-xs text-white">
                          🎯
                        </span>
                        <span className="text-xs font-bold uppercase tracking-wider text-lotus">
                          Gợi Ý Kích Cỡ Vừa Vặn Nhất
                        </span>
                      </div>
                      <span className="rounded-full bg-lotus px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                        Độ phù hợp {sizeRecommendations.best.score}%
                      </span>
                    </div>

                    <p className="mt-2 text-xs leading-relaxed text-stone-700">
                      Dựa trên số đo cơ thể bạn
                      {customerMeas?.bustCm && customerMeas?.waistCm ? (
                        <span className="font-semibold text-ink">
                          {" "}(Ngực: {customerMeas.bustCm}cm, Eo: {customerMeas.waistCm}cm
                          {customerMeas.hipCm ? `, Hông: ${customerMeas.hipCm}cm` : ""})
                        </span>
                      ) : null}
                      , hệ thống đề xuất bạn nên chọn{" "}
                      <button
                        type="button"
                        onClick={() => setSelectedGarmentId(sizeRecommendations.best.garmentSizeId)}
                        className="font-bold text-lotus underline hover:text-oxblood"
                      >
                        Size {sizeRecommendations.best.sizeLabel ?? "Chuẩn"}
                      </button>{" "}
                      để tôn dáng và thoải mái nhất khi cử động.
                    </p>

                    {/* Cảnh báo nếu size đang chọn có nguy cơ chật hoặc không vừa */}
                    {currentSizeRec && currentSizeRec.garmentSizeId !== sizeRecommendations.best.garmentSizeId && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                          <div>
                            <span className="font-bold">Lưu ý cho Size {currentSizeRec.sizeLabel}:</span>{" "}
                            {currentSizeRec.warnings.length > 0 ? (
                              <span>{currentSizeRec.warnings.join("; ")}. Có thể gây khó chịu khi mặc lâu.</span>
                            ) : (
                              <span>Độ vừa vặn đạt {currentSizeRec.score}%. Bạn vẫn có thể mặc được nếu thích phom dáng này.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Nhắc nhở nếu khách đã đăng nhập nhưng chưa có số đo */}
                {user && !customerMeas && !measLoading && (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-sand bg-parchment/60 p-3 text-xs text-stone-600">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-antique" />
                      Nhập số đo cá nhân để hệ thống tự động tính toán size vừa vặn nhất cho bạn.
                    </span>
                    <Link
                      href="/dashboard/customer/measurements"
                      className="ml-2 font-bold text-lotus hover:underline shrink-0"
                    >
                      Nhập ngay →
                    </Link>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2.5">
                  {group.sizes.map((s) => {
                    const active = s.garmentSizeId === selectedGarmentId;
                    const isBest = s.garmentSizeId === sizeRecommendations?.best?.garmentSizeId;
                    return (
                      <button
                        key={s.garmentSizeId}
                        type="button"
                        onClick={() => setSelectedGarmentId(s.garmentSizeId)}
                        className={`relative flex min-h-[46px] min-w-[70px] flex-col items-center justify-center rounded-xl px-4 py-1 text-xs font-bold uppercase tracking-wider transition ${
                          active
                            ? "bg-lotus text-white shadow-xs"
                            : isBest
                            ? "border-2 border-lotus/60 bg-lotus/5 text-lotus hover:bg-lotus/10"
                            : "border border-sand bg-white text-stone-700 hover:border-lotus"
                        }`}
                      >
                        <span>Size {s.sizeLabel ?? "Chuẩn"}</span>
                        {isBest && (
                          <span className={`text-[10px] lowercase font-medium ${active ? "text-amber-200" : "text-lotus font-bold"}`}>
                            vừa nhất
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Bảng số đo chi tiết thực tế của áo kết hợp đối chiếu số đo khách */}
                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-stone-700">
                    <span>Bảng số đo chi tiết trang phục (cm):</span>
                    {customerMeas && (
                      <span className="text-[11px] font-normal text-stone-500">
                        * Cột được đánh dấu là size bạn đang chọn
                      </span>
                    )}
                  </div>
                  {(() => {
                    const rows: Array<{
                      key: string;
                      label: string;
                      customerValue?: number | null;
                      get: (m: NonNullable<typeof selectedSize>["measurements"]) => number | null;
                    }> = [
                      { key: "shoulder", label: "Rộng vai", get: (m) => m?.shoulderCm ?? null },
                      {
                        key: "bust",
                        label: "Vòng ngực",
                        customerValue: customerMeas?.bustCm ?? null,
                        get: (m) => m?.bustCm ?? null,
                      },
                      {
                        key: "waist",
                        label: "Vòng eo",
                        customerValue: customerMeas?.waistCm ?? null,
                        get: (m) => m?.waistCm ?? null,
                      },
                      {
                        key: "hip",
                        label: "Vòng hông",
                        customerValue: customerMeas?.hipCm ?? null,
                        get: (m) => m?.hipCm ?? null,
                      },
                      { key: "length", label: "Chiều dài áo", get: (m) => m?.lengthCm ?? null },
                      { key: "sleeve", label: "Dài tay áo", get: (m) => m?.sleeveLengthCm ?? null },
                    ];
                    const visibleRows = rows.filter((r) =>
                      (group.sizes ?? []).some((s) => r.get(s.measurements) !== null),
                    );

                    if (visibleRows.length === 0) {
                      return (
                        <p className="rounded-xl border border-dashed border-sand bg-white p-4 text-xs text-stone-500">
                          Shop đang hoàn thiện số đo từng milimet cho mẫu này. Bạn có thể ướm thử AI
                          để kiểm tra độ vừa vặn phom dáng.
                        </p>
                      );
                    }

                    return (
                      <div className="overflow-x-auto rounded-xl border border-sand bg-white shadow-2xs">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-sand bg-parchment/60">
                              <th className="px-3.5 py-2.5 text-left font-bold text-stone-600">
                                Vị trí đo
                              </th>
                              {customerMeas && (
                                <th className="px-3 py-2.5 text-center font-bold text-lotus bg-lotus/10">
                                  Bạn
                                </th>
                              )}
                              {(group.sizes ?? []).map((s) => (
                                <th
                                  key={s.garmentSizeId}
                                  className={`px-3.5 py-2.5 text-center font-bold ${
                                    s.garmentSizeId === selectedGarmentId
                                      ? "bg-lotus text-white"
                                      : "text-stone-700"
                                  }`}
                                >
                                  {s.sizeLabel ?? "—"}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {visibleRows.map((r) => (
                              <tr
                                key={r.key}
                                className="border-b border-sand/50 last:border-0 hover:bg-mist"
                              >
                                <td className="px-3.5 py-2 font-medium text-stone-600">
                                  {r.label}
                                </td>
                                {customerMeas && (
                                  <td className="px-3 py-2 text-center font-bold text-lotus bg-lotus/5">
                                    {r.customerValue != null ? `${r.customerValue} cm` : "—"}
                                  </td>
                                )}
                                {(group.sizes ?? []).map((s) => {
                                  const v = r.get(s.measurements);
                                  const isSel = s.garmentSizeId === selectedGarmentId;
                                  
                                  // Hiển thị chỉ báo chênh lệch nếu có số đo của khách
                                  let diffHint: string | null = null;
                                  if (isSel && v != null && r.customerValue != null) {
                                    const diff = v - r.customerValue;
                                    if (diff < 0) {
                                      diffHint = `(Chật ${Math.abs(diff).toFixed(0)}cm)`;
                                    } else if (diff <= 5) {
                                      diffHint = `(Chuẩn)`;
                                    } else {
                                      diffHint = `(+${diff.toFixed(0)}cm)`;
                                    }
                                  }

                                  return (
                                    <td
                                      key={s.garmentSizeId}
                                      className={`px-3.5 py-2 text-center font-semibold ${
                                        isSel ? "bg-parchment text-lotus" : "text-ink"
                                      }`}
                                    >
                                      {v !== null ? `${v} cm` : "—"}
                                      {diffHint && (
                                        <div className={`text-[10px] font-normal ${diffHint.includes("Chật") ? "text-red-500 font-bold" : "text-emerald-600 font-bold"}`}>
                                          {diffHint}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Khối Banner Trải Nghiệm Thử Đồ AI Virtual Try-On */}
              <Link
                href={`/try-on?garmentSizeId=${selectedGarmentId}`}
                className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 via-mist to-white p-5 shadow-xs transition hover:border-emerald-500 hover:shadow-md"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold text-oxblood">
                      Ướm Thử Y Phục Với AI
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-stone-600">
                      Tải ảnh chân dung để kiểm tra phom dáng và sự hòa hợp màu sắc chỉ trong 3 giây.
                    </p>
                  </div>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 transition group-hover:bg-emerald-600 group-hover:text-white">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>

              {/* Lựa Chọn Khoảng Thời Gian Thuê (Date Range Picker) */}
              <div className="border-b border-sand pb-6">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-800">
                  Lịch Thuê Dự Kiến:
                </label>
                <div className="mt-3 rounded-2xl border border-sand bg-white p-4 sm:p-5 shadow-xs">
                  <RentalDateCalendar
                    startDate={startDate}
                    endDate={endDate}
                    minDate={today}
                    maxDate={maxDate}
                    fullyBookedDates={fullyBookedDates}
                    loading={calLoading}
                    onChange={(s, e) => {
                      setStartDate(s);
                      setEndDate(e);
                    }}
                  />
                  <div className="mt-4 flex items-center justify-between border-t border-sand/70 pt-3 text-xs">
                    <span className="text-stone-600">
                      Ngày nhận: <b className="text-ink">{formatShortDate(startDate)}</b>
                    </span>
                    <span className="text-stone-400">→</span>
                    <span className="text-stone-600">
                      Ngày trả: <b className="text-ink">{formatShortDate(endDate)}</b>
                    </span>
                  </div>
                  {blockedInRange.length > 0 && (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-center text-xs font-semibold text-red-600">
                      Khoảng ngày đã chọn chứa ngày kín lịch (
                      {blockedInRange.map(formatShortDate).join(", ")}). Vui lòng chọn khoảng khác.
                    </p>
                  )}
                </div>
              </div>

              {/* Nhóm Nút Hành Động (CTA Buttons) */}
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleBookNow}
                  disabled={blockedInRange.length > 0}
                  className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
                >
                  <ShoppingBag className="h-4 w-4" />
                  <span>Đặt Thuê Ngay</span>
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-lotus bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-lotus transition hover:bg-parchment active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Thêm Vào Giỏ</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleConsult}
                    disabled={isConsulting}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-sand bg-mist px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-700 transition hover:border-lotus hover:text-lotus disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
                  >
                    {isConsulting ? (
                      <Loader2 className="h-4 w-4 animate-spin text-lotus" />
                    ) : (
                      <Headphones className="h-4 w-4 text-lotus" />
                    )}
                    <span>{isConsulting ? "Đang gửi..." : "Tư Vấn Size"}</span>
                  </button>
                </div>

                {consultMsg && (
                  <p className="text-center text-xs font-semibold text-lotus">{consultMsg}</p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Phụ Kiện Phối Kèm (Pairing Accessories) */}
        {group && (selectedSize?.accessories ?? []).length > 0 && (
          <AccessoriesShowcase
            key={selectedSize?.garmentSizeId ?? "nosize"}
            accessories={selectedSize?.accessories ?? []}
          />
        )}

        {/* Hướng Dẫn Bảo Quản & Điều Kiện Thuê */}
        {group &&
          ((group.careInstructions ?? []).length > 0 ||
            (group.usageConditions ?? []).length > 0) && (
            <section className="mt-20 grid grid-cols-1 gap-8 md:grid-cols-2">
              {(group.careInstructions ?? []).length > 0 && (
                <div className="rounded-2xl border border-sand bg-white p-6 sm:p-8 shadow-xs">
                  <div className="flex items-center gap-2.5 font-display text-2xl font-bold text-oxblood">
                    <ShieldCheck className="h-5 w-5 text-lotus" />
                    <span>Hướng Dẫn Bảo Quản Tiêu Chuẩn Bảo Tàng</span>
                  </div>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-xs leading-relaxed text-stone-600 sm:text-sm">
                    {group.careInstructions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(group.usageConditions ?? []).length > 0 && (
                <div className="rounded-2xl border border-sand bg-white p-6 sm:p-8 shadow-xs">
                  <div className="flex items-center gap-2.5 font-display text-2xl font-bold text-oxblood">
                    <CheckCircle2 className="h-5 w-5 text-lotus" />
                    <span>Điều Kiện Bàn Giao &amp; Hoàn Cọc</span>
                  </div>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-xs leading-relaxed text-stone-600 sm:text-sm">
                    {group.usageConditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

        {/* Đánh Giá Của Khách Hàng (Reviews) */}
        {group && (
          <section className="mt-20 border-t border-sand pt-12">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-sand pb-4">
              <div>
                <h2 className="font-display text-3xl font-bold text-oxblood sm:text-4xl">
                  Đánh Giá Từ Khách Hàng
                </h2>
                {reviewsData && reviewsData.total > 0 ? (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-lg font-bold text-amber-500">
                      {reviewsData.averageRating.toFixed(1)} / 5.0
                    </span>
                    <div className="flex text-amber-400">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-4 w-4 ${
                            i < Math.round(reviewsData.averageRating)
                              ? "fill-amber-400 text-amber-400"
                              : "text-stone-300"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-stone-500">({reviewsData.total} nhận xét)</span>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">
                    Chưa có đánh giá nào cho mẫu cổ phục này.
                  </p>
                )}
              </div>

              {user ? (
                <button
                  type="button"
                  onClick={() => setShowReviewModal(true)}
                  className="rounded-xl border border-lotus px-5 py-2 text-xs font-semibold uppercase tracking-wider text-lotus transition hover:bg-lotus hover:text-white"
                >
                  {hasPublicReview ? "Chỉnh Sửa Đánh Giá" : "Viết Đánh Giá"}
                </button>
              ) : (
                <Link
                  href={`/login?redirect=/catalog/${garmentId}`}
                  className="rounded-xl border border-sand bg-parchment px-5 py-2 text-xs font-semibold uppercase tracking-wider text-stone-700 transition hover:border-lotus hover:text-lotus shadow-2xs"
                >
                  Đăng nhập để đánh giá
                </Link>
              )}
            </div>

            {/* Bộ lọc Review thông minh */}
            {reviewsData && reviewsData.total > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-sand/60 pb-4 text-xs">
                <span className="flex items-center gap-1.5 font-bold uppercase text-stone-500 mr-1 text-[11px]">
                  <Filter className="h-3.5 w-3.5" /> Lọc theo:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setReviewFilter({});
                    if (group.garmentId) {
                      getGarmentReviews(group.garmentId, {}).then((r) => r.data && setReviewsData(r.data));
                    }
                  }}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    !reviewFilter.rating && reviewFilter.hasMedia === undefined && !reviewFilter.fit
                      ? "bg-lotus text-white shadow-2xs"
                      : "bg-white border border-sand text-stone-600 hover:border-lotus"
                  }`}
                >
                  Tất cả ({reviewsData.total})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const f = { rating: 5 };
                    setReviewFilter(f);
                    if (group.garmentId) {
                      getGarmentReviews(group.garmentId, f).then((r) => r.data && setReviewsData(r.data));
                    }
                  }}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    reviewFilter.rating === 5
                      ? "bg-lotus text-white shadow-2xs"
                      : "bg-white border border-sand text-stone-600 hover:border-lotus"
                  }`}
                >
                  5 Sao ({reviewsData.ratingCounts?.[5] || 0})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const f = { rating: 4 };
                    setReviewFilter(f);
                    if (group.garmentId) {
                      getGarmentReviews(group.garmentId, f).then((r) => r.data && setReviewsData(r.data));
                    }
                  }}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    reviewFilter.rating === 4
                      ? "bg-lotus text-white shadow-2xs"
                      : "bg-white border border-sand text-stone-600 hover:border-lotus"
                  }`}
                >
                  4 Sao ({reviewsData.ratingCounts?.[4] || 0})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const f = { hasMedia: true };
                    setReviewFilter(f);
                    if (group.garmentId) {
                      getGarmentReviews(group.garmentId, f).then((r) => r.data && setReviewsData(r.data));
                    }
                  }}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    reviewFilter.hasMedia === true
                      ? "bg-lotus text-white shadow-2xs"
                      : "bg-white border border-sand text-stone-600 hover:border-lotus"
                  }`}
                >
                  Có ảnh / video ({reviewsData.mediaCount || 0})
                </button>

                {(reviewsData.fitCounts?.true_to_size || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const f = { fit: "true_to_size" };
                      setReviewFilter(f);
                      if (group.garmentId) {
                        getGarmentReviews(group.garmentId, f).then((r) => r.data && setReviewsData(r.data));
                      }
                    }}
                    className={`rounded-full px-3 py-1 font-semibold transition ${
                      reviewFilter.fit === "true_to_size"
                        ? "bg-lotus text-white shadow-2xs"
                        : "bg-white border border-sand text-stone-600 hover:border-lotus"
                    }`}
                  >
                    Vừa vặn chuẩn ({reviewsData.fitCounts.true_to_size})
                  </button>
                )}
              </div>
            )}

            {reviewsData && reviewsData.reviews.length > 0 ? (
              <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {reviewsData.reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="flex flex-col justify-between rounded-xl border border-sand bg-white p-5 shadow-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-lotus text-xs font-bold text-white">
                            {rev.customer?.profile?.fullName?.[0]?.toUpperCase() || "K"}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-ink">
                              {rev.customer?.profile?.fullName || "Khách hàng"}
                            </p>
                            <p className="text-[11px] text-stone-400">
                              {new Date(rev.createdAt).toLocaleDateString("vi-VN")}
                            </p>
                          </div>
                        </div>

                        {/* Fit Feedback Badge */}
                        {rev.fitFeedback && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                              rev.fitFeedback === "true_to_size"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : rev.fitFeedback === "tight"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}
                          >
                            {rev.fitFeedback === "true_to_size"
                              ? "Vừa vặn"
                              : rev.fitFeedback === "tight"
                              ? "Hơi chật"
                              : "Hơi rộng"}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex text-amber-400">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3 w-3 ${
                              i < rev.rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-stone-300"
                            }`}
                          />
                        ))}
                      </div>

                      {rev.comment && (
                        <p className="mt-2.5 text-xs leading-relaxed text-stone-600">
                          {rev.comment}
                        </p>
                      )}

                      {/* Review Media Previews */}
                      {rev.images && rev.images.length > 0 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                          {rev.images.map((imgUrl, imgIdx) => (
                            <a
                              key={imgIdx}
                              href={imgUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-sand transition hover:opacity-90"
                            >
                              <img
                                src={imgUrl}
                                alt="Ảnh review"
                                className="h-full w-full object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Phản hồi từ Staff */}
                      {rev.staffReply && (
                        <div className="mt-3 rounded-lg border border-sand bg-parchment/60 p-2.5 text-xs">
                          <p className="font-bold text-lotus text-[11px]">Phản hồi từ Atelier:</p>
                          <p className="mt-0.5 text-stone-700 text-[11px] leading-relaxed">
                            {rev.staffReply}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : reviewsData && reviewsData.total > 0 ? (
              <div className="mt-8 rounded-xl border border-dashed border-sand bg-parchment/40 p-8 text-center text-xs text-stone-500">
                Không tìm thấy đánh giá nào phù hợp với bộ lọc đã chọn.
              </div>
            ) : null}
          </section>
        )}

        {/* Modal đánh giá */}
        {showReviewModal && group && group.garmentId && (
          <ReviewModal
            garmentId={group.garmentId}
            garmentName={group.name}
            onClose={() => setShowReviewModal(false)}
            onSuccess={() => {
              if (group.garmentId) {
                getGarmentReviews(group.garmentId).then((revRes) => {
                  if (revRes.success && revRes.data) {
                    setReviewsData(revRes.data);
                  }
                });
              }
            }}
          />
        )}
      </main>

      <CustomerFooter />
    </div>
  );
}

function AccessoriesShowcase({
  accessories,
}: {
  accessories: GroupedGarmentAccessory[];
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const safeIdx = Math.min(selectedIdx, Math.max(0, accessories.length - 1));
  const selected = accessories[safeIdx];

  return (
    <section className="mt-20 rounded-2xl border border-sand bg-white p-6 sm:p-10 shadow-xs">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <span className="text-xs font-bold uppercase tracking-widest text-bronze">
            Trang Sức &amp; Phụ Kiện Cung Đình
          </span>
          <h2 className="mt-1 font-display text-3xl font-bold text-oxblood sm:text-4xl">
            Phối Hợp Phụ Kiện Chuẩn Bộ
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-stone-600 sm:text-sm">
            Mũ mão, hài thêu, quạt lụa và thẻ bài được thiết kế đồng bộ theo từng phẩm cấp trang phục.
          </p>

          <div className="mt-6 space-y-3">
            {accessories.map((item, i) => {
              const active = i === safeIdx;
              return (
                <button
                  key={item.accessoryId}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`flex w-full items-center gap-4 rounded-xl border p-3.5 text-left transition ${
                    active
                      ? "border-lotus bg-parchment/60 ring-2 ring-lotus/20"
                      : "border-sand bg-mist hover:border-lotus"
                  }`}
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                        Phụ kiện
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-bold text-ink sm:text-sm">{item.name}</h3>
                    <p className="text-xs text-bronze font-medium">Số lượng: {item.quantity}</p>
                    <p className="mt-0.5 text-[11px] text-stone-500">
                      {item.isIncluded
                        ? "Đi kèm miễn phí trong bộ"
                        : `+ ${formatVND(item.extraPrice)} / ngày`}
                      {item.replacementValue > 0 &&
                        ` · Đền ${formatVND(item.replacementValue)} nếu mất/hỏng`}
                    </p>
                  </div>

                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      active ? "bg-lotus text-white" : "border border-sand bg-white text-stone-400"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview ảnh phụ kiện */}
        <div className="lg:col-span-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-sand bg-stone-100 shadow-sm">
            {selected?.imageUrl ? (
              <img
                key={selected.accessoryId}
                src={selected.imageUrl}
                alt={selected.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                Phụ kiện di sản
              </div>
            )}
            {selected && (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 p-4 backdrop-blur-xs text-white">
                <p className="truncate text-xs font-bold sm:text-sm">{selected.name}</p>
                <p className="text-[11px] text-stone-300">
                  {selected.isIncluded
                    ? "Đã bao gồm trong bộ trang phục"
                    : `Thuê thêm: ${formatVND(selected.extraPrice)}/ngày`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}