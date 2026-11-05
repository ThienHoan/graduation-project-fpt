"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck2, Clock, Loader2, TimerOff, XCircle } from "lucide-react";
import { cancelPendingExtension, getExtensionStatus, type BookingExtensionResponse } from "@/lib/api";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const FINAL_STATUSES = new Set(["applied", "expired", "cancelled", "failed"]);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(120deg,#f9f5f0_0%,#fff0ee_50%,#f9f5f0_100%)] px-4 py-12 text-ink">
      <main className="w-full max-w-lg text-center">
        <div className="rounded-2xl border border-sand bg-white/80 p-8 shadow-lg backdrop-blur sm:p-12">{children}</div>
      </main>
    </div>
  );
}

function ExtensionResultInner() {
  const searchParams = useSearchParams();
  const extensionId = searchParams.get("extensionId") ?? "";
  const payCancelled = searchParams.get("cancelled") === "1";

  const [extension, setExtension] = useState<BookingExtensionResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelledByUser, setCancelledByUser] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!extensionId) return;
    const res = await getExtensionStatus(extensionId);
    if (!res?.success || !res.data) {
      setLoadError(res?.message ?? "Không tìm thấy yêu cầu gia hạn.");
      stopPolling();
      return;
    }
    setExtension(res.data);
    if (FINAL_STATUSES.has(res.data.status)) stopPolling();
  }, [extensionId, stopPolling]);

  // Webhook PayOS có thể về chậm vài giây → hỏi lại mỗi 3 giây (backend tự đối soát với PayOS).
  useEffect(() => {
    if (!extensionId) return;
    void refresh();
    if (payCancelled) return;
    pollingRef.current = setInterval(() => void refresh(), 3000);
    return stopPolling;
  }, [extensionId, payCancelled, refresh, stopPolling]);

  async function handleCancel() {
    if (!extension) return;
    setCancelling(true);
    const res = await cancelPendingExtension(extension.bookingId);
    setCancelling(false);
    if (res?.success) {
      setCancelledByUser(true);
      await refresh();
    } else {
      setLoadError(res?.message ?? "Không thể huỷ yêu cầu gia hạn.");
    }
  }

  const backLinks = (
    <div className="mt-8 flex flex-col gap-3">
      <Link href="/dashboard/customer" className="inline-flex items-center justify-center rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood">
        Về đơn thuê của tôi
      </Link>
    </div>
  );

  if (!extensionId || loadError) {
    return (
      <Shell>
        <XCircle className="mx-auto h-12 w-12 text-red-500" />
        <h1 className="mt-6 font-display text-3xl">Không tìm thấy yêu cầu gia hạn</h1>
        <p className="mt-3 text-sm text-stone-600">{loadError ?? "Liên kết không hợp lệ."}</p>
        {backLinks}
      </Shell>
    );
  }

  if (!extension) {
    return (
      <Shell>
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-lotus" />
        <p className="mt-4 text-sm text-stone-600">Đang kiểm tra yêu cầu gia hạn...</p>
      </Shell>
    );
  }

  const code = `#${extension.bookingId.slice(0, 8).toUpperCase()}`;

  if (extension.status === "applied") {
    return (
      <Shell>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-jade/10 text-jade">
          <CalendarCheck2 className="h-10 w-10" />
        </div>
        <h1 className="mt-6 font-display text-3xl">Gia hạn thành công!</h1>
        <p className="mt-4 text-sm text-stone-600">
          Đơn {code} đã được gia hạn thêm {extension.extraDays} ngày. Hạn trả mới là{" "}
          <strong className="text-ink">{formatDate(extension.newEndDate)}</strong>.
        </p>
        <p className="mt-2 text-lg font-semibold">{formatVND(extension.amount)}</p>
        {backLinks}
      </Shell>
    );
  }

  if (extension.status === "failed") {
    return (
      <Shell>
        <XCircle className="mx-auto h-12 w-12 text-red-500" />
        <h1 className="mt-6 font-display text-3xl">Chưa gia hạn được</h1>
        <p className="mt-4 text-sm text-stone-600">
          Khoản thanh toán của bạn về sau khi hết thời gian giữ lịch và những ngày này đã có khách khác đặt.
          Cửa hàng đã được thông báo và sẽ liên hệ hoàn {formatVND(extension.amount)} cho bạn.
        </p>
        {backLinks}
      </Shell>
    );
  }

  if (extension.status === "expired" || extension.status === "cancelled") {
    return (
      <Shell>
        <TimerOff className="mx-auto h-12 w-12 text-stone-400" />
        <h1 className="mt-6 font-display text-3xl">
          {extension.status === "expired" ? "Yêu cầu gia hạn đã hết hạn" : "Đã huỷ yêu cầu gia hạn"}
        </h1>
        <p className="mt-4 text-sm text-stone-600">
          {cancelledByUser || extension.status === "cancelled"
            ? "Ngày trả của đơn " + code + " giữ nguyên"
            : "Bạn chưa thanh toán trong thời gian giữ lịch nên ngày trả của đơn " + code + " giữ nguyên"}{" "}
          là <strong className="text-ink">{formatDate(extension.previousEndDate)}</strong>. Bạn có thể gửi yêu cầu gia hạn mới từ trang đơn thuê.
        </p>
        {backLinks}
      </Shell>
    );
  }

  // pending
  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">Gia hạn thuê</p>
      <h1 className="mt-3 font-display text-3xl">
        {payCancelled ? "Bạn đã huỷ thanh toán" : "Đang chờ thanh toán"}
      </h1>
      <p className="mt-4 text-sm text-stone-600">
        Gia hạn đơn {code} thêm {extension.extraDays} ngày đến <strong className="text-ink">{formatDate(extension.newEndDate)}</strong> ·{" "}
        <strong className="text-ink">{formatVND(extension.amount)}</strong>
      </p>
      <div role="status" className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Clock className="h-4 w-4 shrink-0" />
        <span>Lịch được giữ đến {formatClock(extension.expiresAt)}</span>
      </div>
      {!payCancelled && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-stone-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Đang chờ xác nhận thanh toán từ ngân hàng...
        </div>
      )}
      <div className="mt-8 flex flex-col gap-3">
        {extension.checkoutUrl && (
          <a href={extension.checkoutUrl} className="inline-flex items-center justify-center rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood">
            {payCancelled ? "Thanh toán lại" : "Mở lại trang thanh toán"}
          </a>
        )}
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={cancelling}
          className="inline-flex items-center justify-center rounded-lg border border-sand px-6 py-3 text-sm font-semibold text-stone-600 transition hover:bg-[#fff8f6] disabled:opacity-60"
        >
          {cancelling ? "Đang huỷ..." : "Huỷ yêu cầu gia hạn"}
        </button>
        <Link href="/dashboard/customer" className="text-sm text-stone-500 underline hover:text-ink">
          Về đơn thuê của tôi
        </Link>
      </div>
    </Shell>
  );
}

export default function BookingExtensionPage() {
  return (
    <Suspense>
      <ExtensionResultInner />
    </Suspense>
  );
}
