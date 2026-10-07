"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StaffPortalShell, ConfirmModal } from "@/components/heritage/ui";
import {
  getStaffPendingBookings,
  getStaffAllBookings,
  getStaffCompletedRefundBookings,
  getDeliveryMap,
  advanceBookingStatus,
  markBookingPaid,
  createRefund,
  updateRefundDetails,
  closeBookingWithoutRefund,
  type BookingResponse,
  type StaffBookingResponse,
  type StaffRefundSummary,
  type DeliveryPoint,
} from "@/lib/api";
import { DeliveryMap } from "@/components/location/delivery-map";
import { STATUS_LABELS, statusBadgeClass } from "@/lib/status-labels";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";
import { HandoverConfirmationModal } from "@/components/bookings/handover-confirmation-modal";

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

const NEXT_ACTIONS: Partial<Record<string, { status: string; label: string; style: string }[]>> = {
  pending_confirmation: [
    { status: "confirmed", label: "Xác nhận", style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "rejected",  label: "Từ chối",  style: "border border-red-300 text-red-700 hover:bg-red-50" },
  ],
  confirmed: [
    { status: "awaiting_payment", label: "Chờ thanh toán", style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "cancelled",        label: "Hủy",            style: "border border-red-300 text-red-700 hover:bg-red-50" },
  ],
  awaiting_payment: [
    // "paid" không dùng advanceBookingStatus nữa — staff phải qua dialog mark-paid
  ],
  paid: [
    { status: "preparing", label: "Bắt đầu chuẩn bị", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  preparing: [
    { status: "ready_for_pickup", label: "Sẵn sàng nhận", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  ready_for_pickup: [
    { status: "delivering", label: "Đang giao", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  delivering: [],
  renting: [
    { status: "returned", label: "Khách đã trả",  style: "bg-lotus text-white hover:bg-oxblood" },
    { status: "overdue",  label: "Đánh dấu quá hạn", style: "border border-red-300 text-red-700 hover:bg-red-50" },
  ],
  returned: [
    { status: "inspection_pending", label: "Bắt đầu kiểm tra", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
  // inspection_pending → completed: bị cấm ở staff overview.
  // Việc hoàn tất chỉ được thực hiện qua màn Kiểm tra (/dashboard/staff/inspection).
  overdue: [
    { status: "returned", label: "Khách đã trả", style: "bg-lotus text-white hover:bg-oxblood" },
  ],
};

type Tab = "pending" | "all" | "refunds" | "map";

type PaymentDialog = {
  bookingId: string;
  customerName: string | null;
  rentalTotal: number;
  depositTotal: number;
} | null;

const PAYMENT_METHODS: { key: string; label: string; icon: string }[] = [
  { key: "cash", label: "Tiền mặt", icon: "payments" },
  { key: "qr_code", label: "QR Code", icon: "qr_code" },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
  qr_code: "Chuyển khoản (QR)",
  pos_card: "Thẻ POS",
  online: "Online",
};

const STAFF_PAGE_SIZE = 5;

// Danh sách số trang rút gọn: 1 … 4 5 6 … 20
function buildPageList(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = [1, total, current - 1, current, current + 1]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const pages: (number | "...")[] = [];
  let prev = 0;
  for (const p of [...new Set(wanted)]) {
    if (p - prev > 1) pages.push("...");
    pages.push(p);
    prev = p;
  }
  return pages;
}

// Statuses mà item chưa có asset là vấn đề cần báo manager
const ASSET_NEEDED_STATUSES = [
  "confirmed",
  "awaiting_payment",
  "paid",
  "preparing",
];

export default function StaffDashboardPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [bookings, setBookings] = useState<StaffBookingResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showSuccess(id: string, message: string) {
    setSuccessId(id);
    setSuccessMsg(message);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => { setSuccessId(null); setSuccessMsg(null); }, 4000);
  }

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);
  const [confirmDialog, setConfirmDialog] = useState<{title:string; message:string; danger?:boolean; onConfirm:()=>void} | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialog>(null);
  const [handoverBooking, setHandoverBooking] = useState<StaffBookingResponse | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");

  // Refund form state
  const [refundDialog, setRefundDialog] = useState<{
    bookingId: string;
    refundId?: string;
    customerName: string | null;
    refundMethod: "cash" | "bank_transfer";
    depositTotal: number;
    penaltyTotal: number;
  } | null>(null);
  const [refundBankName, setRefundBankName] = useState("");
  const [refundBankAccount, setRefundBankAccount] = useState("");
  const [refundBankHolder, setRefundBankHolder] = useState("");

  useEffect(() => {
    setPage(1);
    if (tab === "map") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    let fetcher;
    if (tab === "refunds") {
      fetcher = getStaffCompletedRefundBookings;
    } else {
      fetcher = tab === "pending" ? getStaffPendingBookings : getStaffAllBookings;
    }
    fetcher()
      .then((res) => {
        if (res.success && res.data) setBookings(res.data);
        else setErrorMsg(res.message ?? "Không thể tải danh sách đơn.");
      })
      .finally(() => setLoading(false));
  }, [tab]);

  const refreshActiveTab = useCallback(() => {
    if (tab === "map") return;
    const fetcher = tab === "refunds"
      ? getStaffCompletedRefundBookings
      : tab === "pending"
        ? getStaffPendingBookings
        : getStaffAllBookings;
    return fetcher().then((res) => {
      if (res.success && res.data) setBookings(res.data);
    });
  }, [tab]);

  useRealtimeInvalidation({
    bookings: refreshActiveTab,
    refunds: refreshActiveTab,
  }, tab !== "map");

  const CONFIRM_REQUIRED = new Set(["cancelled", "rejected", "overdue"]);

  function openHandover(booking: StaffBookingResponse) {
    setHandoverBooking(booking);
  }

  function handleHandoverCompleted(updated: BookingResponse, message: string) {
    setHandoverBooking(null);
    setBookings((prev) => prev.map((booking) => (
      booking.id === updated.id ? { ...booking, ...updated } : booking
    )));
    showSuccess(updated.id, message);
    if (tab === "pending" && updated.status !== "pending_confirmation") {
      setTimeout(() => setBookings((prev) => prev.filter((booking) => booking.id !== updated.id)), 4500);
    }
  }

  async function handleAction(id: string, status: string) {
    setActioningId(id);
    setErrorMsg(null);
    const res = await advanceBookingStatus(id, status);
    setActioningId(null);
    if (res.success && res.data) {
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: res.data!.status, paidPaymentMethod: res.data!.paidPaymentMethod ?? b.paidPaymentMethod } : b)),
      );
      const bookingCode = id.slice(0, 8).toUpperCase();
      const statusLabel = STATUS_LABELS[res.data.status]?.label ?? res.data.status;
      showSuccess(id, `Đơn #${bookingCode} đã chuyển sang trạng thái ${statusLabel}.`);
      if (tab === "pending" && status !== "pending_confirmation") {
        setTimeout(() => setBookings((prev) => prev.filter((b) => b.id !== id)), 4500);
      }
    } else {
      // Nếu lỗi liên quan đến asset thì hiển thị popup thay vì banner
      if (res.message?.includes("assigned asset")) {
        setErrorDialog(
          "Không thể chuyển trạng thái vì các món trong đơn chưa được gán tài sản vật lý.\n\n" +
          "Vui lòng báo cho Quản lý / Chủ cửa hàng để gán asset cho từng món hàng trước khi chuyển sang trạng thái này.",
        );
      } else {
        setErrorMsg(res.message ?? "Thao tác thất bại.");
      }
    }
  }

  function openPaymentDialog(booking: StaffBookingResponse) {
    // Tự chọn sẵn phương thức khách đã đăng ký với đơn (cash | qr_code)
    setSelectedPaymentMethod(booking.paymentMethod === "qr_code" ? "qr_code" : "cash");
    setPaymentDialog({
      bookingId: booking.id,
      customerName: booking.customerName,
      rentalTotal: booking.rentalTotal,
      depositTotal: booking.depositTotal,
    });
  }

  async function handleMarkPaid() {
    if (!paymentDialog) return;
    const id = paymentDialog.bookingId;
    setActioningId(id);
    setErrorMsg(null);
    setPaymentDialog(null);
    const res = await markBookingPaid(id, selectedPaymentMethod);
    setActioningId(null);
    if (res.success && res.data) {
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: res.data!.status, paidPaymentMethod: res.data!.paidPaymentMethod ?? b.paidPaymentMethod } : b)),
      );
      const bookingCode = id.slice(0, 8).toUpperCase();
      showSuccess(id, `Đơn #${bookingCode} đã thanh toán thành công.`);
    } else {
      setErrorMsg(res.message ?? "Không thể ghi nhận thanh toán.");
    }
  }

  async function handleMarkDeliveryPaid(bookingId: string) {
    setActioningId(bookingId);
    setErrorMsg(null);
    const res = await markBookingPaid(bookingId, "qr_code");
    setActioningId(null);
    if (res.success && res.data) {
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: res.data!.status, paidPaymentMethod: res.data!.paidPaymentMethod ?? b.paidPaymentMethod } : b)),
      );
      const bookingCode = bookingId.slice(0, 8).toUpperCase();
      showSuccess(bookingId, `Đơn #${bookingCode} đã thanh toán thành công.`);
    } else {
      setErrorMsg(res.message ?? "Không thể xác nhận thanh toán online.");
    }
  }

  function refundMethodForBooking(booking: StaffBookingResponse): "cash" | "bank_transfer" {
    return booking.paidPaymentMethod === "cash" ? "cash" : "bank_transfer";
  }

  function openRefundDialog(booking: StaffBookingResponse, refund?: StaffRefundSummary) {
    setRefundBankName(refund?.bankName ?? "");
    setRefundBankAccount(refund?.bankAccountNumber ?? "");
    setRefundBankHolder(refund?.bankAccountHolder ?? "");
    setRefundDialog({
      bookingId: booking.id,
      refundId: refund?.id,
      customerName: booking.customerName,
      refundMethod: refund?.refundMethod === "cash" ? "cash" : refundMethodForBooking(booking),
      depositTotal: booking.depositTotal,
      penaltyTotal: booking.penaltyTotal ?? 0,
    });
  }

  async function refreshRefundBookings() {
    const res = await getStaffCompletedRefundBookings();
    if (res.success && res.data) setBookings(res.data);
    else setErrorMsg(res.message ?? "Không thể tải lại danh sách hoàn cọc.");
  }

  async function handleCashRefund(bookingId?: string) {
    const id = bookingId ?? refundDialog?.bookingId;
    if (!id) return;
    setActioningId(id);
    setErrorMsg(null);
    setRefundDialog(null);
    const res = await createRefund({
      bookingId: id,
      refundMethod: "cash",
      reason: "Hoàn cọc tiền mặt tại quầy",
    });
    setActioningId(null);
    if (res.success && res.data) {
      await refreshRefundBookings();
    } else {
      setErrorMsg(res.message ?? "Không thể hoàn cọc.");
    }
  }

  // Đơn chờ hoàn cọc nhưng phạt >= cọc → không có gì để hoàn, đóng đơn về hoàn tất
  async function handleCloseWithoutRefund(bookingId: string) {
    setActioningId(bookingId);
    setErrorMsg(null);
    const res = await closeBookingWithoutRefund(bookingId);
    setActioningId(null);
    if (res.success && res.data) {
      await refreshRefundBookings();
    } else {
      setErrorMsg(res.message ?? "Không thể đóng đơn.");
    }
  }

  async function handleBankTransferRefund() {
    if (!refundDialog) return;
    const id = refundDialog.bookingId;
    setActioningId(id);
    setErrorMsg(null);
    setRefundDialog(null);
    const res = refundDialog.refundId
      ? await updateRefundDetails(refundDialog.refundId, {
          bankName: refundBankName,
          bankAccountNumber: refundBankAccount,
          bankAccountHolder: refundBankHolder,
        })
      : await createRefund({
          bookingId: id,
          refundMethod: "bank_transfer",
          reason: "Yêu cầu hoàn cọc chuyển khoản",
          bankName: refundBankName,
          bankAccountNumber: refundBankAccount,
          bankAccountHolder: refundBankHolder,
        });
    setActioningId(null);
    if (res.success) {
      await refreshRefundBookings();
    } else {
      setErrorMsg(res.message ?? "Không thể cập nhật yêu cầu hoàn cọc.");
    }
  }

  const refundAmount = refundDialog
    ? Math.max(0, refundDialog.depositTotal - refundDialog.penaltyTotal)
    : 0;

  const pendingRefundCount = tab === "pending" ? bookings.filter((b) => b.status === "pending_confirmation").length : 0;
  // Đảm bảo đơn mới nhất luôn ở đầu theo ngày tạo.
  // Tab refunds giữ nguyên thứ tự backend (đã sắp theo lần cập nhật hoàn cọc).
  const sortedBookings =
    tab === "refunds"
      ? bookings
      : [...bookings].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

  // Tìm kiếm theo mã đơn / tên khách / SĐT / tên trang phục
  const searchQuery = search.trim().toLowerCase().replace(/^#/, "");
  const filteredBookings = searchQuery
    ? sortedBookings.filter(
        (b) =>
          b.id.toLowerCase().includes(searchQuery) ||
          (b.customerName ?? "").toLowerCase().includes(searchQuery) ||
          (b.customerPhone ?? "").includes(searchQuery) ||
          b.items.some((item) => (item.garmentName ?? "").toLowerCase().includes(searchQuery)),
      )
    : sortedBookings;

  // Phân trang danh sách đơn
  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / STAFF_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedBookings = filteredBookings.slice((currentPage - 1) * STAFF_PAGE_SIZE, currentPage * STAFF_PAGE_SIZE);

  return (
    <StaffPortalShell
      active="overview"
      title="Quản lý đơn thuê"
      subtitle="Xác nhận, theo dõi và điều phối vòng đời đơn thuê trang phục."
    >
      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-2 border-b border-sand">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition border-b-2 -mb-px ${
            tab === "pending"
              ? "border-lotus text-lotus"
              : "border-transparent text-stone-500 hover:text-lotus"
          }`}
        >
          Chờ xác nhận
          {pendingRefundCount > 0 && tab !== "pending" && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lotus text-xs text-white">
              {pendingRefundCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition border-b-2 -mb-px ${
            tab === "all"
              ? "border-lotus text-lotus"
              : "border-transparent text-stone-500 hover:text-lotus"
          }`}
        >
          Tất cả đơn
        </button>
        <button
          type="button"
          onClick={() => setTab("refunds")}
          className={`px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition border-b-2 -mb-px ${
            tab === "refunds"
              ? "border-lotus text-lotus"
              : "border-transparent text-stone-500 hover:text-lotus"
          }`}
        >
          Yêu cầu hoàn cọc
        </button>
        <button
          type="button"
          onClick={() => setTab("map")}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition border-b-2 -mb-px ${
            tab === "map"
              ? "border-lotus text-lotus"
              : "border-transparent text-stone-500 hover:text-lotus"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">map</span>
          Bản đồ giao hàng
        </button>
        <div className="relative ml-auto mb-2 hidden md:block">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-stone-400">search</span>
          <input
            className="w-72 rounded-lg border border-sand bg-white py-2 pl-10 pr-4 text-sm text-ink outline-none transition focus:border-lotus"
            placeholder="Tìm mã đơn, khách hàng..."
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {tab === "map" ? (
        <DeliveryMapPanel />
      ) : loading ? (
        <div className="py-20 text-center text-stone-400">Đang tải...</div>
      ) : filteredBookings.length === 0 ? (
        <div className="py-20 text-center text-stone-400">
          {searchQuery
            ? `Không tìm thấy đơn phù hợp với "${search.trim()}".`
            : tab === "pending" ? "Không có đơn nào đang chờ xác nhận." : tab === "refunds" ? "Không có đơn nào cần hoàn cọc." : "Chưa có đơn nào."}
        </div>
      ) : (
        <div className="space-y-4">
          {pagedBookings.map((booking) => {
            const s = STATUS_LABELS[booking.status] ?? { label: booking.status, color: "bg-stone-100 text-stone-600" };
            const actions = NEXT_ACTIONS[booking.status] ?? [];
            const isActioning = actioningId === booking.id;
            const garmentName = booking.items[0]?.garmentName ?? "—";
            const sizeLabel = booking.items[0]?.sizeLabel ?? "—";
            // Refund info for completed bookings
            const refund = booking.refunds?.[0];
            const isRefunded = refund && (refund.status === "refunded" || refund.status === "partially_refunded");
            const isPendingRefund = refund && (refund.status === "pending" || refund.status === "refunding");
            const paidMethod = booking.paidPaymentMethod
              ? PAYMENT_METHOD_LABELS[booking.paidPaymentMethod] ?? booking.paidPaymentMethod
              : null;
            const expectedRefundMethod = refundMethodForBooking(booking);
            const needsBankDetails = isPendingRefund && refund?.refundMethod === "bank_transfer" && !refund.bankDetailsComplete;

            return (
              <div key={booking.id}>
                {successId === booking.id && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-jade/30 bg-jade/5 p-4 text-sm text-jade">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    <span>{successMsg}</span>
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand bg-parchment px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-ink">#{booking.id.slice(0, 8).toUpperCase()}</span>
                    <span className={statusBadgeClass(s.color)}>
                      {s.label}
                    </span>
                    {tab === "refunds" && isRefunded && (
                      <span className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] bg-jade/10 text-jade">
                        Đã hoàn cọc
                      </span>
                    )}
                    {tab === "refunds" && isPendingRefund && (
                      <span className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] bg-amber-50 text-amber-700">
                        Chờ duyệt hoàn cọc
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-stone-400">
                    Tạo lúc {new Date(booking.createdAt).toLocaleString("vi-VN")}
                  </span>
                </div>

                <div className={`grid gap-6 p-6 sm:grid-cols-2 ${paidMethod ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Khách hàng</p>
                    <p className="mt-1 font-medium text-ink">{booking.customerName ?? "—"}</p>
                    {booking.customerPhone && (
                      <p className="text-sm text-stone-500">{booking.customerPhone}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Trang phục</p>
                    <p className="mt-1 font-medium text-ink">{garmentName}</p>
                    <p className="text-sm text-stone-500">Size: {sizeLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Thời gian thuê</p>
                    <p className="mt-1 font-medium text-ink">
                      {formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)}
                    </p>
                    <p className="text-sm text-stone-500">{booking.days} ngày</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Hoàn cọc</p>
                    <p className="mt-1 font-medium text-ink">
                      Cọc: {formatVND(booking.depositTotal)}
                    </p>
                    <p className="text-sm text-stone-500">
                      Phạt: {formatVND(booking.penaltyTotal ?? 0)} → Hoàn: <span className="font-semibold text-jade">{formatVND(Math.max(0, booking.depositTotal - (booking.penaltyTotal ?? 0)))}</span>
                    </p>
                    {refund && (
                      <p className="mt-1 text-xs text-stone-400">
                        {refund.refundMethod === "cash" ? "Tiền mặt" : "Chuyển khoản"} · {refund.status === "refunded" ? "Đã hoàn" : refund.status === "pending" ? "Chờ duyệt" : refund.status}
                      </p>
                    )}
                  </div>
                  {paidMethod && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Phương thức thanh toán</p>
                      <p className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                        <span className="material-symbols-outlined text-[18px] text-jade">
                          {booking.paidPaymentMethod === "cash" ? "payments" : booking.paidPaymentMethod === "pos_card" ? "credit_card" : booking.paidPaymentMethod === "qr_code" ? "qr_code" : "account_balance"}
                        </span>
                        {paidMethod}
                      </p>
                      <p className="text-sm text-jade">Đã thanh toán</p>
                    </div>
                  )}
                </div>

                {/* Cảnh báo: item chưa có asset — staff không có quyền gán, phải báo manager */}
                {tab !== "refunds" && ASSET_NEEDED_STATUSES.includes(booking.status) && booking.items.some((item) => !item.garmentAssetId) && (
                  <div className="border-t border-amber-200 bg-amber-50/70 px-6 py-4">
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined mt-0.5 text-amber-600 text-xl">warning</span>
                      <div>
                        <p className="text-sm font-semibold text-amber-700">
                          Cần gán tài sản — vui lòng báo Quản lý
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-600">
                          Các item dưới đây chưa được gán tài sản vật lý. Việc gán asset thuộc quyền của{" "}
                          <strong>Quản lý / Chủ cửa hàng</strong> (manager_owner).
                          Nhân viên không thể tự gán. Vui lòng thông báo cho quản lý để gán asset trước khi chuyển trạng thái tiếp theo.
                        </p>
                        <ul className="mt-2 space-y-1">
                          {booking.items.filter((item) => !item.garmentAssetId).map((item) => (
                            <li key={item.id} className="text-xs text-amber-600 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">inventory_2</span>
                              {item.garmentName ?? "Trang phục"}
                              {item.sizeLabel ? ` (${item.sizeLabel})` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions bar — luôn hiện "Xem chi tiết" cho mọi booking */}
                <div className="flex flex-wrap justify-end gap-2 border-t border-sand px-6 py-4">
                  <Link
                    href={`/dashboard/staff/booking/${booking.id}`}
                    className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
                  >
                    Xem chi tiết
                  </Link>
                  {tab === "refunds" ? (
                    !isRefunded && (
                      isPendingRefund ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-yellow-700">
                          <span className="material-symbols-outlined text-base mr-1 align-middle">schedule</span>
                          {needsBankDetails
                            ? "Cần bổ sung tài khoản nhận hoàn trước khi Quản lý duyệt"
                            : refund.refundMethod === "bank_transfer"
                              ? "Đã gửi yêu cầu hoàn cọc — chờ Quản lý duyệt chuyển khoản"
                              : "Đã gửi yêu cầu hoàn cọc tiền mặt — chờ Quản lý duyệt"}
                          {needsBankDetails && (
                            <button
                              type="button"
                              disabled={isActioning}
                              onClick={() => openRefundDialog(booking, refund)}
                              className="rounded-md bg-lotus px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
                            >
                              Bổ sung tài khoản
                            </button>
                          )}
                        </div>
                      ) : booking.depositTotal - (booking.penaltyTotal ?? 0) <= 0 ? (
                        booking.status === "refund_pending" ? (
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={() => handleCloseWithoutRefund(booking.id)}
                            className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50"
                          >
                            {isActioning ? "Đang xử lý..." : "Hoàn tất — phạt ≥ cọc, không hoàn"}
                          </button>
                        ) : (
                          <span className="rounded-lg bg-stone-100 px-4 py-2 text-sm text-stone-500">
                            Không hoàn cọc (phạt ≥ cọc)
                          </span>
                        )
                      ) : (
                        <>
                          {expectedRefundMethod === "bank_transfer" ? (
                            <button
                              type="button"
                              disabled={isActioning}
                              onClick={() => openRefundDialog(booking)}
                              className="rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
                            >
                              {isActioning ? "Đang xử lý..." : "Tạo yêu cầu hoàn cọc (chuyển khoản)"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isActioning}
                              onClick={() => {
                                setRefundDialog({
                                  bookingId: booking.id,
                                  customerName: booking.customerName,
                                  refundMethod: "cash",
                                  depositTotal: booking.depositTotal,
                                  penaltyTotal: booking.penaltyTotal ?? 0,
                                });
                                handleCashRefund(booking.id);
                              }}
                              className="rounded-lg bg-jade px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
                            >
                              {isActioning ? "Đang xử lý..." : `Tạo yêu cầu hoàn cọc tiền mặt (${formatVND(Math.max(0, booking.depositTotal - (booking.penaltyTotal ?? 0)))})`}
                            </button>
                          )}
                        </>
                      )
                    )
                  ) : (
                    (actions.length > 0 || booking.status === "awaiting_payment" || booking.status === "ready_for_pickup" || booking.status === "delivering") && (
                      <>
                        {booking.status === "awaiting_payment" && (
                          booking.pickupMethod === "delivery" ? (
                            <button
                              type="button"
                              disabled={isActioning}
                              onClick={() => handleMarkDeliveryPaid(booking.id)}
                              className="rounded-lg bg-jade px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
                            >
                              {isActioning ? "Đang xử lý..." : `Xác nhận đã nhận tiền QR (${formatVND(booking.rentalTotal + booking.depositTotal)})`}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isActioning}
                              onClick={() => openPaymentDialog(booking)}
                              className="rounded-lg bg-jade px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
                            >
                              {isActioning ? "Đang xử lý..." : `Đã thanh toán (${formatVND(booking.rentalTotal + booking.depositTotal)})`}
                            </button>
                          )
                        )}
                        {(booking.status === "ready_for_pickup" || booking.status === "delivering") && (
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={() => openHandover(booking)}
                            className="rounded-lg bg-jade px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
                          >
                            {isActioning ? "Đang xử lý..." : booking.status === "delivering" ? "Xác nhận đã giao" : "Xác nhận bàn giao"}
                          </button>
                        )}
                        {actions.map((action) => {
                          const needsConfirm = CONFIRM_REQUIRED.has(action.status);
                          return (
                            <button
                              key={action.status}
                              type="button"
                              disabled={isActioning}
                              onClick={() => {
                                if (needsConfirm) {
                                  const labels: Record<string, string> = { cancelled: "hủy", rejected: "từ chối", overdue: "đánh dấu quá hạn" };
                                  setConfirmDialog({
                                    title: "Xác nhận",
                                    message: `Bạn có chắc muốn ${labels[action.status] ?? action.status} đơn này?`,
                                    danger: true,
                                    onConfirm: () => handleAction(booking.id, action.status),
                                  });
                                } else {
                                  handleAction(booking.id, action.status);
                                }
                              }}
                              className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${action.style}`}
                            >
                              {isActioning ? "Đang xử lý..." : action.label}
                            </button>
                          );
                        })}
                      </>
                    )
                  )}
                </div>
              </div>
            </div>
            );
          })}

          {/* Phân trang */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-white px-6 py-4 shadow-sm">
              <p className="text-xs text-stone-500">
                Hiển thị {(currentPage - 1) * STAFF_PAGE_SIZE + 1}–{Math.min(currentPage * STAFF_PAGE_SIZE, filteredBookings.length)} trong {filteredBookings.length} đơn
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Trang trước"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                {buildPageList(currentPage, totalPages).map((p, idx) =>
                  p === "..." ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-xs text-stone-400">…</span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={
                        p === currentPage
                          ? "flex h-8 min-w-8 items-center justify-center rounded-lg bg-lotus px-2 text-xs font-semibold text-white"
                          : "flex h-8 min-w-8 items-center justify-center rounded-lg border border-sand bg-white px-2 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                      }
                    >
                      {p}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Trang sau"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Refund dialog (for bank_transfer) ── */}
      {refundDialog && refundDialog.refundMethod === "bank_transfer" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg border border-sand bg-white p-8 shadow-2xl">
            <h3 className="font-display text-2xl text-ink">{refundDialog.refundId ? "Bổ sung tài khoản nhận hoàn" : "Tạo yêu cầu hoàn cọc chuyển khoản"}</h3>
            <p className="mt-1 text-sm text-stone-500">
              Khách: <strong>{refundDialog.customerName ?? "—"}</strong>. Sau khi tạo, yêu cầu sẽ chờ Quản lý duyệt.
            </p>

            <div className="mt-6 rounded-xl bg-jade/5 border border-jade/30 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">Tiền cọc</span>
                <span className="font-semibold text-ink">{formatVND(refundDialog.depositTotal)}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-stone-600">Phí phạt</span>
                <span className="font-semibold text-red-700">-{formatVND(refundDialog.penaltyTotal)}</span>
              </div>
              <div className="mt-3 border-t border-jade/30 pt-3 flex justify-between text-base">
                <span className="font-semibold text-ink">Tiền hoàn</span>
                <span className="font-bold text-jade">{formatVND(refundAmount)}</span>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-500">Tên ngân hàng</label>
                <input
                  className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
                  placeholder="VD: Vietcombank, MB Bank..."
                  value={refundBankName}
                  onChange={(e) => setRefundBankName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-500">Số tài khoản</label>
                <input
                  className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
                  placeholder="Nhập số tài khoản khách"
                  value={refundBankAccount}
                  onChange={(e) => setRefundBankAccount(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-500">Chủ tài khoản</label>
                <input
                  className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
                  placeholder="Tên chủ tài khoản"
                  value={refundBankHolder}
                  onChange={(e) => setRefundBankHolder(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRefundDialog(null)}
                className="rounded-lg border border-sand px-5 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actioningId === refundDialog.bookingId || !refundBankName.trim() || !refundBankAccount.trim() || !refundBankHolder.trim()}
                onClick={handleBankTransferRefund}
                className="rounded-lg bg-lotus px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
              >
                {actioningId === refundDialog.bookingId ? "Đang xử lý..." : refundDialog.refundId ? "Lưu thông tin — chờ Quản lý duyệt" : "Tạo yêu cầu — chờ Quản lý duyệt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment method dialog ── */}
      {paymentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg border border-sand bg-white p-8 shadow-2xl">
            <h3 className="font-display text-2xl text-ink">Xác nhận thanh toán</h3>
            <p className="mt-1 text-sm text-stone-500">
              Khách: <strong>{paymentDialog.customerName ?? "—"}</strong>
            </p>

            <div className="mt-6 rounded-xl bg-jade/5 border border-jade/30 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">Tiền thuê</span>
                <span className="font-semibold text-ink">{formatVND(paymentDialog.rentalTotal)}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-stone-600">Tiền cọc</span>
                <span className="font-semibold text-ink">{formatVND(paymentDialog.depositTotal)}</span>
              </div>
              <div className="mt-3 border-t border-jade/30 pt-3 flex justify-between text-base">
                <span className="font-semibold text-ink">Tổng thu</span>
                <span className="font-bold text-jade">
                  {formatVND(paymentDialog.rentalTotal + paymentDialog.depositTotal)}
                </span>
              </div>
            </div>

            <div className="mt-6">
              <label className="mb-3 block text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                Phương thức thanh toán
              </label>
              {/* Highlight customer's chosen method */}
              {(() => {
                const customerMethod = PAYMENT_METHODS.find((pm) => pm.key === selectedPaymentMethod);
                return customerMethod ? (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-jade/10 border border-jade/30 px-3 py-2 text-sm text-jade">
                    <span className="material-symbols-outlined text-base">check_circle</span>
                    <span>Khách đã chọn: <strong>{customerMethod.label}</strong></span>
                  </div>
                ) : null;
              })()}
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
                onClick={() => setPaymentDialog(null)}
                className="rounded-lg border border-sand px-5 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actioningId === paymentDialog.bookingId}
                onClick={handleMarkPaid}
                className="rounded-lg bg-jade px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
              >
                {actioningId === paymentDialog.bookingId ? "Đang xử lý..." : "Xác nhận đã thu tiền"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error popup dialog ── */}
      {errorDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg border border-sand bg-white p-8 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <span className="material-symbols-outlined text-5xl text-amber-500 mb-4">warning</span>
              <h3 className="font-display text-2xl text-ink">Không thể chuyển trạng thái</h3>
              <p className="mt-4 text-sm leading-relaxed text-stone-600 whitespace-pre-line">
                {errorDialog}
              </p>
              <div className="mt-6 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-left w-full">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-[0.14em] mb-1">Gợi ý</p>
                <p className="text-xs leading-relaxed text-amber-600">
                  Quay lại tab <strong>&quot;Tất cả đơn&quot;</strong>, tìm đơn này và kiểm tra cột trạng thái. Nếu thấy cảnh báo màu vàng, hãy báo cho Quản lý để gán tài sản.
                </p>
              </div>
            </div>
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setErrorDialog(null)}
                className="rounded-lg bg-lotus px-8 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal open={!!confirmDialog} title={confirmDialog?.title??""} message={confirmDialog?.message??""} danger={confirmDialog?.danger} onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />
      <HandoverConfirmationModal
        booking={handoverBooking}
        onClose={() => setHandoverBooking(null)}
        onCompleted={handleHandoverCompleted}
        onError={(message) => setErrorMsg(message)}
      />
    </StaffPortalShell>
  );
}

function DeliveryMapPanel() {
  const [points, setPoints] = useState<DeliveryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDeliveryMap()
      .then((res) => {
        if (res.success && res.data) setPoints(res.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="py-20 text-center text-stone-400">Đang tải bản đồ giao hàng...</div>;
  }

  return <DeliveryMap points={points} />;
}
