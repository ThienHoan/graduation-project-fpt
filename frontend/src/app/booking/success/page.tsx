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
};

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
    <div className="flex min-h-screen flex-col bg-mist text-ink">
      <CustomerNavbar />

      <main className="flex-1 px-4 py-10 sm:py-16">
        <div className="mx-auto max-w-4xl space-y-8">
          
          {/* Breadcrumb Navigation */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-stone-500">
            <Link href="/" className="hover:text-lotus transition">Trang chủ</Link>
            <ChevronRight className="h-3 w-3 text-stone-400" />
            <Link href="/catalog" className="hover:text-lotus transition">Bộ sưu tập</Link>
            <ChevronRight className="h-3 w-3 text-stone-400" />
            <span className="font-semibold text-ink">Xác nhận giữ lịch</span>
          </nav>

          {/* 1. Celebratory Hero Banner */}
          <section className="relative overflow-hidden rounded-3xl border border-sand bg-white p-8 sm:p-12 text-center shadow-xs">
            {/* Background luxury gradient accents */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-radial from-antique/20 to-transparent blur-3xl" />
            <div className="pointer-events-none absolute -right-20 -bottom-20 h-56 w-56 rounded-full bg-radial from-lotus/10 to-transparent blur-3xl" />

            {/* Seal / Icon */}
            <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-antique/20 via-parchment to-jade/10 p-0.5 shadow-sm">
              <div className="flex h-full w-full items-center justify-center rounded-2xl bg-white text-jade shadow-2xs">
                <CheckCircle2 className="h-10 w-10 text-jade" />
              </div>
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-antique opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-antique text-[9px] font-bold text-white items-center justify-center">✦</span>
              </span>
            </div>

            <div className="mt-6 space-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-antique/10 border border-antique/30 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.2em] text-antique">
                <Award className="h-3.5 w-3.5" />
                <span>Đặt Giữ Lịch Thành Công</span>
              </span>
              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-ink pt-1">
                Cổ Phục Đã Sẵn Sàng Chờ Bạn
              </h1>
              <p className="mx-auto max-w-xl text-xs sm:text-sm leading-relaxed text-stone-600">
                Atelier Cổ Phục Rental đã ghi nhận yêu cầu và giữ lịch trang phục. Nghệ nhân xưởng sẽ tiến hành kiểm định, là phẳng và đóng gói chuẩn quy cách trước giờ bàn giao.
              </p>
            </div>

            {/* Quick Actions Bar */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/dashboard/customer"
                className="inline-flex items-center gap-2 rounded-xl bg-lotus px-6 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
              >
                <span>Xem Bảng Điều Khiển Khách Hàng</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 rounded-xl border border-sand bg-white px-5 py-3 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-lotus hover:text-lotus"
              >
                <Printer className="h-4 w-4 text-stone-500" />
                <span>In / Lưu biên nhận</span>
              </button>
            </div>
          </section>

          {/* 2. Heritage Receipt & Order Details Card */}
          <section className="overflow-hidden rounded-3xl border border-sand bg-white shadow-xs">
            {/* Ticket Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sand bg-mist/70 px-6 py-4 sm:px-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lotus/10 text-lotus font-bold">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Mã biên nhận</span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="inline-flex items-center gap-1 rounded bg-sand/60 px-1.5 py-0.5 text-[10px] font-medium text-stone-600 hover:bg-sand transition"
                      title="Sao chép mã đơn"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-jade" />
                          <span className="text-jade font-semibold">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Chép mã</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="font-display text-2xl font-bold text-lotus leading-tight">
                    {displayCode}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {booking && (
                  <span className={statusBadgeClass(statusOf(booking.status).color)}>
                    {statusOf(booking.status).label}
                  </span>
                )}
                {booking && (
                  <span className="hidden sm:inline-block text-xs text-stone-400">
                    Tạo lúc: {new Date(booking.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} • {formatDate(booking.createdAt.slice(0, 10))}
                  </span>
                )}
              </div>
            </div>

            {/* Ticket Body Content */}
            <div className="p-6 sm:p-8 space-y-8">
              {loading ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-24 rounded-2xl bg-stone-100" />
                  <div className="h-32 rounded-2xl bg-stone-100" />
                </div>
              ) : booking ? (
                <>
                  {/* Items List */}
                  <div>
                    <h2 className="font-display text-2xl font-bold text-ink mb-4 flex items-center gap-2">
                      <Shirt className="h-5 w-5 text-antique" />
                      <span>Trang phục & Phụ kiện giữ lịch ({booking.items.length})</span>
                    </h2>

                    <div className="space-y-3">
                      {booking.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-sand bg-mist/50 p-4 transition hover:bg-mist"
                        >
                          <div className="flex items-center gap-4">
                            {/* Garment thumbnail */}
                            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-sand bg-stone-100">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.garmentName ?? "Cổ phục"}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-stone-400">
                                  <Shirt className="h-6 w-6 text-antique" />
                                </div>
                              )}
                            </div>

                            <div>
                              <h3 className="font-bold text-base text-ink">
                                {item.garmentName ?? "Trang phục cung đình"}
                              </h3>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                {item.sizeLabel && (
                                  <span className="rounded bg-white border border-sand px-2 py-0.5 font-semibold text-stone-700">
                                    Size: {item.sizeLabel}
                                  </span>
                                )}
                                <span>Đơn giá ngày: <strong>{formatVND(item.dailyPrice)}/ngày</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right sm:shrink-0 border-t border-sand/60 pt-2 sm:border-0 sm:pt-0">
                            <span className="text-[11px] text-stone-400 block">Thời hạn {booking.days} ngày</span>
                            <span className="font-bold text-base text-ink">
                              {formatVND(item.dailyPrice * booking.days)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Accessories if present */}
                    {(booking.accessories ?? []).length > 0 && (
                      <div className="mt-4 rounded-2xl border border-dashed border-sand bg-parchment/30 p-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2.5 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-antique" />
                          <span>Phụ kiện kèm theo ({(booking.accessories ?? []).length})</span>
                        </h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(booking.accessories ?? []).map((acc) => (
                            <div
                              key={acc.id}
                              className="flex items-center justify-between gap-2 rounded-xl bg-white border border-sand/60 px-3 py-2 text-xs"
                            >
                              <span className="font-medium text-ink truncate">{acc.accessoryName ?? "Phụ kiện"}</span>
                              <span className={`shrink-0 font-semibold ${acc.isIncluded ? "text-jade" : "text-stone-700"}`}>
                                {acc.isIncluded ? "Miễn phí" : formatVND(acc.unitPrice)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Logistics & Timing Information */}
                  <div className="grid gap-4 sm:grid-cols-2 border-t border-sand pt-6">
                    {/* Time Window */}
                    <div className="rounded-2xl border border-sand bg-mist/60 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                        <Calendar className="h-4 w-4 text-antique" />
                        <span>Lịch trình thuê</span>
                      </div>
                      <p className="text-sm font-bold text-ink">
                        {formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)}
                      </p>
                      <p className="text-xs text-stone-500">
                        Tổng thời gian trải nghiệm: <strong className="text-lotus">{booking.days} ngày</strong>
                      </p>
                    </div>

                    {/* Pickup / Delivery */}
                    <div className="rounded-2xl border border-sand bg-mist/60 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                        {booking.pickupMethod === "delivery" ? (
                          <Truck className="h-4 w-4 text-jade" />
                        ) : (
                          <Store className="h-4 w-4 text-lotus" />
                        )}
                        <span>Phương thức nhận đồ</span>
                      </div>
                      <p className="text-sm font-bold text-ink">
                        {PICKUP_LABELS[booking.pickupMethod]?.label ?? booking.pickupMethod}
                      </p>
                      <p className="text-xs text-stone-500 leading-relaxed">
                        {booking.pickupMethod === "delivery" && (booking.deliverySnapshot ?? booking.deliveryAddress)
                          ? [
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.line1,
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.ward,
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.district,
                              (booking.deliverySnapshot ?? booking.deliveryAddress)!.city,
                            ].filter(Boolean).join(", ")
                          : PICKUP_LABELS[booking.pickupMethod]?.desc}
                      </p>
                    </div>
                  </div>

                  {/* Financial Breakdown Receipt */}
                  <div className="rounded-2xl border border-sand bg-radial from-mist to-parchment/40 p-6 space-y-3.5">
                    <h3 className="font-display text-xl font-bold text-ink border-b border-sand pb-3 flex items-center justify-between">
                      <span>Bảng chiết tính thanh toán</span>
                      <span className="text-xs font-sans font-normal text-stone-500">Đơn vị: VNĐ</span>
                    </h3>

                    <div className="space-y-2.5 text-xs sm:text-sm">
                      <div className="flex justify-between text-stone-600">
                        <span>Tiền thuê trang phục ({booking.days} ngày):</span>
                        <span className="font-semibold text-ink">{formatVND(booking.rentalTotal)}</span>
                      </div>

                      <div className="flex justify-between text-stone-600">
                        <span className="flex items-center gap-1.5">
                          <span>Tiền cọc bảo chứng:</span>
                          <span className="text-[10px] text-jade font-semibold bg-jade/10 rounded px-1.5 py-0.2">
                            Hoàn 100% khi trả đồ
                          </span>
                        </span>
                        <span className="font-semibold text-jade">{formatVND(booking.depositTotal)}</span>
                      </div>

                      {typeof booking.shippingFee === "number" && booking.shippingFee > 0 && (
                        <div className="flex justify-between text-stone-600">
                          <span>Phí vận chuyển giao nhận:</span>
                          <span className="font-semibold text-ink">{formatVND(booking.shippingFee)}</span>
                        </div>
                      )}

                      {typeof booking.penaltyTotal === "number" && booking.penaltyTotal > 0 && (
                        <div className="flex justify-between text-red-600 font-semibold">
                          <span>Khấu trừ hư tổn thẩm định:</span>
                          <span>-{formatVND(booking.penaltyTotal)}</span>
                        </div>
                      )}

                      <div className="border-t border-sand pt-3 mt-3 flex items-baseline justify-between">
                        <div>
                          <span className="text-base font-bold text-ink block">Tổng giá trị đơn</span>
                          <span className="text-[11px] text-stone-400">
                            Phương thức: {PAYMENT_METHOD_LABELS[booking.paymentMethod] ?? booking.paymentMethod}
                          </span>
                        </div>
                        <span className="font-display text-3xl font-bold text-lotus">
                          {formatVND(booking.rentalTotal + booking.depositTotal + (booking.shippingFee ?? 0))}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Status Stepper */}
                  <div className="border-t border-sand pt-6 space-y-4">
                    <h3 className="font-display text-xl font-bold text-ink">
                      Tiến trình đơn hàng
                    </h3>
                    <BookingStatusStepper
                      status={booking.status}
                      pickupMethod={booking.pickupMethod}
                    />
                    <HandoverSummary handover={booking.handover} />
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-sm text-stone-500">
                  {error ?? "Không có thông tin chi tiết cho đơn này."}
                </div>
              )}
            </div>
          </section>

          {/* 4. What Happens Next & Guarantees (3 Bước tiếp theo) */}
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-sand bg-white p-5 shadow-2xs space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lotus/10 text-lotus font-bold">
                1
              </div>
              <h4 className="font-display text-lg font-bold text-ink">
                Xưởng chuẩn bị đồ
              </h4>
              <p className="text-xs text-stone-500 leading-relaxed">
                Nghệ nhân kiểm tra độ nguyên vẹn, phụ kiện đi kèm và là phẳng trang phục trước khi đóng gói.
              </p>
            </div>

            <div className="rounded-2xl border border-sand bg-white p-5 shadow-2xs space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-jade/10 text-jade font-bold">
                2
              </div>
              <h4 className="font-display text-lg font-bold text-ink">
                Bàn giao & Biên bản
              </h4>
              <p className="text-xs text-stone-500 leading-relaxed">
                Quý khách nhận đồ tại atelier hoặc shipper giao tận nơi kèm biên bản chụp hình thực tế.
              </p>
            </div>

            <div className="rounded-2xl border border-sand bg-white p-5 shadow-2xs space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-antique/20 text-stone-800 font-bold">
                3
              </div>
              <h4 className="font-display text-lg font-bold text-ink">
                Hoàn cọc minh bạch
              </h4>
              <p className="text-xs text-stone-500 leading-relaxed">
                Sau khi trả đồ, tiền cọc sẽ được hoàn trả đầy đủ trong 24 giờ làm việc kèm ủy nhiệm chi.
              </p>
            </div>
          </section>

          {/* 5. Support & Atelier Contact Bar */}
          <section className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-sand bg-white p-6 shadow-2xs">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">
                  Bạn cần thay đổi lịch hoặc hỗ trợ gấp?
                </h4>
                <p className="text-xs text-stone-500">
                  Đội ngũ chuyên viên tư vấn atelier luôn sẵn sàng giải đáp mọi thắc mắc của quý khách.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("chat:open"));
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-mist border border-sand px-4 py-2.5 text-xs font-semibold text-stone-700 hover:border-lotus hover:text-lotus transition shadow-2xs"
              >
                <MessageSquare className="h-4 w-4 text-lotus" />
                <span>Mở khung chat hỗ trợ</span>
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-xl border border-sand bg-white px-4 py-2.5 text-xs font-semibold text-stone-600 hover:bg-mist transition"
              >
                <span>Về trang chủ</span>
              </Link>
            </div>
          </section>

        </div>
      </main>

      <CustomerFooter />
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-mist text-ink">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-lotus border-t-transparent mx-auto" />
          <p className="text-xs text-stone-500">Đang tải biên nhận đặt lịch...</p>
        </div>
      </div>
    }>
      <BookingSuccessInner />
    </Suspense>
  );
}
