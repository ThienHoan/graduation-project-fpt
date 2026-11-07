import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AppRole, BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PricingService } from "../pricing/pricing.service";
import { RealtimeService } from "../realtime/realtime.service";
import {
  accessoryAvailability,
  loadAccessoryInventory,
  loadSizeInventory,
  sizeAvailability,
  vietnamToday,
} from "./booking-inventory";
import { assertAccessoryAssetScheduleAvailable, assertAssetScheduleAvailable } from "./booking-reservations";

const DAY_MS = 86_400_000;

/** Đơn còn trong kỳ thuê (chưa trả đồ, chưa quá hạn) mới được tự gia hạn. */
export const EXTENDABLE_STATUSES: BookingStatus[] = [
  BookingStatus.paid,
  BookingStatus.preparing,
  BookingStatus.ready_for_pickup,
  BookingStatus.delivering,
  BookingStatus.renting,
];
/** Thời gian giữ lịch chờ khách thanh toán phí gia hạn (trùng hạn link PayOS). */
export const EXTENSION_HOLD_MS = 30 * 60 * 1000;
/** Số ngày tối đa cho một lần gia hạn. */
export const MAX_EXTENSION_DAYS = 7;
const DEFAULT_MAX_RENTAL_DAYS = 30;

export const EXTENSION_STATUS = {
  pending: "pending",
  applied: "applied",
  expired: "expired",
  cancelled: "cancelled",
  failed: "failed",
} as const;

type Client = Prisma.TransactionClient | PrismaService;

type ExtensionBooking = Prisma.BookingGetPayload<{
  include: {
    items: { include: { garment_sizes: { include: { garments: true } } } };
    accessoryItems: { include: { accessory: true } };
  };
}>;

