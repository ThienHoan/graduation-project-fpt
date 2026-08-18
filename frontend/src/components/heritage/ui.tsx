"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { StaffChatNavBadge } from "@/components/chat/staff-chat-nav-badge";
import { ManagerReviewsNavBadge } from "@/components/dashboard/manager-reviews-nav-badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { bookingFlowSteps } from "@/lib/heritage-mock-data";

type BookingStepKey = (typeof bookingFlowSteps)[number]["key"];
type StaffNavKey = "overview" | "inspection"| "chat" | "reviews";
type ManagerNavKey = "overview" | "inventory" | "inspection-log" | "laundry" | "damaged" | "finance" | "assets" | "reviews" | "refunds" | "chat" | "pricing";
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
                        <span className="material-symbols-outlined text-[16px]">check</span>
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
          <button type="button" className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-sand bg-white px-4 py-3 text-sm font-semibold text-lotus transition hover:border-lotus/30 hover:bg-lotus/5">
            <span className="material-symbols-outlined text-[18px]">support_agent</span>
            Hỗ trợ đặt thuê
          </button>
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
  const items = [
    { key: "overview", label: "Tổng quan", icon: "dashboard", href: "/dashboard/staff" },
    { key: "inspection", label: "Kiểm tra", icon: "search_check", href: "/dashboard/staff/inspection" },
    { key: "reviews", label: "Đánh giá", icon: "reviews", href: "/dashboard/staff/reviews" },
    { key: "chat", label: "CSKH", icon: "chat", href: "/chat" },
  ] as const;

  return (
    <div className="min-h-screen bg-mist text-ink lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sand bg-parchment p-4 lg:flex">
        <div className="mb-8 px-3 pt-4">
          <h1 className="font-display text-3xl text-lotus">Nhân sự Atelier</h1>
          <p className="mt-1 text-sm text-stone-500">Central Operations</p>
        </div>
        <Link href="/catalog" className="mb-8 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-3 text-sm font-semibold text-white transition hover:bg-oxblood">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Tạo booking mới
        </Link>
        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={isActive
                  ? "flex items-center gap-3 rounded-xl bg-lotus/10 px-4 py-3 text-sm font-semibold text-lotus"
                  : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus"}
              >
                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                <span>{item.label}</span>
                {item.key === "chat" && <StaffChatNavBadge />}
              </Link>
            );
          })}
        </nav>
        <LogoutButton className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl border border-oxblood/30 bg-white px-4 py-3 text-sm font-semibold text-oxblood transition hover:bg-oxblood hover:text-white">
          <span className="material-symbols-outlined text-[18px]">logout</span>
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
            <LogoutButton className="inline-flex items-center gap-2 rounded-full border border-oxblood/30 bg-white px-3 py-2 text-sm font-semibold text-oxblood transition hover:bg-oxblood hover:text-white">
              <span className="material-symbols-outlined text-[18px]">logout</span>
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
  managerName = "Quản lý cửa hàng",
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
  const initials = managerName
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "QL";
  // Manager: nút chính là thêm trang phục (đi tới inventory), không phải tạo booking
  const items = [
    { key: "overview", label: "Tổng quan", icon: "dashboard", href: "/dashboard/manager" },
    { key: "assets", label: "Gán tài sản", icon: "swap_horiz", href: "/dashboard/manager#assets" },
    { key: "inventory", label: "Kho trang phục", icon: "inventory_2", href: "/dashboard/manager#inventory" },
    { key: "inspection-log", label: "Nhật ký kiểm tra", icon: "fact_check", href: "/dashboard/manager#inspection-log" },
    { key: "laundry", label: "Giặt sấy", icon: "dry_cleaning", href: "/dashboard/manager#laundry" },
    { key: "damaged", label: "Hư hỏng & Mất", icon: "report_problem", href: "/dashboard/manager#damaged" },
    { key: "finance", label: "Tài chính", icon: "payments", href: "/dashboard/manager#finance" },
    { key: "reviews", label: "Đánh giá", icon: "reviews", href: "/dashboard/manager/reviews" },
    { key: "refunds", label: "Duyệt hoàn cọc", icon: "currency_exchange", href: "/dashboard/manager#refunds" },
    { key: "pricing", label: "Điều chỉnh giá", icon: "price_change", href: "/dashboard/manager/pricing" },
    { key: "chat", label: "CSKH", icon: "chat", href: "/chat" },
  ] as const;

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
            <p className="truncate text-sm font-semibold text-ink">{managerName}</p>
            <p className="truncate text-xs uppercase tracking-[0.16em] text-antique">{managerEmail ?? "Manager / Owner"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onTabChange?.("inventory")}
          className="mb-6 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-3 text-sm font-semibold text-white transition hover:bg-oxblood"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Thêm trang phục
        </button>
        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const isActive = item.key === active;
            return (
              <a
                key={item.key}
                href={item.href}
                onClick={(e) => {
                  if (item.href.includes('#') || item.href === '/dashboard/manager') {
                    // CSKH là trang riêng (/chat) — điều hướng thẳng, không xử lý theo hash tab
                  if (item.key === "chat") return;
                  e.preventDefault();
                    onTabChange?.(item.key);
                  }
                }}
                className={isActive
                  ? "flex items-center gap-3 rounded-xl bg-lotus/10 px-4 py-3 text-sm font-semibold text-lotus"
                  : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus"}
              >
                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                <span>{item.label}</span>
                {item.key === "reviews" && <ManagerReviewsNavBadge />}
                {item.key === "chat" && <StaffChatNavBadge />}
              </a>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-sand pt-4">
          <button type="button" className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus">
            <span className="material-symbols-outlined text-[20px]">support_agent</span>
            <span>Hỗ trợ vận hành</span>
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-sand bg-mist/95 px-4 backdrop-blur md:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-3xl text-lotus">Cổ Phục Rental</h2>
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{subtitle}</p>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <div className="rounded-lg border border-sand bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              {currentDateLabel || "Đang đồng bộ"}
            </div>
            <NotificationBell />
            <button type="button" onClick={() => onTabChange?.("assets")} className="inline-flex items-center gap-2 rounded-lg bg-lotus px-3 py-2 text-sm font-semibold text-white transition hover:bg-oxblood">
              <span className="material-symbols-outlined text-[18px]">priority_high</span>
              Cần xử lý
            </button>
            <button type="button" onClick={onProfile} className="inline-flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus">
              <span className="material-symbols-outlined text-[18px]">account_circle</span>
              Hồ sơ
            </button>
            <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">
              <span className="material-symbols-outlined text-[18px]">logout</span>
              Đăng xuất
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
  adminName = "Quản trị viên",
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
  const initials = adminName
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AD";

  const items = [
    { key: "overview", label: "Tổng quan", icon: "dashboard", href: "/dashboard/admin" },
    { key: "roles", label: "Vai trò & Tài khoản", icon: "admin_panel_settings", href: "/dashboard/admin#roles" },
    { key: "config", label: "Cấu hình hệ thống", icon: "psychology", href: "/dashboard/admin#config" },
    { key: "notification-config", label: "Cấu hình thông báo", icon: "notifications", href: "/dashboard/admin#notification-config" },
    { key: "logs", label: "Nhật ký kiểm soát", icon: "history_edu", href: "/dashboard/admin#logs" },
  ] as const;

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
            <p className="truncate text-sm font-semibold text-ink">{adminName}</p>
            <p className="truncate text-xs uppercase tracking-[0.16em] text-antique">{adminEmail ?? "Super Admin"}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const isActive = item.key === active;
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
                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-sand pt-4">
          <button type="button" className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-600 transition hover:bg-white hover:text-lotus">
            <span className="material-symbols-outlined text-[20px]">support_agent</span>
            <span>Hỗ trợ quản trị</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-sand bg-mist/95 px-4 backdrop-blur md:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-3xl text-lotus">Cổ Phục Rental</h2>
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{subtitle}</p>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <div className="rounded-lg border border-sand bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              {currentDateLabel || "Đang đồng bộ"}
            </div>
            <button type="button" onClick={onProfile} className="inline-flex items-center gap-2 rounded-lg border border-sand bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:border-lotus hover:text-lotus">
              <span className="material-symbols-outlined text-[18px]">account_circle</span>
              Hồ sơ
            </button>
            <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">
              <span className="material-symbols-outlined text-[18px]">logout</span>
              Đăng xuất
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
