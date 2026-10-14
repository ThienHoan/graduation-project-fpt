"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { useAuth } from "@/components/auth/auth-provider";
import { StaffChatNavBadge } from "@/components/chat/staff-chat-nav-badge";
import { ManagerReviewsNavBadge } from "@/components/dashboard/manager-reviews-nav-badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { bookingFlowSteps } from "@/lib/heritage-mock-data";
import {
  Check,
  Headphones,
  Plus,
  LogOut,
  AlertCircle,
  User,
  LayoutDashboard,
  Search,
  Star,
  MessageSquare,
  ArrowLeftRight,
  Shirt,
  Sparkles,
  ClipboardCheck,
  Waves,
  AlertTriangle,
  XCircle,
  DollarSign,
  RefreshCw,
  Tag,
  TrendingUp,
  Ticket,
  ShieldCheck,
  Sliders,
  Bell,
  FileText,
  type LucideIcon,
} from "lucide-react";

type BookingStepKey = (typeof bookingFlowSteps)[number]["key"];
type StaffNavKey = "overview" | "inspection"| "chat" | "reviews";
type ManagerNavKey = "overview" | "inventory" | "accessories" | "inspection-log" | "laundry" | "damaged" | "finance" | "assets" | "reviews" | "refunds" | "chat" | "pricing" | "rejected-handovers" | "vouchers" | "product-stats";
export type AdminNavKey = "overview" | "roles" | "config" | "notification-config" | "logs";

