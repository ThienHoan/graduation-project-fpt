"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  statusBadgeClass,
  statusOf,
  ACTIVE_BOOKING_STATUSES,
  DEPOSIT_HELD_STATUSES,
  CANCELLABLE_STATUSES,
} from "@/lib/status-labels";
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
  Search,
  MessageSquare,
  ShieldCheck,
  Calendar,
  Layers,
  ChevronDown,
  ExternalLink,
  Store,
  PhoneCall,
  RotateCcw,
} from "lucide-react";

const HISTORY_PAGE_SIZE = 5;
const TEST_ORDER_STATUSES = new Set(["pending_confirmation"]);

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}

function formatDate(iso: string) {
  if (!iso) return "—";
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

type HistoryTab = "all" | "active" | "refund" | "completed" | "cancelled";

export default function CustomerDashboardPage() {
  const [bookings, setBookings] = useState<BookingResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Khách hàng");
  const [refundMap, setRefundMap] = useState<Record<string, CustomerRefundResponse | null>>({});

  // Delivery tracking
  const [deliveryTrack, setDeliveryTrack] = useState<DeliveryTrackData | null>(null);
  const [showDemoTracking, setShowDemoTracking] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState<HistoryTab>("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [showPendingTestOrders, setShowPendingTestOrders] = useState(false);

  // Inspection report modal state
  const [inspectingBooking, setInspectingBooking] = useState<BookingResponse | null>(null);
  const [inspectionSessions, setInspectionSessions] = useState<InspectionSessionResponse[]>([]);
  const [loadingInspections, setLoadingInspections] = useState(false);
  const [customerLightboxUrl, setCustomerLightboxUrl] = useState<string | null>(null);

  // Review modal & confirm modal & toast
  const [reviewingItem, setReviewingItem] = useState<{ bookingId: string; garmentId: string; garmentName: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chat
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sendingBookingId, setSendingBookingId] = useState<string | null>(null);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

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

  // Poll delivery tracking every 10s for active deliveries
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

  // Handle open chat via query param
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

  const refreshBookings = useCallback(async () => {
    const res = await getMyBookings();
    if (!res.success || !res.data) return;
    const data = res.data;
    setBookings(data);

    // Fetch refund status for completed / refund_pending bookings
    const completedBookingIds = data
      .filter((b) => b.status === "completed" || b.status === "refund_pending" || b.status === "returned")
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

  // Sorting & Filtering
  const sortedBookings = useMemo(() => {
    return [...bookings].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [bookings]);

  const visibleBookings = useMemo(() => {
    if (showPendingTestOrders) return sortedBookings;
    return sortedBookings.filter((b) => !TEST_ORDER_STATUSES.has(b.status));
  }, [sortedBookings, showPendingTestOrders]);

  const hiddenPendingTestCount = sortedBookings.length - visibleBookings.length;

  // Active Booking
  const activeBooking = visibleBookings.find((b) => ACTIVE_BOOKING_STATUSES.has(b.status));

  // Overdue Bookings
  const overdueBookings = useMemo(() => {
    return sortedBookings.filter((b) => (b.overdueDays ?? 0) > 0);
  }, [sortedBookings]);

  // Statistics calculation for Quick Metric Cards
  const stats = useMemo(() => {
    const activeCount = sortedBookings.filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status)).length;
    const completedCount = sortedBookings.filter((b) => b.status === "completed" || b.status === "returned").length;
    const totalHoldingDeposit = sortedBookings
      .filter((b) => DEPOSIT_HELD_STATUSES.has(b.status))
      .reduce((sum, b) => sum + (Number(b.depositTotal) || 0), 0);
    const refundPendingCount = sortedBookings.filter((b) => b.status === "refund_pending").length;

    return {
      activeCount,
      completedCount,
      totalHoldingDeposit,
      refundPendingCount,
    };
  }, [sortedBookings]);

  // Tab filtering for booking history
  const filteredHistory = useMemo(() => {
    return visibleBookings.filter((b) => {
      // 1. Tab filter
      if (selectedTab === "active" && !ACTIVE_BOOKING_STATUSES.has(b.status)) return false;
      if (selectedTab === "refund" && b.status !== "refund_pending" && !(b.status === "completed" && refundMap[b.id]?.status === "pending")) return false;
      if (selectedTab === "completed" && b.status !== "completed" && b.status !== "returned") return false;
      if (selectedTab === "cancelled" && b.status !== "cancelled") return false;

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = b.id.toLowerCase().includes(q);
        const itemMatch = b.items.some((item) => (item.garmentName ?? "").toLowerCase().includes(q));
        if (!codeMatch && !itemMatch) return false;
      }

      return true;
    });
  }, [visibleBookings, selectedTab, searchQuery, refundMap]);

  // Pagination for history
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(historyPage, totalPages);
  const pagedHistory = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistory.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistory, currentPage]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setHistoryPage(1);
  }, [selectedTab, searchQuery]);

  // Renders a concise, clear deposit status badge
  function renderDepositCell(b: BookingResponse) {
    const isCompleted = b.status === "completed" || b.status === "refund_pending" || b.status === "returned";
    if (!isCompleted) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-stone-400">
          <Clock className="h-3 w-3 text-stone-300" />
          <span>Cọc: {formatVND(b.depositTotal)}</span>
        </span>
      );
    }

    const refund = refundMap[b.id];
    const penalty = Number(b.penaltyTotal ?? 0);
    const deposit = Number(b.depositTotal ?? 0);
    const excessDebt = penalty > deposit ? penalty - deposit : 0;
    const remaining = Math.max(0, deposit - penalty);

    if (excessDebt > 0) {
      return (
        <div className="flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-700">
            <AlertTriangle className="h-3 w-3 text-red-600 shrink-0" />
            <span>Cần đền bù: +{formatVND(excessDebt)}</span>
          </span>
          <button
            type="button"
            onClick={() => void handleOpenInspectionModal(b)}
            className="text-[10px] font-semibold text-red-700 underline hover:text-red-900 transition"
          >
            Xem biên bản & đối soát
          </button>
        </div>
      );
    }

    if (refund && (refund.status === "refunded" || refund.status === "partially_refunded")) {
      return (
        <div className="flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
            <span>Đã hoàn cọc {formatVND(refund.amount)}</span>
          </span>
          {refund.proofImageUrl && (
            <a
              href={refund.proofImageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-stone-500 hover:text-lotus transition"
            >
              <Receipt className="h-2.5 w-2.5" />
              <span>Xem ủy nhiệm chi</span>
            </a>
          )}
        </div>
      );
    }

    if (b.status === "refund_pending" || (refund && refund.status === "pending")) {
      return (
        <div className="flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200/90 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            <Clock className="h-3 w-3 text-amber-600 shrink-0" />
            <span>Đang hoàn: {formatVND(remaining > 0 ? remaining : deposit)}</span>
          </span>
          {penalty > 0 && (
            <span className="text-[10px] text-stone-500">
              (Đã trừ khấu trừ {formatVND(penalty)})
            </span>
          )}
        </div>
      );
    }

    if (penalty > 0) {
      return (
        <div className="flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            <AlertCircle className="h-3 w-3 text-amber-600 shrink-0" />
            <span>Khấu trừ: -{formatVND(penalty)}</span>
          </span>
          <button
            type="button"
            onClick={() => void handleOpenInspectionModal(b)}
            className="text-[10px] text-stone-500 underline hover:text-stone-800 transition"
          >
            Xem biên bản ({formatVND(remaining)} hoàn lại)
          </button>
        </div>
      );
    }

    return (
      <span className="text-xs text-stone-500">
        Cọc: {formatVND(deposit)}
      </span>
    );
  }

  // Renders clear, prioritized action buttons per row
  function renderRowActions(b: BookingResponse) {
    const isCompleted = b.status === "completed" || b.status === "returned";
    const hasInspection = b.status === "completed" || b.status === "refund_pending" || b.status === "returned";

    return (
      <div className="flex items-center justify-end gap-1.5">
        <Link
          href={`/booking/success?bookingId=${b.id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-lotus hover:text-lotus"
          title="Xem chi tiết đơn thuê"
        >
          <span>Chi tiết</span>
        </Link>

        {hasInspection && (
          <button
            type="button"
            onClick={() => void handleOpenInspectionModal(b)}
            className="inline-flex items-center gap-1 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-lotus hover:text-lotus"
            title="Xem biên bản kiểm tra đồ & ảnh chụp thực tế"
          >
            <ClipboardCheck className="h-3.5 w-3.5 text-stone-500" />
            <span className="hidden xl:inline">Biên bản</span>
          </button>
        )}

        {isCompleted && (
          <button
            type="button"
            onClick={() =>
              setReviewingItem({
                bookingId: b.id,
                garmentId: b.items[0]?.garmentId ?? "",
                garmentName: b.items[0]?.garmentName ?? "Trang phục",
              })
            }
            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-900 shadow-2xs transition hover:bg-amber-100"
            title="Đánh giá chất lượng trang phục"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-600" />
            <span>Đánh giá</span>
          </button>
        )}

        <button
          type="button"
          disabled={sendingBookingId === b.id}
          onClick={() => void handleSendBookingCard(b.id, "booking_support")}
          className="inline-flex items-center gap-1 rounded-lg border border-sand bg-white px-2 py-1.5 text-xs font-medium text-stone-600 shadow-2xs transition hover:text-jade hover:border-jade disabled:opacity-40"
          title="Gửi thẻ đơn vào khung chat hỗ trợ"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="sr-only sm:not-sr-only sm:text-[11px]">Hỗ trợ</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* 1. Header Banner & Profile Status */}
      <header className="relative overflow-hidden rounded-2xl border border-sand bg-white p-6 sm:p-8 shadow-xs">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lotus/10 px-3 py-1 text-xs font-semibold text-lotus border border-lotus/20">
                <Award className="h-3.5 w-3.5 text-lotus" />
                <span>Thành viên Cổ Phục Rental</span>
              </span>
              <span className="text-xs text-stone-400 font-sans">
                • {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" })}
              </span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              Xin chào, {userName}
            </h1>
            <p className="text-xs sm:text-sm text-stone-600 max-w-xl">
              Quản lý hành trình trải nghiệm di sản của bạn: theo dõi tiến trình đơn thuê, đối soát tiền cọc minh bạch và lưu giữ khoảnh khắc văn hóa.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/catalog"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-oxblood"
            >
              <span>Thuê cổ phục mới</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Decorative corner background motif */}
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-radial from-antique/20 to-transparent blur-2xl" />
      </header>

      {/* 2. Quick Metric Cards (Overview) */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Card 1: Active orders */}
        <div className="rounded-2xl border border-sand bg-white p-4 sm:p-5 shadow-2xs transition hover:shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Đơn đang hoạt động</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lotus/10 text-lotus">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-ink">
              {loading ? "—" : stats.activeCount}
            </span>
            <span className="text-xs text-stone-500">đơn</span>
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            {stats.activeCount > 0 ? "Đang chuẩn bị & trên lịch thuê" : "Hiện không có đơn thuê dở dang"}
          </p>
        </div>

        {/* Card 2: Safe Deposit */}
        <div className="rounded-2xl border border-sand bg-white p-4 sm:p-5 shadow-2xs transition hover:shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Cọc được bảo đảm</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-jade/10 text-jade">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold text-jade">
              {loading ? "—" : formatVND(stats.totalHoldingDeposit)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            {stats.refundPendingCount > 0 ? `${stats.refundPendingCount} đơn đang chờ hoàn tiền` : "Bảo chứng hoàn trả 100% khi nhận đồ"}
          </p>
        </div>

        {/* Card 3: Completed orders */}
        <div className="rounded-2xl border border-sand bg-white p-4 sm:p-5 shadow-2xs transition hover:shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Đơn đã hoàn tất</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-antique/15 text-stone-700">
              <CheckCircle2 className="h-4 w-4 text-antique" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-ink">
              {loading ? "—" : stats.completedCount}
            </span>
            <span className="text-xs text-stone-500">lần thuê</span>
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            Lịch sử lưu giữ kỷ niệm di sản
          </p>
        </div>

        {/* Card 4: Measurements & Try-on */}
        <Link
          href="/try-on"
          className="group rounded-2xl border border-sand bg-white p-4 sm:p-5 shadow-2xs transition hover:border-lotus hover:shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 group-hover:text-lotus transition">Phòng thử đồ AI</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lotus/10 text-lotus group-hover:bg-lotus group-hover:text-white transition">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-sm font-bold text-ink group-hover:text-lotus transition">
            <span>Trải nghiệm ngay</span>
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            Thử cổ phục trực tuyến bằng ảnh chân dung
          </p>
        </Link>
      </section>

      {/* Main Content Layout (Left Column 8 Cols + Right Sidebar 4 Cols) */}
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">

          {/* Test order warning filter if present */}
          {hiddenPendingTestCount > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <EyeOff className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed">
                  Đang tạm ẩn <strong>{hiddenPendingTestCount} đơn chờ xác nhận</strong> để dashboard gọn gàng.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPendingTestOrders(true)}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                Hiển thị tất cả
              </button>
            </div>
          )}

          {showPendingTestOrders && sortedBookings.some((b) => TEST_ORDER_STATUSES.has(b.status)) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPendingTestOrders(false)}
                className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                Thu gọn đơn chờ xác nhận
              </button>
            </div>
          )}

          {/* 3. Hero Active Booking Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
                  Đơn thuê hiện tại
                </h2>
                {activeBooking && (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              {activeBooking && (
                <span className="text-xs text-stone-500">
                  Mã đơn: <strong className="text-ink">#{activeBooking.id.slice(0, 8).toUpperCase()}</strong>
                </span>
              )}
            </div>

            {loading ? (
              <div className="rounded-2xl border border-sand bg-white p-6 sm:p-8 shadow-xs">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="h-28 w-28 shrink-0 animate-pulse rounded-xl bg-stone-200" />
                  <div className="flex-1 space-y-3">
                    <div className="h-6 w-48 animate-pulse rounded bg-stone-200" />
                    <div className="h-4 w-72 animate-pulse rounded bg-stone-200" />
                    <div className="h-4 w-52 animate-pulse rounded bg-stone-200" />
                  </div>
                </div>
              </div>
            ) : activeBooking ? (
              <div className="overflow-hidden rounded-2xl border border-sand bg-white shadow-sm transition">
                {/* Active Booking Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/70 bg-mist/60 px-6 py-3.5">
                  <div className="flex items-center gap-2.5 text-xs text-stone-600">
                    <Calendar className="h-4 w-4 text-antique" />
                    <span>Thời gian thuê: <strong>{formatDate(activeBooking.rentalStartDate)}</strong> đến <strong>{formatDate(activeBooking.rentalEndDate)}</strong> ({activeBooking.days} ngày)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-500">
                      {activeBooking.pickupMethod === "delivery" ? (
                        <span className="inline-flex items-center gap-1 font-medium text-stone-700">
                          <Truck className="h-3.5 w-3.5 text-jade" /> Giao tận nơi
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-stone-700">
                          <Store className="h-3.5 w-3.5 text-lotus" /> Nhận tại xưởng
                        </span>
                      )}
                    </span>
                    <span className={statusBadgeClass(statusOf(activeBooking.status).color)}>
                      {statusOf(activeBooking.status).label}
                    </span>
                  </div>
                </div>

                <div className="p-6 sm:p-7 space-y-6">
                  {/* Garment Details & Financial Summary */}
                  <div className="flex flex-col sm:flex-row items-start gap-5">
                    {/* Visual Outfit Thumbnail */}
                    <div className="relative h-28 w-28 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-xl border border-sand bg-stone-100 shadow-2xs">
                      {activeBooking.items[0]?.imageUrl ? (
                        <img
                          src={activeBooking.items[0].imageUrl}
                          alt={activeBooking.items[0].garmentName ?? "Cổ phục"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center bg-sand/30 text-stone-400 p-2 text-center">
                          <Sparkles className="h-6 w-6 text-antique mb-1" />
                          <span className="text-[10px] font-medium leading-tight">Cổ phục di sản</span>
                        </div>
                      )}
                      {activeBooking.items[0]?.sizeLabel && (
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Size {activeBooking.items[0].sizeLabel}
                        </span>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display text-2xl sm:text-3xl font-bold text-ink break-words">
                        {activeBooking.items[0]?.garmentName ?? "Trang phục cung đình"}
                      </h3>

                      {activeBooking.items.length > 1 && (
                        <p className="mt-1 text-xs text-stone-500">
                          và {activeBooking.items.length - 1} trang phục / phụ kiện đi kèm khác
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <div className="rounded-lg bg-mist border border-sand px-3 py-1.5">
                          <span className="text-stone-500 block text-[10px] uppercase font-semibold">Tiền thuê</span>
                          <span className="font-bold text-ink">{formatVND(activeBooking.rentalTotal)}</span>
                        </div>
                        <div className="rounded-lg bg-mist border border-sand px-3 py-1.5">
                          <span className="text-stone-500 block text-[10px] uppercase font-semibold">Tiền cọc</span>
                          <span className="font-bold text-jade">{formatVND(activeBooking.depositTotal)}</span>
                        </div>
                        <div className="rounded-lg bg-mist border border-sand px-3 py-1.5">
                          <span className="text-stone-500 block text-[10px] uppercase font-semibold">Tổng chi phí</span>
                          <span className="font-bold text-lotus">{formatVND(activeBooking.rentalTotal + activeBooking.depositTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stepper progress */}
                  <div className="border-t border-sand/80 pt-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
                      Tiến trình thực hiện
                    </p>
                    <BookingStatusStepper
                      status={activeBooking.status}
                      pickupMethod={activeBooking.pickupMethod}
                    />
                  </div>

                  {/* Damage / Penalty excess alert */}
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

                  {/* Handover summary component */}
                  <HandoverSummary handover={activeBooking.handover} compact />

                  {/* Action Buttons with clear primary/secondary hierarchy */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-sand/80 pt-5">
                    <Link
                      href={`/booking/success?bookingId=${activeBooking.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood"
                    >
                      <span>Xem hóa đơn & Chi tiết</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>

                    <button
                      type="button"
                      disabled={sendingBookingId === activeBooking.id}
                      onClick={() => void handleSendBookingCard(activeBooking.id, "booking_support")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sand bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-jade hover:text-jade disabled:opacity-40"
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-jade" />
                      <span>{sendingBookingId === activeBooking.id ? "Đang gửi..." : "Hỗ trợ đơn hàng"}</span>
                    </button>

                    <button
                      type="button"
                      disabled={sendingBookingId === activeBooking.id}
                      onClick={() => void handleSendBookingCard(activeBooking.id, "complaint")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sand bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-oxblood hover:text-oxblood disabled:opacity-40"
                    >
                      <AlertCircle className="h-3.5 w-3.5 text-oxblood" />
                      <span>{sendingBookingId === activeBooking.id ? "Đang gửi..." : "Khiếu nại"}</span>
                    </button>

                    {CANCELLABLE_STATUSES.has(activeBooking.status) && (
                      <button
                        type="button"
                        disabled={cancellingId === activeBooking.id}
                        onClick={() =>
                          setConfirmDialog({
                            title: "Xác nhận hủy đơn thuê",
                            message: "Bạn có chắc muốn hủy đơn thuê này? Tiền cọc sẽ được hoàn trả theo chính sách hủy của cửa hàng.",
                            danger: true,
                            onConfirm: () => handleCancel(activeBooking.id),
                          })
                        }
                        className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-stone-500 hover:text-red-700 transition"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>{cancellingId === activeBooking.id ? "Đang hủy..." : "Hủy đơn"}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-sand bg-white/60 p-8 sm:p-12 text-center shadow-2xs">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-parchment text-stone-400 mb-4">
                  <PackageOpen className="h-8 w-8 text-antique" />
                </div>
                <h3 className="font-display text-2xl font-bold text-ink">
                  Không có đơn thuê đang hoạt động
                </h3>
                <p className="mx-auto mt-2 max-w-md text-xs sm:text-sm text-stone-500">
                  Bạn hiện không có trang phục nào trong giai đoạn chuẩn bị hoặc đang mặc. Hãy chọn cho mình một bộ cổ phục ưng ý cho sự kiện sắp tới.
                </p>
                <div className="mt-6 flex justify-center">
                  <Link
                    href="/catalog"
                    className="inline-flex items-center gap-2 rounded-xl bg-lotus px-6 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
                  >
                    <span>Khám phá bộ sưu tập</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* 4. Delivery Tracker Section */}
          {(deliveryTrack || showDemoTracking) ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-antique" />
                  <h3 className="font-display text-2xl font-bold text-ink">
                    Lộ trình giao hàng thực tế
                  </h3>
                  {showDemoTracking && !deliveryTrack && (
                    <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
                      Chế độ mô phỏng GPS
                    </span>
                  )}
                </div>
                {showDemoTracking && !deliveryTrack && (
                  <button
                    type="button"
                    onClick={() => setShowDemoTracking(false)}
                    className="text-xs text-stone-500 hover:text-stone-800 underline transition"
                  >
                    Đóng mô phỏng
                  </button>
                )}
              </div>
              <DeliveryTracker data={deliveryTrack || DEMO_DELIVERY_TRACK} />
            </section>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-sand bg-white p-5 shadow-2xs">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ink">
                    Hệ thống giám sát giao hàng thời gian thực
                  </h4>
                  <p className="text-xs text-stone-500">
                    Hỗ trợ theo dõi vị trí shipper trên bản đồ đường phố kèm thời gian dự kiến (ETA).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDemoTracking(true)}
                className="shrink-0 rounded-xl bg-mist border border-sand px-4 py-2 text-xs font-semibold text-stone-700 hover:border-lotus hover:text-lotus transition shadow-2xs"
              >
                Xem thử mô phỏng GPS 🛵
              </button>
            </div>
          )}

          {/* 5. Booking History with Tabs & Search */}
          <section className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
                  Lịch sử thuê cổ phục
                </h2>
                <p className="text-xs text-stone-500">
                  Xem lại toàn bộ lịch sử thuê, tình trạng hoàn cọc và biên bản kiểm định.
                </p>
              </div>

              {/* Search bar */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo tên đồ hoặc mã đơn..."
                  className="w-full rounded-xl border border-sand bg-white py-2 pl-9 pr-3 text-xs text-ink placeholder:text-stone-400 focus:border-lotus focus:outline-none transition shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Overdue alert if any */}
            {overdueBookings.length > 0 && (
              <div role="alert" className="space-y-2">
                {overdueBookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50/80 px-4 py-3 text-xs text-red-900"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">
                          Đơn #{b.id.slice(0, 8).toUpperCase()} đã quá hạn trả {b.overdueDays} ngày
                        </p>
                        <p className="mt-0.5 text-red-800">
                          Hạn trả gốc: {formatDate(b.rentalEndDate)} · Phí quá hạn hiện tại: <strong>{formatVND(b.overdueAmount ?? 0)}</strong> ({(b.overdueFeePerDay ?? 0).toLocaleString("vi-VN")}đ/ngày).
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/booking/success?bookingId=${b.id}`}
                      className="shrink-0 rounded-lg bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-red-800"
                    >
                      Xử lý hoàn trả
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-sand pb-3">
              {[
                { key: "all", label: "Tất cả", count: visibleBookings.length },
                { key: "active", label: "Đang hoạt động", count: sortedBookings.filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status)).length },
                { key: "refund", label: "Chờ hoàn cọc", count: sortedBookings.filter((b) => b.status === "refund_pending").length },
                { key: "completed", label: "Đã hoàn tất", count: sortedBookings.filter((b) => b.status === "completed" || b.status === "returned").length },
                { key: "cancelled", label: "Đã hủy", count: sortedBookings.filter((b) => b.status === "cancelled").length },
              ].map((tab) => {
                const isActive = selectedTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSelectedTab(tab.key as HistoryTab)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      isActive
                        ? "bg-lotus text-white shadow-2xs"
                        : "text-stone-600 hover:bg-white hover:text-ink"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                        isActive ? "bg-white/20 text-white" : "bg-sand/60 text-stone-600"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Table / Card List */}
            {filteredHistory.length === 0 && !loading ? (
              <div className="rounded-2xl border border-dashed border-sand bg-white/60 p-10 text-center">
                <p className="text-sm font-medium text-stone-500">
                  {searchQuery ? "Không tìm thấy đơn thuê nào khớp với từ khóa." : "Chưa có đơn thuê nào trong mục này."}
                </p>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="mt-2 text-xs font-semibold text-lotus underline hover:text-oxblood"
                  >
                    Xóa bộ lọc tìm kiếm
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-sand bg-white shadow-xs">
                {/* Desktop Table View */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-sand bg-mist text-stone-500 font-semibold uppercase tracking-[0.12em] text-[10px]">
                        <th className="px-5 py-3.5">Trang phục & Mã đơn</th>
                        <th className="px-5 py-3.5 whitespace-nowrap">Thời gian</th>
                        <th className="px-5 py-3.5">Trạng thái</th>
                        <th className="px-5 py-3.5 whitespace-nowrap">Tổng tiền</th>
                        <th className="px-5 py-3.5">Tình trạng cọc</th>
                        <th className="px-5 py-3.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand/70">
                      {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <tr key={`skeleton-${i}`} className="animate-pulse">
                            <td className="px-5 py-4"><div className="h-4 w-36 rounded bg-stone-200" /></td>
                            <td className="px-5 py-4"><div className="h-4 w-32 rounded bg-stone-200" /></td>
                            <td className="px-5 py-4"><div className="h-5 w-24 rounded-full bg-stone-200" /></td>
                            <td className="px-5 py-4"><div className="h-4 w-20 rounded bg-stone-200" /></td>
                            <td className="px-5 py-4"><div className="h-5 w-28 rounded bg-stone-200" /></td>
                            <td className="px-5 py-4"><div className="h-7 w-20 ml-auto rounded bg-stone-200" /></td>
                          </tr>
                        ))
                      ) : (
                        pagedHistory.map((b) => {
                          const st = statusOf(b.status);
                          return (
                            <tr key={b.id} className="transition hover:bg-mist/60">
                              {/* Garment name & code */}
                              <td className="px-5 py-4 max-w-[240px]">
                                <div className="font-bold text-ink">
                                  {b.items[0]?.garmentName ?? "Trang phục cổ"}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-400">
                                  <span>#{b.id.slice(0, 8).toUpperCase()}</span>
                                  {b.items[0]?.sizeLabel && (
                                    <span>· Size {b.items[0].sizeLabel}</span>
                                  )}
                                  {b.items.length > 1 && (
                                    <span className="rounded bg-sand/60 px-1 text-[9px] text-stone-600">
                                      +{b.items.length - 1} món
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Dates */}
                              <td className="px-5 py-4 whitespace-nowrap text-stone-600">
                                <div>{formatDate(b.rentalStartDate)} – {formatDate(b.rentalEndDate)}</div>
                                <div className="text-[10px] text-stone-400">{b.days} ngày thuê</div>
                              </td>

                              {/* Status */}
                              <td className="px-5 py-4 whitespace-nowrap">
                                <span className={statusBadgeClass(st.color)}>
                                  {st.label}
                                </span>
                              </td>

                              {/* Total Price */}
                              <td className="px-5 py-4 whitespace-nowrap">
                                <div className="font-semibold text-ink">
                                  {formatVND(b.rentalTotal + b.depositTotal)}
                                </div>
                                <div className="text-[10px] text-stone-400">
                                  Thuê: {formatVND(b.rentalTotal)}
                                </div>
                              </td>

                              {/* Refund & Deposit */}
                              <td className="px-5 py-4">
                                {renderDepositCell(b)}
                              </td>

                              {/* Actions */}
                              <td className="px-5 py-4 whitespace-nowrap text-right">
                                {renderRowActions(b)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="divide-y divide-sand/80 md:hidden">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={`m-skeleton-${i}`} className="p-4 space-y-2.5 animate-pulse">
                        <div className="h-4 w-40 rounded bg-stone-200" />
                        <div className="h-3 w-60 rounded bg-stone-200" />
                        <div className="h-6 w-20 rounded bg-stone-200" />
                      </div>
                    ))
                  ) : (
                    pagedHistory.map((b) => {
                      const st = statusOf(b.status);
                      return (
                        <div key={b.id} className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-sm text-ink">
                                {b.items[0]?.garmentName ?? "Trang phục cổ"}
                              </h4>
                              <p className="text-[11px] text-stone-400">
                                #{b.id.slice(0, 8).toUpperCase()} · {formatDate(b.rentalStartDate)} – {formatDate(b.rentalEndDate)}
                              </p>
                            </div>
                            <span className={statusBadgeClass(st.color)}>
                              {st.label}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs bg-mist/60 rounded-xl p-3 border border-sand/60">
                            <div>
                              <span className="text-[10px] text-stone-400 block">Tổng thanh toán</span>
                              <span className="font-semibold text-ink">{formatVND(b.rentalTotal + b.depositTotal)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-stone-400 block">Tình trạng cọc</span>
                              {renderDepositCell(b)}
                            </div>
                          </div>

                          <div className="flex justify-end pt-1">
                            {renderRowActions(b)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Pagination */}
                {!loading && totalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand bg-mist/40 px-5 py-3.5">
                    <p className="text-xs text-stone-500">
                      Hiển thị {(currentPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(currentPage * HISTORY_PAGE_SIZE, filteredHistory.length)} trong tổng số {filteredHistory.length} đơn
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Trang trước"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setHistoryPage(page)}
                          className={
                            page === currentPage
                              ? "flex h-8 min-w-8 items-center justify-center rounded-lg bg-lotus px-2 text-xs font-semibold text-white shadow-2xs"
                              : "flex h-8 min-w-8 items-center justify-center rounded-lg border border-sand bg-white px-2 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                          }
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
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

        {/* Right Sidebar Column (4 Cols) */}
        <aside className="space-y-6 lg:col-span-4">
          {/* Quick Service Widgets */}
          <div className="space-y-4">
            <h3 className="font-display text-xl font-bold text-ink flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-antique" />
              <span>Tiện ích cá nhân</span>
            </h3>

            {customerWidgets.map((item) => (
              <Link
                key={item.title}
                href={item.href || "/dashboard/customer"}
                className="group block rounded-2xl border border-sand bg-white p-5 shadow-2xs transition hover:border-lotus hover:shadow-xs"
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.accent}`}>
                    {item.icon === "face_retouching_natural" ? (
                      <Sparkles className="h-5 w-5" />
                    ) : item.icon === "straighten" ? (
                      <Ruler className="h-5 w-5" />
                    ) : (
                      <Layers className="h-5 w-5" />
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-stone-400 group-hover:text-lotus group-hover:translate-x-1 transition" />
                </div>
                <h4 className="font-display text-xl font-bold text-ink group-hover:text-lotus transition">
                  {item.title}
                </h4>
                <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>

          {/* Heritage Care & Support Atelier Card */}
          <div className="rounded-2xl border border-sand bg-radial from-parchment/60 to-mist p-6 shadow-2xs space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lotus text-white">
                <Store className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-display text-lg font-bold text-ink">
                  Atelier Cổ Phục Rental
                </h4>
                <p className="text-[11px] text-stone-500">
                  Không gian may đo & bảo tồn di sản
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-stone-600 border-t border-sand/80 pt-3">
              <div className="flex items-center justify-between">
                <span>Hotline tư vấn:</span>
                <a href="tel:19001234" className="font-bold text-ink hover:text-lotus">
                  0908 123 456
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span>Giờ làm việc:</span>
                <span className="font-medium text-stone-700">08:30 - 20:30 hàng ngày</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Địa chỉ xưởng:</span>
                <span className="font-medium text-stone-700 text-right">Quận 1, TP. Hồ Chí Minh</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("chat:open"));
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-sand bg-white py-2.5 text-xs font-semibold text-stone-800 shadow-2xs hover:border-lotus hover:text-lotus transition"
            >
              <MessageSquare className="h-3.5 w-3.5 text-lotus" />
              <span>Nhắn tin với nhân viên tư vấn</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Review Modal */}
      {reviewingItem && (
        <ReviewModal
          bookingId={reviewingItem.bookingId}
          garmentId={reviewingItem.garmentId}
          garmentName={reviewingItem.garmentName}
          onClose={() => setReviewingItem(null)}
          onSuccess={() => {
            showToast("success", "Cảm ơn bạn đã gửi đánh giá trải nghiệm!");
            refreshBookings();
          }}
        />
      )}

      {/* Toast Notification */}
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

      {/* Confirm Action Dialog */}
      <ConfirmModal
        open={!!confirmDialog}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        danger={confirmDialog?.danger}
        onConfirm={() => {
          confirmDialog?.onConfirm();
          setConfirmDialog(null);
        }}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Inspection & Deposit Breakdown Modal */}
      {inspectingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-stone-200">
            {/* Modal Header */}
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

            {/* Financial summary calculations */}
            {(() => {
              const deposit = Number(inspectingBooking.depositTotal ?? 0);
              const penalty = Number(inspectingBooking.penaltyTotal ?? 0);
              const remaining = Math.max(0, deposit - penalty);
              const excess = penalty > deposit ? penalty - deposit : 0;

              return (
                <div className={`my-5 rounded-xl border p-4 ${excess > 0 ? "border-red-300 bg-red-50/50" : "border-sand bg-mist/60"}`}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
                    Bảng chiết tính cọc & hoàn trả
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg bg-white p-3 border border-stone-200/70 shadow-2xs">
                      <span className="text-xs text-stone-500 block">Tiền cọc ban đầu</span>
                      <span className="text-base font-semibold text-ink">
                        {formatVND(deposit)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-stone-200/70 shadow-2xs">
                      <span className="text-xs text-stone-500 block">Khấu trừ hư tổn / vệ sinh</span>
                      <span className={`text-base font-semibold ${penalty > 0 ? "text-red-600" : "text-stone-700"}`}>
                        {penalty > 0 ? `-${formatVND(penalty)}` : "0đ"}
                      </span>
                    </div>
                    <div className={`rounded-lg p-3 border shadow-2xs ${
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

            {/* Inspection Session List */}
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
                      className="rounded-xl border border-stone-200 bg-white p-4 shadow-2xs"
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

                      {/* Integrity score */}
                      {session.aiComparisonResult?.conditionScore !== undefined && session.aiComparisonResult?.conditionScore !== null && (() => {
                        const score = Math.max(0, Math.min(100, Number(session.aiComparisonResult.conditionScore) || 0));
                        const loss = 100 - score;
                        return (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand bg-mist px-3 py-2 text-xs">
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

                      {/* Staff note */}
                      {session.note && (
                        <div className="mt-3 text-xs text-stone-600 bg-stone-50 rounded-lg p-2.5 border border-stone-100">
                          <span className="font-semibold text-stone-700">Ghi chú nhân viên: </span>
                          {session.note}
                        </div>
                      )}

                      {/* Findings table */}
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

                      {/* Actual photos */}
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

                      {/* Handover comparison photos if any */}
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

      {/* Lightbox Modal */}
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
