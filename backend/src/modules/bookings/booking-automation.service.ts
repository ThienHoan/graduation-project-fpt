import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { AppRole, AssetStatus, BookingStatus } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { GarmentsService } from "../garments/garments.service";
import { NotificationsService } from "../notifications/notifications.service";
import { VouchersService } from "../vouchers/vouchers.service";
import type { CreateVoucherDto } from "../vouchers/dto/voucher.dto";
import type { CheckAvailabilityDto } from "./dto/check-availability.dto";
import { AUTO_ASSIGN_LEAD_DAYS, AUTO_ASSIGNABLE_STATUSES } from "./booking-auto-assign";
import { vietnamToday } from "./booking-inventory";
import { BookingsService } from "./bookings.service";

const DAY_MS = 86_400_000;

/** Áo/phụ kiện đã gán nhưng không còn cho thuê được: hỏng/mất/thanh lý luôn phải đổi;
 * bảo trì chỉ đổi khi đơn sắp đến ngày thuê (có thể sửa kịp nếu đơn còn xa). */
const PERMANENTLY_UNAVAILABLE: AssetStatus[] = [AssetStatus.damaged, AssetStatus.retired, AssetStatus.lost];
/** Chỉ đổi cho đơn chưa giữ đồ vật lý (trước bước chuẩn bị). */
const REASSIGNABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
  BookingStatus.paid,
];

const ASSET_STATUS_LABELS: Partial<Record<AssetStatus, string>> = {
  [AssetStatus.maintenance]: "bảo trì",
  [AssetStatus.damaged]: "hư hỏng",
  [AssetStatus.retired]: "ngừng cho thuê",
  [AssetStatus.lost]: "bị mất",
};

type ReleasedAsset = { bookingId: string; assetCode: string; assetStatus: AssetStatus };

export type AlternativeGarment = { garmentId: string; name: string; sizeLabel: string | null };

const MAX_ALTERNATIVES = 3;
const APOLOGY_VOUCHER_VALID_DAYS = 30;
const DEFAULT_APOLOGY_VOUCHER_PERCENT = 20;
const DEFAULT_APOLOGY_VOUCHER_MAX_AMOUNT = 200_000;

@Injectable()
export class BookingAutomationService {
  private readonly logger = new Logger(BookingAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly garments?: GarmentsService,
    @Optional() private readonly vouchers?: VouchersService,
  ) {}

  /**
   * Cron: tìm đơn đang được gán áo/phụ kiện đã hỏng, mất, thanh lý (hoặc đang bảo trì
   * mà đơn sắp tới ngày thuê) → gỡ ra và tự gán chiếc khác cùng mẫu, cùng size.
   * Không còn chiếc thay thế thì báo quản lý để liên hệ khách đổi mẫu.
   */
  async reassignUnavailableAssets(now = new Date()) {
    const horizon = new Date(vietnamToday(now).getTime() + AUTO_ASSIGN_LEAD_DAYS * DAY_MS);
    const bookingFilter = { status: { in: REASSIGNABLE_BOOKING_STATUSES } };

    const [garmentItems, accessoryItems] = await Promise.all([
      this.prisma.bookingItem.findMany({
        where: {
          booking: bookingFilter,
          OR: [
            { garmentAsset: { status: { in: PERMANENTLY_UNAVAILABLE } } },
            { garmentAsset: { status: AssetStatus.maintenance }, booking: { rentalStartDate: { lte: horizon } } },
          ],
        },
        select: { id: true, garmentAssetId: true },
      }),
      this.prisma.bookingAccessoryItem.findMany({
        where: {
          booking: bookingFilter,
          OR: [
            { accessoryAsset: { status: { in: PERMANENTLY_UNAVAILABLE } } },
            { accessoryAsset: { status: AssetStatus.maintenance }, booking: { rentalStartDate: { lte: horizon } } },
          ],
        },
        select: { id: true, accessoryAssetId: true },
      }),
    ]);

    const released: ReleasedAsset[] = [];
    for (const item of garmentItems) {
      const result = await this.releaseGarmentItem(item.id, item.garmentAssetId);
      if (result) released.push(result);
    }
    for (const item of accessoryItems) {
      const result = await this.releaseAccessoryItem(item.id, item.accessoryAssetId);
      if (result) released.push(result);
    }

    const replaced: string[] = [];
    const needsManager: string[] = [];
    const byBooking = new Map<string, ReleasedAsset[]>();
    for (const row of released) byBooking.set(row.bookingId, [...(byBooking.get(row.bookingId) ?? []), row]);

    for (const [bookingId, rows] of byBooking) {
      let complete = false;
      try {
        const result = await this.bookings.autoAssignAssets(bookingId);
        complete = Boolean(result.data?.complete);
      } catch (error) {
        if (!(error instanceof BadRequestException || error instanceof NotFoundException)) throw error;
      }
      if (complete) {
        replaced.push(bookingId);
        continue;
      }
      needsManager.push(bookingId);
      await this.handleNoReplacement(bookingId, rows);
    }

    return ok({ releasedAssets: released.length, replaced, needsManager });
  }

