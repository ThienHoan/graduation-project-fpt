"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { resolveDashboardPath, type AppRole } from "@/lib/auth";
import { useAuth } from "./auth-provider";

type ProtectedPageProps = {
  allowedRoles?: AppRole[];
  children: ReactNode;
};

export function ProtectedPage({ allowedRoles, children }: ProtectedPageProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, status } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const allowedRolesKey = useMemo(
    () => allowedRoles?.slice().sort().join(",") ?? "",
    [allowedRoles],
  );

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (status === "unauthenticated") {
      const nextSuffix = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${nextSuffix}`);
      return;
    }

    if (allowedRoles && session && !allowedRoles.includes(session.user.role)) {
      router.replace(resolveDashboardPath(session.user.role));
    }
  }, [allowedRoles, allowedRolesKey, pathname, router, session, status]);

  const isAuthorized =
    status === "authenticated" &&
    Boolean(session) &&
    (!allowedRoles || (session && allowedRoles.includes(session.user.role)));

  if (!mounted || !isAuthorized) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading your account...
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