export interface ExtensionQuote {
  previousEndDate: string;
  newEndDate: string;
  extraDays: number;
  amount: number;
  memberDiscount: number;
  lines: Array<{ label: string; amount: number }>;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class BookingExtensionsService {
  private readonly logger = new Logger(BookingExtensionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Khách: báo giá & yêu cầu gia hạn ─────────────────────────────────────────

  /** Báo giá gia hạn (không giữ lịch). Ném lỗi thân thiện nếu không gia hạn được. */
  async quote(customerId: string, bookingId: string, days: number) {
    const booking = await this.loadOwnedBooking(this.prisma, customerId, bookingId);
    return ok(await this.evaluate(this.prisma, booking, days));
  }

  /**
   * Kiểm tra lịch trống và GIỮ LỊCH ngay bằng cách dời ngày trả, trong một
   * transaction Serializable. Thanh toán xong → applied; quá hạn → trả lại ngày cũ.
   */
  async requestExtension(customerId: string, bookingId: string, days: number) {
    const now = new Date();
    return this.prisma.runSerializable(async (tx) => {
      const booking = await this.loadOwnedBooking(tx, customerId, bookingId);
      const pending = await tx.bookingExtension.findFirst({
        where: { bookingId, status: EXTENSION_STATUS.pending },
      });
      if (pending) {
        throw new BadRequestException("Bạn đang có một yêu cầu gia hạn chờ thanh toán. Vui lòng thanh toán hoặc huỷ yêu cầu đó trước.");
      }

      const quote = await this.evaluate(tx, booking, days, now);
      const newEndDate = new Date(quote.newEndDate);
      const held = await tx.booking.updateMany({
        where: { id: bookingId, status: { in: EXTENDABLE_STATUSES }, rentalEndDate: booking.rentalEndDate },
        data: { rentalEndDate: newEndDate },
      });
      if (held.count !== 1) throw new ConflictException("Đơn vừa được cập nhật. Vui lòng thử lại.");

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: booking.status,
          changedBy: customerId,
          note: `Khách yêu cầu gia hạn ${quote.extraDays} ngày (${quote.previousEndDate} → ${quote.newEndDate}) — giữ lịch chờ thanh toán`,
        },
      });
      return tx.bookingExtension.create({
        data: {
          bookingId,
          requestedBy: customerId,
          previousEndDate: booking.rentalEndDate,
          newEndDate,
          extraDays: quote.extraDays,
          amount: quote.amount,
          status: EXTENSION_STATUS.pending,
          expiresAt: new Date(now.getTime() + EXTENSION_HOLD_MS),
        },
      });
    });
  }

  async attachPayment(extensionId: string, paymentId: string, checkoutUrl: string | null) {
    await this.prisma.bookingExtension.update({
      where: { id: extensionId },
      data: { paymentId, checkoutUrl, updatedAt: new Date() },
    });
  }

  /** Không tạo được link thanh toán → bỏ yêu cầu, trả lại ngày cũ ngay. */
  async abortPending(extensionId: string, note: string) {
    return this.releaseHold(extensionId, EXTENSION_STATUS.cancelled, note);
  }

  /** Khách huỷ yêu cầu đang chờ thanh toán → trả lại ngày trả cũ. */
  async cancelPending(customerId: string, bookingId: string) {
    await this.loadOwnedBooking(this.prisma, customerId, bookingId);
    const pending = await this.prisma.bookingExtension.findFirst({
      where: { bookingId, status: EXTENSION_STATUS.pending },
      include: { payment: true },
    });
    if (!pending) throw new NotFoundException("Không có yêu cầu gia hạn nào đang chờ thanh toán.");
    if (pending.payment?.status === PaymentStatus.paid) {
      await this.applyPendingExtension(pending.id);
      throw new BadRequestException("Phí gia hạn đã được thanh toán nên không thể huỷ.");
    }
    const reverted = await this.releaseHold(pending.id, EXTENSION_STATUS.cancelled, "Khách huỷ yêu cầu gia hạn", customerId);
    return ok({ extensionId: pending.id, cancelled: reverted });
  }

  /** Danh sách yêu cầu gia hạn của đơn (mới nhất trước) cho trang khách. */
  async listForCustomer(customerId: string, bookingId: string) {
    await this.loadOwnedBooking(this.prisma, customerId, bookingId);
    const rows = await this.prisma.bookingExtension.findMany({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return ok(rows.map((row) => this.serialize(row)));
  }

  /**
   * WORKSTREAM A: Lịch sử toàn bộ yêu cầu gia hạn của khách hàng qua tất cả các đơn.
   * - Xác thực quyền sở hữu nghiêm ngặt theo customerId từ session.
   * - Trả về đầy đủ ngày trả cũ, ngày trả mới, tình trạng giữ lịch, thanh toán, tên cổ phục.
   */
  async listAllForCustomer(
    customerId: string,
    query?: { page?: number; limit?: number; status?: string; bookingId?: string },
  ) {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(Math.max(1, query?.limit ?? 10), 50);
    const skip = (page - 1) * limit;

    const where: Prisma.BookingExtensionWhereInput = {
      booking: { customerId },
    };

    if (query?.status && query.status !== "all") {
      where.status = query.status;
    }

    if (query?.bookingId) {
      where.bookingId = query.bookingId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.bookingExtension.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              customerId: true,
              status: true,
              rentalStartDate: true,
              rentalEndDate: true,
              items: {
                take: 1,
                include: {
                  garment: { select: { name: true } },
                  garment_sizes: { include: { garments: { select: { name: true } } } },
                },
              },
            },
          },
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.bookingExtension.count({ where }),
    ]);

    const items = rows.map((row) => {
      const garmentName =
        row.booking?.items[0]?.garment?.name ??
        row.booking?.items[0]?.garment_sizes?.garments?.name ??
        "Cổ phục Hoàng thành";
      const isHoldActive =
        row.status === EXTENSION_STATUS.pending && new Date(row.expiresAt).getTime() > Date.now();

      return {
        id: row.id,
        bookingId: row.bookingId,
        bookingCode: (row.booking as any)?.bookingCode ?? row.bookingId.slice(0, 8).toUpperCase(),
        customerId,
        garmentName,
        previousEndDate: iso(row.previousEndDate),
        newEndDate: iso(row.newEndDate),
        extraDays: row.extraDays,
        amount: Number(row.amount),
        status: row.status as "pending" | "applied" | "expired" | "cancelled" | "failed",
        paymentStatus: row.payment?.status ?? (row.status === "applied" ? "paid" : "pending"),
        paymentId: row.paymentId,
        checkoutUrl: isHoldActive ? row.checkoutUrl : null,
        expiresAt: row.expiresAt.toISOString(),
        appliedAt: row.appliedAt?.toISOString() ?? null,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        isHoldActive,
      };
    });

    return ok({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  async findForCustomer(customerId: string, extensionId: string) {
    const extension = await this.prisma.bookingExtension.findUnique({
      where: { id: extensionId },
      include: { booking: { select: { customerId: true } }, payment: true },
    });
    if (!extension) throw new NotFoundException("Không tìm thấy yêu cầu gia hạn.");
    if (extension.booking.customerId !== customerId) throw new ForbiddenException("Bạn không có quyền xem yêu cầu này.");
    return extension;
  }

  // ── Thanh toán & hết hạn ─────────────────────────────────────────────────────

  /**
   * Gọi sau khi một payment chuyển sang `paid` (webhook / đối soát). Không phải
   * payment gia hạn thì bỏ qua. Idempotent: gọi lại không cộng tiền hai lần.
   */
  async handlePaymentPaid(paymentId: string) {
    const extension = await this.prisma.bookingExtension.findUnique({ where: { paymentId } });
    if (!extension) return null;
    if (extension.status === EXTENSION_STATUS.pending) return this.applyPendingExtension(extension.id);
    if (extension.status === EXTENSION_STATUS.expired || extension.status === EXTENSION_STATUS.cancelled) {
      return this.applyLatePayment(extension.id);
    }
    return extension.status;
  }

  /** Cron: yêu cầu quá hạn giữ lịch → đã trả tiền thì áp dụng, chưa trả thì trả lại ngày cũ. */
  async expirePendingExtensions(now = new Date()) {
    const due = await this.prisma.bookingExtension.findMany({
      where: { status: EXTENSION_STATUS.pending, expiresAt: { lt: now } },
      include: { payment: true },
    });
    const applied: string[] = [];
    const expired: string[] = [];
    for (const extension of due) {
      if (extension.payment?.status === PaymentStatus.paid) {
        if ((await this.applyPendingExtension(extension.id)) === EXTENSION_STATUS.applied) applied.push(extension.id);
        continue;
      }
      if (await this.releaseHold(extension.id, EXTENSION_STATUS.expired, "Hết thời gian giữ lịch gia hạn — chưa thanh toán")) {
        expired.push(extension.id);
      }
    }
    return ok({ applied, expired });
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────────

  /** Áp dụng yêu cầu đang giữ lịch (đã thanh toán, hoặc phí = 0). */
  async applyPendingExtension(extensionId: string) {
    const result = await this.prisma.runSerializable(async (tx) => {
      const extension = await tx.bookingExtension.findUnique({ where: { id: extensionId }, include: { booking: true } });
      if (!extension || extension.status !== EXTENSION_STATUS.pending) return null;
      const claimed = await tx.bookingExtension.updateMany({
        where: { id: extensionId, status: EXTENSION_STATUS.pending },
        data: { status: EXTENSION_STATUS.applied, appliedAt: new Date(), updatedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      await tx.booking.update({
        where: { id: extension.bookingId },
        data: { rentalTotal: { increment: extension.amount } },
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: extension.bookingId,
          fromStatus: extension.booking.status,
          toStatus: extension.booking.status,
          note: `Gia hạn thành công đến ${iso(extension.newEndDate)} — đã thanh toán ${Number(extension.amount).toLocaleString("vi-VN")}đ`,
        },
      });
      return extension;
    });
    if (!result) return null;
    await this.notifyApplied(result.bookingId, result.booking.customerId, result.booking.status, result.newEndDate, Number(result.amount));
    return EXTENSION_STATUS.applied;
  }

  /** Tiền về sau khi đã trả lại lịch: còn trống thì vẫn gia hạn, hết chỗ thì báo quản lý hoàn tiền. */
  private async applyLatePayment(extensionId: string) {
    const outcome = await this.prisma.runSerializable(async (tx) => {
      const extension = await tx.bookingExtension.findUnique({ where: { id: extensionId } });
      if (!extension || (extension.status !== EXTENSION_STATUS.expired && extension.status !== EXTENSION_STATUS.cancelled)) {
        return null;
      }
      const booking = await this.loadBooking(tx, extension.bookingId);
      let reason: string | null = null;
      if (+booking.rentalEndDate !== +extension.previousEndDate) {
        reason = "Ngày trả của đơn đã thay đổi";
      } else {
        try {
          await this.evaluate(tx, booking, extension.extraDays);
        } catch (error) {
          if (!(error instanceof BadRequestException || error instanceof ConflictException)) throw error;
          reason = error.message;
        }
      }

      if (reason) {
        await tx.bookingExtension.update({
          where: { id: extensionId },
          data: { status: EXTENSION_STATUS.failed, note: `Tiền về sau khi hết giữ lịch: ${reason}`, updatedAt: new Date() },
        });
        return { applied: false as const, extension, booking, reason };
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: { rentalEndDate: extension.newEndDate, rentalTotal: { increment: extension.amount } },
      });
      await tx.bookingExtension.update({
        where: { id: extensionId },
        data: { status: EXTENSION_STATUS.applied, appliedAt: new Date(), note: "Thanh toán đến sau khi hết giữ lịch — lịch vẫn trống nên gia hạn thành công", updatedAt: new Date() },
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: booking.status,
          note: `Gia hạn thành công đến ${iso(extension.newEndDate)} (thanh toán đến sau khi hết giữ lịch)`,
        },
      });
      return { applied: true as const, extension, booking, reason: null };
    });
    if (!outcome) return null;

    if (outcome.applied) {
      await this.notifyApplied(outcome.booking.id, outcome.booking.customerId, outcome.booking.status, outcome.extension.newEndDate, Number(outcome.extension.amount));
      return EXTENSION_STATUS.applied;
    }
    // Không tự hoàn: mỗi đơn chỉ có 1 phiếu hoàn tiền đang xử lý (dành cho hoàn cọc).
    await this.notifications.notifyStaffBooking({
      templateKey: "booking.staff.extension_refund",
      bookingId: outcome.booking.id,
      amount: Number(outcome.extension.amount).toLocaleString("vi-VN"),
      note: outcome.reason,
      roles: [AppRole.manager_owner],
    });
    return EXTENSION_STATUS.failed;
  }

  /** Trả lại ngày trả cũ cho yêu cầu đang giữ lịch. */
  private async releaseHold(extensionId: string, status: "expired" | "cancelled", note: string, actorId?: string) {
    const released = await this.prisma.runSerializable(async (tx) => {
      const extension = await tx.bookingExtension.findUnique({ where: { id: extensionId }, include: { booking: true } });
      if (!extension || extension.status !== EXTENSION_STATUS.pending) return null;
      const claimed = await tx.bookingExtension.updateMany({
        where: { id: extensionId, status: EXTENSION_STATUS.pending },
        data: { status, note, updatedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      // Chỉ trả ngày cũ nếu chưa ai đổi ngày trả của đơn kể từ lúc giữ lịch.
      await tx.booking.updateMany({
        where: { id: extension.bookingId, rentalEndDate: extension.newEndDate },
        data: { rentalEndDate: extension.previousEndDate },
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: extension.bookingId,
          fromStatus: extension.booking.status,
          toStatus: extension.booking.status,
          changedBy: actorId ?? null,
          note: `${note} — trả lại ngày trả ${iso(extension.previousEndDate)}`,
        },
      });
      return extension;
    });
    if (!released) return false;

    this.realtime.bookingChanged({ id: released.bookingId, bookingId: released.bookingId, status: released.booking.status });
    this.realtime.bookingChangedForCustomer(released.booking.customerId, {
      id: released.bookingId,
      bookingId: released.bookingId,
      status: released.booking.status,
    });
    if (status === EXTENSION_STATUS.expired) {
      await this.notifications.sendBookingNotification({
        userId: released.booking.customerId,
        templateKey: "booking.extension_expired",
        bookingId: released.bookingId,
        endDate: iso(released.previousEndDate),
      });
    }
    return true;
  }

  private async notifyApplied(bookingId: string, customerId: string, status: BookingStatus, newEndDate: Date, amount: number) {
    await this.notifications.sendBookingNotification({
      userId: customerId,
      templateKey: "booking.extension_applied",
      bookingId,
      endDate: iso(newEndDate),
      amount: amount.toLocaleString("vi-VN"),
    });
    this.realtime.bookingChanged({ id: bookingId, bookingId, status });
    this.realtime.bookingChangedForCustomer(customerId, { id: bookingId, bookingId, status });
  }

  private async loadBooking(client: Client, bookingId: string): Promise<ExtensionBooking> {
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: { include: { garment_sizes: { include: { garments: true } } } },
        accessoryItems: { include: { accessory: true } },
      },
    });
    if (!booking) throw new NotFoundException("Không tìm thấy đơn thuê.");
    return booking;
  }

  private async loadOwnedBooking(client: Client, customerId: string, bookingId: string) {
    const booking = await this.loadBooking(client, bookingId);
    if (booking.customerId !== customerId) throw new ForbiddenException("Bạn không có quyền gia hạn đơn này.");
    return booking;
  }

  /**
   * Kiểm tra điều kiện + lịch trống cho phần ngày thêm [ngày trả cũ + 1, ngày trả mới]
   * và tính phí theo đúng bảng giá theo ngày (giá chốt, luật giá) như lúc đặt đơn.
   */
  private async evaluate(
    client: Client,
    booking: ExtensionBooking,
    days: number,
    now = new Date(),
  ): Promise<ExtensionQuote> {
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXTENSION_DAYS) {
      throw new BadRequestException(`Mỗi lần chỉ gia hạn được từ 1 đến ${MAX_EXTENSION_DAYS} ngày.`);
    }
    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new BadRequestException("Chỉ gia hạn được đơn đã thanh toán và chưa trả đồ.");
    }
    const today = vietnamToday(now);
    if (booking.rentalEndDate < today) {
      throw new BadRequestException("Đơn đã quá hạn trả, không thể gia hạn. Vui lòng liên hệ cửa hàng.");
    }

    const maxRentalDays = await this.maxRentalDays(client);
    const currentDays = Math.round((+booking.rentalEndDate - +booking.rentalStartDate) / DAY_MS) + 1;
    if (currentDays + days > maxRentalDays) {
      throw new BadRequestException(`Tổng thời gian thuê tối đa là ${maxRentalDays} ngày.`);
    }

    const extraStart = new Date(+booking.rentalEndDate + DAY_MS);
    const newEnd = new Date(+booking.rentalEndDate + days * DAY_MS);
    await this.assertExtraDaysAvailable(client, booking, extraStart, newEnd);

    // ── Phí gia hạn ──
    const lines: ExtensionQuote["lines"] = [];
    const sizeIds = booking.items.map((item) => item.garment_size_id).filter((id): id is string => Boolean(id));
    const quotes = await this.pricing.quoteRental(sizeIds, extraStart, newEnd);
    let garmentTotal = 0;
    for (const item of booking.items) {
      const quote = item.garment_size_id ? quotes.get(item.garment_size_id) : undefined;
      const amount = Math.round(quote?.rentalTotal ?? Number(item.dailyPrice) * days);
      garmentTotal += amount;
      const label = item.garment_sizes?.garments?.name ?? "Trang phục";
      lines.push({ label: `${label}${item.garment_sizes?.size_label ? ` (size ${item.garment_sizes.size_label})` : ""} × ${days} ngày`, amount });
    }
    // Ưu đãi hạng thành viên áp trên tiền thuê trang phục, giống lúc đặt đơn.
    const customer = await client.userAccount.findUnique({ where: { id: booking.customerId } });
    const tier = (customer as { loyaltyTier?: string } | null)?.loyaltyTier;
    const memberRate = tier === "premium" ? 0.1 : tier === "plus" ? 0.05 : 0;
    const memberDiscount = Math.round(garmentTotal * memberRate);

    let accessoryTotal = 0;
    for (const row of booking.accessoryItems) {
      const amount = Math.round(Number(row.unitPrice) * (row.quantity ?? 1) * days);
      if (amount <= 0) continue;
      accessoryTotal += amount;
      lines.push({ label: `${row.accessory?.name ?? "Phụ kiện"} × ${days} ngày`, amount });
    }
    if (memberDiscount > 0) lines.push({ label: `Ưu đãi thành viên ${tier === "premium" ? "Premium" : "Plus"}`, amount: -memberDiscount });

    return {
      previousEndDate: iso(booking.rentalEndDate),
      newEndDate: iso(newEnd),
      extraDays: days,
      amount: Math.max(0, garmentTotal - memberDiscount + accessoryTotal),
      memberDiscount,
      lines,
    };
  }

  private async assertExtraDaysAvailable(client: Client, booking: ExtensionBooking, extraStart: Date, newEnd: Date) {
    const tx = client as Prisma.TransactionClient;
    const conflict = (name: string) =>
      new BadRequestException(`${name} đã có khách khác đặt trong những ngày bạn muốn gia hạn. Vui lòng chọn ít ngày hơn.`);

    const unassignedBySize = new Map<string, { count: number; name: string }>();
    for (const item of booking.items) {
      const name = item.garment_sizes?.garments?.name ?? "Trang phục";
      if (item.garmentAssetId) {
        try {
          await assertAssetScheduleAvailable(tx, {
            assetId: item.garmentAssetId,
            bookingId: booking.id,
            itemId: item.id,
            startDay: extraStart,
            endDay: newEnd,
            garmentId: item.garmentId,
            garmentSizeId: item.garment_size_id ?? undefined,
          });
        } catch (error) {
          if (error instanceof ConflictException || error instanceof BadRequestException) throw conflict(name);
          throw error;
        }
      } else if (item.garment_size_id) {
        const entry = unassignedBySize.get(item.garment_size_id) ?? { count: 0, name };
        entry.count += 1;
        unassignedBySize.set(item.garment_size_id, entry);
      }
    }
    for (const [sizeId, { count, name }] of unassignedBySize) {
      const { available } = sizeAvailability(await loadSizeInventory(tx, sizeId, extraStart, newEnd));
      if (available < count) throw conflict(name);
    }

    const unassignedAccessories = new Map<string, { count: number; name: string }>();
    for (const row of booking.accessoryItems) {
      const name = row.accessory?.name ?? "Phụ kiện";
      if (row.accessoryAssetId) {
        try {
          await assertAccessoryAssetScheduleAvailable(tx, {
            assetId: row.accessoryAssetId,
            bookingId: booking.id,
            accessoryItemId: row.id,
            accessoryId: row.accessoryId,
            startDay: extraStart,
            endDay: newEnd,
          });
        } catch (error) {
          if (error instanceof ConflictException || error instanceof BadRequestException) throw conflict(name);
          throw error;
        }
      } else {
        const entry = unassignedAccessories.get(row.accessoryId) ?? { count: 0, name };
        entry.count += row.quantity ?? 1;
        unassignedAccessories.set(row.accessoryId, entry);
      }
    }
    for (const [accessoryId, { count, name }] of unassignedAccessories) {
      const { available } = accessoryAvailability(await loadAccessoryInventory(tx, accessoryId, extraStart, newEnd));
      if (available < count) throw conflict(name);
    }
  }

  private async maxRentalDays(client: Client) {
    const setting = await client.systemSetting.findUnique({ where: { key: "max_rental_days" } });
    const raw = setting?.value as unknown;
    const value = Number(raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? (raw as { value: unknown }).value : raw);
    return setting && Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_RENTAL_DAYS;
  }

  serialize(row: {
    id: string;
    bookingId: string;
    previousEndDate: Date;
    newEndDate: Date;
    extraDays: number;
    amount: Prisma.Decimal | number;
    status: string;
    checkoutUrl: string | null;
    expiresAt: Date;
    appliedAt: Date | null;
    note: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      bookingId: row.bookingId,
      previousEndDate: iso(row.previousEndDate),
      newEndDate: iso(row.newEndDate),
      extraDays: row.extraDays,
      amount: Number(row.amount),
      status: row.status,
      checkoutUrl: row.status === EXTENSION_STATUS.pending ? row.checkoutUrl : null,
      expiresAt: row.expiresAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() ?? null,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
