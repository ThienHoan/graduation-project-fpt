"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getMyNotifications,
  getMyNotificationPreferences,
  markAllMyNotificationsRead,
  markMyNotificationRead,
  updateMyNotificationPreferences,
  type NotificationItem,
  type NotificationPreferences,
} from "@/lib/api";
import { normalizeStatusInText } from "@/lib/status-labels";
import {
  Calendar,
  Banknote,
  Truck,
  ClipboardCheck,
  ShieldCheck,
  Bell,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type ViewFilter = "all" | "unread" | "read";

const NOTIFICATIONS_FETCH_LIMIT = 200;
const PAGE_SIZE = 8;

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

const DEFAULT_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
  inAppEnabled: true,
  bookingUpdatesEnabled: true,
  paymentUpdatesEnabled: true,
  reminderEnabled: true,
  marketingEnabled: false,
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function PreferenceSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border border-sand bg-white px-4 py-3 text-sm text-ink">
      <span className="font-medium">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-sand text-lotus focus:ring-antique"
      />
    </label>
  );
}

function getNotificationIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("đơn thuê") || t.includes("booking") || t.includes("lịch")) {
    return { icon: Calendar, bg: "bg-jade/10", text: "text-jade" };
  }
  if (t.includes("thanh toán") || t.includes("cọc") || t.includes("tiền")) {
    return { icon: Banknote, bg: "bg-amber-50", text: "text-amber-700" };
  }
  if (t.includes("vận chuyển") || t.includes("giao hàng")) {
    return { icon: Truck, bg: "bg-blue-50", text: "text-blue-600" };
  }
  if (t.includes("kiểm tra") || t.includes("tình trạng")) {
    return { icon: ClipboardCheck, bg: "bg-stone-100", text: "text-stone-600" };
  }
  if (t.includes("tài khoản") || t.includes("bảo mật") || t.includes("hệ thống")) {
    return { icon: ShieldCheck, bg: "bg-stone-100", text: "text-stone-600" };
  }
  return { icon: Bell, bg: "bg-stone-100", text: "text-stone-600" };
}

