import { Prisma } from "@prisma/client";

/** Bản sao cục bộ để tránh vòng import với booking-inventory (§10). */
const DAY_MS = 86_400_000;

/**
 * Mục 4.4 §10 — giữ chỗ tạm một asset CỤ THỂ cho một yêu cầu đổi đang báo giá.
 *
 * MỌI truy vấn hold phải đi qua hàm này để không nơi nào sót điều kiện
 * `expiresAt > now AND consumedAt IS NULL` (hold đã tiêu thụ vẫn còn hạn nếu bị
 * đếm lại sẽ trùng với `BookingItem` đã trỏ asset đó → thừa demand).
 */
export type ActiveHold = {
  id: string;
  changeRequestId: string;
  bookingId: string;
  kind: string;
  garmentAssetId: string | null;
  accessoryAssetId: string | null;
  startDay: Date;
  endDay: Date;
};

/**
 * Đọc các hold còn "sống" giao với khoảng [from, to].
 *
 * - `excludeBookingId`: bỏ hold thuộc chính đơn đang xét.
 * - `excludeChangeRequestId`: bỏ hold thuộc chính yêu cầu đang xét.
 */
export async function loadActiveHolds(
  client: Prisma.TransactionClient,
  input: {
    from: Date;
    to: Date;
    now?: Date;
    excludeBookingId?: string;
    excludeChangeRequestId?: string;
  },
): Promise<ActiveHold[]> {
  const now = input.now ?? new Date();
  const where: Prisma.BookingChangeHoldWhereInput = {
    expiresAt: { gt: now },
    consumedAt: null,
    startDay: { lte: input.to },
    endDay: { gte: input.from },
  };
  if (input.excludeBookingId) where.bookingId = { not: input.excludeBookingId };
  if (input.excludeChangeRequestId) where.changeRequestId = { not: input.excludeChangeRequestId };
  const rows = await client.bookingChangeHold.findMany({
    where,
    select: {
      id: true,
      changeRequestId: true,
      bookingId: true,
      kind: true,
      garmentAssetId: true,
      accessoryAssetId: true,
      startDay: true,
      endDay: true,
    },
  });
  return rows;
}

/** Hold của MỘT asset cụ thể, đã lọc theo booking/request đang xét. */
export async function loadAssetHolds(
  client: Prisma.TransactionClient,
  input: {
    garmentAssetId?: string;
    accessoryAssetId?: string;
    from: Date;
    to: Date;
    now?: Date;
    excludeBookingId?: string;
    excludeChangeRequestId?: string;
  },
): Promise<ActiveHold[]> {
  const holds = await loadActiveHolds(client, input);
  return holds.filter((hold) =>
    input.garmentAssetId
      ? hold.garmentAssetId === input.garmentAssetId
      : hold.accessoryAssetId === input.accessoryAssetId,
  );
}

/**
 * Dựng span +1 demand cho một hold, dùng chung cho inventory garment lẫn phụ kiện.
 * Trả `null` nếu hold không còn ý nghĩa với khoảng đang tính.
 */
export function holdSpan(
  hold: Pick<ActiveHold, "startDay" | "endDay">,
  bufferDays: number,
): { from: number; to: number } {
  return { from: +hold.startDay, to: +hold.endDay + bufferDays * DAY_MS };
}