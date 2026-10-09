"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPriceRule,
  deletePriceRule,
  getGarmentCategories,
  getPriceRules,
  togglePriceRule,
  updatePriceRule,
  type GarmentCategory,
  type PriceRule,
  type PriceRulePayload,
  type PriceRuleType,
} from "@/lib/api";
import { ConfirmModal } from "@/components/heritage/ui";

export const RULE_TYPE_META: Record<PriceRuleType, { label: string; priority: number; icon: string; color: string }> = {
  tet: { label: "Tết", priority: 100, icon: "celebration", color: "bg-red-50 text-red-700" },
  holiday: { label: "Ngày lễ", priority: 80, icon: "flag", color: "bg-amber-50 text-amber-700" },
  store_program: { label: "Chương trình cửa hàng", priority: 70, icon: "storefront", color: "bg-purple-50 text-purple-700" },
  double_sale: { label: "Sale đôi", priority: 60, icon: "sell", color: "bg-pink-50 text-pink-700" },
  peak_season: { label: "Mùa cao điểm", priority: 50, icon: "trending_up", color: "bg-orange-50 text-orange-700" },
  weekend: { label: "Cuối tuần", priority: 40, icon: "weekend", color: "bg-sky-50 text-sky-700" },
};

const RULE_TYPES = Object.keys(RULE_TYPE_META) as PriceRuleType[];
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const inputClass =
  "w-full rounded-lg border border-sand px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30";

type FormState = {
  name: string;
  ruleType: PriceRuleType;
  startDate: string;
  endDate: string;
  recurringYearly: boolean;
  daysOfWeek: number[];
  direction: "increase" | "decrease";
  percentage: string;
  fixedAmount: string;
  priority: string;
  categoryIds: string[];
  isActive: boolean;
  note: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  ruleType: "holiday",
  startDate: "",
  endDate: "",
  recurringYearly: false,
  daysOfWeek: [],
  direction: "increase",
  percentage: "",
  fixedAmount: "",
  priority: "",
  categoryIds: [],
  isActive: true,
  note: "",
};

function fromRule(r: PriceRule): FormState {
  const signed = r.percentage ?? r.fixedAmount ?? 0;
  return {
    name: r.name,
    ruleType: r.ruleType,
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
    recurringYearly: r.recurringYearly,
    daysOfWeek: r.daysOfWeek,
    direction: signed < 0 ? "decrease" : "increase",
    percentage: r.percentage != null ? String(Math.abs(r.percentage)) : "",
    fixedAmount: r.fixedAmount != null ? String(Math.abs(r.fixedAmount)) : "",
    priority: String(r.priority),
    categoryIds: r.categoryIds,
    isActive: r.isActive,
    note: r.note ?? "",
  };
}

function describeAdjustment(r: PriceRule) {
  const parts: string[] = [];
  if (r.percentage) parts.push(`${r.percentage > 0 ? "+" : ""}${r.percentage}%`);
  if (r.fixedAmount) parts.push(`${r.fixedAmount > 0 ? "+" : ""}${r.fixedAmount.toLocaleString("vi-VN")}đ`);
  return parts.join(" ") || "—";
}

function describeWhen(r: PriceRule) {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-");
    return r.recurringYearly ? `${day}/${m}` : `${day}/${m}/${y}`;
  };
  const parts: string[] = [];
  if (r.startDate || r.endDate) {
    const range = r.startDate === r.endDate && r.startDate ? fmt(r.startDate) : `${r.startDate ? fmt(r.startDate) : "…"} → ${r.endDate ? fmt(r.endDate) : "…"}`;
    parts.push(r.recurringYearly ? `${range} hằng năm` : range);
  }
  if (r.daysOfWeek.length) parts.push(r.daysOfWeek.map((d) => WEEKDAYS[d]).join(", "));
  return parts.join(" · ") || "Luôn áp dụng";
}

