"use client";

import { useEffect, useRef, useState } from "react";

type DeliveryTrackData = {
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
  { key: "preparing", label: "Đang chuẩn bị", icon: "📦" },
  { key: "in_transit", label: "Đang giao", icon: "🛵" },
  { key: "delivered", label: "Đã nhận hàng", icon: "✅" },
] as const;

export function DeliveryTracker({ data }: { data: DeliveryTrackData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const currentIdx = STEPS.findIndex((s) => s.key === data.status);

  useEffect(() => {
    if (!mounted) return;
    injectCss();

    let cancelled = false;

    async function render() {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const container = containerRef.current as any;
      if (container && container._leaflet_id) {
        container._leaflet_id = null;
      }

      const { storeLat, storeLng, customerLat, customerLng } = data;

      const map = L.map(containerRef.current);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OSM",
        maxZoom: 19,
      }).addTo(map);

      // Store marker
      L.marker([storeLat, storeLng], {
        icon: L.divIcon({
          html: `<div style="background:#8B0000;color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">🏠</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          className: "",
        }),
      })
        .addTo(map)
        .bindPopup("<b>Atelier</b><br>Điểm xuất phát");

      // Customer marker
      L.marker([customerLat, customerLng], {
        icon: L.divIcon({
          html: `<div style="background:#1a73e8;color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">📍</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          className: "",
        }),
      })
        .addTo(map)
        .bindPopup(`<b>${data.customerName}</b><br>${data.customerAddress}`);

      // Dashed line store -> customer
      L.polyline(
        [
          [storeLat, storeLng],
          [customerLat, customerLng],
        ],
        { color: "#8B0000", weight: 2, opacity: 0.4, dashArray: "6 6" },
      ).addTo(map);

      // Fit bounds
      const bounds = L.latLngBounds([
        [storeLat, storeLng],
        [customerLat, customerLng],
      ]);
      map.fitBounds(bounds.pad(0.2));
    }

    render();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mounted, data]);

  return (
    <div className="space-y-4">
      {/* Step progress */}
      <div className="rounded-xl border border-sand bg-white p-4">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => {
            const done = idx <= currentIdx;
            return (
              <div key={step.key} className="flex flex-col items-center flex-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                    done
                      ? "border-jade bg-jade/10 text-jade"
                      : "border-stone-200 bg-stone-50 text-stone-400"
                  }`}
                >
                  {step.icon}
                </div>
                <span className={`text-xs mt-1 font-medium ${done ? "text-jade" : "text-stone-400"}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
        {/* Connector line */}
        <div className="flex items-center mt-1 px-5">
          <div className="flex-1 h-0.5 rounded bg-jade" />
          <div className={`flex-1 h-0.5 rounded ${currentIdx >= 1 ? "bg-jade" : "bg-stone-200"}`} />
        </div>

        {data.deliveredAt && (
          <p className="text-xs text-stone-500 mt-3 text-center">
            Giao lúc: {new Date(data.deliveredAt).toLocaleString("vi-VN")}
          </p>
        )}
        {data.handoverConfirmed && (
          <p className="text-xs text-jade mt-1 text-center font-medium">✅ Đã xác nhận nhận hàng</p>
        )}
        {!data.shipperLocationAvailable && data.status === "in_transit" && (
          <p className="text-xs text-amber-600 mt-2 text-center">
            ⚠ Vị trí shipper không khả dụng — bản đồ chỉ hiển thị điểm giao và nhận.
          </p>
        )}
      </div>

      {/* Map */}
      <div ref={containerRef} className="h-72 w-full rounded-xl border border-sand" style={{ minHeight: 288 }} />
    </div>
  );
}
