import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AppRole, AssetStatus, BookingStatus, InspectionStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LocationsService } from "../locations/locations.service";
import { RealtimeService } from "../realtime/realtime.service";
import { VouchersService, type VoucherOrderLine } from "../vouchers/vouchers.service";
import { InspectionsService } from "../inspections/inspections.service";
import type { CheckAvailabilityDto } from "./dto/check-availability.dto";
import type { CheckAccessoryAvailabilityDto } from "./dto/check-accessory-availability.dto";
import type { SizeAvailabilityCalendarDto } from "./dto/size-availability-calendar.dto";
import type { CreateBookingDto } from "./dto/create-booking.dto";
import type { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";
import type { AssignAssetDto } from "./dto/assign-asset.dto";
import type { AssignAccessoryAssetDto } from "./dto/assign-accessory-asset.dto";
import type { InspectBookingAccessoryDto } from "./dto/inspect-booking-accessory.dto";
import type { ConfirmHandoverDto } from "./dto/confirm-handover.dto";
import type { MarkPaidDto } from "./dto/mark-paid.dto";
import type { RecoverHandoverDto } from "./dto/recover-handover.dto";
import type { MarkDeliveryDto } from "./dto/mark-delivery.dto";
import type { AuthenticatedUser } from "../auth/auth-user";
import { loadSizeInventory, parseRentalDateRange, sizeAvailability, sizeAvailabilityCalendar, vietnamToday, loadAccessoryInventory, accessoryAvailability } from "./booking-inventory";
import { assertAccessoryAssetScheduleAvailable, assertAssetScheduleAvailable, claimBookingAssets, releaseBookingAssets, transitionBookingAssets } from "./booking-reservations";
import { readBookingDeliverySnapshot, serializeAddressSnapshot } from "./booking-delivery";
import { ensureCancellationRefunds } from "../../common/settlement/settlement.helper";
import { assertOwnedEvidenceUrls } from "../../common/validation/evidence-url";

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
// Trạng thái mà đơn vẫn còn giữ đồ → ngày trễ vẫn có nghĩa và phí vẫn còn chạy.
// Đã trả / đã hủy / đã hoàn tất thì ngày trễ không còn ý nghĩa nữa.
const OVERDUE_ELIGIBLE_STATUSES: BookingStatus[] = [BookingStatus.renting, BookingStatus.overdue];

// Kept as a compatibility reference while legacy booking status queries migrate to booking-inventory.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// ── Asset Status State Machine ───────────────────────────────────────────────
// Chỉ cho phép chuyển trạng thái theo luồng quy định. Không chuyển tùy ý.
const ASSET_STATUS_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  [AssetStatus.available]:        [AssetStatus.reserved, AssetStatus.retired],
  [AssetStatus.reserved]:        [AssetStatus.rented, AssetStatus.available],
  [AssetStatus.rented]:          [AssetStatus.inspection_pending],
  [AssetStatus.inspection_pending]: [AssetStatus.damaged, AssetStatus.laundry, AssetStatus.cleaned, AssetStatus.maintenance],
  [AssetStatus.laundry]:          [AssetStatus.cleaned, AssetStatus.damaged],
  [AssetStatus.maintenance]:     [AssetStatus.damaged, AssetStatus.cleaned],
  [AssetStatus.cleaned]:         [AssetStatus.available, AssetStatus.retired],
  [AssetStatus.damaged]:         [AssetStatus.maintenance, AssetStatus.retired],
  [AssetStatus.retired]:         [],
  [AssetStatus.lost]:            [],
};

// Kept as a compatibility reference while availability is served by booking-inventory.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RENTABLE_CAPACITY_STATUSES: AssetStatus[] = [
  AssetStatus.available,
  AssetStatus.reserved,
  AssetStatus.rented,
];

const ASSET_REQUIRED_STATUSES: BookingStatus[] = [
  BookingStatus.preparing,
  BookingStatus.ready_for_pickup,
  BookingStatus.delivering,
  BookingStatus.renting,
];

const HANDOVER_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.ready_for_pickup,
  BookingStatus.delivering,
  BookingStatus.renting,
];

const OPERATIONAL_ROLES: AppRole[] = [
  AppRole.staff,
  AppRole.manager_owner,
  AppRole.admin,
];

/** Đơn đã trả đồ mới được kiểm tra phụ kiện (mirror garment inspection). */
const ACCESSORY_INSPECTABLE_STATUSES: BookingStatus[] = [
  BookingStatus.returned,
  BookingStatus.inspection_pending,
];

