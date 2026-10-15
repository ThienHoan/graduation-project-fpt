import { BadRequestException, ConflictException } from "@nestjs/common";
import { AssetStatus, BookingStatus, Prisma } from "@prisma/client";
import {
  INVENTORY_RELEASED_STATUSES, InventoryItem, PHYSICAL_HOLD_STATUSES,
  RENTABLE_ASSET_STATUSES, isUnreturnedOverdue, parseRentalDateRange, vietnamToday,
} from "./booking-inventory";

const ASSIGNMENT_SELECT = {
  id: true,
  bookingId: true,
  garmentAssetId: true,
  booking: { select: { id: true, status: true, rentalStartDate: true, rentalEndDate: true } },
} as const;
type Assignment = InventoryItem & { id: string; bookingId: string };

async function activeAssignments(client: Prisma.TransactionClient, assetId: string): Promise<Assignment[]> {
  return client.bookingItem.findMany({
    where: { garmentAssetId: assetId, booking: { status: { notIn: INVENTORY_RELEASED_STATUSES } } },
    select: ASSIGNMENT_SELECT,
  });
}

/** No owner column exists. Physical workflow states take precedence over future
 * schedules. A legacy reserved asset with exactly one pre-preparing booking is
 * owned by that booking; multiple possible owners must fail closed. */
function physicalOwners(status: AssetStatus, assignments: Assignment[]): string[] {
  if (status !== AssetStatus.reserved && status !== AssetStatus.rented) return [];
  const physical = assignments.filter(({ booking }) => PHYSICAL_HOLD_STATUSES.includes(booking.status));
  const candidates = status === AssetStatus.rented
    ? physical.filter(({ booking }) => booking.status === BookingStatus.renting || booking.status === BookingStatus.overdue)
    : physical.length ? physical : assignments;
  return [...new Set(candidates.map((item) => item.bookingId))];
}

export interface AssetScheduleRequest {
  assetId: string;
  bookingId: string;
  itemId?: string;
  startDay: Date;
  endDay: Date;
  garmentId?: string;
  garmentSizeId?: string;
  now?: Date;
}

export interface AccessoryAssetScheduleRequest {
  assetId: string;
  bookingId: string;
  accessoryItemId?: string;
  accessoryId?: string;
  startDay: Date;
  endDay: Date;
  now?: Date;
}

/** Bản sao của assertAssetScheduleAvailable cho phụ kiện (accessory_assets).
 * Kiểm tra lịch trùng ngày với các đơn khác đang giữ cùng accessory asset. */
export async function assertAccessoryAssetScheduleAvailable(
  client: Prisma.TransactionClient,
  request: AccessoryAssetScheduleRequest,
): Promise<void> {
  const { startDay, endDay } = parseRentalDateRange(request.startDay, request.endDay);
  const asset = await client.accessory_assets.findUnique({ where: { id: request.assetId } });
  if (!asset) throw new BadRequestException("Accessory asset not found.");
  if (!RENTABLE_ASSET_STATUSES.includes(asset.status)) throw new ConflictException("Asset không thể cho thuê.");
  if (request.accessoryId && asset.accessory_id !== request.accessoryId) {
    throw new ConflictException("Asset không thuộc phụ kiện của booking.");
  }
  const assignments = await client.bookingAccessoryItem.findMany({
    where: { accessoryAssetId: asset.id, booking: { status: { notIn: INVENTORY_RELEASED_STATUSES } } },
    select: {
      id: true,
      bookingId: true,
      booking: { select: { id: true, status: true, rentalStartDate: true, rentalEndDate: true } },
    },
  });

  const today = vietnamToday(request.now);
  for (const assignment of assignments) {
    if (assignment.id === request.accessoryItemId) continue;
    if (assignment.bookingId === request.bookingId) {
      throw new ConflictException("Không được gán cùng một accessory asset cho hai món trong một booking.");
    }
    const booking = assignment.booking;
    if (isUnreturnedOverdue(booking, today) || (booking.rentalStartDate <= endDay && booking.rentalEndDate >= startDay)) {
      throw new ConflictException("Accessory asset đã được đơn khác giữ hoặc có lịch thuê trùng ngày.");
    }
  }
}

