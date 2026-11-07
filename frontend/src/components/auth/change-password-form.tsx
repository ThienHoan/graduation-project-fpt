"use client";

import { FormEvent, useState } from "react";
import { changePassword } from "@/lib/api";
import { PasswordVisibilityToggle } from "./password-visibility-toggle";
import { PasswordStrengthIndicator } from "./password-strength-indicator";
import { CheckCircle2, AlertCircle, KeyRound } from "lucide-react";

export interface ChangePasswordFormProps {
  onSuccess?: () => void;
  className?: string;
}

export function ChangePasswordForm({ onSuccess, className = "" }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError("Mật khẩu mới phải có tối thiểu 8 ký tự.");
      return;
    }

    if (newPassword === currentPassword) {
      setError("Mật khẩu mới không được trùng với mật khẩu hiện tại.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Xác nhận mật khẩu mới không khớp.");
      return;
    }

    setLoading(true);
    try {
      const res = await changePassword({
        currentPassword,
        newPassword,
      });

      if (!res.success) {
        setError(res.message || "Không thể thay đổi mật khẩu. Vui lòng kiểm tra lại.");
        return;
      }

      setSuccess("Đổi mật khẩu thành công! Mật khẩu mới đã có hiệu lực.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (onSuccess) onSuccess();
    } catch {
      setError("Lỗi kết nối máy chủ. Vui lòng thử lại sau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 max-w-lg ${className}`}>
      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Mật khẩu hiện tại */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1" htmlFor="current-password">
          Mật khẩu hiện tại
        </label>
        <div className="relative">
          <input
            id="current-password"
            type={showCurrent ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="block w-full rounded-md border border-sand bg-white px-3.5 py-2.5 pr-11 text-ink shadow-sm transition focus:border-lotus focus:outline-none"
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
          <PasswordVisibilityToggle
            visible={showCurrent}
            label="mật khẩu hiện tại"
            onToggle={() => setShowCurrent((c) => !c)}
            className="!top-[calc(50%+1px)]"
          />
        </div>
      </div>

      {/* Mật khẩu mới */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1" htmlFor="new-password">
          Mật khẩu mới
        </label>
        <div className="relative">
          <input
            id="new-password"
            type={showNew ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="block w-full rounded-md border border-sand bg-white px-3.5 py-2.5 pr-11 text-ink shadow-sm transition focus:border-lotus focus:outline-none"
            placeholder="••••••••"
            required
            autoComplete="new-password"
          />
          <PasswordVisibilityToggle
            visible={showNew}
            label="mật khẩu mới"
            onToggle={() => setShowNew((c) => !c)}
            className="!top-[calc(50%+1px)]"
          />
        </div>
        <PasswordStrengthIndicator value={newPassword} />
      </div>

      {/* Xác nhận mật khẩu mới */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1" htmlFor="confirm-password">
          Xác nhận mật khẩu mới
        </label>
        <div className="relative">
          <input
            id="confirm-password"
            type={showConfirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="block w-full rounded-md border border-sand bg-white px-3.5 py-2.5 pr-11 text-ink shadow-sm transition focus:border-lotus focus:outline-none"
            placeholder="••••••••"
            required
            autoComplete="new-password"
          />
          <PasswordVisibilityToggle
            visible={showConfirm}
            label="xác nhận mật khẩu"
            onToggle={() => setShowConfirm((c) => !c)}
            className="!top-[calc(50%+1px)]"
          />
        </div>
        {confirmPassword && confirmPassword !== newPassword && (
          <p className="text-xs text-red-500 mt-1 font-medium">Mật khẩu xác nhận không khớp.</p>
        )}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-sm bg-lotus px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-oxblood disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <KeyRound className="h-4 w-4" />
          <span>{loading ? "Đang xử lý..." : "Cập nhật mật khẩu"}</span>
        </button>
      </div>
    </form>
  );
}

