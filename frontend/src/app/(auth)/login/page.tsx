"use client";

import Link from "next/link";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { apiRequest } from "@/lib/api";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
import { resolveDashboardPath, toAuthenticatedUser, type AppRole } from "@/lib/auth";

type LoginResult = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: AppRole;
  };
};

function getSafeRedirectPath(value: string | null, role: AppRole) {
  const fallbackPath = resolveDashboardPath(role);
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallbackPath;
  // "next" trỏ vào khu dashboard nhưng không phải dashboard của role này
  // (vd owner bị đá về /login?next=/dashboard/staff) → về đúng dashboard theo role.
  if (value.startsWith("/dashboard") && !value.startsWith(fallbackPath)) return fallbackPath;
  return value;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, signIn, status } = useAuth();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim().replace(/^["']|["']$/g, "") ?? "";

  const authNotice = useMemo(() => {
    if (searchParams.get("reset") === "1") {
      return "Mật khẩu đã được đặt lại thành công. Bạn có thể đăng nhập lại.";
    }

    if (searchParams.get("verified") === "1") {
      return "Email đã được xác thực. Bạn có thể đăng nhập ngay.";
    }

    if (searchParams.get("registered") === "1") {
      return "Tài khoản mới đã được tạo. Bạn có thể đăng nhập ngay.";
    }

    return null;
  }, [searchParams]);

  const isBusy = loading || googleLoading;

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setGoogleLoading(true);

      try {
        const result = await apiRequest<LoginResult>("/auth/google", {
          method: "POST",
          body: JSON.stringify({ idToken: credential }),
        });

        if (!result.success || !result.data) {
          setError(result.message ?? "Không thể đăng nhập bằng Google.");
          return;
        }

        signIn({ accessToken: result.data.accessToken, user: toAuthenticatedUser(result.data.user), persist: rememberMe });
        router.push(getSafeRedirectPath(searchParams.get("next"), result.data.user.role));
      } catch {
        setError("Không thể kết nối đến hệ thống đăng nhập.");
      } finally {
        setGoogleLoading(false);
      }
    },
    [rememberMe, router, searchParams, signIn],
  );

  // Tự động chuyển hướng nếu đã đăng nhập
  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace(getSafeRedirectPath(searchParams.get("next"), session.user.role));
    }
  }, [router, searchParams, session, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await apiRequest<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!result.success || !result.data) {
        // Email chưa xác thực → chuyển đến trang nhập OTP
        if (result.message === "EMAIL_NOT_VERIFIED") {
          router.push(`/verify-email?email=${encodeURIComponent(normalizedEmail)}`);
          return;
        }
        setError(result.message ?? "Email hoặc mật khẩu không đúng.");
        return;
      }

      // Đăng nhập qua context AuthProvider (thay thế cách lưu localStorage thủ công)
      signIn({ accessToken: result.data.accessToken, user: toAuthenticatedUser(result.data.user), persist: rememberMe });
      router.push(getSafeRedirectPath(searchParams.get("next"), result.data.user.role));
    } catch {
      setError("Không thể kết nối đến hệ thống đăng nhập.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full bg-white">
      <div className="flex min-h-screen w-full flex-col md:flex-row">
        {/* Cột trái: Ảnh di sản đẹp mắt */}
        <section className="relative hidden overflow-hidden bg-lotus/10 md:flex md:w-1/2">
          <img
            alt="Cổ Phục Rental"
            className="absolute inset-0 h-full w-full object-cover object-center"
            src="/images/bg-ao-dai.png"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-oxblood/60 to-transparent" />
          <div className="absolute bottom-0 left-0 p-12 text-white">
            <h1 className="font-display text-5xl">Cổ Phục Rental</h1>
            <p className="mt-4 max-w-md text-lg leading-8 text-white/85">
              Preserving the elegance of Vietnamese cultural heritage, one garment at a time.
            </p>
          </div>
        </section>

        {/* Cột phải: Form đăng nhập */}
        <section className="flex w-full items-center justify-center bg-white px-4 py-10 md:w-1/2 md:px-12">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center md:hidden">
              <h1 className="font-display text-4xl text-oxblood">Cổ Phục Rental</h1>
            </div>

            <div className="mb-10 text-center md:text-left">
              <h2 className="font-display text-5xl text-lotus">Chào Mừng Trở Lại</h2>
              <p className="mt-2 text-base text-[#5a403c]">Cổng thông tin dành cho Khách hàng và Thành viên Cửa hàng</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {authNotice ? (
                <div className="rounded-sm border border-jade/20 bg-jade/10 px-4 py-3 text-sm text-jade">
                  {authNotice}
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="email">Email</label>
                <input
                  id="email"
                  className="focus-ring block w-full rounded-md border border-sand bg-white px-4 py-3 text-ink shadow-sm outline-none transition focus:border-lotus"
                  autoComplete="email"
                  placeholder="your@email.com"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  suppressHydrationWarning
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="password">Mật khẩu</label>
                <div className="relative">
                  <input
                    id="password"
                    className="focus-ring block w-full rounded-md border border-sand bg-white px-4 py-3 pr-12 text-ink shadow-sm outline-none transition focus:border-lotus"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    suppressHydrationWarning
                  />
                  <PasswordVisibilityToggle
                    visible={showPassword}
                    label="mật khẩu"
                    onToggle={() => setShowPassword((current) => !current)}
                    className="!top-[calc(50%+2px)]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-1 text-sm">
                <label className="flex items-center gap-2 text-ink">
                  <input
                    className="h-4 w-4 rounded border-sand text-lotus focus:ring-antique"
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    suppressHydrationWarning
                  />
                  Ghi nhớ đăng nhập
                </label>
                <Link
                  href="/forgot-password"
                  className="font-semibold text-lotus transition hover:text-oxblood"
                >
                  Quên mật khẩu?
                </Link>
              </div>

              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="pt-2">
                <button
                  className="focus-ring flex w-full justify-center rounded-sm bg-lotus px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isBusy}
                >
                  {isBusy ? "Đang xử lý..." : "Đăng nhập"}
                </button>
              </div>
            </form>

            <div className="mt-8">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-sand/60" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-2 text-[#5a403c]">Hoặc</span>
                </div>
              </div>
            </div>

            {googleClientId ? (
              <div className="mt-6">
                <GoogleSignInButton
                  clientId={googleClientId}
                  disabled={isBusy}
                  onCredential={handleGoogleCredential}
                />
              </div>
            ) : null}

            <div className="mt-6 text-center">
              <p className="text-sm text-[#5a403c]">
                Khách hàng mới?
                <Link className="ml-1 font-semibold text-lotus transition hover:text-oxblood hover:underline" href="/register">
                  Đăng ký tài khoản mới
                </Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoginPageContent />
    </Suspense>
  );
}
