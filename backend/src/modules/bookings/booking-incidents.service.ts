import { BadRequestException, ConflictException, Injectable, Logger, Optional, Inject, forwardRef } from "@nestjs/common";
import { BookingStatus, Prisma } from "@prisma/client";
import { AppRole } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertAssetScheduleAvailable, assertAccessoryAssetScheduleAvailable } from "./booking-reservations";
import { vietnamToday, DAY_MS, RENTABLE_ASSET_STATUSES } from "./booking-inventory";
import { BookingsService } from "./bookings.service";
import { assetNotReadyReason, incidentReasonLabel } from "./booking-incidents.helper";
import {
  INCIDENT_ELIGIBLE_STATUSES,
  INCIDENT_SCAN_BATCH_SIZE,
  INCIDENT_SCAN_WINDOW_DAYS,
} from "./booking-incidents.constants";
import { AUTO_ASSIGNABLE_STATUSES } from "./booking-auto-assign";

export type ScanResult = { scanned: number; opened: number; resolved: number };

type IncidentSnapshot = {
  name: string;
  sizeLabel: string | null;
  imageUrl: string | null;
  dailyPrice: number;
  depositAmount: number;
  lineRental: number;
  /** Số lượng của dòng bị sự cố (trang phục luôn 1; phụ kiện theo `quantity`). */
  quantity: number;
  estimated: boolean;
};

/** Hàm lõi phát hiện sự cố trang phục/phụ kiện trước bàn giao (mục 4.4). */
@Injectable()
export class BookingIncidentsService {
  private readonly logger = new Logger(BookingIncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() @Inject(forwardRef(() => BookingsService)) private readonly bookings?: BookingsService,
  ) {}

