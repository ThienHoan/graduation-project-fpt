/**
 * The address copied into a DeliveryRecord must not depend on the mutable
 * Address row. Keep this payload deliberately small and explicit so that
 * adding a field to Address does not accidentally expose it in a snapshot.
 */
export const DELIVERY_ADDRESS_SNAPSHOT_VERSION = 1 as const;

export type DeliveryAddressSnapshot = {
  version: typeof DELIVERY_ADDRESS_SNAPSHOT_VERSION;
  receiverName: string;
  phone: string;
  line1: string;
  ward: string | null;
  district: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type AddressSnapshotInput = {
  [key: string]: unknown;
  receiverName?: unknown;
  phone?: unknown;
  line1?: unknown;
  ward?: unknown;
  district?: unknown;
  city?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

/** The part of a DeliveryRecord needed to read its address snapshot. */
export type DeliveryRecordSnapshotSource = {
  addressSnapshot?: unknown;
  createdAt?: Date | string | number | null;
};

export type BookingDeliverySnapshotSource = {
  deliveryRecords?: readonly DeliveryRecordSnapshotSource[] | null;
};

function snapshotString(value: unknown, required: boolean): string | null {
  if (typeof value !== "string") return required ? "" : null;
  const result = value.trim();
  return result || (required ? "" : null);
}

function snapshotCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Serialize an address into the stable, versioned form stored on a delivery
 * record. Unknown fields are intentionally ignored and unsafe values are
 * reduced to null/empty values rather than being copied into JSON.
 */
export function serializeAddressSnapshot(address: AddressSnapshotInput): string {
  const snapshot: DeliveryAddressSnapshot = {
    version: DELIVERY_ADDRESS_SNAPSHOT_VERSION,
    receiverName: snapshotString(address?.receiverName, true) ?? "",
    phone: snapshotString(address?.phone, true) ?? "",
    line1: snapshotString(address?.line1, true) ?? "",
    ward: snapshotString(address?.ward, false),
    district: snapshotString(address?.district, false),
    city: snapshotString(address?.city, false),
    latitude: snapshotCoordinate(address?.latitude),
    longitude: snapshotCoordinate(address?.longitude),
  };

  return JSON.stringify(snapshot);
}

function recordTime(record: DeliveryRecordSnapshotSource): number | null {
  if (record.createdAt == null) return null;
  const time = new Date(record.createdAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function parseSnapshot(value: unknown): DeliveryAddressSnapshot | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Legacy snapshots were human-readable text, not JSON. They cannot be
    // safely reconstructed as structured address data.
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== DELIVERY_ADDRESS_SNAPSHOT_VERSION) return null;
  if (
    typeof candidate.receiverName !== "string" ||
    typeof candidate.phone !== "string" ||
    typeof candidate.line1 !== "string"
  ) {
    return null;
  }

  const optionalString = (key: string): string | null => {
    const value = candidate[key];
    return typeof value === "string" ? value : value == null ? null : null;
  };
  const optionalCoordinate = (key: string): number | null => {
    const value = candidate[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  // Return a fresh object: callers cannot mutate a parsed payload or any
  // source object held by Prisma/the caller.
  return {
    version: DELIVERY_ADDRESS_SNAPSHOT_VERSION,
    receiverName: candidate.receiverName,
    phone: candidate.phone,
    line1: candidate.line1,
    ward: optionalString("ward"),
    district: optionalString("district"),
    city: optionalString("city"),
    latitude: optionalCoordinate("latitude"),
    longitude: optionalCoordinate("longitude"),
  };
}

function recordsFrom(
  source: BookingDeliverySnapshotSource | readonly DeliveryRecordSnapshotSource[] | null | undefined,
): readonly DeliveryRecordSnapshotSource[] {
  if (Array.isArray(source)) return source;
  if (source && "deliveryRecords" in source) return source.deliveryRecords ?? [];
  return [];
}

/**
 * Read the newest valid structured snapshot from optional booking records.
 * Invalid JSON, old human-readable snapshots, and absent records return null.
 * The booking's live deliveryAddress relation is intentionally not accepted
 * here, so this helper can never present mutable live data as a snapshot.
 */
export function readBookingDeliverySnapshot(
  source: BookingDeliverySnapshotSource | readonly DeliveryRecordSnapshotSource[] | null | undefined,
): DeliveryAddressSnapshot | null {
  const records = recordsFrom(source);
  const ordered = records
    .map((record, index) => ({ record, index, time: recordTime(record) }))
    .sort((left, right) => {
      if (left.time !== null && right.time !== null && left.time !== right.time) {
        return right.time - left.time;
      }
      if (left.time !== null) return -1;
      if (right.time !== null) return 1;
      return left.index - right.index;
    });

  for (const { record } of ordered) {
    const snapshot = parseSnapshot(record.addressSnapshot);
    if (snapshot) return snapshot;
  }
  return null;
}
