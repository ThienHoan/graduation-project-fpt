/**
 * Cấu hình tập trung cho bản đồ (Goong Map + Fallback CartoDB CDN)
 * Hỗ trợ chuyển đổi mượt mà giữa Goong Map nội địa và CDN CartoDB tốc độ cao
 */

export type MapTileConfig = {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains: string;
};

export function getMapTileConfig(): MapTileConfig {
  // Goong phân biệt 2 loại key:
  // 1. MapTiles Key (dành riêng cho vector/raster tiles tại tiles.goong.io)
  // 2. REST API Key (dành riêng cho AutoComplete, Detail, Direction tại rsapi.goong.io)
  const maptilesKey = process.env.NEXT_PUBLIC_GOONG_MAPTILES_KEY?.trim();

  if (maptilesKey) {
    return {
      url: `https://tiles.goong.io/assets/goong_map_web/{z}/{x}/{y}.png?api_key=${maptilesKey}`,
      attribution: '&copy; <a href="https://www.goong.io/" target="_blank" rel="noreferrer">Goong Map</a>',
      maxZoom: 20,
      subdomains: "abc",
    };
  }

  // Bản đồ chuẩn Google Maps tiếng Việt 100% (&hl=vi): Sạch sẽ, không chữ chìm Watermark,
  // hiển thị đầy đủ tên đường, ngõ hẻm tiếng Việt chi tiết và tải siêu tốc tại Việt Nam.
  return {
    url: "https://mt{s}.google.com/vt/lyrs=m&hl=vi&x={x}&y={y}&z={z}",
    attribution: '&copy; <a href="https://www.google.com/maps" target="_blank" rel="noreferrer">Google Maps</a>',
    maxZoom: 20,
    subdomains: "0123",
  };
}

/**
 * Lấy lộ trình đường đi thực tế theo đường phố
 * Ưu tiên Goong Direction API -> fallback sang OSRM
 */
export async function fetchDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<{ coordinates: [number, number][]; distanceKm: number; durationMin: number } | null> {
  const goongKey = process.env.NEXT_PUBLIC_GOONG_API_KEY?.trim();

  // 1. Thử gọi Goong Direction nếu có API Key
  if (goongKey) {
    try {
      const url = `https://rsapi.goong.io/Direction?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&vehicle=bike&api_key=${goongKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const json = await res.json();
        const route = json.routes?.[0];
        if (route && route.overview_polyline?.points) {
          const coords = decodePolyline(route.overview_polyline.points);
          const leg = route.legs?.[0];
          return {
            coordinates: coords,
            distanceKm: Number(((leg?.distance?.value ?? 0) / 1000).toFixed(1)),
            durationMin: Math.max(3, Math.round((leg?.duration?.value ?? 0) / 60)),
          };
        }
      }
    } catch (e) {
      console.warn("Goong Direction fallback to OSRM:", e);
    }
  }

  // 2. Fallback sang OSRM
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const json = await res.json();
      if (json.code === "Ok" && json.routes?.[0]?.geometry?.coordinates?.length) {
        const rawCoords = json.routes[0].geometry.coordinates as [number, number][];
        const latLngs: [number, number][] = rawCoords.map((c) => [c[1], c[0]]);
        return {
          coordinates: latLngs,
          distanceKm: Number((json.routes[0].distance / 1000).toFixed(1)),
          durationMin: Math.max(3, Math.round(json.routes[0].duration / 60)),
        };
      }
    }
  } catch (e) {
    console.warn("OSRM error, using straight line fallback:", e);
  }

  return null;
}

// Giải mã chuỗi Google/Goong encoded polyline thành mảng [lat, lng]
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}
