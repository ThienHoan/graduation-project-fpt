"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Truck,
  Navigation,
  Clock,
  Phone,
  RotateCcw,
  CheckCircle2,
  PackageCheck,
  ShieldCheck,
  Play,
  Pause,
  MapPin,
  ExternalLink,
} from "lucide-react";
import { getMapTileConfig, fetchDirections } from "@/lib/map-config";

export type DeliveryTrackData = {
  bookingId: string;
  status: "preparing" | "in_transit" | "delivered";
  shipperLocationAvailable: boolean;
  storeLat: number;
  storeLng: number;
  customerLat: number;
  customerLng: number;
  deliveredAt: string | null;
  handoverConfirmed: boolean;
  customerName: string;
  customerAddress: string;
};

let cssInjected = false;

function injectCss() {
  if (cssInjected || typeof document === "undefined") return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
  link.crossOrigin = "";
  document.head.appendChild(link);
  cssInjected = true;
}

const STEPS = [
  { key: "preparing", label: "Đang chuẩn bị", desc: "Đóng gói & kiểm đếm cổ phục", icon: "📦" },
  { key: "in_transit", label: "Đang giao hàng", desc: "Tài xế đang trên đường tới", icon: "🛵" },
  { key: "delivered", label: "Đã giao đến nơi", desc: "Kiểm tra & nhận trang phục", icon: "✅" },
] as const;

