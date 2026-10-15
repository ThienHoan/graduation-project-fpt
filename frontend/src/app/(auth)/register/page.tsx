"use client";

import Link from "next/link";
import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { apiRequest } from "@/lib/api";
import { resolveDashboardPath, toAuthenticatedUser, type AppRole } from "@/lib/auth";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
import { Calendar, Truck, Sparkles } from "lucide-react";

type RegisterResult = {
  email: string;
  requiresVerification?: boolean;
};

type GoogleLoginResult = {
  accessToken: string;
  isNewUser: boolean;
  user: {
    id: string;
    email: string;
    role: AppRole;
  };
};

type PasswordStrength = {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
};

function checkPasswordStrength(password: string): PasswordStrength {
  return {
    hasMinLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
  };
}

function isPasswordStrong(strength: PasswordStrength): boolean {
  return strength.hasMinLength && strength.hasUppercase && strength.hasLowercase && strength.hasNumber;
}

function StrengthItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`flex items-center gap-1 text-xs transition-colors ${ok ? "text-jade" : "text-slate-400"}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-jade" : "bg-slate-300"}`} />
      {label}
    </span>
  );
}

const benefitItems = [
  { icon: Calendar, label: "Đặt lịch nhanh chóng" },
  { icon: Truck, label: "Theo dõi đơn hàng" },
  { icon: Sparkles, label: "Thử đồ ảo AI" },
];

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, status, signIn } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
  const strength = checkPasswordStrength(password);
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const isBusy = loading || googleLoading;

  // Nếu đã đăng nhập rồi thì redirect về dashboard
  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace(resolveDashboardPath(session.user.role));
    }
  }, [router, session, status]);

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setNotice(null);
      setGoogleLoading(true);

      try {
        const result = await apiRequest<GoogleLoginResult>("/auth/google", {
          method: "POST",
          body: JSON.stringify({ idToken: credential }),
        });

        if (!result.success || !result.data) {
          setError(result.message ?? "Không thể đăng nhập bằng Google.");
          return;
        }

        const { accessToken, user, isNewUser } = result.data;

        if (!isNewUser) {
          setNotice("Tài khoản Google của bạn đã tồn tại. Đang tự động đăng nhập...");
        }

        signIn({ accessToken, user: toAuthenticatedUser(user), persist: true });
        const next = searchParams.get("next");
        const fallbackPath = resolveDashboardPath(user.role);
        // Không theo "next" nếu nó trỏ vào dashboard của role khác
        router.push(
          next && next.startsWith("/") && !next.startsWith("//") && !(next.startsWith("/dashboard") && !next.startsWith(fallbackPath))
            ? next
            : fallbackPath,
        );
      } catch {
        setError("Không thể kết nối đến hệ thống đăng nhập.");
      } finally {
        setGoogleLoading(false);
      }
    },
    [router, searchParams, signIn],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedName.length < 4) {
      setError("Họ và tên chưa hợp lệ (cần ít nhất 4 ký tự).");
      return;
    }

    if (!isPasswordStrong(strength)) {
      setError("Mật khẩu chưa đủ mạnh. Vui lòng đáp ứng tất cả yêu cầu bên dưới.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    setLoading(true);

    try {
      const result = await apiRequest<RegisterResult>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ fullName: trimmedName, email: trimmedEmail, password }),
      });

      if (!result.success) {
        setError(result.message ?? "Đăng ký thất bại. Vui lòng thử lại.");
        return;
      }

      // Sau khi đăng ký thành công → chuyển sang trang xác thực OTP
      router.push(`/verify-email?email=${encodeURIComponent(trimmedEmail)}`);
    } catch {
      setError("Không thể kết nối đến hệ thống đăng ký.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-mist">
      {/* Cột trái: Ảnh di sản đẹp mắt */}
      <section className="relative hidden min-h-screen overflow-hidden md:block md:w-1/2 lg:w-3/5">
        <img
          alt="Cổ Phục Rental"
          className="absolute inset-0 h-full w-full object-cover"
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuBCdYyqGTfQnuRqFD-y9kVntrYQAgRK7rpVTrV7Z74z6DLaCvh8FZkvGIWeQOhI48Dpinw1M-GjDLsMYORDoQLE8-mMY6i4bWg3s7CN2izGDDNAJ6i-1zxSPmZ60EJLrOE-X1Kj93BX8ioVTJkpfV6mI5Z4UjoDd48TjE0PvGnzcoYr4e-9EZ0sqGbm_CfCa74jP6wDxg7yZiYV0WTjXYao1g9EtMPWobFDY4S-dhW1KrcIa5qvf8-K3TUVMALTNxWD7pgxajlFRQct"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/32 via-black/8 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full p-12 text-white">
          <h1 className="font-display text-5xl tracking-tight">Cổ Phục Rental</h1>
          <p className="mt-4 max-w-lg text-lg leading-8 text-white/90">Gìn giữ vẻ đẹp nghìn năm qua từng tà áo.</p>
        </div>
      </section>

      {/* Cột phải: Form đăng ký */}
      <section className="flex min-h-screen w-full items-center justify-center overflow-y-auto bg-mist px-4 py-16 md:w-1/2 md:px-12 lg:w-2/5">
        <div className="w-full max-w-md space-y-10">
          <div className="mb-8 text-center md:hidden">
            <h1 className="font-display text-4xl text-lotus">Cổ Phục Rental</h1>
          </div>

          <div className="space-y-4 text-center md:text-left">
            <h2 className="font-display text-5xl font-semibold text-lotus">Tham Gia Hành Trình Di Sản</h2>
            <p className="text-base leading-8 text-[#5a403c]">
              Tạo tài khoản để trải nghiệm dịch vụ cho thuê trang phục cao cấp và công nghệ thử đồ AI độc bản.
            </p>
          </div>

          {/* Google Sign-In */}
          {googleClientId ? (
            <div className="space-y-3">
              <GoogleSignInButton
                clientId={googleClientId}
                disabled={isBusy}
                onCredential={handleGoogleCredential}
              />
              {googleLoading && (
                <p className="text-center text-sm text-slate-500">Đang xử lý đăng nhập Google...</p>
              )}

              <div className="relative flex items-center gap-4 py-1">
                <div className="h-px flex-1 bg-sand/60" />
                <span className="text-xs font-medium uppercase tracking-widest text-[#5a403c]/60">hoặc</span>
                <div className="h-px flex-1 bg-sand/60" />
              </div>
            </div>
          ) : null}

          {/* Notice (existing account detected) */}
          {notice ? (
            <div className="rounded-lg border border-jade/30 bg-jade/10 px-4 py-3 text-center text-sm text-jade">
              {notice}
            </div>
          ) : null}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              {/* Họ và tên - float label đẹp */}
              <div className="relative">
                <input
                  id="fullname"
                  className="peer block w-full border-0 border-b border-sand bg-transparent px-0 py-3 text-ink placeholder-transparent focus:border-antique focus:outline-none focus:ring-0"
                  name="fullname"
                  placeholder=" "
                  required
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  disabled={isBusy}
                />
                <label
                  className="absolute left-0 top-3 cursor-text text-sm text-[#5a403c] transition-all duration-200 peer-focus:-top-3.5 peer-focus:text-[11px] peer-focus:text-antique peer-[:not(:placeholder-shown)]:-top-3.5 peer-[:not(:placeholder-shown)]:text-[11px]"
                  htmlFor="fullname"
                >
                  Họ và tên
                </label>
              </div>

              {/* Email - float label */}
              <div className="relative mt-6">
                <input
                  id="email"
                  className="peer block w-full border-0 border-b border-sand bg-transparent px-0 py-3 text-ink placeholder-transparent focus:border-antique focus:outline-none focus:ring-0"
                  name="email"
                  placeholder=" "
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isBusy}
                />
                <label
                  className="absolute left-0 top-3 cursor-text text-sm text-[#5a403c] transition-all duration-200 peer-focus:-top-3.5 peer-focus:text-[11px] peer-focus:text-antique peer-[:not(:placeholder-shown)]:-top-3.5 peer-[:not(:placeholder-shown)]:text-[11px]"
                  htmlFor="email"
                >
                  Email
                </label>
              </div>

              {/* Mật khẩu + kiểm tra độ mạnh */}
              <div className="relative mt-6">
                <input
                  id="password"
                  className="peer block w-full border-0 border-b border-sand bg-transparent px-0 py-3 pr-12 text-ink placeholder-transparent focus:border-antique focus:outline-none focus:ring-0"
                  name="password"
                  placeholder=" "
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onBlur={() => setPasswordTouched(true)}
                  disabled={isBusy}
                />
                <PasswordVisibilityToggle
                  visible={showPassword}
                  label="mật khẩu"
                  onToggle={() => setShowPassword((current) => !current)}
                />
                <label
                  className="absolute left-0 top-3 cursor-text text-sm text-[#5a403c] transition-all duration-200 peer-focus:-top-3.5 peer-focus:text-[11px] peer-focus:text-antique peer-[:not(:placeholder-shown)]:-top-3.5 peer-[:not(:placeholder-shown)]:text-[11px]"
                  htmlFor="password"
                >
                  Mật khẩu
                </label>
                {/* Hiển thị thanh kiểm tra độ mạnh khi bắt đầu nhập */}
                {(passwordTouched || password.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-sand/40 bg-parchment/60 px-3 py-2">
                    <StrengthItem ok={strength.hasMinLength} label="≥ 8 ký tự" />
                    <StrengthItem ok={strength.hasUppercase} label="Chữ hoa (A-Z)" />
                    <StrengthItem ok={strength.hasLowercase} label="Chữ thường (a-z)" />
                    <StrengthItem ok={strength.hasNumber} label="Chữ số (0-9)" />
                  </div>
                )}
              </div>

              {/* Xác nhận mật khẩu */}
              <div className="relative mt-6">
                <input
                  id="confirm_password"
                  className={`peer block w-full border-0 border-b bg-transparent px-0 py-3 pr-12 text-ink placeholder-transparent focus:outline-none focus:ring-0 ${
                    passwordMismatch ? "border-red-400 focus:border-red-400" : "border-sand focus:border-antique"
                  }`}
                  name="confirm_password"
                  placeholder=" "
                  required
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={isBusy}
                />
                <PasswordVisibilityToggle
                  visible={showConfirmPassword}
                  label="xác nhận mật khẩu"
                  onToggle={() => setShowConfirmPassword((current) => !current)}
                />
                <label
                  className="absolute left-0 top-3 cursor-text text-sm text-[#5a403c] transition-all duration-200 peer-focus:-top-3.5 peer-focus:text-[11px] peer-focus:text-antique peer-[:not(:placeholder-shown)]:-top-3.5 peer-[:not(:placeholder-shown)]:text-[11px]"
                  htmlFor="confirm_password"
                >
                  Xác nhận mật khẩu
                </label>
                {passwordMismatch && (
                  <p className="mt-1 text-xs text-red-600">Mật khẩu xác nhận không khớp.</p>
                )}
                {!passwordMismatch && confirmPassword.length > 0 && password === confirmPassword && (
                  <p className="mt-1 text-xs text-jade">✓ Mật khẩu khớp nhau.</p>
                )}
              </div>
            </div>

            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            <button
              className="w-full rounded-lg bg-lotus py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isBusy}
            >
              {loading ? "Đang tạo tài khoản..." : "Đăng ký ngay"}
            </button>
          </form>

          {/* Lợi ích khi đăng ký */}
          <div className="border-t border-sand/50 pt-8">
            <ul className="flex flex-col space-y-4">
              {benefitItems.map((item) => (
                <li key={item.label} className="flex items-center space-x-3 text-[#5a403c]">
                  <item.icon className="h-5 w-5 text-antique shrink-0" />
                  <span className="text-sm">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-4 text-center">
            <Link
              className="border-b border-transparent pb-0.5 text-sm text-[#5a403c] transition hover:border-lotus hover:text-lotus"
              href="/login"
            >
              Đã có tài khoản? Đăng nhập ngay
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-mist" />}>
      <RegisterPageContent />
    </Suspense>
  );
}
