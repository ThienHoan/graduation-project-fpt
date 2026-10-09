"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BookingFlowShell } from "@/components/heritage/ui";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import {
  createBooking,
  createPaymentLink,
  getAvailableVouchers,
  getMyAddresses,
  getRentalQuote,
  normalizePickupMethod,
  validateVoucher,
  type CustomerAddress,
  type PickupMethod,
  type RentalQuote,
  type VoucherPublic,
  type VoucherValidation,
} from "@/lib/api";
import { getCart, clearCart, type CartItem } from "@/lib/cart";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

function formatAddress(address: CustomerAddress) {
  return [address.line1, address.ward, address.district, address.city].filter(Boolean).join(", ");
}

const pickupLabels: Record<string, string> = {
  pickup: "Nhận tại xưởng & hoàn trả tại cửa hàng",
  delivery: "Giao tận nơi & nhận lại tại nhà",
  store_pickup: "Nhận tại atelier & hoàn trả tại cửa hàng",
};

function BookingReviewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  const pickupMethod: PickupMethod | null = normalizePickupMethod(searchParams.get("pickupMethod")) ??
    (searchParams.has("pickupMethod") ? null : "store_pickup");
  const deliveryAddressId = searchParams.get("deliveryAddressId") ?? "";
  const shippingFeeParam = searchParams.get("shippingFee") ?? "0";
  const shippingFee = parseInt(shippingFeeParam, 10) || 0;

  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState<CustomerAddress | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const isDelivery = pickupMethod === "delivery";
  const invalidPickupMethod = pickupMethod === null;
  // Đơn giao tận nơi bắt buộc thanh toán QR trước khi giao
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qr_code">(isDelivery ? "qr_code" : "cash");

  useEffect(() => {
    if (isDelivery && paymentMethod !== "qr_code") setPaymentMethod("qr_code");
  }, [isDelivery, paymentMethod]);

  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setCartItems(getCart());
  }, []);
  const days = startDate && endDate ? daysBetween(startDate, endDate) : 0;

  // Giá thuê do backend tính theo luật giá tự động (Tết, lễ, sale đôi, cuối tuần...).
  const [quotes, setQuotes] = useState<Map<string, RentalQuote>>(new Map());
  useEffect(() => {
    if (cartItems.length === 0 || !startDate || !endDate) return;
    getRentalQuote(cartItems.map((i) => i.garmentSizeId), startDate, endDate).then((res) => {
      if (res.success && res.data) setQuotes(new Map(res.data.map((q) => [q.sizeId, q])));
    });
  }, [cartItems, startDate, endDate]);
  const lineTotal = (item: CartItem) => quotes.get(item.garmentSizeId)?.rentalTotal ?? item.dailyPrice * days;

  // Voucher — chỉ là xem trước; backend kiểm tra lại khi tạo booking.
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherResult, setVoucherResult] = useState<VoucherValidation | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [availableVouchers, setAvailableVouchers] = useState<VoucherPublic[]>([]);
  useEffect(() => {
    getAvailableVouchers().then((res) => {
      if (res.success && res.data) setAvailableVouchers(res.data);
    });
  }, []);

  async function applyVoucher(code?: string) {
    const c = (code ?? voucherInput).trim().toUpperCase();
    if (!c || cartItems.length === 0) return;
    setVoucherInput(c);
    setVoucherLoading(true);
    setVoucherError(null);
    const res = await validateVoucher({
      code: c,
      garmentSizeIds: cartItems.map((i) => i.garmentSizeId),
      startDate,
      endDate,
    });
    setVoucherLoading(false);
    if (res.success && res.data) {
      setVoucherResult(res.data);
    } else {
      setVoucherResult(null);
      setVoucherError(res.message ?? "Voucher không hợp lệ.");
    }
  }

  const rentalTotal = cartItems.reduce((sum, item) => sum + lineTotal(item), 0);
  const discountTotal = voucherResult?.discountAmount ?? 0;
  const depositTotal = cartItems.reduce((sum, item) => sum + item.depositAmount, 0);
  const grandTotal = rentalTotal - discountTotal + depositTotal + shippingFee;

  useEffect(() => {
    if (pickupMethod !== "delivery" || !deliveryAddressId) {
      setDeliveryAddress(null);
      return;
    }

    setAddressLoading(true);
    getMyAddresses()
      .then((result) => {
        if (result.success && result.data) {
          setDeliveryAddress(result.data.find((address) => address.id === deliveryAddressId) ?? null);
        }
      })
      .finally(() => setAddressLoading(false));
  }, [deliveryAddressId, pickupMethod]);

  async function handleConfirm() {
    if (cartItems.length === 0 || !startDate || !endDate || invalidPickupMethod || !pickupMethod) {
      setErrorMsg("Phương thức nhận đồ không hợp lệ. Vui lòng quay lại bước vận chuyển.");
      return;
    }
    if (pickupMethod === "delivery" && !deliveryAddressId) {
      setErrorMsg("Vui lòng chọn địa chỉ giao nhận.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    const res = await createBooking({
      garmentSizeIds: cartItems.map((i) => i.garmentSizeId),
      startDate,
      endDate,
      pickupMethod,
      deliveryAddressId: pickupMethod === "delivery" ? deliveryAddressId : undefined,
      shippingFee: pickupMethod === "delivery" && shippingFee > 0 ? shippingFee : undefined,
      paymentMethod,
      voucherCode: voucherResult?.voucher.code,
    });
    if (!res.success || !res.data) {
      setSubmitting(false);
      setErrorMsg(res.message ?? "Không thể tạo booking. Vui lòng thử lại.");
      return;
    }

    const bookingId = res.data.id;

    if (paymentMethod === "qr_code") {
      const linkRes = await createPaymentLink(bookingId);
      if (!linkRes.success || !linkRes.data) {
        setSubmitting(false);
        setErrorMsg(linkRes.message ?? "Không thể tạo link thanh toán. Vui lòng thử lại.");
        return;
      }
      clearCart();
      localStorage.setItem("heritage-payment", JSON.stringify({
        bookingId,
        amount: linkRes.data.amount,
      }));
      window.location.href = linkRes.data.checkoutUrl;
    } else {
      clearCart();
      router.push(`/booking/success?bookingId=${bookingId}`);
    }
  }

  const backParams = new URLSearchParams({ startDate, endDate, pickupMethod: pickupMethod ?? "store_pickup" });
  if (deliveryAddressId) backParams.set("deliveryAddressId", deliveryAddressId);
  if (shippingFee > 0) backParams.set("shippingFee", String(shippingFee));

  if (invalidPickupMethod) {
    return (
      <BookingFlowShell currentStep="review" title="Phương thức nhận đồ không hợp lệ" description="">
        <div className="py-20 text-center text-stone-500">
          <p>Vui lòng quay lại bước vận chuyển để chọn lại phương thức nhận đồ.</p>
          <Link href={`/booking/logistics?${new URLSearchParams({ startDate, endDate }).toString()}`} className="mt-6 inline-flex rounded-lg bg-lotus px-6 py-3 text-sm font-semibold text-white">
            Quay lại vận chuyển
          </Link>
        </div>
      </BookingFlowShell>
    );
  }

  if (cartItems.length === 0) {
    return (
      <BookingFlowShell currentStep="review" title="Giỏ hàng trống" description="">
        <div className="py-20 text-center">
          <span className="material-symbols-outlined text-6xl text-stone-200 mb-6 block">shopping_bag</span>
          <h2 className="font-display text-3xl text-ink mb-3">Giỏ hàng trống</h2>
          <p className="text-stone-500 mb-8 max-w-md mx-auto">
            Bạn chưa có món nào trong giỏ thuê. Hãy quay lại bộ sưu tập để chọn trang phục.
          </p>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 rounded-lg bg-lotus px-8 py-4 text-sm font-semibold text-white transition hover:bg-oxblood"
          >
            <span className="material-symbols-outlined text-[18px]">apparel</span>
            Khám phá bộ sưu tập
          </Link>
        </div>
      </BookingFlowShell>
    );
  }

  return (
    <BookingFlowShell
      currentStep="review"
      title="Kiểm tra đơn hàng"
      description="Rà lại các món, thời gian thuê, phương thức nhận đồ và các khoản thanh toán trước khi xác nhận booking."
    >
      <div className="grid gap-8 xl:grid-cols-12 xl:items-start">
        <div className="space-y-8 xl:col-span-7">
          <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
            <h2 className="mb-6 border-b border-sand pb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
              Trang phục đã chọn ({cartItems.length})
            </h2>
            <div className="divide-y divide-sand">
              {cartItems.map((item) => (
                <div key={item.garmentSizeId} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-lotus/10">
                    <span className="material-symbols-outlined text-2xl text-antique/50">checkroom</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-ink">{item.name}</h3>
                    <p className="text-xs text-stone-500">
                      {item.sizeLabel ? `Size ${item.sizeLabel} · ` : ""}
                      {(() => {
                        const q = quotes.get(item.garmentSizeId);
                        if (!q || q.discountPrice === q.basePrice) return `${formatVND(q?.basePrice ?? item.dailyPrice)}/ngày`;
                        return (
                          <>
                            <span className="line-through">{formatVND(q.basePrice)}</span>{" "}
                            <span className="font-medium text-lotus">{formatVND(q.discountPrice)}/ngày (TB)</span>
                          </>
                        );
                      })()}
                    </p>
                    {(quotes.get(item.garmentSizeId)?.appliedRules ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {quotes.get(item.garmentSizeId)!.appliedRules.map((r) => (
                          <span key={r.id} className="rounded-full bg-lotus/10 px-2 py-0.5 text-[11px] font-semibold text-lotus">
                            {r.name}
                            {r.percentage ? ` ${r.percentage > 0 ? "+" : ""}${r.percentage}%` : ""} · {r.days} ngày
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 flex gap-4 text-xs">
                      <span className="text-stone-500">Thuê {days} ngày: <span className="font-medium text-ink">{formatVND(lineTotal(item))}</span></span>
                      <span className="text-stone-500">Cọc: <span className="font-medium text-ink">{formatVND(item.depositAmount)}</span></span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-8 md:grid-cols-2">
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-2 border-b border-sand pb-3">
                <span className="material-symbols-outlined text-stone-500">calendar_today</span>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Lịch thuê</h2>
              </div>
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between"><span className="text-stone-500">Nhận đồ</span><span className="font-medium text-ink">{startDate ? formatDate(startDate) : "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-stone-500">Trả đồ</span><span className="font-medium text-ink">{endDate ? formatDate(endDate) : "—"}</span></div>
                <div className="flex items-center justify-between border-t border-sand pt-4"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Thời lượng</span><span className="font-semibold text-lotus">{days} ngày</span></div>
              </div>
            </section>

            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-2 border-b border-sand pb-3">
                <span className="material-symbols-outlined text-stone-500">local_shipping</span>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Vận chuyển</h2>
              </div>
              <div className="space-y-4 text-sm">
                <div><span className="block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Phương thức</span><span className="font-medium text-ink">{pickupLabels[pickupMethod] ?? pickupMethod}</span></div>
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Địa điểm</span>
                  {pickupMethod === "delivery" ? (
                    addressLoading ? (
                      <span className="leading-7 text-stone-500">Đang tải địa chỉ...</span>
                    ) : deliveryAddress ? (
                      <span className="leading-7 text-stone-600">
                        {deliveryAddress.receiverName} · {deliveryAddress.phone}
                        <br />
                        {formatAddress(deliveryAddress)}
                      </span>
                    ) : (
                      <span className="leading-7 text-red-500">Không tìm thấy địa chỉ đã chọn.</span>
                    )
                  ) : (
                    <span className="leading-7 text-stone-600">123 Silk Road, Quận 1<br />TP. Hồ Chí Minh</span>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside className="xl:col-span-5 xl:sticky xl:top-28">
          <section className="rounded-xl border border-sand bg-white p-8 shadow-md">
            <h2 className="border-b border-sand pb-4 font-display text-3xl text-ink">Tóm tắt thanh toán</h2>
            <div className="mt-6 space-y-3 text-sm">
              {cartItems.map((item) => (
                <div key={item.garmentSizeId} className="flex items-center justify-between text-stone-500">
                  <span className="truncate max-w-[180px]">{item.name}</span>
                  <span>{formatVND(lineTotal(item))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-sand pt-3">
                <span className="text-stone-500">Tiền thuê ({days} ngày)</span>
                <span className="text-ink">{formatVND(rentalTotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">Voucher {voucherResult?.voucher.code}</span>
                  <span className="font-medium text-jade">-{formatVND(discountTotal)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Làm sạch chuyên biệt</span>
                <span className="font-medium text-jade">Đã bao gồm</span>
              </div>
              {shippingFee > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">Phí giao hàng</span>
                  <span className="text-ink">{formatVND(shippingFee)}</span>
                </div>
              )}
            </div>

            <div className="mt-6 border-t border-sand pt-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Mã giảm giá</h3>
              <div className="flex gap-2">
                <input
                  value={voucherInput}
                  onChange={(e) => {
                    setVoucherInput(e.target.value.toUpperCase());
                    if (voucherResult) setVoucherResult(null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") applyVoucher(); }}
                  placeholder="Nhập mã voucher"
                  className="min-w-0 flex-1 rounded-lg border border-sand px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-lotus/30"
                />
                {voucherResult ? (
                  <button
                    type="button"
                    onClick={() => { setVoucherResult(null); setVoucherInput(""); }}
                    className="rounded-lg border border-sand px-4 py-2 text-sm font-semibold text-stone-600 hover:border-lotus hover:text-lotus"
                  >
                    Bỏ
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!voucherInput.trim() || voucherLoading}
                    onClick={() => applyVoucher()}
                    className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {voucherLoading ? "..." : "Áp dụng"}
                  </button>
                )}
              </div>
              {voucherError && <p className="mt-2 text-xs text-red-500">{voucherError}</p>}
              {voucherResult && (
                <p className="mt-2 text-xs text-jade">
                  Đã áp dụng “{voucherResult.voucher.name}” — giảm {formatVND(voucherResult.discountAmount)}
                </p>
              )}
              {!voucherResult && availableVouchers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {availableVouchers.slice(0, 4).map((v) => (
                    <button
                      key={v.code}
                      type="button"
                      onClick={() => applyVoucher(v.code)}
                      title={v.description ?? v.name}
                      className="rounded-full border border-dashed border-lotus/50 px-3 py-1 text-xs font-semibold text-lotus hover:bg-lotus/5"
                    >
                      {v.code} ·{" "}
                      {v.discountType === "percentage" ? `-${v.discountValue}%` : `-${formatVND(v.discountValue)}`}
                      {v.minOrderValue > 0 ? ` (đơn từ ${formatVND(v.minOrderValue)})` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-8 rounded-lg border border-antique/40 bg-antique/10 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1 text-sm font-semibold text-bronze"><span className="material-symbols-outlined text-[16px]">security</span>Tiền cọc bảo đảm</span>
                <span className="font-medium text-bronze">{formatVND(depositTotal)}</span>
              </div>
              <p className="mt-2 text-xs leading-6 text-bronze">Hoàn lại sau khi nhân viên kiểm tra đạt yêu cầu.</p>
            </div>

            <div className="mt-8 border-t border-sand pt-6">
              <div className="mb-2 flex items-end justify-between gap-4"><span className="text-lg text-ink">Tổng thanh toán</span><span className="font-display text-4xl text-lotus">{formatVND(grandTotal)}</span></div>
              <p className="text-right text-xs text-stone-500">Gồm tiền thuê{shippingFee > 0 ? ", phí giao hàng" : ""} và tiền cọc hoàn lại</p>
            </div>

            <div className="mt-8 border-t border-sand pt-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Phương thức thanh toán</h3>
              {isDelivery && (
                <p className="mb-3 rounded-lg border border-antique/40 bg-antique/10 p-3 text-xs text-bronze">
                  Đơn giao tận nơi cần thanh toán chuyển khoản QR trước khi cửa hàng giao trang phục.
                </p>
              )}
              <div className="space-y-3">
                {!isDelivery && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-sand p-4 transition hover:border-lotus has-[:checked]:border-lotus has-[:checked]:bg-[#fff0ee]">
                    <input type="radio" name="paymentMethod" value="cash" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} className="h-4 w-4 text-lotus focus:ring-lotus" />
                    <span className="material-symbols-outlined text-xl text-stone-500">payments</span>
                    <div>
                      <span className="text-sm font-medium text-ink">Tiền mặt</span>
                      <p className="text-xs text-stone-500">Thanh toán tại cửa hàng khi nhận đồ</p>
                    </div>
                  </label>
                )}
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-sand p-4 transition hover:border-lotus has-[:checked]:border-lotus has-[:checked]:bg-[#fff0ee]">
                  <input type="radio" name="paymentMethod" value="qr_code" checked={paymentMethod === "qr_code"} onChange={() => setPaymentMethod("qr_code")} className="h-4 w-4 text-lotus focus:ring-lotus" />
                  <span className="material-symbols-outlined text-xl text-stone-500">qr_code_2</span>
                  <div>
                    <span className="text-sm font-medium text-ink">Chuyển khoản (QR)</span>
                    <p className="text-xs text-stone-500">Quét mã QR để thanh toán qua ngân hàng</p>
                  </div>
                </label>
              </div>
            </div>

            <label className="mt-8 flex cursor-pointer items-start gap-3 text-sm leading-7 text-stone-600">
              <input className="mt-1 h-5 w-5 rounded border-sand text-lotus focus:ring-lotus" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>Tôi đã đọc chính sách nghi lễ và đồng ý giữ gìn trang phục như một tài sản văn hóa trong suốt thời gian thuê.</span>
            </label>

            {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={`/booking/logistics?${backParams.toString()}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-bronze px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-bronze transition hover:bg-parchment"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Quay lại vận chuyển
              </Link>
              <button
                type="button"
                disabled={!agreed || submitting || cartItems.length === 0 || (pickupMethod === "delivery" && !deliveryAddressId)}
                onClick={handleConfirm}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-oxblood disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Đang xử lý..." : `Xác nhận đặt lịch (${cartItems.length} món)`}
                {!submitting && <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </BookingFlowShell>
  );
}

export default function BookingReviewPage() {
  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink">
      <CustomerNavbar />
      <Suspense>
        <BookingReviewInner />
      </Suspense>
      <CustomerFooter />
    </div>
  );
}
