import { BadRequestException } from "@nestjs/common";
import { AssetStatus, BookingStatus, Prisma } from "@prisma/client";

export const INVENTORY_RELEASED_STATUSES: BookingStatus[] = [
  BookingStatus.cancelled, BookingStatus.rejected, BookingStatus.completed,
  BookingStatus.refund_pending, BookingStatus.returned, BookingStatus.inspection_pending,
];
export const RENTABLE_ASSET_STATUSES: AssetStatus[] = [
  AssetStatus.available, AssetStatus.reserved, AssetStatus.rented,
];
export const PHYSICAL_HOLD_STATUSES: BookingStatus[] = [
  BookingStatus.preparing, BookingStatus.ready_for_pickup, BookingStatus.delivering,
  BookingStatus.renting, BookingStatus.overdue,
];
const UNRETURNED_STATUSES: BookingStatus[] = [BookingStatus.renting, BookingStatus.overdue];
const DAY_MS = 86_400_000;

export function vietnamToday(now = new Date()): Date {
  return new Date(new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10));
}

/** Rental dates are date-only UTC values, unlike the clock used for Vietnam's today. */
export function parseRentalDateRange(start: string | Date, end: string | Date) {
  const day = (value: string | Date) => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException("Invalid rental dates.");
    const result = new Date(parsed.toISOString().slice(0, 10));
    // Date.parse silently rolls invalid date-only input (e.g. February 30) forward.
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && result.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException("Invalid rental dates.");
    }
    return result;
  };
  const startDay = day(start);
  const endDay = day(end);
  if (endDay < startDay) throw new BadRequestException("End date must be on or after start date.");
  return { startDay, endDay, days: Math.round((+endDay - +startDay) / DAY_MS) + 1 };
}

export function inclusiveOverlapWhere(startDay: Date, endDay: Date): Prisma.BookingWhereInput {
  return { rentalStartDate: { lte: endDay }, rentalEndDate: { gte: startDay } };
}

export function isUnreturnedOverdue(
  booking: { status: BookingStatus; rentalEndDate: Date },
  today: Date,
): boolean {
  return UNRETURNED_STATUSES.includes(booking.status) && booking.rentalEndDate < today;
}

export interface InventoryAsset {
  id: string;
  status: AssetStatus;
}
export interface InventoryItem {
  garmentAssetId: string | null;
  booking: {
    id: string;
    status: BookingStatus;
    rentalStartDate: Date;
    rentalEndDate: Date;
  };
}
export interface SizeInventorySnapshot {
  startDay: Date;
  endDay: Date;
  today: Date;
  assets: InventoryAsset[];
  items: InventoryItem[];
  excludeBookingId?: string;
}

export interface AccessoryInventorySnapshot {
  startDay: Date;
  endDay: Date;
  today: Date;
  assets: InventoryAsset[];
  /** Mỗi dòng = 1 đơn vị phụ kiện (quantity luôn là 1 sau khi tách dòng). */
  rows: Array<{
    booking: {
      id: string;
      status: BookingStatus;
      rentalStartDate: Date;
      rentalEndDate: Date;
    };
  }>;
}

/** Tồn kho phụ kiện theo khoảng ngày: nhu cầu (dòng booking_accessory_items của
 * các đơn còn hiệu lực, trùng ngày) so với sức chứa (asset chưa retired/lost).
 * Mirror logic sizeAvailability nhưng theo accessory_id. */
export async function loadAccessoryInventory(
  client: Prisma.TransactionClient,
  accessoryId: string,
  startDay: Date,
  endDay: Date,
  options: { now?: Date } = {},
): Promise<AccessoryInventorySnapshot> {
  const range = parseRentalDateRange(startDay, endDay);
  const [assets, rows] = await Promise.all([
    client.accessory_assets.findMany({
      where: { accessory_id: accessoryId },
      select: { id: true, status: true },
    }),
    client.bookingAccessoryItem.findMany({
      where: {
        accessoryId,
        booking: {
          status: { notIn: INVENTORY_RELEASED_STATUSES },
          rentalStartDate: { lte: range.endDay },
          rentalEndDate: { gte: range.startDay },
        },
      },
      select: {
        booking: { select: { id: true, status: true, rentalStartDate: true, rentalEndDate: true } },
      },
    }),
  ]);
  return { ...range, assets, rows, today: vietnamToday(options.now) };
}

/** committed là PEAK nhu cầu đồng thời, không phải tổng mọi booking giao nhau. */
export function accessoryAvailability(snapshot: AccessoryInventorySnapshot) {
  const capacity = snapshot.assets.filter((asset) => RENTABLE_ASSET_STATUSES.includes(asset.status)).length;
  const events = new Map<number, number>();
  const addSpan = (start: number, end: number) => {
    const from = Math.max(+snapshot.startDay, start);
    const to = Math.min(+snapshot.endDay, end);
    if (from > to) return;
    events.set(from, (events.get(from) ?? 0) + 1);
    events.set(to + DAY_MS, (events.get(to + DAY_MS) ?? 0) - 1);
  };
  for (const row of snapshot.rows) {
    const booking = row.booking;
    if (INVENTORY_RELEASED_STATUSES.includes(booking.status)) continue;
    let to = +booking.rentalEndDate;
    // Đơn quá hạn chưa trả: nhu cầu kéo dài đến hết cửa sổ tra cứu.
    if (isUnreturnedOverdue(booking, snapshot.today)) to = Math.max(to, +snapshot.endDay);
    addSpan(+booking.rentalStartDate, to);
  }
  const sorted = [...events].sort(([a], [b]) => a - b);
  let occupancy = 0;
  let committed = 0;
  for (const [, delta] of sorted) {
    occupancy += delta;
    committed = Math.max(committed, occupancy);
  }
  return { capacity, committed, available: Math.max(0, capacity - committed) };
}

