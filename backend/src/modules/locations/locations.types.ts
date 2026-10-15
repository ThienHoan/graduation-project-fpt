export type AddressSuggestion = {
  placeId: string;
  label: string;
  mainText?: string;
  secondaryText?: string;
  types?: string[];
};

export type ResolvedAddress = {
  fullAddress: string;
  name?: string;
  ward?: string;
  district?: string;
  province?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  provider: "gogoduk" | "goong";
  providerPlaceId?: string;
};

export type AdministrativeArea = {
  latitude: number;
  longitude: number;
  city: string | null;
  district: string | null;
};

export type DirectionSummary = {
  status: "OK" | "ESTIMATED" | string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  distanceText: string | null;
  durationText: string | null;
  raw: unknown;
};

export type ShippingFeeEstimate = {
  distanceKm: number;
  estimatedFee: number;
  durationMinutes: number;
  distanceText: string;
  durationText: string;
  routeType: "intra" | "adjacent" | "inter";
  routeLabel: string;
  deliveryTimeText: string;
  storeLat: number;
  storeLng: number;
  customerLat: number;
  customerLng: number;
};

export type StoreInfo = {
  name: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  businessHours: string;
};
