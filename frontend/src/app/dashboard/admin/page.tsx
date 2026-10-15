"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { NotificationConfigPanel } from "@/components/admin/notification-config-panel";
import { AdminPortalShell } from "@/components/heritage/ui";
import { MapPreview } from "@/components/location/map-preview";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  CheckSquare,
  Activity,
  Pencil,
  ChevronLeft,
  ChevronRight,
  FileText,
  Banknote,
  Settings,
  Ban,
  X,
  Cpu,
  Wallet,
  SlidersHorizontal,
  Server,
  Save,
  Search,
  UserCog,
  type LucideIcon,
} from "lucide-react";

import {
  getAdminOverview,
  getAdminUsers,
  updateAdminUser,
  getAdminAuditLogs,
  getAdminSettings,
  updateAdminSetting,
  type AdminSummaryCard,
  type AdminQueueCard,
  type AdminUserEntry,
  type AdminAuditLogEntry,
  type AdminSettingEntry,
} from "@/lib/api";

type Tab = "overview" | "roles" | "config" | "notification-config" | "logs";
const VALID_TABS: Tab[] = ["overview", "roles", "config", "notification-config", "logs"];

function tabFromHash(): Tab {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace("#", "");
  return VALID_TABS.includes(hash as Tab) ? (hash as Tab) : "overview";
}

const TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  overview: {
    title: "Tổng Quan Hệ Thống",
    subtitle: "Theo dõi tình trạng hoạt động, cấu hình và bảo mật của toàn bộ nền tảng.",
  },
  roles: {
    title: "Quản Lý Vai Trò & Người Dùng",
    subtitle: "Thiết lập phân quyền và thay đổi quyền hạn tài khoản trong hệ thống.",
  },
  config: {
    title: "Cấu Hình Hệ Thống & AI",
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

const DEFAULT_AI_SETTINGS = {
  ai_model_version: "v3.2",
  ai_base_url: "https://api.cophuc-ai.vn/v1/inference",
  ai_primary_key: "sk-heritage-live-1a2b3c4d5e6f7g8h9i0j",
  ai_failover_key: "sk-heritage-fail-0j9i8h7g6f5e4d3c2b1a",
  ai_target_gpu: "asia-se1-a",
  ai_max_sessions: 120,
  ai_timeout: 8500,
  ai_autoscaling: true,
  payment_vnpay_tmncode: "ATELIER_TEST",
  payment_vnpay_hashsecret: "secretkey1234567890",
  payment_vnpay_returnurl: "https://erp.cophuc.vn/payments/callback",
  max_rental_days: 30,
  deposit_refund_window_h: 48,
  late_penalty_per_day: 200000,
  store_address: "Đại học FPT Đà Nẵng, Khu đô thị FPT City, Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng",
  store_phone: "0236 730 0999",
  store_lat: "15.967945",
  store_lng: "108.260727",
  shipping_rate_per_km: 5000,
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

  // State settings
  const [settings, setSettings] = useState<AdminSettingEntry[]>([]);
  const [aiSettings, setAiSettings] = useState(DEFAULT_AI_SETTINGS);

  // Loading & Alerts
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actioningUser, setActioningUser] = useState(false);
  const [actioningConfig, setActioningConfig] = useState(false);

  // Selected Role for Permission Preview
  const [selectedPreviewRole, setSelectedPreviewRole] = useState<string>("manager_owner");

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

  // Load Config Settings
  useEffect(() => {
    if (tab === "config") {
      setLoading(true);
      getAdminSettings()
        .then((res) => {
          if (res.success && res.data) {
            setSettings(res.data);
            // Map settings list to local form object values
            const mapped = { ...DEFAULT_AI_SETTINGS };
            res.data.forEach((s) => {
              const val = s.value && typeof s.value === "object" && "value" in s.value ? (s.value as any).value : s.value;
              if (s.key in mapped) {
                (mapped as any)[s.key] = val;
              }
            });
            setAiSettings(mapped);
          } else {
            setErrorMsg(res.error ?? "Không thể tải cấu hình hệ thống");
          }
        })
        .catch(() => setErrorMsg("Lỗi mạng khi tải cấu hình"))
        .finally(() => setLoading(false));
    }
  }, [tab]);

  // Load Audit Logs
  const fetchAuditLogs = useCallback(() => {
    setLoading(true);
    getAdminAuditLogs({
      search: logSearch || undefined,
      action: logActionFilter !== "all" ? logActionFilter : undefined,
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
  }, [logSearch, logActionFilter, logPage]);

  useEffect(() => {
    if (tab === "logs") {
      fetchAuditLogs();
    }
  }, [tab, fetchAuditLogs]);


  // Trigger Local Alerts helper
  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

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

  // Handle Save Config Settings
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setActioningConfig(true);
    setErrorMsg(null);

    try {
      // Collect parameters to update
      const keysToUpdate = Object.keys(aiSettings) as Array<keyof typeof aiSettings>;
      
      for (const key of keysToUpdate) {
        const val = aiSettings[key];
        // Only trigger update if setting has changed
        const dbSetting = settings.find((s) => s.key === key);
        const originalVal = dbSetting
          ? dbSetting.value && typeof dbSetting.value === "object" && "value" in dbSetting.value
            ? (dbSetting.value as any).value
            : dbSetting.value
          : null;

        if (originalVal !== val) {
          // Send update call — always wrap in { value } for consistency with backend
          await updateAdminSetting(
            key,
            typeof val === "number" || typeof val === "boolean" ? { value: val } : { value: val },
          );
        }
      }
      
      triggerSuccess("Cấu hình hệ thống và tham số AI đã được lưu thành công.");
    } catch (err: any) {
      triggerError(err.message ?? "Lỗi xảy ra khi lưu cấu hình.");
    } finally {
      setActioningConfig(false);
    }
  };

  // Role labels
  const roleLabelMap: Record<string, string> = {
    admin: "Super Admin",
    manager_owner: "Manager / Owner",
    staff: "Staff / Consultant",
    customer: "Customer Portal",
  };

  // Permissions Preset for Role Grid Mockup preview
  const rolePermissionsPreset: Record<string, Record<string, string[]>> = {
    admin: {
      inventory: ["Xem", "Thêm", "Sửa", "Xóa"],
      bookings: ["Xem", "Thêm", "Sửa", "Xóa"],
      finance: ["Xem", "Thêm", "Sửa", "Xóa"],
      config: ["Xem", "Thêm", "Sửa", "Xóa"],
    },
    manager_owner: {
      inventory: ["Xem", "Thêm", "Sửa"],
      bookings: ["Xem", "Thêm", "Sửa"],
      finance: ["Xem"],
      config: ["Xem"],
    },
    staff: {
      inventory: ["Xem"],
      bookings: ["Xem", "Thêm", "Sửa"],
      finance: [],
      config: [],
    },
    customer: {
      inventory: ["Xem"],
      bookings: ["Xem", "Thêm"],
      finance: [],
      config: [],
    },
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
                  <p className="mt-2 font-display text-4xl font-bold text-ink">
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
              <h3 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
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
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lotus/10 font-display text-sm font-bold text-lotus">
                      {q.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* System Breakdown Charts / Tables */}
            <div className="lg:col-span-2 space-y-6">
              <h3 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
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
              <h3 className="font-display text-2xl font-bold text-ink">Danh Sách Tài Khoản</h3>
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
                          <div className="text-xs text-stone-500 font-mono mt-0.5">{u.email}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded bg-lotus/10 text-lotus">
                            {roleLabelMap[u.role] || u.role}
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

          {/* Right panel: User Roles & preset permissions grid layout */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-sand shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-sand/60 bg-warm-ivory">
              <h3 className="font-display text-2xl font-bold text-ink">Bảng Phân Quyền Vai Trò</h3>
            </div>
            
            {/* Roles list */}
            <div className="p-4 border-b border-sand/30 bg-stone-50/50 flex gap-2 overflow-x-auto">
              {Object.keys(roleLabelMap).map((roleKey) => (
                <button
                  key={roleKey}
                  onClick={() => setSelectedPreviewRole(roleKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedPreviewRole === roleKey
                      ? "bg-lotus text-white"
                      : "bg-white text-stone-600 border border-sand hover:bg-warm-ivory/50"
                  }`}
                >
                  {roleLabelMap[roleKey]}
                </button>
              ))}
            </div>

            {/* Permission detailed grid */}
            <div className="p-6 space-y-6">
              <div className="border-b border-sand pb-2 flex justify-between items-end">
                <div>
                  <h4 className="font-display text-lg font-bold text-lotus">
                    Quyền hạn: {roleLabelMap[selectedPreviewRole]}
                  </h4>
                  <p className="text-xs text-stone-500 mt-0.5">Quyền hạn hệ thống được định nghĩa cứng trong kiến trúc ứng dụng.</p>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  { key: "inventory", label: "Kho Hàng (Inventory)", icon: "inventory_2" },
                  { key: "bookings", label: "Đơn Thuê & Hợp Đồng (Bookings)", icon: FileText },
                  { key: "finance", label: "Đối Soát Tài Chính (Finance)", icon: Banknote },
                  { key: "config", label: "Cấu Hình Hệ Thống (Settings)", icon: Settings },
                ].map((res) => {
                  const allowed = rolePermissionsPreset[selectedPreviewRole]?.[res.key] || [];
                  return (
                    <div key={res.key} className="p-4 rounded-xl border border-sand bg-warm-ivory/20">
                      <div className="flex items-center gap-2 mb-3">
                        {(() => { const ResIcon = res.icon; return <ResIcon className="h-5 w-5 text-antique" />; })()}
                        <span className="text-sm font-semibold text-ink">{res.label}</span>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        {["Xem", "Thêm", "Sửa", "Xóa"].map((perm) => {
                          const hasPerm = allowed.includes(perm);
                          return (
                            <div
                              key={perm}
                              className={`py-1 rounded border flex items-center justify-center gap-1 ${
                                hasPerm
                                  ? "bg-jade/5 border-jade/30 text-jade font-semibold"
                                  : "bg-stone-50 border-stone-200 text-stone-400 opacity-60"
                              }`}
                            >
                              {hasPerm ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                              {perm}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Edit User Account Modal Dialog */}
          {editingUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
              <div className="w-full max-w-md bg-white rounded-xl border border-sand shadow-2xl overflow-hidden animate-zoom-in">
                <header className="p-5 border-b border-sand bg-warm-ivory flex justify-between items-center">
                  <h3 className="font-display text-xl font-bold text-ink">Chỉnh Sửa Tài Khoản</h3>
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
      {tab === "config" && (
        <>
        <form onSubmit={handleSaveConfig} className="grid gap-8 lg:grid-cols-12 items-start">
          {/* AI Settings Form */}
          <div className="lg:col-span-8 space-y-6">
            {/* AI Engine parameters */}
            <div className="bg-white rounded-xl border border-sand p-6 shadow-sm">
              <header className="flex justify-between items-start mb-6 border-b border-sand pb-4">
                <div>
                  <h3 className="font-display text-xl font-bold text-ink flex items-center gap-2">
                    <Cpu className="h-6 w-6 text-antique" />
                    AI Engine Parameters
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Cấu hình đường truyền mạng và khoá API cho mạng nơ-ron Heritage-V3.2.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-jade/30 bg-jade/5 text-jade text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-jade/50"></span>
                  Đang hoạt động
                </span>
              </header>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Phiên bản mô hình AI</label>
                  <select
                    value={aiSettings.ai_model_version}
                    onChange={(e) => setAiSettings({ ...aiSettings, ai_model_version: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  >
                    <option value="v3.2">Heritage-V3.2 (Ổn định hiện tại)</option>
                    <option value="v4.0-beta">Heritage-V4.0 (Thử nghiệm Beta)</option>
                    <option value="v3.1">Heritage-V3.1 (Di sản cũ)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">AI Base Endpoint URL</label>
                  <input
                    type="text"
                    value={aiSettings.ai_base_url}
                    onChange={(e) => setAiSettings({ ...aiSettings, ai_base_url: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Primary API Key</label>
                    <input
                      type="password"
                      value={aiSettings.ai_primary_key}
                      onChange={(e) => setAiSettings({ ...aiSettings, ai_primary_key: e.target.value })}
                      className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Secondary API Key</label>
                    <input
                      type="password"
                      value={aiSettings.ai_failover_key}
                      onChange={(e) => setAiSettings({ ...aiSettings, ai_failover_key: e.target.value })}
                      className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Integration */}
            <div className="bg-white rounded-xl border border-sand p-6 shadow-sm">
              <header className="mb-6 border-b border-sand pb-4">
                <h3 className="font-display text-xl font-bold text-ink flex items-center gap-2">
                  <Wallet className="h-6 w-6 text-antique" />
                  Payment Gateway Integration
                </h3>
                <p className="text-xs text-stone-500 mt-1">Cấu hình kết nối cổng VNPAY để xử lý giao dịch đặt cọc tự động.</p>
              </header>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">vnp_TmnCode</label>
                  <input
                    type="text"
                    value={aiSettings.payment_vnpay_tmncode}
                    onChange={(e) => setAiSettings({ ...aiSettings, payment_vnpay_tmncode: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">vnp_HashSecret</label>
                  <input
                    type="password"
                    value={aiSettings.payment_vnpay_hashsecret}
                    onChange={(e) => setAiSettings({ ...aiSettings, payment_vnpay_hashsecret: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">vnp_ReturnUrl</label>
                  <input
                    type="text"
                    value={aiSettings.payment_vnpay_returnurl}
                    onChange={(e) => setAiSettings({ ...aiSettings, payment_vnpay_returnurl: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none text-sm"
                  />
                </div>
              </div>
            </div>

            {/* General Database Settings */}
            <div className="bg-white rounded-xl border border-sand p-6 shadow-sm">
              <header className="mb-6 border-b border-sand pb-4">
                <h3 className="font-display text-xl font-bold text-ink flex items-center gap-2">
                  <SlidersHorizontal className="h-6 w-6 text-antique" />
                  General Business Settings
                </h3>
                <p className="text-xs text-stone-500 mt-1">Thiết lập chính sách đơn thuê, địa chỉ cửa hàng và tiền phạt quá hạn.</p>
              </header>

              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Số ngày thuê tối đa</label>
                  <input
                    type="number"
                    value={aiSettings.max_rental_days}
                    onChange={(e) => setAiSettings({ ...aiSettings, max_rental_days: parseInt(e.target.value) || 0 })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Cửa sổ hoàn cọc (Giờ)</label>
                  <input
                    type="number"
                    value={aiSettings.deposit_refund_window_h}
                    onChange={(e) => setAiSettings({ ...aiSettings, deposit_refund_window_h: parseInt(e.target.value) || 0 })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Phí trễ hạn / Ngày (đ)</label>
                  <input
                    type="number"
                    value={aiSettings.late_penalty_per_day}
                    onChange={(e) => setAiSettings({ ...aiSettings, late_penalty_per_day: parseInt(e.target.value) || 0 })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2 mt-4">
                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Địa chỉ cửa hàng</label>
                  <input
                    type="text"
                    value={aiSettings.store_address}
                    onChange={(e) => setAiSettings({ ...aiSettings, store_address: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Hotline cửa hàng</label>
                  <input
                    type="text"
                    value={aiSettings.store_phone}
                    onChange={(e) => setAiSettings({ ...aiSettings, store_phone: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-3 mt-4">
                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Vĩ độ Atelier</label>
                  <input
                    type="text"
                    value={aiSettings.store_lat}
                    onChange={(e) => setAiSettings({ ...aiSettings, store_lat: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                    placeholder="10.7769"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Kinh độ Atelier</label>
                  <input
                    type="text"
                    value={aiSettings.store_lng}
                    onChange={(e) => setAiSettings({ ...aiSettings, store_lng: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                    placeholder="106.7009"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Phí giao hàng/km (VND)</label>
                  <input
                    type="number"
                    value={aiSettings.shipping_rate_per_km}
                    onChange={(e) => setAiSettings({ ...aiSettings, shipping_rate_per_km: parseInt(e.target.value) || 0 })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>
              </div>

              {(() => {
                const sl = parseFloat(aiSettings.store_lat);
                const sln = parseFloat(aiSettings.store_lng);
                if (!Number.isFinite(sl) || !Number.isFinite(sln)) return null;
                return (
                  <div className="mt-4">
                    <label className="block text-xs uppercase font-bold text-stone-500 mb-2">Xem trước vị trí Atelier</label>
                    <MapPreview lat={sl} lng={sln} />
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Right panel: Compute allocation sidebar & Save */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white rounded-xl border border-sand p-6 shadow-sm space-y-6">
              <header className="border-b border-sand pb-4">
                <h3 className="font-display text-xl font-bold text-ink flex items-center gap-2">
                  <Server className="h-6 w-6 text-antique" />
                  Compute Allocation
                </h3>
                <p className="text-xs text-stone-500 mt-1">Quản lý tải và cụm GPU inference cho hệ thống.</p>
              </header>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">GPU Cluster chính</label>
                  <select
                    value={aiSettings.ai_target_gpu}
                    onChange={(e) => setAiSettings({ ...aiSettings, ai_target_gpu: e.target.value })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none text-sm"
                  >
                    <option value="asia-se1-a">asia-southeast1-a (Primary A100)</option>
                    <option value="asia-se1-b">asia-southeast1-b (Secondary V100)</option>
                    <option value="asia-east1">asia-east1 (Fallback T4)</option>
                  </select>
                </div>

                <div className="bg-warm-ivory p-4 rounded-lg border border-sand/50">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold uppercase text-stone-500">Giới Hạn Kết Nối Đồng Thời</label>
                    <span className="text-sm font-bold text-lotus">{aiSettings.ai_max_sessions}</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={500}
                    value={aiSettings.ai_max_sessions}
                    onChange={(e) => setAiSettings({ ...aiSettings, ai_max_sessions: parseInt(e.target.value) || 10 })}
                    className="w-full accent-lotus cursor-pointer h-2 bg-sand rounded-lg appearance-none"
                  />
                  <div className="flex justify-between text-[10px] text-stone-500 font-bold uppercase mt-1">
                    <span>10</span>
                    <span>500</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold text-stone-500 mb-1">Timeout Suy Luận AI (ms)</label>
                  <input
                    type="number"
                    value={aiSettings.ai_timeout}
                    onChange={(e) => setAiSettings({ ...aiSettings, ai_timeout: parseInt(e.target.value) || 1000 })}
                    className="w-full border-0 border-b border-sand bg-transparent py-2 text-ink font-body-md focus:border-antique focus:ring-0 outline-none"
                  />
                </div>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={aiSettings.ai_autoscaling}
                    onChange={(e) => setAiSettings({ ...aiSettings, ai_autoscaling: e.target.checked })}
                    className="rounded border-sand text-lotus focus:ring-lotus h-5 w-5"
                  />
                  <span className="text-sm font-semibold text-ink">Bật tự động giãn nở (Auto-scaling)</span>
                </label>
              </div>

              <div className="pt-4 border-t border-sand/40 space-y-2">
                <button
                  type="submit"
                  disabled={actioningConfig}
                  className="w-full py-3 bg-lotus hover:bg-oxblood text-white rounded-lg text-sm font-semibold shadow-md flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  <Save className="h-5 w-5" />
                  {actioningConfig ? "Đang lưu cấu hình..." : "Lưu Toàn Bộ Cấu Hình"}
                </button>
                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="w-full py-2.5 border border-sand bg-white text-stone-600 rounded-lg text-sm font-semibold hover:bg-stone-50"
                >
                  Huỷ bỏ
                </button>
              </div>
            </div>
          </div>
        </form>
        </>
      )}

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

            <div className="w-52">
              <label className="block text-[10px] uppercase font-bold text-stone-500 mb-1">Loại thao tác (Action)</label>
              <select
                value={logActionFilter}
                onChange={(e) => {
                  setLogActionFilter(e.target.value);
                  setLogPage(1);
                }}
                className="w-full rounded-lg border border-sand bg-white py-1.5 px-3 text-xs text-ink focus:border-antique outline-none appearance-none"
              >
                <option value="all">Tất cả hành động</option>
                <option value="ADMIN_UPDATE_USER">Cập nhật quyền người dùng</option>
                <option value="ADMIN_UPDATE_SETTING">Thay đổi cấu hình hệ thống</option>
              </select>
            </div>

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
                          <div className="text-xs text-stone-500 font-mono mt-0.5">{log.actorEmail || "automated@system"}</div>
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
