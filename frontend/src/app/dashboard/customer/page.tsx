"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMyBookings, cancelBooking, getCustomerRefund, getDeliveryTrack } from "@/lib/api";
import type { BookingResponse, CustomerRefundResponse, DeliveryTrackData } from "@/lib/api";
import { DeliveryTracker } from "@/components/location/delivery-tracker";
import { readStoredSession } from "@/lib/auth";
import { getMyChatConversation, sendBookingCardMessage } from "@/lib/chat";
import { customerWidgets } from "@/lib/heritage-mock-data";
import { STATUS_LABELS, statusBadgeClass, statusOf, ACTIVE_BOOKING_STATUSES, CANCELLABLE_STATUSES } from "@/lib/status-labels";
import { ReviewModal } from "@/components/customer/review-modal";
import { BookingStatusStepper } from "@/components/customer/booking-status-stepper";
import { ConfirmModal } from "@/components/heritage/ui";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";

const HISTORY_PAGE_SIZE = 5;
const TEST_ORDER_STATUSES = new Set(["pending_confirmation"]);

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CustomerDashboardPage() {
  const [bookings, setBookings] = useState<BookingResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Khách hàng");
  // Refund status map: bookingId → refund
  const [refundMap, setRefundMap] = useState<Record<string, CustomerRefundResponse | null>>({});
  // Delivery tracking
  const [deliveryTrack, setDeliveryTrack] = useState<DeliveryTrackData | null>(null);

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
          setDeliveryTrack(res.data);
        } else {
          setDeliveryTrack(null);
        }
      });
    };

    fetchTracking();
    const interval = setInterval(fetchTracking, 10000);
    return () => clearInterval(interval);
  }, [bookings]);
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
    if (b.status !== "completed" && b.status !== "refund_pending") return <span className="text-xs text-stone-400">—</span>;
    const refund = refundMap[b.id];
    if (refund === undefined) return <span className="text-xs text-stone-400">Đang tải...</span>;
    if (!refund) return <span className="text-xs text-stone-400">—</span>;
    if (refund.status === "refunded" || refund.status === "partially_refunded") {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-jade/10 px-3 py-1 text-xs font-semibold text-jade">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            Đã hoàn {formatVND(refund.amount)}
          </span>
          {refund.proofImageUrl && (
            <a
              href={refund.proofImageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-jade/40 px-3 py-1 text-xs font-semibold text-jade transition hover:bg-jade/10"
            >
              <span className="material-symbols-outlined text-[14px]">receipt_long</span>
              Xem bill
            </a>
          )}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
        <span className="material-symbols-outlined text-[14px]">schedule</span>
        Đang xử lý {formatVND(refund.amount)}
      </span>
    );
  }

  function renderActions(b: BookingResponse) {
    return (
      <div className="flex flex-nowrap items-center gap-1.5">
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
      <header className="mb-12">
        <h1 className="font-display text-5xl text-lotus sm:text-6xl">Xin chào, {userName}</h1>
        <p className="mt-3 flex items-center gap-2 text-base text-stone-600">
          <span className="material-symbols-outlined text-antique">workspace_premium</span>
          Thành viên di sản
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">

          {hiddenPendingTestCount > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[20px]">visibility_off</span>
                <p>
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
            <section className="rounded-lg border border-dashed border-sand bg-mist p-12 text-center">
              <span className="material-symbols-outlined mb-4 text-5xl text-stone-300">inventory_2</span>
              <h3 className="font-display text-2xl text-ink">Không có đơn đang hoạt động</h3>
              <p className="mt-2 text-stone-500">Hãy bắt đầu hành trình thuê trang phục đầu tiên của bạn.</p>
              <Link
                href="/catalog"
                className="mt-6 inline-flex items-center gap-2 rounded-md bg-lotus px-6 py-3 text-sm font-semibold text-white transition hover:bg-oxblood"
              >
                Khám phá bộ sưu tập
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
            </section>
          )}

          {/* Delivery tracking */}
          {deliveryTrack && (
            <section className="space-y-4">
              <h2 className="font-display text-3xl text-ink flex items-center gap-2">
                <span className="material-symbols-outlined text-antique">local_shipping</span>
                Theo dõi giao hàng
              </h2>
              <DeliveryTracker data={deliveryTrack} />
            </section>
          )}

          {/* Lịch sử */}
          <section>
            <h2 className="mb-6 font-display text-4xl text-ink">Lịch sử thuê trang phục</h2>
            {overdueBookings.length > 0 && (
              <div role="alert" className="mb-6 space-y-3">
                {overdueBookings.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="material-symbols-outlined text-[18px]">warning</span>
                      Đơn {b.id.slice(0, 8).toUpperCase()} đã quá hạn {b.overdueDays} ngày
                    </p>
                    <p className="mt-1 text-red-700">
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
                        <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                      </button>
                      {Array.from({ length: totalHistoryPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setHistoryPage(page)}
                          className={
                            page === currentHistoryPage
                              ? "flex h-8 min-w-8 items-center justify-center rounded-lg bg-lotus px-2 text-xs font-semibold text-white"
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
                        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
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
              className="block rounded-xl border border-sand bg-white p-6 shadow-sm transition-all duration-200 hover:border-lotus/40 hover:shadow-md hover:-translate-y-0.5 group"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${item.accent}`}>
                  <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                </div>
                <span className="material-symbols-outlined text-stone-400 group-hover:text-lotus transition-colors duration-200">arrow_forward</span>
              </div>
              <h3 className="font-display text-3xl text-ink group-hover:text-lotus transition-colors duration-200">{item.title}</h3>
              <p className="mt-2 text-sm leading-7 text-stone-600">{item.description}</p>
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
            <span className="material-symbols-outlined text-xl">
              {toast.type === "success" ? "check_circle" : "error"}
            </span>
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-stone-400 transition hover:text-stone-600"
              aria-label="Đóng thông báo"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      )}

      <ConfirmModal open={!!confirmDialog} title={confirmDialog?.title??""} message={confirmDialog?.message??""} danger={confirmDialog?.danger} onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />
    </div>
  );
}
