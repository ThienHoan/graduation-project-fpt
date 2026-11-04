"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readStoredSession, type AuthenticatedUser } from "@/lib/auth";
import {
  getMyLoyalty,
  getMyLoyaltyHistory,
  getLoyaltyRedemptionRules,
  redeemLoyaltyPoints,
  type LoyaltyInfo,
  type LoyaltyPointLog,
  type LoyaltyRedemptionRule,
  type LoyaltyTier,
} from "@/lib/api";
import {
  Award,
  Crown,
  Sparkles,
  Gift,
  CheckCircle2,
  Clock,
  ArrowRight,
  Copy,
  Check,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  Zap,
  TrendingUp,
  Receipt,
  Ticket,
} from "lucide-react";

interface TierDesign {
  label: string;
  badge: string;
  cardName: string;
  cardGradient: string;
  cardBorder: string;
  cardGlow: string;
  accentColor: string;
  icon: typeof Award;
  description: string;
}

const TIER_META: Record<LoyaltyTier, TierDesign> = {
  basic: {
    label: "Hạng Khởi Đầu",
    badge: "Thành viên Khởi đầu",
    cardName: "HERITAGE BASIC CARD",
    cardGradient: "from-[#1f1c19] via-[#2b2521] to-[#151311]",
    cardBorder: "border-[#8a7a6b]/30 shadow-[0_25px_60px_-15px_rgba(20,18,16,0.5)]",
    cardGlow: "from-sand/10 via-transparent to-transparent",
    accentColor: "#c6a664",
    icon: Award,
    description: "Khám phá vẻ đẹp cổ phục Việt Nam cùng đặc quyền tích điểm khởi nguyên.",
  },
  plus: {
    label: "Hạng Thân Thiết",
    badge: "Thành viên Thân thiết",
    cardName: "HERITAGE PLUS NOBLE",
    cardGradient: "from-[#0e2421] via-[#163a35] to-[#091816]",
    cardBorder: "border-emerald-500/40 shadow-[0_25px_60px_-15px_rgba(13,34,31,0.6)]",
    cardGlow: "from-emerald-500/15 via-transparent to-teal-900/10",
    accentColor: "#34d399",
    icon: Sparkles,
    description: "Ưu đãi giảm 5% giá trị thuê trang phục cùng quyền ưu tiên giữ size độc bản.",
  },
  premium: {
    label: "Hạng Hoàng Gia",
    badge: "Thành viên Hoàng Gia",
    cardName: "HERITAGE ROYAL PRIVILEGE",
    cardGradient: "from-[#2b1010] via-[#401616] to-[#1c0808]",
    cardBorder: "border-amber-400/50 shadow-[0_30px_70px_-15px_rgba(61,20,20,0.7)]",
    cardGlow: "from-amber-400/20 via-lotus/20 to-transparent",
    accentColor: "#fbbf24",
    icon: Crown,
    description: "Đặc quyền cao nhất: Giảm 10% trọn đời, miễn phí phụ kiện và phục vụ riêng.",
  },
};

const STATUS_LABELS: Record<string, string> = {
  pending_confirmation: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  awaiting_payment: "Chờ thanh toán",
  paid: "Đã thanh toán",
  preparing: "Đang chuẩn bị",
  ready_for_pickup: "Sẵn sàng lấy đồ",
  delivering: "Đang giao hàng",
  renting: "Đang thuê",
  returned: "Đã trả đồ",
  inspection_pending: "Đang kiểm tra",
  refund_pending: "Chờ duyệt cọc",
  overdue: "Quá hạn",
};

