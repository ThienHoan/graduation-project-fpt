"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ManagerPortalShell } from "@/components/heritage/ui";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getStaffIncident,
  listStaffIncidents,
  runIncidentScan,
  type StaffIncidentDetail,
  type StaffIncidentListItem,
} from "@/lib/api";
import { incidentStatusOf, statusBadgeClass } from "@/lib/status-labels";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Shirt,
  X,
} from "lucide-react";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tất cả" },
  { value: "needs_manager,awaiting_customer,open", label: "Đang mở" },
  { value: "open", label: "Mới phát hiện" },
  { value: "awaiting_customer", label: "Chờ khách xác nhận" },
  { value: "needs_manager", label: "Cần hỗ trợ" },
  // Sự cố đã đóng. Đơn bị hủy cũng nằm ở đây: status = resolved,
  // resolution = booking_cancelled.
  { value: "resolved", label: "Đã xử lý" },
];

/** Số sự cố mỗi trang (server phân trang; sự cố còn mở luôn lên đầu). */
const INCIDENTS_PAGE_SIZE = 20;

// Danh sách số trang rút gọn: 1 … 4 5 6 … 20
function buildPageList(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = [1, total, current - 1, current, current + 1]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const pages: (number | "...")[] = [];
  let prev = 0;
  for (const p of [...new Set(wanted)]) {
    if (p - prev > 1) pages.push("...");
    pages.push(p);
    prev = p;
  }
  return pages;
}

/** Sự cố còn mở → còn thao tác được. `resolved`/`cancelled` là đã đóng. */
const OPEN_INCIDENT_STATUSES = ["open", "awaiting_customer", "needs_manager"];

function isIncidentOpen(status: string) {
  return OPEN_INCIDENT_STATUSES.includes(status);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10).split("-").reverse().join("/");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

