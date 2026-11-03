"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  PackageOpen,
  RotateCcw,
  AlertTriangle,
  ClipboardCheck,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  Phone,
  MapPin,
  Store,
  Truck,
  ShieldCheck,
  AlertCircle,
  Shirt,
  Calendar,
  Layers,
} from "lucide-react";
import {
  getStaffDashboardOverview,
  type StaffOverviewResponse,
} from "@/lib/api";
import { STATUS_LABELS, statusBadgeClass } from "@/lib/status-labels";

function formatDateVN(iso: string | undefined): string {
  if (!iso) return "—";
  const datePart = iso.includes("T") ? iso.split("T")[0] : iso;
  const parts = datePart.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }
  return iso;
}

function formatTimeAndDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(d);
  } catch {
    return iso;
  }
}

function calculateDays(startIso: string | undefined, endIso: string | undefined): number {
  if (!startIso || !endIso) return 1;
  const s = startIso.split("T")[0];
  const e = endIso.split("T")[0];
  const sParts = s.split("-").map(Number);
  const eParts = e.split("-").map(Number);
  if (sParts.length === 3 && eParts.length === 3) {
    const dStart = Date.UTC(sParts[0], sParts[1] - 1, sParts[2]);
    const dEnd = Date.UTC(eParts[0], eParts[1] - 1, eParts[2]);
    const diff = Math.max(0, Math.round((dEnd - dStart) / 86400000));
    return diff + 1;
  }
  return 1;
}

interface StaffOverviewTabProps {
  onSwitchTab: (tab: "pending" | "all" | "refunds" | "map", filterStatus?: string) => void;
  onSelectBooking?: (bookingId: string) => void;
}

