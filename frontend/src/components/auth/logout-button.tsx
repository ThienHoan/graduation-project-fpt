"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { logoutUser } from "@/lib/api";

type LogoutButtonProps = {
  className?: string;
  children?: ReactNode;
};

export function LogoutButton({ className, children = "Đăng xuất" }: LogoutButtonProps) {
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          // Inform the server to blacklist the active JWT token
          void logoutUser();
        } catch {
          // Non-blocking
        }
        signOut();
        router.push("/login");
      }}
    >
      {children}
    </button>
  );
}
