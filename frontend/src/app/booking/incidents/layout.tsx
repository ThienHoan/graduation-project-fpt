"use client";

import type { ReactNode } from "react";
import CustomerDashboardLayout from "@/app/dashboard/customer/layout";
import { ManagerPortalShell } from "@/components/heritage/ui";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * Trang `/booking/incidents/[bookingId]` mở từ cả tài khoản khách và dashboard
 * quản lý. Layout giữ sidebar/nav đúng vai trò để không bị "rơi" khỏi khung
 * điều hướng khi bấm "Xử lý sự cố" (trước đây trang tự dựng full-screen riêng).
 */
export default function IncidentRouteLayout({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist text-sm text-stone-500">
        Đang tải tài khoản...
      </div>
    );
  }

  if (user?.role === "manager_owner" || user?.role === "admin") {
    return (
      <ManagerPortalShell
        active="incidents"
        title="Xử lý sự cố"
        subtitle="Đổi mẫu · Bỏ món · Huỷ đơn trước bàn giao"
      >
        {children}
      </ManagerPortalShell>
    );
  }

  return <CustomerDashboardLayout>{children}</CustomerDashboardLayout>;
}
