"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BookingFlowShell } from "@/components/heritage/ui";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { checkAvailability } from "@/lib/api";
import { RentalDateCalendar } from "@/components/customer/rental-date-calendar";
import { getCart, removeFromCart, getCartSummary, type CartItem } from "@/lib/cart";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function daysBetween(start: string, end: string) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.round((e - s) / 86400000) + 1;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// Trang booking không chặn ngày theo tồn kho: khách chọn ngày tự do,
// món nào hết hàng sẽ báo đỏ từng món để khách loại ra.
const EMPTY_BOOKED_DATES: Set<string> = new Set();

type ItemAvail = {
  garmentSizeId: string;
  name: string;
  available: boolean;
  availableCount?: number;
  totalAssets?: number;
  checking: boolean;
};

function BookingDateSelectionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const today = todayIso();
  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? today);
  const [endDate, setEndDate] = useState(searchParams.get("endDate") ?? today);
  const [availMap, setAvailMap] = useState<Record<string, ItemAvail>>({});
  const [allChecked, setAllChecked] = useState(false);
  const availabilityRequestRef = useRef(0);
  const maxDate = useMemo(() => addDays(today, 365), [today]);

  // Load cart
  useEffect(() => {
    const items = getCart();
    setCartItems(items);
  }, []);

  // Check availability for all cart items
  useEffect(() => {
    const requestId = ++availabilityRequestRef.current;
    if (cartItems.length === 0 || !startDate || !endDate || endDate < startDate) {
      setAllChecked(false);
      setAvailMap({});
      return;
    }

    const initMap: Record<string, ItemAvail> = {};
    cartItems.forEach((item) => {
      initMap[item.garmentSizeId] = {
        garmentSizeId: item.garmentSizeId,
        name: item.name,
        available: false,
        checking: true,
      };
    });
    setAvailMap(initMap);
    setAllChecked(false);

    Promise.all(
      cartItems.map((item) =>
        checkAvailability(item.garmentSizeId, startDate, endDate).then((res) => ({
          garmentSizeId: item.garmentSizeId,
          name: item.name,
          available: res.success && (res.data?.available ?? false),
          availableCount: res.data?.availableCount,
          totalAssets: res.data?.totalAssets,
          checking: false,
        })),
      ),
    ).then((results) => {
      if (requestId !== availabilityRequestRef.current) return;
      const map: Record<string, ItemAvail> = {};
      results.forEach((r) => (map[r.garmentSizeId] = r));
      setAvailMap(map);
      setAllChecked(true);
    }).catch(() => {
      if (requestId !== availabilityRequestRef.current) return;
      setAllChecked(true);
    });
  }, [cartItems, startDate, endDate]);

  const days = startDate && endDate && endDate >= startDate ? daysBetween(startDate, endDate) : 0;
  const summary = getCartSummary();
  const rentalTotal = summary.rentalTotal * days;
  const depositTotal = summary.depositTotal;
  const allAvailable = cartItems.length > 0 && allChecked && cartItems.every((item) => availMap[item.garmentSizeId]?.available);
  const anyNotAvailable = allChecked && !allAvailable;

  function handleRemove(garmentId: string) {
    removeFromCart(garmentId);
    setCartItems(getCart());
  }

  function handleContinue() {
    const params = new URLSearchParams({ startDate, endDate });
    router.push(`/booking/logistics?${params.toString()}`);
  }

  if (cartItems.length === 0) {
    return (
      <BookingFlowShell
        currentStep="schedule"
        title="Giỏ hàng trống"
        description="Bạn chưa có món nào trong giỏ thuê."
      >
        <div className="py-20 text-center">
          <span className="material-symbols-outlined text-6xl text-stone-200 mb-6 block">shopping_bag</span>
          <h2 className="font-display text-3xl text-ink mb-3">Giỏ hàng trống</h2>
          <p className="text-stone-500 mb-8 max-w-md mx-auto">
            Bạn chưa thêm trang phục nào vào giỏ. Hãy quay lại bộ sưu tập để chọn trang phục bạn muốn thuê.
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
      currentStep="schedule"
      title="Chọn ngày thuê"
      description="Tất cả món trong giỏ sẽ được thuê chung 1 khoảng ngày cho cùng 1 dịp. Nếu bạn cần thuê cho nhiều dịp khác nhau, vui lòng tạo các đơn riêng."
    >
      <div className="grid gap-8 xl:grid-cols-12">
        {/* Cart items list */}
        <section className="xl:col-span-5">
          <div className="rounded-xl border border-sand bg-white shadow-md">
            <div className="border-b border-sand px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-xl text-ink">Giỏ thuê ({cartItems.length})</h2>
              <Link href="/catalog" className="text-xs text-lotus hover:underline">+ Thêm món</Link>
            </div>
            <div className="divide-y divide-sand">
              {cartItems.map((item) => {
                const av = availMap[item.garmentSizeId];
                return (
                  <div key={item.garmentSizeId} className="flex items-start gap-4 p-4">
                    <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-lotus/10">
                      <span className="material-symbols-outlined text-2xl text-antique/50">checkroom</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink text-sm">{item.name}</p>
                      <p className="text-xs text-stone-500">
                        {item.sizeLabel ? `Size ${item.sizeLabel} · ` : ""}
                        {formatVND(item.dailyPrice)}/ngày · Cọc {formatVND(item.depositAmount)}
                      </p>
                      {av && !av.checking && (
                        <p className={`mt-1 text-xs font-medium ${av.available ? "text-jade" : "text-red-500"}`}>
                          {av.available
                            ? `✓ Còn ${av.availableCount ?? "?"}/${av.totalAssets ?? "?"}`
                            : "✗ Hết hàng trong khoảng này"}
                        </p>
                      )}
                      {av?.checking && <p className="mt-1 text-xs text-stone-400">Đang kiểm tra...</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(item.garmentSizeId)}
                      className="shrink-0 text-xs text-red-400 hover:text-red-600 mt-1"
                    >
                      Xoá
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Date picker + summary */}
        <section className="space-y-8 xl:col-span-7">
          <div className="rounded-xl border border-sand bg-white p-6 shadow-md sm:p-8">
            <h2 className="mb-6 font-display text-3xl text-lotus">Chọn khoảng ngày thuê</h2>

            <div className="rounded-xl border border-sand bg-white p-4 sm:p-5">
              <RentalDateCalendar
                startDate={startDate}
                endDate={endDate}
                minDate={today}
                maxDate={maxDate}
                fullyBookedDates={EMPTY_BOOKED_DATES}
                onChange={(s, e) => {
                  setStartDate(s);
                  setEndDate(e);
                }}
              />
              <p className="mt-3 text-center text-sm text-stone-600">
                Nhận: <span className="font-semibold text-ink">{formatDate(startDate)}</span>
                {" → "}
                Trả: <span className="font-semibold text-ink">{formatDate(endDate)}</span>
              </p>
              <p className="mt-1 text-center text-xs text-stone-400">
                Cứ chọn ngày thuê bạn muốn. Món hết hàng sẽ được đánh dấu đỏ để bạn dễ dàng loại khỏi giỏ.
              </p>
            </div>

            {allAvailable && (
              <div className="mt-4 rounded-lg border border-jade/30 bg-jade/5 p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-jade text-[22px] mt-0.5">check_circle</span>
                  <div>
                    <p className="font-semibold text-jade">Tất cả {cartItems.length} món đều khả dụng cho khoảng ngày này</p>
                    <p className="mt-1 text-sm text-stone-500">
                      📌 Tất cả món trong giỏ sẽ được thuê cùng 1 khoảng ngày cho cùng 1 dịp.
                      Nếu bạn cần thuê cho nhiều dịp khác nhau, vui lòng tạo các đơn riêng sau khi hoàn tất đơn này.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {anyNotAvailable && (
              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-red-500 text-[18px]">cancel</span>
                <span className="font-medium text-red-500">Một số món không khả dụng trong khoảng này</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-sand bg-white p-6 shadow-md sm:p-8">
            <h3 className="font-display text-3xl text-ink">Tóm tắt chi phí</h3>
            <div className="mt-6 space-y-3 text-sm">
              {cartItems.map((item) => (
                <div key={item.garmentSizeId} className="flex items-center justify-between text-stone-500">
                  <span>{item.name}</span>
                  <span>{days > 0 ? formatVND(item.dailyPrice * days) : "—"}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-sand pt-3">
                <span className="text-stone-500">Khoảng ngày</span>
                <span className="font-medium text-ink">
                  {startDate && endDate && endDate >= startDate
                    ? `${formatDate(startDate)} - ${formatDate(endDate)} (${days} ngày)`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Tiền thuê</span>
                <span className="font-medium text-ink">{days > 0 ? formatVND(rentalTotal) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Tiền cọc</span>
                <span className="font-medium text-ink">{formatVND(depositTotal)}</span>
              </div>
              <div className="flex items-end justify-between border-t border-sand pt-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Tổng cần thanh toán</p>
                  <p className="text-xs text-stone-500">Bao gồm cọc</p>
                </div>
                <span className="font-display text-3xl text-lotus">
                  {days > 0 ? formatVND(rentalTotal + depositTotal) : "—"}
                </span>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/catalog"
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-bronze px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-bronze transition hover:bg-parchment"
              >
                Thêm món khác
              </Link>
              <button
                type="button" disabled={!allAvailable}
                onClick={handleContinue}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-oxblood disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sang bước vận chuyển
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </BookingFlowShell>
  );
}

export default function BookingDateSelectionPage() {
  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink">
      <CustomerNavbar />
      <Suspense>
        <BookingDateSelectionInner />
      </Suspense>
      <CustomerFooter />
    </div>
  );
}