/** Run inside the assignment write's Serializable transaction. This validates
 * schedules only; never changes an asset's physical status. Same-day boundaries
 * overlap. A future schedule may reuse a normally held asset after its due date,
 * but cannot promise an overdue unreturned asset or one with ambiguous ownership. */
export async function assertAssetScheduleAvailable(
  client: Prisma.TransactionClient,
  request: AssetScheduleRequest,
): Promise<void> {
  const { startDay, endDay } = parseRentalDateRange(request.startDay, request.endDay);
  const asset = await client.garmentAsset.findUnique({ where: { id: request.assetId } });
  if (!asset) throw new BadRequestException("Garment asset not found.");
  if (!RENTABLE_ASSET_STATUSES.includes(asset.status)) throw new ConflictException("Asset không thể cho thuê.");
  if (request.garmentId && asset.garmentId !== request.garmentId) {
    throw new ConflictException("Asset không thuộc mẫu trang phục của booking.");
  }
  if (request.garmentSizeId && asset.garment_size_id !== request.garmentSizeId) {
    throw new ConflictException("Asset không thuộc size của booking.");
  }
  const assignments = await activeAssignments(client, asset.id);

  const today = vietnamToday(request.now);
  for (const assignment of assignments) {
    if (assignment.id === request.itemId) continue;
    if (assignment.bookingId === request.bookingId) {
      throw new ConflictException("Không được gán cùng một asset cho hai item trong một booking.");
    }
    const booking = assignment.booking;
    const physicalStart = PHYSICAL_HOLD_STATUSES.includes(booking.status) && asset.status !== AssetStatus.available
      ? new Date(Math.min(+today, +booking.rentalStartDate)) : booking.rentalStartDate;
    if (isUnreturnedOverdue(booking, today) || (physicalStart <= endDay && booking.rentalEndDate >= startDay)) {
      throw new ConflictException("Asset đã được đơn khác giữ hoặc có lịch thuê trùng ngày.");
    }
  }
}

/** Complete assignment is required before any physical operation. */
async function assignedBooking(client: Prisma.TransactionClient, bookingId: string) {
  const booking = await client.booking.findUnique({ where: { id: bookingId }, include: { items: true } });
  if (!booking) throw new BadRequestException("Booking not found.");
  const ids = booking.items.map((item) => item.garmentAssetId);
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new ConflictException("Booking cần được gán đủ asset riêng biệt trước khi vận hành.");
  }
  return { booking, assetIds: ids as string[] };
}

/** Call BEFORE booking status changes, inside runSerializable. A schedule-only
 * future booking never claims another booking's physical hold. */
export async function claimBookingAssets(client: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const { booking, assetIds } = await assignedBooking(client, bookingId);
  if (![BookingStatus.paid, BookingStatus.preparing, BookingStatus.ready_for_pickup, BookingStatus.delivering].includes(booking.status as never)) {
    throw new ConflictException("Booking chưa ở bước được phép giữ asset.");
  }
  // Compute once for all assets in this booking.
  const today = vietnamToday();
  const { startDay, endDay } = parseRentalDateRange(booking.rentalStartDate, booking.rentalEndDate);
  for (const assetId of assetIds) {
    const asset = await client.garmentAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new ConflictException("Asset không còn tồn tại.");
    const assignments = await activeAssignments(client, assetId);
    // Block only if another booking is physically holding this asset AND their rental
    // period overlaps with ours (or they are unreturned-overdue). Admin may legitimately
    // assign the same physical asset to back-to-back bookings on non-overlapping dates,
    // and claimBookingAssets must honour that decision.
    const conflictingHolder = assignments.find((item) => {
      if (item.bookingId === bookingId) return false;
      if (!PHYSICAL_HOLD_STATUSES.includes(item.booking.status)) return false;
      if (isUnreturnedOverdue(item.booking, today)) return true;
      // Physically held assets extend their start date to today if already reserved/rented.
      const physicalStart = asset.status !== AssetStatus.available
        ? new Date(Math.min(+today, +item.booking.rentalStartDate)) : item.booking.rentalStartDate;
      return physicalStart <= endDay && item.booking.rentalEndDate >= startDay;
    });
    if (conflictingHolder) {
      throw new ConflictException("Asset đang được đơn khác giữ và có lịch thuê trùng ngày.");
    }
    // No conflicting physical holder: if the asset is already reserved and this booking
    // has an active assignment to it, the booking already owns the hold — skip claiming.
    if (asset.status === AssetStatus.reserved && assignments.some((a) => a.bookingId === bookingId)) continue;
    if (asset.status !== AssetStatus.available) throw new ConflictException("Asset không còn khả dụng để giữ.");
    const item = booking.items.find((row) => row.garmentAssetId === assetId)!;
    await assertAssetScheduleAvailable(client, {
      assetId, bookingId, itemId: item.id,
      garmentId: item.garmentId, garmentSizeId: item.garment_size_id ?? undefined,
      startDay: booking.rentalStartDate, endDay: booking.rentalEndDate,
    });
    const claimed = await client.garmentAsset.updateMany({
      where: { id: assetId, status: AssetStatus.available }, data: { status: AssetStatus.reserved },
    });
    if (claimed.count !== 1) throw new ConflictException("Asset đã được đơn khác giữ.");
  }
}

