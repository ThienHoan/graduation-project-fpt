"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, LogOut, MailCheck, Search, ShieldAlert, ShieldCheck, UserX, Users } from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import {
  getAdminSecurityAccounts,
  getAdminSecurityOverview,
  revokeAdminUserSessions,
  verifyAdminUserEmail,
  type AdminSecurityAccount,
  type AdminSecurityAccountType,
  type AdminSecurityOverview,
} from "@/lib/api";

const PAGE_SIZE = 10;

const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị viên",
  manager_owner: "Quản lý / Chủ cửa hàng",
  staff: "Nhân viên",
  customer: "Khách hàng",
};

const FILTERS: { type: AdminSecurityAccountType; label: string }[] = [
  { type: "inactive", label: "Bị khóa" },
  { type: "unverified", label: "Chưa xác minh email" },
  { type: "privileged", label: "Tài khoản đặc quyền" },
];

type PendingAction = { kind: "revoke" | "verify"; account: AdminSecurityAccount };

type Props = {
  currentUserId: string | null;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export function SecurityPanel({ currentUserId, onSuccess, onError }: Props) {
  const [overview, setOverview] = useState<AdminSecurityOverview | null>(null);
  const [type, setType] = useState<AdminSecurityAccountType>("unverified");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [accounts, setAccounts] = useState<AdminSecurityAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await getAdminSecurityOverview();
      if (res.success && res.data) setOverview(res.data);
      else onError(res.error ?? "Không thể tải tổng quan bảo mật");
    } catch {
      onError("Lỗi mạng khi tải tổng quan bảo mật");
    }
  }, [onError]);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminSecurityAccounts({ type, search: search || undefined, page, limit: PAGE_SIZE });
      if (res.success && res.data) {
        setAccounts(res.data.items);
        setTotal(res.data.total);
      } else {
        onError(res.error ?? "Không thể tải danh sách tài khoản");
      }
    } catch {
      onError("Lỗi mạng khi tải danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  }, [type, search, page, onError]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  function chooseType(next: AdminSecurityAccountType) {
    setType(next);
    setPage(1);
  }

  async function confirmAction() {
    if (!pending) return;
    setActing(true);
    try {
      const res =
        pending.kind === "revoke"
          ? await revokeAdminUserSessions(pending.account.id)
          : await verifyAdminUserEmail(pending.account.id);
      if (res.success) {
        onSuccess(
          pending.kind === "revoke"
            ? `Đã buộc ${pending.account.email} đăng xuất khỏi mọi thiết bị.`
            : `Đã xác minh email cho ${pending.account.email}.`,
        );
        setPending(null);
        await Promise.all([loadOverview(), loadAccounts()]);
      } else {
        onError(res.message ?? res.error ?? "Không thể thực hiện thao tác");
        setPending(null);
      }
    } catch {
      onError("Lỗi hệ thống khi thực hiện thao tác");
    } finally {
      setActing(false);
    }
  }

  const stats = overview?.stats;
  const cards: { type: AdminSecurityAccountType | null; label: string; value: number | undefined; hint: string; icon: typeof Users }[] = [
    { type: null, label: "Tổng tài khoản", value: stats?.total, hint: `${stats?.activeAdmins ?? 0} quản trị viên đang hoạt động`, icon: Users },
    { type: "inactive", label: "Tài khoản bị khóa", value: stats?.inactive, hint: "Không thể đăng nhập", icon: UserX },
    {
      type: "unverified",
      label: "Chưa xác minh email",
      value: stats?.unverified,
      hint: `${stats?.staleUnverified ?? 0} tài khoản quá ${overview?.staleUnverifiedHours ?? 24} giờ`,
      icon: ShieldAlert,
    },
    { type: "privileged", label: "Tài khoản đặc quyền", value: stats?.privilegedActive, hint: "Nhân viên, quản lý, quản trị", icon: ShieldCheck },
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const active = card.type !== null && card.type === type;
          const body = (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{card.label}</p>
                <Icon className="h-5 w-5 text-antique" />
              </div>
              <p className="mt-2 text-3xl font-bold text-ink">{card.value === undefined ? "–" : card.value.toLocaleString("vi-VN")}</p>
              <p className="mt-2 text-xs font-medium text-stone-600">{card.hint}</p>
            </>
          );
          const className = `rounded-xl border bg-white p-5 text-left shadow-sm transition ${
            active ? "border-lotus ring-1 ring-lotus/30" : "border-sand"
          }`;
          return card.type ? (
            <button key={card.label} type="button" onClick={() => chooseType(card.type as AdminSecurityAccountType)} className={`${className} hover:shadow-md`}>
              {body}
            </button>
          ) : (
            <div key={card.label} className={className}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-12">
        <section className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm lg:col-span-8">
          <header className="space-y-4 border-b border-sand/60 bg-warm-ivory p-5">
            <h3 className="text-xl font-bold text-ink">Danh sách tài khoản cần theo dõi</h3>
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((filter) => (
                <button
                  key={filter.type}
                  type="button"
                  onClick={() => chooseType(filter.type)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    type === filter.type ? "bg-lotus text-white" : "border border-sand bg-white text-stone-600 hover:bg-warm-ivory/50"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
              <form
                className="relative ml-auto min-w-[200px] flex-1 sm:flex-none"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(searchInput.trim());
                  setPage(1);
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Tìm email, họ tên..."
                  className="w-full rounded-lg border border-sand bg-white py-1.5 pl-9 pr-3 text-xs text-ink outline-none focus:border-antique"
                />
              </form>
            </div>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand bg-stone-50 text-xs font-bold uppercase tracking-wider text-stone-600">
                  <th className="px-4 py-3">Tài khoản</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Ngày tạo</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand/30">
                {accounts.map((account) => {
                  const isSelf = account.id === currentUserId;
                  return (
                    <tr key={account.id} className="hover:bg-warm-ivory/30">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">{account.fullName ?? account.email}</p>
                        <p className="text-xs text-stone-500">
                          {account.fullName ? `${account.email} · ` : ""}
                          {ROLE_LABELS[account.role] ?? account.role}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={account.isActive ? "ok" : "bad"}>{account.isActive ? "Hoạt động" : "Bị khóa"}</Badge>
                          <Badge tone={account.isEmailVerified ? "ok" : "warn"}>{account.isEmailVerified ? "Đã xác minh" : "Chưa xác minh"}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-600">{formatDate(account.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {!account.isEmailVerified && (
                            <button
                              type="button"
                              onClick={() => setPending({ kind: "verify", account })}
                              className="inline-flex items-center gap-1 rounded-lg border border-sand px-2.5 py-1 text-xs font-semibold text-lotus transition hover:bg-lotus/5"
                            >
                              <MailCheck className="h-3.5 w-3.5" /> Xác minh
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isSelf}
                            title={isSelf ? "Không thể buộc đăng xuất chính bạn" : undefined}
                            onClick={() => setPending({ kind: "revoke", account })}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <LogOut className="h-3.5 w-3.5" /> Buộc đăng xuất
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && accounts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-stone-500">
                      Không có tài khoản nào trong nhóm này.
                    </td>
                  </tr>
                )}
                {loading && accounts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-stone-500">
                      Đang tải...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="tài khoản"
            className="border-t border-sand bg-warm-ivory/50 px-4 py-3"
          />
        </section>

        <aside className="rounded-xl border border-sand bg-white p-6 shadow-sm lg:col-span-4">
          <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
            <KeyRound className="h-5 w-5 text-antique" />
            Sự kiện bảo mật gần đây
          </h3>
          <p className="mt-1 text-xs text-stone-500">Đổi quyền, buộc đăng xuất, xác minh thủ công và xuất dữ liệu.</p>
          <ul className="mt-4 space-y-3">
            {overview?.recentEvents.map((event) => (
              <li key={event.id} className="rounded-lg border border-sand bg-warm-ivory/30 p-3">
                <p className="text-sm font-semibold text-ink">{event.label}</p>
                <p className="mt-0.5 text-xs text-stone-600">
                  {event.actorName ?? "Hệ thống"}
                  {event.targetEmail ? ` → ${event.targetEmail}` : ""}
                </p>
                <time className="text-[11px] text-stone-400" dateTime={event.createdAt}>
                  {formatDate(event.createdAt)}
                </time>
              </li>
            ))}
            {overview && overview.recentEvents.length === 0 && <li className="text-sm text-stone-500">Chưa có sự kiện nào.</li>}
          </ul>
        </aside>
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-sand bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-ink">
              {pending.kind === "revoke" ? "Buộc đăng xuất tài khoản?" : "Xác minh email thủ công?"}
            </h3>
            <p className="mt-2 text-sm text-stone-600">
              {pending.kind === "revoke"
                ? `${pending.account.email} sẽ bị đăng xuất khỏi mọi thiết bị và phải đăng nhập lại.`
                : `${pending.account.email} sẽ được đánh dấu đã xác minh mà không cần nhập mã OTP.`}
            </p>
            <p className="mt-1 text-xs text-stone-500">Thao tác này được ghi vào nhật ký kiểm toán.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={acting}
                className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmAction}
                disabled={acting}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
                  pending.kind === "revoke" ? "bg-red-600 hover:bg-red-700" : "bg-lotus hover:bg-oxblood"
                }`}
              >
                {acting ? "Đang xử lý..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const styles = {
    ok: "border-jade/30 bg-jade/5 text-jade",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    bad: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>;
}
