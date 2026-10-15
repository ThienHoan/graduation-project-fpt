import { HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  AddressSuggestion,
  AdministrativeArea,
  DirectionSummary,
  ResolvedAddress,
  ShippingFeeEstimate,
  StoreInfo,
} from "./locations.types";
import { classifyRoute, detectRegion, type ShippingRegion } from "./shipping-regions";

const DEFAULT_GOGODUK_BASE_URL = "https://api.gogoduk.com";

type RawRecord = Record<string, unknown>;

@Injectable()
export class LocationsService {
  private readonly baseUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = (this.config.get<string>("GOGODUK_BASE_URL") ?? DEFAULT_GOGODUK_BASE_URL).replace(/\/$/, "");
  }

  async suggest(query: string): Promise<AddressSuggestion[]> {
    const goongKey = this.config.get<string>("GOONG_API_KEY")?.trim();
    if (goongKey) {
      try {
        const url = new URL("https://rsapi.goong.io/Place/AutoComplete");
        url.searchParams.set("input", query);
        url.searchParams.set("api_key", goongKey);
        url.searchParams.set("limit", "8");
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json = (await res.json()) as { predictions?: RawRecord[] };
          const list = json.predictions ?? [];
          const items = list
            .map((item) => {
              const structured = item.structured_formatting as RawRecord | undefined;
              return {
                placeId: this.str(item.place_id) ?? "",
                label: this.str(item.description) ?? "",
                mainText: this.str(structured?.main_text),
                secondaryText: this.str(structured?.secondary_text),
              };
            })
            .filter((s) => s.placeId && s.label);
          if (items.length > 0) return items;
        }
      } catch {
        // Fallback to GoGoDuk if Goong fails or timeouts
      }
    }

    try {
      const payload = await this.gogodukFetch<unknown>("/v1/suggest", { input: query, lang: "vi", country: "VN" });
      return this.extractArray(payload, ["predictions"])
        .map((item) => this.normalizeSuggestion(item))
        .filter((item): item is AddressSuggestion => item !== null);
    } catch {
      return [];
    }
  }

  async resolve(placeId: string): Promise<ResolvedAddress> {
    const goongKey = this.config.get<string>("GOONG_API_KEY")?.trim();
    if (goongKey) {
      try {
        const url = new URL("https://rsapi.goong.io/Place/Detail");
        url.searchParams.set("place_id", placeId);
        url.searchParams.set("api_key", goongKey);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json = (await res.json()) as { result?: RawRecord };
          const result = json.result ?? {};
          const geom = result.geometry as RawRecord | undefined;
          const loc = geom?.location as RawRecord | undefined;
          const components = (result.address_components as RawRecord[]) ?? [];

          const compound = result.compound as RawRecord | undefined;
          let ward: string | undefined = this.str(compound?.commune);
          let district: string | undefined = this.str(compound?.district);
          let province: string | undefined = this.str(compound?.province);

          if (!ward || !district || !province) {
            for (const c of components) {
              const types = (c.types as string[]) ?? [];
              if (!ward && (types.includes("sublocality_level_1") || types.includes("sublocality") || types.includes("ward"))) {
                ward = this.str(c.long_name) ?? this.str(c.name);
              } else if (!district && (types.includes("administrative_area_level_2") || types.includes("district"))) {
                district = this.str(c.long_name) ?? this.str(c.name);
              } else if (!province && (types.includes("administrative_area_level_1") || types.includes("province") || types.includes("city"))) {
                province = this.str(c.long_name) ?? this.str(c.name);
              }
            }
          }

          return {
            fullAddress: this.str(result.formatted_address) ?? this.str(result.name) ?? "",
            name: this.str(result.name),
            ward,
            district,
            province,
            latitude: this.num(loc?.lat),
            longitude: this.num(loc?.lng),
            provider: "goong",
            providerPlaceId: placeId,
          };
        }
      } catch {
        // Fallback to GoGoDuk
      }
    }

    const payload = await this.gogodukFetch<unknown>("/v1/place/resolve", { id: placeId, lang: "vi" });
    const resolved = this.normalizeResolved(this.extractObject(payload, ["result"]));

    // Auto-populate administrative fields from reverse geocode
    if (resolved.latitude != null && resolved.longitude != null) {
      try {
        const admin = await this.reverseGeocode(resolved.latitude, resolved.longitude);
        if (admin.city) resolved.province = admin.city;
        if (admin.district) resolved.district = admin.district;
      } catch {
        // swallow — resolved without admin fields is still usable
      }
    }

    return resolved;
  }

  async reverse(latitude: number, longitude: number): Promise<ResolvedAddress> {
    const goongKey = this.config.get<string>("GOONG_API_KEY")?.trim();
    if (goongKey) {
      try {
        const url = new URL("https://rsapi.goong.io/Geocode");
        url.searchParams.set("latlng", `${latitude},${longitude}`);
        url.searchParams.set("api_key", goongKey);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json = (await res.json()) as { results?: RawRecord[] };
          const first = json.results?.[0];
          if (first) {
            const geom = first.geometry as RawRecord | undefined;
            const loc = geom?.location as RawRecord | undefined;
            const components = (first.address_components as RawRecord[]) ?? [];
            const compound = first.compound as RawRecord | undefined;
            let ward: string | undefined = this.str(compound?.commune);
            let district: string | undefined = this.str(compound?.district);
            let province: string | undefined = this.str(compound?.province);

            if (!ward || !district || !province) {
              for (const c of components) {
                const types = (c.types as string[]) ?? [];
                if (!ward && (types.includes("sublocality_level_1") || types.includes("sublocality") || types.includes("ward"))) {
                  ward = this.str(c.long_name) ?? this.str(c.name);
                } else if (!district && (types.includes("administrative_area_level_2") || types.includes("district"))) {
                  district = this.str(c.long_name) ?? this.str(c.name);
                } else if (!province && (types.includes("administrative_area_level_1") || types.includes("province") || types.includes("city"))) {
                  province = this.str(c.long_name) ?? this.str(c.name);
                }
              }
            }

            return {
              fullAddress: this.str(first.formatted_address) ?? "",
              name: this.str(first.name),
              ward,
              district,
              province,
              latitude: this.num(loc?.lat) ?? latitude,
              longitude: this.num(loc?.lng) ?? longitude,
              provider: "goong" as never,
              providerPlaceId: this.str(first.place_id),
            };
          }
        }
      } catch {
        // Fallback to GoGoDuk
      }
    }

    const payload = await this.gogodukFetch<unknown>("/v1/reverse", {
      "point.lat": latitude,
      "point.lon": longitude,
      size: 1,
      lang: "vi",
      "boundary.country": "VN",
    });
    const firstResult = this.extractArray(payload, ["results"])[0] ?? {};
    const resolved = this.normalizeResolved(firstResult);

    // Enrich with administrative area data from reverse-geocode
    try {
      const admin = await this.reverseGeocode(latitude, longitude);
      if (admin.city && !resolved.province) resolved.province = admin.city;
      if (admin.district && !resolved.district) resolved.district = admin.district;
    } catch {
      // swallow — address still usable without admin fields
    }

    return resolved;
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<AdministrativeArea> {
    const payload = await this.gogodukFetch<unknown>("/v1/reverse-geocode", {
      lat: latitude,
      lng: longitude,
      levels: "4,8",
    });
    const record = this.extractObject(payload);
    return {
      latitude: this.num(record.lat) ?? latitude,
      longitude: this.num(record.lng) ?? longitude,
      city: this.str(record.city) ?? null,
      district: this.str(record.district) ?? null,
    };
  }

  async directions(origin: string, destination: string): Promise<DirectionSummary> {
    const goongKey = this.config.get<string>("GOONG_API_KEY")?.trim();
    if (goongKey) {
      try {
        const url = new URL("https://rsapi.goong.io/Direction");
        url.searchParams.set("origin", origin);
        url.searchParams.set("destination", destination);
        url.searchParams.set("vehicle", "bike");
        url.searchParams.set("api_key", goongKey);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const json = (await res.json()) as RawRecord;
          const routes = this.extractArray(json.routes);
          const firstRoute = routes[0];
          const legs = firstRoute ? this.extractArray(firstRoute.legs) : [];
          const firstLeg = legs[0];
          const distance = firstLeg && typeof firstLeg.distance === "object" ? (firstLeg.distance as RawRecord) : undefined;
          const duration = firstLeg && typeof firstLeg.duration === "object" ? (firstLeg.duration as RawRecord) : undefined;

          return {
            status: this.str(json.status) ?? "OK",
            distanceMeters: distance ? this.num(distance.value) ?? null : null,
            durationSeconds: duration ? this.num(duration.value) ?? null : null,
            distanceText: distance ? this.str(distance.text) ?? null : null,
            durationText: duration ? this.str(duration.text) ?? null : null,
            raw: json,
          };
        }
      } catch {
        // Fallback to GoGoDuk
      }
    }

    const payload = await this.gogodukFetch<unknown>("/v1/directions", {
      origin,
      destination,
      vehicle: "motobike",
    });
    const record = this.extractObject(payload);
    const firstRoute = this.extractArray(record.routes)[0];
    const firstLeg = firstRoute ? this.extractArray(firstRoute.legs)[0] : undefined;
    const distance = firstLeg && typeof firstLeg.distance === "object" ? (firstLeg.distance as RawRecord) : undefined;
    const duration = firstLeg && typeof firstLeg.duration === "object" ? (firstLeg.duration as RawRecord) : undefined;

    return {
      status: this.str(record.status) ?? "UNKNOWN",
      distanceMeters: distance ? this.num(distance.value) ?? null : null,
      durationSeconds: duration ? this.num(duration.value) ?? null : null,
      distanceText: distance ? this.str(distance.text) ?? null : null,
      durationText: duration ? this.str(duration.text) ?? null : null,
      raw: payload,
    };
  }

  async estimateShippingFee(addressId: string): Promise<ShippingFeeEstimate> {
    // 1. Look up address from DB
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address) {
      throw new NotFoundException("Không tìm thấy địa chỉ.");
    }

    // 2. Get customer coordinates: use stored lat/lng if available, otherwise geocode
    let customerLat: number;
    let customerLng: number;

    if (address.latitude != null && address.longitude != null) {
      // Fast path: use coordinates already stored on the address
      customerLat = Number(address.latitude);
      customerLng = Number(address.longitude);
    } else {
      // Slow path: geocode the address text via GoGoDuk
      const normalizedCity = address.city
        ?.replace(/\bTP\.?\s*/gi, "")
        ?.replace(/\bTp\.?\s*/gi, "")
        ?.replace(/\bThành\s+phố\s+/gi, "")
        .trim()
        ?? null;

      const candidates = [
        [address.line1, address.ward, address.district, normalizedCity],
        [address.line1, address.ward, address.district],
        [address.line1, address.district, normalizedCity],
        [address.line1, address.district],
        [address.line1],
      ];

      let suggestions = await this.suggest(
        (candidates[0] ?? []).filter(Boolean).join(", "),
      );

      for (const candidate of candidates.slice(1)) {
        if (suggestions.length > 0) break;
        const text = candidate.filter(Boolean).join(", ");
        if (!text) continue;
        suggestions = await this.suggest(text);
      }

      if (suggestions.length === 0) {
        throw new HttpException("Không thể định vị địa chỉ.", HttpStatus.UNPROCESSABLE_ENTITY);
      }

      const resolved = await this.resolve(suggestions[0].placeId);
      if (resolved.latitude == null || resolved.longitude == null) {
        throw new HttpException("Không thể lấy tọa độ địa chỉ.", HttpStatus.UNPROCESSABLE_ENTITY);
      }

      customerLat = resolved.latitude;
      customerLng = resolved.longitude;

      // Store coordinates on the address for future use
      try {
        await this.prisma.address.update({
          where: { id: addressId },
          data: { latitude: customerLat, longitude: customerLng },
        });
      } catch {
        // non-critical — coordinates will be re-geocoded next time
      }
    }

    // 3. Get store coordinates from system settings (fall back to FPT University Da Nang)
    const storeLat = (await this.getSettingNumber("store_lat")) ?? 15.967945;
    const storeLng = (await this.getSettingNumber("store_lng")) ?? 108.260727;

    // 4. Determine regions and Viettel Post route pricing
    const customerRegion =
      detectRegion(address.city) ??
      detectRegion([address.line1, address.ward, address.district, address.city].filter(Boolean).join(", ")) ??
      (await this.regionFromCoordinates(customerLat, customerLng));
    const storeRegion =
      (await this.regionFromCoordinates(storeLat, storeLng)) ??
      detectRegion(await this.getSettingText("store_address")) ??
      "central";

    // Không xác định được miền của khách → tính theo tuyến xa nhất cho an toàn
    const route = customerRegion && storeRegion
      ? classifyRoute(storeRegion, customerRegion)
      : classifyRoute("north", "south");

    // Cho phép quản lý ghi đè mức cước qua cài đặt hệ thống
    const feeSettingKey = { intra: "shipping_fee_intra", adjacent: "shipping_fee_adjacent", inter: "shipping_fee_inter" }[route.type];
    const fee = (await this.getSettingNumber(feeSettingKey)) ?? route.fee;

    // 5. Call directions API for map display (fee no longer depends on distance)
    let distanceKm = 0;
    let durationMinutes = 0;
    let distanceText: string | null = null;
    let durationText: string | null = null;
    try {
      const dir = await this.directions(`${storeLat},${storeLng}`, `${customerLat},${customerLng}`);
      distanceKm = dir.distanceMeters ? dir.distanceMeters / 1000 : 0;
      durationMinutes = dir.durationSeconds ? Math.round(dir.durationSeconds / 60) : 0;
      distanceText = dir.distanceText;
      durationText = dir.durationText;
    } catch {
      // bản đồ/khoảng cách chỉ để hiển thị — thiếu cũng không chặn việc báo phí
    }

    return {
      distanceKm: Math.round(distanceKm * 100) / 100,
      estimatedFee: fee,
      durationMinutes,
      distanceText: distanceText ?? `${distanceKm.toFixed(1)} km`,
      durationText: durationText ?? `${durationMinutes} phút`,
      routeType: route.type,
      routeLabel: route.label,
      deliveryTimeText: route.deliveryTimeText,
      storeLat,
      storeLng,
      customerLat,
      customerLng,
    };
  }

  private async regionFromCoordinates(latitude: number, longitude: number): Promise<ShippingRegion | null> {
    try {
      const admin = await this.reverseGeocode(latitude, longitude);
      return detectRegion(admin.city) ?? detectRegion(admin.district);
    } catch {
      return null;
    }
  }

  async getStoreInfo(): Promise<StoreInfo> {
    const rawAddress = await this.getSettingText("store_address");
    const storeAddress =
      rawAddress && !rawAddress.includes("Hồ Chí Minh") && !rawAddress.includes("Sài Gòn")
        ? rawAddress
        : "Đại học FPT Đà Nẵng, Khu đô thị FPT City, Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng";
    const storePhone = (await this.getSettingText("store_phone")) ?? "0236 730 0999";
    const storeLat = (await this.getSettingNumber("store_lat")) ?? 15.967945;
    const storeLng = (await this.getSettingNumber("store_lng")) ?? 108.260727;

    let businessHours = "09:00 - 20:00";
    const hoursSetting = await this.prisma.systemSetting.findUnique({ where: { key: "business_hours" } });
    if (hoursSetting?.value && typeof hoursSetting.value === "object" && !Array.isArray(hoursSetting.value)) {
      const bh = hoursSetting.value as Record<string, unknown>;
      if (typeof bh.open === "string" && typeof bh.close === "string") {
        businessHours = `${bh.open} - ${bh.close}`;
      }
    }

    return {
      name: "Heritage Atelier",
      address: storeAddress,
      phone: storePhone,
      latitude: storeLat,
      longitude: storeLng,
      businessHours,
    };
  }

  private async getSettingText(key: string): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!setting?.value) return null;
    const raw = setting.value as Record<string, unknown>;
    if (raw && typeof raw === "object" && "value" in raw) {
      return typeof raw.value === "string" ? raw.value : String(raw.value);
    }
    return typeof setting.value === "string" ? setting.value : null;
  }

  private async getSettingNumber(key: string): Promise<number | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!setting?.value) return null;

    // Handle both formats:
    //   { value: "10.7769" }  → extract .value
    //   { value: 5000 }       → extract .value
    //   "10.7769"             → use directly (admin page may save raw value)
    const raw = setting.value as Record<string, unknown>;
    const val = raw && typeof raw === "object" && "value" in raw ? raw.value : setting.value;

    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private async gogodukFetch<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const apiKey = this.config.get<string>("GOGODUK_API_KEY")?.trim();
    if (!apiKey) {
      throw new HttpException("GOGODUK_API_KEY is not configured.", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && `${value}`.length > 0) {
        url.searchParams.set(key, `${value}`);
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });
    } catch {
      throw new HttpException("Không thể kết nối đến dịch vụ địa chỉ.", HttpStatus.BAD_GATEWAY);
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as RawRecord | null;
      const message = this.str(payload?.error) ?? this.str(payload?.message) ?? `GoGoDuk request failed with status ${response.status}.`;
      throw new HttpException(message, response.status);
    }

    return (await response.json()) as T;
  }

  private extractArray(payload: unknown, preferredKeys: string[] = []): RawRecord[] {
    if (Array.isArray(payload)) {
      return payload as RawRecord[];
    }

    if (payload && typeof payload === "object") {
      const record = payload as RawRecord;
      for (const key of [...preferredKeys, "data", "results", "suggestions", "items", "predictions", "routes", "legs"]) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value as RawRecord[];
        }
      }
    }

    return [];
  }

  private extractObject(payload: unknown, preferredKeys: string[] = []): RawRecord {
    if (payload && typeof payload === "object") {
      const record = payload as RawRecord;
      for (const key of [...preferredKeys, "data", "result", "place"]) {
        const value = record[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return value as RawRecord;
        }
      }
      return record;
    }

    return {};
  }

  private normalizeSuggestion(raw: RawRecord): AddressSuggestion | null {
    const placeId = this.str(this.pick(raw, ["placeId", "id", "place_id", "ref"]));
    const label = this.str(this.pick(raw, ["text", "label", "description", "name", "address", "formatted"]));

    if (!placeId && !label) {
      return null;
    }

    const types = Array.isArray(raw.types) ? raw.types.filter((type): type is string => typeof type === "string") : undefined;

    return {
      placeId: placeId ?? label ?? "",
      label: label ?? placeId ?? "",
      mainText: this.str(raw.mainText),
      secondaryText: this.str(raw.secondaryText),
      types,
    };
  }

  private normalizeResolved(raw: RawRecord): ResolvedAddress {
    return {
      fullAddress: this.str(this.pick(raw, ["address", "text", "fullAddress", "full_address", "formatted", "label", "description"])) ?? "",
      name: this.str(raw.name),
      district: this.str(raw.district),
      province: this.str(this.pick(raw, ["city", "province"])),
      country: this.str(raw.country),
      latitude: this.num(this.pick(raw, ["lat", "latitude"])),
      longitude: this.num(this.pick(raw, ["lon", "lng", "longitude"])),
      provider: "gogoduk",
      providerPlaceId: this.str(this.pick(raw, ["placeId", "place_id", "id", "ref"])),
    };
  }

  private pick(record: RawRecord, keys: string[]) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) {
        return record[key];
      }
    }
    return undefined;
  }

  private str(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }

  private num(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }
}
