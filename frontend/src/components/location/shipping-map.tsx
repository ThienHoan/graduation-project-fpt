"use client";

import { useEffect, useRef, useState } from "react";
import { getMapTileConfig, fetchDirections } from "@/lib/map-config";
import { Truck, Navigation, CheckCircle2, ShieldCheck } from "lucide-react";

type ShippingMapProps = {
  storeLat: number;
  storeLng: number;
  customerLat: number;
  customerLng: number;
  storeName?: string;
  distanceText?: string;
};

let leafletCssInjected = false;

function injectLeafletCss() {
  if (leafletCssInjected || typeof document === "undefined") return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
  link.crossOrigin = "";
  document.head.appendChild(link);
  leafletCssInjected = true;
}

export function ShippingMap({
  storeLat,
  storeLng,
  customerLat,
  customerLng,
  storeName = "Atelier Cổ Phục",
  distanceText,
}: ShippingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [roadInfo, setRoadInfo] = useState<{
    distanceKm: number;
    durationHours?: number;
    isRealRoute: boolean;
  } | null>(null);

  useEffect(() => {
    injectLeafletCss();
    let cancelled = false;

    async function render() {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      // Clean up previous map instance
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const container = containerRef.current as any;
      if (container && container._leaflet_id) {
        container._leaflet_id = null;
      }

      const centerLat = (storeLat + customerLat) / 2;
      const centerLng = (storeLng + customerLng) / 2;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView([centerLat, centerLng], 12);
      mapRef.current = map;

      const tileConfig = getMapTileConfig();
      L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom,
        subdomains: tileConfig.subdomains || "0123",
      }).addTo(map);

      // Điểm xuất kho (Atelier)
      const storeIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-8 h-8 rounded-full bg-[#8B0000] text-white flex items-center justify-center font-bold text-sm shadow-md border-2 border-white ring-2 ring-[#8B0000]/30">
              🏛️
            </div>
            <div class="absolute -bottom-5 bg-stone-900/90 text-[10px] text-white font-medium px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              Atelier
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        className: "",
      });
      L.marker([storeLat, storeLng], { icon: storeIcon })
        .addTo(map)
        .bindPopup(`<b>${storeName}</b><br><span class="text-xs text-stone-600">Điểm xuất kho & đóng gói bảo quản</span>`);

      // Điểm nhận hàng của khách
      const customerIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md border-2 border-white ring-2 ring-emerald-500/30">
              📍
            </div>
            <div class="absolute -bottom-5 bg-stone-900/90 text-[10px] text-white font-medium px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              Điểm nhận
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        className: "",
      });
      L.marker([customerLat, customerLng], { icon: customerIcon })
        .addTo(map)
        .bindPopup('<b>Địa chỉ của bạn</b><br><span class="text-xs text-stone-600">Điểm giao nhận trang phục tận nơi</span>');

      // 3. Lấy lộ trình đường bộ thực tế (Goong Direction / OSRM)
      try {
        const routeData = await fetchDirections(
          { lat: storeLat, lng: storeLng },
          { lat: customerLat, lng: customerLng },
        );

        if (cancelled) return;

        if (routeData && routeData.coordinates.length > 1) {
          // Glow hiệu ứng đường đi
          L.polyline(routeData.coordinates, {
            color: "#10b981",
            weight: 7,
            opacity: 0.3,
            lineJoin: "round",
          }).addTo(map);

          // Tuyến đường bộ chính thức
          const routeLine = L.polyline(routeData.coordinates, {
            color: "#059669",
            weight: 3.5,
            opacity: 0.9,
            lineJoin: "round",
          }).addTo(map);

          map.fitBounds(routeLine.getBounds().pad(0.2));
          setRoadInfo({
            distanceKm: routeData.distanceKm,
            durationHours: Math.round((routeData.durationMin / 60) * 10) / 10,
            isRealRoute: true,
          });
        } else {
          // Fallback đường chim bay có style uốn cong nhẹ
          const straightLine = L.polyline(
            [
              [storeLat, storeLng],
              [customerLat, customerLng],
            ],
            { color: "#8B0000", weight: 3, opacity: 0.7, dashArray: "6 6" },
          ).addTo(map);
          map.fitBounds(straightLine.getBounds().pad(0.3));
          setRoadInfo({
            distanceKm: parseFloat(distanceText || "0") || 0,
            isRealRoute: false,
          });
        }
      } catch {
        const straightLine = L.polyline(
          [
            [storeLat, storeLng],
            [customerLat, customerLng],
          ],
          { color: "#8B0000", weight: 3, opacity: 0.7, dashArray: "6 6" },
        ).addTo(map);
        map.fitBounds(straightLine.getBounds().pad(0.3));
      }

      setReady(true);
    }

    render();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [storeLat, storeLng, customerLat, customerLng, storeName, distanceText]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-sand bg-parchment/60 shadow-sm">
      {/* Loading overlay */}
      {!ready ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-stone-50/90 backdrop-blur-sm">
          <Truck className="h-6 w-6 text-antique animate-bounce" />
          <span className="text-xs font-medium text-stone-500">Đang đồng bộ lộ trình vận chuyển...</span>
        </div>
      ) : null}

      {/* Top Floating Badge */}
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 shadow-md border border-stone-200 backdrop-blur text-xs font-semibold text-stone-700">
        <Truck className="h-3.5 w-3.5 text-emerald-600" />
        <span>{roadInfo?.isRealRoute ? "Lộ trình đường bộ (Viettel Post)" : "Khoảng cách liên tỉnh"}</span>
      </div>

      {/* Map Canvas */}
      <div
        ref={containerRef}
        className="h-64 w-full"
        style={{ minHeight: 256 }}
      />

      {/* Footer Info Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand/80 bg-white/80 px-4 py-2.5 backdrop-blur text-xs text-stone-600">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            {roadInfo?.isRealRoute
              ? `Khoảng cách thực tế: ~${roadInfo.distanceKm} km`
              : `Khoảng cách: ${distanceText || "Liên tỉnh"}`}
          </span>
          <span className="text-stone-400">•</span>
          <span className="inline-flex items-center gap-1 text-stone-600">
            <ShieldCheck className="h-3.5 w-3.5 text-antique" />
            Bảo hiểm vận chuyển 100%
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-stone-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#8B0000]" />
            Atelier
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            Khách nhận
          </span>
        </div>
      </div>
    </div>
  );
}
