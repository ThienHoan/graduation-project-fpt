"use client";

import { useEffect, useMemo, type ReactNode } from "react";
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

  const allowedRolesKey = useMemo(
    () => allowedRoles?.slice().sort().join(",") ?? "",
    [allowedRoles],
  );

  useEffect(() => {
    if (status === "loading" && !session) {
      return;
    }

    if (status === "unauthenticated" && !session) {
      const nextSuffix = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${nextSuffix}`);
      return;
    }

    if (allowedRoles && session && !allowedRoles.includes(session.user.role)) {
      router.replace(resolveDashboardPath(session.user.role));
    }
  }, [allowedRoles, allowedRolesKey, pathname, router, session, status]);

  const isAuthorized = session && (!allowedRoles || allowedRoles.includes(session.user.role));

  if (!session && status === "loading") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-lg border border-sand bg-white p-6 text-sm text-stone-600 shadow-xs">
          Đang xác thực tài khoản...
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
