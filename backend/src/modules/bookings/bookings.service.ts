import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppRole, AssetStatus, BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LocationsService } from "../locations/locations.service";
import type { CheckAvailabilityDto } from "./dto/check-availability.dto";
import type { CreateBookingDto } from "./dto/create-booking.dto";
import type { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";
import type { AssignAssetDto } from "./dto/assign-asset.dto";
import type { MarkPaidDto } from "./dto/mark-paid.dto";

const BOOKING_STATUS_LABELS: Record<string, string> = {
  draft: "Nháp",
  pending_confirmation: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  awaiting_payment: "Chờ thanh toán",
  paid: "Đã thanh toán",
  preparing: "Đang chuẩn bị",
  ready_for_pickup: "Sẵn sàng nhận",
  delivering: "Đang giao",
  renting: "Đang thuê",
  returned: "Đã trả",
  inspection_pending: "Chờ kiểm tra",
  refund_pending: "Chờ hoàn cọc",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  rejected: "Từ chối",
  overdue: "Quá hạn",
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const OVERDUE_FEE_PER_DAY = 10_000;
const OVERDUE_PENALTY_REASON = "Phí quá hạn trả đồ (10.000đ/ngày)";

const RELEASED_STATUSES: BookingStatus[] = [
  BookingStatus.cancelled,
  BookingStatus.rejected,
  // refund_pending: đồ đã trả & kiểm tra xong, chỉ còn chờ hoàn cọc — không giữ hàng nữa.
  BookingStatus.refund_pending,
  BookingStatus.completed,
  BookingStatus.returned,
  BookingStatus.inspection_pending,
];

const CANCELLABLE_STATUSES: BookingStatus[] = [
  BookingStatus.draft,
  BookingStatus.pending_confirmation,
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
];

const RETURN_QUEUE_STATUSES: BookingStatus[] = [
  BookingStatus.returned,
  BookingStatus.inspection_pending,
  BookingStatus.overdue,
];

const ASSET_REQUIRED_STATUSES: BookingStatus[] = [
  BookingStatus.ready_for_pickup,
  BookingStatus.delivering,
  BookingStatus.renting,
];

const STAFF_ALLOWED_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.pending_confirmation]: [BookingStatus.awaiting_payment, BookingStatus.confirmed, BookingStatus.rejected],
  [BookingStatus.confirmed]: [BookingStatus.awaiting_payment, BookingStatus.cancelled],
  [BookingStatus.awaiting_payment]: [BookingStatus.paid],
  [BookingStatus.paid]: [BookingStatus.preparing],
  [BookingStatus.preparing]: [BookingStatus.ready_for_pickup],
  [BookingStatus.ready_for_pickup]: [BookingStatus.delivering, BookingStatus.renting],
  [BookingStatus.delivering]: [BookingStatus.renting],
  [BookingStatus.renting]: [BookingStatus.returned, BookingStatus.overdue],
  [BookingStatus.returned]: [BookingStatus.inspection_pending],
  [BookingStatus.overdue]: [BookingStatus.returned],
};

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly locations: LocationsService,
    private readonly pricing: PricingService,
  ) { }

  private parseDateRange(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("Invalid rental dates.");
    }
    const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    if (endDay < startDay) throw new BadRequestException("End date must be on or after start date.");
    const days = Math.round((endDay.getTime() - startDay.getTime()) / MS_PER_DAY) + 1;
    return { startDay, endDay, days };
  }

  // Ngày hiện tại theo giờ Việt Nam, dạng "YYYY-MM-DD"
  private vnTodayStr(): string {
    return new Date(Date.now() + VN_UTC_OFFSET_MS).toISOString().slice(0, 10);
  }

  // Số ngày quá hạn so với rentalEndDate (0 nếu chưa quá hạn)
  private overdueDays(rentalEndDate: Date): number {
    const endStr = new Date(rentalEndDate).toISOString().slice(0, 10);
    return Math.max(0, Math.round((Date.parse(this.vnTodayStr()) - Date.parse(endStr)) / MS_PER_DAY));
  }

  // ── Availability ───────────────────────────────────────────────────────────

  /**
   * Lấy tên hiển thị của khách: ưu tiên fullName trong hồ sơ, fallback về email.
   */
  private async resolveCustomerName(customerId: string): Promise<string | null> {
    const user = await this.prisma.userAccount.findUnique({
      where: { id: customerId },
      select: { email: true, profile: { select: { fullName: true } } },
    });
    return user?.profile?.fullName ?? user?.email ?? null;
  }

  /**
   * Nguồn chân lý duy nhất về tồn kho cho một size trong một khoảng ngày.
   * Đếm theo NHU CẦU (booking item của các đơn còn hiệu lực, trùng ngày — gồm cả
   * đơn chưa gán asset) so với SỨC CHỨA (asset chưa retired/lost). Cả endpoint
   * checkAvailability lẫn create() đều dùng hàm này để không lệch cách tính.
   * Nhận `client` để chạy được cả với prisma thường lẫn transaction client.
   */
  private async computeSizeAvailability(
    client: Prisma.TransactionClient,
    garmentSizeId: string,
    startDay: Date,
    endDay: Date,
  ) {
    const capacity = await client.garmentAsset.count({
      where: {
        garment_size_id: garmentSizeId,
        status: { notIn: [AssetStatus.retired, AssetStatus.lost] },
      },
    });

    const committed = await client.bookingItem.count({
      where: {
        garment_size_id: garmentSizeId,
        booking: {
          status: { notIn: RELEASED_STATUSES },
          rentalStartDate: { lte: endDay },
          rentalEndDate: { gte: startDay },
        },
      },
    });

    return { capacity, committed, available: Math.max(0, capacity - committed) };
  }

  async checkAvailability(dto: CheckAvailabilityDto) {
    const size = await this.prisma.garment_sizes.findFirst({
      where: { id: dto.garmentSizeId, is_active: true },
    });
    if (!size) throw new NotFoundException("Garment size not found.");

    const { startDay, endDay } = this.parseDateRange(dto.startDate, dto.endDate);

    const { capacity, available } = await this.computeSizeAvailability(
      this.prisma,
      dto.garmentSizeId,
      startDay,
      endDay,
    );

    return ok({
      garmentSizeId: dto.garmentSizeId,
      available: available > 0,
      availableCount: available,
      totalAssets: capacity,
    });
  }

  // ── Create Booking ─────────────────────────────────────────────────────────

  async create(customerId: string, dto: CreateBookingDto) {
    const { startDay, endDay, days } = this.parseDateRange(dto.startDate, dto.endDate);

    const sizes = await this.prisma.garment_sizes.findMany({
      where: { id: { in: dto.garmentSizeIds }, is_active: true },
      include: { garments: true },
    });

    if (sizes.length !== dto.garmentSizeIds.length) {
      const found = new Set(sizes.map((s) => s.id));
      const missing = dto.garmentSizeIds.filter((id) => !found.has(id));
      throw new NotFoundException(`Không tìm thấy size: ${missing.join(", ")}`);
    }

    // Số lượng yêu cầu cho mỗi size trong chính đơn này (garmentSizeIds có thể trùng).
    const requestedQtyBySize = new Map<string, number>();
    for (const sizeId of dto.garmentSizeIds) {
      requestedQtyBySize.set(sizeId, (requestedQtyBySize.get(sizeId) ?? 0) + 1);
    }

    let deliveryAddressSnapshot: string | null = null;
    // Phí ship luôn được tính lại ở server theo địa chỉ giao — không tin giá trị client gửi.
    let shippingFee = 0;
    if (dto.pickupMethod === "delivery") {
      if (dto.paymentMethod && dto.paymentMethod !== "qr_code") {
        throw new BadRequestException("Đơn giao tận nơi phải thanh toán bằng chuyển khoản QR.");
      }
      if (!dto.deliveryAddressId) {
        throw new BadRequestException("Vui lòng chọn địa chỉ giao nhận.");
      }

      const address = await this.prisma.address.findFirst({
        where: { id: dto.deliveryAddressId, customerId },
      });
      if (!address) {
        throw new BadRequestException("Địa chỉ giao nhận không hợp lệ.");
      }

      try {
        const estimate = await this.locations.estimateShippingFee(dto.deliveryAddressId);
        shippingFee = Number(estimate.estimatedFee) || 0;
      } catch {
        throw new BadRequestException("Không thể tính phí giao hàng cho địa chỉ này. Vui lòng thử lại.");
      }

      deliveryAddressSnapshot = [
        `${address.receiverName} - ${address.phone}`,
        [address.line1, address.ward, address.district, address.city].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join("\n");
    }

    const sizeMap = new Map(sizes.map((s) => [s.id, s]));
    let rentalTotal = 0;
    let depositTotal = 0;
    const itemsData: Array<{
      garmentId: string;
      garment_size_id: string;
      dailyPrice: number;
      depositAmount: number;
    }> = [];
    for (const sizeId of dto.garmentSizeIds) {
      const size = sizeMap.get(sizeId)!;
      // Giá theo ngày TẠO booking (booking.createdAt): price_period active chứa
      // ngày hôm nay, fallback về giá cơ sở. Không tính theo từng ngày thuê.
      const dp = await this.pricing.effectiveDailyPrice(sizeId);
      const da = Number(size.deposit_amount ?? 0);
      rentalTotal += dp * days;
      depositTotal += da;
      itemsData.push({ garmentId: size.garment_id, garment_size_id: sizeId, dailyPrice: dp, depositAmount: da });
    }

    // Kiểm tra tồn kho + tạo đơn trong cùng một transaction Serializable để tránh
    // oversell khi hai khách đặt đồng thời cho size gần hết hàng.
    const booking = await this.prisma.$transaction(
      async (tx) => {
        for (const [sizeId, requestedQty] of requestedQtyBySize) {
          const { capacity, committed } = await this.computeSizeAvailability(
            tx,
            sizeId,
            startDay,
            endDay,
          );

          if (committed + requestedQty > capacity) {
            const s = sizeMap.get(sizeId)!;
            throw new BadRequestException(
              `"${s.garments.name}" (${s.size_label ?? "—"}) không còn đủ sản phẩm khả dụng cho khoảng thời gian đã chọn.`,
            );
          }
        }

        return tx.booking.create({
          data: {
            customerId,
            status: BookingStatus.pending_confirmation,
            rentalStartDate: startDay,
            rentalEndDate: endDay,
            pickupMethod: dto.pickupMethod ?? "store_pickup",
            deliveryAddressId: dto.pickupMethod === "delivery" ? dto.deliveryAddressId : null,
            rentalTotal,
            depositTotal,
            shippingFee,
            note: [
              dto.note,
              deliveryAddressSnapshot ? `Địa chỉ giao/nhận:\n${deliveryAddressSnapshot}` : null,
              shippingFee ? `Phí giao hàng: ${shippingFee.toLocaleString("vi-VN")} VND` : null,
            ]
              .filter(Boolean)
              .join("\n\n") || null,
            items: { create: itemsData },
            paymentMethod: dto.pickupMethod === "delivery" ? "qr_code" : (dto.paymentMethod ?? "cash"),
          },
          include: {
            items: {
              include: {
                garment_sizes: { include: { garments: true } },
                garmentAsset: true,
              },
            },
            deliveryAddress: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.notificationsService.sendBookingNotification({
      userId: booking.customerId,
      templateKey: "booking.created",
      bookingId: booking.id,
      garmentName: null,
      startDate: booking.rentalStartDate.toISOString().slice(0, 10),
      endDate: booking.rentalEndDate.toISOString().slice(0, 10),
    });

    await this.notificationsService.notifyStaffBooking({
      templateKey: "booking.staff.created",
      bookingId: booking.id,
      customerName: await this.resolveCustomerName(booking.customerId),
      garmentName: booking.items[0]?.garment_sizes?.garments?.name ?? null,
      startDate: booking.rentalStartDate.toISOString().slice(0, 10),
      endDate: booking.rentalEndDate.toISOString().slice(0, 10),
      roles: [AppRole.staff],
    });

    return ok(this.serializeBooking(booking, days));
  }

  // ── Customer endpoints ─────────────────────────────────────────────────────

  async findMine(customerId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
      },
    });
    return ok(bookings.map((b) => this.serializeBooking(b)));
  }

  async findOne(customerId: string, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
      },
    });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.customerId !== customerId) throw new ForbiddenException("You do not have access to this booking.");
    return ok(this.serializeBooking(booking));
  }

  async cancel(customerId: string, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.customerId !== customerId) throw new ForbiddenException("You do not have access to this booking.");
    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
      throw new BadRequestException("This booking can no longer be cancelled.");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const assignedIds = booking.items
        .map((item) => item.garmentAssetId)
        .filter((id): id is string => Boolean(id));
      if (assignedIds.length > 0) {
        await tx.garmentAsset.updateMany({
          where: { id: { in: assignedIds } },
          data: { status: AssetStatus.available },
        });
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: booking.status,
          toStatus: BookingStatus.cancelled,
          note: "Khách hàng tự hủy đơn",
        },
      });
      return tx.booking.update({
        where: { id },
        data: { status: BookingStatus.cancelled },
        include: {
          items: {
            include: {
              garment_sizes: { include: { garments: true } },
              garmentAsset: true,
            },
          },
        },
      });
    });

    await this.notificationsService.sendBookingNotification({
      userId: booking.customerId,
      templateKey: "booking.cancelled",
      bookingId: updated.id,
      garmentName: updated.items[0]?.garment_sizes?.garments?.name ?? null,
      startDate: updated.rentalStartDate.toISOString().slice(0, 10),
      endDate: updated.rentalEndDate.toISOString().slice(0, 10),
      note: null,
    });

    await this.notificationsService.notifyStaffBooking({
      templateKey: "booking.staff.cancelled",
      bookingId: updated.id,
      customerName: await this.resolveCustomerName(booking.customerId),
      garmentName: updated.items[0]?.garment_sizes?.garments?.name ?? null,
      note: "Khách hàng tự hủy đơn.",
    });

    return ok(this.serializeBooking(updated));
  }

  async findOneForStaff(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            garment_sizes: {
              include: {
                garments: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } },
              },
            },
            garmentAsset: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        deliveryAddress: true,
      },
    });
    if (!booking) throw new NotFoundException("Booking not found.");
    return ok(this.serializeStaffBooking(booking));
  }

  async findAllPending() {
    const bookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.pending_confirmation },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findReturnQueue() {
    const bookings = await this.prisma.booking.findMany({
      where: { status: { in: RETURN_QUEUE_STATUSES } },
      orderBy: [{ status: "asc" }, { rentalEndDate: "asc" }],
      take: 100,
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: { include: { images: { orderBy: { sortOrder: "asc" } } } } } },
            garmentAsset: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findAllForStaff() {
    const bookings = await this.prisma.booking.findMany({
      where: { status: { notIn: [BookingStatus.draft, BookingStatus.cancelled, BookingStatus.rejected] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findBookingsNeedingAssets() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.confirmed, BookingStatus.awaiting_payment, BookingStatus.paid, BookingStatus.preparing] },
        items: { some: { garmentAssetId: null } },
      },
      orderBy: { createdAt: "asc" },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findCompletedWithPendingRefunds() {
    const bookings = await this.prisma.booking.findMany({
      where: { status: { in: [BookingStatus.refund_pending, BookingStatus.completed] }, depositTotal: { gt: 0 } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        refunds: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return ok(bookings.map((b) => ({
      ...this.serializeStaffBooking(b),
      refunds: b.refunds.map((r) => ({
        id: r.id, amount: Number(r.amount), status: r.status,
        refundMethod: r.refund_method, createdAt: r.createdAt.toISOString(), updatedAt: r.updated_at.toISOString(),
      })),
    })));
  }

  async getDeliveryMap() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        pickupMethod: "delivery",
        status: { in: [BookingStatus.ready_for_pickup, BookingStatus.delivering, BookingStatus.renting] },
      },
      orderBy: { rentalStartDate: "asc" },
      take: 100,
      include: {
        deliveryAddress: true,
        customer: { select: { profile: { select: { fullName: true, phone: true } } } },
        items: {
          include: { garment_sizes: { include: { garments: true } } },
        },
      },
    });

    const points = bookings
      .filter((b) => b.deliveryAddress?.latitude != null && b.deliveryAddress?.longitude != null)
      .map((b) => ({
        bookingId: b.id,
        customerName: b.customer?.profile?.fullName ?? b.deliveryAddress?.receiverName ?? "—",
        customerPhone: b.customer?.profile?.phone ?? b.deliveryAddress?.phone ?? "—",
        status: b.status,
        address: [
          b.deliveryAddress?.line1,
          b.deliveryAddress?.ward,
          b.deliveryAddress?.district,
          b.deliveryAddress?.city,
        ]
          .filter(Boolean)
          .join(", "),
        latitude: Number(b.deliveryAddress!.latitude),
        longitude: Number(b.deliveryAddress!.longitude),
        garmentNames: b.items.map((i) => i.garment_sizes?.garments?.name ?? "—").join(", "),
        rentalStartDate: b.rentalStartDate.toISOString().slice(0, 10),
        rentalEndDate: b.rentalEndDate.toISOString().slice(0, 10),
      }));

    return ok(points);
  }

  async getDeliveryTrack(customerId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, customerId },
      include: { deliveryAddress: true },
    });

    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.pickupMethod !== "delivery") {
      throw new BadRequestException("Đơn này không sử dụng giao hàng.");
    }
    if (!booking.deliveryAddress?.latitude || !booking.deliveryAddress?.longitude) {
      throw new BadRequestException("Địa chỉ giao hàng chưa có tọa độ.");
    }

    // Get store coords
    const storeLatSetting = await this.prisma.systemSetting.findUnique({ where: { key: "store_lat" } });
    const storeLngSetting = await this.prisma.systemSetting.findUnique({ where: { key: "store_lng" } });
    const storeLat = Number((storeLatSetting?.value as any)?.value) || 10.7769;
    const storeLng = Number((storeLngSetting?.value as any)?.value) || 106.7009;

    const customerLat = Number(booking.deliveryAddress.latitude);
    const customerLng = Number(booking.deliveryAddress.longitude);

    // Simulate shipper position based on time since rental start
    const now = Date.now();
    const startMs = new Date(booking.rentalStartDate).getTime();
    // Delivery window: 2 hours before rental start
    const deliveryStartMs = startMs - 2 * 60 * 60 * 1000;
    const deliveryEndMs = startMs;

    let progress = 0;
    let simulatedLat = storeLat;
    let simulatedLng = storeLng;
    let status: "preparing" | "in_transit" | "arrived" = "preparing";

    if (now < deliveryStartMs) {
      status = "preparing";
    } else if (now >= deliveryEndMs) {
      status = "arrived";
      progress = 1;
      simulatedLat = customerLat;
      simulatedLng = customerLng;
    } else {
      status = "in_transit";
      progress = (now - deliveryStartMs) / (deliveryEndMs - deliveryStartMs);
      simulatedLat = storeLat + (customerLat - storeLat) * progress;
      simulatedLng = storeLng + (customerLng - storeLng) * progress;
    }

    return ok({
      bookingId: booking.id,
      status,
      progress: Math.round(progress * 100),
      storeLat,
      storeLng,
      customerLat,
      customerLng,
      shipperLat: Math.round(simulatedLat * 1000000) / 1000000,
      shipperLng: Math.round(simulatedLng * 1000000) / 1000000,
      customerName: booking.deliveryAddress.receiverName,
      customerAddress: [
        booking.deliveryAddress.line1,
        booking.deliveryAddress.ward,
        booking.deliveryAddress.district,
        booking.deliveryAddress.city,
      ]
        .filter(Boolean)
        .join(", "),
      estimatedDelivery: new Date(deliveryEndMs).toLocaleString("vi-VN"),
    });
  }

  async advanceStatus(id: string, dto: UpdateBookingStatusDto, changedBy?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { items: true, payments: true },
    });
    if (!booking) throw new NotFoundException("Booking not found.");

    const allowed = STAFF_ALLOWED_TRANSITIONS[booking.status];
    if (!allowed?.includes(dto.status)) {
      throw new BadRequestException(`Cannot transition from '${booking.status}' to '${dto.status}'.`);
    }

    if (ASSET_REQUIRED_STATUSES.includes(dto.status)) {
      const itemCount = booking.items.length;
      const assignedCount = booking.items.filter((i) => Boolean(i.garmentAssetId)).length;
      if (itemCount === 0 || assignedCount < itemCount) {
        throw new BadRequestException(
          `All booking items must have an assigned asset before transitioning to '${dto.status}'. (${assignedCount}/${itemCount})`,
        );
      }
    }

    if (dto.status === BookingStatus.completed && booking.status === BookingStatus.inspection_pending) {
      throw new BadRequestException("Cannot directly complete a booking during inspection.");
    }

    if (dto.status === BookingStatus.paid) {
      throw new BadRequestException("Cannot manually set booking to 'paid'. Use the mark-paid endpoint.");
    }

    // Đơn đã có payment thành công (VD: thanh toán QR trước khi xác nhận)
    // thì bỏ qua bước chờ thanh toán, nhảy thẳng sang 'paid'.
    // Đơn chưa thanh toán (tiền mặt / QR chưa quét) vẫn phải qua chờ thanh toán.
    const alreadyPaid = booking.payments.some((p) => p.status === PaymentStatus.paid);
    const skipAwaitingPayment = dto.status === BookingStatus.awaiting_payment && alreadyPaid;
    const targetStatus = skipAwaitingPayment ? BookingStatus.paid : dto.status;

    if (targetStatus === BookingStatus.awaiting_payment && booking.pickupMethod === "store_pickup") {
      await this.prisma.booking.update({
        where: { id },
        data: { paymentDueAt: new Date(Date.now() + 2 * 60 * 60 * 1000) },
      });
    }

    // Chốt phí quá hạn (10.000đ/ngày) tại thời điểm khách trả đồ
    if (targetStatus === BookingStatus.returned) {
      await this.applyOverdueFee(id);
    }

    const assetIds = booking.items
      .map((item) => item.garmentAssetId)
      .filter((assetId): assetId is string => Boolean(assetId));

    const updated = await this.prisma.$transaction(async (tx) => {
      if (assetIds.length > 0) {
        if (targetStatus === BookingStatus.renting) {
          await tx.garmentAsset.updateMany({ where: { id: { in: assetIds } }, data: { status: AssetStatus.rented } });
        }
        if (targetStatus === BookingStatus.returned || targetStatus === BookingStatus.inspection_pending) {
          await tx.garmentAsset.updateMany({ where: { id: { in: assetIds } }, data: { status: AssetStatus.inspection_pending } });
        }
        if (targetStatus === BookingStatus.cancelled || targetStatus === BookingStatus.rejected) {
          await tx.garmentAsset.updateMany({ where: { id: { in: assetIds } }, data: { status: AssetStatus.available } });
        }
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: booking.status,
          toStatus: targetStatus,
          changedBy: changedBy ?? null,
          note: dto.note ?? (skipAwaitingPayment ? "Đã thanh toán online trước — bỏ qua bước chờ thanh toán" : null),
        },
      });
      return tx.booking.update({
        where: { id },
        data: {
          status: targetStatus,
          ...(targetStatus === BookingStatus.paid ? { paymentDueAt: null } : {}),
          ...(dto.note ? { note: dto.note } : {}),
        },
        include: {
          items: {
            include: {
              garment_sizes: { include: { garments: true } },
              garmentAsset: true,
            },
          },
          payments: true,
        },
      });
    });

    await this.notificationsService.sendBookingNotification({
      userId: booking.customerId,
      templateKey: "booking.status_changed",
      bookingId: updated.id,
      garmentName: updated.items[0]?.garment_sizes?.garments?.name ?? null,
      startDate: updated.rentalStartDate.toISOString().slice(0, 10),
      endDate: updated.rentalEndDate.toISOString().slice(0, 10),
      statusLabel: BOOKING_STATUS_LABELS[targetStatus] ?? targetStatus,
      note: dto.note ?? null,
    });

    if (targetStatus === BookingStatus.confirmed) {
      await this.notificationsService.notifyStaffBooking({
        templateKey: "booking.staff.confirmed",
        bookingId: updated.id,
        customerName: await this.resolveCustomerName(updated.customerId),
        garmentName: updated.items[0]?.garment_sizes?.garments?.name ?? null,
        roles: [AppRole.manager_owner],
      });
    }

    return ok(this.serializeBooking(updated));
  }

  async assignAsset(bookingId: string, itemId: string, dto: AssignAssetDto, staffId?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { items: true } });
    if (!booking) throw new NotFoundException("Booking not found.");

    const item = booking.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException("Booking item not found.");
    if (item.garmentAssetId) throw new BadRequestException("Item already has an assigned asset.");

    const asset = await this.prisma.garmentAsset.findUnique({
      where: { id: dto.garmentAssetId },
      include: { bookingItems: { include: { booking: true } } },
    });
    if (!asset) throw new NotFoundException("Garment asset not found.");

    if (asset.status !== AssetStatus.available)
      throw new BadRequestException(`Asset '${asset.assetCode}' is not available (current: ${asset.status}).`);

    const conflictingItem = asset.bookingItems.find((bi) => {
      if (bi.bookingId === bookingId) return false;
      return !RELEASED_STATUSES.includes(bi.booking.status);
    });
    if (conflictingItem)
      throw new BadRequestException(`Asset '${asset.assetCode}' is already assigned to another active booking.`);

    await this.prisma.$transaction([
      this.prisma.bookingItem.update({ where: { id: itemId }, data: { garmentAssetId: dto.garmentAssetId } }),
      this.prisma.garmentAsset.update({ where: { id: dto.garmentAssetId }, data: { status: AssetStatus.reserved } }),
      this.prisma.bookingStatusHistory.create({
        data: { bookingId, fromStatus: booking.status, toStatus: booking.status, changedBy: staffId ?? null, note: `Gán asset ${asset.assetCode}` },
      }),
    ]);

    const updated = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
      },
    });

    await this.notificationsService.notifyStaffBooking({
      templateKey: "booking.staff.asset_assigned",
      bookingId,
      garmentName: updated?.items.find((i) => i.id === itemId)?.garment_sizes?.garments?.name ?? null,
      assetCode: asset.assetCode,
    });

    return ok(this.serializeBooking(updated!));
  }

  async markPaid(id: string, dto: MarkPaidDto, staffId?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: { items: true, payments: true } });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.status !== BookingStatus.awaiting_payment)
      throw new BadRequestException(`Booking must be in 'awaiting_payment' to mark as paid (current: ${booking.status}).`);

    const isDelivery = booking.pickupMethod === "delivery";
    const alreadyPaid = booking.payments.some((p) => p.status === PaymentStatus.paid);

    // Đơn giao tận nơi bắt buộc khách thanh toán QR (PayOS) trước — staff không thể tự ghi nhận thu tiền.
    if (isDelivery && !alreadyPaid) {
      throw new BadRequestException("Đơn giao tận nơi phải được khách thanh toán qua QR trước khi xác nhận.");
    }

    const paymentMethod = dto.paymentMethod ?? booking.paymentMethod ?? "cash";
    const totalAmount = Number(booking.rentalTotal) + Number(booking.shippingFee ?? 0);
    const depositAmount = Number(booking.depositTotal);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id }, data: { status: BookingStatus.paid, paymentDueAt: null } });
      // Chỉ tạo bản ghi thu tiền khi chưa có payment thành công (tránh ghi trùng với tiền QR đã vào)
      if (!alreadyPaid) {
        await tx.payment.create({
          data: {
            bookingId: id, provider: "manual", paymentMethod,
            amount: totalAmount + depositAmount, depositAmount, status: PaymentStatus.paid, paidAt: new Date(),
          },
        });
      }
      await tx.bookingStatusHistory.create({
        data: { bookingId: id, fromStatus: BookingStatus.awaiting_payment, toStatus: BookingStatus.paid, changedBy: staffId ?? null, note: "Đã thanh toán" },
      });
      return tx.booking.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              garment_sizes: { include: { garments: true } },
              garmentAsset: true,
            },
          },
          payments: true,
        },
      });
    });

    await this.notificationsService.sendBookingNotification({
      userId: booking.customerId,
      templateKey: "booking.payment_received",
      bookingId: updated!.id,
      garmentName: updated!.items[0]?.garment_sizes?.garments?.name ?? null,
      startDate: updated!.rentalStartDate.toISOString().slice(0, 10),
      endDate: updated!.rentalEndDate.toISOString().slice(0, 10),
      amount: Number(booking.rentalTotal) + Number(booking.shippingFee ?? 0) + Number(booking.depositTotal),
    });

    await this.notificationsService.notifyStaffBooking({
      templateKey: "booking.staff.paid",
      bookingId: updated!.id,
      customerName: await this.resolveCustomerName(updated!.customerId),
      garmentName: updated!.items[0]?.garment_sizes?.garments?.name ?? null,
      startDate: updated!.rentalStartDate.toISOString().slice(0, 10),
      endDate: updated!.rentalEndDate.toISOString().slice(0, 10),
    });

    return ok(this.serializeBooking(updated!));
  }

  async cancelExpiredAwaitingPayments() {
    const now = new Date();
    const expiredBookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.awaiting_payment, pickupMethod: "store_pickup", paymentDueAt: { lt: now } },
      include: { items: true },
    });
    const results: { bookingId: string; released: number }[] = [];
    for (const booking of expiredBookings) {
      await this.prisma.$transaction(async (tx) => {
        const assignedIds = booking.items.map((i) => i.garmentAssetId).filter(Boolean) as string[];
        if (assignedIds.length > 0)
          await tx.garmentAsset.updateMany({ where: { id: { in: assignedIds } }, data: { status: AssetStatus.available } });
        await tx.bookingStatusHistory.create({
          data: { bookingId: booking.id, fromStatus: BookingStatus.awaiting_payment, toStatus: BookingStatus.cancelled, note: "Tự động hủy — quá hạn thanh toán" },
        });
        await tx.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.cancelled } });
      });

      await this.notificationsService.sendBookingNotification({
        userId: booking.customerId,
        templateKey: "booking.cancelled",
        bookingId: booking.id,
        garmentName: null,
        startDate: booking.rentalStartDate.toISOString().slice(0, 10),
        endDate: booking.rentalEndDate.toISOString().slice(0, 10),
        note: "Đơn thuê đã tự động hủy do quá hạn thanh toán.",
      });
      results.push({ bookingId: booking.id, released: booking.items.filter((i) => i.garmentAssetId).length });

    }
    return ok({ expiredCount: results.length, releasedAssets: results.reduce((s, r) => s + r.released, 0), bookings: results.map((r) => r.bookingId) });
  }

  // ── Overdue & phí phạt quá hạn ─────────────────────────────────────────────

  // Ghi nhận phí quá hạn 10.000đ/ngày cho một booking (idempotent — gọi lại chỉ
  // cập nhật số tiền theo số ngày quá hạn hiện tại, không tạo bản ghi trùng).
  async applyOverdueFee(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { penalties: true },
    });
    if (!booking) return null;

    const days = this.overdueDays(booking.rentalEndDate);
    const amount = days * OVERDUE_FEE_PER_DAY;
    if (amount <= 0) return null;

    const existing = booking.penalties.find((p) => p.reason === OVERDUE_PENALTY_REASON);
    const previous = existing ? Number(existing.amount) : 0;
    if (previous !== amount) {
      await this.prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.penalty.update({ where: { id: existing.id }, data: { amount } });
        } else {
          await tx.penalty.create({ data: { bookingId, reason: OVERDUE_PENALTY_REASON, amount } });
        }
        await tx.booking.update({
          where: { id: bookingId },
          data: { penaltyTotal: { increment: amount - previous } },
        });
      });
    }
    return { bookingId, days, amount };
  }

  // Chạy lúc 12h00 ngày cuối của kỳ thuê: nhắc khách trả đồ trước 00h00 hôm sau.
  async sendReturnReminders() {
    const today = new Date(this.vnTodayStr());
    const bookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.renting, rentalEndDate: today },
      include: { items: { include: { garment_sizes: { include: { garments: true } } } } },
    });

    for (const booking of bookings) {
      await this.notificationsService.sendBookingNotification({
        userId: booking.customerId,
        templateKey: "booking.return_reminder",
        bookingId: booking.id,
        garmentName: booking.items[0]?.garment_sizes?.garments?.name ?? null,
        startDate: booking.rentalStartDate.toISOString().slice(0, 10),
        endDate: booking.rentalEndDate.toISOString().slice(0, 10),
      });
    }

    return ok({ remindedCount: bookings.length, bookings: bookings.map((b) => b.id) });
  }

  // Chạy lúc 00h00 hằng ngày: đánh dấu quá hạn các đơn đang thuê đã qua ngày trả,
  // đồng thời cộng dồn phí phạt 10.000đ/ngày cho mọi đơn đang quá hạn.
  async markOverdueBookings() {
    const today = new Date(this.vnTodayStr());
    const toMark = await this.prisma.booking.findMany({
      where: { status: BookingStatus.renting, rentalEndDate: { lt: today } },
      include: { items: { include: { garment_sizes: { include: { garments: true } } } } },
    });

    for (const booking of toMark) {
      await this.prisma.$transaction([
        this.prisma.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            fromStatus: BookingStatus.renting,
            toStatus: BookingStatus.overdue,
            note: "Tự động đánh dấu quá hạn — khách chưa trả đồ sau ngày kết thúc thuê",
          },
        }),
        this.prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.overdue } }),
      ]);
    }

    // Cộng dồn phí phạt cho tất cả đơn đang quá hạn (kể cả đơn staff đánh dấu tay)
    const overdueBookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.overdue },
      select: { id: true },
    });
    const fees = new Map<string, { days: number; amount: number }>();
    for (const { id } of overdueBookings) {
      const fee = await this.applyOverdueFee(id);
      if (fee) fees.set(id, { days: fee.days, amount: fee.amount });
    }

    // Chỉ thông báo cho các đơn vừa bị đánh dấu quá hạn
    for (const booking of toMark) {
      const fee = fees.get(booking.id);
      await this.notificationsService.sendBookingNotification({
        userId: booking.customerId,
        templateKey: "booking.overdue",
        bookingId: booking.id,
        garmentName: booking.items[0]?.garment_sizes?.garments?.name ?? null,
        startDate: booking.rentalStartDate.toISOString().slice(0, 10),
        endDate: booking.rentalEndDate.toISOString().slice(0, 10),
        amount: (fee?.amount ?? OVERDUE_FEE_PER_DAY).toLocaleString("vi-VN") + " đ",
      });
    }

    return ok({
      markedCount: toMark.length,
      accruedCount: fees.size,
      bookings: toMark.map((b) => b.id),
    });
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  private serializeStaffBooking(booking: any) {
    return {
      ...this.serializeBooking(booking),
      customerName: booking.customer?.profile?.fullName ?? booking.customer?.email ?? null,
      customerPhone: booking.customer?.profile?.phone ?? null,
    };
  }

  private serializeBooking(booking: any, days?: number) {
    const start = new Date(booking.rentalStartDate);
    const end = new Date(booking.rentalEndDate);
    const computedDays = days ?? Math.round(
      (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / MS_PER_DAY,
    ) + 1;

    return {
      id: booking.id,
      status: booking.status,
      rentalStartDate: start.toISOString().slice(0, 10),
      rentalEndDate: end.toISOString().slice(0, 10),
      days: computedDays,
      pickupMethod: booking.pickupMethod,
      rentalTotal: Number(booking.rentalTotal),
      depositTotal: Number(booking.depositTotal),
      shippingFee: Number(booking.shippingFee ?? 0),
      penaltyTotal: Number(booking.penaltyTotal ?? 0),
      note: booking.note,
      deliveryAddressId: booking.deliveryAddressId ?? null,
      deliveryAddress: booking.deliveryAddress ? {
        id: booking.deliveryAddress.id,
        receiverName: booking.deliveryAddress.receiverName,
        phone: booking.deliveryAddress.phone,
        line1: booking.deliveryAddress.line1,
        ward: booking.deliveryAddress.ward,
        district: booking.deliveryAddress.district,
        city: booking.deliveryAddress.city,
      } : null,
      paymentMethod: booking.paymentMethod ?? "cash",
      paidPaymentMethod:
        (booking.payments ?? []).find((p: any) => p.status === PaymentStatus.paid)?.paymentMethod ?? null,
      createdAt: booking.createdAt.toISOString(),
      items: (booking.items ?? []).map((item: any) => ({
        id: item.id,
        garmentSizeId: item.garment_size_id,
        garmentId: item.garmentId,
        garmentName: item.garment_sizes?.garments?.name ?? null,
        imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
        sizeLabel: item.garment_sizes?.size_label ?? null,
        dailyPrice: Number(item.dailyPrice),
        depositAmount: Number(item.depositAmount),
        garmentAssetId: item.garmentAssetId ?? item.garmentAsset?.id ?? null,
        assetCode: item.garmentAsset?.assetCode ?? null,
        assetStatus: item.garmentAsset?.status ?? null,
        conditionNote: item.garmentAsset?.conditionNote ?? null,
      })),
    };
  }
}





