"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { NotificationConfigPanel } from "@/components/admin/notification-config-panel";
import { AdminPortalShell } from "@/components/heritage/ui";
import { RolePermissionPanel } from "@/components/admin/role-permission-panel";
import { SystemConfigPanel } from "@/components/admin/system-config-panel";
import { SecurityPanel } from "@/components/admin/security-panel";
import { DataExportPanel } from "@/components/admin/data-export-panel";
import { AuditActionFilter, auditActionGroup } from "@/components/admin/audit-action-filter";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  CheckSquare,
  Activity,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Settings,
  X,
  Search,
  UserCog,
} from "lucide-react";

import {
  getAdminOverview,
  getAdminUsers,
  updateAdminUser,
  getAdminAuditLogs,
  getAdminAuditLogActions,
  type AdminAuditLogGroup,
  getAdminRoles,
  type AdminSummaryCard,
  type AdminQueueCard,
  type AdminUserEntry,
  type AdminAuditLogEntry,
  type AdminRoleEntry,
} from "@/lib/api";

type Tab = "overview" | "roles" | "security" | "config" | "notification-config" | "exports" | "logs";
const VALID_TABS: Tab[] = ["overview", "roles", "security", "config", "notification-config", "exports", "logs"];

function tabFromHash(): Tab {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace("#", "");
  return VALID_TABS.includes(hash as Tab) ? (hash as Tab) : "overview";
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị viên",
  manager_owner: "Quản lý / Chủ cửa hàng",
  staff: "Nhân viên",
  customer: "Khách hàng",
};

const TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  overview: {
    title: "Tổng Quan Hệ Thống",
    subtitle: "Theo dõi tình trạng hoạt động, cấu hình và bảo mật của toàn bộ nền tảng.",
  },
  roles: {
    title: "Quản Lý Vai Trò & Người Dùng",
    subtitle: "Thiết lập phân quyền và thay đổi quyền hạn tài khoản trong hệ thống.",
  },
  security: {
    title: "Bảo Mật Tài Khoản",
    subtitle: "Theo dõi tài khoản bị khóa, chưa xác minh email, buộc đăng xuất và xác minh thủ công.",
  },
  exports: {
    title: "Xuất Dữ Liệu",
    subtitle: "Tải dữ liệu tài khoản, đơn thuê và nhật ký kiểm toán dưới dạng CSV theo khoảng ngày.",
  },
  config: {
    title: "Cấu Hình Hệ Thống",
    subtitle: "Quản lý tham số AI Engine, phân bổ tính toán và tích hợp cổng thanh toán.",
  },
  "notification-config": {
    title: "Cấu Hình Thông Báo",
    subtitle: "Quản lý kênh gửi, mẫu thông báo và gửi thử email từ hệ thống.",
  },
  logs: {
    title: "Nhật Ký Kiểm Toán",
    subtitle: "Ghi nhận toàn bộ thao tác quản trị, thay đổi cấu hình và sự kiện bảo mật hệ thống.",
  },
};

