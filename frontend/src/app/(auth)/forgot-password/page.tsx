"use client";

import { FormEvent, Suspense, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forgotPassword, resetPassword } from "@/lib/api";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
import { KeyRound } from "lucide-react";

const OTP_LENGTH = 6;

function ForgotPasswordContent() {
  const router = useRouter();
  
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleDigitChange = useCallback((index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = sanitized;
      return next;
    });
    if (sanitized && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, [digits]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  }, []);

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await forgotPassword(email);
      if (!result.success) {
        setError(result.message ?? "Có lỗi xảy ra. Vui lòng thử lại.");
        return;
      }
      setSuccess(result.message ?? "Đã gửi mã OTP.");
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = digits.join("");
    if (code.length < OTP_LENGTH) {
      setError("Vui lòng nhập đầy đủ mã OTP.");
      return;
    }
    if (password.length < 8) {
      setError("Mật khẩu phải dài ít nhất 8 ký tự.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const result = await resetPassword(email, code, password);
      if (!result.success) {
        setError(result.message ?? "Mã OTP không hợp lệ hoặc đã hết hạn.");
        return;
      }
      setSuccess("Mật khẩu đã được đặt lại thành công! Đang chuyển hướng...");
      setTimeout(() => {
        router.push(`/login?email=${encodeURIComponent(email)}&reset=1`);
      }, 1500);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-cover bg-center bg-no-repeat p-4"
      style={{ backgroundImage: "url('/images/bg-ao-dai.png')" }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-sand bg-white p-8 shadow-xl">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-lotus/10 text-lotus ring-1 ring-lotus/20">
            <KeyRound className="h-8 w-8" />
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl text-ink">Quên mật khẩu</h1>
          <p className="mt-2 text-sm text-stone-600">
            {step === 1 ? "Nhập email của bạn để nhận mã OTP đặt lại mật khẩu." : "Nhập mã OTP và mật khẩu mới của bạn."}
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={handleRequestOtp} className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-800" htmlFor="email">
                Địa chỉ Email
              </label>
              <input
                id="email"
                className="block w-full rounded-md border border-sand bg-white px-4 py-3 text-ink shadow-sm outline-none transition focus:border-lotus"
                autoComplete="email"
                placeholder="your@email.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {success && !error ? (
              <div className="rounded-lg border border-jade/30 bg-jade/10 p-3 text-center text-sm text-jade">
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-md bg-lotus px-4 py-3 font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Đang gửi..." : "Gửi mã OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-6">
            <div>
              <label className="mb-3 block text-center text-sm font-semibold text-slate-800">
                Nhập mã OTP
              </label>
              <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="h-12 w-12 rounded-md border border-sand bg-white text-center text-xl font-bold text-ink shadow-sm outline-none transition focus:border-lotus"
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-800" htmlFor="password">
                Mật khẩu mới
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="block w-full rounded-md border border-sand bg-white px-4 py-3 pr-12 text-ink shadow-sm outline-none transition focus:border-lotus"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                />
                <PasswordVisibilityToggle
                  visible={showPassword}
                  label="mật khẩu"
                  onToggle={() => setShowPassword((current) => !current)}
                  className="!top-[calc(50%+2px)]"
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {success && !error && success.includes("thành công") ? (
              <div className="rounded-lg border border-jade/30 bg-jade/10 p-3 text-center text-sm text-jade">
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-lotus px-4 py-3 font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Đang xử lý..." : "Đặt lại mật khẩu"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href="/login" className="font-semibold text-slate-500 transition-colors hover:text-lotus hover:underline">
            ← Quay lại đăng nhập
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <ForgotPasswordContent />
    </Suspense>
  );
}