export default function CustomerLoyaltyPage() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [rules, setRules] = useState<LoyaltyRedemptionRule[]>([]);
  const [history, setHistory] = useState<LoyaltyPointLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successVoucher, setSuccessVoucher] = useState<{ code: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      setErrorMsg(null);
      const session = readStoredSession();
      if (session?.user) setCurrentUser(session.user);

      const [loyaltyRes, rulesRes, historyRes] = await Promise.all([
        getMyLoyalty(),
        getLoyaltyRedemptionRules(),
        getMyLoyaltyHistory(),
      ]);

      if (loyaltyRes.success && loyaltyRes.data) setLoyalty(loyaltyRes.data);
      if (rulesRes.success && rulesRes.data) setRules(rulesRes.data);
      if (historyRes.success && historyRes.data) setHistory(historyRes.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể tải dữ liệu điểm thưởng";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleRedeem(ruleId: string) {
    try {
      setRedeemingId(ruleId);
      setErrorMsg(null);
      const res = await redeemLoyaltyPoints(ruleId);
      if (res.success && res.data) {
        setSuccessVoucher({ code: res.data.voucherCode, name: res.data.voucherName });
        const [loyaltyRes, historyRes] = await Promise.all([getMyLoyalty(), getMyLoyaltyHistory()]);
        if (loyaltyRes.success && loyaltyRes.data) setLoyalty(loyaltyRes.data);
        if (historyRes.success && historyRes.data) setHistory(historyRes.data);
      } else {
        setErrorMsg(res.message || "Đổi điểm thất bại");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Đổi điểm thất bại";
      setErrorMsg(msg);
    } finally {
      setRedeemingId(null);
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex min-h-[460px] items-center justify-center">
        <div className="flex flex-col items-center gap-3.5">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-lotus/20" />
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-lotus border-t-transparent" />
          </div>
          <p className="font-sans text-xs text-stone-500 font-medium tracking-wide">
            Đang tải dữ liệu điểm thưởng & hội viên...
          </p>
        </div>
      </div>
    );
  }

  const currentTier = loyalty?.tier ?? "basic";
  const tierInfo = TIER_META[currentTier];
  const TierIcon = tierInfo.icon;

  const lifetimePoints = loyalty?.lifetimePoints ?? 0;
  const currentPoints = loyalty?.points ?? 0;
  const pendingPoints = loyalty?.pendingPoints ?? 0;
  const pendingBookings = loyalty?.pendingBookings ?? [];
  const nextTier = loyalty?.nextTier;
  const progressPercent = nextTier
    ? Math.min(100, Math.round((lifetimePoints / nextTier.targetPoints) * 100))
    : 100;

  return (
    <div className="space-y-8 pb-16 max-w-6xl mx-auto">
      {/* ── Editorial Header ── */}
      <div className="relative overflow-hidden rounded-3xl border border-sand/80 bg-gradient-to-r from-parchment via-mist to-parchment/70 p-6 sm:p-8 shadow-xs">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-radial from-antique/20 to-transparent blur-2xl" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-lotus shadow-2xs">
              <Sparkles className="h-3 w-3 text-antique" />
              <span>Chương Trình Khách Hàng Thân Thiết</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              Điểm Thưởng & Hạng Thành Viên
            </h1>
            <p className="text-xs sm:text-sm text-stone-600 max-w-xl leading-relaxed">
              Tích luỹ <strong className="text-ink font-semibold">1 điểm cho mỗi 1.000đ</strong> tiền thuê thực trả khi đơn hoàn tất. Quy đổi điểm nhận mã giảm giá và mở khoá các đặc quyền cao cấp.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-stone-600 bg-white/80 border border-sand/60 px-3.5 py-2 rounded-xl shadow-2xs">
            <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
            <span>Tích điểm tự động & minh bạch 100%</span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 p-4 text-xs font-medium text-red-800 shadow-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Thông báo đổi voucher thành công (Pop-in Banner) */}
      {successVoucher && (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-300/80 bg-gradient-to-r from-emerald-50 via-teal-50/60 to-emerald-50 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-2xs">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Đổi mã thành công
                </span>
                <h3 className="text-sm font-bold text-emerald-950">
                  {successVoucher.name}
                </h3>
                <p className="text-xs text-emerald-800/90 mt-0.5">
                  Mã ưu đãi của bạn:{" "}
                  <strong className="font-mono font-bold text-emerald-950 bg-white px-2 py-0.5 rounded border border-emerald-300 tracking-wider">
                    {successVoucher.code}
                  </strong>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(successVoucher.code)}
                className="group inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-900 shadow-2xs transition hover:bg-emerald-50 active:scale-[0.98]"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-stone-500" />}
                <span>{copied ? "Đã sao chép" : "Sao chép mã"}</span>
              </button>
              <Link
                href="/catalog"
                className="group inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-800 active:scale-[0.98]"
              >
                <span>Thuê đồ ngay</span>
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── THẺ HỘI VIÊN KIM LOẠI (Imperial Double-Bezel Card) ── */}
      <div className="rounded-3xl bg-stone-900/5 p-1.5 ring-1 ring-black/5 shadow-sm">
        <div
          className={`relative overflow-hidden rounded-[calc(1.5rem-0.125rem)] border ${tierInfo.cardBorder} bg-gradient-to-br ${tierInfo.cardGradient} p-6 sm:p-8 text-white`}
        >
          {/* Subtle Ambient Radial Glows */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-radial from-white/10 to-transparent blur-2xl" />
          <div className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-radial from-antique/15 to-transparent blur-xl" />

          {/* Background Watermark Pattern */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.03] bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />

          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            {/* Card Information Left Block */}
            <div className="space-y-3.5 max-w-lg">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md shadow-inner shrink-0">
                  <TierIcon className="h-6 w-6 text-amber-300" />
                </div>
                <div>
                  <span className="font-mono text-[10px] tracking-widest text-white/60 uppercase block">
                    {tierInfo.cardName}
                  </span>
                  <div className="inline-flex items-center gap-2 mt-0.5">
                    <span className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-white">
                      {tierInfo.label}
                    </span>
                    <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200 border border-white/20">
                      {tierInfo.badge}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-white/80 leading-relaxed font-normal">
                {tierInfo.description}
              </p>

              {/* Card Meta details */}
              <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-white/65">
                <span>
                  Chủ thẻ:{" "}
                  <strong className="text-white font-medium">
                    {currentUser?.fullName ?? currentUser?.email?.split("@")[0] ?? "Quý khách"}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Mã thẻ:{" "}
                  <strong className="text-white font-mono tracking-wider font-semibold">
                    {currentUser?.id ? `HV-${currentUser.id.slice(0, 8).toUpperCase()}` : "HV-MEMBER"}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Điểm xét hạng:{" "}
                  <strong className="text-amber-300 font-sans font-bold tabular-nums">
                    {lifetimePoints.toLocaleString("vi-VN")}
                  </strong>{" "}
                  điểm
                </span>
              </div>
            </div>

            {/* Dual Vault: Khối Điểm Khả Dụng & Điểm Chờ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-auto">
              {/* Điểm Khả Dụng */}
              <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-4 sm:p-5 backdrop-blur-md transition hover:bg-white/[0.14] min-w-[200px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]">
                <div className="flex items-center justify-between text-white/70">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    Điểm Khả Dụng
                  </span>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                    <Zap className="h-3 w-3" />
                  </div>
                </div>

                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="font-sans text-3xl sm:text-4xl font-extrabold text-white tracking-tight tabular-nums">
                    {currentPoints.toLocaleString("vi-VN")}
                  </span>
                  <span className="text-xs font-semibold text-white/70">điểm</span>
                </div>

                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-300 bg-emerald-500/20 rounded-lg px-2.5 py-1 border border-emerald-400/20 w-fit">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  <span>Sẵn sàng đổi voucher</span>
                </div>
              </div>

              {/* Điểm Chờ Tích Lũy (Pending Points) */}
              <div className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 sm:p-5 backdrop-blur-md transition hover:bg-amber-500/15 min-w-[200px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                <div className="flex items-center justify-between text-amber-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    Điểm Chờ Kích Hoạt
                  </span>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                    <Clock className="h-3 w-3" />
                  </div>
                </div>

                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="font-sans text-3xl sm:text-4xl font-extrabold text-amber-300 tracking-tight tabular-nums">
                    +{pendingPoints.toLocaleString("vi-VN")}
                  </span>
                  <span className="text-xs font-semibold text-amber-200/80">điểm</span>
                </div>

                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-200 bg-amber-500/20 rounded-lg px-2.5 py-1 border border-amber-400/20 w-fit">
                  <span>
                    {pendingBookings.length > 0
                      ? `Từ ${pendingBookings.length} đơn đã thanh toán`
                      : "Cộng sau khi trả đồ"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Lộ Trình Tiến Cấp Hội Viên (Tier Progression Track) ── */}
          <div className="mt-7 pt-6 border-t border-white/10 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
              <span className="text-white/80 font-medium flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-amber-300" />
                <span>
                  Tiến trình nâng hạng: <strong className="text-white uppercase font-sans tracking-wide">{tierInfo.badge}</strong>
                </span>
              </span>
              {nextTier ? (
                <span className="font-medium text-amber-200 text-xs">
                  Cần thêm <strong className="font-bold text-amber-300 tabular-nums">{nextTier.pointsNeeded.toLocaleString("vi-VN")}</strong> điểm để lên {TIER_META[nextTier.tier].label}
                </span>
              ) : (
                <span className="font-medium text-amber-300 text-xs">
                  ★ Bạn đã đạt hạng Premium cao nhất với toàn bộ đặc quyền
                </span>
              )}
            </div>

            {/* Custom Multi-milestone Progress Bar */}
            <div className="relative h-2.5 w-full rounded-full bg-black/40 overflow-hidden border border-white/10 p-[1px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-200 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(251,191,36,0.5)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[10px] sm:text-[11px] text-white/55 font-sans pt-0.5">
              <span>Đã tích: <strong className="text-white font-semibold tabular-nums">{lifetimePoints.toLocaleString("vi-VN")}</strong> điểm</span>
              {nextTier ? (
                <span>Mục tiêu: <strong className="text-white font-semibold tabular-nums">{nextTier.targetPoints.toLocaleString("vi-VN")}</strong> điểm</span>
              ) : (
                <span className="text-amber-200 font-medium">Hạng cao nhất</span>
              )}
            </div>
          </div>

          {/* ── Danh sách đặc quyền hạng hiện tại ── */}
          <div className="mt-5 pt-5 border-t border-white/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-2.5">
              Đặc quyền của bạn
            </span>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {loyalty?.tierBenefits?.map((benefit, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white/90 font-medium backdrop-blur-xs"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">{benefit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── KHỐI ĐƠN THUÊ ĐANG CHỜ TÍCH ĐIỂM (Pending Ledger Bento) ── */}
      {pendingBookings.length > 0 && (
        <section className="space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-700 shrink-0" />
                <h3 className="font-display text-xl sm:text-2xl font-bold text-ink">
                  Đơn Thuê Đang Chờ Tích Điểm
                </h3>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Các đơn đã thanh toán thành công. Điểm sẽ tự động cộng vào ví sau khi bạn hoàn tất trả đồ và kiểm tra cọc.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 border border-amber-300/80 px-3 py-1 text-xs font-bold text-amber-900 w-fit">
              {pendingBookings.length} đơn · +{pendingPoints.toLocaleString("vi-VN")} điểm chờ
            </span>
          </div>

          <div className="divide-y divide-sand/70 rounded-2xl border border-sand bg-white shadow-xs overflow-hidden">
            {pendingBookings.map((b) => (
              <div
                key={b.bookingId}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 hover:bg-stone-50/60 transition gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/booking/success?bookingId=${b.bookingId}`}
                      className="font-mono text-xs font-bold text-ink hover:text-lotus hover:underline transition flex items-center gap-1"
                      title="Xem chi tiết đơn hàng"
                    >
                      <Receipt className="h-3.5 w-3.5 text-stone-400" />
                      <span>#{b.bookingId.slice(0, 8).toUpperCase()}</span>
                    </Link>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${["renting", "overdue"].includes(b.status)
                        ? "bg-amber-50 border-amber-300/80 text-amber-800"
                        : ["returned", "inspection_pending", "refund_pending"].includes(b.status)
                          ? "bg-blue-50 border-blue-300/80 text-blue-800"
                          : "bg-stone-100 border-stone-300/60 text-stone-700"
                        }`}
                    >
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </div>

                  <p className="text-xs text-stone-500">
                    Tiền thuê tính điểm: <strong className="text-ink font-semibold tabular-nums">{Number(b.earnableSpend).toLocaleString("vi-VN")}đ</strong>
                  </p>
                </div>

                <div className="text-left sm:text-right space-y-0.5">
                  <span className="font-sans text-base sm:text-lg font-bold text-amber-700 tabular-nums">
                    +{b.points.toLocaleString("vi-VN")} điểm
                  </span>
                  <span className="text-[10px] text-stone-400 block font-medium">
                    (Chưa thể sử dụng · Tự động kích hoạt khi hoàn tất đơn)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── BẢNG ĐỔI ĐIỂM LẤY VOUCHER (Privilege Ticket Treasury) ── */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-lotus mb-1">
              <Gift className="h-3.5 w-3.5" />
              <span>Kho Ưu Đãi Hội Viên</span>
            </div>
            <h3 className="font-display text-xl sm:text-2xl font-bold text-ink">
              Đổi Điểm Lấy Mã Giảm Giá
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Chọn mức voucher mong muốn. Mã sẽ được tạo ngay và tự động lưu trong tài khoản để dùng khi thanh toán.
            </p>
          </div>

          <div className="text-xs font-medium text-stone-600 bg-sand/30 rounded-xl px-3 py-1.5 border border-sand/60 w-fit">
            Số dư khả dụng: <strong className="text-lotus font-bold font-sans text-sm tabular-nums">{currentPoints.toLocaleString("vi-VN")}</strong> điểm
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sand bg-white/60 p-10 text-center text-xs text-stone-500">
            Hiện chưa có gói voucher nào khả dụng để quy đổi. Quý khách vui lòng quay lại sau!
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rules.map((rule) => {
              const canRedeem = currentPoints >= rule.pointsRequired;
              const isRedeeming = redeemingId === rule.id;

              return (
                <div
                  key={rule.id}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border transition-all duration-300 ${canRedeem
                    ? "border-sand bg-white shadow-xs hover:shadow-md hover:border-lotus/40 hover:-translate-y-0.5"
                    : "border-stone-200/80 bg-stone-50/60 opacity-80"
                    }`}
                >
                  {/* Decorative Ticket Side Notches */}
                  <div className="pointer-events-none absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-sand bg-mist" />
                  <div className="pointer-events-none absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-sand bg-mist" />

                  <div className="p-5 space-y-3.5">
                    {/* Header: Cost & Validity */}
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-300/80 px-2.5 py-0.5 text-xs font-bold text-amber-900 shadow-2xs">
                        <Ticket className="h-3 w-3 text-amber-700" />
                        <span className="tabular-nums font-sans">{rule.pointsRequired.toLocaleString("vi-VN")}</span> điểm
                      </span>
                      <span className="text-[11px] font-medium text-stone-400">
                        HSD {rule.voucherValidityDays} ngày
                      </span>
                    </div>

                    {/* Voucher Title */}
                    <div>
                      <h4 className="font-display text-lg font-bold text-ink group-hover:text-lotus transition leading-snug">
                        {rule.discountType === "fixed" ? (
                          <>
                            Giảm{" "}
                            <span className="font-sans tabular-nums">
                              {rule.discountValue.toLocaleString("vi-VN")}đ
                            </span>{" "}
                            <span className="text-stone-500 font-medium font-sans text-base">
                              (Đổi{" "}
                              <span className="tabular-nums">
                                {rule.pointsRequired.toLocaleString("vi-VN")}
                              </span>{" "}
                              điểm)
                            </span>
                          </>
                        ) : (
                          <>
                            Giảm{" "}
                            <span className="font-sans tabular-nums">
                              {rule.discountValue}%
                            </span>{" "}
                            <span className="text-stone-500 font-medium font-sans text-base">
                              (Đổi{" "}
                              <span className="tabular-nums">
                                {rule.pointsRequired.toLocaleString("vi-VN")}
                              </span>{" "}
                              điểm)
                            </span>
                          </>
                        )}
                      </h4>

                      <div className="mt-3 text-xs text-stone-600 space-y-1 bg-mist/80 p-2.5 rounded-xl border border-sand/60">
                        {rule.discountType === "fixed" ? (
                          <div className="flex items-baseline justify-between">
                            <span className="text-stone-500">Giảm trực tiếp:</span>
                            <span className="font-bold text-lotus text-sm font-sans tabular-nums">
                              {rule.discountValue.toLocaleString("vi-VN")}đ
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-baseline justify-between">
                            <span className="text-stone-500">Tỷ lệ giảm:</span>
                            <span className="font-bold text-lotus text-sm font-sans tabular-nums">
                              {rule.discountValue}%
                              {rule.maxDiscountAmount && ` (tối đa ${rule.maxDiscountAmount.toLocaleString("vi-VN")}đ)`}
                            </span>
                          </div>
                        )}
                        {rule.minOrderValue > 0 && (
                          <div className="flex items-baseline justify-between text-[11px] pt-1 border-t border-sand/40">
                            <span className="text-stone-400">Đơn tối thiểu:</span>
                            <span className="font-medium text-stone-700 tabular-nums">
                              {rule.minOrderValue.toLocaleString("vi-VN")}đ
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Nested Button-in-Button CTA */}
                  <div className="p-5 pt-0">
                    <button
                      type="button"
                      disabled={!canRedeem || isRedeeming}
                      onClick={() => handleRedeem(rule.id)}
                      className={`w-full group/btn relative flex items-center justify-between rounded-full p-1.5 pr-4 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${canRedeem
                        ? "bg-lotus text-white hover:bg-oxblood shadow-xs active:scale-[0.98] cursor-pointer"
                        : "bg-stone-200/80 text-stone-400 cursor-not-allowed"
                        }`}
                    >
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform ${canRedeem ? "bg-white/20 text-white group-hover/btn:scale-105" : "bg-stone-300 text-stone-400"
                        }`}>
                        <Gift className="h-3.5 w-3.5" />
                      </div>

                      <span className="flex-1 text-center font-bold">
                        {isRedeeming ? (
                          "Đang khởi tạo..."
                        ) : canRedeem ? (
                          "Đổi mã giảm giá"
                        ) : (
                          `Thiếu ${(rule.pointsRequired - currentPoints).toLocaleString("vi-VN")} điểm`
                        )}
                      </span>

                      <div className={`flex h-5 w-5 items-center justify-center rounded-full transition-transform ${canRedeem ? "bg-white/20 group-hover/btn:translate-x-0.5" : "opacity-0"
                        }`}>
                        <ArrowRight className="h-3 w-3" />
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── LỊCH SỬ GIAO DỊCH ĐIỂM (Ledger Audit) ── */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-lotus" />
            <h3 className="font-display text-xl sm:text-2xl font-bold text-ink">
              Lịch Sử Giao Dịch Điểm
            </h3>
          </div>
          <span className="text-xs text-stone-400 font-sans">
            {history.length} bản ghi gần nhất
          </span>
        </div>

        {history.length === 0 ? (
          <div className="rounded-2xl border border-sand bg-white p-8 text-center text-xs text-stone-400">
            Chưa có biến động điểm nào được ghi nhận. Hãy hoàn tất các đơn thuê đầu tiên để tích lũy!
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-sand bg-white shadow-xs">
            <div className="divide-y divide-sand/70">
              {history.map((log) => {
                const isEarn = log.delta > 0;
                const formattedDate = new Date(log.createdAt).toLocaleDateString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                });

                return (
                  <div
                    key={log.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-4 sm:p-4.5 transition hover:bg-stone-50/70"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isEarn
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                            : "bg-amber-100 text-amber-900 border border-amber-200"
                            }`}
                        >
                          {isEarn ? "Tích lũy" : "Quy đổi"}
                        </span>
                        <span className="text-xs font-semibold text-ink">
                          {log.reason === "earn_rental"
                            ? "Tích lũy sau khi hoàn thành đơn thuê"
                            : log.reason === "redeem_voucher"
                              ? `Đổi mã voucher ${String(log.meta?.voucherCode ?? "")}`
                              : log.reason === "clawback_cancelled"
                                ? "Thu hồi điểm do hủy/hoàn đơn"
                                : log.reason}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 font-medium">
                        {formattedDate} • Số dư sau giao dịch:{" "}
                        <strong className="text-stone-700 font-semibold tabular-nums">
                          {log.balanceAfter.toLocaleString("vi-VN")} điểm
                        </strong>
                      </p>
                    </div>

                    <div className="sm:text-right">
                      <span
                        className={`font-sans text-sm sm:text-base font-bold tabular-nums ${isEarn ? "text-emerald-700" : "text-amber-700"
                          }`}
                      >
                        {isEarn ? "+" : ""}
                        {log.delta.toLocaleString("vi-VN")} điểm
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── CẨM NANG ĐẶC QUYỀN 3 HẠNG THÀNH VIÊN (Editorial Guide) ── */}
      <section className="rounded-3xl border border-sand bg-parchment/60 p-6 sm:p-7 space-y-5">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-lotus shrink-0" />
          <h4 className="font-display text-xl sm:text-2xl font-bold text-ink">
            Quy Chuẩn & Hệ Thống Thứ Hạng Thành Viên
          </h4>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 text-xs">
          {/* Basic */}
          <div className={`relative flex flex-col justify-between rounded-2xl border p-5 transition ${currentTier === "basic"
            ? "border-lotus/40 bg-white shadow-md ring-1 ring-lotus/20"
            : "border-sand bg-white/80"
            }`}>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-stone-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-700">
                  Khởi Đầu
                </span>
                {currentTier === "basic" && (
                  <span className="text-[10px] font-bold text-lotus bg-lotus/10 px-2 py-0.5 rounded-full">
                    Hạng hiện tại
                  </span>
                )}
              </div>
              <h5 className="font-display text-lg font-bold text-ink">Hạng Basic</h5>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Tự động kích hoạt ngay khi quý khách tạo tài khoản tại xưởng Cổ Phục.
              </p>
              <ul className="space-y-1.5 pt-2 text-[11px] text-stone-600 border-t border-sand/50">
                <li className="flex items-center gap-1.5">✓ Tích 1 điểm / 1.000đ thuê thực trả</li>
                <li className="flex items-center gap-1.5">✓ Quy đổi điểm nhận mã giảm giá</li>
                <li className="flex items-center gap-1.5">✓ Nhận tin bộ sưu tập mới sớm</li>
              </ul>
            </div>
          </div>

          {/* Plus */}
          <div className={`relative flex flex-col justify-between rounded-2xl border p-5 transition ${currentTier === "plus"
            ? "border-emerald-500 bg-white shadow-md ring-1 ring-emerald-500/20"
            : "border-emerald-200/80 bg-white/80"
            }`}>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-900">
                  Thân Thiết
                </span>
                {currentTier === "plus" && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Hạng hiện tại
                  </span>
                )}
              </div>
              <h5 className="font-display text-lg font-bold text-emerald-950">Hạng Plus</h5>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Đạt từ <strong className="text-emerald-800 tabular-nums">2.000 điểm trọn đời</strong> (~2.000.000đ tiền thuê).
              </p>
              <ul className="space-y-1.5 pt-2 text-[11px] text-emerald-900 border-t border-emerald-100 font-medium">
                <li className="flex items-center gap-1.5">✓ Toàn bộ đặc quyền của hạng Basic</li>
                <li className="flex items-center gap-1.5 font-bold text-emerald-800">★ Giảm trực tiếp 5% tiền thuê trang phục</li>
                <li className="flex items-center gap-1.5">✓ Ưu tiên hỗ trợ giữ size mùa cao điểm</li>
              </ul>
            </div>
          </div>

          {/* Premium */}
          <div className={`relative flex flex-col justify-between rounded-2xl border p-5 transition ${currentTier === "premium"
            ? "border-amber-400 bg-white shadow-md ring-1 ring-amber-400/30"
            : "border-amber-300/80 bg-white/80"
            }`}>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                  Hoàng Gia
                </span>
                {currentTier === "premium" && (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                    Hạng hiện tại
                  </span>
                )}
              </div>
              <h5 className="font-display text-lg font-bold text-amber-950">Hạng Premium</h5>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Đạt từ <strong className="text-amber-900 tabular-nums">6.000 điểm trọn đời</strong> (~6.000.000đ tiền thuê).
              </p>
              <ul className="space-y-1.5 pt-2 text-[11px] text-amber-950 border-t border-amber-100 font-medium">
                <li className="flex items-center gap-1.5">✓ Toàn bộ đặc quyền của hạng Plus</li>
                <li className="flex items-center gap-1.5 font-bold text-amber-900">★ Giảm trực tiếp 10% tiền thuê trang phục</li>
                <li className="flex items-center gap-1.5">★ Miễn phí phụ kiện đi kèm theo bộ</li>
                <li className="flex items-center gap-1.5">✓ Chuyên viên stylist tư vấn riêng 1-1</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
