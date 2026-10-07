"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { cartCount } from "@/lib/cart";
import { NotificationBell } from "@/components/notifications/notification-bell";

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
    setCartCountVal(cartCount());
    const interval = setInterval(() => setCartCountVal(cartCount()), 500);
    return () => clearInterval(interval);
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
    { href: "/catalog", label: "Bộ sưu tập", key: "collection" as const },
    { href: "/try-on", label: "Thử đồ AI", key: "tryon" as const },
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
      <header className="sticky top-0 z-50 border-b border-sand/70 bg-mist/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link href="/" className="font-display text-2xl text-lotus sm:text-3xl">
            Cổ Phục Rental
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-8 md:flex">
            {navItems.map((item) => {
              const isActive = active === item.key;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    isActive
                      ? "border-b border-lotus pb-1 text-sm font-semibold text-lotus"
                      : "border-b border-transparent pb-1 text-sm font-medium text-stone-600 transition hover:border-lotus/35 hover:text-lotus"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Notifications */}
            {status === "authenticated" && <NotificationBell notificationsHref="/dashboard/customer/notifications" />}

            {/* Cart */}
            <Link
              href={cartHref}
              className="relative rounded-full p-2 text-lotus transition hover:bg-lotus/10"
              aria-label="Giỏ thuê đồ"
            >
              <span className="material-symbols-outlined text-[22px]">shopping_bag</span>
              {cartCountVal > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-oxblood text-[11px] font-bold text-white">
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
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-lotus text-sm font-bold text-white transition hover:bg-oxblood"
                  aria-label="Tài khoản"
                >
                  {userInitial}
                </button>
                {accountOpen && (
                  <div className="absolute right-0 top-11 w-56 rounded-lg border border-sand bg-white p-2 shadow-lg">
                    <div className="border-b border-sand/50 px-3 py-2">
                      <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
                      <p className="truncate text-xs text-stone-400">{session.user.email}</p>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <Link
                        href="/dashboard/customer"
                        onClick={() => setAccountOpen(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-600 transition hover:bg-lotus/5 hover:text-lotus"
                      >
                        <span className="material-symbols-outlined text-[18px]">dashboard</span>
                        Bảng điều khiển
                      </Link>
                      <Link
                        href="/dashboard/customer/profile"
                        onClick={() => setAccountOpen(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-600 transition hover:bg-lotus/5 hover:text-lotus"
                      >
                        <span className="material-symbols-outlined text-[18px]">person</span>
                        Hồ sơ
                      </Link>
                      <Link
                        href={cartHref}
                        onClick={() => setAccountOpen(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-600 transition hover:bg-lotus/5 hover:text-lotus"
                      >
                        <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                        Giỏ thuê
                      </Link>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
                      >
                        <span className="material-symbols-outlined text-[18px]">logout</span>
                        Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-full p-2 text-lotus transition hover:bg-lotus/10"
                aria-label="Đăng nhập"
              >
                <span className="material-symbols-outlined text-[22px]">person</span>
              </Link>
            )}

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-full p-2 text-lotus transition hover:bg-lotus/10 md:hidden"
              aria-label="Mở menu"
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-mist shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-sand px-4">
              <span className="font-display text-2xl text-lotus">Cổ Phục Rental</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full p-1.5 text-stone-500 transition hover:bg-stone-100"
                aria-label="Đóng menu"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <nav className="flex flex-col gap-1 p-4">
              {navItems.map((item) => {
                const isActive = active === item.key;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      isActive
                        ? "flex items-center gap-3 rounded-lg bg-lotus/10 px-4 py-3 text-sm font-semibold text-lotus"
                        : "flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-stone-600 transition hover:bg-lotus/5 hover:text-lotus"
                    }
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {item.key === "collection" ? "apparel" : "face_retouching_natural"}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href={cartHref}
                className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-stone-600 transition hover:bg-lotus/5 hover:text-lotus"
              >
                <span className="material-symbols-outlined text-[20px]">shopping_bag</span>
                Giỏ thuê {cartCountVal > 0 && `(${cartCountVal})`}
              </Link>
            </nav>

            <div className="mt-auto border-t border-sand p-4">
              {status === "authenticated" && session ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 rounded-lg bg-lotus/10 px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-lotus text-sm font-bold text-white">
                      {userInitial}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
                      <p className="truncate text-xs text-stone-400">{session.user.email}</p>
                    </div>
                  </div>
                  <Link
                    href="/dashboard/customer"
                    className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-lotus transition hover:bg-lotus/10"
                  >
                    <span className="material-symbols-outlined text-[20px]">dashboard</span>
                    Bảng điều khiển
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    <span className="material-symbols-outlined text-[20px]">logout</span>
                    Đăng xuất
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-3 rounded-lg bg-lotus px-4 py-3 text-sm font-semibold text-white transition hover:bg-oxblood"
                >
                  <span className="material-symbols-outlined text-[20px]">login</span>
                  Đăng nhập
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
