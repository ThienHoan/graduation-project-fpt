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

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const PICKUP_LABELS: Record<string, string> = {
  delivery: "Giao tận nơi",
  store_pickup: "Nhận tại cửa hàng",
};

function BookingSuccessInner() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("bookingId");
  const displayCode = bookingId ? `#${bookingId.slice(0, 8).toUpperCase()}` : "#—";

  const [booking, setBooking] = useState<BookingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshBooking = useCallback(async () => {
    if (!bookingId) return;
    const res = await getBooking(bookingId);
    if (res.success && res.data) {
      setBooking(res.data);
      setError(null);
    } else {
      setError(res.message ?? "Không tải được thông tin đơn.");
    }
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      return;
    }
    refreshBooking()
      .catch(() => setError("Không tải được thông tin đơn."))
      .finally(() => setLoading(false));
  }, [bookingId, refreshBooking]);

  useRealtimeInvalidation(bookingId ? { bookings: refreshBooking } : {}, Boolean(bookingId));

  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink">
      <CustomerNavbar />
      <main className="flex flex-1 justify-center px-4 py-16">
        <div className="w-full max-w-3xl">
          <div className="rounded-lg border border-sand bg-white p-8 shadow-lg sm:p-12">
            <div className="text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-jade/10 text-jade">
                <span className="material-symbols-outlined text-4xl">check_circle</span>
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-antique">Đặt lịch thành công</p>
              <h1 className="mt-3 font-display text-5xl text-ink sm:text-6xl">Giữ lịch thành công</h1>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-stone-600">
                Xưởng đã ghi nhận yêu cầu thuê. Theo dõi tiến trình chuẩn bị và bàn giao ngay bên dưới.
              </p>
            </div>

            <div className="mt-8 rounded-lg border border-sand bg-mist p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Mã booking</p>
                  <p className="mt-1 font-display text-3xl text-lotus">{displayCode}</p>
                </div>
                {booking && (
                  <span className={statusBadgeClass(statusOf(booking.status).color)}>
                    {statusOf(booking.status).label}
                  </span>
                )}
              </div>
              {bookingId && <p className="mt-2 text-xs text-stone-400 break-all">{bookingId}</p>}
            </div>

            {/* Tiến trình đơn */}
            <section className="mt-10">
              <h2 className="font-display text-3xl text-ink">Tiến trình đơn hàng</h2>
              {loading ? (
                <div className="mt-6 h-16 animate-pulse rounded-lg bg-stone-100" />
              ) : booking ? (
                <div>
                  <BookingStatusStepper
                    status={booking.status}
                    pickupMethod={booking.pickupMethod}
                    className="mt-6"
                  />
                  <div className="mt-6">
                    <HandoverSummary handover={booking.handover} />
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-stone-500">
                  {error ?? "Không có thông tin tiến trình cho đơn này."}
                </p>
              )}
            </section>

            {/* Chi tiết đơn */}
            {booking && (
              <section className="mt-10">
                <h2 className="font-display text-3xl text-ink">Chi tiết đơn thuê</h2>

                <div className="mt-6 space-y-3">
                  {booking.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-sand bg-parchment/40 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{item.garmentName ?? "Trang phục"}</p>
                        {item.sizeLabel && <p className="text-xs text-stone-500">Size {item.sizeLabel}</p>}
                      </div>
                      <p className="shrink-0 text-sm text-stone-600">{formatVND(item.dailyPrice)}/ngày</p>
                    </div>
                  ))}
                </div>

                {(booking.accessories ?? []).length > 0 && (
                  <div className="mt-6">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      <span className="material-symbols-outlined text-[15px]">diamond</span>
                      Phụ kiện thuê kèm ({(booking.accessories ?? []).length})
                    </h3>
                    <div className="mt-3 space-y-3">
                      {(booking.accessories ?? []).map((acc) => (
                        <div
                          key={acc.id}
                          className="flex items-center justify-between gap-4 rounded-lg border border-sand bg-mist/60 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{acc.accessoryName ?? "Phụ kiện"}</p>
                            <p className="text-xs text-stone-500">Số lượng: {acc.quantity}</p>
                          </div>
                          <p className={`shrink-0 text-sm font-medium ${acc.isIncluded ? "text-jade" : "text-stone-600"}`}>
                            {acc.isIncluded ? "Đi kèm miễn phí" : `${formatVND(acc.unitPrice)}/ngày`}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <dl className="mt-6 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-4 border-b border-sand pb-3 sm:border-0 sm:pb-0">
                    <dt className="text-stone-500">Thời gian thuê</dt>
                    <dd className="text-right font-medium text-ink">
                      {formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)} ({booking.days} ngày)
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-sand pb-3 sm:border-0 sm:pb-0">
                    <dt className="text-stone-500">Hình thức nhận</dt>
                    <dd className="text-right font-medium text-ink">
                      {PICKUP_LABELS[booking.pickupMethod] ?? booking.pickupMethod}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-sand pb-3 sm:border-0 sm:pb-0">
                    <dt className="text-stone-500">Tiền thuê</dt>
                    <dd className="text-right font-medium text-ink">{formatVND(booking.rentalTotal)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-sand pb-3 sm:border-0 sm:pb-0">
                    <dt className="text-stone-500">Tiền cọc</dt>
                    <dd className="text-right font-medium text-ink">{formatVND(booking.depositTotal)}</dd>
                  </div>
                  {typeof booking.shippingFee === "number" && booking.shippingFee > 0 && (
                    <div className="flex justify-between gap-4 border-b border-sand pb-3 sm:border-0 sm:pb-0">
                      <dt className="text-stone-500">Phí giao hàng</dt>
                      <dd className="text-right font-medium text-ink">{formatVND(booking.shippingFee)}</dd>
                    </div>
                  )}
                  {(booking.deliverySnapshot ?? booking.deliveryAddress) && (
                    <div className="flex justify-between gap-4 border-b border-sand pb-3 sm:col-span-2 sm:border-0 sm:pb-0">
                      <dt className="shrink-0 text-stone-500">Địa chỉ giao</dt>
                      <dd className="text-right font-medium text-ink">
                        {[
                          (booking.deliverySnapshot ?? booking.deliveryAddress)!.line1,
                          (booking.deliverySnapshot ?? booking.deliveryAddress)!.ward,
                          (booking.deliverySnapshot ?? booking.deliveryAddress)!.district,
                          (booking.deliverySnapshot ?? booking.deliveryAddress)!.city,
                        ].filter(Boolean).join(", ")}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-6 flex items-center justify-between rounded-lg bg-lotus/5 px-4 py-3">
                  <span className="font-semibold text-ink">Tổng cộng</span>
                  <span className="font-display text-2xl text-lotus">
                    {formatVND(booking.rentalTotal + booking.depositTotal + (booking.shippingFee ?? 0))}
                  </span>
                </div>
              </section>
            )}

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Link href="/dashboard/customer" className="inline-flex items-center justify-center rounded-lg bg-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-oxblood">
                Xem bảng điều khiển khách hàng
              </Link>
              <Link href="/" className="inline-flex items-center justify-center rounded-lg border border-bronze px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-bronze transition hover:bg-parchment">
                Về trang chủ
              </Link>
            </div>
          </div>
        </div>
      </main>
      <CustomerFooter />
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <Suspense>
      <BookingSuccessInner />
    </Suspense>
  );
}
