"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Percent,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  SlidersHorizontal,
  Tag,
  Wand2,
} from "lucide-react";
import { getDamageFeeTable, updateDamageFeeTable, type DamageFeeEntry } from "@/lib/api";

export const DEFAULT_DAMAGE_FEE_ENTRIES: DamageFeeEntry[] = [
  { label: "Rách nhỏ / sờn vải nhẹ", amount: 50000, severity: "low" },
  { label: "Mất khuy / tuột chỉ", amount: 30000, severity: "low" },
  { label: "Vết bẩn không giặt sạch", amount: 80000, severity: "medium" },
  { label: "Rách to / mất phụ kiện đính", pct: 20, tiers: [15, 20, 25, 30], severity: "medium" },
  { label: "Biến dạng / ố vàng nghiêm trọng", pct: 40, tiers: [30, 40, 50, 60], severity: "high" },
  { label: "Hư hỏng không phục hồi / mất đồ", pct: 100, severity: "severe" },
];

const SEVERITY_CONFIG: Record<
  DamageFeeEntry["severity"],
  { label: string; badgeClass: string; dotClass: string; hint: string }
> = {
  low: {
    label: "Nhẹ",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotClass: "bg-emerald-500",
    hint: "Thường ≤ 30% cọc (Nhân viên tự hoàn tất)",
  },
  medium: {
    label: "Trung bình",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    dotClass: "bg-amber-500",
    hint: "Nếu phạt > 30% cọc sẽ tự động chuyển Quản lý duyệt",
  },
  high: {
    label: "Nặng",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
    dotClass: "bg-orange-500",
    hint: "Mức phạt cao, rủi ro ảnh hưởng giá trị trang phục",
  },
  severe: {
    label: "Nghiêm trọng",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    dotClass: "bg-rose-500",
    hint: "Hư hỏng không thể phục hồi hoặc mất hiện vật",
  },
};

export function generateStandardTiers(basePct: number): number[] {
  const p = Math.max(1, Math.min(100, Math.round(basePct)));
  if (p >= 90) return [70, 80, 90, 100];
  if (p <= 10) return [5, 10, 15, 20];

  // Nếu mức phạt nhỏ (<= 30%), bước nhảy 5% để linh hoạt
  if (p <= 30) {
    const step = 5;
    const lower = Math.max(5, p - step);
    const upper1 = Math.min(100, p + step);
    const upper2 = Math.min(100, p + step * 2);
    return Array.from(new Set([lower, p, upper1, upper2])).sort((a, b) => a - b);
  }

  // Nếu mức phạt trung bình hoặc cao (31% - 89%), bước nhảy 10%
  const step = 10;
  const lower = Math.max(10, p - step);
  const upper1 = Math.min(100, p + step);
  const upper2 = Math.min(100, p + step * 2);
  return Array.from(new Set([lower, p, upper1, upper2])).sort((a, b) => a - b);
}

type Props = {
  /** Khi dùng controlled (ví dụ trong Admin SystemConfigPanel) */
  value?: DamageFeeEntry[];
  onChange?: (entries: DamageFeeEntry[]) => void;
  /** Khi dùng standalone (ví dụ trong Manager Portal), component tự fetch và tự update */
  standalone?: boolean;
  onSuccessNotice?: (msg: string) => void;
  onErrorNotice?: (msg: string) => void;
};

