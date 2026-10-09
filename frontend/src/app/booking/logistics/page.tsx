"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BookingFlowShell } from "@/components/heritage/ui";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { apiRequest, getShippingFee, getStoreInfo, normalizePickupMethod, type PickupMethod, type ShippingFeeEstimate, type StoreInfo } from "@/lib/api";
import { logisticsMethods } from "@/lib/heritage-mock-data";
import { ShippingMap } from "@/components/location/shipping-map";

export type CustomerAddress = {
  id: string;
  receiverName: string;
  phone: string;
  line1: string;
  ward: string | null;
  district: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
};

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatAddress(address: CustomerAddress) {
  return [address.line1, address.ward, address.district, address.city].filter(Boolean).join(", ");
}

function BookingLogisticsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";

  const requestedPickupMethod = normalizePickupMethod(searchParams.get("pickupMethod"));
  const hasInvalidPickupMethod = searchParams.has("pickupMethod") && requestedPickupMethod === null;
  const isInvalid = !startDate || !endDate || endDate < startDate || hasInvalidPickupMethod;
  const [pickupMethod, setPickupMethod] = useState<PickupMethod>(requestedPickupMethod ?? "store_pickup");

  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string>(searchParams.get("deliveryAddressId") ?? "");

  const [shippingFee, setShippingFee] = useState<ShippingFeeEstimate | null>(null);
  const [shippingFeeLoading, setShippingFeeLoading] = useState(false);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);

  useEffect(() => {
    getStoreInfo().then((res) => {
      if (res.success && res.data) setStoreInfo(res.data);
    });
  }, []);

  const loadAddresses = useCallback(async () => {
    setAddressLoading(true);
    const result = await apiRequest<CustomerAddress[]>("/users/me/addresses");
    const list = result.success && result.data ? result.data : [];
    setAddresses(list);
    setAddressLoading(false);

    setSelectedAddressId((current) => {
      if (current) {
        const exists = list.some((a) => a.id === current);
        if (exists) return current;
      }
      const defaultAddress = list.find((a) => a.isDefault) ?? list[0];
      return defaultAddress?.id ?? "";
    });
  }, []);

  useEffect(() => {
    if (pickupMethod === "delivery") {
      void loadAddresses();
    }
  }, [loadAddresses, pickupMethod]);

  useEffect(() => {
    if (pickupMethod !== "delivery" || !selectedAddressId) {
      setShippingFee(null);
      return;
    }
    setShippingFeeLoading(true);
    getShippingFee(selectedAddressId)
      .then((res) => {
        if (res.success && res.data) {
          setShippingFee(res.data);
        } else {
          setShippingFee(null);
        }
      })
      .catch(() => {
        setShippingFee(null);
      })
      .finally(() => setShippingFeeLoading(false));
  }, [pickupMethod, selectedAddressId]);

  function handleContinue() {
    if (pickupMethod === "delivery" && !selectedAddressId) return;
    const selectedAddress = addresses.find((a) => a.id === selectedAddressId);
    const params = new URLSearchParams({ startDate, endDate, pickupMethod });
    if (pickupMethod === "delivery" && selectedAddress) {
      params.set("deliveryAddressId", selectedAddress.id);
    }
    if (shippingFee) {
      params.set("shippingFee", String(shippingFee.estimatedFee));
    }
    router.push(`/booking/review?${params.toString()}`);
  }

  const backParams = new URLSearchParams({ startDate, endDate });

  if (isInvalid) {
    return (
      <BookingFlowShell currentStep="logistics" title="Phương thức vận chuyển" description="">
        <div className="py-20 text-center text-stone-500">
          <p>Thông tin đặt lịch không hợp lệ. Vui lòng <Link href="/catalog" className="text-lotus underline">chọn lại trang phục</Link>.</p>
        </div>
      </BookingFlowShell>
    );
  }

  return (
    <BookingFlowShell
      currentStep="logistics"
      title="Phương thức vận chuyển"
      description="Xác nhận cách nhận đồ và địa điểm bàn giao trước khi sang bước kiểm tra đơn."
    >
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-8">
          <section className="rounded-xl border border-sand bg-white p-6 shadow-md">
            <div className="mb-4 flex items-start justify-between gap-4 border-b border-sand pb-4">
              <div>
                <h2 className="flex items-center gap-2 font-display text-3xl text-ink">
                  <span className="material-symbols-outlined text-jade">check_circle</span>Đã xác nhận lịch
                </h2>
                <p className="mt-1 text-sm text-stone-600">Trang phục còn trống cho khoảng thời gian bạn đã chọn.</p>
              </div>
              <span className="rounded-full bg-jade/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-jade">Có thể giữ lịch</span>
            </div>
            <div className="text-sm text-stone-600">
              <p>Thời gian thuê: <span className="font-medium text-ink">{startDate && endDate ? `${formatDate(startDate)} - ${formatDate(endDate)}` : "—"}</span></p>
            </div>
          </section>

          <section>
            <h2 className="mb-4 font-display text-3xl text-lotus">Phương thức nhận đồ</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {logisticsMethods.map((item) => (
                <label key={item.key} className="cursor-pointer">
                  <input
                    className="peer sr-only"
                    checked={pickupMethod === item.key}
                    name="delivery_method"
                    type="radio"
                    onChange={() => setPickupMethod(normalizePickupMethod(item.key) ?? "store_pickup")}
                  />
                  <div className="h-full rounded-xl border border-sand bg-white p-5 transition peer-checked:border-antique peer-checked:bg-parchment hover:border-antique/60">
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mist text-bronze">
                        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                      </div>
                      <span className={`material-symbols-outlined ${pickupMethod === item.key ? "text-antique" : "text-stone-300"}`}>check_circle</span>
                    </div>
                    <h3 className="font-semibold text-ink">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-stone-600">{item.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {pickupMethod === "delivery" ? (
            <section className="rounded-xl border border-sand bg-white p-6 shadow-md">
              <h2 className="mb-4 font-display text-3xl text-lotus">Địa chỉ giao nhận</h2>
              {addressLoading ? (
                <p className="text-sm text-stone-500">Đang tải địa chỉ...</p>
              ) : addresses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-sand p-8 text-center">
                  <span className="material-symbols-outlined text-4xl text-stone-300">location_off</span>
                  <p className="mt-3 text-sm text-stone-500">Bạn chưa có địa chỉ nhận đồ nào.</p>
                  <Link
                    href="/dashboard/customer/addresses"
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-lotus px-5 py-3 text-sm font-semibold text-white transition hover:bg-oxblood"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_location</span>
                    Thêm địa chỉ nhận đồ
                  </Link>
                </div>
              ) : (
                <>
                  <p className="mb-4 text-sm leading-7 text-stone-600">Chọn một địa chỉ đã lưu trong hồ sơ của bạn để giao nhận trang phục.</p>
                  <div className="space-y-3">
                    {addresses.map((address) => (
                      <label
                        key={address.id}
                        className={`cursor-pointer block rounded-xl border p-4 transition ${
                          selectedAddressId === address.id
                            ? "border-antique bg-parchment"
                            : "border-sand bg-white hover:border-antique/60"
                        }`}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="deliveryAddress"
                          checked={selectedAddressId === address.id}
                          onChange={() => setSelectedAddressId(address.id)}
                        />
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-ink">{address.receiverName}</span>
                              {address.isDefault ? (
                                <span className="rounded-full bg-lotus/10 px-2 py-0.5 text-[10px] font-bold uppercase text-oxblood">Mặc định</span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-stone-600">{address.phone}</p>
                            <p className="mt-1 text-sm leading-relaxed text-stone-600">{formatAddress(address)}</p>
                          </div>
                          <span className={`material-symbols-outlined mt-1 ${selectedAddressId === address.id ? "text-antique" : "text-stone-300"}`}>
                            {selectedAddressId === address.id ? "radio_button_checked" : "radio_button_unchecked"}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <Link
                    href="/dashboard/customer/addresses"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-lotus transition hover:underline"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Thêm địa chỉ khác
                  </Link>

                  {shippingFeeLoading ? (
                    <p className="mt-4 text-sm text-stone-500">Đang tính phí giao hàng...</p>
                  ) : shippingFee ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-antique/40 bg-antique/10 p-4">
                        <p className="text-sm font-semibold text-bronze">
                          Phí giao hàng ước tính:{" "}
                          {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(shippingFee.estimatedFee)}
                        </p>
                        <p className="mt-1 text-xs text-stone-600">
                          Tuyến {shippingFee.routeLabel} (Viettel Post) · Giao dự kiến {shippingFee.deliveryTimeText}
                        </p>
                        <p className="mt-1 text-xs text-stone-600">Khoảng cách: {shippingFee.distanceText}</p>
                      </div>
                      {shippingFee.storeLat && shippingFee.customerLat && (
                        <ShippingMap
                          storeLat={shippingFee.storeLat}
                          storeLng={shippingFee.storeLng}
                          customerLat={shippingFee.customerLat}
                          customerLng={shippingFee.customerLng}
                          distanceText={shippingFee.distanceText}
                        />
                      )}
                    </div>
                  ) : selectedAddressId ? (
                    <p className="mt-4 text-sm text-red-500">Không thể tính phí giao hàng. Vui lòng thử lại sau.</p>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          <section className="rounded-xl border border-sand bg-parchment p-6">
            <h2 className="font-display text-3xl text-ink">Địa điểm nhận tại atelier</h2>
            <p className="mt-1 text-sm text-stone-600">Vui lòng đến trong khung giờ làm việc để thử và nhận bộ đồ.</p>
            <div className="mt-5 flex items-start gap-4 rounded-lg border border-sand bg-white p-4">
              <span className="material-symbols-outlined mt-1 text-antique">location_on</span>
              <div>
                <h3 className="font-semibold text-ink">{storeInfo?.name ?? "Heritage Atelier"}</h3>
                <p className="mt-1 text-sm leading-7 text-stone-600">{storeInfo?.address ?? "123 Silk Road, Quận 1, TP. Hồ Chí Minh"}</p>
                <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.16em] text-bronze">
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">schedule</span>{storeInfo?.businessHours ?? "09:00 - 20:00"}</span>
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">call</span>{storeInfo?.phone ?? "+84 28 3822 0000"}</span>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4 border-t border-sand pt-8 sm:flex-row sm:justify-between">
            <Link
              href={`/booking/date-selection?${backParams.toString()}`}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-bronze px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-bronze transition hover:bg-parchment"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Quay lại lịch thuê
            </Link>
            <button
              type="button"
              onClick={handleContinue}
              disabled={pickupMethod === "delivery" && !selectedAddressId}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-lotus px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sang bước kiểm tra đơn
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          <section className="rounded-xl border border-sand bg-white/90 p-6 shadow-md backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-lotus/10 text-lotus">
                <span className="material-symbols-outlined text-[18px]">diamond</span>
              </div>
              <h2 className="font-display text-2xl text-ink">Chăm sóc & tiền cọc</h2>
            </div>
            <ul className="space-y-3 text-sm leading-7 text-stone-600">
              <li className="flex gap-2"><span className="material-symbols-outlined text-antique">shield</span><span>Tiền cọc sẽ được áp vào bước xác nhận cuối cùng.</span></li>
              <li className="flex gap-2"><span className="material-symbols-outlined text-antique">dry_cleaning</span><span>Không tự giặt hoặc hấp sấy. Atelier phụ trách làm sạch.</span></li>
              <li className="flex gap-2"><span className="material-symbols-outlined text-antique">policy</span><span>Hoàn cọc sau khi nhân viên kiểm tra tình trạng bộ đồ khi trả.</span></li>
            </ul>
          </section>
        </aside>
      </div>
    </BookingFlowShell>
  );
}

export default function BookingLogisticsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink">
      <CustomerNavbar />
      <Suspense>
        <BookingLogisticsInner />
      </Suspense>
      <CustomerFooter />
    </div>
  );
}
