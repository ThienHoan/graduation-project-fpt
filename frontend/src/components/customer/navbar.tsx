"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { cartCount } from "@/lib/cart";
import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  ShoppingBag,
  Sparkles,
  User,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Layers,
  ChevronDown,
} from "lucide-react";

export function CustomerNavbar({
  active,
  cartHref = "/booking/date-selection",
}: {
  active?: "collection" | "tryon";
  cartHref?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, signOut, status } = useAuth();
  const [cartCountVal, setCartCountVal] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateCount = () => setCartCountVal(cartCount());
    updateCount();
    window.addEventListener("cart:updated", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      window.removeEventListener("cart:updated", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, []);

  // Close account dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close mobile on route change
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  const navItems = [
    { href: "/", label: "Trang chủ", key: "home" },
    { href: "/catalog", label: "Bộ sưu tập", key: "collection" },
    { href: "/try-on", label: "Thử đồ AI", key: "tryon" },
    { href: "/#quy-trinh", label: "Hành trình thuê", key: "journey" },
    { href: "/dashboard", label: "Hệ thống ERP", key: "erp" },
  ];

  const displayName = session?.user.fullName ?? session?.user.email ?? "";
  const userInitial = displayName ? displayName.charAt(0).toUpperCase() : "";

  function handleSignOut() {
    signOut();
    router.push("/login");
    setAccountOpen(false);
    setMobileOpen(false);
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-sand bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="font-display text-2xl font-bold tracking-wide text-lotus sm:text-3xl transition hover:opacity-95"
            >
              Cổ Phục Rental
            </Link>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-6 md:flex">
              {navItems.map((item) => {
                const isExplicitActive = active === item.key;
                const isPathActive = pathname === item.href && !active;
                const isHighlighted = isExplicitActive || isPathActive;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`py-2 text-sm font-medium transition ${
                      isHighlighted
                        ? "border-b-2 border-lotus font-semibold text-lotus"
                        : "border-b-2 border-transparent text-stone-600 hover:text-lotus"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {/* Quick action button */}
            <Link
              href="/catalog"
              className="hidden items-center gap-1.5 rounded-lg bg-lotus px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98] sm:inline-flex"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Thuê Ngay</span>
            </Link>

            {/* Notifications */}
            {status === "authenticated" && (
              <NotificationBell notificationsHref="/dashboard/customer/notifications" />
            )}

            {/* Cart */}
            <Link
              href={cartHref}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-sand text-ink transition hover:border-lotus"
              aria-label="Giỏ thuê đồ"
            >
              <ShoppingBag className="h-4 w-4" />
              {cartCountVal > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-lotus text-[11px] font-bold text-white">
                  {cartCountVal}
                </span>
              )}
            </Link>

            {/* Account */}
            {status === "authenticated" && session ? (
              <div ref={accountRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAccountOpen(!accountOpen)}
                  className="flex h-10 items-center gap-2 rounded-full border border-sand bg-mist px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-lotus"
                  aria-label="Tài khoản"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lotus text-xs font-bold text-white">
                    {userInitial}
                  </span>
                  <span className="hidden max-w-[100px] truncate text-stone-700 sm:inline">
                    {displayName.split(" ")[0]}
                  </span>
                  <ChevronDown className="h-3 w-3 text-stone-400" />
                </button>

                {accountOpen && (
                  <div className="absolute right-0 top-12 z-50 w-60 rounded-xl border border-sand bg-white p-2 shadow-xl">
                    <div className="border-b border-sand/60 px-3 py-2.5">
                      <p className="truncate text-sm font-bold text-ink">{displayName}</p>
                      <p className="truncate text-xs text-stone-500">{session.user.email}</p>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <Link
                        href="/dashboard/customer"
                        onClick={() => setAccountOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-parchment hover:text-lotus"
                      >
                        <LayoutDashboard className="h-4 w-4 text-stone-500" />
                        <span>Bảng điều khiển</span>
                      </Link>
                      <Link
                        href="/dashboard/customer/profile"
                        onClick={() => setAccountOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-parchment hover:text-lotus"
                      >
                        <User className="h-4 w-4 text-stone-500" />
                        <span>Hồ sơ cá nhân</span>
                      </Link>
                      <Link
                        href={cartHref}
                        onClick={() => setAccountOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-parchment hover:text-lotus"
                      >
                        <ShoppingBag className="h-4 w-4 text-stone-500" />
                        <span>Giỏ thuê ({cartCountVal})</span>
                      </Link>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        <LogOut className="h-4 w-4 text-red-500" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-sand text-ink transition hover:border-lotus"
                aria-label="Đăng nhập"
              >
                <User className="h-4 w-4" />
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-sand text-ink transition hover:border-lotus md:hidden"
              aria-label="Mở menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-80 max-w-[85vw] flex-col bg-white shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-sand px-5">
              <span className="font-display text-2xl font-bold text-lotus">Cổ Phục Rental</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full p-2 text-stone-500 transition hover:bg-stone-100"
                aria-label="Đóng menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-col gap-1.5 p-4">
              {navItems.map((item) => {
                const isExplicitActive = active === item.key;
                const isPathActive = pathname === item.href && !active;
                const isHighlighted = isExplicitActive || isPathActive;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${
                      isHighlighted
                        ? "bg-lotus text-white font-semibold"
                        : "text-stone-700 hover:bg-parchment"
                    }`}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <Link
                href={cartHref}
                className="mt-2 flex items-center justify-between rounded-lg border border-sand bg-mist px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-lotus"
              >
                <span className="flex items-center gap-3">
                  <ShoppingBag className="h-4 w-4 text-lotus" />
                  <span>Giỏ thuê đồ</span>
                </span>
                <span className="rounded-full bg-lotus px-2 py-0.5 text-xs font-bold text-white">
                  {cartCountVal}
                </span>
              </Link>
            </nav>

            <div className="mt-auto border-t border-sand p-5">
              {status === "authenticated" && session ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl bg-parchment p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lotus text-sm font-bold text-white">
                      {userInitial}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{displayName}</p>
                      <p className="truncate text-xs text-stone-500">{session.user.email}</p>
                    </div>
                  </div>
                  <Link
                    href="/dashboard/customer"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-lotus py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-xs"
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Bảng điều khiển</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-lotus py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-xs hover:bg-oxblood"
                >
                  <User className="h-4 w-4" />
                  <span>Đăng nhập / Đăng ký</span>
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
