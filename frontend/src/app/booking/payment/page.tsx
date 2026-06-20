"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getPaymentStatus } from "@/lib/api";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function PaymentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const bookingId = searchParams.get("bookingId") ?? "";
  const cancelled = searchParams.get("cancelled") === "1";

  const [paymentData] = useState(() => {
    if (typeof window === "undefined") return { amount: 0 };
    try {
      const raw = localStorage.getItem("heritage-payment");
      if (!raw) return { amount: 0 };
      return JSON.parse(raw) as { amount: number };
    } catch {
      return { amount: 0 };
    }
  });

  const [paid, setPaid] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!bookingId || cancelled) return;

    pollingRef.current = setInterval(async () => {
      const res = await getPaymentStatus(bookingId);
      if (res.success && res.data?.paid) {
        stopPolling();
        setPaid(true);
      }
    }, 3000);

    return stopPolling;
  }, [bookingId, cancelled, stopPolling]);

  useEffect(() => {
    if (!paid) return;

    setCountdown(5);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          router.push(`/booking/success?bookingId=${bookingId}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [paid, bookingId, router]);

  const displayCode = bookingId ? `#${bookingId.slice(0, 8).toUpperCase()}` : "";

  if (cancelled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(120deg,#f9f5f0_0%,#fff0ee_50%,#f9f5f0_100%)] px-4 py-12 text-ink">
        <main className="w-full max-w-lg text-center">
          <div className="rounded-2xl border border-sand bg-white/80 p-8 shadow-lg backdrop-blur sm:p-12">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-500">
              <span className="material-symbols-outlined text-4xl">cancel</span>
            </div>
            <h1 className="mt-6 font-display text-3xl text-ink">Thanh toán đã bị huỷ</h1>
            <p className="mt-4 text-sm text-stone-600">Đơn hàng {displayCode} chưa được thanh toán. Bạn có thể quay lại bộ sưu tập để đặt lại.</p>
            <div className="mt-8 flex flex-col gap-3">
              <Link href="/catalog" className="inline-flex items-center justify-center rounded-lg bg-lotus px-6 py-3 text-sm font-semibold text-white transition hover:bg-oxblood">
                Quay lại bộ sưu tập
              </Link>
              <Link href="/dashboard/customer" className="inline-flex items-center justify-center rounded-lg border border-bronze px-6 py-3 text-sm font-semibold text-bronze transition hover:bg-[#fff0ee]">
                Xem đơn hàng
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(120deg,#f9f5f0_0%,#fff0ee_50%,#f9f5f0_100%)] px-4 py-12 text-ink">
        <main className="w-full max-w-lg text-center">
          <div className="rounded-2xl border border-sand bg-white/80 p-8 shadow-lg backdrop-blur sm:p-12">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-jade/10 text-jade">
              <span className="material-symbols-outlined text-4xl">check_circle</span>
            </div>
            <h1 className="mt-6 font-display text-3xl text-ink">Thanh toán thành công!</h1>
            <p className="mt-4 text-sm text-stone-600">Đơn hàng {displayCode} đã được thanh toán thành công.</p>
            {paymentData.amount > 0 && (
              <p className="mt-2 text-lg font-semibold text-ink">{formatVND(paymentData.amount)}</p>
            )}
            <div className="mt-8 flex items-center justify-center gap-2 text-lg font-semibold text-lotus">
              <span className="material-symbols-outlined">timer</span>
              Chuyển hướng sau {countdown} giây...
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(120deg,#f9f5f0_0%,#fff0ee_50%,#f9f5f0_100%)] px-4 py-12 text-ink">
      <main className="w-full max-w-lg text-center">
        <div className="rounded-2xl border border-sand bg-white/80 p-8 shadow-lg backdrop-blur sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">Thanh toán chuyển khoản</p>
          <h1 className="mt-3 font-display text-4xl text-ink">Đang chờ thanh toán</h1>

          <div className="mt-8 rounded-xl border border-sand bg-[#fff8f6] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Mã booking</p>
            <p className="mt-1 font-display text-2xl text-lotus">{displayCode}</p>
          </div>

          {paymentData.amount > 0 && (
            <div className="mt-6 rounded-lg border border-antique/40 bg-antique/10 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-bronze">Số tiền thanh toán</span>
                <span className="font-display text-2xl text-lotus">{formatVND(paymentData.amount)}</span>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-stone-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Đang chờ xác nhận thanh toán từ ngân hàng...
          </div>

          <div className="mt-6">
            <Link href="/dashboard/customer" className="text-sm text-stone-500 underline hover:text-ink">
              Xem đơn hàng của tôi
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function BookingPaymentPage() {
  return (
    <Suspense>
      <PaymentInner />
    </Suspense>
  );
}