export function BookingFlowShell({
  currentStep,
  title,
  description,
  children,
}: {
  currentStep: BookingStepKey;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1">
      <aside className="hidden h-[calc(100vh-64px)] w-64 shrink-0 border-r border-sand/70 bg-parchment p-6 lg:sticky lg:top-16 lg:flex lg:flex-col">
          <div className="mb-8">
            <h2 className="font-display text-2xl text-lotus">Tiến trình đặt thuê</h2>
            <p className="mt-1 text-sm text-stone-500">Theo dõi từng bước xác nhận</p>
          </div>
          <nav className="relative flex flex-1 flex-col gap-4">
            {/* Vertical connector line */}
            <div className="absolute bottom-6 left-6 top-6 w-px bg-sand" />

            {bookingFlowSteps.map((step, index) => {
              const isActive = step.key === currentStep;
              // Check if step is completed (comes before current step)
              const currentIndex = bookingFlowSteps.findIndex((s) => s.key === currentStep);
              const isCompleted = index < currentIndex;

              return (
                <div key={step.key} className="relative z-10">
                  <Link
                    href={step.href}
                    className={`flex items-center gap-4 rounded-lg px-2 py-2 transition-all ${
                      isActive
                        ? "bg-white shadow-sm ring-1 ring-lotus/20"
                        : "hover:bg-white/50"
                    }`}
                  >
                    {/* Step indicator circle */}
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        isActive
                          ? "border-lotus bg-lotus text-white shadow-sm"
                          : isCompleted
                            ? "border-jade bg-jade text-white"
                            : "border-sand bg-mist text-stone-400"
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <span className="text-xs font-bold">{index + 1}</span>
                      )}
                    </div>

                    {/* Text content */}
                    <div>
                      <span
                        className={`block text-sm font-semibold ${
                          isActive ? "text-lotus" : isCompleted ? "text-ink" : "text-stone-500"
                        }`}
                      >
                        {step.label}
                      </span>
                      <span className="block text-[11px] uppercase tracking-wider text-stone-400">
                        Bước {index + 1}
                      </span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </nav>
          <Link
            href="/chat"
            className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-sand bg-white px-4 py-3 text-sm font-semibold text-lotus transition hover:border-lotus/30 hover:bg-lotus/5"
          >
            <Headphones className="h-4 w-4" />
            Hỗ trợ đặt thuê
          </Link>
        </aside>

        <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-12 lg:py-12">
          <div className="mb-10 max-w-3xl">
            <h1 className="font-display text-4xl text-ink sm:text-5xl">{title}</h1>
            <p className="mt-3 text-base leading-8 text-stone-600">{description}</p>
          </div>
          {children}
        </main>
      </div>
  );
}

export function StaffPortalShell({
  active,
  title,
  subtitle,
  onTabChange,
  children,
}: {
  active: StaffNavKey;
  title: string;
  subtitle: string;
  children: ReactNode;
  onTabChange?: (key: StaffNavKey) => void;
}) {
  const items: { key: StaffNavKey; label: string; icon: LucideIcon; href: string }[] = [
    { key: "overview", label: "Tổng quan", icon: LayoutDashboard, href: "/dashboard/staff" },
    { key: "inspection", label: "Kiểm tra", icon: Search, href: "/dashboard/staff/inspection" },
    { key: "reviews", label: "Đánh giá", icon: Star, href: "/dashboard/staff/reviews" },
    { key: "chat", label: "CSKH", icon: MessageSquare, href: "/chat" },
  ];

  return (
    <div className="min-h-screen bg-mist text-ink lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sand bg-parchment p-4 lg:flex">
        <div className="mb-8 px-3 pt-4">
          <h1 className="font-display text-3xl text-lotus">Nhân viên Atelier</h1>
          <p className="mt-1 text-sm text-stone-500">Central Operations</p>
        </div>
        <Link href="/catalog" className="mb-8 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-3 text-sm font-semibold text-white transition hover:bg-oxblood">
          <Plus className="h-4 w-4" />
          Tạo booking mới
        </Link>
        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const isActive = item.key === active;
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={isActive
                  ? "flex items-center gap-3 rounded-xl bg-lotus/10 px-4 py-3 text-sm font-semibold text-lotus"
                  : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus"}
              >
                <ItemIcon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
                {item.key === "chat" && <StaffChatNavBadge />}
              </Link>
            );
          })}
        </nav>
        <LogoutButton className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl border border-oxblood/30 bg-white px-4 py-3 text-sm font-semibold text-oxblood transition hover:bg-oxblood hover:text-white">
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </LogoutButton>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-sand bg-mist/95 px-4 backdrop-blur md:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-3xl text-lotus">Cổ Phục Rental</h2>
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link
              href="/dashboard/staff/profile"
              className="inline-flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Hồ sơ</span>
            </Link>
            <LogoutButton className="inline-flex items-center gap-2 rounded-full border border-oxblood/30 bg-white px-3 py-2 text-sm font-semibold text-oxblood transition hover:bg-oxblood hover:text-white">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </LogoutButton>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="font-display text-4xl text-ink sm:text-5xl">{title}</h1>
            <p className="mt-2 text-base text-stone-600">{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function ManagerPortalShell({
  active,
  title,
  subtitle,
  onTabChange,
  managerName,
  managerEmail,
  onProfile,
  onSignOut,
  currentDateLabel = "",
  children,
}: {
  active: ManagerNavKey;
  title: string;
  subtitle: string;
  onTabChange?: (key: ManagerNavKey) => void;
  managerName?: string;
  managerEmail?: string | null;
  onProfile?: () => void;
  onSignOut?: () => void;
  currentDateLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { signOut, user } = useAuth();

  const effectiveName = managerName ?? user?.fullName ?? user?.email?.split("@")[0] ?? "Quản lý cửa hàng";
  const effectiveEmail = managerEmail !== undefined ? managerEmail : (user?.email ?? null);

  const initials = effectiveName
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "QL";

  const handleProfile = () => {
    if (onProfile) {
      onProfile();
    } else {
      router.push("/dashboard/manager/profile");
    }
  };

  const handleSignOut = () => {
    if (onSignOut) {
      onSignOut();
    } else {
      signOut();
      router.replace("/login");
    }
  };

  // Manager: nút chính là thêm trang phục (đi tới inventory), không phải tạo booking
  const items: { key: ManagerNavKey; label: string; icon: LucideIcon; href: string }[] = [
    { key: "overview", label: "Tổng quan", icon: LayoutDashboard, href: "/dashboard/manager" },
    { key: "assets", label: "Gán tài sản", icon: ArrowLeftRight, href: "/dashboard/manager#assets" },
    { key: "inventory", label: "Kho trang phục", icon: Shirt, href: "/dashboard/manager#inventory" },
    { key: "accessories", label: "Kho phụ kiện", icon: Sparkles, href: "/dashboard/manager/accessories" },
    { key: "inspection-log", label: "Nhật ký kiểm tra", icon: ClipboardCheck, href: "/dashboard/manager#inspection-log" },
    { key: "laundry", label: "Giặt sấy", icon: Waves, href: "/dashboard/manager#laundry" },
    { key: "damaged", label: "Hư hỏng & Mất", icon: AlertTriangle, href: "/dashboard/manager#damaged" },
    { key: "rejected-handovers", label: "Từ chối bàn giao", icon: XCircle, href: "/dashboard/manager#rejected-handovers" },
    { key: "finance", label: "Tài chính", icon: DollarSign, href: "/dashboard/manager#finance" },
    { key: "reviews", label: "Đánh giá", icon: Star, href: "/dashboard/manager/reviews" },
    { key: "refunds", label: "Duyệt hoàn cọc", icon: RefreshCw, href: "/dashboard/manager#refunds" },
    { key: "pricing", label: "Điều chỉnh giá", icon: Tag, href: "/dashboard/manager/pricing" },
    { key: "product-stats", label: "Hiệu quả sản phẩm", icon: TrendingUp, href: "/dashboard/manager/product-stats" },
    { key: "vouchers", label: "Voucher & KM", icon: Ticket, href: "/dashboard/manager/vouchers" },
    { key: "chat", label: "CSKH", icon: MessageSquare, href: "/chat" },
  ];

  return (
    <div className="min-h-screen bg-mist text-ink lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sand bg-parchment p-4 lg:flex">
        <div className="mb-8 px-3 pt-4">
          <h1 className="font-display text-3xl text-lotus">Cổ Phục Rental</h1>
          <p className="mt-1 text-sm text-stone-500">Bảng quản lý vận hành</p>
        </div>
        <div className="mb-8 flex items-center gap-4 rounded-xl border border-sand/70 bg-white p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-lotus/10 font-display text-xl text-lotus">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{effectiveName}</p>
            <p className="truncate text-xs uppercase tracking-[0.16em] text-antique">{effectiveEmail ?? "Manager / Owner"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (onTabChange) {
              onTabChange("inventory");
            } else {
              // Trang con không có onTabChange: SPA về trang chính, tab kho trang phục
              router.push("/dashboard/manager#inventory");
            }
          }}
          className="mb-6 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-3 text-sm font-semibold text-white transition hover:bg-oxblood"
        >
          <Plus className="h-4 w-4" />
          Thêm trang phục
        </button>
        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const isActive = item.key === active;
            const ItemIcon = item.icon;
            return (
              <a
                key={item.key}
                href={item.href}
                onClick={(e) => {
                  // Luôn chặn điều hướng thường để dùng SPA: sidebar giữ nguyên,
                  // không remount layout, không hiện "Loading your account...".
                  e.preventDefault();
                  const isHashTab =
                    (item.href.includes('#') || item.href === '/dashboard/manager') &&
                    item.key !== "chat";
                  if (isHashTab && onTabChange) {
                    // Trang chính: chuyển tab nội bộ, không reload.
                    onTabChange(item.key);
                  } else {
                    // Trang con hoặc trang riêng: SPA sang route mới,
                    // layout manager giữ nguyên nên sidebar không mất.
                    router.push(item.href);
                  }
                }}
                className={isActive
                  ? "flex items-center gap-3 rounded-xl bg-lotus/10 px-4 py-3 text-sm font-semibold text-lotus"
                  : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus"}
              >
                <ItemIcon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
                {item.key === "reviews" && <ManagerReviewsNavBadge />}
                {item.key === "chat" && <StaffChatNavBadge />}
              </a>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-sand pt-4">
          <Link href="/chat" className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus">
            <Headphones className="h-5 w-5 shrink-0" />
            <span>Hỗ trợ vận hành</span>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-sand bg-mist/95 px-4 backdrop-blur md:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-3xl text-lotus">Cổ Phục Rental</h2>
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden rounded-lg border border-sand bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 xl:block">
              {currentDateLabel || "Đang đồng bộ"}
            </div>
            <NotificationBell />
            <button type="button" onClick={() => {
              if (onTabChange) {
                onTabChange("assets");
              } else {
                router.push("/dashboard/manager#assets");
              }
            }} className="hidden items-center gap-2 rounded-lg bg-lotus px-3 py-2 text-sm font-semibold text-white transition hover:bg-oxblood sm:inline-flex">
              <AlertCircle className="h-4 w-4" />
              Cần xử lý
            </button>
            <button type="button" onClick={handleProfile} className="inline-flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Hồ sơ</span>
            </button>
            <button type="button" onClick={handleSignOut} className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl text-ink sm:text-5xl">{title}</h1>
              <p className="mt-2 text-base text-stone-600">{subtitle}</p>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bronze">Manager / Owner</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminPortalShell({
  active,
  title,
  subtitle,
  onTabChange,
  adminName,
  adminEmail,
  onProfile,
  onSignOut,
  currentDateLabel = "",
  children,
}: {
  active: AdminNavKey;
  title: string;
  subtitle: string;
  onTabChange?: (key: AdminNavKey) => void;
  adminName?: string;
  adminEmail?: string | null;
  onProfile?: () => void;
  onSignOut?: () => void;
  currentDateLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { signOut, user } = useAuth();

  const effectiveName = adminName ?? user?.fullName ?? user?.email?.split("@")[0] ?? "Quản trị viên";
  const effectiveEmail = adminEmail !== undefined ? adminEmail : (user?.email ?? null);

  const initials = effectiveName
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AD";

  const handleProfile = () => {
    if (onProfile) {
      onProfile();
    } else {
      router.push("/dashboard/admin/profile");
    }
  };

  const handleSignOut = () => {
    if (onSignOut) {
      onSignOut();
    } else {
      signOut();
      router.replace("/login");
    }
  };

  const items: { key: AdminNavKey; label: string; icon: LucideIcon; href: string }[] = [
    { key: "overview", label: "Tổng quan", icon: LayoutDashboard, href: "/dashboard/admin" },
    { key: "roles", label: "Vai trò & Tài khoản", icon: ShieldCheck, href: "/dashboard/admin#roles" },
    { key: "config", label: "Cấu hình hệ thống", icon: Sliders, href: "/dashboard/admin#config" },
    { key: "notification-config", label: "Cấu hình thông báo", icon: Bell, href: "/dashboard/admin#notification-config" },
    { key: "logs", label: "Nhật ký kiểm soát", icon: FileText, href: "/dashboard/admin#logs" },
  ];

  return (
    <div className="min-h-screen bg-mist text-ink lg:flex">
      {/* Side Navigation */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sand bg-parchment p-4 lg:flex">
        <div className="mb-8 px-3 pt-4">
          <h1 className="font-display text-3xl text-lotus">Cổ Phục Rental</h1>
          <p className="mt-1 text-sm text-stone-500">Hệ thống quản trị</p>
        </div>
        <div className="mb-8 flex items-center gap-4 rounded-xl border border-sand/70 bg-white p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-lotus/10 font-display text-xl text-lotus">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{effectiveName}</p>
            <p className="truncate text-xs uppercase tracking-[0.16em] text-antique">{effectiveEmail ?? "Super Admin"}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const isActive = item.key === active;
            const ItemIcon = item.icon;
            return (
              <a
                key={item.key}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  onTabChange?.(item.key);
                }}
                className={isActive
                  ? "flex items-center gap-3 rounded-xl bg-lotus/10 px-4 py-3 text-sm font-semibold text-lotus"
                  : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus"}
              >
                <ItemIcon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-sand pt-4">
          <Link href="/chat" className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus">
            <Headphones className="h-5 w-5 shrink-0" />
            <span>Hỗ trợ quản trị</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-sand bg-mist/95 px-4 backdrop-blur md:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-3xl text-lotus">Cổ Phục Rental</h2>
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden rounded-lg border border-sand bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 xl:block">
              {currentDateLabel || "Đang đồng bộ"}
            </div>
            <button type="button" onClick={handleProfile} className="inline-flex items-center gap-2 rounded-lg border border-sand bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Hồ sơ</span>
            </button>
            <button type="button" onClick={handleSignOut} className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl text-ink sm:text-5xl">{title}</h1>
              <p className="mt-2 text-base text-stone-600">{subtitle}</p>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bronze">Super Admin</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  onConfirm,
  onCancel,
  danger = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-sand bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-2xl text-ink">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-stone-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-sand px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition ${danger ? "bg-red-600 hover:bg-red-700" : "bg-lotus hover:bg-oxblood"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
