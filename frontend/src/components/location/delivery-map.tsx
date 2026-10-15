"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getDeliveryTrack, type DeliveryTrackData } from "@/lib/api";
import { DeliveryTracker } from "@/components/location/delivery-tracker";
import { Truck, ExternalLink, X } from "lucide-react";

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

type DeliveryPoint = {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  status: string;
  address: string;
  latitude: number;
  longitude: number;
  garmentNames: string;
  rentalStartDate: string;
  rentalEndDate: string;
};

type DeliveryMapProps = {
  points: DeliveryPoint[];
  storeLat?: number;
  storeLng?: number;
  storeName?: string;
  className?: string;
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ready_for_pickup: "bg-jade",
    delivering: "bg-lotus",
    renting: "bg-jade",
  };
  return map[status] ?? "bg-stone-400";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    ready_for_pickup: "Sẵn sàng giao",
    delivering: "Đang giao",
    renting: "Đã nhận",
  };
  return map[status] ?? status;
}

export function DeliveryMap({ points, storeLat = 10.7769, storeLng = 106.7009, storeName = "Atelier", className = "" }: DeliveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [selectedPoint, setSelectedPoint] = useState<DeliveryPoint | null>(null);
  const [liveTrack, setLiveTrack] = useState<DeliveryTrackData | null>(null);

  useEffect(() => {
    if (!selectedPoint) {
      setLiveTrack(null);
      return;
    }
    getDeliveryTrack(selectedPoint.bookingId).then((res) => {
      if (res.success && res.data) {
        setLiveTrack(res.data);
      } else {
        setLiveTrack(null);
      }
    });
  }, [selectedPoint]);

  useEffect(() => {
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

      const allLats = [storeLat, ...points.map((p) => p.latitude)];
      const allLngs = [storeLng, ...points.map((p) => p.longitude)];

      const map = L.map(containerRef.current);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OSM",
        maxZoom: 19,
      }).addTo(map);

      // Store marker
      const storeIcon = L.divIcon({
        html: `<div style="background:#8B0000;color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🏠</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        className: "",
      });
      L.marker([storeLat, storeLng], { icon: storeIcon })
        .addTo(map)
        .bindPopup(`<b>${storeName}</b>`);

      // Customer markers
      points.forEach((point) => {
        const color = point.status === "ready_for_pickup" ? "#1a73e8" : point.status === "delivering" ? "#e37400" : "#188038";
        const icon = L.divIcon({
          html: `<div style="background:${color};color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          className: "",
        });

        const popupContent = [
          `<b>${point.customerName}</b>`,
          `<span class="inline-block px-2 py-0.5 rounded text-xs text-white ${statusBadge(point.status)}">${statusLabel(point.status)}</span>`,
          `<br>📞 ${point.customerPhone}`,
          `<br>📍 ${point.address}`,
          `<br>👗 ${point.garmentNames}`,
          `<br>📅 ${point.rentalStartDate} → ${point.rentalEndDate}`,
        ].join("<br>");

        L.marker([point.latitude, point.longitude], { icon })
          .addTo(map)
          .bindPopup(popupContent);
      });

      // Fit all points
      const bounds = L.latLngBounds([
        [storeLat, storeLng],
        ...points.map((p) => [p.latitude, p.longitude] as [number, number]),
      ]);
      map.fitBounds(bounds.pad(0.3));

      // If only 1 point, zoom to a reasonable level
      if (points.length <= 1) {
        map.setZoom(Math.min(map.getZoom() ?? 13, 15));
      }
    }

    render();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [points, storeLat, storeLng, storeName]);

  return (
    <div className={["space-y-3", className].filter(Boolean).join(" ")}>
      <div ref={containerRef} className="h-96 w-full rounded-xl border border-sand" style={{ minHeight: 384 }} />

      {points.length === 0 ? (
        <p className="text-center text-sm text-stone-500 py-8">Không có đơn giao hàng nào đang hoạt động.</p>
      ) : (
        <div className="grid gap-2 max-h-48 overflow-auto">
          {points.map((point) => (
            <button
              key={point.bookingId}
              type="button"
              className={`text-left rounded-lg border p-3 text-sm transition ${
                selectedPoint?.bookingId === point.bookingId
                  ? "border-antique bg-parchment"
                  : "border-sand bg-white hover:border-antique/50"
              }`}
              onClick={() => setSelectedPoint(point)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{point.customerName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs text-white ${statusBadge(point.status)}`}>
                  {statusLabel(point.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-stone-500">{point.address}</p>
              <p className="mt-0.5 text-xs text-stone-400">👗 {point.garmentNames}</p>
            </button>
          ))}
        </div>
      )}

      {/* Hiển thị tiến trình chi tiết của đơn được chọn */}
      {selectedPoint && (
        <div className="space-y-4 rounded-2xl border border-sand bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">
                  Theo dõi lộ trình: {selectedPoint.customerName}
                </h4>
                <p className="text-xs text-stone-500">Mã đơn: #{selectedPoint.bookingId.slice(0, 8).toUpperCase()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/staff/booking/${selectedPoint.bookingId}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-lotus px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-oxblood"
              >
                <span>Xem đơn</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => setSelectedPoint(null)}
                className="rounded-lg border border-sand p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition"
                title="Đóng bản đồ chi tiết"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {liveTrack ? (
            <DeliveryTracker data={liveTrack} />
          ) : (
            <div className="py-8 text-center text-xs text-stone-400">
              Đang tải lộ trình GPS đường phố của đơn hàng...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