export function DamageFeeTableEditor({
  value,
  onChange,
  standalone = false,
  onSuccessNotice,
  onErrorNotice,
}: Props) {
  const [internalList, setInternalList] = useState<DamageFeeEntry[]>(DEFAULT_DAMAGE_FEE_ENTRIES);
  const [loading, setLoading] = useState(standalone);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isControlled = !standalone && Array.isArray(value) && typeof onChange === "function";
  const items = isControlled ? value : internalList;

  // Local draft inputs for typing nấc % freeform (prevents comma/space deletion on keystroke)
  const [tierInputs, setTierInputs] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    (value || DEFAULT_DAMAGE_FEE_ENTRIES).forEach((item, idx) => {
      if (Array.isArray(item.tiers)) {
        init[idx] = item.tiers.join(", ");
      }
    });
    return init;
  });

  const updateItems = (next: DamageFeeEntry[]) => {
    if (isControlled) {
      onChange(next);
    } else {
      setInternalList(next);
    }
  };

  const loadData = useCallback(async () => {
    if (!standalone) return;
    setLoading(true);
    try {
      const res = await getDamageFeeTable();
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        setInternalList(res.data);
        const map: Record<number, string> = {};
        res.data.forEach((item, idx) => {
          if (Array.isArray(item.tiers)) {
            map[idx] = item.tiers.join(", ");
          }
        });
        setTierInputs(map);
      } else {
        setInternalList(DEFAULT_DAMAGE_FEE_ENTRIES);
      }
    } catch {
      setStatusMsg({ type: "error", text: "Không thể tải bảng định mức lỗi từ máy chủ." });
    } finally {
      setLoading(false);
    }
  }, [standalone]);

  useEffect(() => {
    if (standalone) {
      void loadData();
    }
  }, [standalone, loadData]);

  const handleFieldChange = (
    index: number,
    field: "label" | "type" | "val" | "severity",
    val: string | number,
  ) => {
    const next = [...items];
    const target = { ...next[index] };

    if (field === "label") {
      target.label = String(val);
    } else if (field === "severity") {
      target.severity = val as DamageFeeEntry["severity"];
    } else if (field === "type") {
      if (val === "pct") {
        const basePct = target.amount ? Math.min(100, Math.max(1, Math.round(target.amount / 10000))) : 20;
        target.pct = basePct;
        delete target.amount;
        if (!target.tiers || target.tiers.length === 0) {
          const autoTiers = generateStandardTiers(basePct);
          target.tiers = autoTiers;
          setTierInputs((prev) => ({ ...prev, [index]: autoTiers.join(", ") }));
        }
      } else {
        target.amount = target.pct ? target.pct * 10000 : 50000;
        delete target.pct;
        delete target.tiers;
        setTierInputs((prev) => {
          const updated = { ...prev };
          delete updated[index];
          return updated;
        });
      }
    } else if (field === "val") {
      const num = Math.max(0, Number(val) || 0);
      if (typeof target.pct === "number") {
        const nextPct = Math.min(100, num);
        target.pct = nextPct;
      } else {
        target.amount = num;
      }
    }

    next[index] = target;
    updateItems(next);
  };

  const handleTiersTextChange = (index: number, rawText: string) => {
    // Keep raw text so commas and spaces are never stripped while typing
    setTierInputs((prev) => ({ ...prev, [index]: rawText }));

    // Parse valid percentage numbers: "15, 20, 25, 30" -> [15, 20, 25, 30]
    const parsed = rawText
      .split(/[,\s]+/)
      .map((s) => s.trim().replace(/%/g, ""))
      .filter((s) => s !== "" && !isNaN(Number(s)))
      .map((n) => Math.min(100, Math.max(1, Math.round(Number(n)))));

    const uniqueSorted = Array.from(new Set(parsed)).sort((a, b) => a - b);
    const next = [...items];
    next[index] = {
      ...next[index],
      tiers: uniqueSorted.length > 0 ? uniqueSorted : null,
    };
    updateItems(next);
  };

  const handleTiersBlur = (index: number) => {
    const target = items[index];
    if (target && Array.isArray(target.tiers) && target.tiers.length > 0) {
      setTierInputs((prev) => ({ ...prev, [index]: target.tiers!.join(", ") }));
    }
  };

  const handleAutoSuggestTiers = (index: number) => {
    const next = [...items];
    const target = { ...next[index] };
    const basePct = target.pct ?? 20;
    const newTiers = generateStandardTiers(basePct);
    target.tiers = newTiers;
    next[index] = target;

    // Immediately update input text and items
    setTierInputs((prev) => ({ ...prev, [index]: newTiers.join(", ") }));
    updateItems(next);
  };

  const handleAddRow = () => {
    const next: DamageFeeEntry[] = [
      ...items,
      {
        label: `Loại lỗi mới #${items.length + 1}`,
        amount: 50000,
        severity: "low",
      },
    ];
    updateItems(next);
  };

  const handleRemoveRow = (index: number) => {
    if (items.length <= 1) {
      const err = "Cần giữ lại ít nhất 1 định mức lỗi.";
      setStatusMsg({ type: "error", text: err });
      onErrorNotice?.(err);
      return;
    }
    const next = items.filter((_, i) => i !== index);
    const nextInputs: Record<number, string> = {};
    next.forEach((item, i) => {
      if (Array.isArray(item.tiers)) {
        nextInputs[i] = item.tiers.join(", ");
      }
    });
    setTierInputs(nextInputs);
    updateItems(next);
  };

  const handleResetDefault = () => {
    if (!window.confirm("Khôi phục danh sách định mức về mặc định chuẩn của xưởng?")) return;
    updateItems([...DEFAULT_DAMAGE_FEE_ENTRIES]);
    const resetMap: Record<number, string> = {};
    DEFAULT_DAMAGE_FEE_ENTRIES.forEach((item, idx) => {
      if (Array.isArray(item.tiers)) {
        resetMap[idx] = item.tiers.join(", ");
      }
    });
    setTierInputs(resetMap);
    const msg = "Đã khôi phục bảng định mức về 6 mức chuẩn của xưởng.";
    setStatusMsg({ type: "success", text: msg });
    onSuccessNotice?.(msg);
  };

  const handleSaveStandalone = async () => {
    // Validate
    for (const item of items) {
      if (!item.label.trim()) {
        const err = "Vui lòng nhập tên cho tất cả các loại lỗi.";
        setStatusMsg({ type: "error", text: err });
        onErrorNotice?.(err);
        return;
      }
      const hasAmount = typeof item.amount === "number" && item.amount >= 0;
      const hasPct = typeof item.pct === "number" && item.pct >= 0;
      if (!hasAmount && !hasPct) {
        const err = `Lỗi "${item.label}" cần có số tiền hoặc phần trăm hợp lệ.`;
        setStatusMsg({ type: "error", text: err });
        onErrorNotice?.(err);
        return;
      }
    }

    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await updateDamageFeeTable(items);
      if (res.success) {
        const ok = "Đã lưu cập nhật bảng định mức bồi thường thành công!";
        setStatusMsg({ type: "success", text: ok });
        onSuccessNotice?.(ok);
        await loadData();
      } else {
        const err = res.error || "Không thể lưu bảng định mức.";
        setStatusMsg({ type: "error", text: err });
        onErrorNotice?.(err);
      }
    } catch {
      const err = "Lỗi mạng khi lưu định mức.";
      setStatusMsg({ type: "error", text: err });
      onErrorNotice?.(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-stone-500 text-sm">
        Đang nạp bảng định mức lỗi...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Notice header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-warm-ivory/40 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-antique/10 text-antique">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-ink">Bảng định mức lỗi & Tiền phạt bồi thường</h4>
            <p className="text-xs text-stone-500">
              Nhân viên kiểm tra trang phục sẽ chọn từ bảng này để tự động tính tiền phạt minh bạch cho khách.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetDefault}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
          >
            <RotateCcw className="h-3.5 w-3.5 text-stone-400" />
            Khôi phục mặc định
          </button>
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 rounded-lg bg-antique px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-oxblood"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm loại lỗi
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-xs font-semibold ${
            statusMsg.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {statusMsg.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Table list */}
      <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
        <div className="divide-y divide-sand">
          <div className="hidden grid-cols-12 gap-3 bg-stone-50/70 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-stone-500 sm:grid">
            <div className="col-span-4">Tên loại lỗi / Hư hại</div>
            <div className="col-span-3">Hình thức phạt</div>
            <div className="col-span-2">Mức phạt chuẩn</div>
            <div className="col-span-2">Mức độ vi phạm</div>
            <div className="col-span-1 text-center">Xóa</div>
          </div>

          {items.map((entry, idx) => {
            const isPct = typeof entry.pct === "number";
            const sevInfo = SEVERITY_CONFIG[entry.severity] ?? SEVERITY_CONFIG.low;
            const tiersList = Array.isArray(entry.tiers) && entry.tiers.length > 0 ? entry.tiers : (isPct ? [entry.pct ?? 20] : []);
            const currentInputValue = tierInputs[idx] !== undefined
              ? tierInputs[idx]
              : (Array.isArray(entry.tiers) ? entry.tiers.join(", ") : "");

            return (
              <div
                key={idx}
                className="grid grid-cols-1 gap-3 p-4 transition-colors hover:bg-stone-50/40 sm:grid-cols-12 sm:items-center sm:px-4 sm:py-3.5"
              >
                {/* 1. Label */}
                <div className="sm:col-span-4">
                  <label className="text-[11px] font-bold text-stone-400 sm:hidden">Tên loại lỗi:</label>
                  <input
                    type="text"
                    value={entry.label}
                    onChange={(e) => handleFieldChange(idx, "label", e.target.value)}
                    placeholder="VD: Rách nhỏ, ố vàng..."
                    className="w-full rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-ink outline-none transition focus:border-antique"
                  />
                </div>

                {/* 2. Type toggle */}
                <div className="sm:col-span-3">
                  <label className="text-[11px] font-bold text-stone-400 sm:hidden">Hình thức:</label>
                  <div className="inline-flex rounded-lg border border-sand bg-stone-100 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => handleFieldChange(idx, "type", "amount")}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                        !isPct ? "bg-white text-ink shadow-sm" : "text-stone-500 hover:text-ink"
                      }`}
                    >
                      <DollarSign className="h-3 w-3 text-emerald-600" />
                      Tiền mặt
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFieldChange(idx, "type", "pct")}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                        isPct ? "bg-white text-ink shadow-sm" : "text-stone-500 hover:text-ink"
                      }`}
                    >
                      <Percent className="h-3 w-3 text-lotus" />
                      % Giá áo
                    </button>
                  </div>
                </div>

                {/* 3. Value */}
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-bold text-stone-400 sm:hidden">Mức phạt chuẩn:</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={isPct ? 100 : 100000000}
                      step={isPct ? 5 : 10000}
                      value={isPct ? (entry.pct ?? 0) : (entry.amount ?? 0)}
                      onChange={(e) => handleFieldChange(idx, "val", e.target.value)}
                      className="w-full rounded-lg border border-sand bg-white pr-9 pl-3 py-1.5 text-xs font-semibold text-ink outline-none transition focus:border-antique"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] font-bold text-stone-400">
                      {isPct ? "%" : "đ"}
                    </span>
                  </div>
                </div>

                {/* 4. Severity */}
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-bold text-stone-400 sm:hidden">Mức độ:</label>
                  <select
                    value={entry.severity}
                    onChange={(e) => handleFieldChange(idx, "severity", e.target.value)}
                    className={`w-full rounded-lg border px-2 py-1.5 text-xs font-semibold outline-none transition ${sevInfo.badgeClass}`}
                  >
                    <option value="low">Nhẹ</option>
                    <option value="medium">Trung bình</option>
                    <option value="high">Nặng</option>
                    <option value="severe">Nghiêm trọng</option>
                  </select>
                </div>

                {/* 5. Delete action */}
                <div className="flex justify-end sm:col-span-1 sm:justify-center">
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(idx)}
                    title="Xóa định mức này"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* 6. Nấc % định sẵn (Chỉ hiển thị khi chọn phạt % Giá áo) */}
                {isPct && (
                  <div className="mt-1 rounded-xl border border-amber-200/70 bg-amber-50/30 p-3 sm:col-span-12">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                        <Tag className="h-3.5 w-3.5 text-antique" />
                        <span>Nấc % gợi ý cho nhân viên chọn nhanh:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="VD: 15, 20, 25, 30"
                          value={currentInputValue}
                          onChange={(e) => handleTiersTextChange(idx, e.target.value)}
                          onBlur={() => handleTiersBlur(idx)}
                          className="w-48 rounded-md border border-sand bg-white px-2.5 py-1 text-xs text-ink outline-none transition focus:border-antique font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleAutoSuggestTiers(idx)}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100 shadow-2xs active:scale-95"
                          title="Tự động tính nấc gợi ý quanh mức % chuẩn"
                        >
                          <Wand2 className="h-3.5 w-3.5 text-antique" />
                          Tự sinh nấc
                        </button>
                      </div>
                    </div>

                    {/* Preview chips */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-1 border-t border-amber-200/50">
                      <span className="text-[11px] text-stone-500 font-medium">Xem trước nút nhân viên sẽ thấy:</span>
                      {tiersList.map((tierPct) => {
                        const isDefaultTier = tierPct === (entry.pct ?? 20);
                        return (
                          <span
                            key={tierPct}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-semibold border ${
                              isDefaultTier
                                ? "bg-antique text-white border-antique shadow-2xs"
                                : "bg-white text-stone-700 border-sand shadow-2xs"
                            }`}
                          >
                            <span>{tierPct}%</span>
                            {isDefaultTier && <span className="text-[10px] opacity-80 font-normal">(Chuẩn)</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Standalone Save button */}
      {standalone && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-stone-500">
            Tổng cộng: <strong className="text-ink">{items.length}</strong> định mức lỗi được lưu trong hệ thống.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveStandalone}
            className="inline-flex items-center gap-2 rounded-lg bg-lotus px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-oxblood disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Đang lưu..." : "Lưu thay đổi định mức"}
          </button>
        </div>
      )}
    </div>
  );
}