  /**
   * Cron 30 phút/lần (dùng lại đúng hàm của nút "Quét ngay"). Tắt bằng env
   * `INCIDENT_SCAN_ENABLED=false` (đọc ở `BookingsScheduler.runIncidentScan`),
   * ở đây chỉ thực thi.
   */
  async scanIncidents(now = new Date()): Promise<ScanResult> {
    const today = vietnamToday(now);
    const horizon = new Date(today.getTime() + INCIDENT_SCAN_WINDOW_DAYS * DAY_MS);
    const bookings = await this.prisma.booking.findMany({
      // Cửa sổ = [hôm nay, hôm nay + N ngày]. Đơn đã qua ngày thuê (kẹt trạng thái
      // cũ) KHÔNG thuộc phạm vi đổi mẫu nữa — thiếu `gte` sẽ quét cả đơn quá hạn.
      where: {
        status: { in: INCIDENT_ELIGIBLE_STATUSES },
        rentalStartDate: { gte: today, lte: horizon },
      },
      select: { id: true },
      take: INCIDENT_SCAN_BATCH_SIZE,
    });

    let opened = 0;
    let resolved = 0;
    for (const booking of bookings) {
      try {
        const result = await this.evaluateBooking(booking.id, now);
        opened += result.opened;
        resolved += result.resolved;
      } catch (error) {
        this.logger.error(
          `Lỗi khi quét sự cố cho đơn ${booking.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { scanned: bookings.length, opened, resolved };
  }

  /**
   * Đánh giá một đơn và mở/đóng sự cố cho từng món. Gọi SAU commit, KHÔNG nằm
   * trong transaction (việc mở sự cố không được làm hỏng giao dịch tạo/sửa đơn).
   */
  async evaluateBooking(bookingId: string, now = new Date()): Promise<{ opened: number; resolved: number }> {
    const today = vietnamToday(now);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true, accessoryItems: true },
    });
    if (!booking || !INCIDENT_ELIGIBLE_STATUSES.includes(booking.status)) return { opened: 0, resolved: 0 };
    const horizon = new Date(today.getTime() + INCIDENT_SCAN_WINDOW_DAYS * DAY_MS);
    // Chỉ đơn sắp bàn giao (từ hôm nay tới hôm nay + N ngày). Đơn đã qua ngày thuê
    // vẫn có thể kẹt ở trạng thái trước bàn giao — không mở sự cố đổi mẫu cho chúng.
    if (booking.rentalStartDate < today || booking.rentalStartDate > horizon) {
      return { opened: 0, resolved: 0 };
    }

    // Đơn thiếu asset: thử tự gán MỘT lần cho cả đơn (gán luôn cả phụ kiện). Chỉ
    // trạng thái cho phép mới gọi — `pending_confirmation`/`ready_for_pickup` không
    // tự gán được, gọi vào chỉ sinh WARN vô ích cho từng món.
    const needsAutoAssign =
      booking.items.some((item) => !item.garmentAssetId) ||
      booking.accessoryItems.some((accessory) => !accessory.accessoryAssetId);
    if (needsAutoAssign && this.bookings && AUTO_ASSIGNABLE_STATUSES.includes(booking.status)) {
      try {
        await this.bookings.autoAssignAssets(booking.id);
      } catch (error) {
        this.logger.warn(
          `Tự gán asset cho đơn ${booking.id} thất bại: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Món ĐANG gán một asset không cho thuê được nhưng kho còn chiếc khác cùng
    // size/mẫu và trống lịch → thay luôn, KHÔNG mở sự cố. Chỉ món hết chiếc thay
    // thế mới thành sự cố cho khách/manager xử lý.
    if (AUTO_ASSIGNABLE_STATUSES.includes(booking.status)) {
      try {
        await this.autoReplaceUnavailableAssets(booking, now);
      } catch (error) {
        // Không để lỗi thay asset làm hỏng cả vòng quét: vẫn đánh giá sự cố bên dưới.
        this.logger.warn(
          `Tự thay asset cho đơn ${booking.id} thất bại: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    let opened = 0;
    let resolved = 0;
    for (const item of booking.items) {
      const outcome = await this.evaluateItem(booking, item, now);
      opened += outcome.opened;
      resolved += outcome.resolved;
    }
    for (const accessory of booking.accessoryItems) {
      const outcome = await this.evaluateAccessory(booking, accessory, now);
      opened += outcome.opened;
      resolved += outcome.resolved;
    }
    return { opened, resolved };
  }

  /**
   * Quét: tự THAY asset đang gán nếu asset đó không còn cho thuê được nhưng kho
   * còn chiếc khác cùng size (trang phục) / cùng `accessory_id` (phụ kiện) và
   * trống lịch. Giá không đổi vì cùng size/mẫu phụ kiện.
   *
   * Chỉ chạy ở trạng thái còn tự gán được (`confirmed` → `preparing`); đơn
   * `ready_for_pickup` đã đóng gói nên để manager quyết định.
   *
   * Trả về số món đã thay. Món không kiếm được chiếc thay thế giữ nguyên asset cũ
   * → vòng `evaluateItem`/`evaluateAccessory` sẽ mở sự cố như trước.
   */
  private async autoReplaceUnavailableAssets(
    booking: {
      id: string;
      status: BookingStatus;
      rentalStartDate: Date;
      rentalEndDate: Date;
      items: Array<{ id: string; garmentId: string; garment_size_id: string | null }>;
      accessoryItems: Array<{ id: string; accessoryId: string }>;
    },
    now: Date,
  ): Promise<number> {
    // Khách đang có yêu cầu đổi chờ xác nhận → không đổi asset sau lưng họ
    // (yêu cầu đó đang giữ chỗ asset, đổi ngầm sẽ làm lệch báo giá).
    const pendingRequest = await this.prisma.bookingChangeRequest.findFirst({
      where: { bookingId: booking.id, status: { in: ["quoted", "awaiting_payment"] } },
      select: { id: true },
    });
    if (pendingRequest) return 0;

    let replaced = 0;

    // ── Trang phục ────────────────────────────────────────────────────────
    const currentGarmentAssets = new Map<string, string | null>();
    const usedGarmentAssets = new Set<string>();
    for (const item of booking.items) {
      const assetId =
        (await this.prisma.bookingItem.findUnique({
          where: { id: item.id },
          select: { garmentAssetId: true },
        }))?.garmentAssetId ?? null;
      currentGarmentAssets.set(item.id, assetId);
      if (assetId) usedGarmentAssets.add(assetId);
    }

    for (const item of booking.items) {
      const currentId = currentGarmentAssets.get(item.id) ?? null;
      // Thiếu asset hoàn toàn do `autoAssignAssets` lo, không phải "thay thế".
      if (!currentId || !item.garment_size_id) continue;
      const current = await this.prisma.garmentAsset.findUnique({ where: { id: currentId } });
      if (current && RENTABLE_ASSET_STATUSES.includes(current.status)) continue;

      const candidates = await this.prisma.garmentAsset.findMany({
        where: {
          garmentId: item.garmentId,
          garment_size_id: item.garment_size_id,
          status: { in: RENTABLE_ASSET_STATUSES },
        },
        select: { id: true, assetCode: true },
        orderBy: { assetCode: "asc" },
        take: 20,
      });
      for (const candidate of candidates) {
        if (usedGarmentAssets.has(candidate.id)) continue;
        try {
          await this.prisma.$transaction((tx) =>
            assertAssetScheduleAvailable(tx, {
              assetId: candidate.id,
              bookingId: booking.id,
              itemId: item.id,
              garmentId: item.garmentId,
              garmentSizeId: item.garment_size_id ?? undefined,
              startDay: booking.rentalStartDate,
              endDay: booking.rentalEndDate,
              now,
            }),
          );
        } catch (error) {
          if (error instanceof ConflictException || error instanceof BadRequestException) continue;
          throw error;
        }
        await this.prisma.bookingItem.update({
          where: { id: item.id },
          data: { garmentAssetId: candidate.id },
        });
        usedGarmentAssets.add(candidate.id);
        replaced += 1;
        await this.recordAutoReplacement(
          booking,
          `Tự động thay trang phục ${current?.assetCode ?? currentId} → ${candidate.assetCode} (asset cũ không sẵn sàng)`,
        );
        break;
      }
    }

    // ── Phụ kiện ──────────────────────────────────────────────────────────
    const currentAccessoryAssets = new Map<string, string | null>();
    const usedAccessoryAssets = new Set<string>();
    for (const row of booking.accessoryItems) {
      const assetId =
        (await this.prisma.bookingAccessoryItem.findUnique({
          where: { id: row.id },
          select: { accessoryAssetId: true },
        }))?.accessoryAssetId ?? null;
      currentAccessoryAssets.set(row.id, assetId);
      if (assetId) usedAccessoryAssets.add(assetId);
    }

    for (const row of booking.accessoryItems) {
      const currentId = currentAccessoryAssets.get(row.id) ?? null;
      if (!currentId) continue; // `autoAssignAssets` đã lo phần thiếu asset.
      const current = await this.prisma.accessory_assets.findUnique({ where: { id: currentId } });
      if (current && RENTABLE_ASSET_STATUSES.includes(current.status)) continue;

      const candidates = await this.prisma.accessory_assets.findMany({
        where: { accessory_id: row.accessoryId, status: { in: RENTABLE_ASSET_STATUSES } },
        select: { id: true, asset_code: true },
        orderBy: { asset_code: "asc" },
        take: 20,
      });
      for (const candidate of candidates) {
        if (usedAccessoryAssets.has(candidate.id)) continue;
        try {
          await this.prisma.$transaction((tx) =>
            assertAccessoryAssetScheduleAvailable(tx, {
              assetId: candidate.id,
              bookingId: booking.id,
              accessoryItemId: row.id,
              accessoryId: row.accessoryId,
              startDay: booking.rentalStartDate,
              endDay: booking.rentalEndDate,
              now,
            }),
          );
        } catch (error) {
          if (error instanceof ConflictException || error instanceof BadRequestException) continue;
          throw error;
        }
        await this.prisma.bookingAccessoryItem.update({
          where: { id: row.id },
          data: { accessoryAssetId: candidate.id },
        });
        usedAccessoryAssets.add(candidate.id);
        replaced += 1;
        await this.recordAutoReplacement(
          booking,
          `Tự động thay phụ kiện ${current?.asset_code ?? currentId} → ${candidate.asset_code} (asset cũ không sẵn sàng)`,
        );
        break;
      }
    }

    return replaced;
  }

  /** Ghi lịch sử để staff biết asset bị đổi tự động khi quét. */
  private async recordAutoReplacement(
    booking: { id: string; status: BookingStatus },
    note: string,
  ): Promise<void> {
    try {
      await this.prisma.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: booking.status,
          note,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Không ghi được lịch sử thay asset cho đơn ${booking.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async evaluateItem(
    booking: { id: string; customerId: string; rentalStartDate: Date; rentalEndDate: Date },
    item: { id: string; garmentAssetId: string | null; garmentId: string; depositAmount: Prisma.Decimal; dailyPrice: Prisma.Decimal; garment_size_id: string | null },
    now: Date,
  ): Promise<{ opened: number; resolved: number }> {
    const dedupeKey = `g:${item.id}`;

    const assetId = (await this.prisma.bookingItem.findUnique({ where: { id: item.id }, select: { garmentAssetId: true } }))?.garmentAssetId ?? null;

    let reason: string | null = null;
    let assetCode: string | null = null;
    if (!assetId) {
      reason = "no_asset_available";
    } else {
      const asset = await this.prisma.garmentAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        reason = "no_asset_available";
      } else {
        // Bất kỳ trạng thái nào không cho thuê được (hỏng/mất/ngừng/bảo trì/giặt/
        // chờ kiểm tra…) đều là sự cố — không chỉ riêng 4 trạng thái hỏng/mất.
        reason = assetNotReadyReason(asset.status, "garment");
        if (reason) {
          assetCode = asset.assetCode;
        } else {
          try {
            await this.prisma.$transaction((tx) =>
              assertAssetScheduleAvailable(tx, {
                assetId,
                bookingId: booking.id,
                itemId: item.id,
                garmentId: item.garmentId,
                garmentSizeId: item.garment_size_id ?? undefined,
                startDay: booking.rentalStartDate,
                endDay: booking.rentalEndDate,
                now,
              }),
            );
          } catch (error) {
            if (error instanceof ConflictException) {
              reason = "asset_conflict";
              assetCode = asset.assetCode;
            } else {
              throw error;
            }
          }
        }
      }
    }

    return this.applyIncident(booking, {
      dedupeKey,
      itemKind: "garment",
      bookingItemId: item.id,
      bookingAccessoryItemId: null,
      reason,
      assetId,
      assetCode,
    }, item);
  }

  private async evaluateAccessory(
    booking: { id: string; customerId: string; rentalStartDate: Date; rentalEndDate: Date },
    accessory: { id: string; accessoryAssetId: string | null; accessoryId: string },
    now: Date,
  ): Promise<{ opened: number; resolved: number }> {
    const dedupeKey = `a:${accessory.id}`;
    let reason: string | null = null;

    // `autoAssignAssets` (chạy trước vòng lặp) có thể vừa gán asset cho phụ kiện này.
    // Phải đọc lại từ DB, nếu không sẽ mở sự cố "không có phụ kiện" giả.
    const assetId =
      (await this.prisma.bookingAccessoryItem.findUnique({
        where: { id: accessory.id },
        select: { accessoryAssetId: true },
      }))?.accessoryAssetId ?? null;
    let assetCode: string | null = null;

    if (!assetId) {
      reason = "accessory_unavailable";
    } else {
      const asset = await this.prisma.accessory_assets.findUnique({ where: { id: assetId } });
      if (!asset) {
        reason = "accessory_unavailable";
      } else {
        // Phụ kiện cũng phải ở trạng thái cho thuê; mọi trạng thái khác là sự cố.
        reason = assetNotReadyReason(asset.status, "accessory");
        if (reason) {
          assetCode = asset.asset_code;
        } else {
          try {
            await this.prisma.$transaction((tx) =>
              assertAccessoryAssetScheduleAvailable(tx, {
                assetId: asset.id,
                bookingId: booking.id,
                accessoryItemId: accessory.id,
                accessoryId: accessory.accessoryId,
                startDay: booking.rentalStartDate,
                endDay: booking.rentalEndDate,
                now,
              }),
            );
          } catch (error) {
            if (error instanceof ConflictException) {
              reason = "asset_conflict";
              assetCode = asset.asset_code;
            } else {
              throw error;
            }
          }
        }
      }
    }

    return this.applyIncident(booking, {
      dedupeKey,
      itemKind: "accessory",
      bookingItemId: null,
      bookingAccessoryItemId: accessory.id,
      reason,
      assetId,
      assetCode,
    }, null);
  }

  /**
   * Mở sự cố nếu `reason` khác null (bắt P2002 để không báo trùng), hoặc đóng sự
   * cố đang mở khi reason trở lại null (asset hồi). Chỉ thông báo khi VỪA mở.
   */
  private async applyIncident(
    booking: { id: string; customerId: string; rentalStartDate: Date; rentalEndDate: Date },
    incident: {
      dedupeKey: string;
      itemKind: "garment" | "accessory";
      bookingItemId: string | null;
      bookingAccessoryItemId: string | null;
      reason: string | null;
      assetId: string | null;
      assetCode: string | null;
    },
    item: { depositAmount: Prisma.Decimal; dailyPrice: Prisma.Decimal } | null,
  ): Promise<{ opened: number; resolved: number }> {
    const open = await this.prisma.bookingIncident.findFirst({
      where: { dedupeKey: incident.dedupeKey, status: { in: ["open", "awaiting_customer", "needs_manager"] } },
    });

    if (incident.reason === null) {
      if (!open) return { opened: 0, resolved: 0 };
      await this.prisma.bookingIncident.update({
        where: { id: open.id },
        data: { status: "resolved", resolution: "asset_recovered", resolvedAt: new Date() },
      });
      return { opened: 0, resolved: 1 };
    }

    if (open) return { opened: 0, resolved: 0 };

    const snapshot = await this.buildSnapshot(incident, item, booking);
    let created: { id: string } | null = null;
    try {
      created = await this.prisma.bookingIncident.create({
        data: {
          bookingId: booking.id,
          itemKind: incident.itemKind,
          bookingItemId: incident.bookingItemId,
          bookingAccessoryItemId: incident.bookingAccessoryItemId,
          dedupeKey: incident.dedupeKey,
          reason: incident.reason,
          assetId: incident.assetId,
          assetCode: incident.assetCode,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          status: "awaiting_customer",
          dueAt: booking.rentalStartDate,
        },
      });
    } catch (error) {
      // P2002: một sự cố đang mở đã tồn tại (đua giữa 2 vòng quét) → coi như đã có.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { opened: 0, resolved: 0 };
      }
      throw error;
    }

    await this.prisma.bookingIncident.update({
      where: { id: created.id },
      data: { notifiedAt: new Date() },
    });
    await this.notifyIncident(booking, incident.reason, snapshot.name, incident.itemKind);
    return { opened: 1, resolved: 0 };
  }

  private async buildSnapshot(
    incident: { itemKind: "garment" | "accessory"; bookingItemId: string | null; bookingAccessoryItemId: string | null },
    item: { depositAmount: Prisma.Decimal; dailyPrice: Prisma.Decimal } | null,
    booking: { rentalStartDate: Date; rentalEndDate: Date },
  ): Promise<IncidentSnapshot> {
    if (incident.itemKind === "garment" && incident.bookingItemId) {
      const row = await this.prisma.bookingItem.findUnique({
        where: { id: incident.bookingItemId },
        include: { garment_sizes: { include: { garments: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } } } } },
      });
      const days = Math.max(1, Math.round((+booking.rentalEndDate - +booking.rentalStartDate) / DAY_MS) + 1);
      const dailyPrice = Number(row?.dailyPrice ?? item?.dailyPrice ?? 0);
      return {
        name: row?.garment_sizes?.garments?.name ?? "Trang phục",
        sizeLabel: row?.garment_sizes?.size_label ?? null,
        imageUrl: row?.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
        dailyPrice,
        depositAmount: Number(row?.depositAmount ?? item?.depositAmount ?? 0),
        lineRental: dailyPrice * days,
        quantity: 1,
        estimated: true,
      };
    }
    const accessory = incident.bookingAccessoryItemId
      ? await this.prisma.bookingAccessoryItem.findUnique({
          where: { id: incident.bookingAccessoryItemId },
          include: { accessory: true },
        })
      : null;
    return {
      name: accessory?.accessory?.name ?? "Phụ kiện",
      sizeLabel: null,
      imageUrl: accessory?.accessory?.image_url ?? null,
      dailyPrice: 0,
      depositAmount: 0,
      lineRental: Number(accessory?.rentalTotal ?? 0),
      quantity: Number(accessory?.quantity ?? 1),
      estimated: true,
    };
  }

  private async notifyIncident(
    booking: { id: string; customerId: string; rentalStartDate: Date },
    reason: string,
    garmentName: string,
    itemKind: "garment" | "accessory",
  ): Promise<void> {
    const startDate = new Date(booking.rentalStartDate).toISOString().slice(0, 10);
    const link = `/booking/incidents/${booking.id}`;
    try {
      await this.notifications.sendBookingNotification({
        userId: booking.customerId,
        templateKey: "booking.incident_action_required",
        bookingId: booking.id,
        garmentName: itemKind === "garment" ? garmentName : "phụ kiện",
        startDate,
        note: incidentReasonLabel(reason, itemKind),
        linkUrl: link,
      });
      await this.notifications.notifyStaffBooking({
        templateKey: "booking.staff.incident_open",
        bookingId: booking.id,
        garmentName,
        startDate,
        roles: [AppRole.manager_owner],
        linkUrl: "/dashboard/manager/incidents",
        extra: { reason: incidentReasonLabel(reason, itemKind) },
      });
    } catch (error) {
      this.logger.warn(
        `Không gửi được thông báo sự cố cho đơn ${booking.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Endpoint demo `POST /bookings/staff/incidents/run-scan`. */
  async runScan() {
    const result = await this.scanIncidents();
    return ok(result);
  }
}
