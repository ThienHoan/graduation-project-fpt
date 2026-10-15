"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMyBookings,
  cancelBooking,
  getCustomerRefund,
  getDeliveryTrack,
  getCustomerBookingInspections,
} from "@/lib/api";
import type {
  BookingResponse,
  CustomerRefundResponse,
  DeliveryTrackData,
  InspectionSessionResponse,
} from "@/lib/api";
import { DeliveryTracker } from "@/components/location/delivery-tracker";
import { readStoredSession } from "@/lib/auth";
import { getMyChatConversation, sendBookingCardMessage } from "@/lib/chat";
import { customerWidgets } from "@/lib/heritage-mock-data";
import { STATUS_LABELS, statusBadgeClass, statusOf, ACTIVE_BOOKING_STATUSES, CANCELLABLE_STATUSES } from "@/lib/status-labels";
import { ReviewModal } from "@/components/customer/review-modal";
import { BookingStatusStepper } from "@/components/customer/booking-status-stepper";
import { ConfirmModal } from "@/components/heritage/ui";
import { HandoverSummary } from "@/components/customer/handover-summary";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";
import {
  CheckCircle2,
  Receipt,
  Clock,
  Award,
  EyeOff,
  PackageOpen,
  ArrowRight,
  Truck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Ruler,
  X,
  AlertCircle,
  ClipboardCheck,
  ZoomIn,
  Loader2,
  ShieldAlert,
} from "lucide-react";

const HISTORY_PAGE_SIZE = 5;
const TEST_ORDER_STATUSES = new Set(["pending_confirmation"]);

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const DEMO_DELIVERY_TRACK: DeliveryTrackData = {
  bookingId: "DEMO-CP-2026",
  status: "in_transit",
  shipperLocationAvailable: true,
  storeLat: 10.7769,
  storeLng: 106.7009,
  customerLat: 10.7932,
  customerLng: 106.6800,
  deliveredAt: null,
  handoverConfirmed: false,
  customerName: "Nguyễn Văn An",
  customerAddress: "123 Đường Pasteur, Phường Võ Thị Sáu, Quận 3, TP.HCM",
};