export function DeliveryTracker({ data }: { data: DeliveryTrackData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const storeMarkerRef = useRef<any>(null);
  const customerMarkerRef = useRef<any>(null);
  const shipperMarkerRef = useRef<any>(null);
  const traveledPolylineRef = useRef<any>(null);
  const basePolylineRef = useRef<any>(null);
  const isMapReadyRef = useRef<boolean>(false);
  const hasFitBoundsRef = useRef<boolean>(false);

  const [mounted, setMounted] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [progress, setProgress] = useState<number>(() => (data.status === "delivered" ? 1 : data.status === "in_transit" ? 0.35 : 0));
  const [isSimulating, setIsSimulating] = useState<boolean>(data.status === "in_transit");
  const [simSpeed, setSimSpeed] = useState<number>(1); // 1x, 2x

  useEffect(() => setMounted(true), []);

  const currentIdx = STEPS.findIndex((s) => s.key === data.status);

  // 1. Lấy tuyến đường thực tế từ OSRM (OpenStreetMap Routing)
  useEffect(() => {
    let active = true;
    const { storeLat, storeLng, customerLat, customerLng } = data;

    async function fetchRoute() {
      const route = await fetchDirections(
        { lat: storeLat, lng: storeLng },
        { lat: customerLat, lng: customerLng },
      );
      if (active && route && route.coordinates.length > 0) {
        setRouteCoords(route.coordinates);
        setRouteInfo({
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
        });
        return;
      }

      // Tạo đường nội suy 40 điểm thẳng nếu OSRM không phản hồi
      if (active) {
        const fallback: [number, number][] = [];
        const STEPS_COUNT = 40;
        for (let i = 0; i <= STEPS_COUNT; i++) {
          const t = i / STEPS_COUNT;
          fallback.push([
            storeLat + (customerLat - storeLat) * t,
            storeLng + (customerLng - storeLng) * t,
          ]);
        }
        setRouteCoords(fallback);
        const approxDist = Number(
          (Math.hypot(customerLat - storeLat, customerLng - storeLng) * 111).toFixed(1),
        );
        setRouteInfo({
          distanceKm: approxDist || 2.4,
          durationMin: Math.max(5, Math.round((approxDist || 2.4) * 3)),
        });
      }
    }

    fetchRoute();
    return () => {
      active = false;
    };
  }, [data.storeLat, data.storeLng, data.customerLat, data.customerLng]);

  // 2. Render Leaflet Map & Markers ĐÚNG 1 LẦN DUY NHẤT (Single Instance, không recreate)
  useEffect(() => {
    if (!mounted || !containerRef.current || isMapReadyRef.current) return;
    let cancelled = false;

    async function initMap() {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || isMapReadyRef.current) return;

      const container = containerRef.current as any;
      if (container && container._leaflet_id) {
        container._leaflet_id = null;
      }

      const { storeLat, storeLng, customerLat, customerLng, customerName, customerAddress } = data;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView([storeLat, storeLng], 14);
      mapRef.current = map;

      const tileConfig = getMapTileConfig();
      L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom,
        subdomains: tileConfig.subdomains || "0123",
      }).addTo(map);

      // Điểm Cửa hàng (Atelier)
      const storeIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-9 h-9 rounded-full bg-[#8B0000] text-white flex items-center justify-center font-bold text-sm shadow-md border-2 border-white">
              🏛️
            </div>
            <div class="absolute -bottom-5 bg-stone-900/80 text-[10px] text-white font-semibold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              Atelier
            </div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        className: "",
      });

      const storeMarker = L.marker([storeLat, storeLng], { icon: storeIcon })
        .addTo(map)
        .bindPopup("<b>Cổ Phục Atelier</b><br>Kho trang phục xuất phát");
      storeMarkerRef.current = storeMarker;

      // Điểm Khách hàng
      const customerIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-9 h-9 rounded-full bg-[#1b4332] text-white flex items-center justify-center font-bold text-sm shadow-md border-2 border-white">
              📍
            </div>
            <div class="absolute -bottom-5 bg-stone-900/80 text-[10px] text-white font-semibold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              Khách nhận
            </div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        className: "",
      });

      const customerMarker = L.marker([customerLat, customerLng], { icon: customerIcon })
        .addTo(map)
        .bindPopup(`<b>${customerName}</b><br>${customerAddress}`);
      customerMarkerRef.current = customerMarker;

      // Đường đi toàn tuyến (Base Polyline - nét đứt xám)
      const basePoly = L.polyline([], {
        color: "#8B0000",
        weight: 4,
        opacity: 0.35,
        dashArray: "6 8",
      }).addTo(map);
      basePolylineRef.current = basePoly;

      // Đoạn đường đã di chuyển qua (Traveled Polyline - màu xanh ngọc liền nét)
      const traveledPoly = L.polyline([], {
        color: "#10b981",
        weight: 5,
        opacity: 0.9,
      }).addTo(map);
      traveledPolylineRef.current = traveledPoly;

      // Marker Shipper di chuyển - Dùng animate-pulse (opacity) thay vì animate-ping (scale) để chống rung giật Leaflet 3D layer
      const shipperIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center pointer-events-none">
            <div class="absolute -inset-1.5 rounded-full bg-emerald-400/40 animate-pulse"></div>
            <div class="relative w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg border-2 border-white text-base">
              🛵
            </div>
            <div class="absolute -top-6 bg-emerald-700 text-[10px] text-white font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
              Shipper
            </div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        className: "",
      });

      const shipperMarker = L.marker([storeLat, storeLng], { icon: shipperIcon, zIndexOffset: 1000 }).addTo(map);
      shipperMarkerRef.current = shipperMarker;

      isMapReadyRef.current = true;
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        isMapReadyRef.current = false;
        hasFitBoundsRef.current = false;
      }
    };
  }, [mounted]);

  // 3. Cập nhật lộ trình đường phố & Fit Bounds một lần duy nhất khi có routeCoords
  useEffect(() => {
    if (!isMapReadyRef.current || !routeCoords.length || !mapRef.current) return;

    if (basePolylineRef.current) {
      basePolylineRef.current.setLatLngs(routeCoords);
    }

    const currentShipperPos = routeCoords[Math.floor((routeCoords.length - 1) * progress)] || routeCoords[0];
    if (shipperMarkerRef.current && currentShipperPos) {
      shipperMarkerRef.current.setLatLng(currentShipperPos);
    }

    if (!hasFitBoundsRef.current) {
      import("leaflet").then((L) => {
        if (!mapRef.current) return;
        const bounds = L.default.latLngBounds(routeCoords);
        mapRef.current.fitBounds(bounds.pad(0.18), { animate: false });
        hasFitBoundsRef.current = true;
      });
    }
  }, [routeCoords]);

  // 4. Đồng bộ vị trí Marker Shipper và Polylines theo Progress (mượt mà, không giật màn hình)
  useEffect(() => {
    if (!routeCoords.length || !shipperMarkerRef.current || !traveledPolylineRef.current) return;

    const targetIdx = Math.min(
      routeCoords.length - 1,
      Math.floor((routeCoords.length - 1) * progress),
    );
    const currentCoord = routeCoords[targetIdx];

    if (currentCoord) {
      shipperMarkerRef.current.setLatLng(currentCoord);
      const traveled = routeCoords.slice(0, targetIdx + 1);
      traveledPolylineRef.current.setLatLngs(traveled);
    }
  }, [progress, routeCoords]);

  // 5. Tiến trình mô phỏng di chuyển mượt mà dọc theo OSRM Route
  useEffect(() => {
    if (!isSimulating || !routeCoords.length || data.status === "preparing") return;

    const intervalTime = 600 / simSpeed; // Tốc độ cập nhật
    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev + 0.012 * simSpeed;
        if (next >= 1) {
          clearInterval(timer);
          setIsSimulating(false);
          return 1;
        }
        return next;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isSimulating, routeCoords.length, simSpeed, data.status]);

  // 4. Đồng bộ vị trí Marker Shipper và Polylines theo Progress
  useEffect(() => {
    if (!routeCoords.length || !shipperMarkerRef.current || !traveledPolylineRef.current) return;

    const targetIdx = Math.min(
      routeCoords.length - 1,
      Math.floor((routeCoords.length - 1) * progress),
    );
    const currentCoord = routeCoords[targetIdx];

    if (currentCoord) {
      shipperMarkerRef.current.setLatLng(currentCoord);
      const traveled = routeCoords.slice(0, targetIdx + 1);
      traveledPolylineRef.current.setLatLngs(traveled);
    }
  }, [progress, routeCoords]);

  // Tính khoảng cách và thời gian còn lại động
  const remainingTelemetry = useMemo(() => {
    if (!routeInfo) return { km: "—", min: "—", speed: 30 };
    const leftRatio = Math.max(0, 1 - progress);
    const leftKm = (routeInfo.distanceKm * leftRatio).toFixed(1);
    const leftMin = Math.max(1, Math.round(routeInfo.durationMin * leftRatio));
    return {
      km: leftRatio === 0 ? "0 km" : `${leftKm} km`,
      min: leftRatio === 0 ? "Đã đến" : `~${leftMin} phút`,
      speed: leftRatio === 0 ? 0 : 32,
    };
  }, [progress, routeInfo]);

  // Nút tua / Chạy lại mô phỏng
  const handleReplay = useCallback(() => {
    setProgress(0);
    setIsSimulating(true);
  }, []);

  return (
    <div className="space-y-4">
      {/* 1. Thanh Tiến Trình 3 Bước */}
      <div className="rounded-2xl border border-sand bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => {
            const done = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            return (
              <div key={step.key} className="flex flex-col items-center flex-1 text-center px-1">
                <div
                  className={`relative w-12 h-12 rounded-2xl flex items-center justify-center text-xl border-2 transition-all duration-300 ${
                    done
                      ? isCurrent
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-md scale-105"
                        : "border-jade bg-jade/10 text-jade"
                      : "border-stone-200 bg-stone-50 text-stone-300"
                  }`}
                >
                  {step.icon}
                  {isCurrent && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                  )}
                </div>
                <span className={`text-xs sm:text-sm mt-2 font-bold ${done ? "text-ink" : "text-stone-400"}`}>
                  {step.label}
                </span>
                <span className="hidden sm:block text-[11px] text-stone-500 mt-0.5 max-w-[120px]">
                  {step.desc}
                </span>
              </div>
            );
          })}
        </div>

        {/* Thanh kết nối chuyển màu mượt mà */}
        <div className="flex items-center mt-3 px-6">
          <div className="flex-1 h-1.5 rounded-full bg-jade" />
          <div
            className={`flex-1 h-1.5 rounded-full transition-colors duration-500 ${
              currentIdx >= 1 ? "bg-jade" : "bg-stone-200"
            }`}
          />
        </div>

        {data.deliveredAt && (
          <p className="text-xs text-stone-500 mt-3 text-center">
            Đã bàn giao lúc: <span className="font-semibold text-ink">{new Date(data.deliveredAt).toLocaleString("vi-VN")}</span>
          </p>
        )}
        {data.handoverConfirmed && (
          <p className="text-xs text-jade mt-1 text-center font-semibold flex items-center justify-center gap-1">
            <CheckCircle2 className="h-4 w-4" /> Khách hàng đã ký nhận bàn giao y phục
          </p>
        )}
      </div>

      {/* 2. Thẻ Thông Tin Tài Xế & Đo Lường Trực Tiếp (Telemetry Grab / Shopee Style) */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Thông tin Shipper */}
        <div className="sm:col-span-2 rounded-2xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-stone-100 border border-sand flex items-center justify-center text-xl">
                👨‍✈️
              </div>
              <span className="absolute -bottom-1 -right-1 rounded-full bg-emerald-500 p-0.5 text-white">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-ink text-sm sm:text-base truncate">Nguyễn Văn Hưng</h4>
                <span className="rounded bg-amber-50 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 border border-amber-200">
                  4.9 ★ (120+ chuyến)
                </span>
              </div>
              <p className="text-xs text-stone-500 truncate mt-0.5">
                Xe máy: <span className="font-semibold text-ink">Honda Air Blade · 29E1-886.92</span>
              </p>
              <p className="text-[11px] text-emerald-700 font-medium flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Tài xế chuyên trách vận chuyển cổ phục bảo quản cao cấp
              </p>
            </div>
          </div>

          <a
            href="tel:0988776655"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-lotus/10 text-lotus hover:bg-lotus hover:text-white transition font-semibold text-xs border border-lotus/20 active:scale-95"
            title="Gọi cho tài xế"
          >
            <Phone className="h-4 w-4" />
            <span className="hidden md:inline">Liên hệ</span>
          </a>
        </div>

        {/* Thông số quãng đường & thời gian thực tế */}
        <div className="rounded-2xl border border-sand bg-gradient-to-br from-stone-900 to-stone-800 text-white p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-stone-300">
            <span className="flex items-center gap-1 font-medium">
              <Clock className="h-3.5 w-3.5 text-emerald-400" /> Dự kiến đến
            </span>
            <span className="text-[11px] bg-white/10 px-2 py-0.5 rounded text-emerald-300 font-mono">
              GPS Trực tiếp
            </span>
          </div>

          <div className="my-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-bold tracking-tight text-white">{remainingTelemetry.min}</span>
              <p className="text-xs text-stone-400">còn lại {remainingTelemetry.km}</p>
            </div>
            <div className="text-right">
              <span className="font-mono text-sm text-stone-300">{remainingTelemetry.speed} km/h</span>
              <p className="text-[10px] text-stone-400">Tốc độ xe</p>
            </div>
          </div>

          <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-400 h-full transition-all duration-300 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 3. Bản Đồ Leaflet Với Lộ Trình Phố OSRM */}
      <div className="relative rounded-2xl overflow-hidden border border-sand shadow-sm bg-white">
        {/* Nút điều khiển mô phỏng nổi trên bản đồ */}
        <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-sand/80 shadow-md text-xs font-semibold text-stone-700">
          <button
            type="button"
            onClick={() => setIsSimulating(!isSimulating)}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-mist transition text-ink"
            title={isSimulating ? "Tạm dừng" : "Tiếp tục chạy"}
          >
            {isSimulating ? <Pause className="h-3.5 w-3.5 text-amber-600" /> : <Play className="h-3.5 w-3.5 text-emerald-600" />}
            <span>{isSimulating ? "Tạm dừng" : "Tiếp tục"}</span>
          </button>

          <span className="text-stone-300">|</span>

          <button
            type="button"
            onClick={() => setSimSpeed(simSpeed === 1 ? 2 : 1)}
            className="px-2 py-1 rounded-md hover:bg-mist transition text-xs font-mono text-lotus"
            title="Đổi tốc độ mô phỏng"
          >
            {simSpeed}x
          </button>

          <span className="text-stone-300">|</span>

          <button
            type="button"
            onClick={handleReplay}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-mist transition text-stone-600 hover:text-lotus"
            title="Chạy lại từ đầu"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Mô phỏng lại</span>
          </button>
        </div>

        {/* Legend chú thích nhỏ góc trái dưới bản đồ */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur-md px-3 py-2 rounded-xl border border-sand/80 shadow text-[11px] text-stone-600 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-1 bg-[#10b981] rounded-full"></span>
            <span>Đoạn đã đi qua ({Math.round(progress * 100)}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-1 border-t-2 border-dashed border-[#8B0000]"></span>
            <span>Lộ trình đường phố thực tế (OSRM)</span>
          </div>
        </div>

        {/* Container hiển thị Leaflet */}
        <div ref={containerRef} className="h-80 w-full" style={{ minHeight: 320 }} />
      </div>

      {/* 4. Địa Chỉ Giao Nhận Chi Tiết */}
      <div className="rounded-2xl border border-sand bg-white p-4 text-xs text-stone-600 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="h-4 w-4 text-lotus shrink-0" />
          <span className="truncate">
            Điểm nhận: <b className="text-ink">{data.customerAddress}</b>
          </span>
        </div>
        <div className="flex items-center gap-2 text-stone-400">
          <span>Mã đơn: #{data.bookingId.slice(0, 8).toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}