/** Pass the SAME Serializable transaction client used for the booking write.
 * Load all active assignments, including out-of-window physical owners; otherwise an
 * overdue rental/orphaned hold can be mistaken for stock available after its due date.
 * Validate active size + garment in the caller, inside that transaction for creation.
 */
export async function loadSizeInventory(
  client: Prisma.TransactionClient,
  garmentSizeId: string,
  startDay: Date,
  endDay: Date,
  options: { now?: Date; excludeBookingId?: string } = {},
): Promise<SizeInventorySnapshot> {
  const range = parseRentalDateRange(startDay, endDay);
  const [assets, items] = await Promise.all([
    client.garmentAsset.findMany({
      where: { garment_size_id: garmentSizeId },
      select: { id: true, status: true },
    }),
    client.bookingItem.findMany({
      where: {
        OR: [
          { garment_size_id: garmentSizeId },
          { garment_size_id: null, garmentAsset: { garment_size_id: garmentSizeId } },
        ],
        booking: { status: { notIn: INVENTORY_RELEASED_STATUSES } },
      },
      select: {
        garmentAssetId: true,
        booking: { select: { id: true, status: true, rentalStartDate: true, rentalEndDate: true } },
      },
    }),
  ]);
  return { ...range, assets, items, today: vietnamToday(options.now), excludeBookingId: options.excludeBookingId };
}

/** One event stream drives range and calendar availability. An overdue asset is
 * represented by its extended rental, NOT also subtracted from capacity. Orphaned
 * reserved/rented assets remain unavailable until an operator resolves ownership.
 */
function inventoryEvents(snapshot: SizeInventorySnapshot) {
  const { startDay, endDay, today, assets, excludeBookingId } = snapshot;
  const activeItems = snapshot.items.filter((item) => !INVENTORY_RELEASED_STATUSES.includes(item.booking.status));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const capacity = assets.filter((asset) => RENTABLE_ASSET_STATUSES.includes(asset.status)).length;
  const events = new Map<number, number>();
  const addSpan = (start: number, end: number) => {
    const from = Math.max(+startDay, start);
    const to = Math.min(+endDay, end);
    if (from > to) return;
    events.set(from, (events.get(from) ?? 0) + 1);
    events.set(to + DAY_MS, (events.get(to + DAY_MS) ?? 0) - 1);
  };
  const overdueAssets = new Set<string>();
  for (const item of activeItems) {
    const booking = item.booking;
    if (booking.id === excludeBookingId) continue;
    let from = +booking.rentalStartDate;
    let to = +booking.rentalEndDate;
    if (isUnreturnedOverdue(booking, today)) {
      // The same physically held asset can appear in bad legacy rows. Count that
      // unreturned hold only once; normal future reservations still count separately.
      if (item.garmentAssetId) {
        const asset = assetsById.get(item.garmentAssetId);
        if (asset && !RENTABLE_ASSET_STATUSES.includes(asset.status)) continue;
        if (overdueAssets.has(item.garmentAssetId)) continue;
        overdueAssets.add(item.garmentAssetId);
      }
      to = Math.max(to, +endDay);
    }
    if (item.garmentAssetId && PHYSICAL_HOLD_STATUSES.includes(booking.status)) {
      const asset = assetsById.get(item.garmentAssetId);
      if (asset?.status === AssetStatus.reserved || asset?.status === AssetStatus.rented) {
        from = Math.min(from, +today);
      }
    }
    addSpan(from, to);
  }
  for (const asset of assets) {
    if (asset.status !== AssetStatus.reserved && asset.status !== AssetStatus.rented) continue;
    const owners = activeItems.filter((item) => item.garmentAssetId === asset.id);
    const hasOwner = asset.status === AssetStatus.reserved
      ? owners.length > 0
      : owners.some((item) => UNRETURNED_STATUSES.includes(item.booking.status));
    if (!hasOwner) addSpan(+startDay, +endDay);
  }
  return { capacity, events: [...events].sort(([a], [b]) => a - b) };
}

/** committed is PEAK concurrent item demand, not the sum of every intersecting booking. */
export function sizeAvailability(snapshot: SizeInventorySnapshot) {
  const { capacity, events } = inventoryEvents(snapshot);
  let occupancy = 0;
  let committed = 0;
  for (const [, delta] of events) {
    occupancy += delta;
    committed = Math.max(committed, occupancy);
  }
  return { capacity, committed, available: Math.max(0, capacity - committed) };
}

export function sizeAvailabilityCalendar(snapshot: SizeInventorySnapshot) {
  const { capacity, events } = inventoryEvents(snapshot);
  const days: Array<{ date: string; capacity: number; availableCount: number; available: boolean }> = [];
  let occupancy = 0;
  let cursor = 0;
  for (let day = +snapshot.startDay; day <= +snapshot.endDay; day += DAY_MS) {
    while (cursor < events.length && events[cursor][0] <= day) occupancy += events[cursor++][1];
    const availableCount = Math.max(0, capacity - occupancy);
    days.push({ date: new Date(day).toISOString().slice(0, 10), capacity, availableCount, available: availableCount > 0 });
  }
  return days;
}