export default function CustomerDashboardPage() {
  const [bookings, setBookings] = useState<BookingResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Khách hàng");
  // Refund status map: bookingId → refund
  const [refundMap, setRefundMap] = useState<Record<string, CustomerRefundResponse | null>>({});
  // Delivery tracking
  const [deliveryTrack, setDeliveryTrack] = useState<DeliveryTrackData | null>(null);
  const [showDemoTracking, setShowDemoTracking] = useState(false);

  // Inspection report modal state
  const [inspectingBooking, setInspectingBooking] = useState<BookingResponse | null>(null);
  const [inspectionSessions, setInspectionSessions] = useState<InspectionSessionResponse[]>([]);
  const [loadingInspections, setLoadingInspections] = useState(false);
  const [customerLightboxUrl, setCustomerLightboxUrl] = useState<string | null>(null);

  async function handleOpenInspectionModal(b: BookingResponse) {
    setInspectingBooking(b);
    setLoadingInspections(true);
    try {
      const res = await getCustomerBookingInspections(b.id);
      if (res.success && res.data) {
        setInspectionSessions(res.data);
      } else {
        setInspectionSessions([]);
      }
    } catch {
      setInspectionSessions([]);
    } finally {
      setLoadingInspections(false);
    }
  }

  // Poll delivery tracking every 10s. Only track active delivery handoff, not already-renting/completed orders.
  useEffect(() => {
    const deliveryBooking = bookings
      .filter((b) => b.pickupMethod === "delivery" && ["delivering", "ready_for_pickup"].includes(b.status))
      .sort((a, b) => {
        const priority = (status: string) => (status === "delivering" ? 0 : 1);
        const byPriority = priority(a.status) - priority(b.status);
        if (byPriority !== 0) return byPriority;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0];

    if (!deliveryBooking) {
      setDeliveryTrack(null);
      return;
    }

    const fetchTracking = () => {
      getDeliveryTrack(deliveryBooking.id).then((res) => {
        if (res.success && res.data) {
          const newData = res.data;
          setDeliveryTrack((prev) => {
            if (
              prev &&
              prev.bookingId === newData.bookingId &&
              prev.status === newData.status &&
              prev.storeLat === newData.storeLat &&
              prev.customerLat === newData.customerLat &&
              prev.deliveredAt === newData.deliveredAt
            ) {
              return prev;
            }
            return newData;
          });
        } else {
          setDeliveryTrack(null);
        }
      });
    };

    fetchTracking();
    const interval = setInterval(fetchTracking, 10000);
    return () => clearInterval(interval);
  }, [bookings]);

  // Tự động mở khung chat nếu được điều hướng tới có query ?chat=open
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("chat") === "open") {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("chat:open"));
      }, 350);
      return () => clearTimeout(timer);
    }
  }, []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sendingBookingId, setSendingBookingId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [showPendingTestOrders, setShowPendingTestOrders] = useState(false);
  const [reviewingItem, setReviewingItem] = useState<{ bookingId: string; garmentId: string; garmentName: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{title:string; message:string; danger?:boolean; onConfirm:()=>void} | null>(null);
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

  const refreshBookings = useCallback(async () => {
    const res = await getMyBookings();
    if (!res.success || !res.data) return;
    const data = res.data;
    setBookings(data);
    // Fetch refund status for completed bookings (kèm đơn đang chờ hoàn cọc)
    const completedBookingIds = data
      .filter((b) => b.status === "completed" || b.status === "refund_pending")
      .map((b) => b.id);
    completedBookingIds.forEach((bookingId) => {
      getCustomerRefund(bookingId).then((refundRes) => {
        if (refundRes.success && refundRes.data && refundRes.data.length > 0) {
          setRefundMap((prev) => ({ ...prev, [bookingId]: refundRes.data![0] }));
        } else {
          setRefundMap((prev) => ({ ...prev, [bookingId]: null }));
        }
      });
    });
  }, []);

  useEffect(() => {
    const session = readStoredSession();
    if (session?.user?.fullName) setUserName(session.user.fullName);
    else if (session?.user?.email) setUserName(session.user.email.split("@")[0]);

    refreshBookings().finally(() => setLoading(false));
  }, [refreshBookings]);

  // Realtime: đơn của khách đổi trạng thái (duyệt, hoàn cọc, đánh dấu quá hạn) là
  // dashboard tự cập nhật, không cần reload trang.
  useRealtimeInvalidation({ bookings: refreshBookings, refunds: refreshBookings });

  async function handleCancel(id: string) {
    setCancellingId(id);
    const res = await cancelBooking(id);
    if (res.success && res.data) {
      setBookings((prev) => prev.map((b) => (b.id === id ? res.data! : b)));
      showToast("success", "Đã hủy đơn thuê thành công.");
    } else {
      showToast("error", res.message ?? "Không thể hủy đơn. Vui lòng thử lại.");
    }
    setCancellingId(null);
  }

  async function handleSendBookingCard(bookingId: string, topic: "booking_support" | "complaint") {
    setSendingBookingId(bookingId);
    try {
      let convId = conversationId;
      if (!convId) {
        const convRes = await getMyChatConversation();
        if (convRes.success && convRes.data) {
          convId = convRes.data.id;
          setConversationId(convId);
        }
      }
      if (!convId) {
        showToast("error", "Không mở được cuộc trò chuyện hỗ trợ. Vui lòng thử lại.");
        return;
      }
      const res = await sendBookingCardMessage({ conversationId: convId, bookingId, topic });
      if (res.success) {
        showToast(
          "success",
          topic === "complaint"
            ? "Đã gửi khiếu nại. Nhân viên sẽ phản hồi trong khung chat."
            : "Đã gửi yêu cầu hỗ trợ. Nhân viên sẽ phản hồi trong khung chat.",
        );
        // Ra hiệu cho chat bubble mở lên để khách thấy thẻ đơn vừa gửi.
        window.dispatchEvent(new CustomEvent("chat:open"));
      } else {
        showToast("error", res.message ?? "Gửi yêu cầu thất bại. Vui lòng thử lại.");
      }
    } catch {
      showToast("error", "Gửi yêu cầu thất bại. Vui lòng thử lại.");
    } finally {
      setSendingBookingId(null);
    }
  }

  const sortedBookings = [...bookings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const visibleBookings = showPendingTestOrders
    ? sortedBookings
    : sortedBookings.filter((b) => !TEST_ORDER_STATUSES.has(b.status));
  const hiddenPendingTestCount = sortedBookings.length - visibleBookings.length;
  const activeBooking = visibleBookings.find((b) => ACTIVE_BOOKING_STATUSES.has(b.status));
  const history = visibleBookings.filter((b) => !ACTIVE_BOOKING_STATUSES.has(b.status));
  // Đơn khách còn giữ đồ mà đã quá hạn: vẫn nằm trong history, nhưng phải cảnh báo
  // riêng ở đầu mục — số ngày trễ và phí phạt tăng mỗi ngày.
  const overdueBookings = sortedBookings.filter((b) => (b.overdueDays ?? 0) > 0);

  // Phân trang lịch sử thuê
  const totalHistoryPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, totalHistoryPages);
  const pagedHistory = history.slice(
    (currentHistoryPage - 1) * HISTORY_PAGE_SIZE,
    currentHistoryPage * HISTORY_PAGE_SIZE,
  );

  function renderRefundStatus(b: BookingResponse) {
    if (b.status !== "completed" && b.status !== "refund_pending" && b.status !== "returned") {
      return <span className="text-xs text-stone-400">—</span>;
    }
    const refund = refundMap[b.id];
    const penalty = Number(b.penaltyTotal ?? 0);
    const deposit = Number(b.depositTotal ?? 0);
    const remaining = Math.max(0, deposit - penalty);
    const excessDebt = penalty > deposit ? penalty - deposit : 0;

    return (
      <div className="flex flex-col gap-1.5 min-w-[155px]">
        {/* Khối chiết tính khấu trừ hư hại nếu có */}
        {penalty > 0 && (
          <div className={`rounded-lg border p-2 text-[11px] leading-tight shadow-2xs ${
            excessDebt > 0 ? "border-red-300 bg-red-50/90" : "border-amber-300/80 bg-amber-50/80"
          }`}>
            <div className="flex items-center justify-between gap-1 text-stone-600">
              <span>Cọc ban đầu:</span>
              <span className="font-semibold text-ink">{formatVND(deposit)}</span>
            </div>
            <div className="flex items-center justify-between gap-1 font-semibold text-red-600 mt-0.5">
              <span>Khấu trừ hư hại:</span>
              <span>-{formatVND(penalty)}</span>
            </div>
            {excessDebt > 0 ? (
              <div className="mt-1 border-t border-red-200 pt-1 flex items-center justify-between gap-1 font-bold text-red-700 bg-red-100/80 -mx-1 px-1.5 py-0.5 rounded">
                <span>Cần bồi thường thêm:</span>
                <span>+{formatVND(excessDebt)}</span>
              </div>
            ) : (
              <div className="mt-1 border-t border-amber-200 pt-1 flex items-center justify-between gap-1 font-bold text-ink">
                <span>Thực hoàn:</span>
                <span className="text-jade">{formatVND(remaining)}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleOpenInspectionModal(b)}
              className={`mt-1.5 flex w-full items-center justify-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-bold border transition ${
                excessDebt > 0
                  ? "border-red-300 text-red-700 hover:bg-red-50"
                  : "border-amber-300 text-amber-900 hover:bg-amber-100"
              }`}
            >
              <ClipboardCheck className={`h-3 w-3 ${excessDebt > 0 ? "text-red-700" : "text-amber-700"}`} />
              <span>{excessDebt > 0 ? "Xem biên bản & Đền bù" : "Xem biên bản lỗi"}</span>
            </button>
          </div>
        )}

        {/* Trạng thái hoàn tiền */}
        {refund && (refund.status === "refunded" || refund.status === "partially_refunded") ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-jade/10 px-2.5 py-0.5 text-xs font-semibold text-jade">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Đã hoàn {formatVND(refund.amount)}
            </span>
            {refund.proofImageUrl && (
              <a
                href={refund.proofImageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-jade/40 px-2 py-0.5 text-xs font-semibold text-jade transition hover:bg-jade/10"
              >
                <Receipt className="h-3.5 w-3.5" />
                Xem bill
              </a>
            )}
          </span>
        ) : refund ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-700">
            <Clock className="h-3.5 w-3.5" />
            Đang xử lý hoàn {formatVND(refund.amount)}
          </span>
        ) : excessDebt > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 border border-red-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            Cần thu thêm {formatVND(excessDebt)}
          </span>
        ) : penalty >= deposit && deposit > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Đã trừ 100% tiền cọc
          </span>
        ) : penalty === 0 && deposit > 0 && b.status === "refund_pending" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-700">
            <Clock className="h-3.5 w-3.5" />
            Chờ hoàn {formatVND(deposit)}
          </span>
        ) : (
          <span className="text-xs text-stone-400">—</span>
        )}
      </div>
    );
  }

  function renderActions(b: BookingResponse) {
    return (
      <div className="flex flex-nowrap items-center gap-1.5">
        {(b.status === "completed" || b.status === "refund_pending" || b.status === "returned") && (
          <button
            type="button"
            onClick={() => void handleOpenInspectionModal(b)}
            className="shrink-0 whitespace-nowrap rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 transition hover:bg-mist"
            title="Xem chi tiết biên bản kiểm tra đồ & ảnh chụp thực tế"
          >
            Biên bản
          </button>
        )}
        {(b.status === "completed" || b.status === "returned") && (
          <button
            type="button"
            onClick={() => setReviewingItem({
              bookingId: b.id,
              garmentId: b.items[0]?.garmentId ?? "",
              garmentName: b.items[0]?.garmentName ?? "Trang phục",
            })}
            className="shrink-0 whitespace-nowrap rounded-lg bg-yellow-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-yellow-600 disabled:opacity-40"
          >
            Đánh giá
          </button>
        )}
        <button
          type="button"
          disabled={sendingBookingId === b.id}
          onClick={() => void handleSendBookingCard(b.id, "booking_support")}
          className="shrink-0 whitespace-nowrap rounded-lg bg-jade px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-forest disabled:opacity-40"
        >
          {sendingBookingId === b.id ? "..." : "Hỗ trợ"}
        </button>
        <button
          type="button"
          disabled={sendingBookingId === b.id}
          onClick={() => void handleSendBookingCard(b.id, "complaint")}
          className="shrink-0 whitespace-nowrap rounded-lg bg-oxblood px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-red-950 disabled:opacity-40"
        >
          {sendingBookingId === b.id ? "..." : "Khiếu nại"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="mb-10">
        <h1 className="font-display text-4xl text-lotus sm:text-5xl font-semibold">Xin chào, {userName}</h1>
        <p className="mt-2.5 flex items-center gap-2 text-sm text-stone-600">
          <Award className="h-4 w-4 text-antique" />
          <span>Thành viên di sản Cổ Phục Rental</span>
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">

          {hiddenPendingTestCount > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <EyeOff className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
                <p className="text-xs leading-relaxed">
                  Đang ẩn {hiddenPendingTestCount} đơn chờ xác nhận để dashboard gọn hơn.
                  Bạn vẫn có thể bật lại để xem hoặc vào staff dashboard để xác nhận/hủy các đơn test này.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPendingTestOrders(true)}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                Hiện đơn chờ xác nhận
              </button>
            </div>
          )}

          {showPendingTestOrders && sortedBookings.some((b) => TEST_ORDER_STATUSES.has(b.status)) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPendingTestOrders(false)}
                className="rounded-lg border border-sand bg-white px-4 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                Ẩn đơn chờ xác nhận
              </button>
            </div>
          )}

          {/* Đơn đang active */}
          {loading ? (
            <div className="rounded-xl border border-sand bg-white p-8 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="h-10 w-48 animate-pulse rounded bg-stone-200" />
                  <div className="h-4 w-64 animate-pulse rounded bg-stone-200" />
                  <div className="h-4 w-56 animate-pulse rounded bg-stone-200" />
                </div>
                <div className="h-6 w-24 animate-pulse rounded-full bg-stone-200" />
              </div>
              <div className="mt-8 flex gap-3">
                <div className="h-10 w-32 animate-pulse rounded-lg bg-stone-200" />
                <div className="h-10 w-32 animate-pulse rounded-lg bg-stone-200" />
              </div>
            </div>
          ) : activeBooking ? (
            <section className="overflow-hidden rounded-xl border border-sand bg-white p-8 shadow-md">
              <div className="flex flex-col gap-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-4xl text-ink break-words">
                      {activeBooking.items[0]?.garmentName ?? "Trang phục"}
                    </h2>
                    <p className="mt-1 text-sm text-stone-600">
                      {formatDate(activeBooking.rentalStartDate)} - {formatDate(activeBooking.rentalEndDate)}
                      {" "}({activeBooking.days} ngày)
                    </p>
                    <p className="mt-1 text-sm text-stone-500">
                      Tiền thuê: <span className="font-medium text-ink">{formatVND(activeBooking.rentalTotal)}</span>
                      {" "}· Cọc: <span className="font-medium text-ink">{formatVND(activeBooking.depositTotal)}</span>
                    </p>
                  </div>
                  <span className={`${statusBadgeClass(statusOf(activeBooking.status).color)} shrink-0`}>
                    {statusOf(activeBooking.status).label}
                  </span>
                </div>
                <BookingStatusStepper
                  status={activeBooking.status}
                  pickupMethod={activeBooking.pickupMethod}
                  className="border-t border-sand pt-6"
                />
                {Number(activeBooking.penaltyTotal ?? 0) > Number(activeBooking.depositTotal ?? 0) && (
                  <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs">
                    <div className="flex items-center gap-2 font-bold text-red-800 uppercase tracking-wider mb-1">
                      <ShieldAlert className="h-4 w-4 text-red-600 shrink-0" />
                      <span>Thông báo: Khoản bồi thường hư hại vượt tiền cọc</span>
                    </div>
                    <p className="text-red-900/90 leading-relaxed">
                      Đơn hàng đã được thẩm định với chi phí hư tổn là <strong>{formatVND(activeBooking.penaltyTotal ?? 0)}</strong> (vượt tiền cọc {formatVND(activeBooking.depositTotal ?? 0)}). Quý khách có khoản đền bù bổ sung cần thanh toán: <strong className="text-red-700 text-sm">+{formatVND((activeBooking.penaltyTotal ?? 0) - activeBooking.depositTotal)}</strong>. Vui lòng bấm &ldquo;Xem chi tiết&rdquo; hoặc liên hệ atelier để được hỗ trợ.
                    </p>
                  </div>
                )}
                <HandoverSummary handover={activeBooking.handover} compact />
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href={`/booking/success?bookingId=${activeBooking.id}`}
                    className="inline-flex items-center justify-center rounded-lg bg-lotus px-5 py-3 text-sm font-semibold text-white transition hover:bg-oxblood"
                  >
                    Xem chi tiết
                  </Link>
                  {CANCELLABLE_STATUSES.has(activeBooking.status) && (
                    <button
                      type="button"
                      disabled={cancellingId === activeBooking.id}
                      onClick={() => setConfirmDialog({
                        title: "Xác nhận hủy đơn",
                        message: "Bạn có chắc muốn hủy đơn thuê này? Hành động này không thể hoàn tác.",
                        danger: true,
                        onConfirm: () => handleCancel(activeBooking.id),
                      })}
                      className="rounded-lg border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-40"
                    >
                      {cancellingId === activeBooking.id ? "Đang hủy..." : "Hủy đơn"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={sendingBookingId === activeBooking.id}
                    onClick={() => void handleSendBookingCard(activeBooking.id, "booking_support")}
                    className="rounded-lg bg-jade px-5 py-3 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-40"
                  >
                    {sendingBookingId === activeBooking.id ? "Đang gửi..." : "Hỗ trợ đơn hàng"}
                  </button>
                  <button
                    type="button"
                    disabled={sendingBookingId === activeBooking.id}
                    onClick={() => void handleSendBookingCard(activeBooking.id, "complaint")}
                    className="rounded-lg bg-oxblood px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-950 disabled:opacity-40"
                  >
                    {sendingBookingId === activeBooking.id ? "Đang gửi..." : "Khiếu nại"}
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-dashed border-sand bg-mist/40 p-12 text-center">
              <PackageOpen className="mx-auto mb-4 h-12 w-12 text-stone-300" />
              <h3 className="font-display text-2xl font-semibold text-ink">Không có đơn đang hoạt động</h3>
              <p className="mt-2 text-xs text-stone-500">Hãy bắt đầu hành trình thuê trang phục đầu tiên của bạn.</p>
              <Link
                href="/catalog"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-lotus px-6 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
              >
                <span>Khám phá bộ sưu tập</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          )}

          {/* Delivery tracking */}
          {(deliveryTrack || showDemoTracking) ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-3xl text-ink flex items-center gap-2">
                  <Truck className="h-6 w-6 text-antique" />
                  Theo dõi giao hàng
                  {showDemoTracking && !deliveryTrack && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      Mô phỏng Demo
                    </span>
                  )}
                </h2>
                {showDemoTracking && !deliveryTrack && (
                  <button
                    type="button"
                    onClick={() => setShowDemoTracking(false)}
                    className="text-xs font-medium text-stone-500 underline transition hover:text-stone-800"
                  >
                    Đóng mô phỏng
                  </button>
                )}
              </div>
              <DeliveryTracker data={deliveryTrack || DEMO_DELIVERY_TRACK} />
            </section>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-dashed border-sand bg-white/70 p-5 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Mô phỏng GPS giao hàng thực tế (Leaflet + OSRM)</p>
                  <p className="text-xs text-stone-500">Xem thử xe máy giao hàng chạy men theo đường phố thực tế TP.HCM kèm tốc độ và thời gian đến dự kiến.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDemoTracking(true)}
                className="shrink-0 whitespace-nowrap rounded-xl bg-lotus px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-oxblood"
              >
                Bật xem thử mô phỏng 🛵
              </button>
            </div>
          )}

          {/* Lịch sử */}
          <section>
            <h2 className="mb-6 font-display text-4xl text-ink">Lịch sử thuê trang phục</h2>
            {overdueBookings.length > 0 && (
              <div role="alert" className="mb-6 space-y-3">
                {overdueBookings.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                  >
                    <p className="flex items-center gap-2 font-semibold text-xs">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                      Đơn {b.id.slice(0, 8).toUpperCase()} đã quá hạn {b.overdueDays} ngày
                    </p>
                    <p className="mt-1 text-xs text-red-700">
                      Ngày trả dự kiến: {formatDate(b.rentalEndDate)} · Phí quá hạn hiện tại:{" "}
                      <span className="font-semibold">{formatVND(b.overdueAmount ?? 0)}</span> (
                      {(b.overdueFeePerDay ?? 0).toLocaleString("vi-VN")}đ/ngày). Phí tăng thêm mỗi ngày khách chưa
                      trả đồ.
                    </p>
                  </div>
                ))}
              </div>
            )}
            {history.length === 0 && !loading ? (
              <p className="text-sm text-stone-400">Chưa có lịch sử thuê.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-sand bg-white">
                {/* Bảng — chỉ hiện từ md trở lên, có scroll ngang phòng khi hẹp */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-parchment text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                        <th className="px-6 py-4">Trang phục</th>
                        <th className="whitespace-nowrap px-6 py-4">Thời gian</th>
                        <th className="px-6 py-4">Trạng thái</th>
                        <th className="whitespace-nowrap px-6 py-4">Tổng</th>
                        <th className="px-6 py-4">Hoàn cọc</th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <tr key={`skeleton-${i}`} className="border-t border-sand">
                            <td className="px-6 py-4"><div className="h-4 w-32 animate-pulse rounded bg-stone-200" /></td>
                            <td className="px-6 py-4"><div className="h-4 w-40 animate-pulse rounded bg-stone-200" /></td>
                            <td className="px-6 py-4"><div className="h-6 w-24 animate-pulse rounded-full bg-stone-200" /></td>
                            <td className="px-6 py-4"><div className="h-4 w-20 animate-pulse rounded bg-stone-200" /></td>
                            <td className="px-6 py-4"><div className="h-6 w-28 animate-pulse rounded-full bg-stone-200" /></td>
                            <td className="px-6 py-4"><div className="h-6 w-16 animate-pulse rounded bg-stone-200" /></td>
                          </tr>
                        ))
                      ) : pagedHistory.map((b) => {
                        const st = statusOf(b.status);
                        return (
                          <tr key={b.id} className="border-t border-sand align-top transition hover:bg-mist">
                            <td className="max-w-[260px] px-6 py-4 font-medium text-ink">
                              {b.items.length === 0 ? (
                                <span>—</span>
                              ) : (
                                <ul className="space-y-1">
                                  {b.items.map((item) => (
                                    <li key={item.id} className="flex items-baseline gap-1.5">
                                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-stone-300" />
                                      <span className="break-words">
                                        {item.garmentName ?? "—"}
                                        {item.sizeLabel ? <span className="text-xs text-stone-400"> · {item.sizeLabel}</span> : null}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-stone-600">
                              {formatDate(b.rentalStartDate)} - {formatDate(b.rentalEndDate)}
                            </td>
                            <td className="px-6 py-4">
                              <span className={statusBadgeClass(st.color)}>
                                {st.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-stone-600">{formatVND(b.rentalTotal + b.depositTotal)}</td>
                            <td className="px-6 py-4">{renderRefundStatus(b)}</td>
                            <td className="whitespace-nowrap px-6 py-4">{renderActions(b)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Thẻ — hiện dưới md, tránh vỡ bảng trên mobile */}
                <div className="divide-y divide-sand md:hidden">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={`skeleton-card-${i}`} className="space-y-3 p-5">
                        <div className="h-5 w-40 animate-pulse rounded bg-stone-200" />
                        <div className="h-4 w-32 animate-pulse rounded bg-stone-200" />
                        <div className="h-6 w-24 animate-pulse rounded-full bg-stone-200" />
                      </div>
                    ))
                  ) : pagedHistory.map((b) => {
                    const st = statusOf(b.status);
                    return (
                      <div key={b.id} className="space-y-3 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {b.items.length === 0 ? (
                              <h3 className="font-medium text-ink">—</h3>
                            ) : (
                              <ul className="space-y-1 font-medium text-ink">
                                {b.items.map((item) => (
                                  <li key={item.id} className="break-words">
                                    {item.garmentName ?? "—"}
                                    {item.sizeLabel ? <span className="text-xs font-normal text-stone-400"> · {item.sizeLabel}</span> : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <span className={`shrink-0 ${statusBadgeClass(st.color)}`}>{st.label}</span>
                        </div>
                        <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                          <dt className="text-stone-400">Thời gian</dt>
                          <dd className="text-right text-stone-600">{formatDate(b.rentalStartDate)} - {formatDate(b.rentalEndDate)}</dd>
                          <dt className="text-stone-400">Tổng</dt>
                          <dd className="text-right text-stone-600">{formatVND(b.rentalTotal + b.depositTotal)}</dd>
                          <dt className="text-stone-400">Hoàn cọc</dt>
                          <dd className="flex justify-end">{renderRefundStatus(b)}</dd>
                        </dl>
                        {renderActions(b)}
                      </div>
                    );
                  })}
                </div>

                {/* Phân trang */}
                {!loading && totalHistoryPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand bg-parchment/60 px-6 py-4">
                    <p className="text-xs text-stone-500">
                      Hiển thị {(currentHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(currentHistoryPage * HISTORY_PAGE_SIZE, history.length)} trong {history.length} đơn
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentHistoryPage <= 1}
                        onClick={() => setHistoryPage(currentHistoryPage - 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Trang trước"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {Array.from({ length: totalHistoryPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setHistoryPage(page)}
                          className={
                            page === currentHistoryPage
                              ? "flex h-8 min-w-8 items-center justify-center rounded-lg bg-lotus px-2 text-xs font-semibold text-white shadow-xs"
                              : "flex h-8 min-w-8 items-center justify-center rounded-lg border border-sand bg-white px-2 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                          }
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={currentHistoryPage >= totalHistoryPages}
                        onClick={() => setHistoryPage(currentHistoryPage + 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Trang sau"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-4">
          {customerWidgets.map((item) => (
            <Link
              key={item.title}
              href={item.href || "/dashboard/customer"}
              className="block rounded-2xl border border-sand bg-white p-6 shadow-xs transition-colors duration-200 hover:border-lotus hover:shadow-md group"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.accent}`}>
                  {item.icon === "face_retouching_natural" ? (
                    <Sparkles className="h-5 w-5" />
                  ) : (
                    <Ruler className="h-5 w-5" />
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-stone-400 group-hover:text-lotus transition-colors duration-200" />
              </div>
              <h3 className="font-display text-2xl font-semibold text-ink group-hover:text-lotus transition-colors duration-200">{item.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-600">{item.description}</p>
            </Link>
          ))}
        </aside>
      </div>

      {reviewingItem && (
        <ReviewModal
          bookingId={reviewingItem.bookingId}
          garmentId={reviewingItem.garmentId}
          garmentName={reviewingItem.garmentName}
          onClose={() => setReviewingItem(null)}
          onSuccess={() => {
            // Optional: Show a success toast or indicator here
          }}
        />
      )}

      {/* Toast phản hồi cho hỗ trợ / khiếu nại */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <div
            role="status"
            className={
              "flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg " +
              (toast.type === "success"
                ? "border-jade/30 bg-white text-forest"
                : "border-red-200 bg-white text-red-700")
            }
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-jade shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            )}
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-stone-400 transition hover:text-stone-600"
              aria-label="Đóng thông báo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <ConfirmModal open={!!confirmDialog} title={confirmDialog?.title??""} message={confirmDialog?.message??""} danger={confirmDialog?.danger} onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />

      {/* Modal Biên bản kiểm định & Đối soát cọc cho khách hàng */}
      {inspectingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-stone-200">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-sand pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                  <ClipboardCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-ink">
                    Biên bản kiểm định & Đối soát cọc
                  </h3>
                  <p className="text-xs text-stone-500">
                    Đơn thuê: #{inspectingBooking.id.slice(0, 8).toUpperCase()} • {inspectingBooking.items[0]?.garmentName ?? "Trang phục"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectingBooking(null)}
                className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Chiết tính hoàn cọc & Đền bù vượt cọc nếu có */}
            {(() => {
              const deposit = Number(inspectingBooking.depositTotal ?? 0);
              const penalty = Number(inspectingBooking.penaltyTotal ?? 0);
              const remaining = Math.max(0, deposit - penalty);
              const excess = penalty > deposit ? penalty - deposit : 0;

              return (
                <div className={`my-5 rounded-xl border p-4 ${excess > 0 ? "border-red-300 bg-red-50/50" : "border-sand bg-parchment/60"}`}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
                    Bảng chiết tính cọc & hoàn trả
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg bg-white p-3 border border-stone-200/70 shadow-sm">
                      <span className="text-xs text-stone-500 block">Tiền cọc ban đầu</span>
                      <span className="text-base font-semibold text-ink">
                        {formatVND(deposit)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-stone-200/70 shadow-sm">
                      <span className="text-xs text-stone-500 block">Khấu trừ hư tổn / vệ sinh</span>
                      <span className={`text-base font-semibold ${penalty > 0 ? "text-red-600" : "text-stone-700"}`}>
                        {penalty > 0 ? `-${formatVND(penalty)}` : "0đ"}
                      </span>
                    </div>
                    <div className={`rounded-lg p-3 border shadow-sm ${
                      excess > 0 ? "bg-red-100/80 border-red-300" : "bg-emerald-50 border-emerald-200"
                    }`}>
                      <span className={`text-xs font-medium block ${excess > 0 ? "text-red-800 font-bold" : "text-emerald-700"}`}>
                        {excess > 0 ? "Cần bồi thường thêm" : "Thực hoàn ví cọc"}
                      </span>
                      <span className={`text-base font-bold ${excess > 0 ? "text-red-700" : "text-emerald-800"}`}>
                        {excess > 0 ? `+${formatVND(excess)}` : formatVND(remaining)}
                      </span>
                    </div>
                  </div>

                  {excess > 0 ? (
                    <div className="mt-3.5 rounded-xl border border-red-300 bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 text-red-800 font-bold text-xs uppercase tracking-wide mb-1.5">
                        <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" />
                        <span>Thông báo bồi thường vượt cọc theo biên bản</span>
                      </div>
                      <p className="text-xs text-red-900/90 leading-relaxed">
                        Do trang phục phát sinh hư hại nặng không thể phục hồi, tổng tổn thất thực tế là <strong>{formatVND(penalty)}</strong>, vượt quá khoản tiền cọc ban đầu (<strong>{formatVND(deposit)}</strong>).
                        Căn cứ theo Điều khoản thuê trang phục & Biên bản bàn giao đã xác nhận, quý khách có trách nhiệm thanh toán bổ sung số tiền chênh lệch <strong>+{formatVND(excess)}</strong> trong vòng 3 ngày làm việc. Quý khách vui lòng liên hệ nhân viên hoặc thanh toán tại quầy atelier.
                      </p>
                    </div>
                  ) : penalty > 0 ? (
                    <p className="mt-2 text-xs text-stone-500 italic">
                      * Mức khấu trừ đã được thẩm định tự động và kiểm tra xác nhận bởi chuyên viên cửa hàng.
                    </p>
                  ) : null}
                </div>
              );
            })()}

            {/* Danh sách phiên kiểm tra */}
            <div className="space-y-6">
              <h4 className="text-sm font-semibold text-ink">
                Chi tiết kết quả thẩm định ({inspectionSessions.length})
              </h4>

              {loadingInspections ? (
                <div className="flex flex-col items-center justify-center py-10 text-stone-400">
                  <Loader2 className="h-8 w-8 animate-spin text-lotus" />
                  <p className="mt-2 text-xs">Đang tải biên bản và ảnh đối chiếu...</p>
                </div>
              ) : inspectionSessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
                  Chưa có biên bản kiểm tra chi tiết nào được lưu cho đơn này.
                </div>
              ) : (
                inspectionSessions.map((session, sIdx) => {
                  return (
                    <div
                      key={session.id || sIdx}
                      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                        <div>
                          <span className="inline-block rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700 mr-2">
                            Mã đồ: {session.asset?.assetCode || session.asset?.garment?.name || "Trang phục"}
                          </span>
                          <span className="text-xs text-stone-400">
                            {new Date(session.createdAt).toLocaleString("vi-VN")}
                          </span>
                          {session.inspector && (
                            <span className="ml-2 text-xs text-stone-500">
                              • Chuyên viên: {session.inspector.fullName}
                            </span>
                          )}
                        </div>
                        <span className="rounded-full bg-sand/60 px-2.5 py-0.5 text-xs font-medium text-stone-700 capitalize">
                          Trạng thái: {session.status === "completed" ? "Đã thẩm định xong" : session.status}
                        </span>
                      </div>

                      {/* Đánh giá độ nguyên vẹn & chất lượng */}
                      {session.aiComparisonResult?.conditionScore !== undefined && session.aiComparisonResult?.conditionScore !== null && (() => {
                        const score = Math.max(0, Math.min(100, Number(session.aiComparisonResult.conditionScore) || 0));
                        const loss = 100 - score;
                        return (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-xs">
                            <span className="font-semibold text-stone-600">Đánh giá chất lượng sau thuê:</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 font-medium shadow-2xs">
                              <span className="text-stone-700">Độ nguyên vẹn: <strong className="font-bold text-ink">{score}/100</strong></span>
                              {loss > 0 ? (
                                <span className="font-bold text-amber-800">(Hao tổn {loss}%)</span>
                              ) : (
                                <span className="font-bold text-emerald-700">(Hoàn hảo 100%)</span>
                              )}
                            </span>
                          </div>
                        );
                      })()}

                      {/* Ghi chú */}
                      {session.note && (
                        <div className="mt-3 text-xs text-stone-600 bg-stone-50 rounded-lg p-2.5 border border-stone-100">
                          <span className="font-semibold text-stone-700">Ghi chú nhân viên: </span>
                          {session.note}
                        </div>
                      )}

                      {/* Danh sách lỗi hư hỏng */}
                      <div className="mt-4">
                        <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-2">
                          Ghi nhận hư tổn / hao mòn ({session.findings?.length ?? 0})
                        </span>
                        {(!session.findings || session.findings.length === 0) ? (
                          <p className="text-xs text-emerald-700 bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-100">
                            ✓ Không phát hiện lỗi hoặc hư hỏng nào. Trang phục đạt chuẩn tốt.
                          </p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-stone-200">
                            <table className="min-w-full text-left text-xs">
                              <thead className="bg-stone-50 text-stone-600 border-b border-stone-200">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Loại vấn đề</th>
                                  <th className="px-3 py-2 font-semibold">Mức độ</th>
                                  <th className="px-3 py-2 font-semibold">Chi tiết mô tả</th>
                                  <th className="px-3 py-2 font-semibold text-right">Phí khấu trừ</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-100">
                                {session.findings.map((f, fIdx) => (
                                  <tr key={f.id || fIdx} className="hover:bg-stone-50/50">
                                    <td className="px-3 py-2 font-medium text-ink capitalize">
                                      {f.findingType || "Hao mòn"}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${
                                        f.severity === "high" || f.severity === "severe" || f.severity === "nang"
                                          ? "bg-red-100 text-red-700"
                                          : f.severity === "medium" || f.severity === "vua"
                                          ? "bg-amber-100 text-amber-700"
                                          : "bg-blue-50 text-blue-700"
                                      }`}>
                                        {f.severity || "Nhẹ"}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-stone-600 max-w-xs">
                                      {f.description || "Chi tiết kiểm tra định kỳ"}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-amber-700">
                                      {formatVND(f.penaltyAmount || 0)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Hình ảnh thẩm định thực tế */}
                      {session.photos && session.photos.length > 0 && (
                        <div className="mt-4">
                          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-2">
                            Hình ảnh chụp thực tế lúc hoàn trả ({session.photos.length})
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {session.photos.map((p, pIdx) => (
                              <button
                                key={p.id || pIdx}
                                type="button"
                                onClick={() => setCustomerLightboxUrl(p.imageUrl)}
                                className="group relative h-20 w-20 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 hover:ring-2 hover:ring-lotus transition"
                              >
                                <img
                                  src={p.imageUrl}
                                  alt={p.photoType || "Ảnh kiểm tra"}
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                                  <ZoomIn className="h-5 w-5 text-white" />
                                </div>
                                {p.photoType && (
                                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white text-center py-0.5 truncate">
                                    {p.photoType}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Ảnh đối chiếu lúc giao đồ nếu có */}
                      {session.handoverImages && session.handoverImages.length > 0 && (
                        <div className="mt-4 border-t border-dashed border-stone-200 pt-3">
                          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-2">
                            Ảnh bàn giao ban đầu ({session.handoverImages.length})
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {session.handoverImages.map((imgUrl, hIdx) => (
                              <button
                                key={hIdx}
                                type="button"
                                onClick={() => setCustomerLightboxUrl(imgUrl)}
                                className="group relative h-16 w-16 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 hover:ring-2 hover:ring-jade transition"
                              >
                                <img
                                  src={imgUrl}
                                  alt="Ảnh bàn giao"
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                                  <ZoomIn className="h-4 w-4 text-white" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-sand pt-4">
              <p className="text-xs text-stone-500">
                Mọi thắc mắc về tiền cọc, vui lòng liên hệ bộ phận hỗ trợ khách hàng.
              </p>
              <button
                type="button"
                onClick={() => setInspectingBooking(null)}
                className="w-full sm:w-auto rounded-lg bg-stone-100 px-5 py-2.5 text-xs font-semibold text-stone-700 hover:bg-stone-200 transition"
              >
                Đóng biên bản
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox phóng to ảnh đối chứng */}
      {customerLightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => setCustomerLightboxUrl(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={customerLightboxUrl}
              alt="Ảnh phóng to"
              className="max-h-[85vh] w-auto max-w-full rounded-lg object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setCustomerLightboxUrl(null)}
              className="absolute -top-3 -right-3 rounded-full bg-white p-2 text-stone-800 shadow-lg hover:bg-stone-100 transition"
              aria-label="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