export function PriceRulesTab({ showToast }: { showToast: (kind: "success" | "error", msg: string) => void }) {
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [categories, setCategories] = useState<GarmentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PriceRule | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<PriceRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPriceRules();
    if (res.success && res.data) setRules(res.data);
    else showToast("error", res.message ?? "Không tải được luật giá.");
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    load();
    getGarmentCategories().then((r) => r.success && r.data && setCategories(r.data));
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const sorted = useMemo(() => [...rules].sort((a, b) => b.priority - a.priority), [rules]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(r: PriceRule) {
    setEditing(r);
    setForm(fromRule(r));
    setFormOpen(true);
  }

  async function submit() {
    const sign = form.direction === "decrease" ? -1 : 1;
    const pct = form.percentage.trim() ? sign * Number(form.percentage) : null;
    const fixed = form.fixedAmount.trim() ? sign * Number(form.fixedAmount) : null;
    const payload: PriceRulePayload = {
      name: form.name.trim(),
      ruleType: form.ruleType,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      recurringYearly: form.recurringYearly,
      daysOfWeek: form.daysOfWeek,
      percentage: pct,
      fixedAmount: fixed,
      priority: form.priority.trim() ? Number(form.priority) : RULE_TYPE_META[form.ruleType].priority,
      categoryIds: form.categoryIds,
      isActive: form.isActive,
      note: form.note.trim() || null,
    };
    if (!payload.name) return showToast("error", "Vui lòng nhập tên luật giá.");
    setSaving(true);
    const res = editing ? await updatePriceRule(editing.id, payload) : await createPriceRule(payload);
    setSaving(false);
    if (!res.success) return showToast("error", res.message ?? "Lưu thất bại.");
    showToast("success", editing ? "Đã cập nhật luật giá." : "Đã tạo luật giá.");
    setFormOpen(false);
    load();
  }

  async function onToggle(r: PriceRule) {
    const res = await togglePriceRule(r.id, !r.isActive);
    if (!res.success) return showToast("error", res.message ?? "Thao tác thất bại.");
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: !r.isActive } : x)));
  }

  async function onDelete() {
    if (!toDelete) return;
    const res = await deletePriceRule(toDelete.id);
    setToDelete(null);
    if (!res.success) return showToast("error", res.message ?? "Xoá thất bại.");
    showToast("success", "Đã xoá luật giá.");
    load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-sand bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl text-ink">Luật giá tự động</h2>
            <p className="mt-1 text-sm text-stone-500">
              Giá thuê được tính tự động cho <b>từng ngày</b> trong khoảng thuê. Giá gốc sản phẩm không bị sửa — hệ thống
              lưu giá gốc, giá sau điều chỉnh và luật đã áp vào từng đơn. Nếu nhiều luật trùng ngày, chỉ luật có độ ưu tiên
              cao nhất được áp. Giá chốt thủ công ở tab “Khoảng giá hiệu lực” luôn được ưu tiên trên mọi luật.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1 text-xs font-semibold">
              {RULE_TYPES.map((t, i) => (
                <span key={t} className="flex items-center gap-1">
                  <span className={`rounded-full px-2 py-0.5 ${RULE_TYPE_META[t].color}`}>{RULE_TYPE_META[t].label}</span>
                  {i < RULE_TYPES.length - 1 && <span className="text-stone-400">›</span>}
                </span>
              ))}
              <span className="text-stone-400">›</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">Giá mặc định</span>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-lotus px-4 py-2.5 text-sm font-semibold text-white hover:bg-oxblood"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Thêm luật giá
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-sand bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-parchment text-left text-xs uppercase tracking-[0.14em] text-stone-500">
            <tr>
              <th className="px-4 py-3">Ưu tiên</th>
              <th className="px-4 py-3">Tên luật</th>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Thời gian áp dụng</th>
              <th className="px-4 py-3">Điều chỉnh</th>
              <th className="px-4 py-3">Phạm vi</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">Đang tải...</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">Chưa có luật giá nào.</td></tr>
            )}
            {sorted.map((r) => {
              const meta = RULE_TYPE_META[r.ruleType];
              const expired = !r.recurringYearly && r.endDate && r.endDate < today;
              return (
                <tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
                  <td className="px-4 py-3 font-semibold text-ink">{r.priority}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{r.name}</p>
                    {r.note && <p className="text-xs text-stone-500">{r.note}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.color}`}>
                      <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {describeWhen(r)}
                    {expired && <span className="ml-2 text-xs text-red-500">(đã qua)</span>}
                  </td>
                  <td className={`px-4 py-3 font-semibold ${((r.percentage ?? r.fixedAmount ?? 0) < 0) ? "text-jade" : "text-lotus"}`}>
                    {describeAdjustment(r)}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500">
                    {r.categoryIds.length || r.garmentIds.length
                      ? r.categoryIds.map((id) => categories.find((c) => c.id === id)?.name ?? "Danh mục").join(", ") +
                        (r.garmentIds.length ? ` +${r.garmentIds.length} sản phẩm` : "")
                      : "Tất cả sản phẩm"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onToggle(r)}
                      className={`relative h-6 w-11 rounded-full transition ${r.isActive ? "bg-jade" : "bg-stone-300"}`}
                      aria-label={r.isActive ? "Tắt luật" : "Bật luật"}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${r.isActive ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openEdit(r)} className="mr-2 text-stone-500 hover:text-lotus" title="Sửa">
                      <span className="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button type="button" onClick={() => setToDelete(r)} className="text-stone-500 hover:text-red-600" title="Xoá">
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-display text-2xl text-ink">{editing ? "Sửa luật giá" : "Thêm luật giá"}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Tên luật *</label>
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Tết Nguyên Đán 2027" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Loại ngày *</label>
                <select
                  className={inputClass}
                  value={form.ruleType}
                  onChange={(e) => {
                    const t = e.target.value as PriceRuleType;
                    setForm({
                      ...form,
                      ruleType: t,
                      daysOfWeek: t === "weekend" && form.daysOfWeek.length === 0 ? [0, 6] : form.daysOfWeek,
                      recurringYearly: t === "double_sale" ? true : form.recurringYearly,
                      direction: t === "double_sale" ? "decrease" : form.direction,
                    });
                  }}
                >
                  {RULE_TYPES.map((t) => (
                    <option key={t} value={t}>{RULE_TYPE_META[t].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">
                  Độ ưu tiên (mặc định {RULE_TYPE_META[form.ruleType].priority})
                </label>
                <input type="number" className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} placeholder={String(RULE_TYPE_META[form.ruleType].priority)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Từ ngày</label>
                <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Đến ngày</label>
                <input type="date" className={inputClass} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-600 sm:col-span-2">
                <input type="checkbox" checked={form.recurringYearly} onChange={(e) => setForm({ ...form, recurringYearly: e.target.checked })} />
                Lặp lại hằng năm (chỉ xét ngày/tháng — phù hợp sale 9/9, 10/10, lễ 30/4, 2/9…)
              </label>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Chỉ áp dụng các thứ (bỏ trống = mọi ngày)</label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((w, i) => {
                    const on = form.daysOfWeek.includes(i);
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setForm({ ...form, daysOfWeek: on ? form.daysOfWeek.filter((d) => d !== i) : [...form.daysOfWeek, i].sort() })}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${on ? "border-lotus bg-lotus text-white" : "border-sand text-stone-600"}`}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Điều chỉnh giá</label>
                <div className="flex flex-wrap gap-2">
                  <select className={`${inputClass} w-auto`} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as FormState["direction"] })}>
                    <option value="increase">Tăng giá</option>
                    <option value="decrease">Giảm giá</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} className={`${inputClass} w-24`} value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })} placeholder="0" />
                    <span className="text-sm text-stone-500">%</span>
                  </div>
                  <span className="self-center text-sm text-stone-400">và/hoặc</span>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} step={1000} className={`${inputClass} w-32`} value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })} placeholder="0" />
                    <span className="text-sm text-stone-500">đ/ngày</span>
                  </div>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Nhóm sản phẩm (bỏ trống = tất cả)</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => {
                    const on = form.categoryIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setForm({ ...form, categoryIds: on ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id] })}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-lotus bg-lotus/10 text-lotus" : "border-sand text-stone-600"}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Ghi chú</label>
                <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Kích hoạt ngay
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600">Huỷ</button>
              <button type="button" disabled={saving} onClick={submit} className="rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white hover:bg-oxblood disabled:opacity-50">
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!toDelete}
        title="Xoá luật giá"
        message={`Xoá luật "${toDelete?.name ?? ""}"? Đơn đã đặt không bị ảnh hưởng.`}
        confirmLabel="Xoá"
        danger
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
