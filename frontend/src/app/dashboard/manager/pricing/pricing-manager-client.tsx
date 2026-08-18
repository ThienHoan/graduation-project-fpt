"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "@/lib/api";
import { ConfirmModal } from "@/components/heritage/ui";
import { statusBadgeClass } from "@/lib/status-labels";

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
      className={`fixed right-6 top-20 z-[120] flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg border animate-slide-in ${
        toast.kind === "success" ? "bg-jade/5 text-jade border-jade/30" : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      <span className="material-symbols-outlined text-[20px]">
        {toast.kind === "success" ? "check_circle" : "error"}
      </span>
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
        className="inline-flex items-center gap-1 rounded-lg bg-lotus px-3 py-2 text-sm font-semibold text-white transition hover:bg-oxblood"
      >
        <span className="material-symbols-outlined text-[16px]">search</span>
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

type PricingTab = "calendar" | "suggestions" | "periods";

export function PricingManagerClient() {
  const [tab, setTab] = useState<PricingTab>("calendar");
  const { toast, show } = useToasts();

  const tabs: Array<{ key: PricingTab; label: string; icon: string }> = [
    { key: "calendar", label: "Lịch sự kiện", icon: "event" },
    { key: "suggestions", label: "Đề xuất giá", icon: "lightbulb" },
    { key: "periods", label: "Khoảng giá hiệu lực", icon: "price_change" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-sand pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? "bg-lotus text-white shadow" : "bg-white text-stone-600 border border-sand hover:border-lotus hover:text-lotus"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

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
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  const [modal, setModal] = useState<{ open: boolean; editing: PriceCalendarEntry | null }>({ open: false, editing: null });
  const [deleteTarget, setDeleteTarget] = useState<PriceCalendarEntry | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<{ eventName: string; result: GenerateSuggestionsResult } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPricingCalendar({
      activeOnly: showOnlyActive || undefined,
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
  }, [showOnlyActive, filter, page, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async (evt: PriceCalendarEntry) => {
    setGenerating(evt.id);
    const res = await generatePricingSuggestions({ calendarId: evt.id });
    setGenerating(null);
    if (res.success && res.data) {
      setGenerateResult({ eventName: evt.name, result: res.data });
    } else {
      showToast("error", res.message || "Không thể sinh đề xuất");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await removePricingCalendar(deleteTarget.id);
    setDeleteTarget(null);
    if (res.success) {
      showToast("success", `Đã xóa sự kiện "${deleteTarget.name}"`);
      load();
    } else {
      showToast("error", res.message || "Không thể xóa sự kiện");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={showOnlyActive}
              onChange={(e) => setShowOnlyActive(e.target.checked)}
              className="h-4 w-4 rounded border-sand text-lotus focus:ring-lotus"
            />
            Chỉ sự kiện đang bật
          </label>
        </div>
        <button
          type="button"
          onClick={() => setModal({ open: true, editing: null })}
          className="inline-flex items-center gap-2 rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
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
                <th className="py-3 px-4">Từ khóa áp dụng</th>
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
                    {evt.garmentKeywords.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {evt.garmentKeywords.map((k) => (
                          <span key={k} className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600">{k}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">Áp dụng toàn bộ</span>
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
                        disabled={generating === evt.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                        {generating === evt.id ? "Đang sinh..." : "Sinh đề xuất"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ open: true, editing: evt })}
                        className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(evt)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Xóa
                      </button>
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
        open={!!deleteTarget}
        title="Xóa sự kiện"
        message={`Sự kiện "${deleteTarget?.name}" sẽ bị tắt (xóa mềm). Đề xuất đã sinh vẫn giữ nguyên. Tiếp tục?`}
        confirmLabel="Xóa"
        cancelLabel="Hủy"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {generateResult && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-sand bg-white p-6 shadow-xl">
            <h3 className="font-display text-2xl text-ink">Kết quả sinh đề xuất</h3>
            <p className="mt-2 text-sm text-stone-600">
              Sự kiện <span className="font-semibold">{generateResult.eventName}</span> — tạo được{" "}
              <span className="font-semibold text-lotus">{generateResult.result.generated}</span> đề xuất.
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
    garmentKeywords: editing?.garmentKeywords.join(", ") ?? "",
    isActive: editing?.isActive ?? true,
    note: editing?.note ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "Vui lòng nhập tên sự kiện.";
    if (!form.fromDate) newErrors.fromDate = "Chọn ngày bắt đầu.";
    if (!form.toDate) newErrors.toDate = "Chọn ngày kết thúc.";
    if (form.fromDate && form.toDate && form.toDate < form.fromDate) newErrors.toDate = "Ngày kết thúc phải sau ngày bắt đầu.";
    const pct = Number(form.adjustmentPercent);
    if (Number.isNaN(pct) || pct < -100) newErrors.adjustmentPercent = "Phần trăm không hợp lệ (tối thiểu -100).";
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
      garmentKeywords: form.garmentKeywords.split(",").map((k) => k.trim()).filter(Boolean),
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
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div>
              <label className="mb-1 block text-sm font-semibold text-stone-700">Từ khóa áp dụng</label>
              <input
                type="text"
                value={form.garmentKeywords}
                onChange={(e) => set("garmentKeywords", e.target.value)}
                placeholder="VD: áo dài thêu, kỷ yếu (phân tách bằng dấu phẩy)"
                className={inputClass(false)}
              />
              <p className="mt-1 text-xs text-stone-400">Chỉ garment có từ khóa trong mô tả mới được điều chỉnh. Để trống = áp dụng toàn bộ.</p>
            </div>
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
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filter === f.key ? "bg-lotus text-white" : "bg-white border border-sand text-stone-600 hover:border-lotus"
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
            <span className="material-symbols-outlined text-[18px]">add</span>
            Tạo đề xuất
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 rounded-lg border border-sand px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Nạp lại
          </button>
        </div>
      </div>

      <PricingFilterBar
        draft={draftFilter}
        setDraft={setDraftFilter}
        onApply={() => { setDateFilter(draftFilter); setPage(1); clearSelection(); }}
        onClear={() => { setDraftFilter(EMPTY_FILTER); setDateFilter(EMPTY_FILTER); setPage(1); clearSelection(); }}
        placeholder="Tìm sản phẩm / size..."
      />

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lotus/30 bg-lotus/5 px-4 py-3">
          <span className="text-sm font-semibold text-ink">Đã chọn {selected.size} đề xuất</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkAction("approve")}
              className="inline-flex items-center gap-1 rounded-lg bg-jade px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[16px]">check</span>
              Duyệt đã chọn
            </button>
            <button
              type="button"
              onClick={() => setBulkAction("reject")}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
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
                    <span className={`mt-1 inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                      s.source === "owner" ? "bg-amber-100 text-amber-700" : "bg-sky-50 text-sky-700"
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
                    <div className="text-xs text-stone-400">Giá nhập {formatVND(s.purchaseCost)} / {s.targetRentalDays} ngày</div>
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
                            className="inline-flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                            Sửa giá
                          </button>
                          <button
                            type="button"
                            onClick={() => setActionTarget({ id: s.id, action: "approve" })}
                            className="inline-flex items-center gap-1 rounded-lg bg-jade/10 px-3 py-1.5 text-xs font-semibold text-jade transition hover:bg-jade/20"
                          >
                            <span className="material-symbols-outlined text-[16px]">check</span>
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
            <span className="material-symbols-outlined">close</span>
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
            <span className="material-symbols-outlined">close</span>
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
          className="inline-flex items-center gap-1 rounded-lg border border-sand px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
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