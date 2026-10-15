"use client";

import { ProtectedPage } from "@/components/auth/protected-page";
import type { AppRole } from "@/lib/auth";

const STAFF_ROLES: AppRole[] = ["admin", "manager_owner", "staff"];

export default function StaffDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedPage allowedRoles={STAFF_ROLES}>
      {children}
    </ProtectedPage>
  );
}