  /**
   * Không còn chiếc cùng size: tìm 2–3 mẫu tương tự còn trống lịch, báo quản lý,
   * xin lỗi khách kèm gợi ý và voucher (nếu admin bật) — khách không phải tự đi hỏi.
   */
  private async handleNoReplacement(bookingId: string, rows: ReleasedAsset[]) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { garment_sizes: { include: { garments: true } } } } },
    });
    if (!booking) return;
    const startDate = booking.rentalStartDate.toISOString().slice(0, 10);
    const endDate = booking.rentalEndDate.toISOString().slice(0, 10);
    // Món trang phục còn thiếu (phụ kiện thiếu thì chỉ cần quản lý xử lý).
    const missingGarment = booking.items.find((item) => !item.garmentAssetId);
    const garmentName = (missingGarment ?? booking.items[0])?.garment_sizes?.garments?.name ?? null;

    const alternatives = missingGarment
      ? await this.findAvailableAlternatives(
        missingGarment.garmentId,
        missingGarment.garment_sizes?.size_label ?? null,
        startDate,
        endDate,
      )
      : [];
    const alternativesText = alternatives.length
      ? `Mẫu tương tự còn trống: ${alternatives.map((alt) => `${alt.name}${alt.sizeLabel ? ` (size ${alt.sizeLabel})` : ""}`).join(", ")}.`
      : null;

    await this.notifications.notifyStaffBooking({
      templateKey: "booking.staff.asset_unavailable",
      bookingId,
      garmentName,
      startDate,
      assetCode: rows.map((row) => `${row.assetCode} (${ASSET_STATUS_LABELS[row.assetStatus] ?? row.assetStatus})`).join(", "),
      note: alternativesText,
      roles: [AppRole.manager_owner],
    });

    if (!missingGarment) return;
    const voucherCode = await this.issueApologyVoucher(bookingId);
    const voucherText = voucherCode ? `Tặng bạn mã ${voucherCode} giảm giá cho lần thuê sau.` : null;
    await this.notifications.sendBookingNotification({
      userId: booking.customerId,
      templateKey: "booking.asset_issue",
      bookingId,
      garmentName,
      startDate,
      endDate,
      note: [alternativesText, voucherText].filter(Boolean).join(" ") || null,
    });
  }

  /** Mẫu tương tự (cùng kiểu, màu, dịp, tầm giá) có cùng size và còn trống đúng ngày thuê. */
  async findAvailableAlternatives(
    garmentId: string,
    sizeLabel: string | null,
    startDate: string,
    endDate: string,
  ): Promise<AlternativeGarment[]> {
    if (!this.garments) return [];
    let similar: Array<{ garmentId: string; name: string }> = [];
    try {
      similar = (await this.garments.findSimilarGarments(garmentId, 8)).data ?? [];
    } catch (error) {
      if (error instanceof NotFoundException) return [];
      throw error;
    }
    if (similar.length === 0) return [];

    const sizes = await this.prisma.garment_sizes.findMany({
      where: {
        garment_id: { in: similar.map((garment) => garment.garmentId) },
        is_active: true,
        ...(sizeLabel ? { size_label: { equals: sizeLabel, mode: "insensitive" as const } } : {}),
      },
      select: { id: true, garment_id: true, size_label: true },
    });

    const result: AlternativeGarment[] = [];
    for (const garment of similar) {
      const size = sizes.find((row) => row.garment_id === garment.garmentId);
      if (!size) continue;
      const query: CheckAvailabilityDto = { garmentSizeId: size.id, startDate, endDate };
      const availability = await this.bookings.checkAvailability(query);
      if (!availability.data?.available) continue;
      result.push({ garmentId: garment.garmentId, name: garment.name, sizeLabel: size.size_label });
      if (result.length >= MAX_ALTERNATIVES) break;
    }
    return result;
  }

  /** Voucher dùng 1 lần, mã gắn với đơn (gọi lại không tạo trùng). Admin đặt 0% để tắt. */
  private async issueApologyVoucher(bookingId: string): Promise<string | null> {
    if (!this.vouchers) return null;
    const percent = await this.settingNumber("asset_issue_voucher_percent", DEFAULT_APOLOGY_VOUCHER_PERCENT);
    if (percent <= 0) return null;
    const maxAmount = await this.settingNumber("asset_issue_voucher_max_amount", DEFAULT_APOLOGY_VOUCHER_MAX_AMOUNT);
    const code = `XINLOI-${bookingId.slice(0, 8).toUpperCase()}`;
    const now = new Date();
    try {
      const voucher: CreateVoucherDto = {
        code,
        name: `Xin lỗi vì sự cố trang phục đơn #${bookingId.slice(0, 8).toUpperCase()}`,
        description: "Voucher tự động tặng khi trang phục đã đặt gặp sự cố và không còn chiếc thay thế.",
        discountType: "percentage",
        discountValue: Math.min(100, percent),
        maxDiscountAmount: maxAmount > 0 ? maxAmount : null,
        usageLimit: 1,
        perUserLimit: 1,
        startAt: now.toISOString(),
        endAt: new Date(now.getTime() + APOLOGY_VOUCHER_VALID_DAYS * DAY_MS).toISOString(),
      };
      await this.vouchers.create(voucher);
      return code;
    } catch (error) {
      // Đã tặng cho đơn này trước đó → dùng lại mã cũ.
      if (error instanceof ConflictException) return code;
      this.logger.warn(`Không tạo được voucher xin lỗi cho đơn ${bookingId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async settingNumber(key: string, fallback: number): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    const raw = setting?.value as unknown;
    const value = Number(raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? (raw as { value: unknown }).value : raw);
    return setting && Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private async releaseGarmentItem(itemId: string, expectedAssetId: string | null): Promise<ReleasedAsset | null> {
    if (!expectedAssetId) return null;
    return this.prisma.runSerializable(async (tx) => {
      const item = await tx.bookingItem.findUnique({
        where: { id: itemId },
        include: { booking: true, garmentAsset: true },
      });
      if (!item?.garmentAsset || item.garmentAssetId !== expectedAssetId) return null;
      if (!REASSIGNABLE_BOOKING_STATUSES.includes(item.booking.status)) return null;
      if (!ASSET_STATUS_LABELS[item.garmentAsset.status]) return null;

      const cleared = await tx.bookingItem.updateMany({
        where: { id: itemId, garmentAssetId: expectedAssetId },
        data: { garmentAssetId: null },
      });
      if (cleared.count !== 1) return null;
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: item.bookingId,
          fromStatus: item.booking.status,
          toStatus: item.booking.status,
          note: `Hệ thống gỡ asset ${item.garmentAsset.assetCode} (đang ${ASSET_STATUS_LABELS[item.garmentAsset.status]}) để đổi chiếc khác cùng size`,
        },
      });
      return { bookingId: item.bookingId, assetCode: item.garmentAsset.assetCode, assetStatus: item.garmentAsset.status };
    });
  }

  private async releaseAccessoryItem(itemId: string, expectedAssetId: string | null): Promise<ReleasedAsset | null> {
    if (!expectedAssetId) return null;
    return this.prisma.runSerializable(async (tx) => {
      const item = await tx.bookingAccessoryItem.findUnique({
        where: { id: itemId },
        include: { booking: true, accessoryAsset: true },
      });
      if (!item?.accessoryAsset || item.accessoryAssetId !== expectedAssetId) return null;
      if (!REASSIGNABLE_BOOKING_STATUSES.includes(item.booking.status)) return null;
      if (!ASSET_STATUS_LABELS[item.accessoryAsset.status]) return null;

      const cleared = await tx.bookingAccessoryItem.updateMany({
        where: { id: itemId, accessoryAssetId: expectedAssetId },
        data: { accessoryAssetId: null },
      });
      if (cleared.count !== 1) return null;
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: item.bookingId,
          fromStatus: item.booking.status,
          toStatus: item.booking.status,
          note: `Hệ thống gỡ phụ kiện ${item.accessoryAsset.asset_code} (đang ${ASSET_STATUS_LABELS[item.accessoryAsset.status]}) để đổi chiếc khác`,
        },
      });
      return { bookingId: item.bookingId, assetCode: item.accessoryAsset.asset_code, assetStatus: item.accessoryAsset.status };
    });
  }

  /**
   * Cron 07h30: bản tin cho nhân viên + quản lý, chỉ liệt kê những việc hệ thống
   * KHÔNG tự xử lý được. Không có ngoại lệ nào thì không gửi.
   */
  async sendStaffDailyDigest(now = new Date()) {
    const today = vietnamToday(now);
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const [missingAssets, notReady, pendingConfirm, overdue] = await Promise.all([
      this.prisma.booking.count({
        where: {
          status: { in: AUTO_ASSIGNABLE_STATUSES },
          rentalStartDate: { lte: tomorrow },
          OR: [
            { items: { some: { garmentAssetId: null } } },
            { accessoryItems: { some: { accessoryAssetId: null } } },
          ],
        },
      }),
      this.prisma.booking.count({
        where: { status: { in: [BookingStatus.paid, BookingStatus.preparing] }, rentalStartDate: { lte: today } },
      }),
      this.prisma.booking.count({ where: { status: BookingStatus.pending_confirmation, paymentMethod: "cash" } }),
      this.prisma.booking.count({ where: { status: BookingStatus.overdue } }),
    ]);
    const counts = { missingAssets, notReady, pendingConfirm, overdue };
    const total = missingAssets + notReady + pendingConfirm + overdue;
    if (total === 0) return ok({ sent: false, ...counts });

    await this.notifications.notifyRoles({
      roles: [AppRole.staff, AppRole.manager_owner],
      templateKey: "staff.daily_digest",
      data: { ...counts, date: today.toISOString().slice(0, 10) },
    });
    return ok({ sent: true, ...counts });
  }

  /**
   * Cron 10h00: mời khách đánh giá các đơn vừa hoàn tất trong 24 giờ qua mà chưa
   * có đánh giá. Cửa sổ 24h trượt theo lịch chạy nên mỗi đơn chỉ được mời một lần.
   */
  async sendReviewInvitations(now = new Date()) {
    const windowStart = new Date(now.getTime() - DAY_MS);
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.completed,
        reviews: { none: {} },
        statusHistory: { some: { toStatus: BookingStatus.completed, createdAt: { gte: windowStart, lt: now } } },
      },
      include: { items: { include: { garment_sizes: { include: { garments: true } } } } },
    });

    for (const booking of bookings) {
      await this.notifications.sendBookingNotification({
        userId: booking.customerId,
        templateKey: "booking.review_invite",
        bookingId: booking.id,
        garmentName: booking.items[0]?.garment_sizes?.garments?.name ?? null,
        startDate: booking.rentalStartDate.toISOString().slice(0, 10),
        endDate: booking.rentalEndDate.toISOString().slice(0, 10),
      });
    }
    return ok({ invitedCount: bookings.length, bookings: bookings.map((b) => b.id) });
  }
}
