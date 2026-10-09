"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createVoucher,
  deleteVoucher,
  getGarmentCategories,
  getVouchers,
  updateVoucher,
  type GarmentCategory,
  type Voucher,
  type VoucherPayload,
} from "@/lib/api";
import { ConfirmModal } from "@/components/heritage/ui";

const STATUS_META: Record<Voucher["status"], { label: string; cls: string }> = {
  active: { label: "Đang chạy", cls: "bg-jade/10 text-jade" },
  upcoming: { label: "Sắp diễn ra", cls: "bg-sky-50 text-sky-700" },
  expired: { label: "Hết hạn", cls: "bg-stone-100 text-stone-500" },
  exhausted: { label: "Hết lượt", cls: "bg-amber-50 text-amber-700" },
  inactive: { label: "Tạm tắt", cls: "bg-red-50 text-red-600" },
};

const inputClass =
  "w-full rounded-lg border border-sand px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30";

const formatVND = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

type FormState = {
  code: string;
  name: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: string;
  maxDiscountAmount: string;
  minOrderValue: string;
  usageLimit: string;
  perUserLimit: string;
  startAt: string;
  endAt: string;
  categoryIds: string[];
  isActive: boolean;
};

function emptyForm(): FormState {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  return {
    code: "",
    name: "",
    description: "",
    discountType: "percentage",
    discountValue: "",
    maxDiscountAmount: "",
    minOrderValue: "0",
    usageLimit: "",
    perUserLimit: "1",
    startAt: toLocalInput(now.toISOString()),
    endAt: toLocalInput(in30.toISOString()),
    categoryIds: [],
    isActive: true,
  };
}

function fromVoucher(v: Voucher): FormState {
  return {
    code: v.code,
    name: v.name,
    description: v.description ?? "",
    discountType: v.discountType,
    discountValue: String(v.discountValue),
    maxDiscountAmount: v.maxDiscountAmount != null ? String(v.maxDiscountAmount) : "",
    minOrderValue: String(v.minOrderValue),
    usageLimit: v.usageLimit != null ? String(v.usageLimit) : "",
    perUserLimit: v.perUserLimit != null ? String(v.perUserLimit) : "",
    startAt: toLocalInput(v.startAt),
    endAt: toLocalInput(v.endAt),
    categoryIds: v.categoryIds,
    isActive: v.isActive,
  };
}

