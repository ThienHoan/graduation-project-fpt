"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Clock, Loader2, X } from "lucide-react";
import {
  cancelPendingExtension,
  createExtensionPayment,
  getBookingExtensions,
  getExtensionQuote,
  type BookingExtensionResponse,
  type ExtensionQuoteResponse,
} from "@/lib/api";

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

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

type Props = {
  bookingId: string;
  rentalEndDate: string;
  onClose: () => void;
  /** Gọi khi gia hạn xong ngay (phí 0đ) hoặc khi huỷ yêu cầu đang chờ. */
  onChanged: (message: string) => void;
};

/**
 * Khách tự gia hạn ngày thuê: chọn số ngày → hệ thống kiểm tra lịch trống, báo giá
 * theo bảng giá theo ngày → bấm thanh toán thì giữ lịch 30 phút và chuyển sang PayOS.
 */
export function ExtendRentalModal({ bookingId, rentalEndDate, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<BookingExtensionResponse | null>(null);
  const [days, setDays] = useState(1);
  const [quote, setQuote] = useState<ExtensionQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Có yêu cầu đang giữ lịch thì cho thanh toán tiếp / huỷ thay vì tạo mới.
  useEffect(() => {
    let active = true;
    void getBookingExtensions(bookingId).then((res) => {
      if (!active) return;
      const current = res?.success
        ? res.data?.find((row) => row.status === "pending" && new Date(row.expiresAt).getTime() > Date.now()) ?? null
        : null;
      setPending(current);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [bookingId]);

  const loadQuote = useCallback(async (value: number) => {
    setQuoting(true);
    setQuoteError(null);
    const res = await getExtensionQuote(bookingId, value);
    if (res?.success && res.data) {
      setQuote(res.data);
    } else {
      setQuote(null);
      setQuoteError(res?.message ?? "Không thể gia hạn với số ngày này.");
    }
    setQuoting(false);
  }, [bookingId]);

  useEffect(() => {
    if (loading || pending) return;
    void loadQuote(days);
  }, [days, loading, pending, loadQuote]);

  async function handlePay() {
    setSubmitting(true);
    setError(null);
    const res = await createExtensionPayment(bookingId, days);
    if (!res?.success || !res.data) {
      setSubmitting(false);
      setError(res?.message ?? "Không thể tạo yêu cầu gia hạn. Vui lòng thử lại.");
      return;
    }
    if (res.data.applied || !res.data.checkoutUrl) {
      onChanged(`Đã gia hạn đến ${formatDate(res.data.newEndDate)}.`);
      onClose();
      return;
    }
    window.location.href = res.data.checkoutUrl;
  }

  async function handleCancelPending() {
    setSubmitting(true);
    setError(null);
    const res = await cancelPendingExtension(bookingId);
    setSubmitting(false);
    if (!res?.success) {
      setError(res?.message ?? "Không thể huỷ yêu cầu gia hạn.");
      return;
    }
    onChanged("Đã huỷ yêu cầu gia hạn, ngày trả giữ nguyên.");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="extend-rental-title">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl lg:p-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="extend-rental-title" className="font-display text-3xl text-ink">Gia hạn thuê</h2>
            <p className="mt-1 text-sm text-stone-500">
              Đơn #{bookingId.slice(0, 8).toUpperCase()} · hạn trả hiện tại {formatDate(pending?.previousEndDate ?? rentalEndDate)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-full p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
          </div>
        ) : pending ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Bạn có yêu cầu gia hạn đang chờ thanh toán</p>
              <p className="mt-1">
                Gia hạn {pending.extraDays} ngày đến <strong>{formatDate(pending.newEndDate)}</strong> · phí{" "}
                <strong>{formatVND(pending.amount)}</strong>
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" /> Lịch được giữ đến {formatClock(pending.expiresAt)}. Quá giờ chưa thanh toán, ngày trả sẽ trở về như cũ.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-col gap-3 sm:flex-row">
              {pending.checkoutUrl && (
                <a
                  href={pending.checkoutUrl}
                  className="inline-flex flex-1 items-center justify-center rounded-xl bg-lotus px-5 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
                >
                  Thanh toán tiếp
                </a>
              )}
              <button
                type="button"
                onClick={() => void handleCancelPending()}
                disabled={submitting}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-sand px-5 py-3 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-60"
              >
                {submitting ? "Đang huỷ..." : "Huỷ yêu cầu"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Thuê thêm</p>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Số ngày gia hạn">
                {DAY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={days === value}
                    onClick={() => setDays(value)}
                    className={`min-w-[3.25rem] rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      days === value ? "border-lotus bg-lotus text-white" : "border-sand bg-white text-stone-700 hover:border-lotus"
                    }`}
                  >
                    {value} ngày
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[7rem] rounded-xl border border-sand bg-[#fff8f6] p-4">
              {quoting ? (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra lịch trống...
                </div>
              ) : quoteError ? (
                <p className="text-sm text-red-600">{quoteError}</p>
              ) : quote ? (
                <div className="space-y-2 text-sm">
                  <p className="text-stone-600">
                    Hạn trả mới: <strong className="text-ink">{formatDate(quote.newEndDate)}</strong>
                  </p>
                  <ul className="space-y-1 text-stone-600">
                    {quote.lines.map((line, index) => (
                      <li key={`${line.label}-${index}`} className="flex justify-between gap-3">
                        <span>{line.label}</span>
                        <span className="tabular-nums">{formatVND(line.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between border-t border-sand pt-2 font-semibold text-ink">
                    <span>Phí gia hạn</span>
                    <span className="tabular-nums text-lotus">{formatVND(quote.amount)}</span>
                  </div>
                </div>
              ) : null}
            </div>

            <p className="text-xs text-stone-500">
              Bấm thanh toán, hệ thống giữ lịch cho bạn trong 30 phút. Quá thời gian mà chưa thanh toán thì ngày trả trở về như cũ.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={() => void handlePay()}
              disabled={!quote || quoting || submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CalendarPlus className="h-4 w-4" />
              {submitting
                ? "Đang tạo thanh toán..."
                : quote && quote.amount > 0
                  ? `Thanh toán ${formatVND(quote.amount)}`
                  : "Xác nhận gia hạn"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