/** Kết quả kiểm tra phụ kiện → trạng thái asset (mirror garment complete). */
const ACCESSORY_CONDITION_TO_ASSET_STATUS: Record<string, AssetStatus> = {
  good: AssetStatus.available,
  laundry: AssetStatus.laundry,
  maintenance: AssetStatus.maintenance,
  damaged: AssetStatus.damaged,
  lost: AssetStatus.lost,
};

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
    private readonly realtime: RealtimeService,
    @Optional() private readonly vouchers?: VouchersService,
    @Optional() private readonly inspections?: InspectionsService,
  ) { }

  // Ngày hiện tại theo giờ Việt Nam, dạng "YYYY-MM-DD"
  private vnTodayStr(): string {
    return new Date(Date.now() + VN_UTC_OFFSET_MS).toISOString().slice(0, 10);
  }

  /**
   * Validate asset status transition theo state machine.
   * Khi newStatus là 'damaged', chỉ chuyển được sang 'maintenance' hoặc 'retired' — không sang 'available'.
   */
  private validateAssetTransition(current: AssetStatus, next: AssetStatus): void {
    const allowed = ASSET_STATUS_TRANSITIONS[current];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Không thể chuyển asset từ '${current}' sang '${next}'. ` +
        `Các trạng thái hợp lệ: ${allowed.length ? allowed.join(', ') : 'không có (trạng thái cuối cùng).'}`,
      );
    }
  }

  /**
   * Validate rằng asset không ở trạng thái 'damaged' hoặc 'retired' khi hiển thị cho thuê.
   */
  private assertAssetRentable(status: AssetStatus): void {
    if (status === AssetStatus.damaged) {
      throw new BadRequestException("Sản phẩm đang bị hư hỏng, không thể cho thuê.");
    }
    if (status === AssetStatus.retired) {
      throw new BadRequestException("Sản phẩm đã ngừng kinh doanh, không thể cho thuê.");
    }
    if (status === AssetStatus.lost) {
      throw new BadRequestException("Sản phẩm bị mất, không thể cho thuê.");
    }
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
    return sizeAvailability(await loadSizeInventory(client, garmentSizeId, startDay, endDay));
  }

  async checkAvailability(dto: CheckAvailabilityDto) {
    const size = await this.prisma.garment_sizes.findFirst({
      where: { id: dto.garmentSizeId, is_active: true },
    });
    if (!size) throw new NotFoundException("Garment size not found.");

    const { startDay, endDay } = parseRentalDateRange(dto.startDate, dto.endDate);

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

  /**
   * Tồn kho phụ kiện theo khoảng ngày: nhu cầu (các dòng phụ kiện của đơn còn
   * hiệu lực, trùng ngày) so với sức chứa (asset khả dụng). Dùng cho trang
   * chọn ngày thuê để báo đỏ phụ kiện hết hàng như trang phục.
   */
  async checkAccessoryAvailability(dto: CheckAccessoryAvailabilityDto) {
    const accessory = await this.prisma.accessories.findFirst({
      where: { id: dto.accessoryId, is_active: true },
    });
    if (!accessory) throw new NotFoundException("Accessory not found.");

    const { startDay, endDay } = parseRentalDateRange(dto.startDate, dto.endDate);
    const needed = dto.quantity ?? 1;

    const { capacity, available } = accessoryAvailability(
      await loadAccessoryInventory(this.prisma, dto.accessoryId, startDay, endDay),
    );

    return ok({
      accessoryId: dto.accessoryId,
      available: available >= needed,
      availableCount: available,
      totalAssets: capacity,
    });
  }

  /**
   * Lịch còn hàng theo từng ngày cho 1 size trong [fromDate, toDate].
   * Dùng 2 query (sức chứa + booking trùng toàn cửa sổ) rồi quét từng ngày
   * bằng so sánh chuỗi YYYY-MM-DD để tránh lệch múi giờ.
   * Ngữ nghĩa trùng ngày GIỐNG HỆT computeSizeAvailability để không lệch.
   */
  async getSizeAvailabilityCalendar(dto: SizeAvailabilityCalendarDto) {
    const size = await this.prisma.garment_sizes.findFirst({
      where: { id: dto.garmentSizeId, is_active: true },
    });
    if (!size) throw new NotFoundException("Garment size not found.");

    const { startDay, endDay, days } = parseRentalDateRange(dto.fromDate, dto.toDate);
    const MAX_CALENDAR_DAYS = 366;
    if (days > MAX_CALENDAR_DAYS) {
      throw new BadRequestException(
        `Khoảng ngày tra cứu tối đa ${MAX_CALENDAR_DAYS} ngày.`,
      );
    }

    const snapshot = await loadSizeInventory(this.prisma, dto.garmentSizeId, startDay, endDay);
    const { capacity } = sizeAvailability(snapshot);
    return ok({ garmentSizeId: dto.garmentSizeId, capacity, days: sizeAvailabilityCalendar(snapshot) });
  }

  // ── Create Booking ─────────────────────────────────────────────────────────

  async create(customerId: string, dto: CreateBookingDto) {
    const { startDay, endDay, days } = parseRentalDateRange(dto.startDate, dto.endDate);
    if (startDay < vietnamToday()) throw new BadRequestException("Ngày thuê không được nằm trong quá khứ.");

    const sizes = await this.prisma.garment_sizes.findMany({
      where: { id: { in: dto.garmentSizeIds }, is_active: true, garments: { isActive: true, deletedAt: null } },
      include: { garments: true },
    });

    if (sizes.length !== new Set(dto.garmentSizeIds).size) {
      const found = new Set(sizes.map((s) => s.id));
      const missing = dto.garmentSizeIds.filter((id) => !found.has(id));
      throw new NotFoundException(`Không tìm thấy size: ${missing.join(", ")}`);
    }

    // Số lượng yêu cầu cho mỗi size trong chính đơn này (garmentSizeIds có thể trùng).
    const requestedQtyBySize = new Map<string, number>();
    for (const sizeId of dto.garmentSizeIds) {
      requestedQtyBySize.set(sizeId, (requestedQtyBySize.get(sizeId) ?? 0) + 1);
    }

    let deliveryAddressForRecord: any = null;
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
      deliveryAddressForRecord = address;

      try {
        const estimate = await this.locations.estimateShippingFee(dto.deliveryAddressId);
        shippingFee = Number(estimate.estimatedFee) || 0;
      } catch {
        throw new BadRequestException("Không thể tính phí giao hàng cho địa chỉ này. Vui lòng thử lại.");
      }

    }

    const sizeMap = new Map(sizes.map((s) => [s.id, s]));
    // Giá tính theo TỪNG NGÀY thuê: giá chốt thủ công (price_periods) → luật giá tự động
    // (price_rules, ưu tiên cao nhất) → giá gốc. Không sửa giá gốc của sản phẩm.
    const quotes = await this.pricing.quoteRental(dto.garmentSizeIds, startDay, endDay);
    let subtotal = 0;
    let depositTotal = 0;
    const voucherLines: VoucherOrderLine[] = [];
    const itemsData: Array<{
      garmentId: string;
      garment_size_id: string;
      dailyPrice: number;
      basePrice: number;
      discountPrice: number;
      appliedPriceRule: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      depositAmount: number;
    }> = [];
    for (const sizeId of dto.garmentSizeIds) {
      const size = sizeMap.get(sizeId)!;
      const quote = quotes.get(sizeId);
      const basePrice = Number(size.daily_price ?? 0);
      const lineTotal = quote?.rentalTotal ?? basePrice * days;
      const dp = quote?.discountPrice ?? basePrice;
      const da = Number(size.deposit_amount ?? 0);
      subtotal += lineTotal;
      depositTotal += da;
      voucherLines.push({ garmentId: size.garment_id, categoryId: size.garments.categoryId ?? null, amount: lineTotal });
      itemsData.push({
        garmentId: size.garment_id,
        garment_size_id: sizeId,
        dailyPrice: dp,
        basePrice,
        discountPrice: dp,
        appliedPriceRule: quote?.appliedPriceRule
          ? ({ ...quote.appliedPriceRule, rules: quote.appliedRules } as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        depositAmount: da,
      });
    }

    const voucherCode = dto.voucherCode?.trim();
    if (voucherCode && !this.vouchers) {
      throw new BadRequestException("Hệ thống voucher chưa sẵn sàng.");
    }

    // ── Phụ kiện thuê kèm (booking_accessory_items) ──────────────────────────
    // Client gửi [{ garmentSizeId, accessoryId }] — mỗi cặp gắn vào 1 booking item.
    // Validate: size phải thuộc đơn + phụ kiện phải được gắn với garment đó
    // (bảng garment_accessories). Giá snapshot từ extra_price (₫/ngày).
    type ResolvedAccessory = {
      garmentSizeId: string;
      accessoryId: string;
      quantity: number;
      unitPrice: number;
      isIncluded: boolean;
      lineTotal: number;
    };
    let resolvedAccessories: ResolvedAccessory[] = [];
    // Số đơn vị yêu cầu cho mỗi phụ kiện trong chính đơn này.
    const requestedQtyByAccessory = new Map<string, number>();
    if (dto.accessories?.length) {
      const seen = new Set<string>();
      const deduped = (dto.accessories ?? []).filter((a) => {
        const key = `${a.garmentSizeId}::${a.accessoryId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const sizeIdsInOrder = new Set(dto.garmentSizeIds);
      for (const a of deduped) {
        if (!sizeIdsInOrder.has(a.garmentSizeId)) {
          throw new BadRequestException("Phụ kiện phải thuộc một sản phẩm trong đơn.");
        }
      }
      const garmentIds = [...new Set(sizes.map((s) => s.garment_id))];
      const links = await this.prisma.garment_accessories.findMany({
        where: {
          garment_id: { in: garmentIds },
          accessory_id: { in: [...new Set(deduped.map((a) => a.accessoryId))] },
        },
      });
      const linkByKey = new Map(links.map((l) => [`${l.garment_id}::${l.accessory_id}`, l]));
      let accessorySubtotal = 0;
      for (const a of deduped) {
        const size = sizeMap.get(a.garmentSizeId)!;
        const link = linkByKey.get(`${size.garment_id}::${a.accessoryId}`);
        if (!link) {
          throw new BadRequestException(
            `Phụ kiện không thuộc sản phẩm "${size.garments.name}". Vui lòng chọn lại.`,
          );
        }
        const quantity = link.quantity ?? 1;
        const isIncluded = link.is_included ?? true;
        const unitPrice = isIncluded ? 0 : Number(link.extra_price ?? 0);
        requestedQtyByAccessory.set(
          a.accessoryId,
          (requestedQtyByAccessory.get(a.accessoryId) ?? 0) + quantity,
        );
        // Mỗi đơn vị phụ kiện là 1 dòng riêng (quantity = 1) để gán được
        // từng tài sản vật lý (1 asset cho 1 đơn vị).
        const lineTotalPerUnit = unitPrice * days;
        accessorySubtotal += lineTotalPerUnit * quantity;
        for (let u = 0; u < quantity; u++) {
          resolvedAccessories.push({
            garmentSizeId: a.garmentSizeId,
            accessoryId: a.accessoryId,
            quantity: 1,
            unitPrice,
            isIncluded,
            lineTotal: lineTotalPerUnit,
          });
        }
      }
      subtotal += accessorySubtotal;
    }

    // Kiểm tra tồn kho + tạo đơn trong cùng một transaction Serializable để tránh
    // oversell khi hai khách đặt đồng thời cho size gần hết hàng.
    const booking = await this.prisma.runSerializable(async (tx) => {
        for (const [sizeId, requestedQty] of requestedQtyBySize) {
          const activeSize = await tx.garment_sizes.findFirst({
            where: { id: sizeId, is_active: true, garments: { isActive: true, deletedAt: null } },
            select: { id: true },
          });
          if (!activeSize) throw new BadRequestException("Sản phẩm hoặc size không còn được cho thuê.");
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

        // Tồn kho phụ kiện đi kèm: chặn đơn khi phụ kiện đã tick không còn đủ
        // asset khả dụng cho khoảng ngày (tính chung transaction để tránh oversell).
        if (requestedQtyByAccessory.size > 0) {
          const accNames = new Map(
            (await tx.accessories.findMany({
              where: { id: { in: [...requestedQtyByAccessory.keys()] } },
              select: { id: true, name: true },
            })).map((a) => [a.id, a.name] as const),
          );
          for (const [accessoryId, requestedQty] of requestedQtyByAccessory) {
            const { capacity, committed } = accessoryAvailability(
              await loadAccessoryInventory(tx, accessoryId, startDay, endDay),
            );
            if (committed + requestedQty > capacity) {
              throw new BadRequestException(
                `Phụ kiện "${accNames.get(accessoryId) ?? accessoryId}" không còn đủ số lượng khả dụng cho khoảng thời gian đã chọn.`,
              );
            }
          }
        }

        // Voucher được kiểm tra lại HOÀN TOÀN ở backend trong cùng transaction.
        const voucherEval = voucherCode
          ? await this.vouchers!.evaluate(tx, voucherCode, customerId, voucherLines)
          : null;
        const discountTotal = voucherEval?.discountAmount ?? 0;
        const rentalTotal = subtotal - discountTotal;

        const created = await tx.booking.create({
          data: {
            customerId,
            status: BookingStatus.pending_confirmation,
            subtotal,
            discountTotal,
            voucherId: voucherEval?.voucher.id ?? null,
            voucherCode: voucherEval?.voucher.code ?? null,
            rentalStartDate: startDay,
            rentalEndDate: endDay,
            pickupMethod: dto.pickupMethod ?? "store_pickup",
            deliveryAddressId: dto.pickupMethod === "delivery" ? dto.deliveryAddressId : null,
            rentalTotal,
            depositTotal,
            shippingFee,
            note: [
              dto.note,
              shippingFee ? `Phí giao hàng: ${shippingFee.toLocaleString("vi-VN")} VND` : null,
            ]
              .filter(Boolean)
              .join("\n\n") || null,
            items: { create: itemsData },
            deliveryRecords: dto.pickupMethod === "delivery" && deliveryAddressForRecord
              ? { create: { method: "delivery", addressSnapshot: serializeAddressSnapshot(deliveryAddressForRecord) } }
              : undefined,
            paymentMethod: dto.pickupMethod === "delivery" ? "qr_code" : (dto.paymentMethod ?? "cash"),
          },
          include: {
            items: {
              include: {
                garment_sizes: { include: { garments: true } },
                garmentAsset: true,
              },
            },
            accessoryItems: {
              include: {
                accessory: true,
                accessoryAsset: true,
                bookingItem: true,
              },
            },
            deliveryAddress: true,
            deliveryRecords: { orderBy: { createdAt: "desc" } },
          },
        });
        if (resolvedAccessories.length > 0) {
          // Gắn mỗi phụ kiện vào booking item đầu tiên có cùng garment_size_id.
          const itemQueueBySize = new Map<string, Array<{ id: string }>>();
          for (const item of created.items as Array<{ id: string; garment_size_id: string | null }>) {
            if (!item.garment_size_id) continue;
            const queue = itemQueueBySize.get(item.garment_size_id) ?? [];
            queue.push({ id: item.id });
            itemQueueBySize.set(item.garment_size_id, queue);
          }
          for (const acc of resolvedAccessories) {
            // Nhiều dòng đơn vị có thể chung 1 booking item (không shift queue).
            const queue = itemQueueBySize.get(acc.garmentSizeId);
            const target = queue?.[0];
            if (!target) continue;
            await tx.bookingAccessoryItem.create({
              data: {
                bookingId: created.id,
                bookingItemId: target.id,
                accessoryId: acc.accessoryId,
                quantity: acc.quantity,
                unitPrice: acc.unitPrice,
                isIncluded: acc.isIncluded,
                rentalTotal: acc.lineTotal,
              },
            });
          }
        }
        if (voucherEval) {
          await this.vouchers!.consume(tx, voucherEval, customerId, created.id);
        }
        return created;
      });
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
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
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
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
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

    const updated = await this.prisma.runSerializable(async (tx) => {
      const current = await tx.booking.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!current) throw new NotFoundException("Booking not found.");
      if (!CANCELLABLE_STATUSES.includes(current.status)) {
        throw new ConflictException("Booking đã được xử lý bởi một thao tác khác.");
      }

      await releaseBookingAssets(tx, id);
      await ensureCancellationRefunds(tx, id, undefined, "Khách hàng tự hủy đơn");
      const claimed = await tx.booking.updateMany({
        where: { id, status: current.status },
        data: { status: BookingStatus.cancelled },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Booking đã được xử lý bởi một thao tác khác.");
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: current.status,
          toStatus: BookingStatus.cancelled,
          note: "Khách hàng tự hủy đơn",
        },
      });
      await this.vouchers?.releaseForBooking(tx, id);
      return tx.booking.findUniqueOrThrow({
        where: { id },
        include: {
          items: {
            include: {
              garment_sizes: { include: { garments: true } },
              garmentAsset: true,
            },
          },
          accessoryItems: {
            include: {
              accessory: true,
              accessoryAsset: true,
              bookingItem: true,
            },
          },
          deliveryRecords: { orderBy: { createdAt: "desc" } },
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

    this.realtime.bookingChanged({
      id: updated.id,
      bookingId: updated.id,
      status: BookingStatus.cancelled,
    });
    this.realtime.assetChanged({ bookingId: updated.id });

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
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        deliveryAddress: true,
        deliveryRecords: { orderBy: { createdAt: "desc" } },
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
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findReturnQueue(search?: string) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: RETURN_QUEUE_STATUSES },
        ...(search?.trim() ? {
          OR: [
            { customer: { profile: { fullName: { contains: search.trim(), mode: "insensitive" as const } } } },
            { customer: { email: { contains: search.trim(), mode: "insensitive" as const } } },
          ],
        } : {}),
      },
      orderBy: [{ status: "asc" }, { rentalEndDate: "asc" }],
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: { include: { images: { orderBy: { sortOrder: "asc" } } } } } },
            garmentAsset: true,
          },
        },
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findAllForStaff(search?: string, status?: string, cursor?: string) {
    const EXCLUDED: BookingStatus[] = [BookingStatus.draft, BookingStatus.cancelled, BookingStatus.rejected];
    const statusFilter: BookingStatus[] = status && Object.values(BookingStatus).includes(status as BookingStatus)
      ? [status as BookingStatus]
      : (Object.values(BookingStatus) as BookingStatus[]).filter(s => !EXCLUDED.includes(s));
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: statusFilter },
        ...(search?.trim() ? {
          OR: [
            { customer: { profile: { fullName: { contains: search.trim(), mode: "insensitive" as const } } } },
            { customer: { email: { contains: search.trim(), mode: "insensitive" as const } } },
            { customer: { profile: { phone: { contains: search.trim(), mode: "insensitive" as const } } } },
          ],
        } : {}),
      },
      orderBy: { createdAt: "desc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 50,
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      },
    });
    const serialized = bookings.map((b) => this.serializeStaffBooking(b));
    return ok({
      data: serialized,
      nextCursor: bookings.length === 50 ? bookings[bookings.length - 1].id : null,
    });
  }

  async findBookingsNeedingAssets() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.confirmed, BookingStatus.awaiting_payment, BookingStatus.paid, BookingStatus.preparing] },
        OR: [
          { items: { some: { garmentAssetId: null } } },
          { accessoryItems: { some: { accessoryAssetId: null } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      },
    });
    return ok(bookings.map((b) => this.serializeStaffBooking(b)));
  }

  async findCompletedWithPendingRefunds() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        OR: [
          { status: { in: [BookingStatus.refund_pending, BookingStatus.completed] }, depositTotal: { gt: 0 } },
          { status: { in: [BookingStatus.cancelled, BookingStatus.rejected] }, refunds: { some: { status: { in: [PaymentStatus.pending, PaymentStatus.refunding] } } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
        payments: { where: { status: PaymentStatus.paid }, take: 1 },
        refunds: { orderBy: { createdAt: "desc" }, take: 1 },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
        inspections: {
          where: { status: InspectionStatus.completed },
          select: { garmentAssetId: true },
        },
      },
    });
    return ok(bookings.map((b) => ({
      ...this.serializeStaffBooking(b),
      allAssignedAssetsInspected: this.hasCompletedInspectionForEveryAssignedAsset(b),
      refunds: b.refunds.map((r) => ({
        id: r.id, amount: Number(r.amount), status: r.status,
        refundMethod: r.refund_method,
        bankName: r.bank_name,
        bankAccountNumber: r.bank_account_number,
        bankAccountHolder: r.bank_account_holder,
        bankDetailsComplete: Boolean(r.bank_name?.trim() && r.bank_account_number?.trim() && r.bank_account_holder?.trim()),
        createdAt: r.createdAt.toISOString(), updatedAt: r.updated_at.toISOString(),
      })),
    })));
  }

  async markDelivered(id: string, dto: MarkDeliveryDto, actorId: string) {
    const updated = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
        include: { deliveryAddress: true, deliveryRecords: { orderBy: { createdAt: "desc" } }, items: true },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.pickupMethod !== "delivery") throw new BadRequestException("Đơn này không sử dụng giao hàng.");
      if (booking.status !== BookingStatus.ready_for_pickup && booking.status !== BookingStatus.delivering) {
        throw new ConflictException("Đơn không ở trạng thái có thể xác nhận đã giao.");
      }

      const now = new Date();
      const existing = booking.deliveryRecords.find((record) => record.method === "delivery" && record.deliveredAt);
      if (existing) return tx.booking.findUniqueOrThrow({ where: { id }, include: { items: true, deliveryAddress: true, deliveryRecords: { orderBy: { createdAt: "desc" } } } });
      const deliverySnapshot = readBookingDeliverySnapshot(booking);

      const nextStatus: BookingStatus = BookingStatus.delivering;
      const claimed = await tx.booking.updateMany({ where: { id, status: booking.status }, data: { status: nextStatus } });
      if (claimed.count !== 1) throw new ConflictException("Booking status was already changed by another request.");
      await tx.deliveryRecord.create({
        data: {
          bookingId: id,
          method: "delivery",
          addressSnapshot: deliverySnapshot ? JSON.stringify(deliverySnapshot) : null,
          deliveredAt: now,
          note: dto.note?.trim() || null,
        },
      });
      await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: booking.status, toStatus: nextStatus, changedBy: actorId, note: dto.note?.trim() || "Đã giao cho đơn vị vận chuyển." } });
      return tx.booking.findUniqueOrThrow({ where: { id }, include: { items: true, deliveryAddress: true, deliveryRecords: { orderBy: { createdAt: "desc" } } } });
    });
    this.realtime.bookingChanged({ id: updated.id, bookingId: updated.id, status: updated.status });
    this.realtime.bookingChangedForCustomer(updated.customerId, {
      id: updated.id,
      bookingId: updated.id,
      status: updated.status,
    });
    return ok(this.serializeBooking(updated));
  }

  async markReturned(id: string, dto: MarkDeliveryDto, actorId: string) {
    const updated = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
        include: { deliveryAddress: true, deliveryRecords: { orderBy: { createdAt: "desc" } }, items: true },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.status !== BookingStatus.renting && booking.status !== BookingStatus.overdue) {
        throw new ConflictException("Đơn không ở trạng thái có thể ghi nhận trả đồ.");
      }
      const deliverySnapshot = readBookingDeliverySnapshot(booking);
      await transitionBookingAssets(tx, id, AssetStatus.rented, AssetStatus.inspection_pending);
      const claimed = await tx.booking.updateMany({ where: { id, status: booking.status }, data: { status: BookingStatus.returned } });
      if (claimed.count !== 1) throw new ConflictException("Booking status was already changed by another request.");
      await this.applyOverdueFeeTx(tx, id);
      await tx.deliveryRecord.create({
        data: {
          bookingId: id,
          method: "return",
          addressSnapshot: deliverySnapshot ? JSON.stringify(deliverySnapshot) : null,
          receivedAt: new Date(),
          note: dto.note?.trim() || null,
        },
      });
      await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: booking.status, toStatus: BookingStatus.returned, changedBy: actorId, note: dto.note?.trim() || "Đã nhận lại trang phục." } });
      return tx.booking.findUniqueOrThrow({ where: { id }, include: { items: true, deliveryAddress: true, deliveryRecords: { orderBy: { createdAt: "desc" } } } });
    });
    this.realtime.bookingChanged({ id: updated.id, bookingId: updated.id, status: updated.status });
    this.realtime.bookingChangedForCustomer(updated.customerId, {
      id: updated.id,
      bookingId: updated.id,
      status: updated.status,
    });
    this.realtime.assetChanged({ bookingId: updated.id });
    return ok(this.serializeBooking(updated));
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
        deliveryRecords: { orderBy: { createdAt: "desc" } },
        customer: { select: { profile: { select: { fullName: true, phone: true } } } },
        items: {
          include: { garment_sizes: { include: { garments: true } } },
        },
      },
    });

    const points = bookings
      .map((b) => ({ booking: b, snapshot: readBookingDeliverySnapshot(b) }))
      .filter(({ snapshot }) => snapshot?.latitude != null && snapshot?.longitude != null)
      .map(({ booking: b, snapshot }) => ({
        bookingId: b.id,
        customerName: b.customer?.profile?.fullName ?? snapshot?.receiverName ?? "—",
        customerPhone: b.customer?.profile?.phone ?? snapshot?.phone ?? "—",
        status: b.status,
        address: [
          snapshot?.line1,
          snapshot?.ward,
          snapshot?.district,
          snapshot?.city,
        ]
          .filter(Boolean)
          .join(", "),
        latitude: Number(snapshot!.latitude),
        longitude: Number(snapshot!.longitude),
        garmentNames: b.items.map((i) => i.garment_sizes?.garments?.name ?? "—").join(", "),
        rentalStartDate: b.rentalStartDate.toISOString().slice(0, 10),
        rentalEndDate: b.rentalEndDate.toISOString().slice(0, 10),
      }));

    return ok(points);
  }

  async getDeliveryTrack(customerId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, customerId },
      include: { deliveryAddress: true, deliveryRecords: { orderBy: { createdAt: "desc" } } },
    });

    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.pickupMethod !== "delivery") {
      throw new BadRequestException("Đơn này không sử dụng giao hàng.");
    }
    const deliverySnapshot = readBookingDeliverySnapshot(booking);
    if (!deliverySnapshot?.latitude || !deliverySnapshot?.longitude) {
      throw new BadRequestException("Địa chỉ giao hàng chưa có tọa độ snapshot.");
    }

    const storeLatSetting = await this.prisma.systemSetting.findUnique({ where: { key: "store_lat" } });
    const storeLngSetting = await this.prisma.systemSetting.findUnique({ where: { key: "store_lng" } });
    const storeLat = Number((storeLatSetting?.value as any)?.value) || 10.7769;
    const storeLng = Number((storeLngSetting?.value as any)?.value) || 106.7009;

    const customerLat = Number(deliverySnapshot.latitude);
    const customerLng = Number(deliverySnapshot.longitude);

    // Determine real delivery status from DeliveryRecord milestones
    // (no simulated GPS — real location tracking not yet implemented)
    const deliveryRecord = booking.deliveryRecords.find((r) => r.method === "delivery");
    const isHandoverConfirmed = booking.handoverStatus === "CONFIRMED";
    const hasDeliveredAt = Boolean(deliveryRecord?.deliveredAt);

    let status: "preparing" | "in_transit" | "delivered";
    if (isHandoverConfirmed) {
      status = "delivered";
    } else if (hasDeliveredAt) {
      status = "in_transit";
    } else {
      status = "preparing";
    }

    return ok({
      bookingId: booking.id,
      status,
      /** GPS tracking is not available. Positions below are store and customer
       * destination only; shipper real-time location is not tracked. */
      shipperLocationAvailable: false,
      storeLat,
      storeLng,
      customerLat,
      customerLng,
      deliveredAt: deliveryRecord?.deliveredAt?.toISOString() ?? null,
      handoverConfirmed: isHandoverConfirmed,
      customerName: deliverySnapshot.receiverName,
      customerAddress: [
        deliverySnapshot.line1,
        deliverySnapshot.ward,
        deliverySnapshot.district,
        deliverySnapshot.city,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }

  async advanceStatus(id: string, dto: UpdateBookingStatusDto, changedBy?: string) {
    let notificationCustomerId: string | null = null;
    let notificationTargetStatus: BookingStatus | null = null;
    let notifyManagerConfirmed = false;

    const updated = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
        include: {
          items: true,
          payments: true,
          penalties: true,
        },
      });
      if (!booking) throw new NotFoundException("Booking not found.");

      if (
        dto.status === BookingStatus.renting &&
        booking.handoverStatus !== "CONFIRMED"
      ) {
        throw new BadRequestException(
          "Vui lòng xác nhận bàn giao trước khi chuyển đơn sang trạng thái đang thuê.",
        );
      }

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
        const accessoryItems = await tx.bookingAccessoryItem.findMany({
          where: { bookingId: id },
          select: { id: true, accessoryAssetId: true },
        });
        const unassignedAccessories = accessoryItems.filter((a) => !a.accessoryAssetId).length;
        if (unassignedAccessories > 0) {
          throw new BadRequestException(
            `All booking accessories must have an assigned asset before transitioning to '${dto.status}'. (${unassignedAccessories} chưa gán)`,
          );
        }
      }

      if (dto.status === BookingStatus.completed && booking.status === BookingStatus.inspection_pending) {
        throw new BadRequestException("Cannot directly complete a booking during inspection.");
      }

      if (dto.status === BookingStatus.paid) {
        throw new BadRequestException("Cannot manually set booking to 'paid'. Use the mark-paid endpoint.");
      }

      const alreadyPaid = booking.payments.some((p) => p.status === PaymentStatus.paid);
      const skipAwaitingPayment = dto.status === BookingStatus.awaiting_payment && alreadyPaid;
      const targetStatus = skipAwaitingPayment ? BookingStatus.paid : dto.status;
      const assetIds = booking.items
        .map((item) => item.garmentAssetId)
        .filter((assetId): assetId is string => Boolean(assetId));

      if (targetStatus === BookingStatus.preparing) await claimBookingAssets(tx, id);
      if (targetStatus === BookingStatus.renting) await transitionBookingAssets(tx, id, AssetStatus.reserved, AssetStatus.rented);
      if (targetStatus === BookingStatus.returned) await transitionBookingAssets(tx, id, AssetStatus.rented, AssetStatus.inspection_pending);
      if (targetStatus === BookingStatus.cancelled || targetStatus === BookingStatus.rejected) {
        await releaseBookingAssets(tx, id);
        await ensureCancellationRefunds(tx, id, changedBy, dto.note);
      }
      const claimedBooking = await tx.booking.updateMany({
        where: { id, status: booking.status },
        data: {
          status: targetStatus,
          ...(targetStatus === BookingStatus.awaiting_payment && booking.pickupMethod === "store_pickup"
            ? { paymentDueAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }
            : {}),
          ...(targetStatus === BookingStatus.paid ? { paymentDueAt: null } : {}),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });
      if (claimedBooking.count !== 1) {
        throw new ConflictException("Booking status was already changed by another request.");
      }

      if (assetIds.length > 0) {
        if (targetStatus === BookingStatus.returned) {
          await this.applyOverdueFeeTx(tx, booking.id);
        }
        if (targetStatus === BookingStatus.inspection_pending) {
          const pendingAssets = await tx.garmentAsset.count({
            where: { id: { in: assetIds }, status: AssetStatus.inspection_pending },
          });
          if (pendingAssets !== assetIds.length) {
            throw new ConflictException("Some assets are not ready for inspection.");
          }
        }
      }

      if (targetStatus === BookingStatus.cancelled || targetStatus === BookingStatus.rejected) {
        await this.vouchers?.releaseForBooking(tx, id);
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

      const saved = await tx.booking.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              garment_sizes: { include: { garments: true } },
              garmentAsset: true,
            },
          },
          accessoryItems: {
            include: {
              accessory: true,
              accessoryAsset: true,
              bookingItem: true,
            },
          },
          payments: true,
          deliveryRecords: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!saved) throw new NotFoundException("Booking not found.");

      notificationCustomerId = booking.customerId;
      notificationTargetStatus = targetStatus;
      notifyManagerConfirmed = targetStatus === BookingStatus.confirmed;
      return saved;
    });

    if (notificationCustomerId && notificationTargetStatus) {
      await this.notificationsService.sendBookingNotification({
        userId: notificationCustomerId,
        templateKey: "booking.status_changed",
        bookingId: updated.id,
        garmentName: updated.items[0]?.garment_sizes?.garments?.name ?? null,
        startDate: updated.rentalStartDate.toISOString().slice(0, 10),
        endDate: updated.rentalEndDate.toISOString().slice(0, 10),
        statusLabel: BOOKING_STATUS_LABELS[notificationTargetStatus] ?? notificationTargetStatus,
        note: dto.note ?? null,
      });
    }

    if (notifyManagerConfirmed) {
      await this.notificationsService.notifyStaffBooking({
        templateKey: "booking.staff.confirmed",
        bookingId: updated.id,
        customerName: await this.resolveCustomerName(updated.customerId),
        garmentName: updated.items[0]?.garment_sizes?.garments?.name ?? null,
        roles: [AppRole.manager_owner],
      });
    }

    this.realtime.bookingChanged({
      id: updated.id,
      bookingId: updated.id,
      status: updated.status,
    });
    this.realtime.assetChanged({ bookingId: updated.id });
    if (notificationCustomerId) {
      this.realtime.bookingChangedForCustomer(notificationCustomerId, {
        id: updated.id,
        bookingId: updated.id,
        status: updated.status,
      });
    }

    return ok(this.serializeBooking(updated));
  }

  async assignAsset(bookingId: string, itemId: string, dto: AssignAssetDto, staffId?: string) {
    const assignableStatuses: BookingStatus[] = [
      BookingStatus.confirmed,
      BookingStatus.awaiting_payment,
      BookingStatus.paid,
      BookingStatus.preparing,
    ];
    let assignedAssetCode: string | null = null;

    await this.prisma.runSerializable(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: { items: true },
        });
        if (!booking) throw new NotFoundException("Booking not found.");
        if (!assignableStatuses.includes(booking.status)) {
          throw new BadRequestException(
            `Không thể gán asset khi booking đang ở trạng thái '${booking.status}'.`,
          );
        }

        const item = booking.items.find((candidate) => candidate.id === itemId);
        if (!item) throw new NotFoundException("Booking item not found.");
        if (item.garmentAssetId) throw new BadRequestException("Item already has an assigned asset.");
        if (!item.garment_size_id) {
          throw new BadRequestException("Booking item chưa có size nên không thể gán asset an toàn.");
        }

        const asset = await tx.garmentAsset.findUnique({
          where: { id: dto.garmentAssetId },
        });
        if (!asset) throw new NotFoundException("Garment asset not found.");
        this.assertAssetRentable(asset.status);

        await assertAssetScheduleAvailable(tx, {
          assetId: asset.id, bookingId, itemId,
          startDay: booking.rentalStartDate, endDay: booking.rentalEndDate,
          garmentId: item.garmentId, garmentSizeId: item.garment_size_id,
        });

        await tx.bookingItem.update({
          where: { id: itemId },
          data: { garmentAssetId: dto.garmentAssetId },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: booking.status,
            changedBy: staffId ?? null,
            note: `Gán asset ${asset.assetCode}`,
          },
        });
        assignedAssetCode = asset.assetCode;
      });

    const updated = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!updated) throw new NotFoundException("Booking not found.");

    await this.notificationsService.notifyStaffBooking({
      templateKey: "booking.staff.asset_assigned",
      bookingId,
      garmentName: updated.items.find((i) => i.id === itemId)?.garment_sizes?.garments?.name ?? null,
      assetCode: assignedAssetCode,
    });

    return ok(this.serializeBooking(updated));
  }

  /**
   * Gán tài sản phụ kiện cụ thể cho 1 dòng phụ kiện trong booking.
   * Mirror của assignAsset nhưng cho accessory_assets (qua booking_accessory_items).
   */
  async assignAccessoryAsset(bookingId: string, accessoryItemId: string, dto: AssignAccessoryAssetDto, staffId?: string) {
    const assignableStatuses: BookingStatus[] = [
      BookingStatus.confirmed,
      BookingStatus.awaiting_payment,
      BookingStatus.paid,
      BookingStatus.preparing,
    ];
    let assignedAssetCode: string | null = null;

    await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { accessoryItems: true },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (!assignableStatuses.includes(booking.status)) {
        throw new BadRequestException(
          `Không thể gán asset khi booking đang ở trạng thái '${booking.status}'.`,
        );
      }

      const accessoryItem = booking.accessoryItems.find((candidate) => candidate.id === accessoryItemId);
      if (!accessoryItem) throw new NotFoundException("Booking accessory item not found.");
      if (accessoryItem.accessoryAssetId) throw new BadRequestException("Accessory item already has an assigned asset.");

      const asset = await tx.accessory_assets.findUnique({
        where: { id: dto.accessoryAssetId },
      });
      if (!asset) throw new NotFoundException("Accessory asset not found.");
      this.assertAssetRentable(asset.status);

      await assertAccessoryAssetScheduleAvailable(tx, {
        assetId: asset.id, bookingId, accessoryItemId,
        startDay: booking.rentalStartDate, endDay: booking.rentalEndDate,
        accessoryId: accessoryItem.accessoryId,
      });

      // Dòng legacy có quantity > 1 (tạo trước khi tách theo đơn vị):
      // tách phần còn lại thành dòng mới để mỗi dòng luôn là 1 đơn vị / 1 asset.
      const legacyQty = accessoryItem.quantity ?? 1;
      const perUnitTotal = Number(accessoryItem.unitPrice ?? 0)
        * parseRentalDateRange(booking.rentalStartDate, booking.rentalEndDate).days;
      await tx.bookingAccessoryItem.update({
        where: { id: accessoryItemId },
        data: { quantity: 1, accessoryAssetId: dto.accessoryAssetId, rentalTotal: perUnitTotal },
      });
      if (legacyQty > 1) {
        await tx.bookingAccessoryItem.create({
          data: {
            bookingId,
            bookingItemId: accessoryItem.bookingItemId,
            accessoryId: accessoryItem.accessoryId,
            quantity: legacyQty - 1,
            unitPrice: accessoryItem.unitPrice ?? 0,
            isIncluded: accessoryItem.isIncluded ?? true,
            rentalTotal: perUnitTotal * (legacyQty - 1),
          },
        });
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: booking.status,
          changedBy: staffId ?? null,
          note: `Gán accessory asset ${asset.asset_code}`,
        },
      });
      assignedAssetCode = asset.asset_code;
    });

    const updated = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: {
            garment_sizes: { include: { garments: true } },
            garmentAsset: true,
          },
        },
        accessoryItems: {
          include: {
            accessory: true,
            accessoryAsset: true,
            bookingItem: true,
          },
        },
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!updated) throw new NotFoundException("Booking not found.");

    await this.notificationsService.notifyStaffBooking({
      templateKey: "booking.staff.asset_assigned",
      bookingId,
      garmentName: null,
      assetCode: assignedAssetCode,
    });

    return ok(this.serializeBooking(updated));
  }

  /** Include đầy đủ để serialize booking kèm phụ kiện sau các thao tác accessory. */
  private bookingDetailsInclude() {
    return {
      items: {
        include: {
          garment_sizes: { include: { garments: true } },
          garmentAsset: true,
        },
      },
      accessoryItems: {
        include: {
          accessory: true,
          accessoryAsset: true,
          bookingItem: true,
        },
      },
      deliveryRecords: { orderBy: { createdAt: "desc" } },
    } as const;
  }

  /**
   * Ghi nhận kiểm tra 1 dòng phụ kiện khi khách trả đồ.
   * Mirror garment inspection complete nhưng nhẹ: lưu kết quả lên dòng phụ kiện
   * + chuyển trạng thái accessory asset (không có session/findings riêng).
   */
  async inspectBookingAccessory(
    bookingId: string,
    accessoryItemId: string,
    dto: InspectBookingAccessoryDto,
    staffId?: string,
  ) {
    const nextStatus = ACCESSORY_CONDITION_TO_ASSET_STATUS[dto.conditionStatus];
    if (!nextStatus) throw new BadRequestException("Tình trạng kiểm tra không hợp lệ.");

    await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { accessoryItems: true },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (!ACCESSORY_INSPECTABLE_STATUSES.includes(booking.status)) {
        throw new BadRequestException(
          "Chỉ kiểm tra phụ kiện khi đơn đã trả đồ (returned / inspection_pending).",
        );
      }

      const accessoryItem = booking.accessoryItems.find((candidate) => candidate.id === accessoryItemId);
      if (!accessoryItem) throw new NotFoundException("Booking accessory item not found.");
      if (!accessoryItem.accessoryAssetId) {
        throw new BadRequestException("Dòng phụ kiện chưa được gán tài sản nên không thể kiểm tra.");
      }

      const asset = await tx.accessory_assets.findUnique({
        where: { id: accessoryItem.accessoryAssetId },
      });
      if (!asset) throw new NotFoundException("Accessory asset not found.");

      // Phạt: hư hỏng → phiếu phạt staff nhập; mất → tự lấy giá trị đền.
      // Phạt cộng vào penaltyTotal nên tự trừ khi hoàn cọc (deposit - penalty).
      let penaltyAmount = 0;
      if (dto.conditionStatus === "lost") {
        const accessory = await tx.accessories.findUnique({
          where: { id: accessoryItem.accessoryId },
          select: { replacement_value: true, name: true },
        });
        penaltyAmount = Number(accessory?.replacement_value ?? 0);
      } else if (dto.conditionStatus === "damaged") {
        penaltyAmount = Math.max(0, Math.floor(dto.penaltyAmount ?? 0));
      }

      const note = dto.note?.trim() || null;
      const imageUrls = (dto.imageUrls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 5);
      if (imageUrls.length > 0 && staffId) {
        assertOwnedEvidenceUrls(imageUrls, { purpose: "handover", ownerId: staffId });
      }
      await tx.bookingAccessoryItem.update({
        where: { id: accessoryItemId },
        data: {
          conditionStatus: dto.conditionStatus,
          conditionNote: note,
          inspectedAt: new Date(),
          inspectedBy: staffId ?? null,
          penaltyAmount: penaltyAmount,
          conditionImages: imageUrls,
        },
      });
      if (asset.status !== nextStatus) {
        await tx.accessory_assets.update({
          where: { id: asset.id },
          data: { status: nextStatus },
        });
        await tx.accessory_asset_history.create({
          data: {
            asset_id: asset.id,
            action: "inspect",
            old_status: asset.status,
            new_status: nextStatus,
            note: note ?? `Kiểm tra trả đồ: ${dto.conditionStatus}`,
            created_by: staffId ?? null,
          },
        });
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: booking.status,
          changedBy: staffId ?? null,
          note: `Kiểm tra phụ kiện ${asset.asset_code}: ${dto.conditionStatus}`,
        },
      });
      if (penaltyAmount > 0) {
        const createdPenalty = await tx.penalty.create({
          data: {
            bookingId,
            reason: dto.conditionStatus === "lost"
              ? `Mất phụ kiện ${asset.asset_code} — đền theo giá trị`
              : `Hư hỏng phụ kiện ${asset.asset_code}${note ? `: ${note}` : ""}`,
            amount: penaltyAmount,
            createdBy: staffId ?? null,
          },
        });
        await tx.financialTransaction.create({
          data: {
            bookingId,
            penaltyId: createdPenalty.id,
            transactionType: "penalty",
            amount: penaltyAmount,
            note: `Khấu trừ phụ kiện (${dto.conditionStatus}).`,
          },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: { penaltyTotal: { increment: penaltyAmount } },
        });
      }
      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: this.bookingDetailsInclude(),
      });
    });

    // Phụ kiện vừa xong có thể là mảnh cuối cùng → thử đóng đơn kiểm tra.
    // Chạy transaction riêng SAU khi transaction ghi nhận đã commit.
    const finalizeResult = this.inspections
      ? await this.inspections.tryFinalizeBookingInspection(bookingId, staffId ?? "")
      : null;

    const fresh = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: this.bookingDetailsInclude(),
    });
    if (!fresh) throw new NotFoundException("Booking not found.");

    this.realtime.assetChanged({ bookingId: fresh.id });
    this.realtime.inspectionChanged({ bookingId: fresh.id });
    // Mirror garment complete để tab Giặt sấy / Hư hỏng của manager tự refresh.
    if (dto.conditionStatus === "laundry") {
      this.realtime.laundryChanged({ bookingId: fresh.id });
    }
    if (dto.conditionStatus === "maintenance") {
      this.realtime.maintenanceChanged({ bookingId: fresh.id });
    }
    return ok({ ...this.serializeBooking(fresh), inspectionFinalized: finalizeResult?.data?.finalized ?? false });
  }

  /**
   * Xác nhận handover - lưu tình trạng sản phẩm tại thời điểm bàn giao.
   * Gọi khi khách/nhân viên kiểm tra và xác nhận sản phẩm trước khi nhận.
   */
  async confirmHandover(
    bookingId: string,
    dto: ConfirmHandoverDto,
    actor: Pick<AuthenticatedUser, "id" | "role">,
  ) {
    let customerId: string | null = null;
    let statusChanged = false;

    const updated = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          items: { include: { garmentAsset: true } },
          deliveryRecords: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!booking) throw new NotFoundException("Booking not found.");

      if (actor.role === AppRole.customer && booking.customerId !== actor.id) {
        throw new ForbiddenException("You do not have access to this booking.");
      }
      if (actor.role !== AppRole.customer && !OPERATIONAL_ROLES.includes(actor.role)) {
        throw new ForbiddenException("You do not have permission to confirm handover.");
      }
      if (!HANDOVER_BOOKING_STATUSES.includes(booking.status)) {
        throw new BadRequestException(
          `Chỉ có thể xác nhận bàn giao khi booking ở trạng thái 'ready_for_pickup', 'delivering' hoặc 'renting' (hiện tại: '${booking.status}').`,
        );
      }
      if (booking.items.length === 0 || booking.items.some((item) => !item.garmentAsset)) {
        throw new BadRequestException("Tất cả booking item phải được gán asset trước khi bàn giao.");
      }

      const requestedStatus = dto.handoverStatus;
      const currentHandoverStatus = booking.handoverStatus;
      if (currentHandoverStatus === "CONFIRMED" || currentHandoverStatus === "REJECTED") {
        if (currentHandoverStatus !== requestedStatus) {
          throw new ConflictException("Biên bản bàn giao đã hoàn tất và không thể ghi đè.");
        }
        return tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: {
            items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } },
            payments: true,
            deliveryAddress: true,
            deliveryRecords: { orderBy: { createdAt: "desc" } },
          },
        });
      }
      if (requestedStatus === "PENDING") {
        return booking;
      }
      if (requestedStatus === "CONFIRMED") {
        if (dto.correctProductConfirmed !== true || dto.customerAgreed !== true) {
          throw new BadRequestException("Cần xác nhận đúng sản phẩm và người nhận đồng ý trước khi bàn giao.");
        }
        if (!dto.conditionImages?.length || !dto.deliveredBy?.trim() || !dto.receivedBy?.trim()) {
          throw new BadRequestException("Cần có ảnh bàn giao, người giao và người nhận.");
        }
        if (dto.conditionBeforeRental === "MINOR_DAMAGE" && !dto.note?.trim()) {
          throw new BadRequestException("Cần mô tả lỗi nhẹ trước khi bàn giao.");
        }
        if (dto.conditionBeforeRental === "MAJOR_DAMAGE") {
          throw new BadRequestException("Không thể xác nhận nhận hàng khi sản phẩm có lỗi nặng.");
        }
        if (dto.conditionBeforeRental === "GOOD" && dto.noDefectConfirmed !== true) {
          throw new BadRequestException("Cần xác nhận sản phẩm không có lỗi trước khi nhận.");
        }
      } else if (!dto.note?.trim()) {
        throw new BadRequestException("Cần ghi rõ lý do từ chối bàn giao.");
      }

      const evidenceImages = dto.conditionImages?.length
        ? assertOwnedEvidenceUrls(dto.conditionImages, { purpose: "handover", ownerId: actor.id })
        : [];
      const expectedAssetStatus = booking.status === BookingStatus.renting
        ? AssetStatus.rented
        : AssetStatus.reserved;
      for (const item of booking.items) {
        const asset = item.garmentAsset!;
        if (asset.garmentId !== item.garmentId || asset.garment_size_id !== item.garment_size_id) {
          throw new BadRequestException("Asset được gán không khớp với booking item.");
        }
        if (asset.status !== expectedAssetStatus) {
          throw new BadRequestException(
            `Asset '${asset.assetCode}' không ở trạng thái hợp lệ cho bàn giao (current: ${asset.status}).`,
          );
        }
      }

      const savedEvidence = booking.conditionImages && !Array.isArray(booking.conditionImages) && typeof booking.conditionImages === "object" ? booking.conditionImages : {};
      const evidence = {
        ...(Array.isArray(savedEvidence.history) ? { history: savedEvidence.history } : {}),
        images: evidenceImages,
        checklist: {
          correctProduct: dto.correctProductConfirmed ?? false,
          noDefectBeforeRental: dto.noDefectConfirmed ?? false,
          customerAgreed: dto.customerAgreed ?? false,
        },
        deliveredBy: dto.deliveredBy?.trim() || null,
        receivedBy: dto.receivedBy?.trim() || null,
        receiverPhone: dto.receiverPhone?.trim() || null,
        note: dto.note?.trim() || null,
      };
      const isConfirmed = requestedStatus === "CONFIRMED";
      const nextBookingStatus = isConfirmed && booking.status !== BookingStatus.renting
        ? BookingStatus.renting
        : booking.status;
      const now = new Date();
      if (isConfirmed && booking.status !== BookingStatus.renting) {
        this.validateAssetTransition(AssetStatus.reserved, AssetStatus.rented);
        await transitionBookingAssets(tx, bookingId, AssetStatus.reserved, AssetStatus.rented);
      }

      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: booking.status, handoverStatus: currentHandoverStatus },
        data: {
          status: nextBookingStatus,
          handoverStatus: requestedStatus,
          conditionBeforeRental: dto.conditionBeforeRental,
          conditionImages: evidence,
          ...(isConfirmed || requestedStatus === "REJECTED"
            ? { confirmedAt: now, confirmedBy: actor.id }
            : {}),
        },
      });
      if (claimed.count !== 1) throw new ConflictException("Bàn giao vừa được cập nhật bởi người khác.");

      if (isConfirmed && booking.status !== BookingStatus.renting) {
        statusChanged = true;
      }

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: nextBookingStatus,
          changedBy: actor.id,
          note: `Bàn giao ${requestedStatus}${dto.note ? `: ${dto.note}` : ""}`,
        },
      });

      customerId = booking.customerId;
      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: {
          items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } },
          payments: true,
          deliveryAddress: true,
          deliveryRecords: { orderBy: { createdAt: "desc" } },
        },
      });
    });

    this.realtime.bookingChanged({ id: updated.id, bookingId: updated.id, status: updated.status });
    if (statusChanged) this.realtime.assetChanged({ bookingId: updated.id });
    if (customerId) {
      this.realtime.bookingChangedForCustomer(customerId, {
        id: updated.id,
        bookingId: updated.id,
        status: updated.status,
      });
    }

    return ok(this.serializeBooking(updated));
  }

  async recoverHandover(id: string, dto: RecoverHandoverDto, actor: Pick<AuthenticatedUser, "id" | "role">) {
    if (actor.role !== AppRole.manager_owner && actor.role !== AppRole.admin) {
      throw new ForbiddenException("Chỉ quản lý được xử lý bàn giao bị từ chối.");
    }
    if (!dto.reason.trim()) throw new BadRequestException("Cần lý do xử lý.");
    const saved = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id }, include: { items: true } });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.handoverStatus !== "REJECTED" ||
          ![BookingStatus.ready_for_pickup, BookingStatus.delivering, BookingStatus.renting].includes(booking.status as never) ||
          booking.confirmedAt?.getTime() !== new Date(dto.expectedDecidedAt).getTime()) {
        throw new ConflictException("Biên bản đã thay đổi, vui lòng tải lại đơn.");
      }
      const previous = booking.conditionImages && !Array.isArray(booking.conditionImages) && typeof booking.conditionImages === "object"
        ? booking.conditionImages : {};
      const history = Array.isArray(previous.history) ? previous.history : [];
      const evidence = { ...previous };
      delete evidence.history;
      const archived = [...history, {
        status: booking.handoverStatus, conditionBeforeRental: booking.conditionBeforeRental,
        decidedAt: booking.confirmedAt!.toISOString(), confirmedBy: booking.confirmedBy,
        evidence, action: dto.action, reason: dto.reason.trim(), resolvedBy: actor.id,
        resolvedAt: new Date().toISOString(),
      }];
      const replacements = dto.replacements ?? [];
      if (dto.action === "replace") {
        // The original condition is booking-wide; quarantine every assigned asset
        // when damage was reported, rather than silently returning it to inventory.
        const ids = new Set(replacements.map((row) => row.itemId));
        if (ids.size !== booking.items.length || replacements.length !== booking.items.length ||
            booking.items.some((item) => !ids.has(item.id)) ||
            new Set(replacements.map((row) => row.garmentAssetId)).size !== replacements.length ||
            replacements.some((row) => booking.items.some((item) => item.garmentAssetId === row.garmentAssetId))) {
          throw new BadRequestException("Cần chọn asset thay thế riêng biệt cho tất cả sản phẩm.");
        }
        for (const row of replacements) {
          const item = booking.items.find((candidate) => candidate.id === row.itemId)!;
          await assertAssetScheduleAvailable(tx, {
            assetId: row.garmentAssetId, bookingId: id, itemId: item.id,
            garmentId: item.garmentId, garmentSizeId: item.garment_size_id ?? undefined,
            startDay: booking.rentalStartDate, endDay: booking.rentalEndDate,
          });
        }
      }
      if (booking.conditionBeforeRental === "MINOR_DAMAGE" || booking.conditionBeforeRental === "MAJOR_DAMAGE") {
        await transitionBookingAssets(tx, id, AssetStatus.reserved, AssetStatus.rented);
        const quarantined = await tx.garmentAsset.updateMany({
          where: { id: { in: booking.items.map((item) => item.garmentAssetId!) }, status: AssetStatus.rented },
          data: { status: AssetStatus.inspection_pending },
        });
        if (quarantined.count !== booking.items.length) throw new ConflictException("Không thể cách ly asset.");
      } else {
        await releaseBookingAssets(tx, id);
      }
      if (dto.action === "replace") {
        for (const row of replacements) await tx.bookingItem.update({ where: { id: row.itemId }, data: { garmentAssetId: row.garmentAssetId } });
        await claimBookingAssets(tx, id);
      } else {
        await ensureCancellationRefunds(tx, id, actor.id, dto.reason);
      }
      const nextStatus = dto.action === "replace" ? BookingStatus.preparing : BookingStatus.cancelled;
      const claimed = await tx.booking.updateMany({
        where: { id, status: booking.status, handoverStatus: "REJECTED", confirmedAt: booking.confirmedAt },
        data: {
          status: nextStatus,
          ...(dto.action === "replace" ? { handoverStatus: "PENDING", confirmedAt: null, confirmedBy: null, conditionBeforeRental: null } : {}),
          conditionImages: (dto.action === "replace" ? { history: archived } : { ...previous, history: archived }) as Prisma.InputJsonValue,
        },
      });
      if (claimed.count !== 1) throw new ConflictException("Biên bản đã được người khác xử lý.");
      await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: booking.status, toStatus: nextStatus, changedBy: actor.id, note: dto.reason.trim() } });
      return tx.booking.findUniqueOrThrow({
        where: { id },
        include: {
          items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } },
          payments: true,
          deliveryAddress: true,
          deliveryRecords: { orderBy: { createdAt: "desc" } },
        },
      });
    });
    this.realtime.bookingChanged({ id, bookingId: id, status: saved.status });
    this.realtime.bookingChangedForCustomer(saved.customerId, { id, bookingId: id, status: saved.status });
    this.realtime.assetChanged({ bookingId: id });
    this.realtime.refundChanged({ bookingId: id });
    return ok(this.serializeBooking(saved));
  }

  async markPaid(id: string, dto: MarkPaidDto, staffId?: string) {
    const result = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id }, include: { items: true, payments: true } });
      if (!booking) throw new NotFoundException("Booking not found.");
      const include = {
        items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } },
        payments: true,
        deliveryAddress: true,
        deliveryRecords: { orderBy: { createdAt: "desc" } },
      } as const;
      const alreadyPaid = booking.payments.some((p) => p.status === PaymentStatus.paid);
      if (booking.status === BookingStatus.paid && alreadyPaid) {
        return { changed: false, booking, updated: await tx.booking.findUniqueOrThrow({ where: { id }, include }) };
      }
      if (booking.status !== BookingStatus.awaiting_payment && booking.status !== BookingStatus.confirmed) {
        throw new BadRequestException(`Booking must be in 'confirmed' or 'awaiting_payment' to mark as paid (current: ${booking.status}).`);
      }
      if (booking.pickupMethod === "delivery" && !alreadyPaid) {
        throw new BadRequestException("Đơn giao tận nơi phải được khách thanh toán qua QR trước khi xác nhận.");
      }
      const paymentMethod = dto.paymentMethod ?? booking.paymentMethod ?? "cash";
      const totalAmount = new Prisma.Decimal(booking.rentalTotal).plus(booking.shippingFee ?? 0);
      const depositAmount = new Prisma.Decimal(booking.depositTotal);
      const previousStatus = booking.status;
      const claimed = await tx.booking.updateMany({
        where: { id, status: previousStatus },
        data: { status: BookingStatus.paid, paymentDueAt: null },
      });
      if (claimed.count !== 1) throw new ConflictException("Booking vừa được xử lý bởi yêu cầu khác.");
      // Chỉ tạo bản ghi thu tiền khi chưa có payment thành công (tránh ghi trùng với tiền QR đã vào)
      if (!alreadyPaid) {
        const payment = await tx.payment.create({
          data: {
            bookingId: id, provider: "manual", paymentMethod,
            amount: totalAmount.plus(depositAmount), depositAmount, status: PaymentStatus.paid, paidAt: new Date(),
          },
        });
        if (totalAmount.gt(0)) {
          await tx.financialTransaction.create({
            data: {
              bookingId: id,
              paymentId: payment.id,
              transactionType: "payment",
              amount: totalAmount,
              note: "Thanh toán tiền thuê",
            },
          });
        }
        if (depositAmount.gt(0)) {
          await tx.financialTransaction.create({
            data: {
              bookingId: id,
              paymentId: payment.id,
              transactionType: "deposit",
              amount: depositAmount,
              note: "Thanh toán tiền cọc",
            },
          });
        }
      }
      await tx.bookingStatusHistory.create({
        data: { bookingId: id, fromStatus: previousStatus, toStatus: BookingStatus.paid, changedBy: staffId ?? null, note: "Đã thanh toán" },
      });
      return { changed: true, booking, updated: await tx.booking.findUniqueOrThrow({ where: { id }, include }) };
    });
    const { booking, updated } = result;
    if (!result.changed) return ok(this.serializeBooking(updated));

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
      amount: Number(booking.rentalTotal) + Number(booking.shippingFee ?? 0) + Number(booking.depositTotal),
    });

    this.realtime.bookingChanged({
      id: updated!.id,
      bookingId: updated!.id,
      status: BookingStatus.paid,
    });
    // Staff ghi nhận thu tiền trên đơn của khách → khách đang mở dashboard
    // phải thấy trạng thái mới mà không cần reload.
    this.realtime.bookingChangedForCustomer(updated!.customerId, {
      id: updated!.id,
      bookingId: updated!.id,
      status: BookingStatus.paid,
    });

    return ok(this.serializeBooking(updated!));
  }

  async cancelExpiredAwaitingPayments() {
    const now = new Date();
    const expiredBookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.awaiting_payment, paymentDueAt: { lt: now } },
      include: { items: true },
    });
    const results: { bookingId: string; released: number }[] = [];
    for (const booking of expiredBookings) {
      const cancelled = await this.prisma.runSerializable(async (tx) => {
        const current = await tx.booking.findUnique({
          where: { id: booking.id },
          include: { items: true, payments: true },
        });
        if (!current || current.status !== BookingStatus.awaiting_payment ||
            !current.paymentDueAt || current.paymentDueAt >= now ||
            current.payments.some((payment) => payment.status === PaymentStatus.paid)) return false;
        await releaseBookingAssets(tx, booking.id);
        // Ghi nhận yêu cầu hoàn tiền nếu đơn đã thu tiền trước khi hủy tự động.
        await ensureCancellationRefunds(tx, booking.id, undefined, "Tự động hủy đơn — quá hạn thanh toán");
        const claimed = await tx.booking.updateMany({
          where: { id: booking.id, status: BookingStatus.awaiting_payment, paymentDueAt: { lt: now } },
          data: { status: BookingStatus.cancelled, paymentDueAt: null },
        });
        if (claimed.count !== 1) throw new ConflictException("Booking vừa được xử lý bởi yêu cầu khác.");

        await tx.bookingStatusHistory.create({
          data: { bookingId: booking.id, fromStatus: BookingStatus.awaiting_payment, toStatus: BookingStatus.cancelled, note: "Tự động hủy — quá hạn thanh toán" },
        });
        await this.vouchers?.releaseForBooking(tx, booking.id);
        return true;
      });
      if (!cancelled) continue;

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

      this.realtime.bookingChanged({
        id: booking.id,
        bookingId: booking.id,
        status: BookingStatus.cancelled,
      });
      this.realtime.assetChanged({ bookingId: booking.id });
    }
    return ok({ expiredCount: results.length, releasedAssets: results.reduce((s, r) => s + r.released, 0), bookings: results.map((r) => r.bookingId) });
  }

  // ── Overdue & phí phạt quá hạn ─────────────────────────────────────────────

  // Ghi nhận phí quá hạn 10.000đ/ngày cho một booking (idempotent — gọi lại chỉ
  // cập nhật số tiền theo số ngày quá hạn hiện tại, không tạo bản ghi trùng).
  private async applyOverdueFeeTx(tx: Prisma.TransactionClient, bookingId: string) {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { penalties: true },
    });
    if (!booking) return null;

    const days = this.overdueDays(booking.rentalEndDate);
    const amount = days * OVERDUE_FEE_PER_DAY;
    if (amount <= 0) return null;

    const existing = booking.penalties.find((p) => p.reason === OVERDUE_PENALTY_REASON);
    const previous = existing ? Number(existing.amount) : 0;
    const delta = amount - previous;
    if (delta !== 0) {
      if (existing) {
        await tx.penalty.update({ where: { id: existing.id }, data: { amount } });
      } else {
        await tx.penalty.create({ data: { bookingId, reason: OVERDUE_PENALTY_REASON, amount } });
      }
      await tx.booking.update({
        where: { id: bookingId },
        data: { penaltyTotal: { increment: delta } },
      });
    }

    return { bookingId, days, amount };
  }

  async applyOverdueFee(bookingId: string) {
    return this.prisma.runSerializable((tx) => this.applyOverdueFeeTx(tx, bookingId));
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
      select: { id: true },
    });

    const newlyOverdue: {
      id: string;
      customerId: string;
      rentalStartDate: Date;
      rentalEndDate: Date;
      garmentName: string | null;
    }[] = [];
    const fees = new Map<string, { days: number; amount: number }>();

    for (const candidate of toMark) {
      const result = await this.prisma.runSerializable(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: candidate.id },
          include: { items: { include: { garment_sizes: { include: { garments: true } } } } },
        });
        if (!booking || booking.status !== BookingStatus.renting) return null;

        const claimed = await tx.booking.updateMany({
          where: { id: booking.id, status: BookingStatus.renting },
          data: { status: BookingStatus.overdue },
        });
        if (claimed.count !== 1) return null;

        await tx.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            fromStatus: BookingStatus.renting,
            toStatus: BookingStatus.overdue,
            note: "Tự động đánh dấu quá hạn — khách chưa trả đồ sau ngày kết thúc thuê",
          },
        });
        const fee = await this.applyOverdueFeeTx(tx, booking.id);
        return {
          booking: {
            id: booking.id,
            customerId: booking.customerId,
            rentalStartDate: booking.rentalStartDate,
            rentalEndDate: booking.rentalEndDate,
            garmentName: booking.items[0]?.garment_sizes?.garments?.name ?? null,
          },
          fee,
        };
      });
      if (!result) continue;
      newlyOverdue.push(result.booking);
      if (result.fee) fees.set(result.booking.id, { days: result.fee.days, amount: result.fee.amount });
    }

    // Cộng dồn phí phạt cho tất cả đơn đang quá hạn (kể cả đơn staff đánh dấu tay)
    const overdueBookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.overdue },
      select: { id: true, customerId: true },
    });
    for (const { id, customerId } of overdueBookings) {
      const fee = await this.applyOverdueFee(id);
      if (!fee) continue;
      fees.set(id, { days: fee.days, amount: fee.amount });
      // Đơn đã quá hạn từ hôm trước vẫn tăng phí mỗi ngày → phải báo chủ đơn
      // để ô "quá hạn N ngày" và phí phạt trên dashboard khách tự cập nhật.
      if (!newlyOverdue.some((b) => b.id === id)) {
        this.realtime.bookingChangedForCustomer(customerId, {
          id,
          bookingId: id,
          status: BookingStatus.overdue,
        });
      }
    }

    // Chỉ thông báo cho các đơn vừa bị đánh dấu quá hạn
    for (const booking of newlyOverdue) {
      const fee = fees.get(booking.id);
      await this.notificationsService.sendBookingNotification({
        userId: booking.customerId,
        templateKey: "booking.overdue",
        bookingId: booking.id,
        garmentName: booking.garmentName,
        startDate: booking.rentalStartDate.toISOString().slice(0, 10),
        endDate: booking.rentalEndDate.toISOString().slice(0, 10),
        amount: (fee?.amount ?? OVERDUE_FEE_PER_DAY).toLocaleString("vi-VN") + " đ",
        overdueDays: fee?.days ?? 1,
      });
    }

    for (const booking of newlyOverdue) {
      this.realtime.bookingChanged({
        id: booking.id,
        bookingId: booking.id,
        status: BookingStatus.overdue,
      });
      // Phí quá hạn vừa tăng → khách phải thấy ngay số ngày trễ mà không cần reload.
      this.realtime.bookingChangedForCustomer(booking.customerId, {
        id: booking.id,
        bookingId: booking.id,
        status: BookingStatus.overdue,
      });
    }

    return ok({
      markedCount: newlyOverdue.length,
      accruedCount: fees.size,
      bookings: newlyOverdue.map((b) => b.id),
    });
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  private hasCompletedInspectionForEveryAssignedAsset(booking: any) {
    const assetIds = (booking.items ?? [])
      .map((item: any) => item.garmentAssetId)
      .filter((assetId: string | null | undefined): assetId is string => Boolean(assetId));
    const distinctAssetIds = new Set(assetIds);
    if (assetIds.length === 0 || assetIds.length !== (booking.items ?? []).length || distinctAssetIds.size !== assetIds.length) {
      return false;
    }
    const inspectedAssetIds = new Set((booking.inspections ?? []).map((session: any) => session.garmentAssetId));
    return [...distinctAssetIds].every((assetId) => inspectedAssetIds.has(assetId));
  }

  private serializeStaffBooking(booking: any) {
    return {
      ...this.serializeBooking(booking),
      customerName: booking.customer?.profile?.fullName ?? booking.customer?.email ?? null,
      customerPhone: booking.customer?.profile?.phone ?? null,
    };
  }

  private serializeHandover(booking: any) {
    const raw = booking.conditionImages;
    const evidence = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const images = Array.isArray(evidence.images)
      ? evidence.images.filter((image: unknown): image is string => typeof image === "string")
      : Array.isArray(raw)
        ? raw.filter((image: unknown): image is string => typeof image === "string")
        : [];
    const checklist = evidence.checklist && typeof evidence.checklist === "object"
      ? evidence.checklist
      : {};
    const confirmed = booking.handoverStatus === "CONFIRMED";

    return {
      status: booking.handoverStatus ?? null,
      conditionBeforeRental: booking.conditionBeforeRental ?? null,
      images,
      note: typeof evidence.note === "string" ? evidence.note : null,
      receiverName: typeof evidence.receivedBy === "string" ? evidence.receivedBy : null,
      deliveryPersonName: typeof evidence.deliveredBy === "string" ? evidence.deliveredBy : null,
      receiverPhone: typeof evidence.receiverPhone === "string" ? evidence.receiverPhone : null,
      correctProduct: typeof checklist.correctProduct === "boolean" ? checklist.correctProduct : null,
      noVisibleDefect: typeof checklist.noDefectBeforeRental === "boolean" ? checklist.noDefectBeforeRental : null,
      customerAgreed: typeof checklist.customerAgreed === "boolean" ? checklist.customerAgreed : null,
      decidedAt: booking.confirmedAt?.toISOString?.() ?? null,
      receivedAt: confirmed ? booking.confirmedAt?.toISOString?.() ?? null : null,
      confirmedBy: booking.confirmedBy ?? null,
      history: Array.isArray(evidence.history) ? evidence.history : [],
    };
  }

  private serializeBooking(booking: any, days?: number) {
    const start = new Date(booking.rentalStartDate);
    const end = new Date(booking.rentalEndDate);
    const computedDays = days ?? Math.round(
      (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / MS_PER_DAY,
    ) + 1;

    // Chỉ đơn còn giữ đồ mới "quá hạn" — đã trả/đã huỷ thì ngày trễ không còn ý nghĩa.
    const overdueDays = this.overdueDays(booking.rentalEndDate);
    const isOverdue = overdueDays > 0 && OVERDUE_ELIGIBLE_STATUSES.includes(booking.status);
    const accessoryRows: any[] = booking.accessoryItems ?? booking.booking_accessory_items ?? [];

    return {
      id: booking.id,
      status: booking.status,
      rentalStartDate: start.toISOString().slice(0, 10),
      rentalEndDate: end.toISOString().slice(0, 10),
      days: computedDays,
      pickupMethod: booking.pickupMethod,
      subtotal: Number(booking.subtotal ?? booking.rentalTotal),
      discountTotal: Number(booking.discountTotal ?? 0),
      voucherCode: booking.voucherCode ?? null,
      rentalTotal: Number(booking.rentalTotal),
      depositTotal: Number(booking.depositTotal),
      shippingFee: Number(booking.shippingFee ?? 0),
      penaltyTotal: Number(booking.penaltyTotal ?? 0),
      overdueDays: isOverdue ? overdueDays : 0,
      overdueFeePerDay: OVERDUE_FEE_PER_DAY,
      overdueAmount: isOverdue ? overdueDays * OVERDUE_FEE_PER_DAY : 0,
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
      deliverySnapshot: readBookingDeliverySnapshot(booking),
      paymentMethod: booking.paymentMethod ?? "cash",
      paidPaymentMethod:
        (booking.payments ?? []).find((p: any) => p.status === PaymentStatus.paid)?.paymentMethod ?? null,
      createdAt: booking.createdAt.toISOString(),
      handover: this.serializeHandover(booking),
      items: (booking.items ?? []).map((item: any) => ({
        id: item.id,
        garmentSizeId: item.garment_size_id,
        garmentId: item.garmentId,
        garmentName: item.garment_sizes?.garments?.name ?? null,
        imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
        sizeLabel: item.garment_sizes?.size_label ?? null,
        dailyPrice: Number(item.dailyPrice),
        basePrice: Number(item.basePrice ?? item.dailyPrice),
        discountPrice: Number(item.discountPrice ?? item.dailyPrice),
        appliedPriceRule: item.appliedPriceRule ?? null,
        depositAmount: Number(item.depositAmount),
        garmentAssetId: item.garmentAssetId ?? item.garmentAsset?.id ?? null,
        assetCode: item.garmentAsset?.assetCode ?? null,
        assetStatus: item.garmentAsset?.status ?? null,
        conditionNote: item.garmentAsset?.conditionNote ?? null,
      })),
      accessories: accessoryRows.map((row: any) => ({
        id: row.id,
        bookingItemId: row.bookingItemId ?? row.booking_item_id ?? null,
        garmentSizeId: row.bookingItem?.garment_size_id ?? null,
        garmentId: row.bookingItem?.garmentId ?? null,
        accessoryId: row.accessoryId ?? row.accessory_id,
        accessoryCode: row.accessory?.code ?? null,
        accessoryName: row.accessory?.name ?? null,
        imageUrl: row.accessory?.image_url ?? null,
        quantity: row.quantity ?? 1,
        unitPrice: Number(row.unitPrice ?? row.unit_price ?? 0),
        isIncluded: row.isIncluded ?? row.is_included ?? true,
        rentalTotal: Number(row.rentalTotal ?? row.rental_total ?? 0),
        accessoryAssetId: row.accessoryAssetId ?? row.accessory_asset_id ?? null,
        assetCode: row.accessoryAsset?.asset_code ?? null,
        replacementValue: Number(row.accessory?.replacement_value ?? 0),
        conditionStatus: row.conditionStatus ?? row.condition_status ?? null,
        conditionNote: row.conditionNote ?? row.condition_note ?? null,
        inspectedAt: row.inspectedAt?.toISOString?.() ?? row.inspected_at?.toISOString?.() ?? null,
        penaltyAmount: Number(row.penaltyAmount ?? row.penalty_amount ?? 0),
        conditionImages: row.conditionImages ?? row.condition_images ?? [],
      })),
    };
  }
}