/** Release only this booking's reserved physical holds, BEFORE cancelling it.
 * Future assignments to somebody else's held asset are simply left untouched.
 * Clear this booking's assignment rows separately in the same transaction if needed.
 */
export async function releaseBookingAssets(client: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const items = await client.bookingItem.findMany({ where: { bookingId }, select: { garmentAssetId: true } });
  const ids = new Set(items.map((item) => item.garmentAssetId).filter((id): id is string => Boolean(id)));
  for (const assetId of ids) {
    const asset = await client.garmentAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== AssetStatus.reserved) continue;
    const assignments = await activeAssignments(client, assetId);
    const owners = physicalOwners(asset.status, assignments);
    if (!owners.includes(bookingId)) continue;
    const otherPhysical = assignments.filter(({ booking }) => 
      booking.id !== bookingId && PHYSICAL_HOLD_STATUSES.includes(booking.status)
    );
    if (otherPhysical.length > 0) continue;
    const released = await client.garmentAsset.updateMany({
      where: { id: assetId, status: AssetStatus.reserved }, data: { status: AssetStatus.available },
    });
    if (released.count !== 1) throw new ConflictException("Asset đã thay đổi; không thể giải phóng giữ đồ.");
  }
}

/** Handover/return only: check the current physical owner, not merely the presence
 * of a future BookingItem assignment. Call BEFORE changing booking status. */
export async function transitionBookingAssets(
  client: Prisma.TransactionClient,
  bookingId: string,
  from: AssetStatus,
  to: AssetStatus,
): Promise<void> {
  const quarantineRejected = from === AssetStatus.reserved && to === AssetStatus.damaged;
  if (!((from === AssetStatus.reserved && to === AssetStatus.rented) ||
    (from === AssetStatus.rented && to === AssetStatus.inspection_pending) || quarantineRejected)) {
    throw new BadRequestException("Invalid booking asset transition.");
  }
  const { booking, assetIds } = await assignedBooking(client, bookingId);
  const allowed: BookingStatus[] = quarantineRejected
    ? [BookingStatus.ready_for_pickup, BookingStatus.delivering]
    : from === AssetStatus.reserved
      ? [BookingStatus.ready_for_pickup, BookingStatus.delivering]
      : [BookingStatus.renting, BookingStatus.overdue];
  if (quarantineRejected && booking.handoverStatus !== "REJECTED") {
    throw new ConflictException("Chỉ được cách ly asset khi bàn giao bị từ chối.");
  }
  if (!allowed.includes(booking.status)) throw new ConflictException("Booking không ở bước bàn giao/trả đồ hợp lệ.");
  for (const assetId of assetIds) {
    const asset = await client.garmentAsset.findUnique({ where: { id: assetId } });
    const assignments = await activeAssignments(client, assetId);
    if (!asset || asset.status !== from || !physicalOwners(asset.status, assignments).includes(bookingId)) {
      throw new ConflictException("Booking không sở hữu physical hold của asset này.");
    }
    const changed = await client.garmentAsset.updateMany({ where: { id: assetId, status: from }, data: { status: to } });
    if (changed.count !== 1) throw new ConflictException("Asset đã được thay đổi bởi thao tác khác.");
  }
}
