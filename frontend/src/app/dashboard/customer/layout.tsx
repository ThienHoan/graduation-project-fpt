"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ProtectedPage } from "@/components/auth/protected-page";
import { useAuth } from "@/components/auth/auth-provider";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import {
  Calendar,
  Bell,
  Sparkles,
  Ruler,
  User,
  MapPin,
  Plus,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/dashboard/customer", label: "Đơn thuê", icon: Calendar },
  { href: "/dashboard/customer/notifications", label: "Thông báo", icon: Bell },
  { href: "/try-on", label: "Thử đồ AI", icon: Sparkles },
  { href: "/dashboard/customer/measurements", label: "Số đo", icon: Ruler },
  { href: "/dashboard/customer/profile", label: "Hồ sơ", icon: User },
  { href: "/dashboard/customer/addresses", label: "Địa chỉ", icon: MapPin },
];

export default function CustomerDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const displayName = user?.fullName ?? user?.email ?? "Khách hàng";
  const userInitial = displayName.charAt(0).toUpperCase();

  function handleSignOut() {
    signOut();
    router.push("/login");
  }

  return (
    <ProtectedPage allowedRoles={["customer"]}>
      <div className="flex min-h-screen flex-col bg-mist text-ink">
        <CustomerNavbar />

        <div className="flex flex-1">
          {/* Sidebar */}
          <aside className="sticky top-16 hidden h-[calc(100vh-64px)] w-64 shrink-0 flex-col self-start border-r border-sand bg-parchment/80 p-5 md:flex">
            {/* User greeting */}
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-sand bg-white p-3.5 shadow-xs">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lotus text-sm font-bold text-white shadow-xs">
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-wider text-stone-400">Tài khoản</p>
                <p className="truncate text-sm font-bold text-ink">
                  {displayName}
                </p>
              </div>
            </div>

            {/* CTA */}
            <Link
              href="/catalog"
              className="mb-5 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm transition hover:bg-oxblood"
            >
              <Plus className="h-4 w-4" />
              <span>Thuê bộ mới</span>
            </Link>

            {/* Nav items */}
            <nav className="flex flex-1 flex-col gap-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== "/dashboard/customer" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      isActive
                        ? "flex items-center gap-3 rounded-xl bg-lotus/10 border border-lotus/20 px-3.5 py-2.5 text-xs font-semibold text-lotus shadow-xs"
                        : "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-medium text-stone-600 transition hover:bg-white hover:text-ink"
                    }
                  >
                    <Icon className={`h-4 w-4 ${isActive ? "text-lotus" : "text-stone-400"}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Sign out */}
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-4 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-stone-600 transition hover:bg-white hover:text-red-600"
            >
              <LogOut className="h-4 w-4 text-stone-400" />
              <span>Đăng xuất</span>
            </button>
          </aside>

          {/* Main content */}
          <main className="min-w-0 flex-1 px-4 py-8 pb-24 md:px-10 md:py-10 md:pb-10">
            <div className="mx-auto max-w-[1200px]">{children}</div>
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 border-t border-sand bg-white/95 backdrop-blur-md md:hidden">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/dashboard/customer" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center justify-center gap-1 transition ${
                  isActive ? "text-lotus font-semibold" : "text-stone-500 hover:text-stone-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <CustomerFooter />
      </div>
    </ProtectedPage>
  );
}