export default function AdminOverviewPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [hasMounted, setHasMounted] = useState(false);
  const [currentDateLabel, setCurrentDateLabel] = useState("");
  const [tab, setTab] = useState<Tab>("overview");

  // State overview
  const [overviewData, setOverviewData] = useState<{
    summary: AdminSummaryCard[];
    queues: AdminQueueCard[];
    assetBreakdown: { status: string; label: string; count: number }[];
    bookingBreakdown: { status: string; label: string; count: number }[];
  } | null>(null);

  // State users
  const [users, setUsers] = useState<AdminUserEntry[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("");
  const [editingUser, setEditingUser] = useState<AdminUserEntry | null>(null);
  const [userForm, setUserForm] = useState({
    fullName: "",
    phone: "",
    role: "",
    isActive: true,
  });

  // State audit logs
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logSearch, setLogSearch] = useState("");
  const [logActionFilter, setLogActionFilter] = useState("all");
  const [logGroup, setLogGroup] = useState<AdminAuditLogGroup>("all");
  const [logActions, setLogActions] = useState<{ action: string; count: number }[]>([]);

  // State roles
  const [roleMatrix, setRoleMatrix] = useState<AdminRoleEntry[]>([]);

  // Loading & Alerts
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actioningUser, setActioningUser] = useState(false);

  // Sync date label on mount
  useEffect(() => {
    setHasMounted(true);
    setCurrentDateLabel(
      new Intl.DateTimeFormat("vi-VN", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date())
    );
  }, []);

  // Sync Tab with Hash
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function goToTab(next: Tab) {
    if (next === "overview") {
      history.replaceState(null, "", "/dashboard/admin");
    } else {
      window.location.hash = next;
    }
    setTab(next);
  }

  // Load Overview Data
  useEffect(() => {
    if (tab === "overview") {
      setLoading(true);
      getAdminOverview()
        .then((res) => {
          if (res.success && res.data) {
            setOverviewData({
              summary: res.data.summary,
              queues: res.data.queues,
              assetBreakdown: res.data.assetBreakdown,
              bookingBreakdown: res.data.bookingBreakdown,
            });
          } else {
            setErrorMsg(res.error ?? "Không thể tải dữ liệu tổng quan");
          }
        })
        .catch(() => setErrorMsg("Lỗi mạng khi tải tổng quan"))
        .finally(() => setLoading(false));
    }
  }, [tab]);

  // Load User List
  const fetchUsers = useCallback(() => {
    setLoading(true);
    getAdminUsers({
      search: userSearch || undefined,
      role: userRoleFilter || undefined,
      status: userStatusFilter || undefined,
      page: userPage,
      limit: 10,
    })
      .then((res) => {
        if (res.success && res.data) {
          setUsers(res.data.items);
          setUserTotal(res.data.total);
        } else {
          setErrorMsg(res.error ?? "Không thể tải danh sách người dùng");
        }
      })
      .catch(() => setErrorMsg("Lỗi mạng khi tải danh sách người dùng"))
      .finally(() => setLoading(false));
  }, [userSearch, userRoleFilter, userStatusFilter, userPage]);

  useEffect(() => {
    if (tab === "roles") {
      fetchUsers();
    }
  }, [tab, fetchUsers]);

  // Load real role/permission matrix
  useEffect(() => {
    if (tab === "roles") {
      getAdminRoles()
        .then((res) => {
          if (res.success && res.data) {
            setRoleMatrix(res.data.roles);
          } else {
            setErrorMsg(res.error ?? "Không thể tải bảng phân quyền");
          }
        })
        .catch(() => setErrorMsg("Lỗi mạng khi tải bảng phân quyền"));
    }
  }, [tab]);

  // Load Audit Logs
  const fetchAuditLogs = useCallback(() => {
    setLoading(true);
    getAdminAuditLogs({
      search: logSearch || undefined,
      action: logActionFilter !== "all" ? logActionFilter : undefined,
      group: logGroup,
      page: logPage,
      limit: 10,
    })
      .then((res) => {
        if (res.success && res.data) {
          setAuditLogs(res.data.items);
          setLogTotal(res.data.total);
        } else {
          setErrorMsg(res.error ?? "Không thể tải nhật ký kiểm toán");
        }
      })
      .catch(() => setErrorMsg("Lỗi mạng khi tải nhật ký kiểm toán"))
      .finally(() => setLoading(false));
  }, [logSearch, logActionFilter, logGroup, logPage]);

  useEffect(() => {
    if (tab === "logs") {
      fetchAuditLogs();
    }
  }, [tab, fetchAuditLogs]);

  useEffect(() => {
    if (tab !== "logs") return;
    getAdminAuditLogActions()
      .then((res) => {
        if (res.success && res.data) setLogActions(res.data);
      })
      .catch(() => undefined);
  }, [tab]);


  // Trigger Local Alerts helper
  const triggerSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  }, []);

  const triggerError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  }, []);

  // Handle Edit User Submit with lockout guards
  const handleUserEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    // Safety lock validation: Cannot deactivate or demote oneself
    const isEditingSelf = user?.id === editingUser.id;
    if (isEditingSelf) {
      if (userForm.role !== "admin" || !userForm.isActive) {
        triggerError("Bạn không thể tự hạ quyền hoặc vô hiệu hóa chính mình!");
        return;
      }
    }

    setActioningUser(true);
    updateAdminUser(editingUser.id, {
      fullName: userForm.fullName || null,
      phone: userForm.phone || null,
      role: userForm.role,
      isActive: userForm.isActive,
    })
      .then((res) => {
        if (res.success) {
          triggerSuccess("Cập nhật tài khoản người dùng thành công.");
          setEditingUser(null);
          fetchUsers();
        } else {
          triggerError(res.error ?? "Không thể cập nhật người dùng");
        }
      })
      .catch(() => triggerError("Lỗi hệ thống khi cập nhật người dùng"))
      .finally(() => setActioningUser(false));
  };

  if (!hasMounted) return null;

  return (
    <AdminPortalShell
      active={tab}
      title={TAB_META[tab].title}
      subtitle={TAB_META[tab].subtitle}
      onTabChange={goToTab}
      adminName={user?.fullName || user?.email || "Admin"}
      adminEmail={user?.email || null}
      onProfile={() => router.push("/dashboard/admin#roles")}
      onSignOut={() => { signOut(); router.replace("/login"); }}
      currentDateLabel={currentDateLabel}
    >
      {/* Toast Alerts */}
      {successMsg && (
        <div className="fixed right-6 top-20 z-50 flex items-center gap-2 rounded-lg bg-jade/5 px-4 py-3 text-sm font-semibold text-jade shadow-lg border border-jade/30 animate-slide-in">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="fixed right-6 top-20 z-50 flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 shadow-lg border border-rose-200 animate-slide-in">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────
          TAB: OVERVIEW
      ──────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-8">
          {/* Summary Bento Grid */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {overviewData?.summary.map((card) => {
              const colors = {
                rose: "border-rose-100 bg-rose-50/50 text-rose-700",
                emerald: "border-jade/20 bg-jade/5/50 text-jade",
                amber: "border-amber-100 bg-amber-50/50 text-amber-700",
                slate: "border-slate-200 bg-slate-100/50 text-slate-700",
              };
              return (
                <section
                  key={card.key}
                  className={`rounded-xl border p-6 shadow-sm bg-white hover:shadow-md transition-shadow`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{card.label}</p>
                  <p className="mt-2 text-4xl font-bold text-ink">
                    {card.key === "finance"
                      ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(card.value)
                      : card.value.toLocaleString("vi-VN")}
                  </p>
                  <p className="mt-2 text-xs text-stone-600 font-medium">{card.hint}</p>
                </section>
              );
            })}
          </div>

          {/* Quick Queues & System Activity */}
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Queues list */}
            <div className="lg:col-span-1 space-y-6">
              <h3 className="text-2xl font-bold text-ink flex items-center gap-2">
                <CheckSquare className="h-6 w-6 text-lotus" />
                Hàng Chờ Đang Xử Lý
              </h3>
              <div className="rounded-xl border border-sand bg-white p-4 space-y-4">
                {overviewData?.queues.map((q) => (
                  <div
                    key={q.key}
                    className="flex items-center justify-between p-3 rounded-lg bg-warm-ivory border border-sand/50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink">{q.label}</p>
                      <p className="text-xs text-stone-500 mt-0.5">{q.hint}</p>
                    </div>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lotus/10 text-sm font-bold text-lotus">
                      {q.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* System Breakdown Charts / Tables */}
            <div className="lg:col-span-2 space-y-6">
              <h3 className="text-2xl font-bold text-ink flex items-center gap-2">
                <Activity className="h-6 w-6 text-antique" />
                Trạng Thái Tài Sản & Đơn Hàng
              </h3>
              <div className="grid gap-6 md:grid-cols-2">
                {/* Asset status list */}
                <div className="rounded-xl border border-sand bg-white p-5">
                  <h4 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4">Trạng Thái Kho Hàng</h4>
                  <div className="space-y-3">
                    {overviewData?.assetBreakdown.map((a) => (
                      <div key={a.status} className="flex justify-between items-center border-b border-sand/30 pb-2">
                        <span className="text-sm text-stone-600 font-medium">{a.label}</span>
                        <span className="text-sm font-bold text-ink bg-stone-100 px-2 py-0.5 rounded">{a.count} món</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Booking status list */}
                <div className="rounded-xl border border-sand bg-white p-5">
                  <h4 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4">Trạng Thái Đơn Hàng</h4>
                  <div className="space-y-3">
                    {overviewData?.bookingBreakdown.map((b) => (
                      <div key={b.status} className="flex justify-between items-center border-b border-sand/30 pb-2">
                        <span className="text-sm text-stone-600 font-medium">{b.label}</span>
                        <span className="text-sm font-bold text-ink bg-stone-100 px-2 py-0.5 rounded">{b.count} đơn</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────
          TAB: ROLES & USERS
      ──────────────────────────────────────────────────────── */}
      {tab === "roles" && (
        <div className="grid gap-8 lg:grid-cols-12 items-start">
          {/* Left panel: User Accounts list */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-sand shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-sand/60 bg-warm-ivory flex flex-wrap gap-4 items-center justify-between">
              <h3 className="text-2xl font-bold text-ink">Danh Sách Tài Khoản</h3>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Tìm email, họ tên..."
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setUserPage(1);
                  }}
                  className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-ink outline-none focus:border-antique w-44"
                />
                <button
                  onClick={fetchUsers}
                  className="rounded-lg bg-lotus hover:bg-oxblood text-white px-3 py-1.5 text-xs font-semibold"
                >
                  Tìm
                </button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="p-4 border-b border-sand/30 bg-stone-50/50 flex gap-4">
              <div className="flex-1">
                <label className="block text-[10px] uppercase font-bold text-stone-500 mb-1">Vai trò</label>
                <select
                  value={userRoleFilter}
                  onChange={(e) => {
                    setUserRoleFilter(e.target.value);
                    setUserPage(1);
                  }}
                  className="w-full rounded-lg border border-sand bg-white py-1 px-2 text-xs text-ink focus:border-antique outline-none"
                >
                  <option value="">Tất cả</option>
                  <option value="admin">Super Admin</option>
                  <option value="manager_owner">Manager</option>
                  <option value="staff">Staff</option>
                  <option value="customer">Customer</option>
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-[10px] uppercase font-bold text-stone-500 mb-1">Trạng thái</label>
                <select
                  value={userStatusFilter}
                  onChange={(e) => {
                    setUserStatusFilter(e.target.value);
                    setUserPage(1);
                  }}
                  className="w-full rounded-lg border border-sand bg-white py-1 px-2 text-xs text-ink focus:border-antique outline-none"
                >
                  <option value="">Tất cả</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="inactive">Đã khóa</option>
                </select>
              </div>
            </div>

            {/* Users table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-sand text-xs font-bold text-stone-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Họ và Tên / Email</th>
                    <th className="py-3 px-4">Vai Trò</th>
                    <th className="py-3 px-4">Trạng Thái</th>
                    <th className="py-3 px-4 text-center">Đơn Thuê</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand/40 text-sm">
                  {users.map((u) => {
                    const isSelf = user?.id === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-warm-ivory/30 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-ink flex items-center gap-1.5">
                            {u.fullName || "Chưa thiết lập"}
                            {isSelf && (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-lotus/10 text-lotus px-1.5 py-0.2 rounded border border-lotus/20">
                                Bạn
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-stone-500 mt-0.5">{u.email}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded bg-lotus/10 text-lotus">
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                              u.isActive
                                ? "bg-jade/5 text-jade border-jade/30"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? "bg-jade/50" : "bg-rose-500"}`}></span>
                            {u.isActive ? "Hoạt động" : "Tạm khóa"}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center text-stone-600 font-medium">
                          {u.bookingCount} đơn
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => {
                              setEditingUser(u);
                              setUserForm({
                                fullName: u.fullName || "",
                                phone: u.phone || "",
                                role: u.role,
                                isActive: u.isActive,
                              });
                            }}
                            className="text-xs font-bold text-antique hover:text-lotus flex items-center gap-1 ml-auto"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Sửa
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-stone-500 font-medium">
                        Không tìm thấy tài khoản người dùng phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {userTotal > 10 && (
              <div className="px-4 py-3 border-t border-sand bg-warm-ivory/50 flex items-center justify-between text-xs">
                <span className="text-stone-500 font-medium">
                  Hiển thị {(userPage - 1) * 10 + 1} - {Math.min(userPage * 10, userTotal)} của {userTotal} tài khoản
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={userPage === 1}
                    onClick={() => setUserPage(userPage - 1)}
                    className="p-1 rounded text-stone-600 hover:bg-sand/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-3 py-1 bg-lotus text-white font-semibold rounded flex items-center justify-center">
                    {userPage}
                  </span>
                  <button
                    disabled={userPage * 10 >= userTotal}
                    onClick={() => setUserPage(userPage + 1)}
                    className="p-1 rounded text-stone-600 hover:bg-sand/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right panel: real permission matrix from the API */}
          <RolePermissionPanel roles={roleMatrix} loading={loading} />

          {/* Edit User Account Modal Dialog */}
          {editingUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
              <div className="w-full max-w-md bg-white rounded-xl border border-sand shadow-2xl overflow-hidden animate-zoom-in">
                <header className="p-5 border-b border-sand bg-warm-ivory flex justify-between items-center">
                  <h3 className="text-xl font-bold text-ink">Chỉnh Sửa Tài Khoản</h3>
                  <button
                    onClick={() => setEditingUser(null)}
                    className="text-stone-400 hover:text-stone-600 rounded-full p-1"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </header>

                <form onSubmit={handleUserEditSubmit} className="p-6 space-y-4">
                  {/* Lockout Guard Banner */}
                  {user?.id === editingUser.id && (
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs font-semibold flex items-start gap-2">
                      <AlertTriangle className="h-4.5 w-4.5 text-amber-600 shrink-0" />
                      <span>
                        Đây là tài khoản của bạn. Bạn không thể thay đổi vai trò hoặc tự khóa tài khoản của chính mình.
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Họ và Tên</label>
                    <input
                      type="text"
                      value={userForm.fullName}
                      onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink outline-none focus:border-antique"
                      placeholder="Nguyen Van A"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Số Điện Thoại</label>
                    <input
                      type="text"
                      value={userForm.phone}
                      onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink outline-none focus:border-antique"
                      placeholder="09xxxxxxxx"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Vai Trò Hệ Thống</label>
                    <select
                      value={userForm.role}
                      disabled={user?.id === editingUser.id}
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink outline-none focus:border-antique disabled:bg-stone-100 disabled:opacity-80"
                    >
                      <option value="admin">Super Admin</option>
                      <option value="manager_owner">Manager</option>
                      <option value="staff">Staff</option>
                      <option value="customer">Customer</option>
                    </select>
                  </div>

                  <div className="pt-2">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={userForm.isActive}
                        disabled={user?.id === editingUser.id}
                        onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })}
                        className="rounded border-sand text-lotus focus:ring-lotus h-5 w-5"
                      />
                      <span className="text-sm font-semibold text-ink">Cho phép hoạt động (Active Status)</span>
                    </label>
                  </div>

                  <footer className="pt-4 border-t border-sand/40 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingUser(null)}
                      className="px-4 py-2 border border-sand rounded-lg text-sm text-stone-600 hover:bg-stone-50 font-medium"
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="submit"
                      disabled={actioningUser}
                      className="px-5 py-2 bg-lotus hover:bg-oxblood text-white rounded-lg text-sm font-semibold shadow disabled:opacity-50"
                    >
                      {actioningUser ? "Đang lưu..." : "Lưu thay đổi"}
                    </button>
                  </footer>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────
          TAB: SYSTEM CONFIG & AI
      ──────────────────────────────────────────────────────── */}
      {tab === "security" && <SecurityPanel currentUserId={user?.id ?? null} onSuccess={triggerSuccess} onError={triggerError} />}

      {tab === "exports" && <DataExportPanel onSuccess={triggerSuccess} onError={triggerError} />}

      {tab === "config" && <SystemConfigPanel onSuccess={triggerSuccess} onError={triggerError} />}

      {tab === "notification-config" && (
        <NotificationConfigPanel />
      )}

      {/* ────────────────────────────────────────────────────────
          TAB: AUDIT LOGS
      ──────────────────────────────────────────────────────── */}
      {tab === "logs" && (
        <div className="space-y-6">
          {/* Filter Logs Panel */}
          <div className="bg-white rounded-xl border border-sand p-4 shadow-sm flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-[10px] uppercase font-bold text-stone-500 mb-1">Từ khóa tìm kiếm</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Tìm theo hành động, email, tên..."
                  value={logSearch}
                  onChange={(e) => {
                    setLogSearch(e.target.value);
                    setLogPage(1);
                  }}
                  className="w-full pl-10 pr-3 py-1.5 rounded-lg border border-sand bg-white text-xs text-ink outline-none focus:border-antique"
                />
              </div>
            </div>

            <AuditActionFilter
              group={logGroup}
              action={logActionFilter}
              actions={logActions}
              onGroupChange={(next) => {
                setLogGroup(next);
                if (logActionFilter !== "all" && next !== "all" && auditActionGroup(logActionFilter) !== next) {
                  setLogActionFilter("all");
                }
                setLogPage(1);
              }}
              onActionChange={(next) => {
                setLogActionFilter(next);
                setLogPage(1);
              }}
            />

            <button
              onClick={fetchAuditLogs}
              className="px-4 py-1.5 bg-lotus hover:bg-oxblood text-white rounded-lg text-xs font-semibold shadow"
            >
              Lọc nhật ký
            </button>
          </div>

          {/* Logs Data Table */}
          <div className="bg-white border border-sand rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-sand text-xs font-bold text-stone-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Thời Gian (Timestamp)</th>
                    <th className="py-3 px-4">Quản Trị Viên (Actor)</th>
                    <th className="py-3 px-4">Loại Hành Động</th>
                    <th className="py-3 px-4">Chi Tiết Bản Ghi (Description)</th>
                    <th className="py-3 px-4">Trạng Thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand/40 text-sm">
                  {auditLogs.map((log) => {
                    const formattedDate = new Intl.DateTimeFormat("vi-VN", {
                      dateStyle: "medium",
                      timeStyle: "medium",
                    }).format(new Date(log.createdAt));
                    
                    return (
                      <tr key={log.id} className="hover:bg-warm-ivory/30 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap text-stone-600 font-medium">
                          {formattedDate}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-ink">{log.actorName || "Hệ thống"}</div>
                          <div className="text-xs text-stone-500 mt-0.5">{log.actorEmail || "automated@system"}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                            {log.action === "ADMIN_UPDATE_USER" ? <UserCog className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-stone-600 font-medium max-w-sm truncate" title={log.summary}>
                          {log.summary}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-jade/5 border border-jade/30 text-jade text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Thành công
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-stone-500 font-medium">
                        Không có dữ liệu nhật ký kiểm toán phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {logTotal > 10 && (
              <div className="px-4 py-3 border-t border-sand bg-warm-ivory/50 flex items-center justify-between text-xs">
                <span className="text-stone-500 font-medium">
                  Hiển thị {(logPage - 1) * 10 + 1} - {Math.min(logPage * 10, logTotal)} của {logTotal} bản ghi
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={logPage === 1}
                    onClick={() => setLogPage(logPage - 1)}
                    className="p-1 rounded text-stone-600 hover:bg-sand/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-3 py-1 bg-lotus text-white font-semibold rounded flex items-center justify-center">
                    {logPage}
                  </span>
                  <button
                    disabled={logPage * 10 >= logTotal}
                    onClick={() => setLogPage(logPage + 1)}
                    className="p-1 rounded text-stone-600 hover:bg-sand/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminPortalShell>
  );
}