export function StaffOverviewTab({ onSwitchTab, onSelectBooking }: StaffOverviewTabProps) {
  const router = useRouter();
  const [data, setData] = useState<StaffOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bộ lọc lịch trình giao nhận
  const [schedulePeriod, setSchedulePeriod] = useState<"today" | "month" | "year" | "custom">("today");
  const [scheduleFrom, setScheduleFrom] = useState("");
  const [scheduleTo, setScheduleTo] = useState("");

  const fetchOverview = useCallback(async (
    isManualRefresh = false,
    customParams?: { period?: "today" | "month" | "year" | "custom"; from?: string; to?: string }
  ) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const p = customParams?.period ?? schedulePeriod;
    const f = customParams?.from ?? scheduleFrom;
    const t = customParams?.to ?? scheduleTo;

    try {
      const res = await getStaffDashboardOverview({
        schedulePeriod: p,
        scheduleFrom: f || undefined,
        scheduleTo: t || undefined,
      });
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error || "Không thể tải dữ liệu tổng quan.");
      }
    } catch (err: any) {
      setError(err?.message || "Lỗi kết nối máy chủ.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [schedulePeriod, scheduleFrom, scheduleTo]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handlePeriodChange = (newPeriod: "today" | "month" | "year" | "custom") => {
    setSchedulePeriod(newPeriod);
    if (newPeriod !== "custom") {
      fetchOverview(false, { period: newPeriod });
    }
  };

  const handleCustomDateApply = () => {
    if (scheduleFrom && scheduleTo) {
      fetchOverview(false, { period: "custom", from: scheduleFrom, to: scheduleTo });
    }
  };

  // Format today date in Vietnamese
  const todayFormatted = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-20 bg-stone-100 rounded-2xl" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 bg-stone-100 rounded-2xl" />
          ))}
        </div>
        <div className="h-32 bg-stone-100 rounded-2xl" />
        <div className="grid md:grid-cols-12 gap-6">
          <div className="md:col-span-7 h-80 bg-stone-100 rounded-2xl" />
          <div className="md:col-span-5 h-80 bg-stone-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center rounded-2xl border border-red-200 bg-red-50/50">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h3 className="font-semibold text-red-800 text-lg">Không thể tải thông tin vận hành</h3>
        <p className="text-sm text-red-600 mt-1 max-w-md mx-auto">{error}</p>
        <button
          onClick={() => fetchOverview(true)}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition"
        >
          <RefreshCw className="w-4 h-4" /> Thử lại
        </button>
      </div>
    );
  }

  const { metrics, statusCounts, assetStatus, todaySchedule, taskQueue, alerts } = data;
  const assetTotal = assetStatus.total || 1;
  const availPct = Math.round((assetStatus.available / assetTotal) * 100);
  const rentPct = Math.round((assetStatus.renting / assetTotal) * 100);
  const cleanPct = Math.round((assetStatus.laundryMaintenance / assetTotal) * 100);
  const dmgPct = Math.max(0, 100 - availPct - rentPct - cleanPct);

  // Danh mục toàn bộ các trạng thái đơn thuê trong vòng đời
  const lifecycleStatuses = [
    {
      key: "pending_confirmation",
      label: "Chờ xác nhận",
      count: statusCounts?.pending_confirmation ?? metrics.pendingConfirmation,
      badgeBorder: "border-amber-200/90 hover:border-amber-400 bg-amber-50/40 hover:bg-amber-50/80",
      dotColor: "bg-amber-500",
      textColor: "text-amber-800",
      onClick: () => onSwitchTab("pending"),
    },
    {
      key: "confirmed",
      label: "Đã xác nhận",
      count: statusCounts?.confirmed ?? 0,
      badgeBorder: "border-blue-200/90 hover:border-blue-400 bg-blue-50/40 hover:bg-blue-50/80",
      dotColor: "bg-blue-500",
      textColor: "text-blue-800",
      onClick: () => onSwitchTab("all", "confirmed"),
    },
    {
      key: "awaiting_payment",
      label: "Chờ thanh toán",
      count: statusCounts?.awaiting_payment ?? 0,
      badgeBorder: "border-orange-200/90 hover:border-orange-400 bg-orange-50/40 hover:bg-orange-50/80",
      dotColor: "bg-orange-500",
      textColor: "text-orange-800",
      onClick: () => onSwitchTab("all", "awaiting_payment"),
    },
    {
      key: "paid",
      label: "Đã cọc / TT",
      count: statusCounts?.paid ?? 0,
      badgeBorder: "border-emerald-200/90 hover:border-emerald-400 bg-emerald-50/40 hover:bg-emerald-50/80",
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-800",
      onClick: () => onSwitchTab("all", "paid"),
    },
    {
      key: "preparing",
      label: "Đang chuẩn bị",
      count: statusCounts?.preparing ?? 0,
      badgeBorder: "border-sky-200/90 hover:border-sky-400 bg-sky-50/40 hover:bg-sky-50/80",
      dotColor: "bg-sky-500",
      textColor: "text-sky-800",
      onClick: () => onSwitchTab("all", "preparing"),
    },
    {
      key: "ready_for_pickup",
      label: "Sẵn sàng nhận",
      count: statusCounts?.ready_for_pickup ?? 0,
      badgeBorder: "border-indigo-200/90 hover:border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50/80",
      dotColor: "bg-indigo-500",
      textColor: "text-indigo-800",
      onClick: () => onSwitchTab("all", "ready_for_pickup"),
    },
    {
      key: "delivering",
      label: "Đang giao ship",
      count: statusCounts?.delivering ?? 0,
      badgeBorder: "border-cyan-200/90 hover:border-cyan-400 bg-cyan-50/40 hover:bg-cyan-50/80",
      dotColor: "bg-cyan-500",
      textColor: "text-cyan-800",
      onClick: () => onSwitchTab("all", "delivering"),
    },
    {
      key: "renting",
      label: "Khách đang thuê",
      count: statusCounts?.renting ?? 0,
      badgeBorder: "border-emerald-200/90 hover:border-emerald-400 bg-emerald-50/40 hover:bg-emerald-50/80",
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-800",
      onClick: () => onSwitchTab("all", "renting"),
    },
    {
      key: "returned",
      label: "Chờ kiểm tra",
      count: (statusCounts?.returned ?? 0) + (statusCounts?.inspection_pending ?? 0),
      badgeBorder: "border-purple-200/90 hover:border-purple-400 bg-purple-50/40 hover:bg-purple-50/80",
      dotColor: "bg-purple-500",
      textColor: "text-purple-800",
      onClick: () => onSwitchTab("all", "returned,inspection_pending"),
    },
    {
      key: "overdue",
      label: "Đơn quá hạn",
      count: statusCounts?.overdue ?? metrics.overdue,
      badgeBorder: "border-rose-200/90 hover:border-rose-400 bg-rose-50/40 hover:bg-rose-50/80",
      dotColor: "bg-rose-500",
      textColor: "text-rose-800",
      onClick: () => onSwitchTab("all", "overdue"),
    },
    {
      key: "refund_pending",
      label: "Chờ hoàn cọc",
      count: statusCounts?.refund_pending ?? 0,
      badgeBorder: "border-teal-200/90 hover:border-teal-400 bg-teal-50/40 hover:bg-teal-50/80",
      dotColor: "bg-teal-500",
      textColor: "text-teal-800",
      onClick: () => onSwitchTab("all", "refund_pending"),
    },
    {
      key: "completed",
      label: "Đã hoàn tất",
      count: statusCounts?.completed ?? 0,
      badgeBorder: "border-stone-200/90 hover:border-stone-400 bg-stone-50/40 hover:bg-stone-50/80",
      dotColor: "bg-stone-400",
      textColor: "text-stone-700",
      onClick: () => onSwitchTab("all", "completed"),
    },
    {
      key: "cancelled",
      label: "Đã hủy đơn",
      count: statusCounts?.cancelled ?? 0,
      badgeBorder: "border-red-200/90 hover:border-red-400 bg-red-50/40 hover:bg-red-50/80",
      dotColor: "bg-red-500",
      textColor: "text-red-800",
      onClick: () => onSwitchTab("all", "cancelled"),
    },
    {
      key: "rejected",
      label: "Đã từ chối",
      count: statusCounts?.rejected ?? 0,
      badgeBorder: "border-zinc-200/90 hover:border-zinc-400 bg-zinc-50/40 hover:bg-zinc-50/80",
      dotColor: "bg-zinc-500",
      textColor: "text-zinc-700",
      onClick: () => onSwitchTab("all", "rejected"),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Ca làm việc & Thanh công cụ ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-sand/50 via-lotus/5 to-sand/20 border border-sand-dark/20 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-semibold">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Ca trực đang hoạt động
            </span>
            <span className="text-xs font-semibold tracking-wider uppercase text-lotus-dark">
              Trạm Vận Hành Cổ Phục
            </span>
          </div>
          <h2 className="text-xl font-bold text-ink capitalize tracking-tight">
            {todayFormatted}
          </h2>
          <p className="text-xs text-ink/60 mt-0.5">
            Bao quát toàn bộ vòng đời đơn thuê, ca trực bàn giao và tình trạng tài sản kho.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          <button
            onClick={() => fetchOverview(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border border-sand-dark/30 bg-white text-ink hover:bg-sand/30 hover:border-lotus/40 transition shadow-2xs disabled:opacity-50"
            title="Làm mới số liệu"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-lotus" : ""}`} />
            <span>{refreshing ? "Đang đồng bộ..." : "Làm mới"}</span>
          </button>
          <Link
            href="/dashboard/staff/booking"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-sand-dark/30 bg-white text-ink hover:bg-sand/30 hover:border-lotus/40 transition shadow-2xs"
          >
            <Layers className="w-3.5 h-3.5 text-lotus" />
            <span>Quản lý đơn hàng</span>
          </Link>
          <Link
            href="/dashboard/staff/inspection"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-lotus text-white hover:bg-oxblood transition shadow-sm hover:shadow"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Bàn kiểm hiện vật</span>
          </Link>
        </div>
      </div>

      {/* ── Cảnh báo Vận hành (nếu có) ── */}
      {alerts && alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-start gap-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50/80 text-amber-900 text-xs shadow-xs"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold">Cảnh báo chuẩn bị: </span>
                {alert.message}
              </div>
              {alert.bookingCode && (
                <button
                  onClick={() => onSwitchTab("all")}
                  className="shrink-0 font-medium text-amber-800 underline hover:text-amber-950"
                >
                  Kiểm tra đơn
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── MỚI: Toàn Bộ Trạng Thái Đơn Thuê (Booking Status Pipeline) ── */}
      <div className="p-5 rounded-2xl bg-white border border-sand-dark/20 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-lotus" />
            <h3 className="font-bold text-sm text-ink">
              Trạng Thái Toàn Bộ Đơn Thuê Trong Hệ Thống
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-lotus/10 text-lotus font-semibold">
              Vòng đời đơn
            </span>
          </div>
          <span className="text-xs text-ink/50">
            Tổng cộng: <strong className="text-ink font-semibold">{statusCounts?.total ?? 0}</strong> đơn thuê
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {lifecycleStatuses.map((st) => (
            <button
              key={st.key}
              onClick={st.onClick}
              className={`group flex items-center justify-between p-3 rounded-xl border text-left transition-all duration-150 hover:shadow-xs hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lotus ${st.badgeBorder}`}
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${st.dotColor} shrink-0 ring-2 ring-current/25`} />
                  <span className={`text-xs font-semibold truncate ${st.textColor} group-hover:text-lotus transition`}>
                    {st.label}
                  </span>
                </div>
                <p className="text-[10px] text-ink/40 mt-0.5 group-hover:text-ink/70">Bấm để lọc</p>
              </div>
              <span className="text-base font-bold font-mono tabular-nums text-ink shrink-0 group-hover:text-lotus transition">
                {st.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── TẦNG 2: Tình trạng Hiện vật Cổ phục trong Kho (Read-Only) ── */}
      <div className="p-5 rounded-2xl bg-white border border-sand-dark/20 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Shirt className="w-4 h-4 text-lotus" />
            <h3 className="font-bold text-sm text-ink">
              Tình trạng Hiện vật Cổ phục trong Kho
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 font-medium">
              Chỉ xem (Read-only)
            </span>
          </div>
          <span className="text-xs text-ink/50">
            Tổng tài sản theo dõi: <strong className="text-ink font-semibold">{assetStatus.total}</strong> hiện vật
          </span>
        </div>

        {/* Thanh tỷ lệ phân đoạn */}
        <div className="h-3 w-full rounded-full bg-stone-100 overflow-hidden flex gap-0.5">
          <div
            style={{ width: `${availPct}%` }}
            className="bg-emerald-500 transition-all duration-500"
            title={`Sẵn sàng: ${assetStatus.available} (${availPct}%)`}
          />
          <div
            style={{ width: `${rentPct}%` }}
            className="bg-amber-500 transition-all duration-500"
            title={`Đã giữ chỗ / Đang thuê: ${assetStatus.renting} (${rentPct}%) — Gồm ${assetStatus.reserved ?? 0} giữ chỗ cho đơn, ${assetStatus.rented ?? 0} khách đang cầm`}
          />
          <div
            style={{ width: `${cleanPct}%` }}
            className="bg-sky-500 transition-all duration-500"
            title={`Giặt / Sửa: ${assetStatus.laundryMaintenance} (${cleanPct}%)`}
          />
          <div
            style={{ width: `${dmgPct}%` }}
            className="bg-rose-500 transition-all duration-500"
            title={`Chờ xử lý / Hỏng: ${assetStatus.damagedPending} (${dmgPct}%)`}
          />
        </div>

        {/* Chi tiết 4 khối trạng thái */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-sand/40">
          <div className="p-3 rounded-xl bg-sand/15 border border-sand/40 hover:bg-sand/30 transition flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 shrink-0 ring-4 ring-emerald-500/10" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink/60 truncate">Sẵn sàng thuê</p>
              <p className="text-base font-bold font-mono text-ink">
                {assetStatus.available} <span className="text-[11px] font-sans font-normal text-ink/40">({availPct}%)</span>
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-sand/15 border border-sand/40 hover:bg-sand/30 transition flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full bg-amber-500 shrink-0 ring-4 ring-amber-500/10" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink/60 truncate">Đã gán đơn / Thuê</p>
              <p className="text-base font-bold font-mono text-ink">
                {assetStatus.renting} <span className="text-[11px] font-sans font-normal text-ink/40">({rentPct}%)</span>
              </p>
              <p className="text-[10px] text-amber-700 font-medium truncate">
                {assetStatus.reserved ?? 0} giữ chỗ · {assetStatus.rented ?? 0} đang thuê
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-sand/15 border border-sand/40 hover:bg-sand/30 transition flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full bg-sky-500 shrink-0 ring-4 ring-sky-500/10" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink/60 truncate">Đang giặt / Sửa</p>
              <p className="text-base font-bold font-mono text-ink">
                {assetStatus.laundryMaintenance} <span className="text-[11px] font-sans font-normal text-ink/40">({cleanPct}%)</span>
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-sand/15 border border-sand/40 hover:bg-sand/30 transition flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full bg-rose-500 shrink-0 ring-4 ring-rose-500/10" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink/60 truncate">Chờ Quản lý xử lý</p>
              <p className="text-base font-bold font-mono text-ink">
                {assetStatus.damagedPending} <span className="text-[11px] font-sans font-normal text-ink/40">({dmgPct}%)</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Hai Cột: Lịch Trình Giao Nhận & Task Queue Ưu Tiên ── */}
      <div className="grid md:grid-cols-12 gap-6">
        {/* Cột Trái: Lịch trình giao nhận (Schedule) */}
        <div className="md:col-span-7 p-5 rounded-2xl bg-white border border-sand-dark/20 shadow-xs flex flex-col">
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-lotus" />
                <h3 className="font-bold text-sm text-ink">
                  {schedulePeriod === "today"
                    ? "Lịch Giao Nhận Hôm Nay"
                    : schedulePeriod === "month"
                    ? "Lịch Giao Nhận Tháng Này"
                    : schedulePeriod === "year"
                    ? "Lịch Giao Nhận Năm Nay"
                    : "Lịch Giao Nhận Tùy Chọn"}
                </h3>
              </div>
              <span className="text-xs text-ink/50">
                {todaySchedule.length} lượt hẹn
              </span>
            </div>

            {/* Bộ chọn thời gian: Hôm nay | Tháng này | Năm nay | Tùy chọn ngày */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-sand/30 border border-sand-dark/20 text-xs self-start flex-wrap">
              <button
                type="button"
                onClick={() => handlePeriodChange("today")}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  schedulePeriod === "today"
                    ? "bg-white text-lotus shadow-xs font-semibold"
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                Hôm nay
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange("month")}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  schedulePeriod === "month"
                    ? "bg-white text-lotus shadow-xs font-semibold"
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                Tháng này
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange("year")}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  schedulePeriod === "year"
                    ? "bg-white text-lotus shadow-xs font-semibold"
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                Năm nay
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange("custom")}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  schedulePeriod === "custom"
                    ? "bg-white text-lotus shadow-xs font-semibold"
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                Tùy chọn ngày
              </button>
            </div>

            {/* Dải chọn ngày tùy biến */}
            {schedulePeriod === "custom" && (
              <div className="flex items-center gap-2 pt-1 text-xs flex-wrap">
                <span className="text-ink/60">Từ:</span>
                <input
                  type="date"
                  value={scheduleFrom}
                  onChange={(e) => setScheduleFrom(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border border-sand bg-white text-ink text-xs focus:ring-1 focus:ring-lotus"
                />
                <span className="text-ink/60">Đến:</span>
                <input
                  type="date"
                  value={scheduleTo}
                  onChange={(e) => setScheduleTo(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border border-sand bg-white text-ink text-xs focus:ring-1 focus:ring-lotus"
                />
                <button
                  type="button"
                  onClick={handleCustomDateApply}
                  disabled={!scheduleFrom || !scheduleTo}
                  className="px-3 py-1 rounded-lg bg-lotus text-white font-medium hover:bg-oxblood transition disabled:opacity-40"
                >
                  Áp dụng
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px] pr-1 space-y-3">
            {todaySchedule.length === 0 ? (
              <div className="py-12 text-center text-ink/40">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400 opacity-60" />
                <p className="text-xs">
                  {schedulePeriod === "today"
                    ? "Hôm nay không có lịch hẹn giao nhận nào cần xử lý."
                    : schedulePeriod === "month"
                    ? "Tháng này không có lịch hẹn nào."
                    : "Không có lịch hẹn nào trong giai đoạn này."}
                </p>
              </div>
            ) : (
              todaySchedule.map((item, index) => {
                const st = STATUS_LABELS[item.status] ?? {
                  label: item.status,
                  color: "bg-stone-100 text-stone-600",
                };
                const isPickup = item.pickupMethod === "store_pickup";

                return (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl border border-sand/60 bg-sand/10 hover:bg-white hover:border-lotus/40 hover:shadow-xs transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Số thứ tự STT */}
                      <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sand-dark/20 text-ink text-xs font-bold shrink-0 mt-0.5">
                        {index + 1}
                      </span>

                      <div
                        className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                          item.type === "return"
                            ? "bg-jade/10 text-jade"
                            : isPickup
                            ? "bg-lotus/10 text-lotus"
                            : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {item.type === "return" ? (
                          <RotateCcw className="w-4 h-4" />
                        ) : isPickup ? (
                          <Store className="w-4 h-4" />
                        ) : (
                          <Truck className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Hàng 1: Mã đơn, Trạng thái, Sự kiện ca trực, Hình thức nhận, Thời gian tạo */}
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span className="font-bold text-xs text-ink tracking-wide">
                            #{item.bookingCode}
                          </span>
                          <span className={statusBadgeClass(st.color)}>
                            {st.label}
                          </span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                            item.type === "return"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : isPickup
                              ? "bg-lotus/10 text-lotus border border-lotus/20"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                            {item.timeLabel}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 font-medium">
                            {isPickup ? "Tại Showroom" : "Giao Tận Nơi"}
                          </span>
                          {item.createdAt && (
                            <span className="text-[11px] text-stone-400 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-stone-400" />
                              Đặt lúc: {formatTimeAndDate(item.createdAt)}
                            </span>
                          )}
                        </div>

                        {/* Hàng 2: Tên khách hàng, Số điện thoại, Địa chỉ giao nếu có */}
                        <div className="flex items-center gap-2.5 flex-wrap text-xs text-ink/90">
                          <span className="font-semibold text-ink">
                            {item.customerName}
                          </span>
                          {item.customerPhone && (
                            <a
                              href={`tel:${item.customerPhone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-stone-500 hover:text-lotus flex items-center gap-1 font-mono text-[11px] transition"
                            >
                              <Phone className="w-3 h-3 text-stone-400" />
                              {item.customerPhone}
                            </a>
                          )}
                          {item.addressSnippet && (
                            <span className="text-stone-500 text-[11px] flex items-center gap-1 truncate max-w-[260px]" title={item.addressSnippet}>
                              <MapPin className="w-3 h-3 text-stone-400 shrink-0" />
                              {item.addressSnippet}
                            </span>
                          )}
                        </div>

                        {/* Hàng 3: Khung thời gian ngày bắt đầu thuê và ngày hẹn trả cụ thể */}
                        <div className="flex items-center gap-3 text-xs text-stone-600 flex-wrap bg-white/70 px-2.5 py-1 rounded-lg border border-sand/40">
                          <div className="flex items-center gap-1.5 font-medium text-[11px]">
                            <Calendar className="w-3.5 h-3.5 text-stone-400" />
                            <span className="text-stone-500">Kỳ thuê:</span>
                            <span className="text-ink font-semibold">
                              {formatDateVN(item.rentalStartDate)}
                            </span>
                            <span className="text-stone-400">→</span>
                            <span className="text-ink font-semibold">
                              {formatDateVN(item.rentalEndDate)}
                            </span>
                            <span className="text-stone-400">
                              ({calculateDays(item.rentalStartDate, item.rentalEndDate)} ngày)
                            </span>
                          </div>
                          <span className="text-stone-300">|</span>
                          <span className="text-stone-500 text-[11px]">
                            {item.itemCount} món trang phục
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (onSelectBooking) onSelectBooking(item.id);
                        else router.push(`/dashboard/staff/booking/${item.id}`);
                      }}
                      className="sm:self-center px-3 py-1.5 rounded-xl bg-white border border-sand hover:bg-sand/30 hover:border-lotus/40 text-lotus text-xs font-semibold flex items-center gap-1 shrink-0 transition"
                      title="Xem chi tiết đơn"
                    >
                      <span>Xử lý</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Cột Phải: Hàng chờ xử lý ưu tiên (Task Queue) */}
        <div className="md:col-span-5 p-5 rounded-2xl bg-white border border-sand-dark/20 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-lotus" />
              <h3 className="font-bold text-sm text-ink">Việc Cần Xử Lý Ưu Tiên</h3>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-lotus/10 text-lotus">
              {taskQueue.length} nhiệm vụ
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px] pr-1 space-y-3">
            {taskQueue.length === 0 ? (
              <div className="py-12 text-center text-ink/40">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-70" />
                <p className="text-xs">Tuyệt vời! Toàn bộ công việc vận hành đã hoàn tất.</p>
              </div>
            ) : (
              taskQueue.map((task) => {
                const priorityBadge = {
                  P0: "bg-rose-100 text-rose-800 border border-rose-300/80",
                  P1: "bg-amber-100 text-amber-800 border border-amber-300/80",
                  P2: "bg-lotus/15 text-lotus border border-lotus/30",
                  P3: "bg-stone-100 text-stone-700 border border-stone-300/80",
                }[task.priority];

                return (
                  <div
                    key={task.id}
                    className="p-3.5 rounded-xl border border-sand-dark/25 bg-white hover:border-lotus/50 hover:shadow-xs transition duration-150 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${priorityBadge} tracking-wide`}>
                        {task.priority}
                      </span>
                      <span className="text-xs font-bold text-ink flex-1 truncate">
                        {task.title}
                      </span>
                    </div>

                    <p className="text-xs text-ink/75 leading-relaxed">
                      {task.description}
                    </p>

                    <div className="pt-2 border-t border-sand/40 flex justify-end">
                      <button
                        onClick={() => {
                          if (task.targetTab === "inspection") {
                            window.location.href = "/dashboard/staff/inspection";
                          } else {
                            onSwitchTab(task.targetTab, task.targetStatus);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-lotus/10 text-lotus hover:bg-lotus hover:text-white transition shadow-2xs"
                      >
                        <span>{task.actionLabel}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
