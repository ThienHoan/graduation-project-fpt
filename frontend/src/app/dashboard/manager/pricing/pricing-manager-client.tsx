"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  approvePricingSuggestion,
  bulkPricingSuggestionAction,
  createPricingCalendar,
  createPricingSuggestion,
  deactivatePricingPeriod,
  deactivatePricingSuggestion,
  generatePricingSuggestions,
  getGarmentsGrouped,
  getPricingCalendar,
  getPricingCalendarTargetOptions,
  getPricingPeriods,
  getPricingSuggestions,
  rejectPricingSuggestion,
  removePricingCalendar,
  updatePricingCalendar,
  updatePricingSuggestionPrice,
  type GenerateSuggestionsResult,
  type PriceCalendarEntry,
  type PricePeriodEntry,
  type PriceSuggestionEntry,
  type PricingCalendarTargetOptions,
} from "@/lib/api";
import { ConfirmModal } from "@/components/heritage/ui";
import { statusBadgeClass } from "@/lib/status-labels";
import { PriceRulesTab } from "./price-rules-tab";
import {
  CheckCircle2,
  AlertCircle,
  Search,
  Sparkles,
  Calendar,
  Lightbulb,
  TrendingUp,
  Plus,
  RefreshCw,
  Check,
  X,
  Pencil,
  Eye,
  EyeOff,
  type LucideIcon,
} from "lucide-react";

const OCCASION_LABELS: Record<string, string> = {
  holiday: "Ngày lễ",
  occasion: "Dịp đặc biệt",
  peak_season: "Mùa cao điểm",
  off_season: "Mùa thấp điểm",
};

const OCCASION_OPTIONS = Object.entries(OCCASION_LABELS).map(([value, label]) => ({ value, label }));

const SUGGESTION_STATUS_LABELS: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  deactivated: "Vô hiệu hóa",
};

const SUGGESTION_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-jade/10 text-jade",
  rejected: "bg-red-50 text-red-600",
  deactivated: "bg-stone-100 text-stone-500",
};

const PERIOD_SOURCE_LABELS: Record<string, string> = {
  base: "Giá cơ sở",
  ai_suggestion: "AI đề xuất",
};

function formatVND(n: number) {
  return `${Math.round(n).toLocaleString("vi-VN")}đ`;
}

function formatDateRange(from: string, to: string) {
  const fmt = (d: string) => new Date(d).toLocaleDateString("vi-VN");
  return `${fmt(from)} → ${fmt(to)}`;
}

function reasonSummary(reason: Record<string, unknown>): string {
  if (!reason || typeof reason !== "object") return "";
  const parts: string[] = [];
  for (const [key, label] of [
    ["demand", "Nhu cầu"],
    ["booking", "Đặt trước"],
    ["inventory", "Kho"],
    ["holiday", "Dịp lễ"],
    ["season", "Mùa"],
  ] as const) {
    if (key in reason && typeof reason[key] === "string") parts.push(`${label} ${reason[key]}`);
  }
  if ("summary" in reason && typeof reason.summary === "string") parts.push(reason.summary);
  return parts.join(" · ");
}

type Toast = { kind: "success" | "error"; message: string } | null;

function useToasts(clearMs = 5000) {
  const [toast, setToast] = useState<Toast>(null);
  const show = useCallback((kind: "success" | "error", message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), clearMs);
  }, [clearMs]);
  return { toast, show };
}

function ToastView({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div
      className={`fixed right-6 top-20 z-[120] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border animate-slide-in ${toast.kind === "success" ? "bg-jade/5 text-jade border-jade/30" : "bg-red-50 text-red-700 border-red-200"
        }`}
    >
      {toast.kind === "success" ? (
        <CheckCircle2 className="h-5 w-5 shrink-0" />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0" />
      )}
      <span>{toast.message}</span>
    </div>
  );
}

type DateFilter = { search: string; from: string; to: string };

const EMPTY_FILTER: DateFilter = { search: "", from: "", to: "" };

const filterInputClass =
  "rounded-lg border border-sand px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30";

function PricingFilterBar({
  draft,
  setDraft,
  onApply,
  onClear,
  placeholder = "Tìm kiếm...",
}: {
  draft: DateFilter;
  setDraft: (f: DateFilter) => void;
  onApply: () => void;
  onClear: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-stone-500">Tìm kiếm</label>
        <input
          type="text"
          value={draft.search}
          onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onApply(); }}
          placeholder={placeholder}
          className={`${filterInputClass} w-56`}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-stone-500">Từ ngày</label>
        <input
          type="date"
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          className={filterInputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-stone-500">Đến ngày</label>
        <input
          type="date"
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          className={filterInputClass}
        />
      </div>
      <button
        type="button"
        onClick={onApply}
        className="inline-flex items-center gap-1.5 rounded-lg bg-lotus px-3 py-2 text-sm font-semibold text-white transition hover:bg-oxblood"
      >
        <Search className="h-4 w-4" />
        Tìm
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-sand px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-red-300 hover:text-red-600"
      >
        Xóa lọc
      </button>
    </div>
  );
}

function PaginationRow({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between text-sm text-stone-600">
      <span>{total} mục</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border border-sand px-3 py-1.5 font-semibold disabled:opacity-40"
        >
          Trước
        </button>
        <span className="px-2 py-1.5">Trang {page}</span>
        <button
          type="button"
          disabled={page * pageSize >= total}
          onClick={() => onPage(page + 1)}
          className="rounded-lg border border-sand px-3 py-1.5 font-semibold disabled:opacity-40"
        >
          Sau
        </button>
      </div>
    </div>
  );
}

type PricingTab = "rules" | "calendar" | "suggestions" | "periods";

