"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { BookingStatusStepper } from "@/components/customer/booking-status-stepper";
import { getBooking } from "@/lib/api";
import type { BookingResponse } from "@/lib/api";
import { statusBadgeClass, statusOf } from "@/lib/status-labels";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";
import { HandoverSummary } from "@/components/customer/handover-summary";
import {
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Copy,
  Check,
  Printer,
  MessageSquare,
  Calendar,
  Truck,
  Store,
  ShieldCheck,
  Award,
  FileText,
  MapPin,
  CreditCard,
  Clock,
  Shirt,
  PhoneCall,
  ChevronRight,
  HelpCircle,
  QrCode,
  RotateCcw,
} from "lucide-react";

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}

function formatDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const PICKUP_LABELS: Record<string, { label: string; desc: string }> = {
  delivery: {
    label: "Giao hàng tận nơi",
    desc: "Đóng gói kỹ lưỡng và giao đến địa chỉ theo khung giờ hẹn.",
  },
  store_pickup: {
    label: "Nhận tại Atelier",
    desc: "Thử lại dáng áo và nhận trực tiếp tại xưởng với chuyên viên.",
  },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  payos: "Cổng thanh toán PayOS (QR / Chuyển khoản)",
  cod: "Thanh toán cọc / trực tiếp khi nhận đồ",
  bank_transfer: "Chuyển khoản ngân hàng",
  cash: "Tiền mặt tại xưởng",
  qr_code: "Quét mã QR thanh toán",
};

function GarmentThumbnail({
  imageUrl,
  alt,
}: {
  imageUrl?: string | null;
  alt: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || hasError) {
    return (
      <div className="relative h-20 w-20 sm:h-24 sm:w-24 shrink-0 overflow-hidden rounded-2xl border border-sand/80 bg-stone-100 shadow-2xs flex flex-col items-center justify-center text-stone-400 print:h-16 print:w-16 print:rounded-lg print:border-stone-400">
        <Shirt className="h-8 w-8 text-amber-700/50 print:h-6 print:w-6" />
        <span className="text-[10px] font-medium text-stone-500 mt-1 print:text-[8px]">Cổ phục</span>
      </div>
    );
  }

  return (
    <div className="relative h-20 w-20 sm:h-24 sm:w-24 shrink-0 overflow-hidden rounded-2xl border border-sand/80 bg-stone-100 shadow-2xs group print:h-16 print:w-16 print:rounded-lg print:border-stone-400">
      <img
        src={imageUrl}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        referrerPolicy="no-referrer"
        loading="eager"
        onError={(e) => {
          console.warn("[GarmentThumbnail] Failed to load image:", imageUrl, e);
          setHasError(true);
        }}
      />
    </div>
  );
}

