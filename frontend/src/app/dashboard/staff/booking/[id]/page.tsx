"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StaffPortalShell, ConfirmModal } from "@/components/heritage/ui";
import {
  getStaffBooking,
  advanceBookingStatus,
  markBookingPaid,
  createRefund,
  type StaffBookingResponse,
} from "@/lib/api";
import { STATUS_LABELS, statusBadgeClass } from "@/lib/status-labels";

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN");
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

const NEXT_ACTIONS: Partial<Record<string, { status: string; label: string; style: string }[]>> = {
  pending_confirmation: [
    { status: "confirmed", label: "Xác nhận", style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "rejected",  label: "Từ chối",  style: "border border-red-300 text-red-700 hover:bg-red-50" },
  ],
  // Giữ lại lối đi cho các đơn cũ lỡ đang ở trạng thái "confirmed".
  confirmed: [
    { status: "awaiting_payment", label: "Chờ thanh toán", style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "cancelled",        label: "Hủy",            style: "border border-red-300 text-red-700 hover:bg-red-50" },
  ],
  awaiting_payment: [],
  paid: [
    { status: "preparing", label: "Bắt đầu chuẩn bị", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  preparing: [
    { status: "ready_for_pickup", label: "Sẵn sàng nhận", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  ready_for_pickup: [
    { status: "delivering", label: "Đang giao",      style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "renting",    label: "Khách đã nhận",  style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  delivering: [
    { status: "renting", label: "Khách đã nhận", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  renting: [
    { status: "returned", label: "Khách đã trả",  style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "overdue",  label: "Đánh dấu quá hạn", style: "border border-red-300 text-red-700 hover:bg-red-50" },
  ],
  returned: [
    { status: "inspection_pending", label: "Bắt đầu kiểm tra", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  overdue: [
    { status: "returned", label: "Khách đã trả", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
};

const PAYMENT_METHODS: { key: string; label: string; icon: string }[] = [
  { key: "cash", label: "Tiền mặt", icon: "payments" },
  { key: "qr_code", label: "QR Code", icon: "qr_code" },
];

export default function StaffBookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bookingId = params.id as string;

  const [booking, setBooking] = useState<StaffBookingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const [paymentDialog, setPaymentDialog] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");
  const [refundDialog, setRefundDialog] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{title:string; message:string; danger?:boolean; onConfirm:()=>void} | null>(null);
  const [refundBankName, setRefundBankName] = useState("");
  const [refundBankAccount, setRefundBankAccount] = useState("");
  const [refundBankHolder, setRefundBankHolder] = useState("");

  useEffect(() => {
    if (!bookingId) return;
    setLoading(true);
    getStaffBooking(bookingId)
      .then((res) => {
        if (res.success && res.data) setBooking(res.data);
        else setError(res.message ?? "Không tìm thấy đơn thuê.");
      })
      .finally(() => setLoading(false));
  }, [bookingId]);

  const CONFIRM_REQUIRED = new Set(["cancelled", "rejected", "overdue"]);

  async function handleAction(status: string) {
    if (!booking) return;
    setActioning(true);
    setActionError(null);
    const res = await advanceBookingStatus(booking.id, status);
    setActioning(false);
    if (res.success && res.data) {
      setBooking((prev) => (prev ? { ...prev, status: res.data!.status } : prev));
      const bookingCode = booking.id.slice(0, 8).toUpperCase();
      const statusLabel = STATUS_LABELS[res.data.status]?.label ?? res.data.status;
      showToast("success", `Đơn #${bookingCode} đã chuyển sang trạng thái ${statusLabel}.`);
    } else {
      setActionError(res.message ?? "Thao tác thất bại.");
    }
  }

  async function handleMarkPaid() {
    if (!booking) return;
    setActioning(true);
    setActionError(null);
    setPaymentDialog(false);
    const res = await markBookingPaid(booking.id, selectedPaymentMethod);
    setActioning(false);
    if (res.success && res.data) {
      setBooking((prev) => (prev ? { ...prev, status: res.data!.status } : prev));
      const bookingCode = booking.id.slice(0, 8).toUpperCase();
      showToast("success", `Đơn #${bookingCode} đã thanh toán thành công.`);
    } else {
      setActionError(res.message ?? "Không thể ghi nhận thanh toán.");
    }
  }

  async function handleMarkDeliveryPaid() {
    if (!booking) return;
    setActioning(true);
    setActionError(null);
    const res = await markBookingPaid(booking.id, "qr_code");
    setActioning(false);
    if (res.success && res.data) {
      setBooking((prev) => (prev ? { ...prev, status: res.data!.status } : prev));
      const bookingCode = booking.id.slice(0, 8).toUpperCase();
      showToast("success", `Đơn #${bookingCode} đã thanh toán thành công.`);
    } else {
      setActionError(res.message ?? "Không thể xác nhận thanh toán QR.");
    }
  }

  async function handleCashRefund() {
    if (!booking) return;
    setActioning(true);
    setActionError(null);
    setRefundDialog(false);
    const res = await createRefund({
      bookingId: booking.id,
      refundMethod: "cash",
      reason: "Hoàn cọc tiền mặt tại quầy",
    });
    setActioning(false);
    if (res.success) {
      setBooking(null);
      router.push("/dashboard/staff");
    } else {
      setActionError(res.message ?? "Không thể hoàn cọc.");
    }
  }

  async function handleBankRefund() {
    if (!booking) return;
    setActioning(true);
    setActionError(null);
    setRefundDialog(false);
    const res = await createRefund({
      bookingId: booking.id,
      refundMethod: "bank_transfer",
      reason: "Yêu cầu hoàn cọc chuyển khoản",
      bankName: refundBankName,
      bankAccountNumber: refundBankAccount,
      bankAccountHolder: refundBankHolder,
    });
    setActioning(false);
    if (res.success) {
      setBooking(null);
      router.push("/dashboard/staff");
    } else {
      setActionError(res.message ?? "Không thể tạo yêu cầu hoàn cọc.");
    }
  }

  if (loading) {
    return (
      <StaffPortalShell active="overview" title="Chi tiết đơn thuê" subtitle="Đang tải...">
        <div className="py-20 text-center text-stone-400">Đang tải...</div>
      </StaffPortalShell>
    );
  }

  if (error || !booking) {
    return (
      <StaffPortalShell active="overview" title="Chi tiết đơn thuê" subtitle="Không tìm thấy">
        <div className="py-20 text-center">
          <p className="text-stone-400">{error ?? "Không tìm thấy đơn thuê."}</p>
          <Link href="/dashboard/staff" className="mt-4 inline-block text-lotus hover:underline">
            ← Quay lại danh sách
          </Link>
        </div>
      </StaffPortalShell>
    );
  }

  const s = STATUS_LABELS[booking.status] ?? { label: booking.status, color: "bg-stone-100 text-stone-600" };
  const actions = NEXT_ACTIONS[booking.status] ?? [];

  return (
    <StaffPortalShell
      active="overview"
      title="Chi tiết đơn thuê"
      subtitle={`#${booking.id.slice(0, 8).toUpperCase()}`}
    >
      {/* Back link */}
      <Link
        href="/dashboard/staff"
        className="mb-6 inline-flex items-center gap-1 text-sm font-semibold text-lotus hover:underline"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Quay lại danh sách
      </Link>

      {actionError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {toast && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg border p-4 text-sm ${toast.type === "success" ? "border-jade/30 bg-jade/5 text-jade" : "border-red-200 bg-red-50 text-red-700"}`}>
          <span className="material-symbols-outlined text-[18px]">{toast.type === "success" ? "check_circle" : "error"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header card */}
      <div className="mb-6 overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand bg-mist px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-ink">#{booking.id.slice(0, 8).toUpperCase()}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${s.color}`}>
              {s.label}
            </span>
          </div>
          <span className="text-xs text-stone-400">
            Tạo lúc {formatDateTime(booking.createdAt)}
          </span>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Khách hàng</p>
            <p className="mt-1 font-medium text-ink">{booking.customerName ?? "—"}</p>
            {booking.customerPhone && (
              <p className="text-sm text-stone-500">{booking.customerPhone}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Thời gian thuê</p>
            <p className="mt-1 font-medium text-ink">
              {formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)}
            </p>
            <p className="text-sm text-stone-500">{booking.days} ngày</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Phương thức</p>
            <p className="mt-1 font-medium text-ink">
              {booking.pickupMethod === "delivery" ? "Giao hàng" : "Nhận tại cửa hàng"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Trang phục</p>
            <p className="mt-1 font-medium text-ink">{booking.items.length} món</p>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="mb-6 overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
        <div className="border-b border-sand bg-stone-50 px-6 py-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-600">Trang phục trong đơn</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand text-left text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                <th className="px-6 py-3">Tên trang phục</th>
                <th className="px-6 py-3">Size</th>
                <th className="px-6 py-3">Đơn giá/ngày</th>
                <th className="px-6 py-3">Tiền cọc</th>
                <th className="px-6 py-3">Mã asset</th>
                <th className="px-6 py-3">Trạng thái asset</th>
              </tr>
            </thead>
            <tbody>
              {booking.items.map((item) => (
                <tr key={item.id} className="border-b border-sand last:border-b-0 hover:bg-stone-50">
                  <td className="px-6 py-3 font-medium text-ink">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt={item.garmentName ?? "Trang phục"}
                          className="h-14 w-11 shrink-0 rounded-md border border-sand object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-sand bg-parchment text-stone-300">
                          <span className="material-symbols-outlined text-[20px]">apparel</span>
                        </div>
                      )}
                      <span>{item.garmentName ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-stone-600">{item.sizeLabel ?? "—"}</td>
                  <td className="px-6 py-3 text-stone-600">{formatVND(item.dailyPrice)}</td>
                  <td className="px-6 py-3 text-stone-600">{formatVND(item.depositAmount)}</td>
                  <td className="px-6 py-3">
                    {item.assetCode ? (
                      <span className="font-mono text-xs text-lotus">{item.assetCode}</span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-stone-600">{item.assetStatus ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financial summary */}
      <div className="mb-6 overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
        <div className="border-b border-sand bg-stone-50 px-6 py-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-600">Thông tin tài chính</h3>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Tiền thuê</p>
            <p className="mt-1 text-lg font-bold text-ink">{formatVND(booking.rentalTotal)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Tiền cọc</p>
            <p className="mt-1 text-lg font-bold text-ink">{formatVND(booking.depositTotal)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Tiền phạt</p>
            <p className="mt-1 text-lg font-bold text-red-600">{formatVND(booking.penaltyTotal ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Hoàn cọc (dự kiến)</p>
            <p className="mt-1 text-lg font-bold text-jade">
              {formatVND(Math.max(0, booking.depositTotal - (booking.penaltyTotal ?? 0)))}
            </p>
          </div>
        </div>
      </div>

      {/* Delivery address */}
      {booking.deliveryAddress && (
        <div className="mb-6 overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
          <div className="border-b border-sand bg-stone-50 px-6 py-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-600">Địa chỉ giao nhận</h3>
          </div>
          <div className="p-6">
            <p className="font-medium text-ink">{booking.deliveryAddress.receiverName} - {booking.deliveryAddress.phone}</p>
            <p className="mt-1 text-sm text-stone-600">
              {[booking.deliveryAddress.line1, booking.deliveryAddress.ward, booking.deliveryAddress.district, booking.deliveryAddress.city].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Notes */}
      {booking.note && (
        <div className="mb-6 overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
          <div className="border-b border-sand bg-stone-50 px-6 py-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-600">Ghi chú</h3>
          </div>
          <div className="p-6">
            <p className="whitespace-pre-wrap text-sm text-stone-700">{booking.note}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      {(actions.length > 0 || booking.status === "awaiting_payment") && (
        <div className="flex flex-wrap justify-end gap-3 border-t border-sand pt-6">
          {booking.status === "awaiting_payment" && (
            booking.pickupMethod === "delivery" ? (
              <button
                type="button"
                disabled={actioning}
                onClick={handleMarkDeliveryPaid}
                className="rounded-lg bg-jade px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
              >
                {actioning ? "Đang xử lý..." : `Xác nhận đã nhận tiền QR (${formatVND(booking.rentalTotal + booking.depositTotal)})`}
              </button>
            ) : (
              <button
                type="button"
                disabled={actioning}
                onClick={() => { setSelectedPaymentMethod(booking.paymentMethod === "qr_code" ? "qr_code" : "cash"); setPaymentDialog(true); }}
                className="rounded-lg bg-jade px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
              >
                {actioning ? "Đang xử lý..." : `Đã thanh toán (${formatVND(booking.rentalTotal + booking.depositTotal)})`}
              </button>
            )
          )}
          {actions.map((action) => {
            const needsConfirm = CONFIRM_REQUIRED.has(action.status);
            return (
              <button
                key={action.status}
                type="button"
                disabled={actioning}
                onClick={() => {
                  if (needsConfirm) {
                    const labels: Record<string, string> = { cancelled: "hủy", rejected: "từ chối", overdue: "đánh dấu quá hạn" };
                    setConfirmDialog({
                      title: "Xác nhận",
                      message: `Bạn có chắc muốn ${labels[action.status] ?? action.status} đơn này?`,
                      danger: true,
                      onConfirm: () => handleAction(action.status),
                    });
                  } else {
                    handleAction(action.status);
                  }
                }}
                className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${action.style}`}
              >
                {actioning ? "Đang xử lý..." : action.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Payment dialog */}
      {paymentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg border border-sand bg-white p-8 shadow-2xl">
            <h3 className="font-display text-2xl text-ink">Xác nhận thanh toán</h3>
            <p className="mt-1 text-sm text-stone-500">
              Khách: <strong>{booking.customerName ?? "—"}</strong>
            </p>
            <div className="mt-6 rounded-xl bg-jade/5 border border-jade/30 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">Tiền thuê</span>
                <span className="font-semibold text-ink">{formatVND(booking.rentalTotal)}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-stone-600">Tiền cọc</span>
                <span className="font-semibold text-ink">{formatVND(booking.depositTotal)}</span>
              </div>
              <div className="mt-3 border-t border-jade/30 pt-3 flex justify-between text-base">
                <span className="font-semibold text-ink">Tổng thu</span>
                <span className="font-bold text-jade">{formatVND(booking.rentalTotal + booking.depositTotal)}</span>
              </div>
            </div>
            <div className="mt-6">
              <label className="mb-3 block text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                Phương thức thanh toán
              </label>
              <div className="grid grid-cols-2 gap-3">
                {PAYMENT_METHODS.map((pm) => (
                  <button
                    key={pm.key}
                    type="button"
                    onClick={() => setSelectedPaymentMethod(pm.key)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-sm font-medium transition ${
                      selectedPaymentMethod === pm.key
                        ? "border-lotus bg-parchment text-lotus"
                        : "border-sand bg-white text-stone-600 hover:bg-mist"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">{pm.icon}</span>
                    {pm.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPaymentDialog(false)}
                className="rounded-lg border border-sand px-5 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actioning}
                onClick={handleMarkPaid}
                className="rounded-lg bg-jade px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
              >
                {actioning ? "Đang xử lý..." : "Xác nhận đã thu tiền"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal open={!!confirmDialog} title={confirmDialog?.title??""} message={confirmDialog?.message??""} danger={confirmDialog?.danger} onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />
    </StaffPortalShell>
  );
}