export function PricingManagerClient() {
  const [tab, setTab] = useState<PricingTab>("rules");
  const { toast, show } = useToasts();

  const tabs: Array<{ key: PricingTab; label: string; icon: LucideIcon }> = [
    { key: "rules", label: "Luật giá tự động", icon: Sparkles },
    { key: "calendar", label: "Lịch sự kiện", icon: Calendar },
    { key: "suggestions", label: "Đề xuất giá", icon: Lightbulb },
    { key: "periods", label: "Khoảng giá hiệu lực", icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-sand pb-3">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${tab === t.key ? "bg-lotus text-white shadow" : "bg-white text-stone-600 border border-sand hover:border-lotus hover:text-lotus"
                }`}
            >
              <TabIcon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "rules" && <PriceRulesTab showToast={show} />}
      {tab === "calendar" && <CalendarTab showToast={show} />}
      {tab === "suggestions" && <SuggestionsTab showToast={show} />}
      {tab === "periods" && <PeriodsTab showToast={show} />}

      <ToastView toast={toast} />
    </div>
  );
}

// ── Lịch sự kiện (price_calendar) ─────────────────────────────────────────────

function CalendarTab({ showToast }: { showToast: (k: "success" | "error", m: string) => void }) {
  const PAGE_SIZE = 50;
  const [events, setEvents] = useState<PriceCalendarEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<DateFilter>(EMPTY_FILTER);
  const [draft, setDraft] = useState<DateFilter>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const [modal, setModal] = useState<{ open: boolean; editing: PriceCalendarEntry | null }>({ open: false, editing: null });
  const [hideTarget, setHideTarget] = useState<PriceCalendarEntry | null>(null);
  const [pendingBlock, setPendingBlock] = useState<{
    event: PriceCalendarEntry;
    total: number;
    items: PriceSuggestionEntry[];
  } | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [generateResult, setGenerateResult] = useState<{ eventName: string; result: GenerateSuggestionsResult } | null>(null);

  // Đồng hồ đếm giây khi sinh đề xuất: giúp phân biệt "đang chạy" với "treo".
  // Dùng ref giữ interval id để luôn cleanup chắc chắn, tránh nhiều interval
  // chồng nhau khiến đồng hồ vẫn tăng sau khi đã có kết quả.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, [stopTimer]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPricingCalendar({
      includeInactive: showInactive || undefined,
      search: filter.search || undefined,
      from: filter.from || undefined,
      to: filter.to || undefined,
      page,
      limit: PAGE_SIZE,
    });
    if (res.success && res.data) {
      setEvents(res.data.items);
      setTotal(res.data.total);
    } else {
      showToast("error", res.message || "Không thể tải lịch sự kiện");
    }
    setLoading(false);
  }, [showInactive, filter, page, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async (evt: PriceCalendarEntry) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setGenerating(evt.id);
    startTimer();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000);

    let res: Awaited<ReturnType<typeof generatePricingSuggestions>>;
    try {
      res = await generatePricingSuggestions({ calendarId: evt.id }, controller.signal);
    } catch (err) {
      // Abort do timeout → backend đã bỏ dở; các lỗi khác (mất mạng) backend vẫn
      // có thể đã tạo xong đề xuất.
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      showToast(
        "error",
        timedOut
          ? "Sinh đề xuất quá lâu (quá 180 giây). Vui lòng thử lại."
          : "Mất kết nối khi sinh đề xuất. Kiểm tra lại tab Đề xuất giá.",
      );
      return;
    } finally {
      clearTimeout(timeoutId);
      stopTimer();
      setGenerating(null);
      inFlightRef.current = false;
    }

    if (res.success && res.data) {
      setGenerateResult({ eventName: evt.name, result: res.data });
      const created = res.data.generated ?? 0;
      showToast(
        "success",
        created > 0
          ? `Đã tạo ${created} đề xuất cho "${evt.name}". Xem ở tab Đề xuất giá.`
          : `Không có đề xuất mới cho "${evt.name}".`,
      );
    } else {
      showToast("error", res.message || "Không thể sinh đề xuất");
    }
  };

  const fetchAllPendingIds = useCallback(
    async (calendarId: string): Promise<string[]> => {
      const ids: string[] = [];
      let currentPage = 1;
      for (; ;) {
        const res = await getPricingSuggestions({
          calendarId,
          status: "pending",
          page: currentPage,
          limit: 100,
        });
        if (!res.success || !res.data) break;
        ids.push(...res.data.items.map((i) => i.id));
        if (res.data.items.length === 0 || ids.length >= res.data.total) break;
        currentPage += 1;
      }
      return ids;
    },
    [],
  );

  const handleToggleVisibility = async (evt: PriceCalendarEntry, nextActive: boolean) => {
    if (visibilityBusy) return;

    if (nextActive) {
      setVisibilityBusy(true);
      const res = await updatePricingCalendar(evt.id, { isActive: true });
      setVisibilityBusy(false);
      if (res.success) {
        showToast("success", `Đã hiện sự kiện "${evt.name}"`);
        load();
      } else {
        showToast("error", res.message || "Không thể hiện sự kiện");
      }
      return;
    }

    // Ẩn: kiểm tra đề xuất đang chờ duyệt trước.
    setVisibilityBusy(true);
    const res = await getPricingSuggestions({
      calendarId: evt.id,
      status: "pending",
      page: 1,
      limit: 100,
    });
    setVisibilityBusy(false);
    if (!res.success || !res.data) {
      showToast("error", res.message || "Không thể kiểm tra đề xuất chờ duyệt");
      return;
    }
    if (res.data.total > 0) {
      setPendingBlock({ event: evt, total: res.data.total, items: res.data.items });
    } else {
      setHideTarget(evt);
    }
  };

  const handleHide = async () => {
    if (!hideTarget) return;
    setVisibilityBusy(true);
    const res = await removePricingCalendar(hideTarget.id);
    setVisibilityBusy(false);
    setHideTarget(null);
    if (res.success) {
      showToast("success", `Đã ẩn sự kiện "${hideTarget.name}"`);
      load();
    } else {
      showToast("error", res.message || "Không thể ẩn sự kiện");
    }
  };

  const handleRejectAllAndHide = async () => {
    if (!pendingBlock) return;
    setVisibilityBusy(true);
    const ids = await fetchAllPendingIds(pendingBlock.event.id);
    if (ids.length === 0) {
      setVisibilityBusy(false);
      setPendingBlock(null);
      showToast("error", "Không còn đề xuất chờ duyệt. Vui lòng thử ẩn lại.");
      return;
    }
    const rejectRes = await bulkPricingSuggestionAction(ids, "reject");
    if (!rejectRes.success || !rejectRes.data) {
      setVisibilityBusy(false);
      showToast("error", rejectRes.message || "Không thể từ chối đề xuất");
      return;
    }
    if (rejectRes.data.failureCount > 0) {
      setVisibilityBusy(false);
      showToast(
        "error",
        `Đã từ chối ${rejectRes.data.successCount}/${ids.length} đề xuất. ${rejectRes.data.failed
          .map((f) => f.reason)
          .join("; ")}`,
      );
      return;
    }
    const hideRes = await removePricingCalendar(pendingBlock.event.id);
    setVisibilityBusy(false);
    if (hideRes.success) {
      const name = pendingBlock.event.name;
      setPendingBlock(null);
      showToast("success", `Đã từ chối ${ids.length} đề xuất và ẩn sự kiện "${name}"`);
      load();
    } else {
      showToast("error", hideRes.message || "Đã từ chối đề xuất nhưng chưa ẩn được sự kiện");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
            />
            Hiện sự kiện đã tắt
          </label>
        </div>
        <button
          type="button"
          onClick={() => setModal({ open: true, editing: null })}
          className="inline-flex items-center gap-2 rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood"
        >
          <Plus className="h-4 w-4" />
          Thêm sự kiện
        </button>
      </div>

      <PricingFilterBar
        draft={draft}
        setDraft={setDraft}
        onApply={() => { setFilter(draft); setPage(1); }}
        onClear={() => { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER); setPage(1); }}
        placeholder="Tìm sự kiện..."
      />

      {loading ? (
        <div className="rounded-xl border border-sand bg-white p-10 text-center text-sm text-stone-500">Đang tải...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sand bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-sand text-xs font-bold text-stone-600 uppercase tracking-wider">
                <th className="py-3 px-4">Sự kiện</th>
                <th className="py-3 px-4">Loại dịp</th>
                <th className="py-3 px-4">Khoảng ngày</th>
                <th className="py-3 px-4 text-right">Điều chỉnh</th>
                <th className="py-3 px-4">Phạm vi áp dụng</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/40 text-sm">
              {events.map((evt) => (
                <tr key={evt.id} className="hover:bg-warm-ivory/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-ink">{evt.name}</div>
                    {evt.note && <div className="text-xs text-stone-500">{evt.note}</div>}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded bg-lotus/10 text-lotus">
                      {OCCASION_LABELS[evt.occasionType] ?? evt.occasionType}
                    </span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{formatDateRange(evt.fromDate, evt.toDate)}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {evt.adjustmentPercent > 0 ? (
                      <span className="font-semibold text-red-600">+{evt.adjustmentPercent}%</span>
                    ) : evt.adjustmentPercent < 0 ? (
                      <span className="font-semibold text-jade">{evt.adjustmentPercent}%</span>
                    ) : (
                      <span className="text-stone-400">0%</span>
                    )}
                    <div className="text-xs text-stone-500">Ưu tiên {evt.priority}</div>
                  </td>
                  <td className="py-3 px-4">
                    {evt.applyAll ? (
                      <span className="inline-flex items-center rounded bg-jade/10 px-2 py-0.5 text-xs font-semibold text-jade">
                        Tất cả sản phẩm
                      </span>
                    ) : evt.targetGarmentIds.length > 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 font-semibold">
                        Sản phẩm ({evt.targetGarmentIds.length})
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400">Chưa chọn sản phẩm</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={statusBadgeClass(evt.isActive ? "bg-jade/10 text-jade" : "bg-stone-100 text-stone-500")}>
                      {evt.isActive ? "Đang bật" : "Đã tắt"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleGenerate(evt)}
                        disabled={generating !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {generating === evt.id ? `Đang sinh… ${elapsed}s` : "Sinh đề xuất"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ open: true, editing: evt })}
                        className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                      >
                        Sửa
                      </button>
                      {evt.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleToggleVisibility(evt, false)}
                          disabled={visibilityBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          Ẩn
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleVisibility(evt, true)}
                          disabled={visibilityBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-jade/40 bg-jade/5 px-3 py-1.5 text-xs font-semibold text-jade transition hover:bg-jade/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Hiện
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-stone-500">
                    Chưa có sự kiện nào. Hãy thêm sự kiện (ngày lễ, cao điểm...) để AI đề xuất điều chỉnh giá.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PaginationRow total={total} page={page} pageSize={PAGE_SIZE} onPage={setPage} />

      {modal.open && (
        <CalendarFormModal
          editing={modal.editing}
          onClose={() => setModal({ open: false, editing: null })}
          onSaved={(msg) => {
            setModal({ open: false, editing: null });
            showToast("success", msg);
            load();
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}

      <ConfirmModal
        open={!!hideTarget}
        title="Ẩn sự kiện"
        message={`Sự kiện "${hideTarget?.name}" sẽ được ẩn . Bạn có thể bật lại bằng nút "Hiện" ở mục "Hiện sự kiện đã tắt". Đề xuất đã duyệt vẫn giữ nguyên. Tiếp tục?`}
        confirmLabel="Ẩn"
        cancelLabel="Hủy"
        onConfirm={handleHide}
        onCancel={() => setHideTarget(null)}
      />

      {pendingBlock && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-sand bg-white p-6 shadow-xl">
            <h3 className="font-display text-2xl text-ink">Không thể ẩn sự kiện</h3>
            <p className="mt-1 text-sm text-stone-600">
              Sự kiện <strong>{pendingBlock.event.name}</strong> còn{" "}
              <strong className="text-red-600">{pendingBlock.total} đề xuất chờ duyệt</strong> cần
              từ chối trước khi ẩn.
            </p>

            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-sand bg-stone-50 p-2">
              {pendingBlock.items.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md bg-white px-3 py-2 text-xs text-stone-600 shadow-sm"
                >
                  <div className="font-semibold text-stone-700">
                    {s.garmentName ?? "Không rõ sản phẩm"}
                    {s.sizeLabel ? ` · size ${s.sizeLabel}` : ""}
                  </div>
                  <div className="text-stone-400">
                    {formatDateRange(s.fromDate, s.toDate)} · {formatVND(s.validPrice)}
                  </div>
                </div>
              ))}
              {pendingBlock.total > pendingBlock.items.length && (
                <p className="px-1 text-xs text-stone-500">
                  … và {pendingBlock.total - pendingBlock.items.length} đề xuất khác.
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingBlock(null)}
                disabled={visibilityBusy}
                className="rounded-lg border border-sand px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus disabled:opacity-50"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={handleRejectAllAndHide}
                disabled={visibilityBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                {visibilityBusy ? "Đang xử lý..." : "Từ chối tất cả rồi ẩn"}
              </button>
            </div>
          </div>
        </div>
      )}

      {generateResult && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-sand bg-white p-6 shadow-xl">
            <h3 className="font-display text-2xl text-ink">Kết quả sinh đề xuất</h3>
            <p className="mt-2 text-sm text-stone-600">
              Sự kiện <span className="font-semibold">{generateResult.eventName}</span> — tạo được{" "}
              <span className="font-semibold text-lotus">{generateResult.result.generated}</span> đề xuất.
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Đề xuất mới nằm ở tab <span className="font-semibold">Đề xuất giá</span> với trạng thái Chờ duyệt.
            </p>
            {generateResult.result.skipped.length > 0 && (
              <div className="mt-4 max-h-60 overflow-y-auto rounded-lg border border-sand bg-stone-50 p-3 space-y-2">
                {generateResult.result.skipped.map((s, i) => (
                  <div key={i} className="text-xs text-stone-600">
                    {s.sizeId ? (
                      <span>
                        <span className="font-semibold">{s.garmentName ?? s.sizeId}</span>
                        {s.sizeLabel && <span> · Size {s.sizeLabel}</span>}
                        {s.garmentName && <span className="text-stone-400"> ({s.sizeId})</span>}: {s.error}
                      </span>
                    ) : (
                      <span>{s.note}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setGenerateResult(null)}
                className="rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Form sự kiện (create / edit) ──────────────────────────────────────────────

function ScopeCheckboxList({
  title,
  emptyLabel,
  items,
  selected,
  onToggle,
}: {
  title: string;
  emptyLabel: string;
  items: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-stone-400">{emptyLabel}</p>
      ) : (
        <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-sand bg-white p-2 sm:grid-cols-2">
          {items.map((item) => (
            <label
              key={item.value}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-stone-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.value)}
                onChange={() => onToggle(item.value)}
                className="mt-0.5 h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
              />
              <span className="min-w-0 truncate text-stone-700">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarFormModal({
  editing,
  onClose,
  onSaved,
  onError,
}: {
  editing: PriceCalendarEntry | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    name: editing?.name ?? "",
    occasionType: editing?.occasionType ?? "holiday",
    fromDate: editing?.fromDate ?? "",
    toDate: editing?.toDate ?? "",
    adjustmentPercent: editing?.adjustmentPercent?.toString() ?? "0",
    priority: editing?.priority?.toString() ?? "0",
    applyAll: editing?.applyAll ?? true,
    isActive: editing?.isActive ?? true,
    note: editing?.note ?? "",
  });
  // Danh mục / dịp chỉ là bộ lọc để tự tick sản phẩm, KHÔNG lưu vào sự kiện.
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [filterOccasions, setFilterOccasions] = useState<string[]>([]);
  // Sản phẩm cuối cùng được chọn = phạm vi điều chỉnh giá (nguồn chân lý duy nhất).
  const [manualAdds, setManualAdds] = useState<string[]>(
    editing?.targetGarmentIds ?? [],
  );
  const [manualRemoves, setManualRemoves] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<PricingCalendarTargetOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [garmentQuery, setGarmentQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPricingCalendarTargetOptions()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setOptions(res.data);
        } else {
          setOptionsError(res.message || "Không thể tải danh sách sản phẩm.");
        }
      })
      .catch(() => {
        if (!cancelled) setOptionsError("Không thể tải danh sách sản phẩm.");
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const toggleFilter = (
    key: "category" | "occasion",
    value: string,
  ) => {
    const updater = (list: string[]) =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    if (key === "category") setFilterCategoryIds(updater);
    else setFilterOccasions(updater);
  };

  const allGarments = options?.garments ?? [];
  const normalizedQuery = garmentQuery.trim().toLowerCase();
  const filteredGarments = normalizedQuery
    ? allGarments.filter((g) =>
      [g.name, g.categoryName ?? "", ...g.occasions]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    )
    : allGarments;

  // Bộ lọc nào cũng rỗng → chưa tự tick gì. Có ít nhất 1 bộ lọc → AND giữa
  // (các danh mục đã tích) và (các dịp đã tích).
  const hasFilter = filterCategoryIds.length > 0 || filterOccasions.length > 0;
  const autoMatchedGarments = hasFilter
    ? allGarments.filter((g) => {
      const categoryOk =
        filterCategoryIds.length === 0 ||
        (g.categoryId ? filterCategoryIds.includes(g.categoryId) : false);
      const occasionOk =
        filterOccasions.length === 0 ||
        g.occasions.some((o) =>
          filterOccasions.some(
            (t) => t.trim().toLowerCase() === o.trim().toLowerCase(),
          ),
        );
      return categoryOk && occasionOk;
    })
    : [];

  // Sản phẩm cuối = (autoMatched \ manualRemoves) ∪ manualAdds.
  const selectedGarments = allGarments.filter((g) => {
    const auto = autoMatchedGarments.some((a) => a.id === g.id);
    if (manualRemoves.includes(g.id)) return false;
    return auto || manualAdds.includes(g.id);
  });
  const selectedGarmentIds = selectedGarments.map((g) => g.id);
  const matchedSizeCount = selectedGarments.reduce((sum, g) => sum + g.sizeCount, 0);

  const toggleGarment = (id: string) => {
    const isSelected = selectedGarmentIds.includes(id);
    if (isSelected) {
      setManualAdds((prev) => prev.filter((v) => v !== id));
      setManualRemoves((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } else {
      setManualRemoves((prev) => prev.filter((v) => v !== id));
      setManualAdds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "Vui lòng nhập tên sự kiện.";
    if (!form.fromDate) newErrors.fromDate = "Chọn ngày bắt đầu.";
    if (!form.toDate) newErrors.toDate = "Chọn ngày kết thúc.";
    if (form.fromDate && form.toDate && form.toDate < form.fromDate) newErrors.toDate = "Ngày kết thúc phải sau ngày bắt đầu.";
    const pct = Number(form.adjustmentPercent);
    if (Number.isNaN(pct) || pct < -100) newErrors.adjustmentPercent = "Phần trăm không hợp lệ (tối thiểu -100).";
    if (!form.applyAll && selectedGarmentIds.length === 0) {
      newErrors.scope = "Chọn ít nhất một sản phẩm — hoặc bật “Tất cả sản phẩm”.";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      occasionType: form.occasionType,
      fromDate: form.fromDate,
      toDate: form.toDate,
      adjustmentPercent: pct,
      priority: Number(form.priority) || 0,
      applyAll: form.applyAll,
      targetGarmentIds: form.applyAll ? [] : selectedGarmentIds,
      isActive: form.isActive,
      note: form.note.trim() || undefined,
    };

    const res = editing
      ? await updatePricingCalendar(editing.id, payload)
      : await createPricingCalendar(payload);
    setSaving(false);
    if (res.success) {
      onSaved(editing ? `Đã cập nhật sự kiện "${payload.name}"` : `Đã tạo sự kiện "${payload.name}"`);
    } else {
      onError(res.message || "Không thể lưu sự kiện");
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full rounded-lg border ${hasError ? "border-red-500" : "border-sand"} px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl border border-sand bg-white shadow-2xl overflow-hidden animate-zoom-in">
        <header className="flex items-center justify-between border-b border-sand bg-warm-ivory px-6 py-4">
          <h3 className="font-display text-2xl text-ink">{editing ? "Sửa sự kiện" : "Thêm sự kiện"}</h3>
          <button type="button" onClick={onClose} className="text-stone-500 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
          <div>
            <label className="mb-1 block text-sm font-semibold text-stone-700">Tên sự kiện *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="VD: Tết Nguyên Đán, Kỷ yếu cuối khóa..."
              className={inputClass(!!errors.name)}
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Loại dịp *</label>
              <select
                value={form.occasionType}
                onChange={(e) => set("occasionType", e.target.value)}
                className={inputClass(false)}
              >
                {OCCASION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Điều chỉnh (%)</label>
              <input
                type="number"
                value={form.adjustmentPercent}
                onChange={(e) => set("adjustmentPercent", e.target.value)}
                className={inputClass(!!errors.adjustmentPercent)}
              />
              {errors.adjustmentPercent && <p className="mt-1 text-xs text-red-500">{errors.adjustmentPercent}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Từ ngày *</label>
              <input
                type="date"
                value={form.fromDate}
                onChange={(e) => set("fromDate", e.target.value)}
                className={inputClass(!!errors.fromDate)}
              />
              {errors.fromDate && <p className="mt-1 text-xs text-red-500">{errors.fromDate}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Đến ngày *</label>
              <input
                type="date"
                value={form.toDate}
                onChange={(e) => set("toDate", e.target.value)}
                className={inputClass(!!errors.toDate)}
              />
              {errors.toDate && <p className="mt-1 text-xs text-red-500">{errors.toDate}</p>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-stone-700">Ưu tiên</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
              className={inputClass(false)}
            />
            <p className="mt-1 text-xs text-stone-400">Số càng lớn ưu tiên càng cao.</p>
          </div>

          <div className="rounded-xl border border-sand bg-stone-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-700">Phạm vi áp dụng *</p>
              <span className="text-xs text-stone-500">
                {form.applyAll
                  ? "Tất cả sản phẩm đang hoạt động"
                  : `${selectedGarments.length} sản phẩm · ${matchedSizeCount} size`}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                <input
                  type="radio"
                  checked={form.applyAll}
                  onChange={() => set("applyAll", true)}
                  className="h-4 w-4 border-sand text-lotus focus:ring-lotus"
                />
                Tất cả sản phẩm
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                <input
                  type="radio"
                  checked={!form.applyAll}
                  onChange={() => set("applyAll", false)}
                  className="h-4 w-4 border-sand text-lotus focus:ring-lotus"
                />
                Chọn theo danh mục, dịp hoặc sản phẩm cụ thể
              </label>
            </div>

            {!form.applyAll && (
              <div className="mt-3 space-y-3">
                {optionsError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {optionsError}
                  </p>
                )}

                <p className="text-xs text-stone-500">
                  Tích danh mục và/hoặc dịp để tự động tick sản phẩm phù hợp (danh mục
                  và dịp kết hợp theo kiểu VÀ). Sau đó có thể tick thêm hoặc bỏ tick
                  từng sản phẩm bên dưới.
                </p>

                <ScopeCheckboxList
                  title="Lọc theo danh mục"
                  emptyLabel="Chưa có danh mục nào."
                  items={(options?.categories ?? []).map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  selected={filterCategoryIds}
                  onToggle={(v) => toggleFilter("category", v)}
                />

                <ScopeCheckboxList
                  title="Lọc theo dịp"
                  emptyLabel="Chưa có dịp nào."
                  items={(options?.occasions ?? []).map((o) => ({
                    value: o,
                    label: o,
                  }))}
                  selected={filterOccasions}
                  onToggle={(v) => toggleFilter("occasion", v)}
                />

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                      Sản phẩm cụ thể
                    </p>
                    {selectedGarmentIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setManualAdds([]);
                          setManualRemoves(allGarments.map((g) => g.id));
                          setFilterCategoryIds([]);
                          setFilterOccasions([]);
                        }}
                        className="text-xs font-semibold text-lotus hover:underline"
                      >
                        Bỏ chọn toàn bộ
                      </button>
                    )}
                  </div>
                  <input
                    value={garmentQuery}
                    onChange={(e) => setGarmentQuery(e.target.value)}
                    placeholder="Tìm theo tên, danh mục, dịp..."
                    className="mb-1.5 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-lotus"
                  />
                  {optionsLoading ? (
                    <p className="text-xs text-stone-400">Đang tải sản phẩm...</p>
                  ) : filteredGarments.length === 0 ? (
                    <p className="text-xs text-stone-400">
                      Không tìm thấy sản phẩm phù hợp.
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-sand bg-white p-2">
                      {filteredGarments.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-stone-50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedGarmentIds.includes(g.id)}
                            onChange={() => toggleGarment(g.id)}
                            className="mt-0.5 h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-stone-700">
                              {g.sizeLabels.length === 1
                                ? `${g.name} size ${g.sizeLabels[0]}`
                                : g.sizeLabels.length > 1
                                  ? `${g.name} · ${g.sizeCount} size`
                                  : g.name}
                            </span>
                            <span className="block text-[11px] text-stone-400">
                              {[g.categoryName ?? "Chưa phân loại", ...g.occasions].join(" · ")}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {errors.scope && <p className="text-xs text-red-500">{errors.scope}</p>}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-stone-700">Ghi chú</label>
            <textarea
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              rows={2}
              className={inputClass(false)}
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
              className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
            />
            Kích hoạt sự kiện
          </label>

          <div className="flex justify-end gap-3 border-t border-sand pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50">
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo sự kiện"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Đề xuất giá (price_suggestions) ───────────────────────────────────────────

const SUGGESTION_FILTERS = [
  { key: "", label: "Tất cả" },
  { key: "pending", label: "Chờ duyệt" },
  { key: "approved", label: "Đã duyệt" },
  { key: "rejected", label: "Từ chối" },
  { key: "deactivated", label: "Vô hiệu hóa" },
] as const;

function SuggestionsTab({ showToast }: { showToast: (k: "success" | "error", m: string) => void }) {
  const [items, setItems] = useState<PriceSuggestionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<DateFilter>(EMPTY_FILTER);
  const [draftFilter, setDraftFilter] = useState<DateFilter>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "approve" | "reject" | "deactivate" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PriceSuggestionEntry | null>(null);

  const PAGE_SIZE = 10;

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPricingSuggestions({
      status: filter || undefined,
      search: dateFilter.search || undefined,
      from: dateFilter.from || undefined,
      to: dateFilter.to || undefined,
      page,
      limit: PAGE_SIZE,
    });
    if (res.success && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
    } else {
      showToast("error", res.message || "Không thể tải đề xuất");
    }
    setLoading(false);
  }, [filter, dateFilter, page, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async () => {
    if (!actionTarget) return;
    setBusy(true);
    const res =
      actionTarget.action === "approve"
        ? await approvePricingSuggestion(actionTarget.id)
        : actionTarget.action === "reject"
          ? await rejectPricingSuggestion(actionTarget.id)
          : await deactivatePricingSuggestion(actionTarget.id);
    setBusy(false);
    setActionTarget(null);
    if (res.success) {
      showToast(
        "success",
        actionTarget.action === "approve"
          ? "Đã duyệt đề xuất — tạo price period"
          : actionTarget.action === "reject"
            ? "Đã từ chối đề xuất"
            : "Đã vô hiệu hóa đề xuất — tắt price period cũ",
      );
      load();
    } else {
      showToast("error", res.message || "Thao tác thất bại");
    }
  };

  const handleBulk = async () => {
    if (!bulkAction || selected.size === 0) return;
    setBusy(true);
    const res = await bulkPricingSuggestionAction([...selected], bulkAction);
    setBusy(false);
    setBulkAction(null);
    setSelected(new Set());
    if (res.success && res.data) {
      const total = res.data.successCount + res.data.failureCount;
      if (res.data.failureCount === 0) {
        showToast("success", `Đã ${bulkAction === "approve" ? "duyệt" : "từ chối"} ${total} đề xuất`);
      } else {
        showToast(
          "error",
          `Đã ${bulkAction === "approve" ? "duyệt" : "từ chối"} ${res.data.successCount}/${total} đề xuất. ${res.data.failed.map((f) => f.reason).join("; ")}`,
        );
      }
      load();
    } else {
      showToast("error", res.message || "Không thể xử lý hàng loạt");
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pageIds = items.map((s) => s.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const clearSelection = () => setSelected(new Set());

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {SUGGESTION_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setPage(1); clearSelection(); }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === f.key ? "bg-lotus text-white" : "bg-white border border-sand text-stone-600 hover:border-lotus"
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood"
          >
            <Plus className="h-4 w-4" />
            Tạo đề xuất
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
          >
            <RefreshCw className="h-4 w-4" />
            Nạp lại
          </button>
        </div>
      </div>

      <PricingFilterBar
        draft={draftFilter}
        setDraft={setDraftFilter}
        onApply={() => { setDateFilter(draftFilter); setPage(1); clearSelection(); }}
        onClear={() => { setDraftFilter(EMPTY_FILTER); setDateFilter(EMPTY_FILTER); setPage(1); clearSelection(); }}
        placeholder="Tìm sản phẩm / size / tên sự kiện..."
      />

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lotus/30 bg-lotus/5 px-4 py-3">
          <span className="text-sm font-semibold text-ink">Đã chọn {selected.size} đề xuất</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkAction("approve")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-jade px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5" />
              Duyệt đã chọn
            </button>
            <button
              type="button"
              onClick={() => setBulkAction("reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
              Từ chối đã chọn
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-sand px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
            >
              Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-sand bg-white p-10 text-center text-sm text-stone-500">Đang tải...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sand bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-sand text-xs font-bold text-stone-600 uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set([...selected, ...pageIds]));
                      else setSelected(new Set([...selected].filter((id) => !pageIds.includes(id))));
                    }}
                    className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
                  />
                </th>
                <th className="py-3 px-4">Trang phục</th>
                <th className="py-3 px-4">Khoảng ngày</th>
                <th className="py-3 px-4 text-right">Giá hiện tại</th>
                <th className="py-3 px-4 text-right">Đề xuất</th>
                <th className="py-3 px-4 text-right">Khoảng cho phép</th>
                <th className="py-3 px-4">Tín hiệu</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/40 text-sm">
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-warm-ivory/30 transition-colors align-top">
                  <td className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-ink">{s.garmentName ?? s.garmentId}</div>
                    <div className="text-xs text-stone-500">Size {s.sizeLabel ?? "—"} {s.calendarName ? `· ${s.calendarName}` : ""}</div>
                    <span className={`mt-1 inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${s.source === "owner" ? "bg-amber-100 text-amber-700" : "bg-sky-50 text-sky-700"
                      }`}>
                      {s.source === "owner" ? "Chủ shop" : "AI đề xuất"}
                    </span>
                    {s.reason && reasonSummary(s.reason) && (
                      <div className="mt-1 text-xs italic text-stone-500">{reasonSummary(s.reason)}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{formatDateRange(s.fromDate, s.toDate)}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">{formatVND(s.basePrice)}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className={`font-bold ${s.validPrice >= s.basePrice ? "text-red-600" : "text-jade"}`}>
                      {formatVND(s.validPrice)}
                    </div>
                    <div className="text-xs text-stone-500">
                      {s.recommendedAdjustmentPct >= 0 ? "+" : ""}{s.recommendedAdjustmentPct}%
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="text-xs text-stone-500">{formatVND(s.minPrice)} → {formatVND(s.maxPrice)}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-xs text-stone-600">
                      Nhu cầu {s.demandPressure != null ? `${Math.round(s.demandPressure * 100)}%` : "—"} · Đặt trước {s.bookingPressure != null ? `${Math.round(s.bookingPressure * 100)}%` : "—"}
                    </div>
                    {s.calendarName && (
                      <div className="mt-0.5 text-xs text-lotus">
                        Dịp lễ: {s.calendarName}
                      </div>
                    )}
                    <div className="text-xs text-stone-400">Tin cậy {s.confidence != null ? `${Math.round(s.confidence * 100)}%` : "—"}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={statusBadgeClass(SUGGESTION_STATUS_COLORS[s.status])}>
                      {SUGGESTION_STATUS_LABELS[s.status]}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      {s.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditTarget(s)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Sửa giá
                          </button>
                          <button
                            type="button"
                            onClick={() => setActionTarget({ id: s.id, action: "approve" })}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-jade/10 px-3 py-1.5 text-xs font-semibold text-jade transition hover:bg-jade/20"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Duyệt
                          </button>
                          <button
                            type="button"
                            onClick={() => setActionTarget({ id: s.id, action: "reject" })}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                      {s.status === "approved" && (
                        <button
                          type="button"
                          onClick={() => setActionTarget({ id: s.id, action: "deactivate" })}
                          className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-warm-ivory hover:text-oxblood"
                        >
                          Vô hiệu hóa
                        </button>
                      )}
                      {(s.status === "rejected" || s.status === "deactivated") && <span className="text-xs text-stone-400">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-stone-500">
                    Chưa có đề xuất nào. Vào tab “Lịch sự kiện” và bấm “Sinh đề xuất” cho một sự kiện.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-stone-600">
          <span>{total} đề xuất</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-sand px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Trước
            </button>
            <span className="px-2 py-1.5">Trang {page}</span>
            <button
              type="button"
              disabled={page * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-sand px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Sau
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!actionTarget}
        title={
          actionTarget?.action === "approve"
            ? "Duyệt đề xuất"
            : actionTarget?.action === "reject"
              ? "Từ chối đề xuất"
              : "Vô hiệu hóa đề xuất"
        }
        message={
          actionTarget?.action === "approve"
            ? "Xác nhận duyệt? Hệ thống sẽ tạo price period (khoảng giá hiệu lực) cho size này trong khoảng ngày đề xuất. Chỉ booking tạo mới chịu ảnh hưởng."
            : actionTarget?.action === "reject"
              ? "Xác nhận từ chối đề xuất này? Không có price period nào được tạo."
              : "Vô hiệu hóa đề xuất này? Price period đã tạo sẽ bị tắt (trống lại khoảng ngày) để có thể duyệt đề xuất mới. Đề xuất không quay về trạng thái chờ duyệt."
        }
        confirmLabel={
          actionTarget?.action === "approve" ? "Duyệt" : actionTarget?.action === "reject" ? "Từ chối" : "Vô hiệu hóa"
        }
        cancelLabel="Hủy"
        danger={actionTarget?.action === "reject"}
        onConfirm={handleAction}
        onCancel={() => setActionTarget(null)}
      />

      <ConfirmModal
        open={!!bulkAction}
        title={bulkAction === "approve" ? `Duyệt ${selected.size} đề xuất` : `Từ chối ${selected.size} đề xuất`}
        message={
          bulkAction === "approve"
            ? `Xác nhận duyệt ${selected.size} đề xuất đã chọn? Mỗi đề xuất sẽ tạo price period riêng cho size của nó. Đề xuất nào lỗi (trùng period, không còn pending...) sẽ được liệt kê và không ảnh hưởng các đề xuất khác.`
            : `Xác nhận từ chối ${selected.size} đề xuất đã chọn? Không có price period nào được tạo.`
        }
        confirmLabel={bulkAction === "approve" ? "Duyệt" : "Từ chối"}
        cancelLabel="Hủy"
        danger={bulkAction === "reject"}
        onConfirm={handleBulk}
        onCancel={() => setBulkAction(null)}
      />
      {busy && <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30 backdrop-blur-sm"><div className="rounded-lg bg-white px-6 py-4 text-sm font-semibold">Đang xử lý...</div></div>}

      {createOpen && (
        <SuggestionFormModal
          onClose={() => setCreateOpen(false)}
          onSaved={(msg) => { setCreateOpen(false); showToast("success", msg); load(); }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
      {editTarget && (
        <EditPriceModal
          suggestion={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(msg) => { setEditTarget(null); showToast("success", msg); load(); }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
    </section>
  );
}

// ── Form tạo đề xuất thủ công ─────────────────────────────────────────────────

function SuggestionFormModal({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [sizeOptions, setSizeOptions] = useState<Array<{ id: string; garmentName: string; sizeLabel: string | null; label: string }>>([]);
  const [loadingSizes, setLoadingSizes] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ from: "", to: "", validPrice: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getGarmentsGrouped().then((res) => {
      if (res.success && res.data) {
        const opts: Array<{ id: string; garmentName: string; sizeLabel: string | null; label: string }> = [];
        for (const g of res.data) {
          for (const sz of g.sizes) {
            opts.push({
              id: sz.garmentSizeId,
              garmentName: g.name,
              sizeLabel: sz.sizeLabel,
              label: `${g.name} · Size ${sz.sizeLabel ?? "—"} (${formatVND(sz.dailyPrice)}/ngày)`,
            });
          }
        }
        setSizeOptions(opts);
      }
      setLoadingSizes(false);
    });
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? sizeOptions.filter((o) => o.label.toLowerCase().includes(q))
    : sizeOptions;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (selected.size === 0) newErrors.sizes = "Chọn ít nhất 1 size.";
    if (!form.from) newErrors.from = "Chọn ngày bắt đầu.";
    if (!form.to) newErrors.to = "Chọn ngày kết thúc.";
    if (form.from && form.to && form.to < form.from) newErrors.to = "Ngày kết thúc phải sau ngày bắt đầu.";
    const price = Number(form.validPrice);
    if (!form.validPrice || Number.isNaN(price) || price < 0) newErrors.validPrice = "Nhập giá hợp lệ (>= 0).";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    const res = await createPricingSuggestion({
      garmentSizeIds: Array.from(selected),
      from: form.from,
      to: form.to,
      validPrice: price,
    });
    setSaving(false);
    if (res.success) {
      const createdCount = res.data?.created.length ?? 0;
      const skippedCount = res.data?.skipped.length ?? 0;
      let msg = `Đã tạo ${createdCount} đề xuất thủ công (nguồn: chủ shop)`;
      if (skippedCount > 0) msg += ` — bỏ qua ${skippedCount} size (đã có đề xuất / không hợp lệ)`;
      onSaved(msg);
    } else {
      onError(res.message || "Không thể tạo đề xuất");
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full rounded-lg border ${hasError ? "border-red-500" : "border-sand"} px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-sand bg-white shadow-2xl overflow-hidden animate-zoom-in">
        <header className="flex items-center justify-between border-b border-sand bg-warm-ivory px-6 py-4">
          <h3 className="font-display text-2xl text-ink">Tạo đề xuất thủ công</h3>
          <button type="button" onClick={onClose} className="text-stone-500 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-semibold text-stone-700">Trang phục / Size (chọn nhiều) *</label>
            {loadingSizes ? (
              <div className="text-sm text-stone-400">Đang tải danh sách...</div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm theo tên sản phẩm / size..."
                    className={inputClass(false)}
                  />
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(filtered.map((o) => o.id)))}
                    className="shrink-0 rounded-lg border border-sand px-3 py-2 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                  >
                    Chọn tất cả ({filtered.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="shrink-0 rounded-lg border border-sand px-3 py-2 text-xs font-semibold text-stone-600 transition hover:border-red-300 hover:text-red-600"
                  >
                    Bỏ chọn
                  </button>
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-sand">
                  {filtered.length === 0 ? (
                    <div className="p-4 text-sm text-stone-400">Không có sản phẩm nào khớp.</div>
                  ) : (
                    filtered.map((o) => (
                      <label
                        key={o.id}
                        className="flex items-center gap-2 border-b border-sand/40 px-3 py-2 text-sm hover:bg-warm-ivory/30 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(o.id)}
                          onChange={() => toggle(o.id)}
                          className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
                        />
                        <span className="truncate">{o.label}</span>
                      </label>
                    ))
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-stone-400">Đã chọn {selected.size} size.</p>
                  {errors.sizes && <p className="text-xs text-red-500">{errors.sizes}</p>}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Từ ngày *</label>
              <input
                type="date"
                value={form.from}
                onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
                className={inputClass(!!errors.from)}
              />
              {errors.from && <p className="mt-1 text-xs text-red-500">{errors.from}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Đến ngày *</label>
              <input
                type="date"
                value={form.to}
                onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
                className={inputClass(!!errors.to)}
              />
              {errors.to && <p className="mt-1 text-xs text-red-500">{errors.to}</p>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-stone-700">Giá thuê mỗi ngày (đ) *</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={form.validPrice}
              onChange={(e) => setForm((f) => ({ ...f, validPrice: e.target.value }))}
              placeholder="VD: 380000"
              className={inputClass(!!errors.validPrice)}
            />
            {errors.validPrice && <p className="mt-1 text-xs text-red-500">{errors.validPrice}</p>}
            <p className="mt-1 text-xs text-stone-400">Giá này áp cho từng size đã chọn. Các đề xuất có nguồn &ldquo;Chủ shop&rdquo; — khi duyệt không bị giới hạn min/max.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-sand px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50">
              Hủy
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50">
              {saving ? "Đang tạo..." : `Tạo đề xuất (${selected.size})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Form sửa giá đề xuất pending ──────────────────────────────────────────────

function EditPriceModal({
  suggestion,
  onClose,
  onSaved,
  onError,
}: {
  suggestion: PriceSuggestionEntry;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [price, setPrice] = useState(suggestion.validPrice.toString());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(price);
    if (!price || Number.isNaN(num) || num < 0) {
      setError("Nhập giá hợp lệ (>= 0).");
      return;
    }
    setError(null);
    setSaving(true);
    const res = await updatePricingSuggestionPrice(suggestion.id, num);
    setSaving(false);
    if (res.success) {
      onSaved(`Đã cập nhật giá thành ${formatVND(num)} — đề xuất giờ là của chủ shop`);
    } else {
      onError(res.message || "Không thể cập nhật giá");
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full rounded-lg border ${hasError ? "border-red-500" : "border-sand"} px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-sand bg-white shadow-2xl overflow-hidden animate-zoom-in">
        <header className="flex items-center justify-between border-b border-sand bg-warm-ivory px-6 py-4">
          <h3 className="font-display text-2xl text-ink">Sửa giá đề xuất</h3>
          <button type="button" onClick={onClose} className="text-stone-500 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="text-sm text-stone-600">
            <div className="font-semibold text-ink">{suggestion.garmentName ?? suggestion.garmentId}</div>
            <div className="text-stone-500">Size {suggestion.sizeLabel ?? "—"} · {formatDateRange(suggestion.fromDate, suggestion.toDate)}</div>
            <div className="mt-2 text-xs text-stone-400">
              Giá cơ sở {formatVND(suggestion.basePrice)} · Đề xuất hiện tại {formatVND(suggestion.validPrice)}
              {suggestion.source === "owner" && " · Nguồn: Chủ shop"}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-stone-700">Giá thuê mỗi ngày (đ) *</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClass(!!error)}
            />
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
            <p className="mt-1 text-xs text-stone-400">Sau khi sửa, đề xuất có nguồn &ldquo;Chủ shop&rdquo; — không bị giới hạn min/max.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-sand px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50">
              Hủy
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50">
              {saving ? "Đang lưu..." : "Lưu giá"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Khoảng giá hiệu lực (price_periods) ───────────────────────────────────────

function PeriodsTab({ showToast }: { showToast: (k: "success" | "error", m: string) => void }) {
  const PAGE_SIZE = 50;
  const [periods, setPeriods] = useState<PricePeriodEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<DateFilter>(EMPTY_FILTER);
  const [draft, setDraft] = useState<DateFilter>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [deactivateTarget, setDeactivateTarget] = useState<PricePeriodEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPricingPeriods({
      activeOnly: activeOnly || undefined,
      search: filter.search || undefined,
      from: filter.from || undefined,
      to: filter.to || undefined,
      page,
      limit: PAGE_SIZE,
    });
    if (res.success && res.data) {
      setPeriods(res.data.items);
      setTotal(res.data.total);
    } else {
      showToast("error", res.message || "Không thể tải khoảng giá hiệu lực");
    }
    setLoading(false);
  }, [activeOnly, filter, page, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true);
    const res = await deactivatePricingPeriod(deactivateTarget.id);
    setBusy(false);
    setDeactivateTarget(null);
    if (res.success) {
      showToast("success", "Đã vô hiệu hóa khoảng giá này");
      load();
    } else {
      showToast("error", res.message || "Không thể vô hiệu hóa khoảng giá");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
            />
            Chỉ khoảng đang hiệu lực
          </label>
          <span className="text-xs text-stone-400">{total} khoảng</span>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
        >
          <RefreshCw className="h-4 w-4" />
          Nạp lại
        </button>
      </div>

      <PricingFilterBar
        draft={draft}
        setDraft={setDraft}
        onApply={() => { setFilter(draft); setPage(1); }}
        onClear={() => { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER); setPage(1); }}
        placeholder="Tìm sản phẩm / size / sự kiện..."
      />

      {loading ? (
        <div className="rounded-xl border border-sand bg-white p-10 text-center text-sm text-stone-500">Đang tải...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sand bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-sand text-xs font-bold text-stone-600 uppercase tracking-wider">
                <th className="py-3 px-4">Trang phục</th>
                <th className="py-3 px-4">Khoảng ngày</th>
                <th className="py-3 px-4">Loại sự kiện</th>
                <th className="py-3 px-4 text-right">Giá / ngày</th>
                <th className="py-3 px-4">Nguồn</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/40 text-sm">
              {periods.map((p) => (
                <tr key={p.id} className="hover:bg-warm-ivory/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-ink">{p.garmentName ?? p.garmentSizeId}</div>
                    <div className="text-xs text-stone-500">Size {p.sizeLabel ?? "—"}</div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{formatDateRange(p.fromDate, p.toDate)}</td>
                  <td className="py-3 px-4">
                    {p.occasionType ? (
                      <>
                        <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded bg-violet-50 text-violet-700">
                          {OCCASION_LABELS[p.occasionType] ?? p.occasionType}
                        </span>
                        {p.eventName && <div className="mt-0.5 text-xs text-stone-500">{p.eventName}</div>}
                      </>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-lotus">{formatVND(p.dailyPrice)}</td>
                  <td className="py-3 px-4">
                    {p.source !== "owner" && (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded ${p.source === "ai_suggestion" ? "bg-amber-50 text-amber-700" : "bg-stone-100 text-stone-600"}`}>
                        {PERIOD_SOURCE_LABELS[p.source] ?? p.source}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={statusBadgeClass(p.isActive ? "bg-jade/10 text-jade" : "bg-stone-100 text-stone-500")}>
                      {p.isActive ? "Hiệu lực" : "Đã tắt"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      {p.isActive ? (
                        <button
                          type="button"
                          onClick={() => setDeactivateTarget(p)}
                          className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-warm-ivory hover:text-oxblood"
                        >
                          Vô hiệu hóa
                        </button>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {periods.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-stone-500">
                    Chưa có khoảng giá hiệu lực nào. Khi bạn duyệt một đề xuất, khoảng giá sẽ xuất hiện tại đây.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PaginationRow total={total} page={page} pageSize={PAGE_SIZE} onPage={setPage} />

      <ConfirmModal
        open={!!deactivateTarget}
        title="Vô hiệu hóa khoảng giá"
        message={`Khoảng giá của ${deactivateTarget?.garmentName ?? "sản phẩm"} (Size ${deactivateTarget?.sizeLabel ?? "—"}) từ ${deactivateTarget ? formatDateRange(deactivateTarget.fromDate, deactivateTarget.toDate) : ""} sẽ bị tắt. Booking mới sau đó quay về giá cơ sở. Tiếp tục?`}
        confirmLabel="Vô hiệu hóa"
        cancelLabel="Hủy"
        danger
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />
      {busy && <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30 backdrop-blur-sm"><div className="rounded-lg bg-white px-6 py-4 text-sm font-semibold">Đang xử lý...</div></div>}
    </section>
  );
}