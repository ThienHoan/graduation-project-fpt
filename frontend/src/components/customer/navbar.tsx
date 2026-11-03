"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { cartCount } from "@/lib/cart";
import { wishlistCount, refreshWishlistFromServer } from "@/lib/wishlist";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { playWoodTap, playHoverTick } from "@/lib/sound-fx";
import { AnimatedShoppingBag, AnimatedSparkles, AnimatedIconWrapper } from "@/components/common/animated-icons";
import { getMyLoyalty, type LoyaltyTier } from "@/lib/api";
import {
  ShoppingBag,
  Heart,
  Sparkles,
  User,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Award,
  Crown,
} from "lucide-react";

export interface CustomerNavbarProps {
  active?: "home" | "collection" | "tryon" | "journey" | "erp" | "showcase3d";
  cartHref?: string;
  variant?: "light" | "dark";
  showSoundToggle?: boolean;
}

export function CustomerNavbar({
  active,
  cartHref = "/booking/date-selection",
  variant = "light",
  showSoundToggle = true,
}: CustomerNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, signOut, status } = useAuth();
  const [cartCountVal, setCartCountVal] = useState(0);
  const [wishlistCountVal, setWishlistCountVal] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loyaltyTier, setLoyaltyTier] = useState<LoyaltyTier | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const isDark = variant === "dark";

  useEffect(() => {
    const updateCount = () => setCartCountVal(cartCount());
    const updateWishlist = () => setWishlistCountVal(wishlistCount());

    updateCount();
    updateWishlist();

    if (status === "authenticated") {
      refreshWishlistFromServer().then(updateWishlist);
    }

    window.addEventListener("cart:updated", updateCount);
    window.addEventListener("wishlist:updated", updateWishlist);
    window.addEventListener("storage", updateCount);
    window.addEventListener("storage", updateWishlist);
    return () => {
      window.removeEventListener("cart:updated", updateCount);
      window.removeEventListener("wishlist:updated", updateWishlist);
      window.removeEventListener("storage", updateCount);
      window.removeEventListener("storage", updateWishlist);
    };
  }, [status]);

  // Close account dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  // Load loyalty tier for authenticated customers
  useEffect(() => {
    if (status !== "authenticated" || session?.user.role !== "customer") return;
    getMyLoyalty()
      .then((res) => {
        if (res.success && res.data) setLoyaltyTier(res.data.tier);
      })
      .catch(() => { });
  }, [status, session?.user.role]);

  const navItems = [
    { href: "/", label: "Trang chủ", key: "home" },
    { href: "/catalog", label: "Bộ sưu tập", key: "collection" },
    { href: "/try-on", label: "Thử đồ AI", key: "tryon" },
    { href: "/#bo-suu-tap-3d", label: "Bảo vật 3D", key: "showcase3d" },
    { href: "/#quy-trinh", label: "Hành trình thuê", key: "journey" },
    { href: "/dashboard", label: "Hệ thống ERP", key: "erp" },
  ];

  const displayName = session?.user.fullName ?? session?.user.email ?? "";
  const userInitial = displayName ? displayName.charAt(0).toUpperCase() : "";

  // Tier-based avatar button styles
  const tierConfig = {
    basic: {
      button: isDark
        ? "border border-white/15 bg-white/10 text-stone-100 hover:border-amber-400"
        : "border border-sand bg-mist text-ink hover:border-lotus",
      avatar: isDark ? "bg-amber-600" : "bg-lotus",
      badge: null,
      label: null,
    },
    plus: {
      button: isDark
        ? "border-2 border-emerald-400 bg-emerald-950/60 text-emerald-100 hover:border-emerald-300"
        : "border-2 border-emerald-400 bg-emerald-50 text-ink hover:border-emerald-500",
      avatar: "bg-emerald-600",
      badge: (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white text-[9px] font-black text-white leading-none">
          <Award className="h-2.5 w-2.5" />
        </span>
      ),
      label: (
        <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-emerald-600 leading-none">
          Plus
        </span>
      ),
    },
    premium: {
      button: isDark
        ? "border-2 border-amber-400 bg-amber-950/60 text-amber-100 hover:border-amber-300"
        : "border-2 border-amber-400 bg-amber-50 text-ink hover:border-amber-500",
      avatar: "bg-amber-600",
      badge: (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 ring-2 ring-white text-[9px] font-black text-white leading-none">
          <Crown className="h-2.5 w-2.5" />
        </span>
      ),
      label: (
        <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-amber-600 leading-none">
          VIP
        </span>
      ),
    },
  } as const;

  const activeTier = tierConfig[loyaltyTier ?? "basic"];

  function handleSignOut() {
    signOut();
    router.push("/login");
    setAccountOpen(false);
    setMobileOpen(false);
  }

  return (
    <>
      <header
        className={`sticky top-0 z-40 transition-all duration-300 ${isDark
          ? "border-b border-white/10 bg-[#09090c]/90 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
          : "border-b border-sand/80 bg-white/95 backdrop-blur-xl shadow-xs"
          }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8">
          {/* Logo & Nhận diện thương hiệu chính thức */}
          <div className="flex items-center gap-4 lg:gap-5 xl:gap-7 min-w-0 shrink-0">
            <Link
              href="/"
              onClick={(e) => playWoodTap({ event: e })}
              onMouseEnter={(e) => playHoverTick({ event: e })}
              className="inline-flex shrink-0 items-center gap-2.5 sm:gap-3 py-1 whitespace-nowrap transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Image
                src="/brand/logo-mark.svg"
                alt="Logo Cổ Phục Hoàng Thành"
                width={40}
                height={40}
                className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 drop-shadow-[0_2px_10px_rgba(212,175,55,0.4)]"
                priority
              />
              <div className="flex flex-col shrink-0 whitespace-nowrap">
                <span
                  className={`font-display text-xl sm:text-2xl font-bold tracking-wide leading-none whitespace-nowrap ${isDark
                    ? "text-transparent bg-gradient-to-r from-amber-200 via-amber-400 to-rose-300 bg-clip-text drop-shadow-[0_2px_10px_rgba(251,191,36,0.3)]"
                    : "text-lotus"
                    }`}
                >
                  Cổ Phục
                </span>
                <span
                  className={`text-[9px] sm:text-[10px] tracking-[0.22em] font-medium uppercase mt-0.5 whitespace-nowrap ${isDark ? "text-stone-400" : "text-stone-500"
                    }`}
                >
                  Hoàng Thành • AI
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden items-center gap-2.5 lg:gap-3.5 xl:gap-5 lg:flex text-xs lg:text-[13px] xl:text-sm font-medium shrink-0">
              {navItems.map((item) => {
                const isExplicitActive = active === item.key;
                const isPathActive = pathname === item.href && !active;
                const isHighlighted = isExplicitActive || isPathActive;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => playWoodTap({ event: e })}
                    onMouseEnter={(e) => playHoverTick({ event: e })}
                    className={`whitespace-nowrap shrink-0 py-2 transition duration-200 ${isHighlighted
                      ? isDark
                        ? "border-b-2 border-amber-400 font-bold text-amber-300"
                        : "border-b-2 border-lotus font-bold text-lotus"
                      : isDark
                        ? "border-b-2 border-transparent text-stone-300 hover:text-amber-300"
                        : "border-b-2 border-transparent text-stone-600 hover:text-lotus"
                      }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Nút hành động nhanh "Thuê Ngay" */}
            <Link
              href="/catalog"
              onClick={(e) => playWoodTap({ event: e })}
              onMouseEnter={(e) => playHoverTick({ event: e })}
              className={`hidden xl:inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition active:scale-[0.98] ${isDark
                ? "bg-gradient-to-r from-amber-500 to-rose-600 text-stone-950 shadow-md hover:opacity-90"
                : "bg-lotus text-white hover:bg-oxblood shadow-xs"
                }`}
            >
              <AnimatedSparkles size={15} />
              <span>Thuê Ngay</span>
            </Link>

            {/* Thông báo (cho tài khoản đã đăng nhập) */}
            {status === "authenticated" && (
              <NotificationBell notificationsHref="/dashboard/customer/notifications" />
            )}

            {/* Giỏ thuê đồ */}
            {/* Nút danh sách cổ phục yêu thích */}
            <Link
              href="/wishlist"
              onClick={(e) => playWoodTap({ event: e })}
              onMouseEnter={(e) => playHoverTick({ event: e })}
              className={`relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition ${isDark
                ? "border border-white/15 bg-white/5 text-stone-200 hover:border-lotus hover:text-lotus"
                : "border border-sand bg-white text-ink hover:border-lotus hover:text-lotus"
                }`}
              aria-label="Danh sách cổ phục yêu thích"
              title="Danh sách yêu thích"
            >
              <Heart className={`h-4 w-4 ${wishlistCountVal > 0 ? "fill-lotus/20 text-lotus" : ""}`} />
              {wishlistCountVal > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white bg-lotus shadow-xs"
                >
                  {wishlistCountVal}
                </span>
              )}
            </Link>

            <Link
              href={cartHref}
              onClick={(e) => playWoodTap({ event: e })}
              onMouseEnter={(e) => playHoverTick({ event: e })}
              className={`relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition ${isDark
                ? "border border-white/15 bg-white/5 text-stone-200 hover:border-amber-400 hover:text-amber-300"
                : "border border-sand bg-white text-ink hover:border-lotus hover:text-lotus"
                }`}
              aria-label="Giỏ thuê đồ"
            >
              <AnimatedShoppingBag size={18} count={cartCountVal} />
            </Link>

            {/* Khối tài khoản người dùng */}
            {status === "authenticated" && session ? (
              <div ref={accountRef} className="relative">
                {loyaltyTier === "premium" ? (
                  /* ── Gemini AI Pro / Ultra 7-Color Rainbow Animated Border (Siêu Sắc Nét & Rực Rỡ) ── */
                  <div className="relative inline-flex p-[3px] rounded-full overflow-hidden shadow-[0_0_18px_rgba(255,0,128,0.38)] transition hover:shadow-[0_0_26px_rgba(255,0,128,0.55)]">
                    {/* Hào quang quang phổ 7 màu phát sáng phía sau */}
                    <span className="pointer-events-none absolute -inset-[4px] rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,#ff0055,#ff5500,#ffcc00,#00e676,#00d2ff,#4444ff,#aa00ff,#ff00aa,#ff0055)] opacity-85 blur-[8px] animate-gemini-spin" />
                    {/* Dải sáng 7 màu xoay 360 độ quanh viền cực rõ */}
                    <span className="pointer-events-none absolute inset-[-250%] animate-gemini-spin bg-[conic-gradient(from_0deg_at_50%_50%,#ff0055,#ff5500,#ffcc00,#00e676,#00d2ff,#4444ff,#aa00ff,#ff00aa,#ff0055)]" />
                    <button
                      type="button"
                      onClick={() => setAccountOpen(!accountOpen)}
                      className={`relative z-10 flex h-9 sm:h-10 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold transition ${isDark
                        ? "bg-[#180a0a] text-amber-100 hover:bg-[#240e0e]"
                        : "bg-white text-ink hover:bg-stone-50"
                        }`}
                      aria-label="Tài khoản VIP"
                    >
                      <span className="relative">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white bg-gradient-to-tr from-amber-600 to-yellow-500 shadow-xs">
                          {userInitial}
                        </span>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 ring-2 ring-white text-[9px] font-black text-white leading-none shadow-xs">
                          <Crown className="h-2.5 w-2.5" />
                        </span>
                      </span>
                      <span className="hidden max-w-[80px] truncate sm:inline">
                        {displayName.split(" ")[0]}
                      </span>
                      <span className="hidden sm:inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-2xs">
                        VIP
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                  </div>
                ) : loyaltyTier === "plus" ? (
                  /* ── Gemini AI Plus Emerald-Cyan Aurora Animated Border (Siêu Sắc Nét & Rực Rỡ) ── */
                  <div className="relative inline-flex p-[3px] rounded-full overflow-hidden shadow-[0_0_16px_rgba(0,230,118,0.4)] transition hover:shadow-[0_0_24px_rgba(0,230,118,0.55)]">
                    {/* Hào quang lục ngọc chuyển sắc phía sau */}
                    <span className="pointer-events-none absolute -inset-[4px] rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,#00c853,#00e676,#00e5ff,#00b0ff,#1de9b6,#76ff03,#00c853)] opacity-85 blur-[7px] animate-gemini-spin" />
                    {/* Dải sáng xoay 360 độ quanh viền cực rõ */}
                    <span className="pointer-events-none absolute inset-[-250%] animate-gemini-spin bg-[conic-gradient(from_0deg_at_50%_50%,#00c853,#00e676,#00e5ff,#00b0ff,#1de9b6,#76ff03,#00c853)]" />
                    <button
                      type="button"
                      onClick={() => setAccountOpen(!accountOpen)}
                      className={`relative z-10 flex h-9 sm:h-10 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold transition ${isDark
                        ? "bg-[#081a17] text-emerald-100 hover:bg-[#0c2622]"
                        : "bg-white text-ink hover:bg-stone-50"
                        }`}
                      aria-label="Tài khoản Plus"
                    >
                      <span className="relative">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-xs">
                          {userInitial}
                        </span>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white text-[9px] font-black text-white leading-none shadow-xs">
                          <Award className="h-2.5 w-2.5" />
                        </span>
                      </span>
                      <span className="hidden max-w-[80px] truncate sm:inline">
                        {displayName.split(" ")[0]}
                      </span>
                      <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-emerald-600 leading-none">
                        PLUS
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                  </div>
                ) : (
                  /* ── Basic Tier — Gemini-style Warm Gold Animated Border ── */
                  <div className="relative inline-flex p-[2.5px] rounded-full overflow-hidden shadow-[0_0_12px_rgba(198,166,100,0.30)] transition hover:shadow-[0_0_20px_rgba(198,166,100,0.45)]">
                    {/* Hào quang vàng cổ phong phía sau */}
                    <span className="pointer-events-none absolute -inset-[4px] rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,#c6a664,#e8c97a,#f5e0a0,#d4a853,#b8855a,#e8c97a,#c6a664)] opacity-70 blur-[7px] animate-gemini-spin" />
                    {/* Dải vàng xoay quanh viền */}
                    <span className="pointer-events-none absolute inset-[-250%] animate-gemini-spin bg-[conic-gradient(from_0deg_at_50%_50%,#c6a664,#e8c97a,#f5e0a0,#d4a853,#b8855a,#e8c97a,#c6a664)]" />
                    <button
                      type="button"
                      onClick={() => setAccountOpen(!accountOpen)}
                      className={`relative z-10 flex h-9 sm:h-10 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold transition ${isDark
                        ? "bg-[#1a1510] text-amber-100 hover:bg-[#221c12]"
                        : "bg-white text-ink hover:bg-stone-50"
                        }`}
                      aria-label="Tài khoản"
                    >
                      <span className="relative">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white bg-gradient-to-tr from-amber-700 to-amber-500 shadow-xs">
                          {userInitial}
                        </span>
                      </span>
                      <span className="hidden max-w-[80px] truncate sm:inline">
                        {displayName.split(" ")[0]}
                      </span>
                      <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-amber-700 leading-none">
                        Basic
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                  </div>
                )}

                {accountOpen && (
                  <div
                    className={`absolute right-0 top-12 z-50 w-60 rounded-xl p-2 shadow-2xl ${isDark
                      ? "border border-white/15 bg-[#141419] text-stone-200"
                      : "border border-sand bg-white text-ink shadow-xl"
                      }`}
                  >
                    <div
                      className={`border-b px-3 py-2.5 ${isDark ? "border-white/10" : "border-sand/60"
                        }`}
                    >
                      <p className="truncate text-sm font-bold">{displayName}</p>
                      <p className="truncate text-xs opacity-70">{session.user.email}</p>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <Link
                        href="/dashboard/customer"
                        onClick={() => setAccountOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${isDark
                          ? "hover:bg-white/10 hover:text-amber-300"
                          : "text-stone-700 hover:bg-parchment hover:text-lotus"
                          }`}
                      >
                        <LayoutDashboard className="h-4 w-4 opacity-70" />
                        <span>Bảng điều khiển</span>
                      </Link>
                      <Link
                        href="/dashboard/customer/profile"
                        onClick={() => setAccountOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${isDark
                          ? "hover:bg-white/10 hover:text-amber-300"
                          : "text-stone-700 hover:bg-parchment hover:text-lotus"
                          }`}
                      >
                        <User className="h-4 w-4 opacity-70" />
                        <span>Hồ sơ cá nhân</span>
                      </Link>
                      <Link
                        href="/dashboard/customer/loyalty"
                        onClick={() => setAccountOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${loyaltyTier === "premium"
                          ? "text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                          : loyaltyTier === "plus"
                            ? "text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                            : isDark
                              ? "hover:bg-white/10 hover:text-amber-300"
                              : "text-stone-700 hover:bg-parchment hover:text-lotus"
                          }`}
                      >
                        {loyaltyTier === "premium" ? (
                          <Crown className="h-4 w-4 opacity-80" />
                        ) : (
                          <Award className="h-4 w-4 opacity-70" />
                        )}
                        <span>
                          Điểm thưởng
                          {loyaltyTier === "plus" && (
                            <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              Plus
                            </span>
                          )}
                          {loyaltyTier === "premium" && (
                            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                              VIP
                            </span>
                          )}
                        </span>
                      </Link>
                      <Link
                        href={cartHref}
                        onClick={() => setAccountOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${isDark
                          ? "hover:bg-white/10 hover:text-amber-300"
                          : "text-stone-700 hover:bg-parchment hover:text-lotus"
                          }`}
                      >
                        <ShoppingBag className="h-4 w-4 opacity-70" />
                        <span>Giỏ thuê ({cartCountVal})</span>
                      </Link>
                      <Link
                        href="/wishlist"
                        onClick={() => setAccountOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${isDark
                          ? "hover:bg-white/10 hover:text-amber-300"
                          : "text-stone-700 hover:bg-parchment hover:text-lotus"
                          }`}
                      >
                        <Heart className="h-4 w-4 opacity-70" />
                        <span>Yêu thích ({wishlistCountVal})</span>
                      </Link>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-red-500 transition hover:bg-red-500/10"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                onClick={(e) => playWoodTap({ event: e })}
                onMouseEnter={(e) => playHoverTick({ event: e })}
                className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition ${isDark
                  ? "border border-white/15 bg-white/5 text-stone-200 hover:border-amber-400 hover:text-amber-300"
                  : "border border-sand bg-white text-ink hover:border-lotus hover:text-lotus"
                  }`}
                aria-label="Đăng nhập"
              >
                <User className="h-4 w-4" />
              </Link>
            )}

            {/* Mobile menu hamburger button */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition lg:hidden ${isDark
                ? "border border-white/15 bg-white/5 text-stone-200 hover:border-amber-400"
                : "border border-sand bg-white text-ink hover:border-lotus"
                }`}
              aria-label="Mở menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer (Menu trượt di động đồng bộ) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={`absolute right-0 top-0 flex h-full w-80 max-w-[85vw] flex-col shadow-2xl ${isDark ? "bg-[#101015] text-stone-200 border-l border-white/10" : "bg-white text-ink"
              }`}
          >
            <div
              className={`flex h-16 items-center justify-between px-5 border-b ${isDark ? "border-white/10" : "border-sand"
                }`}
            >
              <div className="flex items-center gap-2.5">
                <Image src="/brand/logo-mark.svg" alt="Logo" width={28} height={28} className="h-7 w-7 shrink-0" />
                <span
                  className={`font-display text-xl font-bold ${isDark
                    ? "text-transparent bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text"
                    : "text-lotus"
                    }`}
                >
                  Cổ Phục
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full p-2 opacity-70 transition hover:opacity-100 hover:bg-white/10"
                aria-label="Đóng menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-col gap-1.5 p-4">
              {navItems.map((item) => {
                const isExplicitActive = active === item.key;
                const isPathActive = pathname === item.href && !active;
                const isHighlighted = isExplicitActive || isPathActive;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${isHighlighted
                      ? isDark
                        ? "bg-amber-500/20 text-amber-300 font-semibold border-l-4 border-amber-400"
                        : "bg-lotus text-white font-semibold"
                      : isDark
                        ? "text-stone-300 hover:bg-white/5"
                        : "text-stone-700 hover:bg-parchment"
                      }`}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <Link
                href="/wishlist"
                onClick={() => setMobileOpen(false)}
                className={`mt-2 flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium border transition ${isDark
                  ? "border-white/10 bg-white/5 text-stone-200 hover:border-lotus"
                  : "border-sand bg-mist text-stone-800 hover:border-lotus"
                  }`}
              >
                <span className="flex items-center gap-3">
                  <Heart className="h-4 w-4 text-lotus" />
                  <span>Cổ phục yêu thích</span>
                </span>
                <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white bg-lotus">
                  {wishlistCountVal}
                </span>
              </Link>

              <Link
                href={cartHref}
                onClick={() => setMobileOpen(false)}
                className={`mt-2 flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium border transition ${isDark
                  ? "border-white/10 bg-white/5 text-stone-200 hover:border-amber-400"
                  : "border-sand bg-mist text-stone-800 hover:border-lotus"
                  }`}
              >
                <span className="flex items-center gap-3">
                  <ShoppingBag className={`h-4 w-4 ${isDark ? "text-amber-400" : "text-lotus"}`} />
                  <span>Giỏ thuê đồ</span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${isDark ? "bg-rose-600" : "bg-lotus"
                    }`}
                >
                  {cartCountVal}
                </span>
              </Link>
            </nav>

            <div
              className={`mt-auto p-5 border-t ${isDark ? "border-white/10 bg-black/20" : "border-sand bg-mist/50"
                }`}
            >
              {status === "authenticated" && session ? (
                <div className="space-y-3">
                  <div
                    className={`flex items-center gap-3 rounded-xl p-3 ${isDark ? "bg-white/5" : "bg-parchment"
                      }`}
                  >
                    <div className="relative shrink-0">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${activeTier.avatar}`}
                      >
                        {userInitial}
                      </div>
                      {activeTier.badge && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white text-[9px] font-black text-white leading-none bg-current">
                          {loyaltyTier === "premium" ? (
                            <Crown className="h-2.5 w-2.5 text-white" />
                          ) : (
                            <Award className="h-2.5 w-2.5 text-white" />
                          )}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{displayName}</p>
                      <p className="truncate text-xs opacity-70">{session.user.email}</p>
                      {loyaltyTier && loyaltyTier !== "basic" && (
                        <span
                          className={`inline-block mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${loyaltyTier === "premium"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                            }`}
                        >
                          {loyaltyTier === "premium" ? "👑 Premium" : "✦ Plus"}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link
                    href="/dashboard/customer"
                    onClick={() => setMobileOpen(false)}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold uppercase tracking-wider ${isDark
                      ? "bg-gradient-to-r from-amber-500 to-rose-600 text-stone-950"
                      : "bg-lotus text-white"
                      }`}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Bảng điều khiển</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 py-2.5 text-xs font-semibold text-red-500 transition hover:bg-red-500/10"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 text-xs font-semibold uppercase tracking-wider transition ${isDark
                    ? "bg-gradient-to-r from-amber-500 to-rose-600 text-stone-950 font-bold"
                    : "bg-lotus text-white hover:bg-oxblood"
                    }`}
                >
                  <User className="h-4 w-4" />
                  <span>Đăng nhập / Đăng ký</span>
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
