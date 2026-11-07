"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
  X,
  XCircle,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  fetchCustomerExtensionHistory,
  type ExtensionHistoryItem,
} from "@/lib/customer-care-api";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function formatDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

type Props = {
  bookingId?: string;
  bookingCode?: string;
  onClose: () => void;
};

export function CustomerExtensionHistoryModal({ bookingId, bookingCode, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ExtensionHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCustomerExtensionHistory({
        bookingId,
        page,
        limit: 10,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });

      if (res.success && res.data) {
        setItems(res.data.items);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
      }
    } catch (err) {
      console.error("Lỗi khi tải lịch sử gia hạn:", err);
    } finally {
      setLoading(false);
    }
  }, [bookingId, page, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#881337]/10 flex items-center justify-center text-[#881337]">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                Lịch Sử Gia Hạn Thuê Cổ Phục
              </h2>
              <p className="text-xs text-stone-500">
                {bookingCode ? `Đơn thuê #${bookingCode}` : "Tất cả các lần gia hạn của bạn"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center justify-between gap-2 py-3 border-b border-stone-100">
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: "all", label: "Tất cả" },
              { key: "applied", label: "Đã gia hạn" },
              { key: "pending", label: "Chờ thanh toán" },
              { key: "expired", label: "Hết hạn" },
              { key: "cancelled", label: "Đã hủy" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setStatusFilter(f.key);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                  statusFilter === f.key
                    ? "bg-[#881337] text-white shadow-2xs"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            onClick={loadData}
            title="Làm mới"
            className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 pr-1">
          {loading ? (
            <div className="py-16 text-center text-stone-500 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#881337]" />
              <p className="text-xs">Đang tải lịch sử gia hạn...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-stone-400 space-y-2">
              <CalendarPlus className="w-8 h-8 mx-auto opacity-40 text-stone-400" />
              <p className="text-xs font-medium">Chưa có yêu cầu gia hạn nào.</p>
            </div>
          ) : (
            items.map((item) => {
              const isApplied = item.status === "applied";
              const isPending = item.status === "pending";
              const isExpired = item.status === "expired";
              const isCancelled = item.status === "cancelled";

              return (
                <div
                  key={item.id}
                  className="bg-[#FAF8F5] rounded-xl border border-stone-200/90 p-4 space-y-3 hover:border-[#881337]/30 transition shadow-2xs"
                >
                  {/* Top Bar: Code, Date, Status Badge */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-[#881337] bg-white px-2 py-0.5 rounded border border-stone-200">
                        #{item.bookingCode}
                      </span>
                      <span className="text-stone-500 font-medium">
                        {item.garmentName}
                      </span>
                    </div>

                    {isApplied ? (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Thành công
                      </span>
                    ) : isPending ? (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 text-[11px]">
                        <Clock className="w-3.5 h-3.5" /> Chờ thanh toán
                      </span>
                    ) : isExpired ? (
                      <span className="inline-flex items-center gap-1 font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full border border-stone-200 text-[11px]">
                        <XCircle className="w-3.5 h-3.5" /> Hết hạn giữ chỗ
                      </span>
                    ) : isCancelled ? (
                      <span className="inline-flex items-center gap-1 font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full border border-stone-200 text-[11px]">
                        Đã hủy
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 text-[11px]">
                        Thất bại
                      </span>
                    )}
                  </div>

                  {/* Middle Dates & Pricing */}
                  <div className="bg-white rounded-lg p-3 border border-stone-200/80 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div>
                      <span className="text-[11px] text-stone-500 block">Ngày trả trước đây</span>
                      <span className="font-semibold text-stone-700 line-through">
                        {formatDate(item.previousEndDate)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] text-stone-500 block">Hạn trả mới (+{item.extraDays} ngày)</span>
                      <span className="font-bold text-[#881337] flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-stone-400 inline" />
                        {formatDate(item.newEndDate)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] text-stone-500 block">Phí gia hạn</span>
                      <span className="font-bold text-stone-900">
                        {formatVND(item.amount)}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Meta & Action */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1 text-[11px] text-stone-500">
                    <div>
                      <span>Yêu cầu lúc: {new Date(item.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                      {item.appliedAt && (
                        <span className="ml-2 text-emerald-700 font-medium">
                          • Đã hoàn tất: {new Date(item.appliedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>

                    {isPending && item.checkoutUrl && item.isHoldActive && (
                      <a
                        href={item.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#881337] text-white font-bold hover:bg-[#6e0f2b] transition shadow-2xs"
                      >
                        Thanh toán PayOS <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer / Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-stone-200 pt-3 flex items-center justify-between text-xs text-stone-500">
            <span>
              Trang {page} / {totalPages} ({total} yêu cầu)
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 bg-stone-100 rounded border border-stone-200 disabled:opacity-40 font-semibold text-stone-700"
              >
                Trước
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 bg-stone-100 rounded border border-stone-200 disabled:opacity-40 font-semibold text-stone-700"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

