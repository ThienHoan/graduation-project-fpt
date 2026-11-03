"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";

const TIER_META: Record<
  LoyaltyTier,
  { label: string; badge: string; color: string; bgGradient: string; icon: typeof Award }
> = {
  basic: {
    label: "Hạng Basic",
    badge: "Thành viên Khởi đầu",
    color: "text-stone-700 border-stone-300",
    bgGradient: "from-stone-100 via-sand/40 to-stone-200/50",
    icon: Award,
  },
  plus: {
    label: "Hạng Plus",
    badge: "Thành viên Thân thiết",
    color: "text-emerald-800 border-emerald-300",
    bgGradient: "from-emerald-50 via-teal-50/60 to-emerald-100/50",
    icon: Sparkles,
  },
  premium: {
    label: "Hạng Premium",
    badge: "Thành viên Cao cấp",
    color: "text-amber-900 border-amber-400",
    bgGradient: "from-amber-50 via-yellow-50/60 to-amber-100/60",
    icon: Crown,
  },
};

export default function CustomerLoyaltyPage() {
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
        // Tải lại dữ liệu điểm & lịch sử
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
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-lotus border-t-transparent" />
          <p className="text-xs text-stone-500 font-medium">Đang tải thông tin điểm thưởng...</p>
        </div>
      </div>
    );
  }

  const currentTier = loyalty?.tier ?? "basic";
  const tierInfo = TIER_META[currentTier];
  const TierIcon = tierInfo.icon;

  const lifetimePoints = loyalty?.lifetimePoints ?? 0;
  const currentPoints = loyalty?.points ?? 0;
  const nextTier = loyalty?.nextTier;
  const progressPercent = nextTier
    ? Math.min(100, Math.round((lifetimePoints / nextTier.targetPoints) * 100))
    : 100;

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div>
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-lotus">
          Chương Trình Khách Hàng Thân Thiết
        </span>
        <h1 className="mt-1 font-serif text-2xl font-bold text-ink sm:text-3xl">
          Điểm Thưởng & Hạng Thành Viên
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Tích luỹ 1 điểm cho mỗi 1.000đ giá trị thuê khi đơn hoàn tất. Đổi điểm lấy mã giảm giá và mở khoá đặc quyền hạng thành viên.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Thông báo đổi voucher thành công */}
      {successVoucher && (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-emerald-900">
                  Đổi mã giảm giá thành công!
                </h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Mã voucher của bạn: <strong className="font-mono">{successVoucher.code}</strong> ({successVoucher.name})
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(successVoucher.code)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-50 transition"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Đã sao chép" : "Sao chép mã"}</span>
              </button>
              <Link
                href="/catalog"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 transition"
              >
                <span>Dùng ngay</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Thẻ Hạng Thành Viên & Điểm Thưởng ── */}
      <div
        className={`relative overflow-hidden rounded-3xl border ${tierInfo.color} bg-gradient-to-br ${tierInfo.bgGradient} p-6 sm:p-8 shadow-sm`}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-sand/80 bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-xs">
              <TierIcon className="h-3.5 w-3.5 text-lotus" />
              <span>{tierInfo.badge}</span>
            </div>
            <h2 className="font-serif text-2xl font-bold sm:text-3xl text-ink">
              {tierInfo.label}
            </h2>
            <p className="text-xs text-stone-600 max-w-md">
              Tổng điểm trọn đời đã tích: <strong className="text-ink">{lifetimePoints.toLocaleString("vi-VN")} điểm</strong>
            </p>
          </div>

          {/* Hộp điểm khả dụng */}
          <div className="flex flex-col rounded-2xl border border-sand/80 bg-white/90 p-5 shadow-xs backdrop-blur-xs min-w-[200px]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              Điểm Thưởng Khả Dụng
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-serif text-3xl sm:text-4xl font-extrabold text-lotus">
                {currentPoints.toLocaleString("vi-VN")}
              </span>
              <span className="text-xs font-medium text-stone-500">điểm</span>
            </div>
            <span className="mt-1 text-[11px] text-stone-400">
              Dùng để đổi các mã giảm giá bên dưới
            </span>
          </div>
        </div>

        {/* Thanh Tiến Trình Lên Hạng */}
        {nextTier ? (
          <div className="mt-6 pt-6 border-t border-sand/60">
            <div className="flex items-center justify-between text-xs font-medium mb-1.5">
              <span className="text-stone-600">
                Tiến trình lên <strong className="text-ink uppercase">{TIER_META[nextTier.tier].label}</strong>
              </span>
              <span className="font-semibold text-lotus">
                Còn thiếu {nextTier.pointsNeeded.toLocaleString("vi-VN")} điểm
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-sand/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-lotus to-oxblood transition-all duration-700 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-stone-400">
              <span>{lifetimePoints.toLocaleString("vi-VN")} điểm</span>
              <span>Mục tiêu: {nextTier.targetPoints.toLocaleString("vi-VN")} điểm</span>
            </div>
          </div>
        ) : (
          <div className="mt-6 pt-6 border-t border-sand/60 flex items-center gap-2 text-xs font-semibold text-amber-900">
            <Crown className="h-4 w-4 text-amber-600 shrink-0" />
            <span>Chúc mừng bạn! Bạn đã đạt hạng Premium cao nhất với toàn bộ đặc quyền tối đa.</span>
          </div>
        )}

        {/* Danh sách quyền lợi của hạng hiện tại */}
        <div className="mt-6 pt-6 border-t border-sand/60">
          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-lotus" />
            <span>Đặc Quyền Của Bạn:</span>
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {loyalty?.tierBenefits?.map((benefit, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-stone-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 text-lotus shrink-0 mt-0.5" />
                <span>{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bảng Đổi Điểm Lấy Voucher ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-serif text-lg font-bold text-ink sm:text-xl flex items-center gap-2">
              <Gift className="h-5 w-5 text-lotus" />
              <span>Đổi Điểm Lấy Mã Giảm Giá</span>
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Chọn gói voucher bạn muốn nhận. Mã sẽ được tạo ngay và áp dụng tại bước thanh toán thuê.
            </p>
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-2xl border border-sand bg-white p-8 text-center text-xs text-stone-500">
            Hiện chưa có gói voucher nào khả dụng để đổi. Vui lòng quay lại sau!
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rules.map((rule) => {
              const canRedeem = currentPoints >= rule.pointsRequired;
              const isRedeeming = redeemingId === rule.id;

              return (
                <div
                  key={rule.id}
                  className="flex flex-col justify-between rounded-2xl border border-sand bg-white p-5 shadow-xs transition hover:shadow-md"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center rounded-lg bg-amber-50 border border-amber-200/80 px-2.5 py-1 text-xs font-bold text-amber-800">
                        {rule.pointsRequired.toLocaleString("vi-VN")} điểm
                      </span>
                      <span className="text-[11px] text-stone-400">
                        HSD {rule.voucherValidityDays} ngày
                      </span>
                    </div>

                    <h4 className="font-serif text-base font-bold text-ink">
                      {rule.voucherName}
                    </h4>

                    <div className="text-xs text-stone-500 space-y-1">
                      {rule.discountType === "fixed" ? (
                        <p>
                          Giảm trực tiếp: <strong className="text-lotus">{rule.discountValue.toLocaleString("vi-VN")}đ</strong>
                        </p>
                      ) : (
                        <p>
                          Giảm: <strong className="text-lotus">{rule.discountValue}%</strong>
                          {rule.maxDiscountAmount && ` (tối đa ${rule.maxDiscountAmount.toLocaleString("vi-VN")}đ)`}
                        </p>
                      )}
                      {rule.minOrderValue > 0 && (
                        <p>
                          Áp dụng cho đơn từ: <strong>{rule.minOrderValue.toLocaleString("vi-VN")}đ</strong>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-sand/60">
                    <button
                      type="button"
                      disabled={!canRedeem || isRedeeming}
                      onClick={() => handleRedeem(rule.id)}
                      className={`w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
                        canRedeem
                          ? "bg-lotus text-white hover:bg-oxblood active:scale-[0.98] shadow-xs cursor-pointer"
                          : "bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed"
                      }`}
                    >
                      {isRedeeming ? (
                        <span>Đang xử lý...</span>
                      ) : canRedeem ? (
                        <span>Đổi voucher ngay</span>
                      ) : (
                        <span>Thiếu {(rule.pointsRequired - currentPoints).toLocaleString("vi-VN")} điểm</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Lịch Sử Tích & Dùng Điểm (Ledger) ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold text-ink sm:text-xl flex items-center gap-2">
            <Clock className="h-5 w-5 text-lotus" />
            <span>Lịch Sử Giao Dịch Điểm</span>
          </h3>
        </div>

        {history.length === 0 ? (
          <div className="rounded-2xl border border-sand bg-white p-8 text-center text-xs text-stone-400">
            Chưa có lịch sử tích hoặc dùng điểm nào. Hãy hoàn thành các đơn thuê để nhận điểm thưởng!
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
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 transition hover:bg-stone-50/60"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isEarn
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {isEarn ? "Tích điểm" : "Đổi voucher"}
                        </span>
                        <span className="text-xs font-semibold text-ink">
                          {log.reason === "earn_rental"
                            ? "Tích luỹ sau khi hoàn thành đơn thuê"
                            : log.reason === "redeem_voucher"
                            ? `Đổi mã voucher ${String(log.meta?.voucherCode ?? "")}`
                            : log.reason}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400">
                        {formattedDate} • Số dư sau giao dịch:{" "}
                        <strong className="text-stone-600">
                          {log.balanceAfter.toLocaleString("vi-VN")} điểm
                        </strong>
                      </p>
                    </div>

                    <div className="sm:text-right">
                      <span
                        className={`font-serif text-sm sm:text-base font-bold ${
                          isEarn ? "text-emerald-700" : "text-amber-700"
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

      {/* ── Bảng Quy Chuẩn Hạng Thành Viên (Cẩm nang) ── */}
      <section className="rounded-2xl border border-sand bg-parchment/60 p-5 sm:p-6 space-y-4">
        <h4 className="font-serif text-base font-bold text-ink flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-lotus" />
          <span>Thông Tin Các Hạng Thành Viên</span>
        </h4>
        <div className="grid gap-4 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-sand bg-white p-4 space-y-2">
            <div className="font-bold text-stone-800 flex items-center gap-1.5">
              <Award className="h-4 w-4 text-stone-600" />
              <span>Hạng Basic (Mặc định)</span>
            </div>
            <p className="text-stone-500 text-[11px]">Dành cho khách hàng mới gia nhập.</p>
            <ul className="space-y-1 text-stone-600 text-[11px]">
              <li>✓ Tích 1 điểm / 1.000đ thuê</li>
              <li>✓ Đổi điểm lấy voucher</li>
            </ul>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-white p-4 space-y-2">
            <div className="font-bold text-emerald-800 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              <span>Hạng Plus (Từ 2.000 điểm)</span>
            </div>
            <p className="text-stone-500 text-[11px]">Tương đương ~2.000.000đ chi tiêu tích luỹ.</p>
            <ul className="space-y-1 text-stone-600 text-[11px]">
              <li>✓ Toàn bộ quyền lợi Basic</li>
              <li>✓ Giảm 5% tiền thuê trang phục</li>
              <li>✓ Ưu tiên giữ size trang phục hot</li>
            </ul>
          </div>

          <div className="rounded-xl border border-amber-300 bg-white p-4 space-y-2">
            <div className="font-bold text-amber-900 flex items-center gap-1.5">
              <Crown className="h-4 w-4 text-amber-600" />
              <span>Hạng Premium (Từ 6.000 điểm)</span>
            </div>
            <p className="text-stone-500 text-[11px]">Tương đương ~6.000.000đ chi tiêu tích luỹ.</p>
            <ul className="space-y-1 text-stone-600 text-[11px]">
              <li>✓ Toàn bộ quyền lợi Plus</li>
              <li>✓ Giảm 10% tiền thuê trang phục</li>
              <li>✓ Miễn phí 1 phụ kiện đi kèm</li>
              <li>✓ Hỗ trợ ưu tiên đặc biệt</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

