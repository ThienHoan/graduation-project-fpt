"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { apiRequest, forgotPassword, resetPassword } from "@/lib/api";
import { normalizeNullableText, type AuthenticatedUser } from "@/lib/auth";
import { ShieldCheck, FileEdit, CheckCircle2, ArrowRight, Lock } from "lucide-react";

export default function CustomerProfilePage() {
  const { replaceUser, user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Password change state
  const [pwdStep, setPwdStep] = useState<"idle" | "otp_sent">("idle");
  const [pwdOtp, setPwdOtp] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdMessage, setPwdMessage] = useState<string | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    setFullName(user?.fullName ?? "");
    setPhone(user?.phone ?? "");
  }, [user?.fullName, user?.phone]);

  if (!user) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const result = await apiRequest<AuthenticatedUser>("/users/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          fullName: normalizeNullableText(fullName),
          phone: normalizeNullableText(phone),
        }),
      });
      if (!result.success || !result.data) {
        setError(result.message ?? "Không thể cập nhật hồ sơ.");
        return;
      }
      replaceUser(result.data);
      setMessage("Cập nhật hồ sơ thành công.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestOtp() {
    if (!user?.email) return;
    setPwdError(null);
    setPwdMessage(null);
    setPwdLoading(true);
    try {
      const result = await forgotPassword(user.email);
      if (!result.success) {
        setPwdError(result.message ?? "Không thể gửi mã OTP.");
        return;
      }
      setPwdStep("otp_sent");
      setPwdMessage("Mã OTP đã được gửi đến email của bạn.");
    } finally {
      setPwdLoading(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email) return;
    
    setPwdError(null);
    setPwdMessage(null);
    
    if (pwdNew !== pwdConfirm) {
      setPwdError("Mật khẩu xác nhận không khớp.");
      return;
    }
    
    if (pwdNew.length < 8) {
      setPwdError("Mật khẩu mới phải có ít nhất 8 ký tự.");
      return;
    }

    setPwdLoading(true);
    try {
      const result = await resetPassword(user.email, pwdOtp, pwdNew);
      if (!result.success) {
        setPwdError(result.message ?? "Không thể đổi mật khẩu.");
        return;
      }
      setPwdStep("idle");
      setPwdOtp("");
      setPwdNew("");
      setPwdConfirm("");
      setPwdMessage("Đổi mật khẩu thành công!");
    } finally {
      setPwdLoading(false);
    }
  }

  const userInitial = (user.fullName ?? user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="space-y-10">
      {/* Page Header */}
      <header className="border-b border-sand pb-6">
        <h1 className="font-display text-4xl text-lotus sm:text-5xl">Hồ Sơ Cá Nhân</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          Quản lý thông tin cá nhân và số liên lạc để đảm bảo lịch hẹn tại atelier và giao nhận trang phục được thuận tiện nhất.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
        {/* Column 1: Account info card */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          <div className="relative overflow-hidden rounded-lg border border-sand bg-white p-8 shadow-sm">
            <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-lotus/5" />
            {/* Avatar */}
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-lotus text-xl font-bold text-white">
                {userInitial}
              </div>
              <div>
                <p className="font-display text-2xl text-ink">
                  {user.fullName ?? <span className="text-base italic text-stone-400">Chưa cập nhật</span>}
                </p>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-antique">Thành viên di sản</p>
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-bronze">Email</span>
                <p className="text-sm font-medium text-ink">{user.email}</p>
              </div>
              <div className="h-px w-10 bg-sand" />
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-bronze">Số điện thoại</span>
                <p className="text-sm font-medium text-ink">
                  {user.phone ?? <span className="italic text-stone-400">Chưa cập nhật</span>}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-sand bg-parchment p-4">
            <ShieldCheck className="h-5 w-5 mt-0.5 text-antique shrink-0" />
            <p className="text-xs leading-relaxed text-stone-600">
              Tài khoản đang được bảo mật. Để thay đổi email chính, vui lòng liên hệ đội hỗ trợ atelier.
            </p>
          </div>
        </div>

        {/* Column 2: Edit form */}
        <div className="lg:col-span-7">
          <form onSubmit={handleSubmit} className="rounded-2xl border border-sand bg-parchment/60 p-8 shadow-xs md:p-10">
            <h3 className="mb-8 flex items-center gap-2 font-display text-2xl text-lotus font-semibold">
              <FileEdit className="h-5 w-5" />
              Cập nhật thông tin
            </h3>

            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500" htmlFor="fullName">
                  Họ và tên
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full rounded-md border border-sand bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-lotus"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500" htmlFor="phone">
                  Số điện thoại
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0909 000 000"
                  className="w-full rounded-md border border-sand bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-lotus"
                />
              </div>
            </div>

            {error && (
              <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            {message && (
              <div className="mt-6 flex items-center gap-2 rounded-xl border border-jade/30 bg-jade/5 px-4 py-3 text-xs font-medium text-jade">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {message}
              </div>
            )}

            <div className="mt-8 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="group inline-flex items-center gap-2 rounded-xl bg-lotus px-8 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{saving ? "Đang lưu..." : "Lưu thay đổi"}</span>
                {!saving && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </form>

          {/* Change Password Form */}
          <div className="mt-8 rounded-2xl border border-sand bg-white p-8 shadow-xs md:p-10">
            <h3 className="mb-6 flex items-center gap-2 font-display text-2xl text-lotus font-semibold">
              <Lock className="h-5 w-5" />
              Bảo mật & Mật khẩu
            </h3>
            
            {pwdStep === "idle" ? (
              <div>
                <p className="mb-6 text-xs text-stone-600 leading-relaxed">
                  Để thay đổi mật khẩu, chúng tôi sẽ gửi một mã OTP gồm 6 chữ số về email <span className="font-semibold text-ink">{user.email}</span> để xác thực.
                </p>
                {pwdError && (
                  <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{pwdError}</div>
                )}
                {pwdMessage && (
                  <div className="mb-6 flex items-center gap-2 rounded-xl border border-jade/30 bg-jade/5 px-4 py-3 text-xs font-medium text-jade">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {pwdMessage}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={pwdLoading}
                  className="rounded-md border border-sand bg-parchment px-6 py-3 text-sm font-semibold text-stone-700 transition hover:bg-mist disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pwdLoading ? "Đang gửi..." : "Đổi mật khẩu"}
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword}>
                <p className="mb-6 text-sm text-stone-600 leading-relaxed">
                  Vui lòng kiểm tra email và nhập mã OTP để thiết lập mật khẩu mới.
                </p>
                <div className="space-y-6">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500" htmlFor="pwdOtp">
                      Mã OTP (6 chữ số)
                    </label>
                    <input
                      id="pwdOtp"
                      type="text"
                      value={pwdOtp}
                      onChange={(e) => setPwdOtp(e.target.value)}
                      placeholder="Nhập mã OTP"
                      required
                      className="w-full rounded-md border border-sand bg-parchment px-4 py-3 text-sm text-ink outline-none transition focus:border-lotus"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500" htmlFor="pwdNew">
                      Mật khẩu mới
                    </label>
                    <input
                      id="pwdNew"
                      type="password"
                      value={pwdNew}
                      onChange={(e) => setPwdNew(e.target.value)}
                      placeholder="Ít nhất 8 ký tự, gồm chữ hoa, thường & số"
                      required
                      className="w-full rounded-md border border-sand bg-parchment px-4 py-3 text-sm text-ink outline-none transition focus:border-lotus"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500" htmlFor="pwdConfirm">
                      Nhập lại mật khẩu mới
                    </label>
                    <input
                      id="pwdConfirm"
                      type="password"
                      value={pwdConfirm}
                      onChange={(e) => setPwdConfirm(e.target.value)}
                      placeholder="Xác nhận mật khẩu"
                      required
                      className="w-full rounded-md border border-sand bg-parchment px-4 py-3 text-sm text-ink outline-none transition focus:border-lotus"
                    />
                  </div>
                </div>

                {pwdError && (
                  <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pwdError}</div>
                )}
                {pwdMessage && (
                  <div className="mt-6 flex items-center gap-2 rounded-xl border border-jade/30 bg-jade/5 px-4 py-3 text-xs font-medium text-jade">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {pwdMessage}
                  </div>
                )}

                <div className="mt-8 flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={pwdLoading}
                    className="rounded-md bg-lotus px-8 py-3 text-sm font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pwdLoading ? "Đang xử lý..." : "Xác nhận đổi mật khẩu"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPwdStep("idle");
                      setPwdError(null);
                      setPwdMessage(null);
                    }}
                    disabled={pwdLoading}
                    className="text-sm font-medium text-stone-500 hover:text-ink"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
