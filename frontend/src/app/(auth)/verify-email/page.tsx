"use client";

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { MailCheck } from "lucide-react";

const OTP_LENGTH = 6;

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect về register nếu không có email
  useEffect(() => {
    if (!email) {
      router.replace("/register");
    }
  }, [email, router]);

  // Đếm ngược cooldown gửi lại OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleDigitChange = useCallback((index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(-1); // chỉ lấy 1 chữ số cuối
    setDigits((prev) => {
      const next = [...prev];
      next[index] = sanitized;
      return next;
    });
    // Tự động nhảy sang ô tiếp theo
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = digits.join("");
    if (code.length < OTP_LENGTH) {
      setError("Vui lòng nhập đầy đủ 6 chữ số của mã OTP.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const result = await apiRequest("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });

      if (!result.success) {
        setError(result.message ?? "Mã OTP không hợp lệ.");
        return;
      }

      setSuccess("Xác thực thành công! Đang chuyển hướng về trang đăng nhập...");
      setTimeout(() => {
        router.push(`/login?email=${encodeURIComponent(email)}&verified=1`);
      }, 1500);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setError(null);
    setResendCooldown(60);

    const result = await apiRequest("/auth/resend-otp", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    if (!result.success) {
      setError(result.message ?? "Không thể gửi lại mã. Vui lòng thử lại sau.");
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-cover bg-center bg-no-repeat p-4"
      style={{ backgroundImage: "url('/images/bg-ao-dai.png')" }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-sand bg-white p-8 shadow-xl">
        {/* Icon phong bì */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-lotus/10 text-lotus">
            <MailCheck className="h-8 w-8 text-lotus" />
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-ink">Xác thực Email</h1>
          <p className="mt-2 text-sm text-slate-700">
            Mã OTP 6 chữ số đã được gửi đến
          </p>
          <p className="mt-1 font-semibold text-lotus">{email}</p>
          <p className="mt-1 text-xs text-slate-500">Kiểm tra terminal backend để lấy mã (trong khi chưa tích hợp email thật)</p>
        </div>

        {success ? (
          <div className="rounded-xl border border-jade/30 bg-jade/10 p-4 text-center text-sm font-medium text-jade">
            {success}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Các ô nhập OTP */}
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
                    suppressHydrationWarning
                  />
                ))}
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-lotus px-4 py-3 font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Đang xác thực..." : "Xác nhận mã OTP"}
            </button>

            {/* Gửi lại OTP */}
            <p className="text-center text-sm text-slate-600">
              Không nhận được mã?{" "}
              {resendCooldown > 0 ? (
                <span className="text-slate-400">Gửi lại sau {resendCooldown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  className="font-semibold text-lotus transition-colors hover:text-lotus/80 hover:underline"
                >
                  Gửi lại mã
                </button>
              )}
            </p>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href="/register" className="font-semibold text-slate-500 transition-colors hover:text-lotus hover:underline">
            ← Quay lại đăng ký
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