export default function CustomerNotificationsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [view, setView] = useState<ViewFilter>("all");
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorMsg(null);

      try {
        const [notificationsRes, preferencesRes] = await Promise.all([
          getMyNotifications(NOTIFICATIONS_FETCH_LIMIT),
          getMyNotificationPreferences(),
        ]);

        if (!active) return;

        if (notificationsRes.success && notificationsRes.data) {
          setNotifications(notificationsRes.data.notifications);
          setUnreadCount(notificationsRes.data.unreadCount);
        }

        if (preferencesRes.success && preferencesRes.data) {
          setPreferences(preferencesRes.data);
        }
      } catch {
        if (active) setErrorMsg("Không thể tải trung tâm thông báo.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (view === "unread") return !item.isRead;
      if (view === "read") return item.isRead;
      return true;
    });
  }, [notifications, view]);

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedNotifications = filteredNotifications.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function flash(message: string) {
    setSuccessMsg(message);
    window.setTimeout(() => setSuccessMsg(null), 3500);
  }

  async function refreshNotifications() {
    const res = await getMyNotifications(NOTIFICATIONS_FETCH_LIMIT);
    if (res.success && res.data) {
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
    }
  }

  async function handleMarkRead(id: string) {
    setMarkingId(id);
    setErrorMsg(null);

    try {
      const res = await markMyNotificationRead(id);
      if (!res.success) {
        setErrorMsg(res.message ?? "Không thể đánh dấu đã đọc.");
        return;
      }

      setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true, readAt: new Date().toISOString() } : item)));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      setErrorMsg("Không thể đánh dấu đã đọc.");
    } finally {
      setMarkingId(null);
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    setErrorMsg(null);

    try {
      const res = await markAllMyNotificationsRead();
      if (!res.success) {
        setErrorMsg(res.message ?? "Không thể đánh dấu tất cả đã đọc.");
        return;
      }

      setNotifications((current) => current.map((item) => ({ ...item, isRead: true, readAt: item.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
      flash("Đã đánh dấu tất cả thông báo là đã đọc.");
    } catch {
      setErrorMsg("Không thể đánh dấu tất cả đã đọc.");
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleSavePreferences() {
    setSavingPrefs(true);
    setErrorMsg(null);

    try {
      const res = await updateMyNotificationPreferences(preferences);
      if (!res.success || !res.data) {
        setErrorMsg(res.message ?? "Không thể lưu tuỳ chọn thông báo.");
        return;
      }

      setPreferences(res.data);
      flash("Đã lưu tuỳ chọn thông báo.");
    } catch {
      setErrorMsg("Không thể lưu tuỳ chọn thông báo.");
    } finally {
      setSavingPrefs(false);
    }
  }

  const displayName = user?.fullName ?? user?.email ?? "Khách hàng";

  return (
    <div className="space-y-10">
      <header className="border-b border-sand pb-6">
        <h1 className="font-display text-5xl text-lotus sm:text-6xl">Thông báo của bạn</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          Xin chào {displayName}. Đây là nơi bạn theo dõi cập nhật đơn thuê, thanh toán và các thay đổi từ hệ thống.
        </p>
      </header>

      {successMsg ? (
        <div className="rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
          {successMsg}
        </div>
      ) : null}

      {errorMsg ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">
          <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl text-ink">Hộp thư thông báo</h2>
                <p className="mt-1 text-sm text-stone-500">{unreadCount} thông báo chưa đọc</p>
              </div>
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markingAll || unreadCount === 0}
                className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {markingAll ? "Đang xử lý..." : "Đánh dấu tất cả đã đọc"}
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {(["all", "unread", "read"] as ViewFilter[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setView(item); setPage(1); }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${view === item ? "bg-lotus text-white" : "border border-sand bg-white text-stone-600 hover:bg-mist"}`}
                >
                  {item === "all" ? "Tất cả" : item === "unread" ? "Chưa đọc" : "Đã đọc"}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-4 rounded-xl border border-sand bg-white p-4">
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-stone-200" />
                    <div className="flex-1 space-y-3 py-1">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-stone-200" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-stone-200" />
                      <div className="h-3 w-24 animate-pulse rounded bg-stone-200" />
                    </div>
                  </div>
                ))
              ) : filteredNotifications.length === 0 ? (
                <div className="rounded-lg border border-dashed border-sand p-8 text-center text-stone-400">Chưa có thông báo phù hợp.</div>
              ) : (
                pagedNotifications.map((item) => {
                    const iconData = getNotificationIcon(item.title);
                    const IconComponent = iconData.icon;
                    return (
                    <article key={item.id} className={`rounded-xl border p-4 transition ${item.isRead ? "border-sand bg-white" : "border-lotus/30 bg-mist"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconData.bg} ${iconData.text}`}>
                          <IconComponent className="h-5 w-5" />
                        </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-ink">{normalizeStatusInText(item.title)}</h3>
                          {!item.isRead ? (
                            <span className="rounded-full bg-lotus/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-lotus">Mới</span>
                          ) : null}
                        </div>
                        <p className="mt-2 whitespace-pre-line text-sm leading-7 text-stone-600">{normalizeStatusInText(item.body ?? "(Không có nội dung)")}</p>
                        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-stone-400">{formatDateTime(item.createdAt)}</p>
                      </div>
                      <button
                        type="button"
                        disabled={item.isRead || markingId === item.id}
                        onClick={() => handleMarkRead(item.id)}
                        className="rounded-lg border border-sand bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {item.isRead ? "Đã đọc" : markingId === item.id ? "..." : "Đánh dấu đã đọc"}
                      </button>
                    </div>
                  </article>
                  );
                })
              )}
            </div>

            {/* Phân trang */}
            {!loading && totalPages > 1 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sand pt-4">
                <p className="text-xs text-stone-500">
                  Hiển thị {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredNotifications.length)} trong {filteredNotifications.length} thông báo
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Trang trước"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {buildPageList(currentPage, totalPages).map((p, idx) =>
                    p === "..." ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-xs text-stone-400">…</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPage(p)}
                        className={
                          p === currentPage
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
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-stone-600 transition hover:border-lotus hover:text-lotus disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Trang sau"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-4">
          <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
            <h2 className="font-display text-3xl text-ink">Tuỳ chọn</h2>
            <p className="mt-1 text-sm text-stone-500">Điều chỉnh những gì bạn muốn nhận.</p>

            <div className="mt-5 space-y-3">
              <PreferenceSwitch label="Thông báo email" checked={preferences.emailEnabled} onChange={(value) => setPreferences((current) => ({ ...current, emailEnabled: value }))} />
              <PreferenceSwitch label="Thông báo trong ứng dụng" checked={preferences.inAppEnabled} onChange={(value) => setPreferences((current) => ({ ...current, inAppEnabled: value }))} />
              <PreferenceSwitch label="Cập nhật đơn thuê" checked={preferences.bookingUpdatesEnabled} onChange={(value) => setPreferences((current) => ({ ...current, bookingUpdatesEnabled: value }))} />
              <PreferenceSwitch label="Cập nhật thanh toán" checked={preferences.paymentUpdatesEnabled} onChange={(value) => setPreferences((current) => ({ ...current, paymentUpdatesEnabled: value }))} />
              <PreferenceSwitch label="Nhắc lịch / deadline" checked={preferences.reminderEnabled} onChange={(value) => setPreferences((current) => ({ ...current, reminderEnabled: value }))} />
              <PreferenceSwitch label="Khuyến mãi" checked={preferences.marketingEnabled} onChange={(value) => setPreferences((current) => ({ ...current, marketingEnabled: value }))} />
            </div>

            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={savingPrefs}
              className="mt-5 w-full rounded-lg bg-lotus px-4 py-3 text-sm font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPrefs ? "Đang lưu..." : "Lưu tuỳ chọn"}
            </button>
          </section>

          <section className="rounded-xl border border-sand bg-mist p-6">
            <h3 className="font-display text-2xl text-ink">Ghi chú</h3>
            <p className="mt-2 text-sm leading-7 text-stone-600">
              Những thông báo này được hệ thống tạo tự động từ các mốc đơn thuê, thanh toán và chăm sóc khách hàng. Nếu bạn không thấy gì mới, hãy kiểm tra lại tuỳ chọn email/in-app ở cột bên.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
