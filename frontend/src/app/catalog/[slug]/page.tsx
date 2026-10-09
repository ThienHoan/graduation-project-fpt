"use client";

import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { useAuth } from "@/components/auth/auth-provider";
import { getGarmentsGrouped, getGarmentReviews, getSizeAvailabilityCalendar, trackGarmentView, type GarmentGrouped, type GroupedGarmentAccessory, type ReviewResponse } from "@/lib/api";
import { RentalDateCalendar } from "@/components/customer/rental-date-calendar";
import { addToCart, cartCount } from "@/lib/cart";
import { getMyChatConversation, sendProductCardMessage } from "@/lib/chat";
import { ReviewModal } from "@/components/customer/review-modal";

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
  const [reviewsData, setReviewsData] = useState<{ reviews: ReviewResponse[]; averageRating: number; total: number } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 2));
  const maxDate = addDays(today, 365);
  const [fullyBookedDates, setFullyBookedDates] = useState<Set<string>>(new Set());
  const [calLoading, setCalLoading] = useState(false);
  const { user } = useAuth();
  
  const hasPublicReview = Boolean(user && reviewsData?.reviews.some((r) => r.customerId === user.id));

  useEffect(() => {
    // Tìm garment trong danh sách grouped
    getGarmentsGrouped().then((res) => {
      if (res.success && res.data) {
        for (const g of res.data) {
          const found = g.sizes.find((s) => s.garmentSizeId === garmentId);
          if (found) {
            setGroup(g);
            setSelectedGarmentId(garmentId);
            setLoading(false);
            
            // Lấy reviews
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

  // Tải lịch còn hàng của size đang chọn (12 tháng tới) để disable ngày hết hàng
  useEffect(() => {
    if (!selectedGarmentId) return;
    let cancelled = false;
    setCalLoading(true);
    getSizeAvailabilityCalendar(selectedGarmentId, today, maxDate).then((res) => {
      if (cancelled) return;
      setCalLoading(false);
      if (res.success && res.data) {
        setFullyBookedDates(new Set(res.data.days.filter((d) => !d.available).map((d) => d.date)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedGarmentId]);

  // Nếu ngày bắt đầu đang chọn rơi vào ngày disable (mặc định ban đầu hoặc
  // sau khi đổi size), tự dời về ngày trống gần nhất và thu khoảng còn 1 ngày.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullyBookedDates]);

  // Các ngày hết hàng nằm gọn trong khoảng đang chọn
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

  const selectedSize = group?.sizes.find((s) => s.garmentSizeId === selectedGarmentId) ?? group?.sizes[0];

async function handleConsult() {
  if (!group || !selectedSize) return;
    console.log("group:", group);
  console.log("group.garmentId:", group.garmentId);
  console.log("selectedSize:", selectedSize);
  const result = await getMyChatConversation();
  if (!result.success || !result.data) {
    setConsultMsg("Vui lòng đăng nhập để sử dụng tính năng tư vấn.");
    setTimeout(() => setConsultMsg(null), 3000);
    return;
  }

  const conversation = result.data;

  if (!group.garmentId) {
    setConsultMsg("Không tìm thấy thông tin sản phẩm.");
    setTimeout(() => setConsultMsg(null), 3000);
    return;
  }

  const sendResult = await sendProductCardMessage({
    conversationId: conversation.id,
    productId: group.garmentId,
  });

  if (!sendResult.success) {
    setConsultMsg("Không thể gửi sản phẩm. Vui lòng thử lại.");
    setTimeout(() => setConsultMsg(null), 3000);
    return;
  }

  setConsultMsg("Đã gửi thông tin sản phẩm đến tư vấn viên!");
  setTimeout(() => setConsultMsg(null), 3000);
}

  function handleAddToCart() {
    if (!group || !selectedSize) return;
    const s = selectedSize;
    addToCart({
      garmentSizeId: s.garmentSizeId,
      garmentId: group.garmentId,
      name: group.name + (s.sizeLabel ? ` (Size ${s.sizeLabel})` : ""),
      sizeLabel: s.sizeLabel,
      dailyPrice: s.dailyPrice,
      depositAmount: s.depositAmount,
      imageUrl: group.imageUrl,
    });
    setAddedMsg("Đã thêm vào giỏ!");
    setTimeout(() => setAddedMsg(null), 2000);
  }

  function handleBookNow() {
    if (!group || !selectedSize || blockedInRange.length > 0) return;
    const s = selectedSize;
    addToCart({
      garmentSizeId: s.garmentSizeId,
      garmentId: group.garmentId,
      name: group.name + (s.sizeLabel ? ` (Size ${s.sizeLabel})` : ""),
      sizeLabel: s.sizeLabel,
      dailyPrice: s.dailyPrice,
      depositAmount: s.depositAmount,
      imageUrl: group.imageUrl,
    });
    const p = new URLSearchParams({ startDate, endDate });
    router.push(`/booking/date-selection?${p.toString()}`);
  }

  return (
    <div className="min-h-screen bg-mist text-ink">
      <CustomerNavbar active="collection" cartHref="/booking/date-selection" />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-24 sm:px-6 lg:px-8 lg:pt-28">
        <nav className="mb-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
          <Link href="/catalog" className="transition hover:text-lotus">Bộ sưu tập</Link>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span>{group?.categoryName ?? "—"}</span>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-ink">{loading ? "..." : group?.name}</span>
        </nav>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-stone-400">Đang tải...</div>
        ) : group ? (
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
            {/* Gallery */}
            <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
              {/* Main viewer */}
              <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border border-sand bg-lotus/10">
                {group.images && group.images.length > 0 ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={group.images[activeImageIdx]?.imageUrl ?? group.imageUrl ?? ""}
                      alt={group.name}
                      className="h-full w-full object-cover transition-opacity duration-300"
                    />
                    {/* Prev / Next arrows — only if more than 1 image */}
                    {group.images.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveImageIdx((i) => (i - 1 + group.images.length) % group.images.length)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 text-ink shadow backdrop-blur-sm transition hover:bg-white"
                          aria-label="Ảnh trước"
                        >
                          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveImageIdx((i) => (i + 1) % group.images.length)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 text-ink shadow backdrop-blur-sm transition hover:bg-white"
                          aria-label="Ảnh tiếp"
                        >
                          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                        </button>
                        {/* Dot indicators */}
                        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                          {group.images.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setActiveImageIdx(idx)}
                              className={`h-1.5 rounded-full transition-all ${idx === activeImageIdx ? "w-5 bg-white" : "w-1.5 bg-white/50"}`}
                              aria-label={`Ảnh ${idx + 1}`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : group.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.imageUrl} alt={group.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="material-symbols-outlined text-[80px] text-antique/30">checkroom</span>
                )}
              </div>

              {/* Thumbnail strip — only if more than 1 image */}
              {group.images && group.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {group.images.map((img, idx) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setActiveImageIdx(idx)}
                      className={`relative flex-none h-20 w-16 overflow-hidden rounded border-2 transition ${idx === activeImageIdx ? "border-lotus" : "border-sand hover:border-antique"
                        }`}
                      aria-label={`Xem ảnh ${idx + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.imageUrl} alt={img.altText ?? group.name} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 lg:pt-6">
              <div className="relative mb-8 border-b border-sand/80 pb-8">
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-antique">{group.categoryName} · Bộ sưu tập</p>
                <h1 className="mt-3 font-display text-5xl text-ink sm:text-6xl">{group.name}</h1>
                <div className="mt-6 flex flex-wrap items-end gap-4">
                  <p className="text-3xl font-semibold text-lotus">
                    {selectedSize ? formatVND(selectedSize.dailyPrice) + " / ngày" : "—"}
                  </p>
                  <p className="pb-1 text-sm text-stone-500">
                    Tiền cọc: <span className="font-semibold text-ink">{selectedSize ? formatVND(selectedSize.depositAmount) : "—"}</span>
                  </p>
                </div>
              </div>

              <div className="mb-8">
                <h2 className="mb-4 font-display text-3xl text-ink">Thông số chi tiết</h2>
                {(() => {
                  const specs: Array<{ label: string; value: string }> = [];
                  if (group?.description) specs.push({ label: "Mô tả", value: group.description });
                  if (group?.color) specs.push({ label: "Màu sắc", value: group.color });
                  if ((group?.material ?? []).length > 0) specs.push({ label: "Chất liệu", value: (group?.material ?? []).join(", ") });
                  if ((group?.occasion ?? []).length > 0) specs.push({ label: "Dịp sử dụng", value: (group?.occasion ?? []).join(", ") });
                  return specs.length > 0 ? (
                    <ul className="space-y-4">
                      {specs.map((spec) => (
                        <li key={spec.label} className="flex items-center justify-between gap-4 border-b border-sand/70 pb-3 text-sm">
                          <span className="text-stone-500">{spec.label}</span>
                          <span className="text-right font-medium text-ink">{spec.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-stone-500">Shop đang cập nhật thông số chi tiết cho mẫu này.</p>
                  );
                })()}
              </div>

              <div className="space-y-8">
                {/* Date range picker */}
                <div>
                  <label className="mb-3 block text-sm font-semibold uppercase tracking-[0.18em] text-ink">Khoảng thời gian thuê</label>
                  <div className="rounded-xl border border-sand bg-white p-4 sm:p-5">
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
                    <p className="mt-3 text-center text-sm text-stone-600">
                      Nhận: <span className="font-semibold text-ink">{formatShortDate(startDate)}</span>
                      {" → "}
                      Trả: <span className="font-semibold text-ink">{formatShortDate(endDate)}</span>
                    </p>
                    {blockedInRange.length > 0 && (
                      <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-600">
                        Khoảng ngày chứa ngày hết hàng ({blockedInRange.map(formatShortDate).join(", ")}). Vui lòng chọn lại ngày.
                      </p>
                    )}
                  </div>
                </div>

                {/* Size - interactive */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <label className="text-sm font-semibold uppercase tracking-[0.18em] text-ink">Kích thước</label>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {group.sizes.map((s) => {
                      const active = s.garmentSizeId === selectedGarmentId;
                      return (
                        <button
                          key={s.garmentSizeId}
                          type="button"
                          onClick={() => setSelectedGarmentId(s.garmentSizeId)}
                          className={
                            active
                              ? "flex h-12 min-w-[3rem] items-center justify-center rounded border border-lotus bg-parchment px-3 text-sm font-semibold text-lotus"
                              : "flex h-12 min-w-[3rem] items-center justify-center rounded border border-sand bg-white px-3 text-sm text-ink transition hover:border-antique"
                          }
                        >
                          {s.sizeLabel ?? "—"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Size measurements */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <label className="text-sm font-semibold uppercase tracking-[0.18em] text-ink">Số đo trang phục (cm)</label>
                  </div>
                  {(() => {
                    const rows: Array<{ key: string; label: string; get: (m: NonNullable<typeof selectedSize>["measurements"]) => number | null }> = [
                      { key: "shoulder", label: "Vai", get: (m) => m?.shoulderCm ?? null },
                      { key: "bust", label: "Ngực", get: (m) => m?.bustCm ?? null },
                      { key: "waist", label: "Eo", get: (m) => m?.waistCm ?? null },
                      { key: "hip", label: "Hông", get: (m) => m?.hipCm ?? null },
                      { key: "length", label: "Dài áo", get: (m) => m?.lengthCm ?? null },
                      { key: "sleeve", label: "Dài tay", get: (m) => m?.sleeveLengthCm ?? null },
                    ];
                    const visibleRows = rows.filter((r) =>
                      (group?.sizes ?? []).some((s) => r.get(s.measurements) !== null),
                    );
                    if (visibleRows.length === 0) {
                      return (
                        <p className="rounded-lg border border-dashed border-sand bg-white px-4 py-3 text-sm text-stone-500">
                          Shop chưa cập nhật số đo chi tiết cho mẫu này. Bạn có thể dùng tính năng thử đồ AI hoặc liên hệ tư vấn để chọn size.
                        </p>
                      );
                    }
                    return (
                      <div className="overflow-x-auto rounded-lg border border-sand bg-white">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-sand bg-parchment/60">
                              <th className="px-4 py-2.5 text-left font-semibold text-stone-500">Số đo</th>
                              {(group?.sizes ?? []).map((s) => (
                                <th
                                  key={s.garmentSizeId}
                                  className={`px-4 py-2.5 text-center font-semibold ${s.garmentSizeId === selectedGarmentId ? "text-lotus" : "text-ink"}`}
                                >
                                  {s.sizeLabel ?? "—"}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {visibleRows.map((r) => (
                              <tr key={r.key} className="border-b border-sand/60 last:border-0">
                                <td className="px-4 py-2.5 text-stone-500">{r.label}</td>
                                {(group?.sizes ?? []).map((s) => {
                                  const v = r.get(s.measurements);
                                  const active = s.garmentSizeId === selectedGarmentId;
                                  return (
                                    <td key={s.garmentSizeId} className={`px-4 py-2.5 text-center font-medium ${active ? "bg-parchment/50 text-lotus" : "text-ink"}`}>
                                      {v !== null ? v : "—"}
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
                  <p className="mt-2 text-xs leading-5 text-stone-500">
                    Đây là số đo thực tế của áo. Hãy đối chiếu với số đo cơ thể của bạn tại{" "}
                    <Link href="/dashboard/customer/measurements" className="font-semibold text-lotus hover:underline">
                      Số đo của tôi
                    </Link>{" "}
                    để chọn size vừa vặn — không dùng số đo áo làm số đo cơ thể.
                  </p>
                </div>

                <Link href={`/try-on?garmentSizeId=${selectedGarmentId}`} className="group relative block overflow-hidden rounded-xl border border-antique/30 bg-gradient-to-r from-[#f9f5f0] to-white p-6 transition hover:border-antique/60">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-lotus">magic_button</span>
                    <div>
                      <h2 className="font-display text-3xl text-ink">Thử đồ AI <span className="font-sans text-base font-normal text-stone-500">(mô phỏng thử trên ảnh)</span></h2>
                      <p className="mt-2 max-w-xl text-sm leading-7 text-stone-600">Tải ảnh chân dung để xem thử cách bộ trang phục ôm dáng trước khi đặt thuê.</p>
                      <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-lotus">Khám phá ngay<span className="material-symbols-outlined text-[16px]">arrow_forward</span></span>
                    </div>
                  </div>
                </Link>
              </div>

              <div className="mt-8 space-y-3">
                <button
                  type="button"
                  onClick={handleBookNow}
                  disabled={blockedInRange.length > 0}
                  title={blockedInRange.length > 0 ? "Khoảng ngày chứa ngày hết hàng, vui lòng chọn lại" : undefined}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Đặt thuê ngay
                  <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddToCart}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-lotus transition hover:bg-parchment"
                >
                  Thêm vào giỏ
                  <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                </button>
                {(!user || user.role === "customer") && (
                  <button
                    type="button"
                    onClick={handleConsult}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-jade transition hover:bg-jade/5"
                  >
                    Tư vấn
                    <span className="material-symbols-outlined text-[18px]">support_agent</span>
                  </button>
                )}
                {addedMsg && <p className="text-center text-sm font-medium text-jade">{addedMsg}</p>}
                {consultMsg && <p className="text-center text-sm font-medium text-jade">{consultMsg}</p>}
                <p className="text-center text-sm text-stone-500">Đã bao gồm công là ủi, làm sạch và hỗ trợ chỉnh sửa cơ bản.</p>
              </div>

              </div>
          </div>
        ) : null}

        {/* Pairing accessories (real links of this garment) */}
        {group && (group.accessories ?? []).length > 0 && (
          <AccessoriesShowcase accessories={group.accessories ?? []} />
        )}

        {/* Care & usage terms */}
        {group && ((group?.careInstructions ?? []).length > 0 || (group?.usageConditions ?? []).length > 0) && (
          <section className="mt-24 grid gap-6 md:grid-cols-2">
            {(group?.careInstructions ?? []).length > 0 && (
              <div className="rounded-xl border border-sand bg-white p-6 sm:p-8">
                <h2 className="flex items-center gap-2 font-display text-3xl text-ink">
                  <span className="material-symbols-outlined text-lotus">dry_cleaning</span>
                  Hướng dẫn bảo quản
                </h2>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-stone-600">
                  {(group?.careInstructions ?? []).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {(group?.usageConditions ?? []).length > 0 && (
              <div className="rounded-xl border border-sand bg-white p-6 sm:p-8">
                <h2 className="flex items-center gap-2 font-display text-3xl text-ink">
                  <span className="material-symbols-outlined text-lotus">contract</span>
                  Điều kiện sử dụng
                </h2>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-stone-600">
                  {(group?.usageConditions ?? []).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Reviews Section */}
        {group && (
          <section className="mt-24">
            <div className="mb-10 flex items-end justify-between border-b border-sand pb-4">
              <div>
                <h2 className="font-display text-4xl text-ink">Đánh giá từ khách hàng</h2>
                {reviewsData && reviewsData.total > 0 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xl font-bold text-yellow-500">{reviewsData.averageRating.toFixed(1)}</span>
                    <span className="material-symbols-outlined text-yellow-500" style={{ fontVariationSettings: '"FILL" 1' }}>star</span>
                    <span className="text-stone-500">({reviewsData.total} đánh giá)</span>
                  </div>
                ) : (
                  <p className="mt-2 text-stone-500">Chưa có đánh giá nào cho sản phẩm này.</p>
                )}
              </div>
              {user && (
                <button
                  onClick={() => setShowReviewModal(true)}
                  className="rounded-xl border border-lotus text-lotus px-6 py-2.5 font-semibold transition hover:bg-lotus hover:text-white"
                >
                  {hasPublicReview ? "Chỉnh sửa đánh giá" : "Viết đánh giá"}
                </button>
              )}
            </div>

            {reviewsData && reviewsData.reviews.length > 0 && (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {reviewsData.reviews.map((review) => (
                  <div key={review.id} className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-lotus/10 text-lotus font-semibold">
                        {review.customer?.profile?.fullName?.[0]?.toUpperCase() || "K"}
                      </div>
                      <div>
                        <p className="font-semibold text-ink">{review.customer?.profile?.fullName || "Khách hàng"}</p>
                        <p className="text-xs text-stone-400">{new Date(review.createdAt).toLocaleDateString("vi-VN")}</p>
                      </div>
                    </div>
                    <div className="mb-3 flex">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span 
                          key={i} 
                          className={`material-symbols-outlined text-[18px] ${
                            i < review.rating ? "text-yellow-500 [font-variation-settings:'FILL'1]" : "text-stone-300"
                          }`}
                        >
                          star
                        </span>
                      ))}
                    </div>
                    {review.comment && (
                      <p className="text-sm leading-relaxed text-stone-600 mb-3">{review.comment}</p>
                    )}
                    
                    {/* Media */}
                    {(review.images?.length > 0 || review.video) && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {review.images?.map((img, idx) => (
                          <div key={idx} className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-sand">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img} alt="Review image" className="h-full w-full object-cover" />
                          </div>
                        ))}
                        {review.video && (
                          <div className="h-20 w-32 flex-shrink-0 overflow-hidden rounded-lg border border-sand bg-black">
                            <video src={review.video} controls className="h-full w-full object-contain" />
                          </div>
                        )}
                      </div>
                    )}

                    {review.staffReply && (
                      <div className="mt-4 rounded-lg bg-stone-50 p-4 border border-sand">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-[16px] text-lotus">storefront</span>
                          <span className="text-xs font-semibold uppercase tracking-wider text-lotus">
                            Shop phản hồi
                          </span>
                        </div>
                        <p className="text-sm text-stone-600">{review.staffReply}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {showReviewModal && group?.garmentId && (
          <ReviewModal
            garmentId={group.garmentId}
            garmentName={group.name}
            onClose={() => setShowReviewModal(false)}
            onSuccess={() => {
              setShowReviewModal(false);
              // Refresh reviews
              getGarmentReviews(group.garmentId!).then((revRes) => {
                if (revRes.success && revRes.data) {
                  setReviewsData(revRes.data);
                }
              });
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
    <section className="mt-24 rounded-lg border border-sand bg-mist px-6 py-12 lg:px-12">
      <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <h2 className="font-display text-5xl text-ink">Phối hợp phụ kiện</h2>
          <p className="mt-4 text-base leading-8 text-stone-600">Nhấn vào từng phụ kiện để xem ảnh chi tiết.</p>
          <div className="mt-8 space-y-4">
            {accessories.map((item, i) => {
              const active = i === safeIdx;
              return (
                <button
                  key={item.accessoryId}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`flex w-full items-center gap-4 rounded-lg border bg-white p-4 text-left transition ${
                    active ? "border-lotus ring-2 ring-lotus/20" : "border-sand hover:border-antique"
                  }`}
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={item.name} className="h-16 w-16 rounded object-cover" src={item.imageUrl} />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded bg-mist">
                      <span className="material-symbols-outlined text-2xl text-stone-300">diamond</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold text-ink">{item.name}</h3>
                    <p className="text-sm text-antique">Số lượng: {item.quantity}</p>
                    <p className="text-xs text-stone-500">
                      {item.isIncluded ? "Đi kèm miễn phí" : `+ ${formatVND(item.extraPrice)} / ngày`}
                      {item.replacementValue > 0 && ` · Đền ${formatVND(item.replacementValue)} nếu mất/hỏng`}
                    </p>
                  </div>
                  <span className={`material-symbols-outlined ${active ? "text-lotus" : "text-stone-500"}`}>
                    {active ? "check_circle" : "add_circle"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-sand bg-lotus/5">
          {selected?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={selected.accessoryId}
              alt={selected.name}
              src={selected.imageUrl}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="material-symbols-outlined text-[60px] text-antique/30">diamond</span>
          )}
          {selected && (
            <div className="absolute inset-x-0 bottom-0 bg-black/55 px-4 py-2.5 backdrop-blur-sm">
              <p className="truncate text-sm font-semibold text-white">{selected.name}</p>
              <p className="text-xs text-white/80">Số lượng: {selected.quantity}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}