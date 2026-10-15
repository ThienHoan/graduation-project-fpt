"use client";

import { useEffect, useRef } from "react";
import { getMapTileConfig } from "@/lib/map-config";

type MapPreviewProps = {
  lat: number;
  lng: number;
  className?: string;
};

let cssInjected = false;

export function MapPreview({ lat, lng, className = "" }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    // Inject Leaflet CSS once
    if (!cssInjected && typeof document !== "undefined") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      link.crossOrigin = "";
      document.head.appendChild(link);
      cssInjected = true;
    }

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

      const map = L.map(containerRef.current).setView([lat, lng], 16);
      mapRef.current = map;

      const tileConfig = getMapTileConfig();
      L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom,
        subdomains: tileConfig.subdomains || "0123",
      }).addTo(map);

      L.marker([lat, lng])
        .addTo(map)
        .bindPopup("📍 Vị trí atelier");
    }

    render();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [lat, lng]);

  return (
    <div
      ref={containerRef}
      className={["rounded-xl border border-sand", className].filter(Boolean).join(" ")}
      style={{ minHeight: 180 }}
    />
  );
}
