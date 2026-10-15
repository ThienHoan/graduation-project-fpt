"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { LocateFixed } from "lucide-react";

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
  latitude?: number | null;
  longitude?: number | null;
  provider: "gogoduk" | "goong";
  providerPlaceId?: string;
};

type AddressAutocompleteProps = {
  value: ResolvedAddress | null;
  onChange: (address: ResolvedAddress | null) => void;
  disabled?: boolean;
};

function suggestionToAddress(suggestion: AddressSuggestion): ResolvedAddress {
  return {
    fullAddress: suggestion.label,
    provider: "goong",
    providerPlaceId: suggestion.placeId,
  };
}

export function AddressAutocomplete({ value, onChange, disabled = false }: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value?.fullAddress ?? "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedFromSuggest, setPickedFromSuggest] = useState(false);
  const requestIdRef = useRef(0);
  const suppressSuggestRef = useRef(false);

  const canUseCurrentLocation = useMemo(() => typeof navigator !== "undefined" && "geolocation" in navigator, []);

  useEffect(() => {
    setQuery(value?.fullAddress ?? "");
  }, [value?.fullAddress]);

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (suppressSuggestRef.current) {
      suppressSuggestRef.current = false;
      setSuggestions([]);
      setLoading(false);
      return;
    }

    if (trimmed.length < 2 || value?.fullAddress === trimmed) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const timeout = window.setTimeout(async () => {
      const result = await apiRequest<AddressSuggestion[]>(`/locations/suggest?q=${encodeURIComponent(trimmed)}`);

      if (requestIdRef.current !== requestId) {
        return;
      }

      setLoading(false);
      if (result.success) {
        setSuggestions(result.data ?? []);
      } else {
        setSuggestions([]);
        setError(result.message ?? "Không thể tìm địa chỉ.");
      }
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [query, value?.fullAddress]);

  async function handleSelect(suggestion: AddressSuggestion) {
    suppressSuggestRef.current = true;
    setQuery(suggestion.label);
    setSuggestions([]);
    setError(null);
    setPickedFromSuggest(true);

    const result = await apiRequest<ResolvedAddress>(`/locations/resolve?placeId=${encodeURIComponent(suggestion.placeId)}`);
    onChange(result.success && result.data ? result.data : suggestionToAddress(suggestion));
  }

  function handleUseCurrentLocation() {
    if (!canUseCurrentLocation) {
      setError("Trình duyệt không hỗ trợ lấy vị trí hiện tại.");
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const result = await apiRequest<ResolvedAddress>(`/locations/reverse?lat=${latitude}&lng=${longitude}`);
        setLocating(false);

        if (result.success && result.data) {
          suppressSuggestRef.current = true;
          onChange(result.data);
          setQuery(result.data.fullAddress);
          setSuggestions([]);
          setPickedFromSuggest(true);
        } else {
          setError(result.message ?? "Không thể đọc địa chỉ từ vị trí hiện tại.");
        }
      },
      () => {
        setLocating(false);
        setError("Không thể lấy vị trí hiện tại. Vui lòng nhập địa chỉ thủ công.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="delivery-address">
          Địa chỉ giao/nhận
        </label>
        <input
          id="delivery-address"
          className="focus-ring block w-full rounded-lg border border-sand bg-white px-4 py-3 text-sm text-ink shadow-sm disabled:cursor-not-allowed disabled:bg-stone-50"
          type="text"
          value={query}
          placeholder="Nhập địa chỉ, phường/xã, quận/huyện..."
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange(null);
            setPickedFromSuggest(false);
          }}
          autoComplete="street-address"
        />

        {(loading || suggestions.length > 0) && (
          <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-sand bg-white p-2 shadow-xl">
            {loading ? <p className="px-3 py-2 text-sm text-stone-500">Đang tìm địa chỉ...</p> : null}
            {!loading && suggestions.map((suggestion) => (
              <button
                key={`${suggestion.placeId}-${suggestion.label}`}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-parchment"
                onClick={() => void handleSelect(suggestion)}
              >
                <span className="block font-medium text-ink">{suggestion.label}</span>
                {suggestion.secondaryText ? (
                  <span className="mt-1 block text-xs text-stone-500">{suggestion.secondaryText}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-bronze px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-bronze transition hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || locating}
          onClick={handleUseCurrentLocation}
        >
          <LocateFixed className="h-4 w-4" />
          {locating ? "Đang lấy vị trí..." : "Dùng vị trí hiện tại"}
        </button>
        {value && pickedFromSuggest ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-jade">Đã chọn địa chỉ chuẩn hóa</span>
            {value.district || value.province ? (
              <span className="text-xs text-stone-500">
                {[value.district, value.province].filter(Boolean).join(", ")}
              </span>
            ) : null}
          </div>
        ) : value ? (
          <span className="text-xs text-amber-600">
            ⚠ Địa chỉ nhập tay, có thể không chính xác. Nên chọn từ gợi ý.
          </span>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
