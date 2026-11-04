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
  getGarmentAccessories,
  getMyAddresses,
  getRentalQuote,
  normalizePickupMethod,
  validateVoucher,
  getMyLoyalty,
  type CustomerAddress,
  type GarmentAccessoryLink,
  type PickupMethod,
  type RentalQuote,
  type VoucherPublic,
  type VoucherValidation,
  type LoyaltyInfo,
} from "@/lib/api";
import { getCart, clearCart, type CartItem } from "@/lib/cart";
import {
  clearAccessorySelection,
  flattenAccessorySelection,
  getAccessorySelection,
  pruneAccessorySelection,
  type AccessorySelection,
} from "@/lib/accessory-selection";
import {
  ShoppingBag,
  Shirt,
  Sparkles,
  Calendar,
  Truck,
  ShieldCheck,
  Banknote,
  QrCode,
  ArrowLeft,
  ArrowRight,
  Clock,
  ShieldAlert,
  Award,
  Crown,
  Percent,
} from "lucide-react";

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

const RENTAL_TERMS = [
  "Không tự ý giặt máy, không ủi nhiệt độ cao hoặc phơi trực tiếp dưới nắng gắt.",
  "Tránh để trang phục tiếp xúc nước hoa nồng độ cao, rượu bia, dầu mỡ hoặc hoá chất làm biến dạng/ố màu vải.",
  "Không tự ý cắt sửa form dáng, may vá hoặc đính kèm phụ kiện sắt nhọn lên vải.",
  "Khách hàng kiểm tra sản phẩm và báo ngay trong vòng 30 phút sau khi nhận nếu có lỗi phát sinh từ trước.",
  "Chính sách bồi hoàn hư hại: Phí tổn thất được tính theo % giá trị định giá của trang phục. Nếu hư hại không thể khắc phục vượt quá số tiền cọc, khách hàng có trách nhiệm thanh toán bổ sung phần chênh lệch trong vòng 3 ngày làm việc.",
];

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

  // Phụ kiện thuê kèm đã tick ở bước chọn ngày (lưu trong localStorage theo từng món).
  const [accBySize, setAccBySize] = useState<Record<string, GarmentAccessoryLink[]>>({});
  const [accessorySelection, setAccessorySelection] = useState<AccessorySelection>({});
  useEffect(() => {
    if (cartItems.length === 0) return;
    let cancelled = false;
    const garmentIds = [...new Set(cartItems.map((i) => i.garmentId))];
    Promise.all(
      garmentIds.map((gid) =>
        getGarmentAccessories(gid).then((res) => ({
          gid,
          links: res.success && res.data ? res.data : [],
        })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const linkMap = new Map(results.map((r) => [r.gid, r.links]));
      const nextAcc: Record<string, GarmentAccessoryLink[]> = {};
      const validIds: Record<string, string[]> = {};
      cartItems.forEach((item) => {
        const links = linkMap.get(item.garmentId) ?? [];
        nextAcc[item.garmentSizeId] = links;
        validIds[item.garmentSizeId] = links.map((l) => l.accessory.id);
      });
      setAccBySize(nextAcc);
      setAccessorySelection(
        pruneAccessorySelection(
          cartItems.map((i) => i.garmentSizeId),
          validIds,
        ),
      );
    }).catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [cartItems]);

  const accessoryLinksById = (sizeId: string) => {
    const map = new Map((accBySize[sizeId] ?? []).map((l) => [l.accessory.id, l]));
    return (accessorySelection[sizeId] ?? [])
      .map((id) => map.get(id))
      .filter((l): l is GarmentAccessoryLink => Boolean(l));
  };
  const accessoryTotal = cartItems.reduce((sum, item) => {
    return (
      sum +
      accessoryLinksById(item.garmentSizeId)
        .filter((l) => !l.isIncluded)
        .reduce((s, l) => s + l.extraPrice * l.quantity * days, 0)
    );
  }, 0);
  const selectedAccessoryCount = Object.values(accessorySelection).reduce((s, ids) => s + ids.length, 0);

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

  // Hạng thành viên Loyalty — tự động lấy quyền lợi giảm giá tiền thuê
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  useEffect(() => {
    getMyLoyalty()
      .then((res) => {
        if (res.success && res.data) setLoyalty(res.data);
      })
      .catch(() => { });
  }, []);

  const garmentRentalSubtotal = cartItems.reduce((sum, item) => sum + lineTotal(item), 0);
  const rentalTotal = garmentRentalSubtotal + accessoryTotal;

  // Ưu đãi thành viên: Plus 5%, Premium 10% trên tiền thuê trang phục
  const memberDiscountRate =
    loyalty?.tier === "premium" ? 0.10 :
      loyalty?.tier === "plus" ? 0.05 : 0;
  const memberDiscountAmount = Math.round(garmentRentalSubtotal * memberDiscountRate);

  // So sánh ưu đãi: Chọn mức giảm tối ưu nhất (Voucher vs Hạng thành viên)
  const voucherDiscount = voucherResult?.discountAmount ?? 0;
  const isUsingVoucher = Boolean(voucherResult && voucherDiscount >= memberDiscountAmount);
  const isUsingMemberDiscount = Boolean(
    memberDiscountAmount > 0 && (!voucherResult || memberDiscountAmount > voucherDiscount),
  );
  const effectiveDiscount = isUsingVoucher
    ? voucherDiscount
    : isUsingMemberDiscount
      ? memberDiscountAmount
      : 0;

  const depositTotal = cartItems.reduce((sum, item) => sum + item.depositAmount, 0);
  const grandTotal = Math.max(0, rentalTotal - effectiveDiscount) + depositTotal + shippingFee;

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
      voucherCode: isUsingVoucher ? voucherResult?.voucher.code : undefined,
      accessories: flattenAccessorySelection(accessorySelection),
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
      clearAccessorySelection();
      localStorage.setItem("heritage-payment", JSON.stringify({
        bookingId,
        amount: linkRes.data.amount,
      }));
      window.location.href = linkRes.data.checkoutUrl;
    } else {
      clearCart();
      clearAccessorySelection();
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
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-lotus/10 text-lotus">
            <ShoppingBag className="h-10 w-10 text-antique" />
          </div>
          <h2 className="font-display text-3xl text-ink mb-3">Giỏ hàng trống</h2>
          <p className="text-stone-500 mb-8 max-w-md mx-auto text-sm leading-relaxed">
            Bạn chưa có món nào trong giỏ thuê. Hãy quay lại bộ sưu tập để chọn trang phục.
          </p>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 rounded-xl bg-lotus px-8 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
          >
            <Shirt className="h-4 w-4" />
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
                <div key={item.garmentSizeId} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-4">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={item.name}
                        src={item.imageUrl}
                        className="h-20 w-16 shrink-0 rounded-lg border border-sand object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-lotus/10">
                        <Shirt className="h-6 w-6 text-antique" />
                      </div>
                    )}
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
                  {(() => {
                    const accLinks = accessoryLinksById(item.garmentSizeId);
                    if (accLinks.length === 0) return null;
                    return (
                      <div className="mt-2 ml-16 rounded-lg border border-sand bg-mist/60 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          Phụ kiện thuê kèm ({accLinks.length})
                        </p>
                        <ul className="mt-1.5 space-y-1.5">
                          {accLinks.map((l) => (
                            <li key={l.accessory.id} className="flex items-center gap-2.5 text-xs">
                              {l.accessory.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  alt={l.accessory.name}
                                  src={l.accessory.imageUrl}
                                  className="h-8 w-8 shrink-0 rounded object-cover"
                                />
                              ) : (
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-mist">
                                  <Sparkles className="h-3.5 w-3.5 text-stone-400" />
                                </div>
                              )}
                              <span className="min-w-0 flex-1 truncate text-stone-600">
                                ✓ {l.accessory.name} <span className="text-stone-400">× {l.quantity}</span>
                              </span>
                              <span className={l.isIncluded ? "font-medium text-jade" : "font-medium text-ink"}>
                                {l.isIncluded ? "Miễn phí" : `+${formatVND(l.extraPrice * l.quantity * days)}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <Link
                          href={`/booking/date-selection?${new URLSearchParams({ startDate, endDate }).toString()}`}
                          className="mt-1.5 inline-block text-[11px] font-semibold text-lotus hover:underline"
                        >
                          Đổi phụ kiện
                        </Link>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-8 md:grid-cols-2">
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-2 border-b border-sand pb-3">
                <Calendar className="h-4 w-4 text-stone-500" />
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
                <Truck className="h-4 w-4 text-stone-500" />
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
          <section className="rounded-2xl border border-sand bg-white p-6 sm:p-8 shadow-md">
            <h2 className="border-b border-sand pb-4 font-serif text-2xl font-bold text-ink">
              Tóm tắt thanh toán
            </h2>

            {/* Banner Hạng Thành Viên */}
            {loyalty && loyalty.tier !== "basic" && (
              <div
                className={`mt-4 rounded-xl border p-3.5 text-xs ${loyalty.tier === "premium"
                    ? "border-amber-300 bg-amber-50/90 text-amber-950"
                    : "border-emerald-300 bg-emerald-50/90 text-emerald-950"
                  }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <div className="flex items-center gap-1.5">
                    {loyalty.tier === "premium" ? (
                      <Crown className="h-4 w-4 text-amber-600 shrink-0" />
                    ) : (
                      <Award className="h-4 w-4 text-emerald-600 shrink-0" />
                    )}
                    <span>
                      Hạng {loyalty.tier === "premium" ? "Premium" : "Plus"} (Giảm {Math.round(memberDiscountRate * 100)}% tiền thuê)
                    </span>
                  </div>
                  <span className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-2xs">
                    Tiết kiệm {formatVND(memberDiscountAmount)}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-stone-600">
                  {isUsingMemberDiscount
                    ? `Đã tự động áp dụng giảm ${Math.round(memberDiscountRate * 100)}% trực tiếp vào tiền thuê trang phục bên dưới.`
                    : "Đang ưu tiên áp dụng voucher có mức giảm cao hơn cho đơn này."}
                </p>
              </div>
            )}

            {/* ── Khối 1: Chi tiết tiền thuê trang phục & phụ kiện ── */}
            <div className="mt-6 rounded-xl border border-sand/70 bg-stone-50/50 p-4 space-y-3 text-xs sm:text-sm">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 block mb-1">
                Chi tiết tiền thuê ({days} ngày)
              </span>

              {cartItems.map((item) => (
                <div key={item.garmentSizeId} className="flex items-center justify-between text-stone-600">
                  <span className="truncate max-w-[200px] font-medium">
                    {item.name} {item.sizeLabel ? `(${item.sizeLabel})` : ""}
                  </span>
                  <span className="tabular-nums font-medium text-stone-700">{formatVND(lineTotal(item))}</span>
                </div>
              ))}

              {selectedAccessoryCount > 0 && (
                <div className="flex items-center justify-between text-stone-600 pt-1">
                  <span>Phụ kiện thuê kèm ({selectedAccessoryCount} món)</span>
                  <span className={`tabular-nums font-medium ${accessoryTotal === 0 ? "text-jade" : "text-stone-700"}`}>
                    {accessoryTotal === 0 ? "Miễn phí" : `+${formatVND(accessoryTotal)}`}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-dashed border-sand pt-2 text-stone-500">
                <span>Tạm tính tiền thuê gốc</span>
                <span className="tabular-nums font-medium">{formatVND(rentalTotal)}</span>
              </div>

              {/* Dòng giảm giá thành viên */}
              {isUsingMemberDiscount && (
                <div className="flex items-center justify-between rounded-lg bg-emerald-100/70 px-2.5 py-1.5 text-xs text-emerald-900">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                    <span>Ưu đãi thành viên {loyalty?.tier === "premium" ? "Premium (-10%)" : "Plus (-5%)"}</span>
                  </span>
                  <span className="tabular-nums font-bold text-emerald-700">-{formatVND(memberDiscountAmount)}</span>
                </div>
              )}

              {/* Dòng giảm giá Voucher */}
              {isUsingVoucher && (
                <div className="flex items-center justify-between rounded-lg bg-emerald-100/70 px-2.5 py-1.5 text-xs text-emerald-900">
                  <span className="font-medium">Mã giảm giá ({voucherResult?.voucher.code})</span>
                  <span className="tabular-nums font-bold text-emerald-700">-{formatVND(voucherDiscount)}</span>
                </div>
              )}

              {/* Tiền thuê thực trả */}
              <div className="flex items-center justify-between border-t border-sand pt-2 text-sm">
                <span className="font-semibold text-ink">Tiền thuê thực trả</span>
                <div className="text-right">
                  {effectiveDiscount > 0 && (
                    <span className="text-[11px] text-stone-400 line-through mr-1.5 tabular-nums">
                      {formatVND(rentalTotal)}
                    </span>
                  )}
                  <span className="tabular-nums font-bold text-lotus text-base">
                    {formatVND(Math.max(0, rentalTotal - effectiveDiscount))}
                  </span>
                </div>
              </div>
            </div>

            {/* Dịch vụ làm sạch & Giao hàng */}
            <div className="mt-3 space-y-2 px-1 text-xs text-stone-500">
              <div className="flex items-center justify-between">
                <span>Dịch vụ giặt ủi & làm sạch chuyên sâu</span>
                <span className="font-medium text-jade">Đã bao gồm</span>
              </div>
              {shippingFee > 0 && (
                <div className="flex items-center justify-between">
                  <span>Phí giao nhận tận nơi</span>
                  <span className="tabular-nums font-medium text-ink">{formatVND(shippingFee)}</span>
                </div>
              )}
            </div>

            {/* ── Khối 2: Tiền cọc bảo đảm tài sản ── */}
            <div className="mt-5 rounded-xl border border-amber-300/60 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-950">
                  <ShieldCheck className="h-4 w-4 text-amber-700 shrink-0" />
                  <span>Tiền cọc bảo đảm trang phục</span>
                </span>
                <span className="tabular-nums font-bold text-amber-900 text-sm sm:text-base">
                  {formatVND(depositTotal)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-800/80">
                Khoản cọc bảo đảm theo giá trị niêm yết — <strong>được hoàn lại 100%</strong> sau khi quý khách trả đồ nguyên vẹn.
              </p>
            </div>

            {/* ── Khối 3: Mã giảm giá / Voucher ── */}
            <div className="mt-6 border-t border-sand pt-5">
              <h3 className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
                Mã giảm giá & Voucher
              </h3>
              <div className="flex gap-2">
                <input
                  value={voucherInput}
                  onChange={(e) => {
                    setVoucherInput(e.target.value.toUpperCase());
                    if (voucherResult) setVoucherResult(null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") applyVoucher(); }}
                  placeholder="Nhập mã voucher"
                  className="min-w-0 flex-1 rounded-xl border border-sand px-3 py-2 text-xs sm:text-sm uppercase focus:outline-none focus:ring-2 focus:ring-lotus/30"
                />
                {voucherResult ? (
                  <button
                    type="button"
                    onClick={() => { setVoucherResult(null); setVoucherInput(""); }}
                    className="rounded-xl border border-sand px-3.5 py-2 text-xs font-semibold text-stone-600 hover:border-lotus hover:text-lotus transition"
                  >
                    Bỏ
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!voucherInput.trim() || voucherLoading}
                    onClick={() => applyVoucher()}
                    className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 hover:bg-stone-800 transition"
                  >
                    {voucherLoading ? "..." : "Áp dụng"}
                  </button>
                )}
              </div>
              {voucherError && <p className="mt-2 text-xs text-red-500">{voucherError}</p>}
              {voucherResult && (
                <div
                  className={`mt-2.5 rounded-xl border p-2.5 text-xs ${isUsingVoucher
                      ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                      : "border-amber-200 bg-amber-50/80 text-amber-900"
                    }`}
                >
                  {isUsingVoucher ? (
                    <p className="font-medium text-emerald-800">
                      ✓ Đã áp dụng mã “{voucherResult.voucher.name}” — giảm {formatVND(voucherDiscount)}
                      {memberDiscountAmount > 0 && " (mức ưu đãi cao hơn hạng thành viên)"}
                    </p>
                  ) : (
                    <p className="leading-relaxed">
                      ℹ Mã “{voucherResult.voucher.code}” giảm {formatVND(voucherDiscount)}, thấp hơn mức ưu đãi hạng {loyalty?.tier?.toUpperCase()} ({formatVND(memberDiscountAmount)}). Hệ thống tự động áp dụng mức ưu đãi tốt nhất cho bạn và bảo lưu mã voucher này.
                    </p>
                  )}
                </div>
              )}
              {!voucherResult && availableVouchers.length > 0 && (
                <div className="mt-3">
                  <span className="text-[11px] text-stone-400 block mb-1.5 font-medium">Voucher khả dụng:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {availableVouchers.slice(0, 4).map((v) => (
                      <button
                        key={v.code}
                        type="button"
                        onClick={() => applyVoucher(v.code)}
                        title={v.description ?? v.name}
                        className="rounded-lg border border-dashed border-lotus/40 bg-lotus/5 px-2.5 py-1 text-[11px] font-semibold text-lotus hover:bg-lotus/10 transition"
                      >
                        {v.code} ·{" "}
                        {v.discountType === "percentage" ? `-${v.discountValue}%` : `-${formatVND(v.discountValue)}`}
                        {v.minOrderValue > 0 ? ` (đơn từ ${formatVND(v.minOrderValue)})` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Khối 4: Tổng thanh toán cuối cùng ── */}
            <div className="mt-6 border-t-2 border-ink/10 pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <span className="font-bold text-ink text-base">Tổng thanh toán</span>
                  <span className="block text-[11px] text-stone-400 mt-0.5">
                    (Tiền thuê thực trả + Tiền cọc hoàn lại)
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-sans font-extrabold text-3xl sm:text-4xl text-lotus tracking-tight tabular-nums">
                    {formatVND(grandTotal)}
                  </span>
                </div>
              </div>

              {/* Tóm tắt phép tính công khai */}
              <div className="mt-3 rounded-lg bg-sand/20 px-3 py-2 text-[11px] text-stone-500 flex flex-wrap items-center justify-between gap-1">
                <span>Phân rã thanh toán:</span>
                <span className="tabular-nums font-medium text-stone-700">
                  Thuê {formatVND(Math.max(0, rentalTotal - effectiveDiscount))} + Cọc {formatVND(depositTotal)}
                  {shippingFee > 0 ? ` + Ship ${formatVND(shippingFee)}` : ""}
                </span>
              </div>

              {/* Điểm thưởng dự kiến (Estimated Points) */}
              {Math.floor(Math.max(0, rentalTotal - effectiveDiscount) * 0.001) > 0 && (
                <div className="mt-2.5 rounded-lg border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-950">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold text-amber-900">
                      <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>Điểm thưởng dự kiến:</span>
                    </span>
                    <span className="font-extrabold text-amber-700 text-sm">
                      +{Math.floor(Math.max(0, rentalTotal - effectiveDiscount) * 0.001).toLocaleString("vi-VN")} điểm
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-stone-500 leading-relaxed">
                    Điểm sẽ được ghi nhận sau khi thanh toán thành công và cộng vào ví sau khi bạn hoàn tất trả trang phục, kiểm tra cọc.
                  </p>
                </div>
              )}
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
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-sand p-4 transition hover:border-lotus has-[:checked]:border-lotus has-[:checked]:bg-[#fff0ee]">
                    <input type="radio" name="paymentMethod" value="cash" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} className="h-4 w-4 text-lotus focus:ring-lotus" />
                    <Banknote className="h-5 w-5 text-stone-500" />
                    <div>
                      <span className="text-sm font-medium text-ink">Tiền mặt</span>
                      <p className="text-xs text-stone-500">Thanh toán tại cửa hàng khi nhận đồ</p>
                    </div>
                  </label>
                )}
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-sand p-4 transition hover:border-lotus has-[:checked]:border-lotus has-[:checked]:bg-[#fff0ee]">
                  <input type="radio" name="paymentMethod" value="qr_code" checked={paymentMethod === "qr_code"} onChange={() => setPaymentMethod("qr_code")} className="h-4 w-4 text-lotus focus:ring-lotus" />
                  <QrCode className="h-5 w-5 text-stone-500" />
                  <div>
                    <span className="text-sm font-medium text-ink">Chuyển khoản (QR)</span>
                    <p className="text-xs text-stone-500">Quét mã QR để thanh toán qua ngân hàng</p>
                  </div>
                </label>
              </div>
            </div>

            {/* ── Khối Điều khoản sử dụng & Quy định bồi hoàn ── */}
            <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-amber-800">
                  Điều khoản sử dụng & Chính sách bồi thường
                </span>
              </div>
              <ul className="space-y-1.5 text-xs text-amber-900/85">
                {RENTAL_TERMS.map((term, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 leading-relaxed">
                    <span className="font-bold text-amber-700 shrink-0">•</span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-6 text-stone-700">
              <input
                className="mt-1 h-5 w-5 rounded border-sand text-lotus focus:ring-lotus shrink-0"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                Tôi đã đọc kỹ, hiểu rõ và đồng ý với <strong>Điều khoản sử dụng trang phục</strong> cùng <strong>Chính sách bồi thường theo % giá trị trang phục</strong> nếu phát sinh hư hại trong kỳ thuê.
              </span>
            </label>

            {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={`/booking/logistics?${backParams.toString()}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-bronze px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-bronze transition hover:bg-parchment"
              >
                <ArrowLeft className="h-4 w-4" />
                Quay lại vận chuyển
              </Link>
              <button
                type="button"
                disabled={!agreed || submitting || cartItems.length === 0 || (pickupMethod === "delivery" && !deliveryAddressId)}
                onClick={handleConfirm}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-sm transition hover:bg-oxblood disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>{submitting ? "Đang xử lý..." : `Xác nhận đặt lịch (${cartItems.length} món)`}</span>
                {!submitting && <ArrowRight className="h-4 w-4" />}
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
