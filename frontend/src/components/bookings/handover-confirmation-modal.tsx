"use client";

import { useEffect, useMemo, useState } from "react";
import { readStoredSession } from "@/lib/auth";
import {
  confirmBookingHandover,
  type BookingResponse,
  type ConditionBeforeRental,
  type StaffBookingResponse,
} from "@/lib/api";

type Props = {
  booking: StaffBookingResponse | null;
  onClose: () => void;
  onCompleted: (booking: BookingResponse, message: string) => void;
  onError: (message: string) => void;
};

const CONDITION_OPTIONS: { value: ConditionBeforeRental; label: string; hint: string }[] = [
  { value: "GOOD", label: "Tốt", hint: "Không phát hiện lỗi trước khi nhận" },
  { value: "MINOR_DAMAGE", label: "Có lỗi nhẹ", hint: "Vẫn có thể bàn giao, cần ghi rõ tình trạng" },
  { value: "MAJOR_DAMAGE", label: "Lỗi nặng", hint: "Chỉ có thể từ chối bàn giao" },
];

export function HandoverConfirmationModal({ booking, onClose, onCompleted, onError }: Props) {
  const [condition, setCondition] = useState<ConditionBeforeRental>("GOOD");
  const [correctProduct, setCorrectProduct] = useState(false);
  const [noVisibleDefect, setNoVisibleDefect] = useState(false);
  const [customerAgreed, setCustomerAgreed] = useState(false);
  const [deliveredBy, setDeliveredBy] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"CONFIRMED" | "REJECTED" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) return;
    const session = readStoredSession();
    setCondition("GOOD");
    setCorrectProduct(false);
    setNoVisibleDefect(false);
    setCustomerAgreed(false);
    setDeliveredBy(session?.user.fullName ?? session?.user.email ?? "");
    setReceivedBy(booking.deliveryAddress?.receiverName ?? booking.customerName ?? "");
    setReceiverPhone(booking.deliveryAddress?.phone ?? booking.customerPhone ?? "");
    setImageUrls([""]);
    setNote("");
    setSubmitting(null);
    setFormError(null);
  }, [booking]);

  const normalizedImages = useMemo(
    () => imageUrls.map((url) => url.trim()).filter(Boolean),
    [imageUrls],
  );

  if (!booking) return null;

  function updateImage(index: number, value: string) {
    setImageUrls((current) => current.map((url, candidate) => (candidate === index ? value : url)));
  }

  function validateImageUrls() {
    return normalizedImages.every((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    });
  }

  async function submit(handoverStatus: "CONFIRMED" | "REJECTED") {
    if (!booking) return;
    const bookingId = booking.id;
    setFormError(null);

    if (!validateImageUrls()) {
      setFormError("Ảnh bàn giao phải là URL http/https hợp lệ.");
      return;
    }
    if (handoverStatus === "CONFIRMED") {
      if (!correctProduct || !customerAgreed) {
        setFormError("Cần xác nhận đúng sản phẩm và người nhận đồng ý.");
        return;
      }
      if (condition === "GOOD" && !noVisibleDefect) {
        setFormError("Cần xác nhận sản phẩm không có lỗi trước khi nhận.");
        return;
      }
      if (condition === "MAJOR_DAMAGE") {
        setFormError("Sản phẩm lỗi nặng không thể bàn giao. Vui lòng từ chối bàn giao.");
        return;
      }
      if (condition === "MINOR_DAMAGE" && !note.trim()) {
        setFormError("Vui lòng mô tả lỗi nhẹ trước khi xác nhận bàn giao.");
        return;
      }
      if (normalizedImages.length === 0) {
        setFormError("Cần ít nhất một ảnh sản phẩm tại thời điểm bàn giao.");
        return;
      }
      if (!deliveredBy.trim() || !receivedBy.trim()) {
        setFormError("Cần nhập đầy đủ người giao và người nhận.");
        return;
      }
    } else if (!note.trim()) {
      setFormError("Cần ghi rõ lý do từ chối bàn giao.");
      return;
    }

    setSubmitting(handoverStatus);
    const response = await confirmBookingHandover(bookingId, {
      handoverStatus,
      conditionBeforeRental: condition,
      conditionImages: normalizedImages,
      correctProductConfirmed: correctProduct,
      noDefectConfirmed: noVisibleDefect,
      customerAgreed,
      deliveredBy: deliveredBy.trim() || undefined,
      receivedBy: receivedBy.trim() || undefined,
      receiverPhone: receiverPhone.trim() || undefined,
      note: note.trim() || undefined,
    });
    setSubmitting(null);

    if (!response.success || !response.data) {
      const message = response.message ?? "Không thể cập nhật biên bản bàn giao.";
      setFormError(message);
      onError(message);
      return;
    }

    onCompleted(
      response.data,
      handoverStatus === "CONFIRMED"
        ? "Đã xác nhận bàn giao và chuyển đơn sang trạng thái đang thuê."
        : "Đã ghi nhận từ chối bàn giao. Trạng thái đơn được giữ nguyên.",
    );
  }

  const busy = submitting !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-sand bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-sand bg-white px-6 py-5">
          <div>
            <h2 id="handover-title" className="font-display text-3xl text-ink">Biên bản bàn giao</h2>
            <p className="mt-1 text-sm text-stone-500">
              Đơn #{booking.id.slice(0, 8).toUpperCase()} · {booking.customerName ?? "Khách hàng"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-2 text-stone-400 transition hover:bg-mist hover:text-ink disabled:opacity-40"
            aria-label="Đóng"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-7 p-6">
          <section className="rounded-xl border border-sand bg-parchment/40 p-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Sản phẩm bàn giao</h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {booking.items.map((item) => (
                <li key={item.id} className="rounded-lg bg-white px-3 py-2 text-sm text-ink">
                  <span className="font-semibold">{item.garmentName ?? "Trang phục"}</span>
                  <span className="text-stone-500"> · Size {item.sizeLabel ?? "—"}</span>
                  <span className="block font-mono text-xs text-lotus">Asset: {item.assetCode ?? "Chưa gán"}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-bold text-ink">Checklist bắt buộc</h3>
            <div className="mt-3 grid gap-3">
              {[
                { checked: correctProduct, set: setCorrectProduct, label: "Sản phẩm bàn giao đúng mẫu, đúng size và đúng asset trong đơn" },
                { checked: noVisibleDefect, set: setNoVisibleDefect, label: "Sản phẩm không có lỗi nhìn thấy trước khi nhận" },
                { checked: customerAgreed, set: setCustomerAgreed, label: "Khách/người nhận đã kiểm tra và đồng ý nhận sản phẩm" },
              ].map((item) => (
                <label key={item.label} className="flex cursor-pointer items-start gap-3 rounded-lg border border-sand p-3 text-sm text-stone-700 transition hover:bg-mist">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(event) => item.set(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-lotus"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <label className="text-sm font-bold text-ink" htmlFor="handover-condition">Tình trạng trước khi thuê</label>
            <select
              id="handover-condition"
              value={condition}
              onChange={(event) => {
                const value = event.target.value as ConditionBeforeRental;
                setCondition(value);
                if (value !== "GOOD") setNoVisibleDefect(false);
              }}
              className="mt-2 w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-lotus"
            >
              {CONDITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label} — {option.hint}</option>
              ))}
            </select>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-ink" htmlFor="handover-delivered-by">Người giao</label>
              <input id="handover-delivered-by" value={deliveredBy} onChange={(event) => setDeliveredBy(event.target.value)} maxLength={200} className="w-full rounded-lg border border-sand px-3 py-2.5 text-sm outline-none focus:border-lotus" placeholder="Họ tên người giao" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-ink" htmlFor="handover-received-by">Người nhận</label>
              <input id="handover-received-by" value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} maxLength={200} className="w-full rounded-lg border border-sand px-3 py-2.5 text-sm outline-none focus:border-lotus" placeholder="Họ tên người nhận" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-bold text-ink" htmlFor="handover-phone">Số điện thoại người nhận</label>
              <input id="handover-phone" value={receiverPhone} onChange={(event) => setReceiverPhone(event.target.value)} maxLength={30} className="w-full rounded-lg border border-sand px-3 py-2.5 text-sm outline-none focus:border-lotus" placeholder="Không bắt buộc" />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink">Ảnh tại thời điểm bàn giao</h3>
                <p className="mt-1 text-xs text-stone-500">Nhập URL ảnh đã tải lên kho lưu trữ.</p>
              </div>
              <button type="button" onClick={() => setImageUrls((current) => [...current, ""])} className="rounded-lg border border-sand px-3 py-2 text-xs font-semibold text-lotus transition hover:bg-parchment">+ Thêm ảnh</button>
            </div>
            <div className="mt-3 space-y-2">
              {imageUrls.map((url, index) => (
                <div key={index} className="flex gap-2">
                  <input value={url} onChange={(event) => updateImage(index, event.target.value)} className="min-w-0 flex-1 rounded-lg border border-sand px-3 py-2.5 text-sm outline-none focus:border-lotus" placeholder="https://..." />
                  {imageUrls.length > 1 && (
                    <button type="button" onClick={() => setImageUrls((current) => current.filter((_, candidate) => candidate !== index))} className="rounded-lg border border-red-200 px-3 text-red-600 transition hover:bg-red-50" aria-label={`Xóa ảnh ${index + 1}`}>
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <label className="mb-2 block text-sm font-bold text-ink" htmlFor="handover-note">Ghi chú / lý do từ chối</label>
            <textarea id="handover-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={4} className="w-full rounded-lg border border-sand px-3 py-2.5 text-sm outline-none focus:border-lotus" placeholder="Mô tả lỗi có sẵn hoặc lý do không thể bàn giao..." />
          </section>

          {formError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-sand bg-white px-6 py-5 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-sand px-5 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-mist disabled:opacity-40">Hủy</button>
          <button type="button" disabled={busy} onClick={() => void submit("REJECTED")} className="rounded-lg border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-40">
            {submitting === "REJECTED" ? "Đang ghi nhận..." : "Từ chối bàn giao"}
          </button>
          <button type="button" disabled={busy} onClick={() => void submit("CONFIRMED")} className="rounded-lg bg-lotus px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-40">
            {submitting === "CONFIRMED" ? "Đang xác nhận..." : "Xác nhận bàn giao"}
          </button>
        </div>
      </div>
    </div>
  );
}