export function VouchersManagerClient() {
  const [items, setItems] = useState<Voucher[]>([]);
  const [categories, setCategories] = useState<GarmentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Voucher | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Voucher | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const show = useCallback((kind: "success" | "error", message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getVouchers({ status: status || undefined, search: search.trim() || undefined });
    if (res.success && res.data) setItems(res.data);
    else show("error", res.message ?? "Không tải được voucher.");
    setLoading(false);
  }, [status, search, show]);

  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getGarmentCategories().then((r) => r.success && r.data && setCategories(r.data));
  }, []);

  async function submit() {
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const payload: VoucherPayload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      maxDiscountAmount: form.discountType === "percentage" ? num(form.maxDiscountAmount) : null,
      minOrderValue: Number(form.minOrderValue || 0),
      usageLimit: num(form.usageLimit),
      perUserLimit: num(form.perUserLimit),
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString(),
      categoryIds: form.categoryIds,
      isActive: form.isActive,
    };
    if (!payload.code || !payload.name || !payload.discountValue) {
      return show("error", "Vui lòng nhập mã, tên và giá trị giảm.");
    }
    setSaving(true);
    const { code: _code, ...updatePayload } = payload;
    const res = editing ? await updateVoucher(editing.id, updatePayload) : await createVoucher(payload);
    setSaving(false);
    if (!res.success) return show("error", res.message ?? "Lưu thất bại.");
    show("success", editing ? "Đã cập nhật voucher." : "Đã tạo voucher.");
    setFormOpen(false);
    load();
  }

  async function onDelete() {
    if (!toDelete) return;
    const res = await deleteVoucher(toDelete.id);
    setToDelete(null);
    if (!res.success) return show("error", res.message ?? "Xoá thất bại.");
    show("success", res.message ?? "Đã xoá voucher.");
    load();
  }

  async function quickToggle(v: Voucher) {
    const res = await updateVoucher(v.id, { isActive: !v.isActive });
    if (!res.success) return show("error", res.message ?? "Thao tác thất bại.");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500">Tìm kiếm</label>
            <input
              className={`${inputClass} w-56`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") load(); }}
              placeholder="Mã hoặc tên voucher"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500">Trạng thái</label>
            <select className={`${inputClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="active">Đang chạy</option>
              <option value="upcoming">Sắp diễn ra</option>
              <option value="expired">Hết hạn</option>
              <option value="inactive">Tạm tắt</option>
            </select>
          </div>
          <button type="button" onClick={load} className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 hover:border-lotus hover:text-lotus">Lọc</button>
        </div>
        <button
          type="button"
          onClick={() => { setEditing(null); setForm(emptyForm()); setFormOpen(true); }}
          className="inline-flex items-center gap-2 rounded-xl bg-lotus px-4 py-2.5 text-sm font-semibold text-white hover:bg-oxblood"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Tạo voucher
        </button>
      </div>

      <section className="overflow-x-auto rounded-xl border border-sand bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-parchment text-left text-xs uppercase tracking-[0.14em] text-stone-500">
            <tr>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Giảm</th>
              <th className="px-4 py-3">Điều kiện</th>
              <th className="px-4 py-3">Lượt dùng</th>
              <th className="px-4 py-3">Hiệu lực</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">Đang tải...</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">Chưa có voucher nào.</td></tr>}
            {items.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3">
                  <p className="font-mono font-semibold text-lotus">{v.code}</p>
                  <p className="text-xs text-stone-500">{v.name}</p>
                </td>
                <td className="px-4 py-3 font-semibold text-ink">
                  {v.discountType === "percentage" ? `${v.discountValue}%` : formatVND(v.discountValue)}
                  {v.maxDiscountAmount != null && <p className="text-xs font-normal text-stone-500">tối đa {formatVND(v.maxDiscountAmount)}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-stone-600">
                  {v.minOrderValue > 0 ? `Đơn từ ${formatVND(v.minOrderValue)}` : "Không yêu cầu"}
                  <br />
                  {v.categoryIds.length
                    ? v.categoryIds.map((id) => categories.find((c) => c.id === id)?.name ?? "Danh mục").join(", ")
                    : "Mọi sản phẩm"}
                </td>
                <td className="px-4 py-3 text-stone-600">
                  {v.usedCount}/{v.usageLimit ?? "∞"}
                  <p className="text-xs text-stone-500">{v.perUserLimit ? `${v.perUserLimit} lần/khách` : "Không giới hạn/khách"}</p>
                </td>
                <td className="px-4 py-3 text-xs text-stone-600">
                  {new Date(v.startAt).toLocaleString("vi-VN")}
                  <br />→ {new Date(v.endAt).toLocaleString("vi-VN")}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_META[v.status].cls}`}>{STATUS_META[v.status].label}</span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => quickToggle(v)} className="mr-2 text-stone-500 hover:text-lotus" title={v.isActive ? "Tạm tắt" : "Bật lại"}>
                    <span className="material-symbols-outlined text-[20px]">{v.isActive ? "pause_circle" : "play_circle"}</span>
                  </button>
                  <button type="button" onClick={() => { setEditing(v); setForm(fromVoucher(v)); setFormOpen(true); }} className="mr-2 text-stone-500 hover:text-lotus" title="Sửa">
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                  </button>
                  <button type="button" onClick={() => setToDelete(v)} className="text-stone-500 hover:text-red-600" title="Xoá">
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-display text-2xl text-ink">{editing ? `Sửa voucher ${editing.code}` : "Tạo voucher"}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Mã voucher *</label>
                <input className={`${inputClass} font-mono uppercase`} disabled={!!editing} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="TET2027" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Tên chương trình *</label>
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Mô tả</label>
                <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Kiểu giảm</label>
                <select className={inputClass} value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as FormState["discountType"] })}>
                  <option value="percentage">Theo phần trăm</option>
                  <option value="fixed">Số tiền cố định</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Giá trị giảm * {form.discountType === "percentage" ? "(%)" : "(đ)"}</label>
                <input type="number" min={1} max={form.discountType === "percentage" ? 100 : undefined} className={inputClass} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
              </div>
              {form.discountType === "percentage" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-stone-500">Giảm tối đa (đ, bỏ trống = không giới hạn)</label>
                  <input type="number" min={0} step={1000} className={inputClass} value={form.maxDiscountAmount} onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })} />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Giá trị đơn tối thiểu (đ)</label>
                <input type="number" min={0} step={1000} className={inputClass} value={form.minOrderValue} onChange={(e) => setForm({ ...form, minOrderValue: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Tổng lượt dùng (bỏ trống = không giới hạn)</label>
                <input type="number" min={1} className={inputClass} value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Số lần mỗi khách (bỏ trống = không giới hạn)</label>
                <input type="number" min={1} className={inputClass} value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Bắt đầu *</label>
                <input type="datetime-local" className={inputClass} value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500">Kết thúc *</label>
                <input type="datetime-local" className={inputClass} value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-stone-500">Nhóm sản phẩm áp dụng (bỏ trống = tất cả)</label>
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
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Kích hoạt
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
        title="Xoá voucher"
        message={`Xoá voucher ${toDelete?.code ?? ""}? Nếu voucher đã được dùng, hệ thống chỉ vô hiệu hoá để giữ lịch sử.`}
        confirmLabel="Xoá"
        danger
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />

      {toast && (
        <div className={`fixed right-6 top-20 z-[120] flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold shadow-lg ${toast.kind === "success" ? "border-jade/30 bg-jade/5 text-jade" : "border-red-200 bg-red-50 text-red-700"}`}>
          <span className="material-symbols-outlined text-[20px]">{toast.kind === "success" ? "check_circle" : "error"}</span>
          {toast.message}
        </div>
      )}
    </div>
  );
}
