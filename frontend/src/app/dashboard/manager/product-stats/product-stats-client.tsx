"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGarmentCategories,
  getProductStats,
  type GarmentCategory,
  type ProductStat,
  type ProductStatsResponse,
} from "@/lib/api";

const formatVND = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(n < 0.1 && n > 0 ? 1 : 0)}%`);

const CLASS_META: Record<ProductStat["classification"], { label: string; cls: string }> = {
  HOT: { label: "HOT", cls: "bg-lotus text-white" },
  LOW_DEMAND: { label: "Ít được thuê", cls: "bg-amber-100 text-amber-800" },
  NORMAL: { label: "Bình thường", cls: "bg-stone-100 text-stone-600" },
  NEW: { label: "Mới", cls: "bg-sky-50 text-sky-700" },
};

const REC_ICON: Record<string, string> = {
  discount: "sell",
  promote: "campaign",
  discontinue_review: "inventory",
  reduce_stock: "remove_shopping_cart",
  quality_check: "fact_check",
};

const inputClass =
  "rounded-lg border border-sand px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lotus/30";

type SortKey = "revenue" | "rentCount" | "occupancyRate" | "cancelRate" | "availableDays" | "views" | "tryons" | "avgRating";

const COLUMNS: Array<{ key: SortKey; label: string; render: (s: ProductStat) => string }> = [
  { key: "rentCount", label: "Lượt thuê", render: (s) => String(s.rentCount) },
  { key: "revenue", label: "Doanh thu", render: (s) => formatVND(s.revenue) },
  { key: "occupancyRate", label: "Tỷ lệ được đặt", render: (s) => pct(s.occupancyRate) },
  { key: "cancelRate", label: "Tỷ lệ huỷ", render: (s) => pct(s.cancelRate) },
  { key: "availableDays", label: "Ngày còn trống", render: (s) => `${s.availableDays}` },
  { key: "views", label: "Lượt xem", render: (s) => String(s.views) },
  { key: "tryons", label: "Thử AI", render: (s) => String(s.tryons) },
  { key: "avgRating", label: "Đánh giá", render: (s) => (s.avgRating != null ? `${s.avgRating.toFixed(1)}★ (${s.reviewCount})` : "—") },
];

function isoDaysAgo(n: number) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

function Thumb({ s }: { s: ProductStat }) {
  return s.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={s.imageUrl} alt="" className="h-12 w-10 shrink-0 rounded object-cover" />
  ) : (
    <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded bg-lotus/10">
      <span className="material-symbols-outlined text-antique/60">checkroom</span>
    </div>
  );
}

export function ProductStatsClient() {
  const [data, setData] = useState<ProductStatsResponse | null>(null);
  const [categories, setCategories] = useState<GarmentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    from: isoDaysAgo(89),
    to: isoDaysAgo(0),
    sortBy: "revenue" as "revenue" | "bookings",
    hotLimit: 10,
    lowDemandMaxRentals: 1,
    categoryId: "",
  });
  const [tableSort, setTableSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "revenue", dir: -1 });
  const [tableFilter, setTableFilter] = useState<"" | ProductStat["classification"]>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getProductStats({ ...filters, categoryId: filters.categoryId || undefined });
    if (res.success && res.data) setData(res.data);
    else setError(res.message ?? "Không tải được thống kê.");
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getGarmentCategories().then((r) => r.success && r.data && setCategories(r.data));
  }, []);

  const tableRows = useMemo(() => {
    const rows = (data?.items ?? []).filter((s) => !tableFilter || s.classification === tableFilter);
    return [...rows].sort((a, b) => ((a[tableSort.key] ?? -1) as number) > ((b[tableSort.key] ?? -1) as number) ? tableSort.dir : -tableSort.dir);
  }, [data, tableSort, tableFilter]);

  const maxHotValue = Math.max(1, ...(data?.hot ?? []).map((s) => (filters.sortBy === "revenue" ? s.revenue : s.rentCount)));

  return (
    <div className="space-y-6">
      {/* Bộ lọc */}
      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-sand bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Từ ngày</label>
          <input type="date" className={inputClass} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Đến ngày</label>
          <input type="date" className={inputClass} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div className="flex gap-1">
          {[30, 90, 180].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setFilters({ ...filters, from: isoDaysAgo(n - 1), to: isoDaysAgo(0) })}
              className="rounded-lg border border-sand px-3 py-2 text-xs font-semibold text-stone-600 hover:border-lotus hover:text-lotus"
            >
              {n} ngày
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Xếp hạng HOT theo</label>
          <select className={inputClass} value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as "revenue" | "bookings" })}>
            <option value="revenue">Doanh thu</option>
            <option value="bookings">Số booking</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Số SP HOT</label>
          <input type="number" min={1} max={100} className={`${inputClass} w-20`} value={filters.hotLimit} onChange={(e) => setFilters({ ...filters, hotLimit: Number(e.target.value) || 10 })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Ít thuê khi ≤ (lượt)</label>
          <input type="number" min={0} className={`${inputClass} w-20`} value={filters.lowDemandMaxRentals} onChange={(e) => setFilters({ ...filters, lowDemandMaxRentals: Math.max(0, Number(e.target.value)) })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Danh mục</label>
          <select className={inputClass} value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
            <option value="">Tất cả</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="button" onClick={load} className="rounded-lg bg-lotus px-5 py-2 text-sm font-semibold text-white hover:bg-oxblood">
          Xem thống kê
        </button>
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && !data && <p className="text-sm text-stone-400">Đang tải...</p>}

      {data && (
        <>
          {/* KPI */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Tổng lượt thuê", value: data.summary.totalRentals.toLocaleString("vi-VN"), icon: "shopping_bag" },
              { label: "Doanh thu thuê", value: formatVND(data.summary.totalRevenue), icon: "payments" },
              { label: "Tỷ lệ được đặt TB", value: pct(data.summary.avgOccupancyRate), icon: "event_available" },
              { label: "Tỷ lệ huỷ", value: pct(data.summary.cancelRate), icon: "event_busy" },
              { label: "Lượt xem", value: data.summary.totalViews.toLocaleString("vi-VN"), icon: "visibility" },
              { label: "Lượt thử AI", value: data.summary.totalTryons.toLocaleString("vi-VN"), icon: "auto_awesome" },
              { label: "Sản phẩm HOT", value: String(data.summary.hotCount), icon: "local_fire_department" },
              { label: "Ít được thuê", value: String(data.summary.lowDemandCount), icon: "trending_down" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-sand bg-white p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                  <span className="material-symbols-outlined text-[18px] text-antique">{k.icon}</span>
                  {k.label}
                </div>
                <p className="mt-2 font-display text-3xl text-ink">{k.value}</p>
              </div>
            ))}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            {/* HOT */}
            <section className="rounded-xl border border-sand bg-white p-5">
              <h2 className="mb-1 flex items-center gap-2 font-display text-2xl text-ink">
                <span className="material-symbols-outlined text-lotus">local_fire_department</span>
                Sản phẩm HOT
              </h2>
              <p className="mb-4 text-xs text-stone-500">
                Top {filters.hotLimit} theo {filters.sortBy === "revenue" ? "doanh thu" : "số booking"} · {data.period.from} → {data.period.to}
              </p>
              {data.hot.length === 0 && <p className="text-sm text-stone-400">Chưa có lượt thuê trong kỳ.</p>}
              <ol className="space-y-3">
                {data.hot.map((s) => {
                  const value = filters.sortBy === "revenue" ? s.revenue : s.rentCount;
                  return (
                    <li key={s.garmentId} className="flex items-center gap-3">
                      <span className="w-6 text-right font-display text-lg text-antique">{s.hotRank}</span>
                      <Thumb s={s} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                          <p className="shrink-0 text-sm font-semibold text-lotus">
                            {filters.sortBy === "revenue" ? formatVND(s.revenue) : `${s.rentCount} lượt`}
                          </p>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-sand/60">
                          <div className="h-1.5 rounded-full bg-lotus" style={{ width: `${(value / maxHotValue) * 100}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-stone-500">
                          {s.rentCount} lượt · đặt {pct(s.occupancyRate)} · {s.views} xem · {s.tryons} thử AI
                          {s.avgRating != null ? ` · ${s.avgRating.toFixed(1)}★` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* LOW DEMAND */}
            <section className="rounded-xl border border-sand bg-white p-5">
              <h2 className="mb-1 flex items-center gap-2 font-display text-2xl text-ink">
                <span className="material-symbols-outlined text-amber-600">trending_down</span>
                Ít được thuê
              </h2>
              <p className="mb-4 text-xs text-stone-500">
                ≤ {filters.lowDemandMaxRentals} lượt thuê trong kỳ, sản phẩm tạo trên 30 ngày. {data.note}
              </p>
              {data.lowDemand.length === 0 && <p className="text-sm text-stone-400">Không có sản phẩm nào ít được thuê. 🎉</p>}
              <ul className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                {data.lowDemand.map((s) => (
                  <li key={s.garmentId} className="rounded-lg border border-amber-200/70 bg-amber-50/40 p-3">
                    <div className="flex items-center gap-3">
                      <Thumb s={s} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                        <p className="text-xs text-stone-500">
                          {s.rentCount} lượt thuê · {s.views} xem · {s.tryons} thử AI · {s.availableDays} ngày-bản trống
                          {s.lastRentedAt ? ` · thuê gần nhất ${new Date(s.lastRentedAt).toLocaleDateString("vi-VN")}` : " · chưa từng được thuê trong kỳ"}
                        </p>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {s.recommendations.map((r) => (
                        <li key={r.action} className="flex items-start gap-2 text-xs text-stone-700">
                          <span className="material-symbols-outlined text-[16px] text-amber-700">{REC_ICON[r.action]}</span>
                          <span>{r.message}</span>
                        </li>
                      ))}
                    </ul>
                    {s.recommendations.some((r) => r.action === "discount") && (
                      <Link href="/dashboard/manager/pricing" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-lotus hover:underline">
                        Tạo luật giảm giá
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Bảng chi tiết */}
          <section className="rounded-xl border border-sand bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand p-4">
              <h2 className="font-display text-2xl text-ink">Chi tiết theo sản phẩm</h2>
              <div className="flex gap-1">
                {(["", "HOT", "NORMAL", "LOW_DEMAND", "NEW"] as const).map((c) => (
                  <button
                    key={c || "all"}
                    type="button"
                    onClick={() => setTableFilter(c)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${tableFilter === c ? "bg-ink text-white" : "border border-sand text-stone-600"}`}
                  >
                    {c ? CLASS_META[c].label : "Tất cả"}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-parchment text-left text-xs uppercase tracking-[0.1em] text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Sản phẩm</th>
                    <th className="px-4 py-3">Phân loại</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setTableSort((p) => ({ key: c.key, dir: p.key === c.key ? (p.dir === 1 ? -1 : 1) : -1 }))}
                          className="inline-flex items-center gap-0.5 uppercase hover:text-lotus"
                        >
                          {c.label}
                          {tableSort.key === c.key && (
                            <span className="material-symbols-outlined text-[14px]">{tableSort.dir === -1 ? "arrow_downward" : "arrow_upward"}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {tableRows.map((s) => (
                    <tr key={s.garmentId} className={s.isActive ? "" : "opacity-60"}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Thumb s={s} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{s.name}</p>
                            <p className="text-xs text-stone-500">
                              {s.categoryName ?? "—"} · {s.assetCount} bản{!s.isActive ? " · đã ẩn" : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASS_META[s.classification].cls}`}>
                          {CLASS_META[s.classification].label}
                          {s.hotRank ? ` #${s.hotRank}` : ""}
                        </span>
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2 text-right tabular-nums text-stone-700">{c.render(s)}</td>
                      ))}
                    </tr>
                  ))}
                  {tableRows.length === 0 && (
                    <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-8 text-center text-stone-400">Không có dữ liệu.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t border-sand px-4 py-3 text-xs text-stone-500">
              Tỷ lệ được đặt = số ngày-bản đã có lịch thuê / (số bản cho thuê được × số ngày trong kỳ). Ngày còn trống = phần ngày-bản chưa có lịch thuê.
              Doanh thu chỉ tính đơn đã thanh toán, đã trừ phần giảm giá voucher. Lượt xem được ghi nhận từ trang chi tiết sản phẩm (chống đếm trùng 30 phút).
            </p>
          </section>
        </>
      )}
    </div>
  );
}
