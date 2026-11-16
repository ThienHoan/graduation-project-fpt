"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Store, TimerOff } from "lucide-react";
import {
  getChangeRequestPaymentStatus,
  retryChangeRequestPayment,
  type ChangeRequestPaymentStatus,
} from "@/lib/api";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(Number(amount) || 0);
}

/** Trạng thái kết thúc: dừng poll. */
const FINAL_STATUSES = new Set(["applied", "expired", "cancelled", "needs_manager"]);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(120deg,#f9f5f0_0%,#fff0ee_50%,#f9f5f0_100%)] px-4 py-12 text-ink">
      <main className="w-full max-w-lg text-center">
        <div className="rounded-2xl border border-sand bg-white/80 p-8 shadow-lg backdrop-blur sm:p-12">{children}</div>
      </main>
    </div>
  );
}

function ChangePaymentInner() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get("requestId") ?? "";
  const payCancelled = searchParams.get("cancelled") === "1";

  const [status, setStatus] = useState<ChangeRequestPaymentStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!requestId) return;
    const res = await getChangeRequestPaymentStatus(requestId);
    if (!res?.success || !res.data) {
      setLoadError(res?.message ?? "Không tìm thấy yêu cầu thanh toán.");
      stopPolling();
      return;
    }
    setStatus(res.data);
    if (FINAL_STATUSES.has(res.data.status)) stopPolling();
  }, [requestId, stopPolling]);

  // Webhook PayOS có thể về chậm vài giây → hỏi lại mỗi 3 giây (backend tự đối soát).
  useEffect(() => {
    if (!requestId) return;
    void refresh();
    if (payCancelled) return;
    pollingRef.current = setInterval(() => void refresh(), 3000);
    return stopPolling;
  }, [requestId, payCancelled, refresh, stopPolling]);

  /**
   * "Thanh toán lại": link PayOS cũ đã bị huỷ/hết hạn nên server cấp link mới
   * (cùng yêu cầu đổi, cùng hạn giữ chỗ) rồi chuyển thẳng sang cổng thanh toán.
   */
  async function handlePayAgain() {
    if (!requestId || paying) return;
    setPayError(null);
    setPaying(true);
    const res = await retryChangeRequestPayment(requestId);
    setPaying(false);
    if (!res?.success || !res.data) {
      setPayError(res?.message ?? "Không tạo được liên kết thanh toán mới. Vui lòng thử lại.");
      return;
    }
    if (res.data.status === "applied" || res.data.status === "needs_manager") {
      setStatus(res.data);
      return;
    }
    if (!res.data.checkoutUrl) {
      setPayError("Không tạo được liên kết thanh toán mới. Vui lòng thử lại.");
      return;
    }
    window.location.href = res.data.checkoutUrl;
  }

  // Sau khi thanh toán xong, KHÔNG quay lại trang sự cố của từng đơn mà về tab
  // "Sự cố" trong tài khoản khách (nơi tổng hợp mọi đơn đang cần xử lý).
  const backLinks = (
    <div className="mt-8 flex flex-col gap-3">
      <Link
        href="/dashboard/customer/incidents"
        className="inline-flex items-center justify-center rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
      >
        Về trang sự cố
      </Link>
    </div>
  );

  if (!requestId || loadError) {
    return (
      <Shell>
        <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
        <h1 className="mt-6 font-display text-3xl">Không tìm thấy yêu cầu thanh toán</h1>
        <p className="mt-3 text-sm text-stone-600">{loadError ?? "Liên kết không hợp lệ."}</p>
        {backLinks}
      </Shell>
    );
  }

  if (!status) {
    return (
      <Shell>
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-lotus" />
        <p className="mt-4 text-sm text-stone-600">Đang kiểm tra thanh toán phần chênh...</p>
      </Shell>
    );
  }

  if (status.status === "applied") {
    return (
      <Shell>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-jade/10 text-jade">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h1 className="mt-6 font-display text-3xl">Đã áp dụng thay đổi!</h1>
        <p className="mt-4 text-sm leading-7 text-stone-600">
          Yêu cầu đổi mẫu của bạn đã được áp dụng. Phần chênh{" "}
          <strong className="text-ink">{formatVND(status.chargeAmount)}</strong> đã được ghi nhận thanh toán.
        </p>
        {backLinks}
      </Shell>
    );
  }

  if (status.status === "needs_manager") {
    return (
      <Shell>
        <Store className="mx-auto h-12 w-12 text-amber-600" />
        <h1 className="mt-6 font-display text-3xl">Cần cửa hàng hỗ trợ</h1>
        <p className="mt-4 text-sm leading-7 text-stone-600">
          Khoản thanh toán của bạn đã về nhưng mẫu thay thế không còn đủ hàng. Cửa hàng đã được thông báo và sẽ liên hệ
          để xử lý (đổi mẫu khác hoặc hoàn tiền).
        </p>
        {backLinks}
      </Shell>
    );
  }

  if (status.status === "expired" || status.status === "cancelled") {
    return (
      <Shell>
        <TimerOff className="mx-auto h-12 w-12 text-stone-400" />
        <h1 className="mt-6 font-display text-3xl">
          {status.status === "expired" ? "Yêu cầu đã hết hạn" : "Yêu cầu đã được huỷ"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-stone-600">
          Thời gian giữ chỗ đã kết thúc nên thay đổi chưa được áp dụng. Bạn có thể chọn lại mẫu khác từ trang sự cố của đơn.
        </p>
        {backLinks}
      </Shell>
    );
  }

  // awaiting_payment (hoặc quoted khi vừa quay lại)
  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">Thanh toán phần chênh</p>
      <h1 className="mt-3 font-display text-3xl">{payCancelled ? "Bạn đã huỷ thanh toán" : "Đang chờ thanh toán"}</h1>
      <p className="mt-4 text-sm leading-7 text-stone-600">
        Cần thanh toán <strong className="text-ink">{formatVND(status.chargeAmount)}</strong> để áp dụng thay đổi cho đơn thuê.
      </p>
      <div
        role="status"
        className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <Clock className="h-4 w-4 shrink-0" />
        <span>
          {status.countdownSeconds > 0
            ? `Giữ chỗ còn ${Math.floor(status.countdownSeconds / 60)} phút ${status.countdownSeconds % 60} giây`
            : "Đang chờ xác nhận thanh toán từ ngân hàng..."}
        </span>
      </div>
      {!payCancelled ? (
        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-stone-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Đang chờ xác nhận thanh toán từ ngân hàng...
        </div>
      ) : null}
      {payError ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700"
        >
          {payError}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void handlePayAgain()}
          disabled={paying}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
        >
          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {payCancelled ? "Thanh toán lại" : "Mở lại trang thanh toán"}
        </button>
        <Link
          href="/dashboard/customer/incidents"
          className="text-sm text-stone-500 underline transition hover:text-ink"
        >
          Về trang sự cố
        </Link>
      </div>
    </Shell>
  );
}

export default function ChangePaymentPage() {
  return (
    <Suspense>
      <ChangePaymentInner />
    </Suspense>
  );
}