/** Nhãn tiền tác động của sự cố: hoàn (jade), thu thêm (amber) hay không đổi. */
function incidentSettlementNote(detail: StaffIncidentDetail): {
  tone: "refund" | "charge" | "neutral";
  text: string;
} | null {
  const settlement = detail.settlement;
  if (!settlement) return null;
  const money = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString("vi-VN")}đ`;
  // Đơn bị huỷ: hiện tiền hoàn cọc (0 nếu chưa thu được gì).
  if (settlement.bookingCancelled) {
    return { tone: "refund", text: `Đơn đã bị huỷ · Hoàn cọc: ${money(settlement.refundAmount)}` };
  }
  // Đơn bị thu thêm (chênh lệch tăng) → tổng thu thêm.
  if (settlement.extraChargeAmount > 0) {
    return { tone: "charge", text: `Thu thêm: ${money(settlement.extraChargeAmount)}` };
  }
  // Đơn được giảm (chênh lệch giảm) → số tiền hoàn trả.
  if (settlement.refundAmount > 0) {
    return { tone: "refund", text: `Hoàn trả: ${money(settlement.refundAmount)}` };
  }
  return null;
}

function remainingLabel(item: StaffIncidentListItem) {
  if (item.daysOverdue > 0) return `Quá hạn ${item.daysOverdue} ngày`;
  if (item.daysRemaining <= 0) return "Hôm nay";
  return `Còn ${item.daysRemaining} ngày`;
}

function customerLabel(customer: StaffIncidentListItem["customer"]) {
  return customer.fullName ?? customer.email ?? customer.phone ?? "Khách";
}

function itemLabel(item: StaffIncidentListItem["item"]) {
  return item.name ?? (item.kind === "garment" ? "Trang phục" : "Phụ kiện");
}

/**
 * Nhãn dự phòng khi server chưa trả `reasonLabel`/`resolutionLabel` (dữ liệu cũ).
 * Trang quản lý không hiện mã kỹ thuật kiểu `asset_maintenance`.
 */
const INCIDENT_REASON_TEXT: Record<string, string> = {
  asset_damaged: "bị hư hỏng",
  asset_lost: "bị mất",
  asset_retired: "ngừng cho thuê",
  asset_maintenance: "đang bảo trì",
  asset_conflict: "bị trùng lịch với đơn khác",
  no_asset_available: "không còn chiếc cùng size",
  accessory_unavailable: "không còn phụ kiện thay thế",
};

const INCIDENT_RESOLUTION_TEXT: Record<string, string> = {
  replaced: "Đã đổi sang mẫu thay thế",
  removed: "Đã bỏ món khỏi đơn",
  booking_cancelled: "Đơn đã huỷ nên sự cố tự đóng",
  asset_recovered: "Tài sản đã sẵn sàng cho thuê trở lại",
  manual: "Cửa hàng xử lý thủ công",
};

function incidentReasonText(detail: {
  reason: string | null;
  reasonLabel?: string | null;
  itemKind: StaffIncidentDetail["itemKind"];
}) {
  const label = detail.reasonLabel?.trim();
  if (label) return label.charAt(0).toUpperCase() + label.slice(1);

  const code = detail.reason?.trim();
  if (!code) return "Không còn sẵn sàng cho lịch thuê";
  const text = INCIDENT_REASON_TEXT[code] ?? code;
  if (!code.startsWith("asset_")) return text;
  const subject = detail.itemKind === "accessory" ? "Phụ kiện" : "Trang phục";
  return `${subject} ${text}`;
}

function incidentResolutionText(detail: { resolution: string | null; resolutionLabel?: string | null }) {
  const label = detail.resolutionLabel?.trim();
  if (label) return label;
  if (!detail.resolution) return "—";
  return INCIDENT_RESOLUTION_TEXT[detail.resolution] ?? detail.resolution;
}

/** Tên khách trong `detail.booking.customer` (Prisma include customer + profile). */
function detailCustomerName(customer: unknown): string | null {
  if (!customer || typeof customer !== "object") return null;
  const row = customer as {
    email?: string | null;
    profile?: { fullName?: string | null; phone?: string | null } | null;
  };
  return row.profile?.fullName ?? row.email ?? row.profile?.phone ?? null;
}

type DrawerState = {
  incidentId: string;
  detail: StaffIncidentDetail | null;
  loading: boolean;
  error: string | null;
};

export default function ManagerIncidentsPage() {
  const { user } = useAuth();
  const canAct = user?.role === "manager_owner" || user?.role === "admin";

  const [items, setItems] = useState<StaffIncidentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listStaffIncidents({
      status: statusFilter || undefined,
      q: searchApplied || undefined,
      page,
      limit: INCIDENTS_PAGE_SIZE,
    });
    if (!res.success || !res.data) {
      setListError(res.message ?? "Không tải được danh sách sự cố.");
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setLoading(false);
      return;
    }
    // Xử lý xong trang cuối → lùi về trang còn dữ liệu.
    if (res.data.items.length === 0 && page > 1) {
      setLoading(false);
      setPage(page - 1);
      return;
    }
    // Giữ nguyên thứ tự server trả (sự cố còn mở trước, rồi dueAt/detectedAt) — KHÔNG sort lại.
    setItems(res.data.items);
    setTotal(res.data.total);
    setTotalPages(res.data.totalPages);
    setListError(null);
    setLoading(false);
  }, [statusFilter, searchApplied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDrawer(incidentId: string) {
    setDrawer({ incidentId, detail: null, loading: true, error: null });

    const res = await getStaffIncident(incidentId);
    if (!res.success || !res.data) {
      setDrawer({ incidentId, detail: null, loading: false, error: res.message ?? "Không tải được chi tiết sự cố." });
      return;
    }
    setDrawer({ incidentId, detail: res.data, loading: false, error: null });
  }

  function closeDrawer() {
    setDrawer(null);
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearchApplied(searchInput.trim());
  }

  async function handleScan() {
    setScanning(true);
    setScanMessage(null);
    const res = await runIncidentScan();
    setScanning(false);
    if (!res.success || !res.data) {
      setScanMessage(res.message ?? "Không chạy được quét sự cố.");
      return;
    }
    setScanMessage(`Đã quét: mở ${res.data.opened}, tự xử lý ${res.data.resolved}.`);
    await load();
  }

  return (
    <ManagerPortalShell
      active="incidents"
      title="Sự cố đổi mẫu"
      subtitle="Sự cố còn mở luôn đứng đầu hàng đợi; xử lý đổi mẫu, bỏ món hoặc hủy đơn"
    >
      <div className="space-y-5">
        {/* Bộ lọc + quét */}
        <section className="flex flex-col gap-3 rounded-xl border border-sand bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={applySearch} className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Tìm theo tên, email, SĐT khách"
                className="w-full rounded-lg border border-sand bg-white py-2 pl-9 pr-3 text-sm text-ink focus:border-lotus focus:outline-none"
                aria-label="Tìm sự cố"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value);
              }}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-lotus focus:outline-none"
              aria-label="Lọc theo trạng thái"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-mist"
            >
              Tìm
            </button>
          </form>

          {canAct ? (
            <button
              type="button"
              onClick={() => void handleScan()}
              disabled={scanning}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Quét ngay
            </button>
          ) : null}
        </section>

        {scanMessage ? (
          <p className="rounded-lg border border-jade/30 bg-jade/5 px-4 py-2.5 text-sm text-jade">{scanMessage}</p>
        ) : null}

        {listError ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{listError}</span>
          </div>
        ) : null}

        {/* Bảng sự cố */}
        <section className="overflow-hidden rounded-xl border border-sand bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-500">
              <Loader2 className="h-5 w-5 animate-spin text-lotus" />
              Đang tải danh sách sự cố...
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-stone-500">
              <CheckCircle2 className="mx-auto h-8 w-8 text-jade" />
              <p className="mt-3">Không có sự cố nào phù hợp.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-mist/60 text-xs uppercase tracking-[0.12em] text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Mã đơn</th>
                    <th className="px-4 py-3">Khách</th>
                    <th className="px-4 py-3">Ngày thuê</th>
                    <th className="px-4 py-3">Thời gian</th>
                    <th className="px-4 py-3">Món sự cố</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const st = incidentStatusOf(item.status);
                    return (
                      <tr key={item.id} className="border-t border-sand/70 hover:bg-mist/40">
                        <td className="px-4 py-3 font-semibold text-ink">#{item.bookingCode}</td>
                        <td className="px-4 py-3 text-stone-700">
                          <p>{customerLabel(item.customer)}</p>
                          <p className="text-xs text-stone-400">{item.customer.phone ?? item.customer.email ?? ""}</p>
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {formatDate(item.rentalStartDate)} – {formatDate(item.rentalEndDate)}
                        </td>
                        <td className="px-4 py-3 text-stone-600">{remainingLabel(item)}</td>
                        <td className="px-4 py-3 text-stone-700">
                          <span className="inline-flex items-center gap-1.5">
                            {item.item.kind === "garment" ? (
                              <Shirt className="h-3.5 w-3.5 text-stone-400" />
                            ) : (
                              <Package className="h-3.5 w-3.5 text-stone-400" />
                            )}
                            {itemLabel(item.item)}
                            {item.item.sizeLabel ? ` · ${item.item.sizeLabel}` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={statusBadgeClass(st.color)}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {item.status === "resolved" ? (
                              <button
                                type="button"
                                onClick={() => void openDrawer(item.id)}
                                aria-label={`Chi tiết sự cố ${item.bookingCode}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                              >
                                Chi tiết
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void openDrawer(item.id)}
                                aria-label={`Chi tiết sự cố ${item.bookingCode}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                              >
                                Chi tiết
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {/* Xử lý sự cố gộp về một bề mặt duy nhất: trang sự cố của đơn. */}
                            {isIncidentOpen(item.status) ? (
                              <Link
                                href={`/booking/incidents/${encodeURIComponent(item.bookingId)}`}
                                aria-label={`Xử lý sự cố ${item.bookingCode}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-lotus px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-oxblood"
                              >
                                Xử lý
                                <ChevronRight className="h-3.5 w-3.5" />
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {!loading && items.length > 0 ? (
          <p className="text-xs text-stone-400">
            Hiển thị {(page - 1) * INCIDENTS_PAGE_SIZE + 1}–
            {Math.min(page * INCIDENTS_PAGE_SIZE, total)} trong {total} sự cố. Sự cố còn mở luôn đứng đầu hàng đợi.
          </p>
        ) : null}

        {/* Phân trang */}
        {!loading && totalPages > 1 ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-white px-4 py-3">
            <p className="text-xs text-stone-500">
              Trang {page}/{totalPages} · {total} sự cố
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(Math.max(1, page - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Trang trước"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {buildPageList(page, totalPages).map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-stone-400">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === page ? "page" : undefined}
                    className={
                      p === page
                        ? "flex h-8 min-w-8 items-center justify-center rounded-lg bg-lotus px-2 text-xs font-semibold text-white"
                        : "flex h-8 min-w-8 items-center justify-center rounded-lg border border-sand bg-white px-2 text-xs font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
                    }
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Trang sau"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {/* Drawer chi tiết */}
      {drawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={closeDrawer}>
          <aside
            className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Chi tiết sự cố"
          >
            <header className="flex items-start justify-between gap-3 border-b border-sand px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-antique">Chi tiết sự cố</p>
                  {drawer.detail ? (
                    <span className={statusBadgeClass(incidentStatusOf(drawer.detail.status).color)}>
                      {incidentStatusOf(drawer.detail.status).label}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-1 font-display text-2xl text-ink">
                  {drawer.detail ? `#${drawer.detail.bookingCode}` : "Đang tải..."}
                </h2>
                {drawer.detail ? (
                  <p className="mt-1 text-xs text-stone-500">
                    Phát hiện lúc {formatTime(drawer.detail.detectedAt)} · {formatDate(drawer.detail.detectedAt)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-full border border-sand p-2 text-stone-500 transition hover:bg-mist"
                aria-label="Đóng chi tiết"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-5 px-5 py-5">
              {drawer.loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-stone-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tải chi tiết...
                </div>
              ) : drawer.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{drawer.error}</div>
              ) : drawer.detail ? (
                <IncidentDetailBody detail={drawer.detail} />
              ) : null}
            </div>
            {drawer.detail && isIncidentOpen(drawer.detail.status) ? (
              <footer className="border-t border-sand bg-mist/30 px-5 py-4">
                <Link
                  href={`/booking/incidents/${encodeURIComponent(drawer.detail.bookingId)}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood"
                >
                  Mở trang xử lý sự cố
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <p className="mt-2 text-center text-[11px] text-stone-500">
                  Đổi mẫu, bỏ món và huỷ đơn được xử lý ở trang sự cố của đơn (gửi email cho khách).
                </p>
              </footer>
            ) : (
              <footer className="border-t border-sand bg-mist/30 px-5 py-4 text-xs text-stone-500">
                Sự cố đã xử lý{drawer.detail?.resolvedAt ? ` lúc ${formatDateTime(drawer.detail.resolvedAt)}` : ""} — chỉ xem lại.
              </footer>
            )}
          </aside>
        </div>
      ) : null}
    </ManagerPortalShell>
  );
}

type IncidentHistoryStep = {
  title: string;
  at: string | null;
  description: string | null;
};

/**
 * Dựng timeline xử lý sự cố từ dữ liệu server:
 * 1) phát hiện (detectedAt), 2) áp dụng yêu cầu đổi/bỏ món (appliedAt), 3) đóng
 * sự cố (resolvedAt). Bước nào không có dữ liệu thì bỏ — không bịa mốc thời gian.
 */
function buildIncidentHistory(detail: StaffIncidentDetail): IncidentHistoryStep[] {
  const steps: IncidentHistoryStep[] = [
    {
      title: "Phát hiện sự cố",
      at: detail.detectedAt,
      description: incidentReasonText(detail),
    },
  ];

  const applied = detail.relatedRequests.find(
    (request) => request.status === "applied" || Boolean(request.appliedAt),
  );
  if (applied) {
    steps.push({
      title: applied.type === "replace" ? "Đổi sang mẫu thay thế" : "Gỡ sản phẩm khỏi đơn",
      at: applied.appliedAt ?? applied.updatedAt ?? applied.createdAt,
      description:
        applied.note?.trim() ||
        (applied.type === "replace"
          ? "Đã áp dụng mẫu thay thế cho khách."
          : "Đã bỏ món gặp sự cố khỏi đơn thuê."),
    });
  }

  if (detail.resolvedAt) {
    steps.push({
      title: "Hoàn tất xử lý",
      at: detail.resolvedAt,
      description: incidentResolutionText(detail),
    });
  }

  return steps;
}

function IncidentDetailBody({ detail }: { detail: StaffIncidentDetail }) {
  const snapshot = detail.snapshot;
  const itemKindLabel = detail.itemKind === "garment" ? "Trang phục" : "Phụ kiện";
  const customerName = detailCustomerName(detail.booking.customer);
  const history = buildIncidentHistory(detail);
  const settlementNote = incidentSettlementNote(detail);

  return (
    <div className="space-y-6">
      {/* Món gặp sự cố: ảnh + tên + mã tài sản + lý do. */}
      <section className="rounded-xl border border-sand p-4">
        <div className="flex gap-3">
          {snapshot?.imageUrl ? (
            <img
              src={snapshot.imageUrl}
              alt={snapshot.name ?? itemKindLabel}
              className="h-24 w-20 shrink-0 rounded-lg border border-sand object-cover"
            />
          ) : (
            <span className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg border border-sand bg-mist text-stone-400">
              {detail.itemKind === "garment" ? <Shirt className="h-7 w-7" /> : <Package className="h-7 w-7" />}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {snapshot?.name ?? itemKindLabel}
              {snapshot?.sizeLabel ? ` · size ${snapshot.sizeLabel}` : ""}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Mã tài sản: <span className="font-semibold text-ink">{detail.assetCode ?? "Chưa gán"}</span>
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              <span className="font-semibold text-ink">Lý do sự cố: </span>
              {incidentReasonText(detail)}
            </p>
          </div>
        </div>
      </section>

      {/* Kết quả xử lý + thời gian xử lý (kể cả khi còn mở → nói rõ chưa xử lý). */}
      <section className="rounded-xl border border-sand p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Kết quả xử lý</p>
        <p className="mt-1 text-sm font-semibold text-ink">
          {detail.resolvedAt ? incidentResolutionText(detail) : "Chưa xử lý — đang chờ cửa hàng/khách phản hồi."}
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Thời gian xử lý: {detail.resolvedAt ? formatDateTime(detail.resolvedAt) : "—"}
        </p>
        {detail.note ? <p className="mt-2 text-sm leading-6 text-stone-600">Ghi chú: {detail.note}</p> : null}
      </section>

      {/* Thông tin đơn thuê. */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Thông tin đơn thuê</p>
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-sand">
              <th scope="row" className="w-2/5 px-3 py-2 text-left text-xs font-semibold text-stone-500">
                Mã đơn
              </th>
              <td className="px-3 py-2 font-semibold text-ink">#{detail.bookingCode}</td>
            </tr>
            <tr className="border-b border-sand">
              <th scope="row" className="px-3 py-2 text-left text-xs font-semibold text-stone-500">
                Ngày thuê
              </th>
              <td className="px-3 py-2 text-ink">
                {formatDate(detail.booking.rentalStartDate)} – {formatDate(detail.booking.rentalEndDate)}
              </td>
            </tr>
            <tr className="border-b border-sand">
              <th scope="row" className="px-3 py-2 text-left text-xs font-semibold text-stone-500">
                Hạn xử lý
              </th>
              <td className="px-3 py-2 text-ink">{formatDate(detail.dueAt)}</td>
            </tr>
            <tr>
              <th scope="row" className="px-3 py-2 text-left text-xs font-semibold text-stone-500">
                Khách hàng
              </th>
              <td className="px-3 py-2 text-ink">{customerName ?? "Khách"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Giá trị đơn thuê + tác động tiền của sự cố. */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Giá trị đơn thuê</p>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-sand px-4 py-3">
            <dt className="text-xs text-stone-500">Tiền thuê</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {detail.booking.rentalTotal.toLocaleString("vi-VN")}đ
            </dd>
          </div>
          <div className="rounded-lg border border-sand px-4 py-3">
            <dt className="text-xs text-stone-500">Tiền đặt cọc</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {detail.booking.depositTotal.toLocaleString("vi-VN")}đ
            </dd>
          </div>
        </dl>
        {settlementNote ? (
          <p
            className={`mt-3 rounded-lg px-4 py-3 text-sm font-semibold ${
              settlementNote.tone === "refund"
                ? "border border-jade/30 bg-jade/5 text-jade"
                : settlementNote.tone === "charge"
                  ? "border border-amber-200 bg-amber-50 text-amber-800"
                  : "border border-sand bg-mist/40 text-stone-600"
            }`}
          >
            {settlementNote.text}
          </p>
        ) : null}
      </section>

      {/* Lịch sử xử lý sự cố — timeline có số thứ tự. */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Lịch sử xử lý sự cố</p>
        <ol className="mt-3 space-y-3">
          {history.map((step, index) => (
            <li key={`${step.title}-${index}`} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lotus text-[11px] font-semibold text-white">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 border-b border-sand pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{step.title}</p>
                  <p className="text-xs font-medium text-stone-400">{formatDateTime(step.at)}</p>
                </div>
                {step.description ? (
                  <p className="mt-1 text-sm leading-6 text-stone-600">{step.description}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}