function BookingSuccessInner() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("bookingId");
  const displayCode = bookingId ? `#${bookingId.slice(0, 8).toUpperCase()}` : "#—";

  const [booking, setBooking] = useState<BookingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshBooking = useCallback(async () => {
    if (!bookingId) return;
    const res = await getBooking(bookingId);
    if (res.success && res.data) {
      setBooking(res.data);
      setError(null);
    } else {
      setError(res.message ?? "Không tải được thông tin đơn thuê.");
    }
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      return;
    }
    refreshBooking()
      .catch(() => setError("Không tải được thông tin đơn thuê."))
      .finally(() => setLoading(false));
  }, [bookingId, refreshBooking]);

  useRealtimeInvalidation(bookingId ? { bookings: refreshBooking } : {}, Boolean(bookingId));

  function handleCopyCode() {
    if (!bookingId) return;
    navigator.clipboard.writeText(bookingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      {/* Ẩn navbar khi in */}
      <div className="print:hidden">
        <CustomerNavbar />
      </div>

      <main className="flex-1 px-4 py-8 sm:py-12 print:p-0 print:m-0">
        <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8 print:max-w-none print:space-y-4">
          
          {/* Breadcrumb Navigation - Ẩn khi in */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-stone-500 print:hidden">
            <Link href="/" className="hover:text-lotus transition">Trang chủ</Link>
            <ChevronRight className="h-3 w-3 text-stone-400" />
            <Link href="/catalog" className="hover:text-lotus transition">Bộ sưu tập</Link>
            <ChevronRight className="h-3 w-3 text-stone-400" />
            <span className="font-semibold text-ink">Xác nhận giữ lịch</span>
          </nav>

          {/* =========================================================================
              HEADER IN ẤN CHUYÊN DỤNG (Chỉ hiển thị khi bấm In/Lưu PDF biên nhận)
             ========================================================================= */}
          <div className="hidden print:block border-b-2 border-stone-800 pb-4 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 uppercase font-serif">
                  Cổ Phục Rental Atelier
                </h1>
                <p className="text-xs text-stone-600 mt-0.5">
                  Không gian Cổ phục & Trang phục Truyền thống Việt Nam
                </p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Địa chỉ xưởng: 320 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh • Hotline: 0901.999.868
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block border border-stone-800 px-3 py-1 text-xs font-bold uppercase tracking-wider text-stone-900">
                  Biên Nhận Giữ Lịch
                </span>
                <p className="text-xs font-bold text-stone-800 mt-1">Mã đơn: {displayCode}</p>
                <p className="text-[10px] text-stone-500">
                  Ngày lập: {new Date().toLocaleDateString("vi-VN")}
                </p>
              </div>
            </div>
          </div>

          {/* =========================================================================
              1. CELEBRATORY HERO BANNER (Giao diện màn hình - Tinh tế, Hoàng cung)
             ========================================================================= */}
          <section className="relative overflow-hidden rounded-3xl border border-sand bg-gradient-to-br from-white via-mist/40 to-parchment/30 p-6 sm:p-10 shadow-xs print:hidden">
            {/* Background luxury gradient accents */}
            <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-radial from-amber-400/15 to-transparent blur-3xl" />
            <div className="pointer-events-none absolute -right-16 -bottom-16 h-48 w-48 rounded-full bg-radial from-lotus/15 to-transparent blur-3xl" />

            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="flex items-start sm:items-center gap-4 sm:gap-5">
                {/* Royal Seal Badge */}
                <div className="relative flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 via-lotus to-oxblood p-0.5 shadow-md">
                  <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-white text-lotus">
                    <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-600" />
                  </div>
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-gradient-to-r from-amber-500 to-amber-600 text-[10px] font-bold text-white items-center justify-center shadow-xs">✦</span>
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Đặt Giữ Lịch Thành Công</span>
                    </span>
                    <span className="text-xs text-stone-400">•</span>
                    <span className="text-xs text-stone-500">Mã đơn: <strong className="text-ink font-semibold">{displayCode}</strong></span>
                  </div>
                  <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-ink">
                    Cổ Phục Đã Sẵn Sàng Chờ Bạn
                  </h1>
                  <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
                    Atelier Cổ Phục Rental đã ghi nhận yêu cầu và giữ lịch trang phục. Nghệ nhân xưởng sẽ tiến hành kiểm định, là phẳng và đóng gói chuẩn quy cách trước giờ bàn giao.
                  </p>
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0 pt-2 md:pt-0">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-2 rounded-xl border border-sand bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-lotus hover:text-lotus active:scale-95"
                >
                  <Printer className="h-4 w-4 text-stone-500" />
                  <span>In / Lưu biên nhận</span>
                </button>
                <Link
                  href="/dashboard/customer"
                  className="inline-flex items-center gap-2 rounded-xl bg-lotus px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood active:scale-95"
                >
                  <span>Quản lý đơn thuê</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>

          {/* =========================================================================
              2. MAIN CONTENT: 2-COLUMN LUXURY GRID LAYOUT (8 cols / 4 cols)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start print:block print:space-y-6">
            
            {/* ── CỘT TRÁI (8 CỘT): TIẾN TRÌNH & CHI TIẾT TRANG PHỤC ────────────────── */}
            <div className="lg:col-span-8 space-y-6 sm:space-y-8">
              
              {/* CARD 1: TIẾN TRÌNH ĐƠN HÀNG (Stepper & Live Tracker) */}
              <section className="overflow-hidden rounded-3xl border border-sand bg-white shadow-xs p-6 sm:p-8 print:p-4 print:border-stone-400">
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-sand/80 print:pb-2 print:mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lotus/10 text-lotus font-bold">
                      <Clock className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg sm:text-xl font-bold text-ink">
                        Tiến trình đơn hàng
                      </h2>
                      <p className="text-xs text-stone-500">
                        Cập nhật thời gian thực từng giai đoạn phục vụ
                      </p>
                    </div>
                  </div>
                  {booking && (
                    <span className={`${statusBadgeClass(statusOf(booking.status).color)} text-xs px-3 py-1 font-semibold`}>
                      {statusOf(booking.status).label}
                    </span>
                  )}
                </div>

                {loading ? (
                  <div className="h-16 animate-pulse rounded-2xl bg-stone-100" />
                ) : booking ? (
                  <div className="space-y-6">
                    <BookingStatusStepper
                      status={booking.status}
                      pickupMethod={booking.pickupMethod}
                    />
                    <HandoverSummary handover={booking.handover} />
                  </div>
                ) : (
                  <p className="text-sm text-stone-400 text-center py-4">{error ?? "Không tải được tiến trình."}</p>
                )}
              </section>

              {/* CARD 2: TRANG PHỤC & PHỤ KIỆN (Hình ảnh rõ nét, size, giá) */}
              <section className="overflow-hidden rounded-3xl border border-sand bg-white shadow-xs p-6 sm:p-8 print:p-4 print:border-stone-400">
                <div className="flex items-center justify-between pb-4 mb-5 border-b border-sand/80">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 font-bold">
                      <Shirt className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg sm:text-xl font-bold text-ink">
                        Trang phục & Phụ kiện giữ lịch
                      </h2>
                      <p className="text-xs text-stone-500">
                        Danh sách sản phẩm được bảo quản độc quyền cho lịch thuê của bạn
                      </p>
                    </div>
                  </div>
                  {booking && (
                    <span className="rounded-full bg-sand/50 px-3 py-0.5 text-xs font-semibold text-stone-700">
                      {booking.items.length} món
                    </span>
                  )}
                </div>

                {loading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-24 rounded-2xl bg-stone-100" />
                    <div className="h-24 rounded-2xl bg-stone-100" />
                  </div>
                ) : booking ? (
                  <div className="space-y-4">
                    {/* Danh sách Garment Items */}
                    <div className="divide-y divide-sand/60">
                      {booking.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="flex items-center gap-4">
                            {/* Garment thumbnail (Hiển thị ảnh rõ nét, chống chặn hotlink, fallback chuẩn) */}
                            <GarmentThumbnail
                              imageUrl={item.imageUrl}
                              alt={item.garmentName ?? "Cổ phục"}
                            />

                            {/* Garment Info */}
                            <div className="space-y-1">
                              <h3 className="font-display font-bold text-base sm:text-lg text-ink hover:text-lotus transition">
                                {item.garmentName ?? "Trang phục Cung Đình Việt Nam"}
                              </h3>
                              
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                {item.sizeLabel && (
                                  <span className="inline-flex items-center rounded-md bg-stone-100 border border-stone-200 px-2 py-0.5 font-bold text-stone-800">
                                    Size: {item.sizeLabel}
                                  </span>
                                )}
                                {item.assetCode && (
                                  <span className="rounded bg-amber-50 border border-amber-200/80 px-2 py-0.5 text-[11px] font-mono text-amber-800">
                                    Mã mẫu: {item.assetCode}
                                  </span>
                                )}
                                <span className="text-stone-500">
                                  Đơn giá: <strong className="text-stone-800">{formatVND(item.dailyPrice)}/ngày</strong>
                                </span>
                              </div>

                              <p className="text-[11px] text-stone-500 pt-0.5">
                                Thời hạn thuê: <strong className="text-lotus">{booking.days} ngày</strong> ({formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)})
                              </p>
                            </div>
                          </div>

                          {/* Price Subtotal */}
                          <div className="text-left sm:text-right border-t border-sand/40 pt-2 sm:border-0 sm:pt-0 sm:shrink-0">
                            <span className="text-[11px] text-stone-400 block">Thành tiền thuê</span>
                            <span className="font-display text-lg sm:text-xl font-bold text-ink">
                              {formatVND(item.dailyPrice * booking.days)}
                            </span>
                            <span className="text-[10px] text-emerald-700 block mt-0.5">
                              Cọc: {formatVND(item.depositAmount)} (hoàn trả)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Phụ kiện đi kèm nếu có */}
                    {(booking.accessories ?? []).length > 0 && (
                      <div className="mt-4 rounded-2xl border border-dashed border-amber-300/80 bg-amber-50/40 p-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-3 flex items-center gap-1.5">
                          <Sparkles className="h-4 w-4 text-amber-600" />
                          <span>Phụ kiện đi kèm giữ lịch ({(booking.accessories ?? []).length})</span>
                        </h4>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {(booking.accessories ?? []).map((acc) => (
                            <div
                              key={acc.id}
                              className="flex items-center justify-between gap-3 rounded-xl bg-white border border-sand/80 p-2.5 shadow-2xs text-xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {acc.imageUrl ? (
                                  <img
                                    src={acc.imageUrl}
                                    alt={acc.accessoryName ?? "Phụ kiện"}
                                    className="h-10 w-10 shrink-0 rounded-lg object-cover border border-sand/60"
                                    referrerPolicy="no-referrer"
                                    loading="eager"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-400">
                                    <Sparkles className="h-4 w-4 text-amber-600" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-semibold text-ink truncate">{acc.accessoryName ?? "Phụ kiện"}</p>
                                  <p className="text-[10px] text-stone-400">Mã: {acc.accessoryCode ?? "PK-01"}</p>
                                </div>
                              </div>
                              <span className={`shrink-0 font-bold ${acc.isIncluded ? "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60" : "text-stone-800"}`}>
                                {acc.isIncluded ? "Miễn phí" : formatVND(acc.unitPrice)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </section>

              {/* CARD 3: THỜI GIAN & ĐỊA ĐIỂM GIAO NHẬN (Logistics Grid) */}
              {booking && (
                <section className="grid gap-4 sm:grid-cols-2">
                  {/* Khung giờ & ngày thuê */}
                  <div className="rounded-3xl border border-sand bg-white p-6 shadow-xs space-y-3">
                    <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider text-amber-900">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <span>Lịch trình thuê trang phục</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-bold text-ink">
                        {formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)}
                      </p>
                      <p className="text-xs text-stone-500">
                        Tổng thời gian trải nghiệm: <strong className="text-lotus font-semibold">{booking.days} ngày</strong> trọn vẹn
                      </p>
                    </div>
                    <div className="rounded-xl bg-mist/60 border border-sand/60 p-2.5 text-[11px] text-stone-600">
                      Giờ nhận: từ 08:00 sáng ngày nhận • Giờ trả: trước 21:00 tối ngày kết thúc
                    </div>
                  </div>

                  {/* Địa điểm giao nhận */}
                  <div className="rounded-3xl border border-sand bg-white p-6 shadow-xs space-y-3">
                    <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider text-lotus">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-lotus/10 text-lotus">
                        {booking.pickupMethod === "delivery" ? (
                          <Truck className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Store className="h-4 w-4 text-lotus" />
                        )}
                      </div>
                      <span>Phương thức nhận đồ</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-bold text-ink">
                        {PICKUP_LABELS[booking.pickupMethod]?.label ?? booking.pickupMethod}
                      </p>
                      <p className="text-xs text-stone-600 leading-relaxed">
                        {booking.pickupMethod === "delivery" && (booking.deliverySnapshot ?? booking.deliveryAddress)
                          ? [
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.line1,
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.ward,
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.district,
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.city,
                            ].filter(Boolean).join(", ")
                          : "320 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-mist/60 border border-sand/60 p-2.5 text-[11px] text-stone-600">
                      Chuyên viên xưởng sẽ gọi trước 30-45 phút để quý khách chủ động
                    </div>
                  </div>
                </section>
              )}

              {/* CARD 4: 3 BƯỚC TIẾP THEO & HƯỚNG DẪN TRẢI NGHIỆM */}
              <section className="rounded-3xl border border-sand bg-white p-6 sm:p-8 shadow-xs print:hidden space-y-5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-ink">
                      Quy trình tiếp theo & Cam kết chất lượng
                    </h3>
                    <p className="text-xs text-stone-500">
                      3 bước minh bạch để bạn hoàn toàn an tâm trong suốt thời gian thuê
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-sand/80 bg-mist/40 p-4 space-y-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lotus text-white font-bold text-xs">
                      1
                    </div>
                    <h4 className="font-bold text-sm text-ink">
                      Là phẳng & Kiểm định
                    </h4>
                    <p className="text-xs text-stone-500 leading-relaxed">
                      Nghệ nhân kiểm tra chỉ may, đính đá, là hơi nước diệt khuẩn và đóng hộp chống ẩm cao cấp.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-sand/80 bg-mist/40 p-4 space-y-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs">
                      2
                    </div>
                    <h4 className="font-bold text-sm text-ink">
                      Bàn giao & Ký biên bản
                    </h4>
                    <p className="text-xs text-stone-500 leading-relaxed">
                      Chụp ảnh đối soát hiện trạng trang phục và phụ kiện trước khi bàn giao để bảo đảm quyền lợi khách hàng.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-sand/80 bg-mist/40 p-4 space-y-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-600 text-white font-bold text-xs">
                      3
                    </div>
                    <h4 className="font-bold text-sm text-ink">
                      Hoàn cọc 100% minh bạch
                    </h4>
                    <p className="text-xs text-stone-500 leading-relaxed">
                      Ngay sau khi nhận lại đồ nguyên vẹn, tiền cọc sẽ được hoàn trả tự động vào tài khoản trong 24h.
                    </p>
                  </div>
                </div>
              </section>

            </div>

            {/* ── CỘT PHẢI (4 CỘT): VÉ BIÊN NHẬN HOÀNG GIA & CHIẾT TÍNH TÀI CHÍNH ──── */}
            <div className="lg:col-span-4 space-y-6 print:w-full print:col-span-12">
              
              {/* VÉ BIÊN NHẬN (Heritage Ticket Design) */}
              <div className="relative overflow-hidden rounded-3xl border border-amber-300/80 bg-gradient-to-b from-white via-amber-50/20 to-white shadow-md print:border-stone-800 print:shadow-none">
                
                {/* Viền hoa văn vàng kim trên cùng */}
                <div className="h-2 bg-gradient-to-r from-amber-500 via-lotus to-oxblood print:hidden" />

                <div className="p-6 sm:p-7 space-y-5">
                  
                  {/* Ticket Header */}
                  <div className="flex items-start justify-between border-b border-sand pb-4">
                    <div>
                      <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-amber-800 bg-amber-100/70 border border-amber-300/50 rounded-full px-2.5 py-0.5">
                        Biên Nhận Chính Thức
                      </span>
                      <p className="font-display text-3xl font-bold text-lotus mt-1 tracking-tight">
                        {displayCode}
                      </p>
                    </div>
                    
                    {/* Nút chép mã */}
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="inline-flex items-center gap-1 rounded-lg border border-sand bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-lotus hover:text-lotus transition shadow-2xs print:hidden"
                      title="Sao chép mã đơn"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-semibold">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Chép mã</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Financial Breakdown Table */}
                  {booking ? (
                    <div className="space-y-3.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 flex items-center justify-between">
                        <span>Chiết tính thanh toán</span>
                        <span className="font-normal font-sans text-stone-400">Đơn vị: VNĐ</span>
                      </h3>

                      <div className="space-y-2.5 text-xs">
                        <div className="flex justify-between text-stone-600">
                          <span>Tiền thuê đồ ({booking.days} ngày):</span>
                          <span className="font-semibold text-ink">{formatVND(booking.rentalTotal)}</span>
                        </div>

                        <div className="flex justify-between text-stone-600">
                          <span className="flex items-center gap-1.5">
                            <span>Tiền cọc bảo chứng:</span>
                            <span className="text-[9px] text-emerald-700 font-bold bg-emerald-50 rounded px-1 border border-emerald-200/60">
                              Hoàn 100%
                            </span>
                          </span>
                          <span className="font-semibold text-emerald-700">{formatVND(booking.depositTotal)}</span>
                        </div>

                        {typeof booking.shippingFee === "number" && booking.shippingFee > 0 && (
                          <div className="flex justify-between text-stone-600">
                            <span>Phí vận chuyển giao nhận:</span>
                            <span className="font-semibold text-ink">{formatVND(booking.shippingFee)}</span>
                          </div>
                        )}

                        {typeof booking.discountTotal === "number" && booking.discountTotal > 0 && (
                          <div className="flex justify-between text-emerald-700 font-medium">
                            <span>Ưu đãi voucher ({booking.voucherCode ?? "Giảm giá"}):</span>
                            <span>-{formatVND(booking.discountTotal)}</span>
                          </div>
                        )}

                        {typeof booking.penaltyTotal === "number" && booking.penaltyTotal > 0 && (
                          <div className="flex justify-between text-red-600 font-semibold">
                            <span>Khấu trừ hư tổn:</span>
                            <span>-{formatVND(booking.penaltyTotal)}</span>
                          </div>
                        )}

                        {/* Tổng cộng */}
                        <div className="border-t-2 border-dashed border-sand/80 pt-3 mt-3">
                          <div className="flex items-baseline justify-between">
                            <div>
                              <span className="text-sm font-bold text-ink block">Tổng giá trị đơn</span>
                              <span className="text-[10px] text-stone-400">
                                Phương thức: {PAYMENT_METHOD_LABELS[booking.paymentMethod] ?? booking.paymentMethod}
                              </span>
                            </div>
                            <span className="font-display text-2xl sm:text-3xl font-bold text-lotus">
                              {formatVND(booking.rentalTotal + booking.depositTotal + (booking.shippingFee ?? 0) - (booking.discountTotal ?? 0))}
                            </span>
                          </div>
                        </div>

                        {/* Trạng thái thanh toán */}
                        <div className="rounded-xl bg-stone-50 border border-sand/80 p-2.5 flex items-center justify-between text-xs mt-2">
                          <span className="text-stone-500 font-medium">Tình trạng cọc:</span>
                          <span className="font-bold text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Đã xác nhận giữ đồ</span>
                          </span>
                        </div>
                      </div>

                      {/* Nút in & Hành động chính - Ẩn khi in */}
                      <div className="space-y-2 pt-2 print:hidden">
                        <button
                          type="button"
                          onClick={handlePrint}
                          className="w-full flex items-center justify-center gap-2 rounded-xl bg-stone-900 text-white px-4 py-3 text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-stone-800 transition active:scale-95"
                        >
                          <Printer className="h-4 w-4" />
                          <span>In / Lưu PDF biên nhận</span>
                        </button>

                        <Link
                          href="/dashboard/customer"
                          className="w-full flex items-center justify-center gap-2 rounded-xl bg-lotus text-white px-4 py-3 text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-oxblood transition active:scale-95"
                        >
                          <span>Xem Bảng Điều Khiển</span>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>

                    </div>
                  ) : null}

                </div>

                {/* Vệt trang trí vé xé phía dưới */}
                <div className="h-3 bg-mist border-t border-dashed border-sand/80 flex items-center justify-center gap-1 overflow-hidden print:hidden">
                  <div className="w-full border-t border-dashed border-sand/60" />
                </div>
              </div>

              {/* CARD LIÊN HỆ & HỖ TRỢ CSKH (Ẩn khi in) */}
              <div className="rounded-3xl border border-sand bg-white p-6 shadow-xs space-y-4 print:hidden">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                    <PhoneCall className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-ink">
                      Cần thay đổi lịch hoặc tư vấn?
                    </h4>
                    <p className="text-xs text-stone-500">
                      Hotline: <strong className="text-ink">0901.999.868</strong> (8h – 21h)
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("chat:open"));
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-sand bg-mist px-4 py-2.5 text-xs font-semibold text-stone-700 hover:border-lotus hover:text-lotus transition shadow-2xs"
                  >
                    <MessageSquare className="h-4 w-4 text-lotus" />
                    <span>Mở khung chat hỗ trợ 24/7</span>
                  </button>

                  <Link
                    href="/"
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-sand/80 bg-white px-4 py-2.5 text-xs font-medium text-stone-500 hover:bg-mist transition text-center"
                  >
                    <span>Về trang chủ</span>
                  </Link>
                </div>
              </div>

              {/* PHẦN CHỮ KÝ VÀ DẤU XÁC NHẬN KHI IN ẤN (Chỉ hiện khi In) */}
              <div className="hidden print:block pt-8 border-t border-stone-800 mt-8">
                <div className="grid grid-cols-2 text-center text-xs">
                  <div>
                    <p className="font-bold text-stone-800">ĐẠI DIỆN ATELIER</p>
                    <p className="text-[10px] text-stone-500 italic">(Ký và đóng dấu)</p>
                    <div className="h-16" />
                    <p className="font-semibold text-stone-800">Cổ Phục Rental</p>
                  </div>
                  <div>
                    <p className="font-bold text-stone-800">KHÁCH HÀNG THUÊ</p>
                    <p className="text-[10px] text-stone-500 italic">(Ký và ghi rõ họ tên)</p>
                    <div className="h-16" />
                    <p className="font-semibold text-stone-800">Xác nhận nhận đồ</p>
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>
      </main>

      {/* Ẩn footer khi in */}
      <div className="print:hidden">
        <CustomerFooter />
      </div>
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-mist text-ink">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-lotus border-t-transparent mx-auto" />
          <p className="text-xs text-stone-500 font-medium">Đang tải biên nhận đặt lịch Cổ Phục...</p>
        </div>
      </div>
    }>
      <BookingSuccessInner />
    </Suspense>
  );
}
