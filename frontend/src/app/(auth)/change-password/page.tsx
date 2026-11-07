"use client";

import Link from "next/link";
import { ProtectedPage } from "@/components/auth/protected-page";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { SecurityActivityCard } from "@/components/auth/security-activity-card";
import { Shield, ChevronLeft } from "lucide-react";

export default function ChangePasswordPage() {
  return (
    <ProtectedPage>
      <main className="min-h-screen bg-slate-50/60 px-4 py-8 md:px-8">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Breadcrumb / Back link */}
          <div className="flex items-center gap-2 text-sm text-ink/70">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 hover:text-lotus transition"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Quay lại Dashboard</span>
            </Link>
          </div>

          {/* Header */}
          <div className="rounded-lg border border-sand/60 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-lotus/10 text-lotus">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-display text-2xl text-oxblood font-semibold">
                  Bảo mật & Đổi mật khẩu
                </h1>
                <p className="text-sm text-ink/75 mt-0.5">
                  Quản lý thông tin xác thực và theo dõi nhật ký hoạt động đăng nhập của tài khoản
                </p>
              </div>
            </div>
          </div>

          {/* 2-column layout: Form đổi mật khẩu & Thẻ lịch sử bảo mật */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-lg border border-sand/60 bg-white p-6 shadow-sm">
              <h2 className="font-display text-lg text-ink font-semibold mb-4 border-b border-sand/40 pb-3">
                Thay đổi mật khẩu
              </h2>
              <ChangePasswordForm />
            </div>

            <div className="lg:col-span-6">
              <SecurityActivityCard />
            </div>
          </div>
        </div>
      </main>
    </ProtectedPage>
  );
}

