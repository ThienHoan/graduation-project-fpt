"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  createAccessory,
  createAccessoryAsset,
  getAccessories,
  getAccessoryAssetHistory,
  getAccessoryAssets,
  getAccessoryById,
  getAccessoryGarments,
  updateAccessory,
  updateAccessoryAssetStatus,
  type AccessoryAsset,
  type AccessoryAssetHistory,
  type AccessoryDetail,
  type AccessoryItem,
  type AccessoryPayload,
  type LinkedGarment,
} from "@/lib/api";

const ASSET_STATUS_LABELS: Record<string, string> = {
  available: "Sẵn sàng",
  reserved: "Đã giữ",
  rented: "Đang thuê",
  inspection_pending: "Chờ kiểm tra",
  laundry: "Đang giặt",
  maintenance: "Bảo trì",
  damaged: "Hư hỏng",
  retired: "Ngừng dùng",
  lost: "Thất lạc",
};

const ASSET_STATUSES = Object.keys(ASSET_STATUS_LABELS);

function formatVND(n: number | null | undefined) {
  return `${Math.round(n ?? 0).toLocaleString("vi-VN")}đ`;
}

type Toast = { kind: "success" | "error"; message: string } | null;

function statusBadge(status: string) {
  const tone =
    status === "available"
      ? "bg-jade/10 text-jade"
      : status === "rented" || status === "reserved"
        ? "bg-blue-50 text-blue-700"
        : status === "damaged" || status === "lost"
          ? "bg-red-50 text-red-600"
          : status === "retired"
            ? "bg-stone-100 text-stone-500"
            : "bg-amber-50 text-amber-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {ASSET_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function AccessoriesManagerClient() {
  const [items, setItems] = useState<AccessoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AccessoryDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AccessoryAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [history, setHistory] = useState<Record<string, AccessoryAssetHistory[]>>({});
  const [linkedOpenId, setLinkedOpenId] = useState<string | null>(null);
  const [linkedGarments, setLinkedGarments] = useState<Record<string, LinkedGarment[]>>({});
  const [linkedLoadingId, setLinkedLoadingId] = useState<string | null>(null);

  function showToast(kind: "success" | "error", message: string) {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 4000);
  }

  async function load() {
    setLoading(true);
    const res = await getAccessories(showInactive);
    setLoading(false);
    if (res.success && res.data) {
      setItems(res.data);
    } else {
      showToast("error", res.message ?? "Không thể tải kho phụ kiện.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  async function refreshAssets(accessoryId: string) {
    setAssetsLoading(true);
    const res = await getAccessoryAssets(accessoryId);
    setAssetsLoading(false);
    if (res.success && res.data) {
      setAssets(res.data);
    } else {
      showToast("error", res.message ?? "Không thể tải tài sản.");
    }
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  async function openEdit(item: AccessoryItem) {
    const res = await getAccessoryById(item.id);
    if (res.success && res.data) {
      setEditing(res.data);
      setModalOpen(true);
    } else {
      showToast("error", res.message ?? "Không thể tải chi tiết phụ kiện.");
    }
  }

  function selectAccessory(id: string) {
    setSelectedId(id);
    setHistory({});
    void refreshAssets(id);
  }

  async function toggleLinkedGarments(id: string) {
    if (linkedOpenId === id) {
      setLinkedOpenId(null);
      return;
    }
    setLinkedOpenId(id);
    if (linkedGarments[id]) return;
    setLinkedLoadingId(id);
    const res = await getAccessoryGarments(id);
    setLinkedLoadingId(null);
    if (res.success && res.data) {
      setLinkedGarments((prev) => ({ ...prev, [id]: res.data! }));
    } else {
      showToast("error", res.message ?? "Không thể tải danh sách trang phục.");
      setLinkedOpenId(null);
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of items) {
      if (a.category?.trim()) set.add(a.category.trim());
    }
    return [...set].sort((x, y) => x.localeCompare(y, "vi"));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      if (categoryFilter !== "all" && (a.category?.trim() ?? "") !== categoryFilter) return false;
      if (!q) return true;
      return [a.code, a.name, a.category].some((v) => v?.toLowerCase().includes(q));
    });
  }, [items, search, categoryFilter]);

  const selected = items.find((a) => a.id === selectedId) ?? null;
  const totalAssets = items.reduce((s, a) => s + a.assetCount, 0);

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            toast.kind === "success"
              ? "border-jade/30 bg-jade/5 text-jade"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Loại phụ kiện", value: items.length },
          { label: "Tổng tài sản", value: totalAssets },
          { label: "Đang hoạt động", value: items.filter((a) => a.isActive).length },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{s.label}</p>
            <p className="mt-1 font-display text-4xl text-ink">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-stone-400">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã, tên, nhóm..."
            className="w-full rounded-lg border border-sand bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-antique"
          />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-[#8B0000]"
          />
          Hiện cả mục đã ẩn
        </label>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-antique"
          aria-label="Lọc theo nhóm phụ kiện"
        >
          <option value="all">Tất cả nhóm ({items.length})</option>
          {categories.map((c) => {
            const n = items.filter((a) => (a.category?.trim() ?? "") === c).length;
            return (
              <option key={c} value={c}>
                {c} ({n})
              </option>
            );
          })}
        </select>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-lotus px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Thêm phụ kiện
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p className="py-10 text-center text-sm text-stone-400">Đang tải kho phụ kiện...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sand bg-white py-10 text-center text-sm text-stone-500">
          Chưa có phụ kiện nào. Nhấn “Thêm phụ kiện” để bắt đầu.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((a) => (
            <div
              key={a.id}
              className={`rounded-xl border bg-white p-5 shadow-sm transition ${
                selectedId === a.id ? "border-lotus" : "border-sand"
              } ${a.isActive ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt={a.name} className="h-14 w-14 shrink-0 rounded-lg border border-sand object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-sand bg-mist">
                      <span className="material-symbols-outlined text-xl text-stone-300">diamond</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-antique">{a.code}</p>
                    <h3 className="mt-0.5 truncate font-display text-2xl text-ink">{a.name}</h3>
                    <p className="mt-1 text-xs text-stone-500">
                      {[a.category, a.color, a.material].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </div>
                {!a.isActive && (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-500">
                    Đã ẩn
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm text-stone-600">
                  <span className="font-semibold text-ink">{a.assetCount}</span> tài sản
                  {a.replacementValue > 0 && (
                    <span className="text-stone-400"> · Đền {formatVND(a.replacementValue)}</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => selectAccessory(a.id)}
                    className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-antique"
                  >
                    {selectedId === a.id ? "Đang xem" : "Tài sản"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleLinkedGarments(a.id)}
                    className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-jade transition hover:border-jade"
                  >
                    {linkedOpenId === a.id ? "Ẩn mẫu gắn" : "Mẫu đang gắn"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openEdit(a)}
                    className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-lotus transition hover:border-lotus"
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleActive(a)}
                    className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-500 transition hover:border-antique"
                  >
                    {a.isActive ? "Ẩn" : "Hiện"}
                  </button>
                </div>
              </div>
              {linkedOpenId === a.id && (
                <div className="mt-3 rounded-lg border border-sand bg-mist/60 p-3">
                  {linkedLoadingId === a.id ? (
                    <p className="text-xs text-stone-400">Đang tải...</p>
                  ) : (linkedGarments[a.id] ?? []).length === 0 ? (
                    <p className="text-xs text-stone-500">Chưa gắn cho mẫu trang phục nào.</p>
                  ) : (
                    <ul className="space-y-2">
                      {(linkedGarments[a.id] ?? []).map((g) => (
                        <li key={g.garmentId} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate font-medium text-ink">
                            {g.name}
                            {!g.isActive && <span className="ml-1 text-stone-400">(đã ẩn)</span>}
                          </span>
                          <span className="shrink-0 text-stone-500">
                            Size: {g.sizes.length > 0 ? g.sizes.join(", ") : "—"} · SL {g.quantity}
                            {g.isIncluded ? "" : " · thuê kèm"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Assets of selected accessory */}
      {selected && (
        <AssetsPanel
          accessory={selected}
          assets={assets}
          loading={assetsLoading}
          history={history}
          onAddAsset={() => setAssetModalOpen(true)}
          onStatusChange={handleAssetStatus}
          onToggleHistory={(assetId) => void toggleHistory(assetId)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {modalOpen && (
        <AccessoryFormModal
          initial={editing}
          saving={saving}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSubmit={handleSaveAccessory}
        />
      )}

      {assetModalOpen && selected && (
        <AccessoryAssetFormModal
          accessoryId={selected.id}
          accessoryName={selected.name}
          onClose={() => setAssetModalOpen(false)}
          onSubmit={handleCreateAsset}
        />
      )}
    </div>
  );

  async function toggleActive(a: AccessoryItem) {
    const res = await updateAccessory(a.id, { isActive: !a.isActive });
    if (res.success) {
      showToast("success", a.isActive ? `Đã ẩn "${a.name}".` : `Đã hiện "${a.name}".`);
      await load();
      if (selectedId === a.id) await refreshAssets(a.id);
    } else {
      showToast("error", res.message ?? "Không thể cập nhật.");
    }
  }

  async function handleSaveAccessory(payload: AccessoryPayload, id?: string) {
    setSaving(true);
    const res = id ? await updateAccessory(id, payload) : await createAccessory(payload);
    setSaving(false);
    if (res.success) {
      showToast("success", id ? "Đã cập nhật phụ kiện." : "Đã thêm phụ kiện.");
      setModalOpen(false);
      setEditing(null);
      await load();
    } else {
      showToast("error", res.message ?? "Không thể lưu phụ kiện.");
    }
  }

  async function handleCreateAsset(payload: { assetCode: string; conditionNote?: string }) {
    if (!selected) return;
    const res = await createAccessoryAsset({ accessoryId: selected.id, ...payload });
    if (res.success) {
      showToast("success", `Đã thêm tài sản ${payload.assetCode}.`);
      setAssetModalOpen(false);
      await refreshAssets(selected.id);
      await load();
    } else {
      showToast("error", res.message ?? "Không thể tạo tài sản.");
    }
  }

  async function handleAssetStatus(asset: AccessoryAsset, status: string, note?: string) {
    const res = await updateAccessoryAssetStatus(asset.id, { status, note });
    if (res.success) {
      showToast("success", `Đã chuyển ${asset.assetCode} sang "${ASSET_STATUS_LABELS[status] ?? status}".`);
      if (selected) await refreshAssets(selected.id);
    } else {
      showToast("error", res.message ?? "Không thể cập nhật trạng thái.");
    }
  }

  async function toggleHistory(assetId: string) {
    if (history[assetId]) {
      setHistory((prev) => {
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
      return;
    }
    const res = await getAccessoryAssetHistory(assetId);
    if (res.success && res.data) {
      setHistory((prev) => ({ ...prev, [assetId]: res.data! }));
    } else {
      showToast("error", res.message ?? "Không thể tải lịch sử.");
    }
  }
}

function AssetsPanel({
  accessory,
  assets,
  loading,
  history,
  onAddAsset,
  onStatusChange,
  onToggleHistory,
  onClose,
}: {
  accessory: AccessoryItem;
  assets: AccessoryAsset[];
  loading: boolean;
  history: Record<string, AccessoryAssetHistory[]>;
  onAddAsset: () => void;
  onStatusChange: (asset: AccessoryAsset, status: string, note?: string) => void;
  onToggleHistory: (assetId: string) => void;
  onClose: () => void;
}) {
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [statusValue, setStatusValue] = useState("available");
  const [statusNote, setStatusNote] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const visibleAssets =
    statusFilter === "all" ? assets : assets.filter((a) => a.status === statusFilter);

  return (
    <section className="rounded-xl border border-sand bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl text-ink">Tài sản: {accessory.name}</h2>
          <p className="mt-1 text-xs text-stone-500">
            Mã {accessory.code} · {assets.length} món
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddAsset}
            className="inline-flex items-center gap-2 rounded-lg bg-jade px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Thêm tài sản
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-sand text-stone-500 transition hover:border-antique hover:text-lotus"
            aria-label="Đóng bảng tài sản"
            title="Đóng bảng tài sản"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Lọc trạng thái:
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-sand bg-white px-3 py-1.5 text-sm outline-none focus:border-antique"
        >
          <option value="all">Tất cả ({assets.length})</option>
          {ASSET_STATUSES.map((s) => {
            const n = assets.filter((a) => a.status === s).length;
            if (n === 0) return null;
            return (
              <option key={s} value={s}>
                {ASSET_STATUS_LABELS[s]} ({n})
              </option>
            );
          })}
        </select>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-stone-400">Đang tải tài sản...</p>
      ) : visibleAssets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-sand bg-mist py-8 text-center text-sm text-stone-500">
          {assets.length === 0
            ? "Chưa có món vật lý nào. Nhấn “Thêm tài sản” để nhập kho."
            : "Không có tài sản nào ở trạng thái này."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-sand text-xs uppercase tracking-wider text-stone-400">
                <th className="py-2 pr-4 font-semibold">Mã tài sản</th>
                <th className="py-2 pr-4 font-semibold">Trạng thái</th>
                <th className="py-2 pr-4 font-semibold">Ghi chú</th>
                <th className="py-2 text-right font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visibleAssets.map((a) => (
                <Fragment key={a.id}>
                  <tr key={a.id} className="border-b border-sand/60 last:border-0">
                    <td className="py-3 pr-4 font-mono font-semibold text-ink">{a.assetCode}</td>
                    <td className="py-3 pr-4">{statusBadge(a.status)}</td>
                    <td className="max-w-[220px] truncate py-3 pr-4 text-stone-500">{a.conditionNote ?? "—"}</td>
                    <td className="py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStatusId(editingStatusId === a.id ? null : a.id);
                            setStatusValue(a.status);
                            setStatusNote("");
                          }}
                          className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-antique"
                        >
                          Đổi trạng thái
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleHistory(a.id)}
                          className="rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-500 transition hover:border-antique"
                        >
                          Lịch sử
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingStatusId === a.id && (
                    <tr key={`${a.id}-edit`} className="border-b border-sand/60 bg-mist/50">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={statusValue}
                            onChange={(e) => setStatusValue(e.target.value)}
                            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-antique"
                          >
                            {ASSET_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {ASSET_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          <input
                            value={statusNote}
                            onChange={(e) => setStatusNote(e.target.value)}
                            placeholder="Ghi chú (không bắt buộc)"
                            className="min-w-[200px] flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-antique"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              onStatusChange(a, statusValue, statusNote || undefined);
                              setEditingStatusId(null);
                            }}
                            className="rounded-lg bg-lotus px-4 py-2 text-xs font-semibold text-white transition hover:bg-oxblood"
                          >
                            Lưu
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {history[a.id] && (
                    <tr key={`${a.id}-history`} className="border-b border-sand/60 bg-stone-50/60">
                      <td colSpan={4} className="px-4 py-3">
                        {history[a.id].length === 0 ? (
                          <p className="text-xs text-stone-400">Chưa có lịch sử.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {history[a.id].map((h) => (
                              <li key={h.id} className="text-xs text-stone-600">
                                <span className="font-semibold text-ink">
                                  {h.action === "created"
                                    ? "Tạo mới"
                                    : `${ASSET_STATUS_LABELS[h.oldStatus ?? ""] ?? h.oldStatus ?? "?"} → ${ASSET_STATUS_LABELS[h.newStatus ?? ""] ?? h.newStatus ?? "?"}`}
                                </span>{" "}
                                · {new Date(h.createdAt).toLocaleString("vi-VN")}
                                {h.createdBy && (
                                  <span className="text-stone-500">
                                    {" "}· bởi{" "}
                                    {h.createdBy.name
                                      ? `${h.createdBy.name} (${h.createdBy.email})`
                                      : h.createdBy.email}
                                  </span>
                                )}
                                {h.note && <span className="text-stone-500"> · {h.note}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AccessoryFormModal({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: AccessoryDetail | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: AccessoryPayload, id?: string) => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [material, setMaterial] = useState(initial?.material ?? "");
  const [color, setColor] = useState(initial?.color ?? "");
  const [replacementValue, setReplacementValue] = useState(
    initial?.replacementValue ? String(initial.replacementValue) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imagePreview, setImagePreview] = useState<string | null>(initial?.imageUrl ?? null);
  const [pendingUpload, setPendingUpload] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function deleteStoredFile(url: string) {
    await fetch("/api/upload", {
      method: "DELETE",
      body: JSON.stringify({ url, bucket: "accessories" }),
    }).catch(() => {});
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((prev) => ({ ...prev, image: "Chỉ chấp nhận file ảnh." }));
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bucket", "accessories");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        if (pendingUpload) await deleteStoredFile(pendingUpload);
        setPendingUpload(data.url);
        setImagePreview(data.url);
        setErrors((prev) => {
          const next = { ...prev };
          delete next.image;
          return next;
        });
      } else {
        setErrors((prev) => ({ ...prev, image: data.message ?? "Tải ảnh thất bại." }));
      }
    } catch {
      setErrors((prev) => ({ ...prev, image: "Tải ảnh thất bại. Vui lòng thử lại." }));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveImage() {
    if (pendingUpload) {
      await deleteStoredFile(pendingUpload);
      setPendingUpload(null);
    }
    setImagePreview(null);
  }

  async function handleClose() {
    // Ảnh vừa upload nhưng chưa lưu thì dọn để khỏi rác trong bucket
    if (pendingUpload && !saved) {
      await deleteStoredFile(pendingUpload);
    }
    onClose();
  }

  const inputClass = (bad?: string) =>
    `w-full rounded-lg border ${bad ? "border-red-500" : "border-sand"} px-3 py-2 text-sm outline-none focus:border-antique`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!code.trim()) errs.code = "Vui lòng nhập mã phụ kiện.";
    if (!name.trim()) errs.name = "Vui lòng nhập tên phụ kiện.";
    const replacement = replacementValue.trim() ? Number(replacementValue.replace(/\D/g, "")) : undefined;
    if (replacement !== undefined && (!Number.isFinite(replacement) || replacement < 0)) {
      errs.replacementValue = "Giá trị đền bù không hợp lệ.";
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaved(true);
    onSubmit(
      {
        code: code.trim(),
        name: name.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        material: material.trim() || undefined,
        color: color.trim() || undefined,
        imageUrl: imagePreview,
        replacementValue: replacement,
      },
      initial?.id,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-sand bg-white p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-display text-2xl text-ink">{initial ? "Sửa phụ kiện" : "Thêm phụ kiện"}</h3>
          <button type="button" onClick={() => void handleClose()} className="text-stone-500 hover:text-lotus">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Mã *</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputClass(errors.code)}
                placeholder="Vd: PK-A01"
              />
              {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">
                Giá trị đền bù (VNĐ)
              </label>
              <input
                value={replacementValue}
                onChange={(e) => setReplacementValue(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={inputClass(errors.replacementValue)}
                placeholder="Vd: 500000"
              />
              {errors.replacementValue && <p className="mt-1 text-xs text-red-500">{errors.replacementValue}</p>}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Tên *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass(errors.name)}
              placeholder="Vd: Mấn vàng đính đá"
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Nhóm</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass()}
                placeholder="Mấn, Quạt..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Chất liệu</label>
              <input
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className={inputClass()}
                placeholder="Vd: Lụa"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Màu</label>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={inputClass()}
                placeholder="Vd: Vàng"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Mô tả</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={inputClass()}
              placeholder="Mô tả phụ kiện..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">Ảnh phụ kiện</label>
            {imagePreview ? (
              <div className="relative overflow-hidden rounded-lg border border-sand bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Ảnh phụ kiện xem trước" className="h-40 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => void handleRemoveImage()}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                  aria-label="Gỡ ảnh"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/*"
                onChange={(e) => void handleFileSelect(e)}
                disabled={uploading}
                className="block w-full text-xs text-stone-500 file:mr-3 file:rounded file:border-0 file:bg-sand/30 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink hover:file:bg-sand/50"
              />
            )}
            {uploading && <p className="mt-1 text-xs text-stone-400">Đang tải lên...</p>}
            {errors.image && <p className="mt-1 text-xs text-red-500">{errors.image}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => void handleClose()}
            className="rounded-lg border border-sand px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-lotus px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : initial ? "Lưu thay đổi" : "Tạo phụ kiện"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AccessoryAssetFormModal({
  accessoryId,
  accessoryName,
  onClose,
  onSubmit,
}: {
  accessoryId: string;
  accessoryName: string;
  onClose: () => void;
  onSubmit: (payload: { assetCode: string; conditionNote?: string }) => void;
}) {
  const [assetCode, setAssetCode] = useState("");
  const [conditionNote, setConditionNote] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      assetCode: assetCode.trim(),
      conditionNote: conditionNote.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-sand bg-white p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-display text-2xl text-ink">Thêm tài sản mới</h3>
          <button type="button" onClick={onClose} className="text-stone-500 hover:text-lotus">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="mb-4 text-sm text-stone-500">
          Phụ kiện: <strong className="text-ink">{accessoryName}</strong>
        </p>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">
              Mã tài sản *
            </label>
            <input
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              required
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
              placeholder="Vd: PKA-001"
            />
            <p className="mt-1 text-xs text-stone-400">Mã duy nhất cho món đồ vật lý.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-stone-500">
              Ghi chú tình trạng
            </label>
            <input
              value={conditionNote}
              onChange={(e) => setConditionNote(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
              placeholder="Vd: Mới 100%"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-sand px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="rounded-lg bg-jade px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Tạo tài sản
          </button>
        </div>
      </form>
    </div>
  );
}
