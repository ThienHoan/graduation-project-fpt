import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { AppRole, AssetStatus, BookingStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import { NotificationsService } from "../notifications/notifications.service";
import { PaymentsService } from "../payments/payments.service";
import { PricingService } from "../pricing/pricing.service";
import { VouchersService } from "../vouchers/vouchers.service";
import { rankAssetCandidates } from "./booking-auto-assign";
import { allocateGarmentLines, quoteChange } from "./booking-change-pricing";
import {
  INCIDENT_HOLD_MINUTES,
  INCIDENT_MANAGER_HOLD_MINUTES,
  OPEN_INCIDENT_STATUSES,
  PRE_HANDOVER_STATUSES,
} from "./booking-incidents.constants";
import { incidentReasonLabel, incidentResolutionLabel, type IncidentItemKind } from "./booking-incidents.helper";
import {
  DAY_MS,
  DEFAULT_LAUNDRY_BUFFER_DAYS,
  INVENTORY_RELEASED_STATUSES,
  RENTABLE_ASSET_STATUSES,
  isUnreturnedOverdue,
  loadSizeInventory,
  parseRentalDateRange,
  sizeAvailability,
  vietnamToday,
} from "./booking-inventory";
import { loadActiveHolds } from "./booking-change-holds";
import {
  buildCancellationEmail,
  buildProposalEmail,
  buildRemovalEmail,
  cancellationEmailSubject,
  incidentActionUrl,
  proposalEmailSubject,
  removalEmailSubject,
  type IncidentEmailItem,
} from "./incident-email.builder";
import {
  assertAccessoryAssetScheduleAvailable,
  assertAssetScheduleAvailable,
  cancelBookingTx,
  releaseBookingAsset,
  STAFF_CANCELLABLE_STATUSES,
} from "./booking-reservations";
import type { AddAccessoryDto, CreateChangeRequestDto } from "./dto/change-request.dto";
import type { ManagerIncidentActionDto } from "./dto/manager-incident-action.dto";

/**
 * Mục 4.4 — yêu cầu đổi mẫu / bỏ món.
 *
 * Phase 3: xem sự cố + gợi ý (§7.1), báo giá + giữ chỗ asset cụ thể (§7.2),
 * hết hạn / khách hủy / từ chối (§7.4). Áp dụng ghi DB thật nằm ở Phase 4.
 */

type BookingRow = Prisma.BookingGetPayload<{
  include: {
    items: { include: { garment_sizes: { include: { garments: { include: { images: true } } } } } };
    accessoryItems: { include: { accessory: true; bookingItem: { select: { id: true; garmentId: true } } } };
    customer: { include: { profile: true } };
  };
}>;

const PENDING_STATUSES = ["quoted", "awaiting_payment"] as const;

/** Đơn đã dừng hẳn (huỷ/từ chối) → hiển thị tiền hoàn thay vì thu thêm. */
const CANCELLED_BOOKING_STATUSES = ["cancelled", "rejected"] as const;

/** Thông điệp `runSerializable` ném khi hết lượt retry P2034 — lỗi tạm thời. */
const SERIALIZABLE_BUSY_MESSAGE = "Hệ thống đang bận, vui lòng thử lại.";

/** Một dòng áo bị đổi mẫu: giá mới đã chốt lúc báo giá (§6.1). */
type ReplacedGarment = {
  incidentId: string;
  itemId: string;
  sizeId: string;
  garmentId: string;
  newLine: number;
  newDeposit: number;
  /** Giá/ngày gốc của size mới (ghi lại vào BookingItem khi áp dụng). */
  basePrice: number;
  /** Giá/ngày sau rule (= discountPrice) của size mới. */
  discountPrice: number;
  /** Tên/ảnh/size của mẫu mới — dùng cho danh sách món sau thay đổi ở báo giá. */
  name: string;
  imageUrl: string | null;
  sizeLabel: string | null;
  /** Asset cụ thể được chọn + giữ chỗ (điền trong transaction). */
  garmentAssetId?: string;
};

/** Một đơn vị phụ kiện thêm: giá đã chốt lúc báo giá (§9). */
type AddedAccessory = AddAccessoryDto & {
  garmentId: string;
  unitPrice: number;
  lineTotal: number;
  /** Tên/ảnh mẫu phụ kiện — dùng cho danh sách món sau thay đổi ở báo giá. */
  name: string;
  imageUrl: string | null;
  /** accessory asset cụ thể được chọn + giữ chỗ (điền trong transaction). */
  accessoryAssetId?: string;
};

/**
 * Một phụ kiện bị sự cố được THAY. Hai trường hợp:
 *  - Cùng `accessory_id` (1.5): chỉ đổi tài sản vật lý, giá giữ nguyên.
 *  - Mẫu phụ kiện KHÁC (`accessoryId` mới, cùng `garment_accessories`): đổi cả
 *    dòng `booking_accessory_items` (mẫu + đơn giá + thành tiền), chênh lệch đi
 *    vào `removedAccessoryAmount` / `addedAccessoryAmount` của báo giá.
 */
type ReplacedAccessory = {
  incidentId: string;
  accessoryItemId: string;
  accessoryId: string;
  /** Mẫu phụ kiện CŨ — cần để cộng phần giảm trừ khi đổi mẫu. */
  previousAccessoryId: string;
  /** Thành tiền CŨ của dòng phụ kiện (0 khi chỉ đổi chiếc cùng mẫu). */
  previousRentalTotal: number;
  name: string;
  /** Giá/ngày + thành tiền MỚI; với thay cùng mẫu giữ nguyên giá cũ. */
  unitPrice: number;
  lineTotal: number;
  isIncluded: boolean;
  /** Chiếc được chọn; `null` khi khách/manager không chỉ định → server tự chọn. */
  requestedAssetId: string | null;
  /** accessory asset cụ thể được chọn + giữ chỗ (điền trong transaction). */
  accessoryAssetId?: string;
};

/**
 * Một dòng trong "sản phẩm được thuê sau thay đổi" ở panel báo giá: trang phục
 * (thay thế hoặc giữ nguyên) + phụ kiện gộp theo mẫu với số lượng.
 */
export type RentedItemSummary = {
  id: string;
  kind: "garment" | "accessory";
  name: string;
  imageUrl: string | null;
  sizeLabel: string | null;
  quantity: number;
  lineTotal: number;
  isIncluded: boolean;
};

@Injectable()
export class BookingChangeRequestsService {
  private readonly logger = new Logger(BookingChangeRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly pricing?: PricingService,
    @Optional() private readonly vouchers?: VouchersService,
    @Optional() @Inject(forwardRef(() => PaymentsService)) private readonly payments?: PaymentsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ── §7.1 Khách xem sự cố + gợi ý ────────────────────────────────────────

  async listIncidents(user: AuthenticatedUser, bookingId: string) {
    const booking = await this.loadOwnedBooking(user, bookingId);
    const incidents = await this.prisma.bookingIncident.findMany({
      where: { bookingId, status: { in: ["open", "awaiting_customer", "needs_manager"] } },
      orderBy: [{ dueAt: "asc" }, { detectedAt: "asc" }],
    });
    const pendingRequest = await this.prisma.bookingChangeRequest.findFirst({
      where: { bookingId, status: { in: [...PENDING_STATUSES] } },
      select: { id: true, holdExpiresAt: true, selection: true },
    });

    // Số tiền sẽ hoàn nếu khách bỏ HẾT món (đơn bị huỷ). Cùng công thức với
    // `ensureCancellationRefunds`: Σ payment đã thu − Σ refund đang/đã xử lý.
    // Đơn chưa thanh toán → 0, FE không hiện khối hoàn tiền.
    const [paidPayments, coveringRefunds] = await Promise.all([
      this.prisma.payment.findMany({ where: { bookingId, status: "paid" }, select: { amount: true } }),
      this.prisma.refund.findMany({
        where: {
          bookingId,
          status: { in: ["pending", "refunding", "refunded", "partially_refunded"] },
        },
        select: { amount: true },
      }),
    ]);
    const paidTotal = paidPayments.reduce((sum, row) => sum + Number(row.amount), 0);
    const refundedTotal = coveringRefunds.reduce((sum, row) => sum + Number(row.amount), 0);
    const refundEstimate = Math.max(0, paidTotal - refundedTotal);

    return ok({
      booking: {
        id: booking.id,
        status: booking.status,
        rentalStartDate: booking.rentalStartDate,
        rentalEndDate: booking.rentalEndDate,
        /** Đơn đã thu được ≥1 khoản? Quyết định nút "Xác nhận đổi mẫu" vs "Giữ chỗ và thanh toán". */
        paid: paidTotal > 0,
        /** Tiền hoàn dự kiến khi bỏ hết món (huỷ đơn); 0 = đơn chưa thanh toán. */
        refundEstimate,
        /**
         * Liên hệ khách để manager báo lỗi. Không suy đoán: thiếu dữ liệu trả
         * `null` để FE hiện "Chưa có", tuyệt đối không tự bịa phone/email.
         */
        customer: {
          fullName: booking.customer?.profile?.fullName ?? null,
          phone: booking.customer?.profile?.phone ?? null,
          email: booking.customer?.email ?? null,
        },
      },
      incidents: incidents.map((incident) => ({
        id: incident.id,
        itemKind: incident.itemKind,
        // FE cần id dòng đơn để gắn checklist phụ kiện / chọn mẫu mới.
        bookingItemId: incident.bookingItemId,
        bookingAccessoryItemId: incident.bookingAccessoryItemId,
        reason: incident.reason,
        // Nhãn tiếng Việt để trang khách không hiện mã kỹ thuật (`asset_maintenance`…).
        reasonLabel: incident.reason
          ? incidentReasonLabel(incident.reason, incident.itemKind as IncidentItemKind)
          : null,
        status: incident.status,
        dueAt: incident.dueAt,
        snapshot: incident.snapshot,
      })),
      // Đủ dữ liệu để trang khách dựng checklist phụ kiện sau khi chọn mẫu mới:
      // món áo hiện tại (id/mẫu/ảnh) + toàn bộ phụ kiện đang có trong đơn.
      items: booking.items.map((item) => ({
        id: item.id,
        garmentId: item.garmentId,
        garmentAssetId: item.garmentAssetId,
        sizeId: item.garment_size_id,
        sizeLabel: item.garment_sizes?.size_label ?? null,
        name: item.garment_sizes?.garments?.name ?? "Trang phục",
        imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
      })),
      accessoryItems: booking.accessoryItems.map((row) => ({
        id: row.id,
        bookingItemId: row.bookingItemId,
        accessoryId: row.accessoryId,
        accessoryAssetId: row.accessoryAssetId,
        name: row.accessory?.name ?? "Phụ kiện",
        imageUrl: row.accessory?.image_url ?? null,
        quantity: Math.max(1, row.quantity ?? 1),
        unitPrice: Number(row.unitPrice),
        isIncluded: row.isIncluded,
        rentalTotal: Number(row.rentalTotal),
      })),
      suggestions: incidents.length > 0 ? await this.buildSuggestions(booking, incidents) : [],
      pendingRequest: pendingRequest
        ? {
            id: pendingRequest.id,
            countdownSeconds: this.countdown(pendingRequest.holdExpiresAt),
            // Bỏ món không giữ chỗ asset nào → không có đếm ngược giữ chỗ.
            requiresHold: this.selectionRequiresHold(pendingRequest.selection),
          }
        : null,
    });
  }

  /**
   * Tab "Sự cố" trong tài khoản khách: danh sách các ĐƠN đang có sự cố còn mở
   * (gộp theo đơn), kèm số đếm để gắn badge trên sidebar.
   *
   * Chỉ lấy đơn còn trước bàn giao — đơn đã huỷ/hoàn tất không còn gì để khách
   * xử lý, kể cả khi dữ liệu cũ còn sót sự cố `awaiting_customer`.
   */
  async listMyIncidents(user: AuthenticatedUser) {
    const incidents = await this.prisma.bookingIncident.findMany({
      where: {
        status: { in: [...OPEN_INCIDENT_STATUSES] },
        booking: { customerId: user.id, status: { in: PRE_HANDOVER_STATUSES } },
      },
      include: {
        booking: {
          select: { id: true, status: true, rentalStartDate: true, rentalEndDate: true },
        },
      },
      orderBy: [{ dueAt: "asc" }, { detectedAt: "asc" }],
    });

    const bookingIds = [...new Set(incidents.map((row) => row.bookingId))];
    const pendingRequests = bookingIds.length
      ? await this.prisma.bookingChangeRequest.findMany({
          where: { bookingId: { in: bookingIds }, status: { in: [...PENDING_STATUSES] } },
          select: { id: true, bookingId: true, holdExpiresAt: true, selection: true },
        })
      : [];
    const requestByBooking = new Map(pendingRequests.map((row) => [row.bookingId, row]));

    const grouped = new Map<
      string,
      {
        bookingId: string;
        bookingCode: string;
        bookingStatus: string;
        rentalStartDate: Date;
        rentalEndDate: Date;
        incidents: Array<{
          id: string;
          itemKind: string;
          reason: string;
          reasonLabel: string;
          status: string;
          dueAt: Date;
          name: string | null;
          sizeLabel: string | null;
          imageUrl: string | null;
        }>;
        pendingRequest: { id: string; countdownSeconds: number; requiresHold: boolean } | null;
      }
    >();

    for (const incident of incidents) {
      const snapshot = (incident.snapshot ?? {}) as Record<string, unknown>;
      let group = grouped.get(incident.bookingId);
      if (!group) {
        const pending = requestByBooking.get(incident.bookingId);
        group = {
          bookingId: incident.bookingId,
          bookingCode: incident.bookingId.slice(0, 8).toUpperCase(),
          bookingStatus: incident.booking.status,
          rentalStartDate: incident.booking.rentalStartDate,
          rentalEndDate: incident.booking.rentalEndDate,
          incidents: [],
          pendingRequest: pending
            ? {
                id: pending.id,
                countdownSeconds: this.countdown(pending.holdExpiresAt),
                requiresHold: this.selectionRequiresHold(pending.selection),
              }
            : null,
        };
        grouped.set(incident.bookingId, group);
      }
      group.incidents.push({
        id: incident.id,
        itemKind: incident.itemKind,
        reason: incident.reason,
        reasonLabel: incidentReasonLabel(incident.reason, incident.itemKind as IncidentItemKind),
        status: incident.status,
        dueAt: incident.dueAt,
        name: (snapshot.name as string | undefined) ?? null,
        sizeLabel: (snapshot.sizeLabel as string | undefined) ?? null,
        imageUrl: (snapshot.imageUrl as string | undefined) ?? null,
      });
    }

    const bookings = [...grouped.values()];
    return ok({
      /** Số ĐƠN đang có sự cố — đây là con số hiện cạnh tab "Sự cố". */
      count: bookings.length,
      incidentCount: incidents.length,
      bookings,
    });
  }

  // ── §7.2 Tạo báo giá + giữ chỗ 30 phút ─────────────────────────────────
  async createChangeRequest(
    user: AuthenticatedUser,
    bookingId: string,
    dto: CreateChangeRequestDto,
    options: {
      source?: "customer" | "manager";
      holdMinutes?: number;
      /** Chỉ TÍNH báo giá, không tạo yêu cầu / không giữ chỗ (báo giá live ở FE). */
      preview?: boolean;
    } = {},
  ) {
    const booking = await this.loadOwnedBooking(user, bookingId);
    if (!PRE_HANDOVER_STATUSES.includes(booking.status)) {
      throw new BadRequestException("Chỉ đổi mẫu/bỏ món trước khi bàn giao.");
    }
    if (dto.incidents.length === 0) throw new BadRequestException("Chưa chọn món bị sự cố.");

    const { startDay, endDay, days } = parseRentalDateRange(booking.rentalStartDate, booking.rentalEndDate);

    const incidents = await this.prisma.bookingIncident.findMany({
      where: {
        bookingId,
        id: { in: dto.incidents },
        status: { in: ["open", "awaiting_customer", "needs_manager"] },
      },
    });
    if (incidents.length !== dto.incidents.length) {
      throw new BadRequestException("Có sự cố không tồn tại hoặc đã được xử lý.");
    }

    const existing = await this.prisma.bookingChangeRequest.findFirst({
      where: { bookingId, status: { in: [...PENDING_STATUSES] } },
      select: { id: true },
    });
    if (existing) throw new ConflictException("Đơn đang có một yêu cầu đổi chờ xử lý.");

    const pendingExtension = await this.prisma.bookingExtension.findFirst({
      where: { bookingId, status: "pending" },
      select: { id: true },
    });
    if (pendingExtension) throw new ConflictException("Đơn đang có yêu cầu gia hạn chờ thanh toán.");

    // "Đã thanh toán" = có ≥1 Payment status paid (kể cả manual). Dùng thống nhất §7.3.
    const paidPayment = await this.prisma.payment.findFirst({
      where: { bookingId, status: "paid" },
      select: { id: true },
    });
    const isPaid = Boolean(paidPayment);

    // Phân bổ tiền dòng "trước" từ tổng đơn (§5.1 bước 6).
    const allocations = allocateGarmentLines({
      subtotal: Number(booking.subtotal),
      days,
      accessoryItems: booking.accessoryItems.map((row) => ({ id: row.id, rentalTotal: Number(row.rentalTotal) })),
      items: booking.items.map((row) => ({ itemId: row.id, dailyPrice: Number(row.dailyPrice) })),
    });
    const allocationByItem = new Map(allocations.map((row) => [row.itemId, row.lineRental]));

    const removeGarmentIds = new Set<string>();
    const removeAccessoryIds = new Set<string>(dto.removeAccessoryItemIds ?? []);
    const replacementByIncidentId = new Map<string, string>();
    for (const row of dto.replacements ?? []) replacementByIncidentId.set(row.incidentId, row.sizeId);
    // `null` = khách/manager không chỉ định chiếc cụ thể → server tự chọn.
    // `accessoryId` (khác mẫu cũ) = đổi sang mẫu phụ kiện khác của cùng trang phục.
    const accessorySelectionByIncidentId = new Map<
      string,
      { accessoryId?: string; accessoryAssetId: string | null }
    >();
    for (const row of dto.accessoryReplacements ?? []) {
      accessorySelectionByIncidentId.set(row.incidentId, {
        accessoryId: row.accessoryId,
        accessoryAssetId: row.accessoryAssetId ?? null,
      });
    }

    const replaced: ReplacedGarment[] = [];
    const replacedAccessories: ReplacedAccessory[] = [];
    /** Phụ kiện đổi mẫu — chốt giá SAU khi biết garment mới (nếu garment đổi cùng lúc). */
    const pendingAccessoryReplacements: Array<{
      incidentId: string;
      accessoryItemId: string;
      bookingItemId: string;
      previousAccessoryId: string;
      previousRentalTotal: number;
      quantity: number;
      name: string;
      requestedAccessoryId?: string;
      requestedAssetId: string | null;
    }> = [];
    for (const incident of incidents) {
      if (incident.itemKind === "garment" && incident.bookingItemId) {
        if (dto.type === "replace") {
          const sizeId = replacementByIncidentId.get(incident.id);
          if (!sizeId) throw new BadRequestException("Thiếu mẫu thay thế cho món bị sự cố.");
          replaced.push({
            incidentId: incident.id,
            itemId: incident.bookingItemId,
            sizeId,
            garmentId: "",
            newLine: 0,
            newDeposit: 0,
            basePrice: 0,
            discountPrice: 0,
            name: "",
            imageUrl: null,
            sizeLabel: null,
          });
        } else {
          removeGarmentIds.add(incident.bookingItemId);
        }
      }
      if (incident.itemKind === "accessory" && incident.bookingAccessoryItemId) {
        const row = booking.accessoryItems.find(
          (candidate) => candidate.id === incident.bookingAccessoryItemId,
        );
        const selection = accessorySelectionByIncidentId.get(incident.id);
        if (dto.type === "replace" && selection && row) {
          pendingAccessoryReplacements.push({
            incidentId: incident.id,
            accessoryItemId: row.id,
            bookingItemId: row.bookingItemId,
            previousAccessoryId: row.accessoryId,
            previousRentalTotal: Number(row.rentalTotal),
            quantity: Math.max(1, row.quantity ?? 1),
            name:
              (((incident.snapshot ?? {}) as Record<string, unknown>).name as string | undefined) ??
              "Phụ kiện",
            requestedAccessoryId:
              selection.accessoryId && selection.accessoryId !== row.accessoryId
                ? selection.accessoryId
                : undefined,
            requestedAssetId: selection.accessoryAssetId,
          });
        } else {
          removeAccessoryIds.add(incident.bookingAccessoryItemId);
        }
      }
    }
    if (
      dto.type !== "replace" &&
      (replacementByIncidentId.size > 0 || accessorySelectionByIncidentId.size > 0)
    ) {
      throw new BadRequestException("Chỉ yêu cầu đổi mẫu mới có mẫu thay thế.");
    }
    // Mỗi phụ kiện thay thế phải ứng với một sự cố PHỤ KIỆN đang chọn của đơn.
    for (const row of dto.accessoryReplacements ?? []) {
      const incident = incidents.find((candidate) => candidate.id === row.incidentId);
      if (!incident || incident.itemKind !== "accessory" || !incident.bookingAccessoryItemId) {
        throw new BadRequestException("Phụ kiện thay thế không khớp sự cố phụ kiện của đơn.");
      }
    }
    for (const row of pendingAccessoryReplacements) {
      if (removeAccessoryIds.has(row.accessoryItemId)) {
        throw new BadRequestException("Không thể vừa bỏ vừa thay cùng một phụ kiện.");
      }
    }

    // Giá mới chốt lúc báo giá (§6.1): newLine = quoteRental, newDeposit = deposit_amount.
    const targetSizeIds = [...new Set(replaced.map((row) => row.sizeId))];
    if (targetSizeIds.length > 0) {
      const targetSizes = await this.prisma.garment_sizes.findMany({
        where: { id: { in: targetSizeIds } },
        select: {
          id: true,
          garment_id: true,
          size_label: true,
          daily_price: true,
          deposit_amount: true,
          is_active: true,
          garments: {
            select: {
              name: true,
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { imageUrl: true } },
            },
          },
        },
      });
      const sizeMap = new Map(targetSizes.map((size) => [size.id, size]));
      const quotes = this.pricing
        ? await this.pricing.quoteRental(targetSizeIds, startDay, endDay)
        : null;
      for (const row of replaced) {
        const size = sizeMap.get(row.sizeId);
        if (!size || size.is_active === false) {
          throw new BadRequestException("Mẫu thay thế không còn được cho thuê.");
        }
        row.garmentId = size.garment_id;
        row.newLine = quotes?.get(row.sizeId)?.rentalTotal ?? Number(size.daily_price ?? 0) * days;
        row.newDeposit = Number(size.deposit_amount ?? 0);
        row.name = size.garments?.name ?? "";
        row.imageUrl = size.garments?.images?.[0]?.imageUrl ?? null;
        row.sizeLabel = size.size_label ?? null;
        const quote = quotes?.get(row.sizeId);
        row.basePrice = quote?.basePrice ?? Number(size.daily_price ?? 0);
        row.discountPrice = quote?.discountPrice ?? Number(size.daily_price ?? 0);
      }
    }

    // Đổi phụ kiện: chốt giá theo `garment_accessories` của trang phục chứa món.
    // Nếu chính trang phục đó cũng vừa đổi mẫu → dùng mẫu MỚI (khách chọn kèm).
    for (const row of pendingAccessoryReplacements) {
      let accessoryId = row.previousAccessoryId;
      let unitPrice = 0;
      let lineTotal = row.previousRentalTotal;
      let isIncluded = true;
      let name = row.name;
      if (row.requestedAccessoryId) {
        const item = booking.items.find((candidate) => candidate.id === row.bookingItemId);
        const replacedHost = replaced.find((candidate) => candidate.itemId === row.bookingItemId);
        const garmentId = replacedHost?.garmentId ?? item?.garmentId;
        if (!garmentId) throw new BadRequestException("Phụ kiện phải thuộc một sản phẩm trong đơn.");
        const link = await this.prisma.garment_accessories.findFirst({
          where: { garment_id: garmentId, accessory_id: row.requestedAccessoryId },
          select: { is_included: true, extra_price: true, accessories: { select: { name: true } } },
        });
        if (!link) {
          throw new BadRequestException("Phụ kiện thay thế không thuộc mẫu trang phục của đơn.");
        }
        accessoryId = row.requestedAccessoryId;
        isIncluded = link.is_included;
        unitPrice = link.is_included ? 0 : Number(link.extra_price ?? 0);
        lineTotal = unitPrice * days * row.quantity;
        name = link.accessories?.name ?? row.name;
      } else {
        // Thay chiếc CÙNG mẫu: giữ nguyên giá đã chốt trong đơn.
        const current = booking.accessoryItems.find((candidate) => candidate.id === row.accessoryItemId);
        unitPrice = Number(current?.unitPrice ?? 0);
        isIncluded = current?.isIncluded ?? unitPrice === 0;
      }
      replacedAccessories.push({
        incidentId: row.incidentId,
        accessoryItemId: row.accessoryItemId,
        accessoryId,
        previousAccessoryId: row.previousAccessoryId,
        previousRentalTotal: row.previousRentalTotal,
        name,
        unitPrice,
        lineTotal,
        isIncluded,
        requestedAssetId: row.requestedAssetId,
      });
    }

    // Phụ kiện thêm (§9): gắn vào BookingItem, giá = (is_included ? 0 : extra_price) × days.
    const addedAccessories: AddedAccessory[] = [];
    /** Tổng đơn vị theo mẫu phụ kiện SAU thay đổi: dòng giữ lại + dòng thêm. */
    const requestedUnitsByAccessory = new Map<string, number>();
    for (const row of booking.accessoryItems) {
      if (removeAccessoryIds.has(row.id)) continue;
      requestedUnitsByAccessory.set(
        row.accessoryId,
        (requestedUnitsByAccessory.get(row.accessoryId) ?? 0) + Math.max(1, row.quantity ?? 1),
      );
    }
    for (const accessory of dto.addAccessories ?? []) {
      const item = booking.items.find((row) => row.id === accessory.itemId);
      if (!item) throw new BadRequestException("Phụ kiện phải thuộc một sản phẩm trong đơn.");
      const replacedRow = replaced.find((row) => row.itemId === accessory.itemId);
      const garmentId = replacedRow ? replacedRow.garmentId : item.garmentId;
      const link = await this.prisma.garment_accessories.findFirst({
        where: { garment_id: garmentId, accessory_id: accessory.accessoryId },
        select: {
          is_included: true,
          extra_price: true,
          accessories: { select: { name: true, image_url: true } },
        },
      });
      if (!link) {
        throw new BadRequestException("Phụ kiện không thuộc mẫu trang phục của đơn.");
      }
      const unitPrice = link.is_included ? 0 : Number(link.extra_price ?? 0);
      addedAccessories.push({
        ...accessory,
        garmentId,
        unitPrice,
        lineTotal: unitPrice * days * (accessory.quantity ?? 1),
        name: link.accessories?.name ?? "Phụ kiện",
        imageUrl: link.accessories?.image_url ?? null,
      });
      requestedUnitsByAccessory.set(
        accessory.accessoryId,
        (requestedUnitsByAccessory.get(accessory.accessoryId) ?? 0) + (accessory.quantity ?? 1),
      );
    }
    // Trần thuê của mỗi mẫu theo `garment_accessories.quantity`: FE đã chặn, server
    // xác thực lại để không nhận yêu cầu vượt số mẫu cửa hàng sở hữu.
    for (const [accessoryId, units] of requestedUnitsByAccessory) {
      if (!(dto.addAccessories ?? []).some((row) => row.accessoryId === accessoryId)) continue;
      const garmentId = replaced.find((row) => row.itemId)?.garmentId ?? booking.items[0]?.garmentId;
      if (!garmentId) continue;
      const link = await this.prisma.garment_accessories.findFirst({
        where: { garment_id: garmentId, accessory_id: accessoryId },
        select: { quantity: true },
      });
      if (!link) continue;
      const maxUnits = Math.max(0, Number(link.quantity ?? 1));
      if (units > maxUnits) {
        throw new BadRequestException(
          `Số lượng phụ kiện vượt quá số mẫu cửa hàng cho thuê (tối đa ${maxUnits}).`,
        );
      }
    }
    const addedAccessoryAmount =
      addedAccessories.reduce((acc, row) => acc + row.lineTotal, 0) +
      // Đổi sang mẫu phụ kiện khác: phần THÊM của dòng mới.
      replacedAccessories.reduce((acc, row) => acc + row.lineTotal, 0);

    const changedGarments = [
      ...[...removeGarmentIds].map((itemId) => {
        const item = booking.items.find((row) => row.id === itemId)!;
        return {
          itemId,
          oldLine: allocationByItem.get(itemId) ?? 0,
          newLine: 0,
          oldDeposit: Number(item.depositAmount),
          newDeposit: 0,
        };
      }),
      ...replaced.map((row) => {
        const item = booking.items.find((candidate) => candidate.id === row.itemId)!;
        return {
          itemId: row.itemId,
          oldLine: allocationByItem.get(row.itemId) ?? 0,
          newLine: row.newLine,
          oldDeposit: Number(item.depositAmount),
          newDeposit: row.newDeposit,
        };
      }),
    ];
    const removedAccessoryAmount =
      booking.accessoryItems
        .filter((row) => removeAccessoryIds.has(row.id))
        .reduce((acc, row) => acc + Number(row.rentalTotal), 0) +
      // Đổi sang mẫu phụ kiện khác: phần GIẢM của dòng cũ.
      replacedAccessories.reduce((acc, row) => acc + row.previousRentalTotal, 0);

    const quote = quoteChange({
      days,
      oldSubtotal: Number(booking.subtotal),
      oldDiscount: Number(booking.discountTotal),
      oldRentalTotal: Number(booking.rentalTotal),
      oldDepositTotal: Number(booking.depositTotal),
      addedAccessoryAmount,
      removedAccessoryAmount,
      changedGarments,
    });

    const holdExpiresAt = new Date(Date.now() + (options.holdMinutes ?? INCIDENT_HOLD_MINUTES) * 60_000);
    // Chỉ đổi mẫu / thêm / thay phụ kiện mới cần giữ chỗ asset. Bỏ món (remove)
    // không cạnh tranh asset nào → báo giá xong là xác nhận được ngay.
    const requiresHold = replaced.length + addedAccessories.length + replacedAccessories.length > 0;

    // Báo giá LIVE: chỉ tính tiền, KHÔNG tạo `booking_change_requests`, KHÔNG chọn
    // hay giữ chỗ asset cụ thể (nên không thể 409 hết hàng khi khách đang chỉnh lựa
    // chọn). Trang khách gọi lại mỗi khi đổi mẫu/số lượng phụ kiện.
    const afterItems = this.buildAfterItems({
      booking,
      replaced,
      removeGarmentIds,
      addedAccessories,
      removeAccessoryIds,
      accessoryReplacements: replacedAccessories,
      allocationByItem,
    });
    if (options.preview) {
      return ok({
        requestId: "",
        preview: true,
        status: "quoted" as const,
        rentBefore: Number(booking.rentalTotal),
        rentAfter: quote.newRentalTotal,
        rentComponent: quote.rentComponent,
        accessoryDelta: quote.accessoryDelta,
        depositBefore: Number(booking.depositTotal),
        depositAfter: quote.newDepositTotal,
        depositDelta: quote.depositDelta,
        discountBefore: Number(booking.discountTotal),
        discountAfter: quote.newDiscount,
        chargeNow: quote.chargeAmount,
        // Đơn chưa thanh toán: không có gì để "ghi nhận hoàn khi trả đồ" ⇒ credit = 0.
        accruedCredit: isPaid ? quote.creditAmount : 0,
        lines: quote.lines,
        paymentRequired: quote.chargeAmount > 0,
        requiresHold,
        holdExpiresAt,
        countdownSeconds: this.countdown(holdExpiresAt),
        afterItems,
      });
    }

    const bufferDays = await this.laundryBufferDays();

    const created = await this.prisma.runSerializable(async (tx) => {
      await tx.$queryRawUnsafe("SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE", bookingId);

      const current = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
      if (!current) throw new NotFoundException("Booking not found.");
      if (!PRE_HANDOVER_STATUSES.includes(current.status)) {
        throw new ConflictException("Đơn vừa thay đổi trạng thái, vui lòng thử lại.");
      }
      const stillPending = await tx.bookingChangeRequest.findFirst({
        where: { bookingId, status: { in: [...PENDING_STATUSES] } },
        select: { id: true },
      });
      if (stillPending) throw new ConflictException("Đơn đang có một yêu cầu đổi chờ xử lý.");

      // Khóa advisory theo nhóm size/accessory trước khi check-then-hold để hai
      // yêu cầu (thậm chí hai đơn khác nhau) không cùng giữ một asset: FOR UPDATE
      // trên booking chỉ chặn theo đơn, không chặn theo asset.
      await this.lockCandidateGroups(tx, {
        garmentSizeIds: replaced.map((row) => row.sizeId),
        accessoryIds: [
          ...addedAccessories.map((row) => row.accessoryId),
          ...replacedAccessories.map((row) => row.accessoryId),
        ],
      });

      // Chọn asset CỤ THỂ cho mẫu mới (rankAssetCandidates + assert... đã tính hold §10).
      const usedAssets = new Set(
        booking.items.map((row) => row.garmentAssetId).filter((id): id is string => Boolean(id)),
      );
      for (const row of replaced) {
        const chosen = await this.chooseGarmentAsset(tx, {
          garmentId: row.garmentId,
          sizeId: row.sizeId,
          bookingId,
          startDay,
          endDay,
          bufferDays,
          usedAssets,
        });
        if (!chosen) throw new ConflictException("Mẫu thay thế đã hết hàng cho khoảng ngày thuê.");
        usedAssets.add(chosen);
        row.garmentAssetId = chosen;
      }

      // Chọn accessory asset CỤ THỂ cho phụ kiện THAY THẾ trước, rồi phụ kiện THÊM.
      // Dòng sắp bị bỏ không còn giữ chiếc của nó → loại khỏi usedAssets để có
      // thể tái dùng chiếc đó cho dòng thêm mới (tránh báo "hết hàng" sai).
      const usedAccessoryAssets = new Set(
        booking.accessoryItems
          .filter((row) => !removeAccessoryIds.has(row.id))
          .map((row) => row.accessoryAssetId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const row of replacedAccessories) {
        let chosen: string | null = null;
        if (row.requestedAssetId) {
          // Người dùng chỉ định đúng chiếc: phải CÙNG `accessory_id` và còn trống lịch.
          // Không kiểm tra `garment_accessories` — phụ kiện lấy từ kho chung (1.5).
          const asset = await tx.accessory_assets.findUnique({ where: { id: row.requestedAssetId } });
          if (!asset || asset.accessory_id !== row.accessoryId) {
            throw new BadRequestException("Phụ kiện thay thế phải cùng mẫu phụ kiện trong đơn.");
          }
          if (usedAccessoryAssets.has(asset.id)) {
            throw new ConflictException("Phụ kiện thay thế đã được chọn cho món khác trong đơn.");
          }
          try {
            await assertAccessoryAssetScheduleAvailable(tx, {
              assetId: asset.id,
              bookingId,
              accessoryId: row.accessoryId,
              startDay,
              endDay,
              laundryBufferDays: bufferDays,
            });
          } catch (error) {
            if (error instanceof ConflictException) {
              throw new ConflictException("Phụ kiện thay thế đã hết hàng cho khoảng ngày thuê.");
            }
            throw error;
          }
          chosen = asset.id;
        } else {
          chosen = await this.chooseAccessoryAsset(tx, {
            accessoryId: row.accessoryId,
            bookingId,
            startDay,
            endDay,
            bufferDays,
            usedAssets: usedAccessoryAssets,
          });
          if (!chosen) throw new ConflictException("Phụ kiện thay thế đã hết hàng cho khoảng ngày thuê.");
        }
        usedAccessoryAssets.add(chosen);
        row.accessoryAssetId = chosen;
      }
      for (const row of addedAccessories) {
        const chosen = await this.chooseAccessoryAsset(tx, {
          accessoryId: row.accessoryId,
          bookingId,
          startDay,
          endDay,
          bufferDays,
          usedAssets: usedAccessoryAssets,
          excludeItemIds: removeAccessoryIds,
        });
        if (!chosen) throw new ConflictException("Phụ kiện thêm đã hết hàng cho khoảng ngày thuê.");
        usedAccessoryAssets.add(chosen);
        row.accessoryAssetId = chosen;
      }

      const request = await tx.bookingChangeRequest.create({
        data: {
          bookingId,
          type: dto.type,
          source: options.source ?? "customer",
          status: "quoted",
          createdBy: user.id,
          selection: {
            keepAccessoryItemIds: dto.keepAccessoryItemIds ?? [],
            removeAccessoryItemIds: [...removeAccessoryIds],
            incidentIds: incidents.map((incident) => incident.id),
            replacedIncidentIds: replaced.map((row) => row.incidentId),
            replacements: replaced.map((row) => ({
              incidentId: row.incidentId,
              itemId: row.itemId,
              sizeId: row.sizeId,
              garmentId: row.garmentId,
              garmentAssetId: row.garmentAssetId ?? null,
              newLine: row.newLine,
              newDeposit: row.newDeposit,
              // Giá/ngày mới (gốc + sau rule) để áp dụng cập nhật cả `BookingItem`,
              // nếu không trang chi tiết/biên nhận vẫn hiện giá CŨ của dòng.
              basePrice: row.basePrice,
              discountPrice: row.discountPrice,
            })),
            addAccessories: addedAccessories.map((row) => ({
              itemId: row.itemId,
              accessoryId: row.accessoryId,
              accessoryAssetId: row.accessoryAssetId ?? null,
              unitPrice: row.unitPrice,
              lineTotal: row.lineTotal,
            })),
            // Thay phụ kiện: có thể đổi mẫu (accessoryId mới, giá theo garment_accessories)
            // hoặc chỉ đổi chiếc vật lý cùng mẫu.
            accessoryReplacements: replacedAccessories.map((row) => ({
              incidentId: row.incidentId,
              accessoryItemId: row.accessoryItemId,
              accessoryId: row.accessoryId,
              accessoryAssetId: row.accessoryAssetId ?? null,
              // true = đổi sang MẪU phụ kiện khác → áp dụng cả mẫu + giá mới.
              changedModel: row.accessoryId !== row.previousAccessoryId,
              unitPrice: row.unitPrice,
              lineTotal: row.lineTotal,
              isIncluded: row.isIncluded,
              previousRentalTotal: row.previousRentalTotal,
            })),
          } as Prisma.InputJsonValue,
          beforeSnapshot: {
            rentalTotal: Number(booking.rentalTotal),
            depositTotal: Number(booking.depositTotal),
            discountTotal: Number(booking.discountTotal),
            items: booking.items.map((row) => ({
              id: row.id,
              garmentId: row.garmentId,
              garmentAssetId: row.garmentAssetId,
              lineRental: allocationByItem.get(row.id) ?? 0,
              deposit: Number(row.depositAmount),
            })),
            accessoryItems: booking.accessoryItems.map((row) => ({
              id: row.id,
              accessoryId: row.accessoryId,
              accessoryAssetId: row.accessoryAssetId,
              rentalTotal: Number(row.rentalTotal),
            })),
          } as Prisma.InputJsonValue,
          afterSnapshot: {
            newSubtotal: quote.newSubtotal,
            newDiscount: quote.newDiscount,
            newRentalTotal: quote.newRentalTotal,
            newDepositTotal: quote.newDepositTotal,
            rentComponent: quote.rentComponent,
            accessoryDelta: quote.accessoryDelta,
            depositDelta: quote.depositDelta,
            chargeAmount: quote.chargeAmount,
            creditAmount: quote.creditAmount,
            adjustmentLines: quote.lines,
            wasPaid: isPaid,
            allRemoved:
              booking.items.length > 0 && booking.items.every((row) => removeGarmentIds.has(row.id)),
            replacedGarmentItemIds: replaced.map((row) => row.itemId),
            removedGarmentItemIds: [...removeGarmentIds],
            removedAccessoryItemIds: [...removeAccessoryIds],
            addedAccessoryItemIds: addedAccessories.map((row) => row.itemId),
          } as Prisma.InputJsonValue,
          rentBefore: booking.rentalTotal,
          rentAfter: quote.newRentalTotal,
          depositBefore: booking.depositTotal,
          depositAfter: quote.newDepositTotal,
          discountBefore: booking.discountTotal,
          discountAfter: quote.newDiscount,
          chargeAmount: quote.chargeAmount,
          holdExpiresAt,
        },
      });

      // Giữ chỗ asset cụ thể của MẪU MỚI + phụ kiện THÊM (asset vật lý mới cần chắc chắn
      // còn trống). Món bị BỎ không cần hold: asset cũ đang bị chính đơn này giữ, không
      // cạnh tranh với ai; ghi để Phase 4 xử lý ở bước áp dụng.
      const holds: Array<{ kind: "garment" | "accessory"; assetId: string }> = [];
      for (const row of replaced) {
        if (row.garmentAssetId) holds.push({ kind: "garment", assetId: row.garmentAssetId });
      }
      for (const row of addedAccessories) {
        if (row.accessoryAssetId) holds.push({ kind: "accessory", assetId: row.accessoryAssetId });
      }
      for (const row of replacedAccessories) {
        if (row.accessoryAssetId) holds.push({ kind: "accessory", assetId: row.accessoryAssetId });
      }
      const seenHold = new Set<string>();
      for (const hold of holds) {
        const key = `${hold.kind}:${hold.assetId}`;
        if (seenHold.has(key)) continue;
        seenHold.add(key);
        await tx.bookingChangeHold.create({
          data: {
            changeRequestId: request.id,
            bookingId,
            kind: hold.kind,
            garmentAssetId: hold.kind === "garment" ? hold.assetId : null,
            accessoryAssetId: hold.kind === "accessory" ? hold.assetId : null,
            startDay,
            endDay,
            expiresAt: holdExpiresAt,
          },
        });
      }

      return request;
    });

    const allRemoved =
      booking.items.length > 0 && booking.items.every((row) => removeGarmentIds.has(row.id));
    return ok(this.serializeQuote(created, quote, isPaid, requiresHold, afterItems, allRemoved));
  }

  // ── §7.3 Khách xác nhận → áp dụng (Phase 4a: replace/remove) ───────────────

  /**
   * Áp dụng yêu cầu đổi mẫu / bỏ món. Toàn bộ trong MỘT `runSerializable`:
   * lock booking → kiểm tra lại trạng thái + Payment paid → xác thực hold còn
   * hạn/asset còn trống → consume hold + gán asset cùng tx → cập nhật tổng đơn,
   * `depositAmount`, `voucher_usages` (clamp) → ghi `booking_adjustments` CHỈ khi
   * đơn đã thanh toán → incident `resolved` + history + AuditLog.
   *
   * Đơn đã thanh toán có phần chênh phải thu (`chargeAmount > 0`) thuộc bước
   * thanh toán bổ sung (Phase 5) → trả `409` để FE đi tiếp luồng thanh toán.
   */
  async confirmChangeRequest(user: AuthenticatedUser, bookingId: string, requestId: string) {
    // Chỉ KHÁCH của đơn được bấm xác nhận (nút trong email/trang khách). Quản lý
    // được xem đơn nhưng KHÔNG được thay khách xác nhận — tránh tự duyệt đề xuất.
    if (user.role !== AppRole.customer) {
      throw new ForbiddenException("Chỉ khách của đơn được xác nhận thay đổi.");
    }
    const booking = await this.loadOwnedBooking(user, bookingId);
    if (!PRE_HANDOVER_STATUSES.includes(booking.status)) {
      throw new BadRequestException("Chỉ áp dụng đổi mẫu/bỏ món trước khi bàn giao.");
    }

    const request = await this.prisma.bookingChangeRequest.findFirst({
      where: { id: requestId, bookingId },
    });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu đổi.");
    if (request.status !== "quoted") {
      throw new ConflictException("Yêu cầu này không còn ở bước xác nhận.");
    }

    // §7.3 bước 1 (NGOÀI tx): đơn chưa thanh toán mà còn QR PayOS `pending` (còn
    // sống) thì KHÔNG áp dụng — trả 409 để không áp dụng đè lên một giao dịch đang
    // chờ. Đúng luồng: hủy/đóng intent qua PayOS rồi mới xác thực lại Payment.
    const paidBefore = await this.prisma.payment.findFirst({
      where: { bookingId, status: "paid" },
      select: { id: true },
    });
    if (!paidBefore) {
      let released = false;
      if (this.payments) {
        try {
          await this.payments.releaseClosedPayosIntents(bookingId);
          released = true;
        } catch (error) {
          if (error instanceof ConflictException) throw error;
          // PayOS PROCESSING/PAID/UNDERPAID → helper ném BadRequest; §7.3 yêu cầu 409.
          if (error instanceof BadRequestException) {
            throw new ConflictException(
              (error as BadRequestException).message ||
                "Đơn đang có giao dịch PayOS chờ xử lý. Vui lòng thử lại sau.",
            );
          }
          // Không đọc được trạng thái từ PayOS → an toàn: không áp dụng.
          throw new ConflictException(
            "Không đọc được trạng thái giao dịch PayOS. Vui lòng thử lại sau.",
          );
        }
      }
      const liveQrIntent = await this.prisma.payment.findFirst({
        where: { bookingId, status: "pending", provider: "payos", providerTransactionId: { not: null } },
        select: { id: true },
      });
      if (liveQrIntent) {
        // Không có `payments` (test cũ) → vẫn chặn bằng 409; có `payments` mà intent
        // vẫn sống nghĩa là PayOS chưa đóng được → cũng chặn.
        throw new ConflictException(
          "Đơn đang có giao dịch thanh toán (QR) chờ xử lý. Vui lòng chờ giao dịch kết thúc rồi thử lại.",
        );
      }
      void released;
    }

    // §7.3 "Đơn đã thanh toán" + charge > 0: KHÔNG gọi PayOS trong transaction.
    // Tạo Payment intent + PayOS link trước, rồi request → awaiting_payment.
    const frozen = request.afterSnapshot as Record<string, unknown>;
    if (frozen.wasPaid === true && Number(frozen.chargeAmount ?? 0) > 0) {
      const chargeAmount = Number(frozen.chargeAmount);
      if (!this.payments?.createChangeRequestPaymentLink) {
        throw new BadRequestException("Tính năng thanh toán bổ sung chưa sẵn sàng.");
      }
      if (request.holdExpiresAt.getTime() <= Date.now()) {
        throw new ConflictException("Giữ chỗ đã hết hạn, vui lòng chọn lại.");
      }
      const link = await this.payments.createChangeRequestPaymentLink({
        bookingId,
        requestId: request.id,
        amount: chargeAmount,
        depositAmount: Math.max(0, Number(frozen.depositDelta ?? 0)),
        expiresAt: request.holdExpiresAt,
      });
      await this.prisma.bookingChangeRequest.update({
        where: { id: request.id },
        data: { status: "awaiting_payment", paymentId: link.paymentId, checkoutUrl: link.checkoutUrl },
      });
      return ok({
        requestId: request.id,
        status: "awaiting_payment",
        paymentRequired: true,
        chargeAmount,
        checkoutUrl: link.checkoutUrl,
        countdownSeconds: this.countdown(request.holdExpiresAt),
      });
    }

    const frozenBefore = (request.beforeSnapshot ?? {}) as Record<string, unknown>;
    // Email bỏ món cần số tiền hoàn TRƯỚC khi áp dụng (huỷ đơn tạo phiếu hoàn).
    const willCancelOnRemove =
      request.type === "remove" && (request.afterSnapshot as Record<string, unknown>)?.allRemoved === true;
    const refundEstimate = willCancelOnRemove ? await this.estimateRefund(bookingId) : 0;

    const applied = await this.prisma.runSerializable(async (tx) =>
      this.applyChangeRequestTx(tx, {
        bookingId,
        actorId: user.id,
        request: {
          id: request.id,
          type: request.type,
          selection: request.selection as Record<string, unknown>,
          beforeSnapshot: request.beforeSnapshot as Record<string, unknown>,
          afterSnapshot: request.afterSnapshot as Record<string, unknown>,
          holdExpiresAt: request.holdExpiresAt,
        },
      }),
    );

    // Khách xác nhận BỎ MÓN → gửi email ngay lúc này (không cần cửa hàng gửi
    // trước). Đổi mẫu vẫn không gửi email: khách vừa tự xác nhận trên trang.
    if (applied.type === "remove") {
      const selection = (request.selection ?? {}) as Record<string, unknown>;
      const incidentIds = Array.isArray(selection.incidentIds) ? (selection.incidentIds as string[]) : [];
      await this.sendRemovalEmail({
        actorId: user.id,
        bookingId,
        incidentIds,
        reason: request.note?.trim() || "Khách xác nhận bỏ món gặp sự cố.",
        dto: {},
        beforeRentalTotal: Number(frozenBefore.rentalTotal ?? request.rentBefore ?? 0),
        afterRentalTotal: Number(
          (request.afterSnapshot as Record<string, unknown>)?.newRentalTotal ?? applied.rentAfter ?? 0,
        ),
        beforeDepositTotal: Number(frozenBefore.depositTotal ?? request.depositBefore ?? 0),
        afterDepositTotal: Number(
          (request.afterSnapshot as Record<string, unknown>)?.newDepositTotal ?? applied.depositAfter ?? 0,
        ),
        creditAmount: Number((request.afterSnapshot as Record<string, unknown>)?.creditAmount ?? 0),
        refundAmount: refundEstimate,
        cancelled: applied.cancelled === true,
      }).catch((error) => {
        this.logger.warn(`Không gửi được email bỏ món ${bookingId}: ${this.errorMessage(error)}`);
      });
    }

    return ok(applied);
  }

  /** Thân áp dụng dùng chung (đổi mẫu / bỏ món). Chạy trong runSerializable. */
  private async applyChangeRequestTx(
    tx: Prisma.TransactionClient,
    input: {
      bookingId: string;
      actorId?: string;
      /** Payment đã thu phần chênh (luồng thanh toán bổ sung / webhook). */
      paidChargePaymentId?: string;
      request: {
        id: string;
        type: string;
        selection: Record<string, unknown>;
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        holdExpiresAt: Date;
      };
    },
  ) {
    const { bookingId, actorId, request } = input;
    await tx.$queryRawUnsafe("SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE", bookingId);

    const current = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!current) throw new NotFoundException("Booking not found.");
    if (!PRE_HANDOVER_STATUSES.includes(current.status)) {
      throw new ConflictException("Đơn vừa thay đổi trạng thái, vui lòng thử lại.");
    }

    const frozen = request.afterSnapshot;
    const wasPaid = frozen.wasPaid === true;
    const currentPaid = await tx.payment.findFirst({
      where: { bookingId, status: "paid" },
      select: { id: true },
    });
    if (!wasPaid && currentPaid) {
      throw new ConflictException("Đơn vừa được thanh toán, vui lòng báo giá lại.");
    }
    const chargeAmount = Number(frozen.chargeAmount ?? 0);
    if (currentPaid && chargeAmount > 0 && !input.paidChargePaymentId) {
      // Cần thu chênh nhưng chưa có payment cho phần chênh → luồng thanh toán bổ sung.
      throw new ConflictException("Đơn đã thanh toán cần thu phần chênh — hoàn tất ở bước thanh toán bổ sung.");
    }

    const selection = request.selection;
    const replacements = (selection.replacements ?? []) as Array<{
      incidentId: string;
      itemId: string;
      sizeId: string;
      garmentId: string;
      garmentAssetId: string | null;
      newLine: number;
      newDeposit: number;
      /** Giá/ngày gốc + sau rule của size mới (ghi vào BookingItem lúc áp dụng). */
      basePrice?: number;
      discountPrice?: number;
    }>;
    const addedAccessories = (selection.addAccessories ?? []) as Array<{
      itemId: string;
      accessoryId: string;
      accessoryAssetId: string | null;
      unitPrice: number;
      lineTotal: number;
    }>;
    const removedAccessoryItemIds = (selection.removeAccessoryItemIds ?? []) as string[];
    const accessoryReplacements = (selection.accessoryReplacements ?? []) as Array<{
      incidentId: string;
      accessoryItemId: string;
      accessoryId: string;
      accessoryAssetId: string | null;
      changedModel?: boolean;
      unitPrice?: number;
      lineTotal?: number;
      isIncluded?: boolean;
    }>;
    const removedGarmentItemIds = (frozen.removedGarmentItemIds ?? []) as string[];
    const incidentIds = (selection.incidentIds ?? []) as string[];
    const allRemoved = frozen.allRemoved === true;

    // Đơn đã sang bước giữ đồ vật lý (staff chuẩn bị / sẵn sàng giao): asset thay
    // thế phải được giữ chỗ NGAY trong tx áp dụng, nếu không nhân viên không bàn
    // giao được (handover yêu cầu mọi asset ở trạng thái `reserved`). Asset cũ bị
    // thay/bỏ cũng phải nhả về kho — đọc trước khi cập nhật dòng để còn quyền sở
    // hữu vật lý của đơn trên asset cũ.
    const holdsPhysicalAssets =
      current.status === BookingStatus.preparing || current.status === BookingStatus.ready_for_pickup;
    const previousItems = holdsPhysicalAssets
      ? await tx.bookingItem.findMany({ where: { bookingId }, select: { id: true, garmentAssetId: true } })
      : [];

    // Dòng phụ kiện bị bỏ không còn giữ chiếc vật lý. Xoá TRƯỚC khi xác thực
    // hold để chiếc đang gắn với dòng bị bỏ có thể được dùng cho dòng thêm mới
    // trong cùng yêu cầu (nếu không sẽ báo trùng asset trong một booking).
    if (removedAccessoryItemIds.length > 0) {
      await tx.bookingAccessoryItem.deleteMany({ where: { id: { in: removedAccessoryItemIds }, bookingId } });
    }

    // Xác thực hold còn hạn + asset vẫn trống (đã loại hold của chính request).
    const holds = await tx.bookingChangeHold.findMany({
      where: { changeRequestId: request.id, consumedAt: null },
      select: { id: true, kind: true, garmentAssetId: true, accessoryAssetId: true, expiresAt: true },
    });
    const now = new Date();
    for (const hold of holds) {
      // Thanh toán bổ sung đã thu tiền nhưng về muộn (quá holdExpiresAt): vẫn
      // phải kiểm tra lại asset trống bên dưới; chỉ bỏ qua hạn giữ chỗ ở đây.
      // Không đủ hàng → Conflict → needs_manager (không tự hoàn).
      if (!input.paidChargePaymentId && hold.expiresAt <= now) {
        throw new ConflictException("Giữ chỗ đã hết hạn, vui lòng chọn lại.");
      }
      if (hold.kind === "garment" && hold.garmentAssetId) {
        await assertAssetScheduleAvailable(tx, {
          assetId: hold.garmentAssetId,
          bookingId,
          startDay: current.rentalStartDate,
          endDay: current.rentalEndDate,
          excludeChangeRequestId: request.id,
        });
      }
      if (hold.kind === "accessory" && hold.accessoryAssetId) {
        await assertAccessoryAssetScheduleAvailable(tx, {
          assetId: hold.accessoryAssetId,
          bookingId,
          startDay: current.rentalStartDate,
          endDay: current.rentalEndDate,
          excludeChangeRequestId: request.id,
        });
      }
    }

    // Nhả giữ chỗ asset cũ TRƯỚC khi đổi/xoá dòng: lúc này assignment vẫn còn
    // nên `releaseBookingAsset` xác định được đơn đang sở hữu vật lý asset đó.
    if (holdsPhysicalAssets) {
      const replacedItemIds = new Set(replacements.map((row) => row.itemId));
      const removedItemIds = new Set(removedGarmentItemIds);
      for (const row of previousItems) {
        if (!row.garmentAssetId) continue;
        if (!replacedItemIds.has(row.id) && !removedItemIds.has(row.id)) continue;
        await releaseBookingAsset(tx, bookingId, row.garmentAssetId);
      }
    }

    // Áp dụng lên BookingItem: đổi mẫu (gán size + asset mới) và bỏ món.
    for (const row of replacements) {
      await tx.bookingItem.update({
        where: { id: row.itemId },
        data: {
          garmentId: row.garmentId,
          garment_size_id: row.sizeId,
          garmentAssetId: row.garmentAssetId,
          depositAmount: new Prisma.Decimal(row.newDeposit),
          // Cập nhật giá/ngày theo mẫu mới để trang chi tiết/biên nhận hiện ĐÚNG
          // giá sau đổi mẫu, không giữ giá cũ của dòng.
          ...(typeof row.discountPrice === "number" ? { dailyPrice: new Prisma.Decimal(row.discountPrice) } : {}),
          ...(typeof row.basePrice === "number" ? { basePrice: new Prisma.Decimal(row.basePrice) } : {}),
          ...(typeof row.discountPrice === "number"
            ? { discountPrice: new Prisma.Decimal(row.discountPrice) }
            : {}),
        },
      });
    }
    if (removedGarmentItemIds.length > 0) {
      await tx.bookingItem.deleteMany({ where: { id: { in: removedGarmentItemIds }, bookingId } });
    }

    // Bỏ phụ kiện (đã xoá ở trên, trước bước xác thực hold) + thêm phụ kiện (§9).
    for (const row of addedAccessories) {
      await tx.bookingAccessoryItem.create({
        data: {
          bookingId,
          bookingItemId: row.itemId,
          accessoryId: row.accessoryId,
          accessoryAssetId: row.accessoryAssetId,
          quantity: 1,
          unitPrice: new Prisma.Decimal(row.unitPrice),
          isIncluded: row.unitPrice === 0,
          rentalTotal: new Prisma.Decimal(row.lineTotal),
        },
      });
    }
    // Thay phụ kiện bị sự cố: đổi chiếc vật lý; nếu khách đổi sang MẪU khác thì
    // cập nhật luôn `accessory_id` + đơn giá + thành tiền đã chốt lúc báo giá.
    for (const row of accessoryReplacements) {
      if (!row.accessoryAssetId) continue;
      await tx.bookingAccessoryItem.update({
        where: { id: row.accessoryItemId },
        data: {
          accessoryAssetId: row.accessoryAssetId,
          ...(row.changedModel
            ? {
                accessoryId: row.accessoryId,
                ...(typeof row.unitPrice === "number" ? { unitPrice: new Prisma.Decimal(row.unitPrice) } : {}),
                ...(typeof row.lineTotal === "number" ? { rentalTotal: new Prisma.Decimal(row.lineTotal) } : {}),
                ...(typeof row.isIncluded === "boolean" ? { isIncluded: row.isIncluded } : {}),
              }
            : {}),
        },
      });
    }

    // Giữ chỗ asset thay thế ngay (đơn đã ở bước giữ đồ) để bàn giao thấy `reserved`.
    if (holdsPhysicalAssets) {
      const replacementAssetIds = replacements
        .map((row) => row.garmentAssetId)
        .filter((assetId): assetId is string => Boolean(assetId));
      await this.reserveReplacementAssets(tx, replacementAssetIds);
    }

    const newRentalTotal = Number(frozen.newRentalTotal ?? 0);
    const newSubtotal = Number(frozen.newSubtotal ?? 0);
    const newDiscount = Number(frozen.newDiscount ?? 0);
    const newDepositTotal = Number(frozen.newDepositTotal ?? 0);

    // §7.3 bước 3: đơn chưa thanh toán đang `awaiting_payment` + QR → dời
    // `paymentDueAt` thêm 30′ để cron hủy-đơn-quá-hạn không hủy ngay giữa lúc áp dụng.
    const awaitingPaymentWindow =
      current.status === "awaiting_payment" ? { paymentDueAt: new Date(Date.now() + INCIDENT_HOLD_MINUTES * 60_000) } : {};

    // Cập nhật tổng đơn + clamp voucher.
    const claimed = await tx.booking.updateMany({
      where: { id: bookingId, status: current.status },
      data: {
        subtotal: new Prisma.Decimal(newSubtotal),
        discountTotal: new Prisma.Decimal(newDiscount),
        rentalTotal: new Prisma.Decimal(newRentalTotal),
        depositTotal: new Prisma.Decimal(newDepositTotal),
        ...awaitingPaymentWindow,
      },
    });
    if (claimed.count !== 1) throw new ConflictException("Đơn vừa được xử lý bởi thao tác khác.");
    await tx.voucher_usages.updateMany({
      where: { booking_id: bookingId },
      data: { discount_amount: new Prisma.Decimal(newDiscount) },
    });

    // CHỈ ghi booking_adjustments khi đơn đã thanh toán (credit → accrued).
    // Bỏ hết món → đi luồng hủy đơn: KHÔNG ghi adjustment cho request này (mọi
    // credit `accrued`/`pending_payment` bị void trước khi hoàn — §8.3), nên bỏ qua.
    if (currentPaid && !allRemoved) {
      const lines = (frozen.adjustmentLines ?? []) as Array<{ component: string; direction: string; amount: number }>;
      const collectedPaymentId = input.paidChargePaymentId ?? null;
      for (const line of lines) {
        const isCharge = line.direction === "charge";
        await tx.bookingAdjustment.create({
          data: {
            bookingId,
            changeRequestId: request.id,
            component: line.component,
            direction: line.direction,
            amount: new Prisma.Decimal(line.amount),
            // Phần chênh đã thu qua PayOS bổ sung → `collected` + gắn paymentId;
            // credit luôn `accrued` để cộng vào phiếu hoàn cọc (§11).
            status: isCharge ? (collectedPaymentId ? "collected" : "pending_payment") : "accrued",
            paymentId: isCharge ? collectedPaymentId : null,
          },
        });
      }
    }

    // Consume hold (cùng tx với gán asset).
    await tx.bookingChangeHold.updateMany({
      where: { changeRequestId: request.id, consumedAt: null },
      data: { consumedAt: now },
    });

    // Incident → resolved; request → applied.
    await tx.bookingIncident.updateMany({
      where: { id: { in: incidentIds } },
      data: {
        status: "resolved",
        resolution: allRemoved ? "booking_cancelled" : request.type === "replace" ? "replaced" : "removed",
        resolvedAt: now,
        resolvedBy: actorId,
        changeRequestId: request.id,
      },
    });
    await tx.bookingChangeRequest.update({
      where: { id: request.id },
      data: { status: "applied", appliedAt: now },
    });

    // Bỏ hết món → hủy đơn (dùng chung cancelBookingTx: void credit → release →
    // refund → voucher → cancelled + history). Không ghi adjustment cho request này.
    if (allRemoved) {
      const cancelled = await cancelBookingTx(tx, {
        bookingId,
        fromStatus: current.status,
        actorId,
        reason: "Bỏ hết món trong yêu cầu đổi mẫu.",
        vouchers: this.vouchers,
      });
      if (!cancelled) throw new ConflictException("Đơn vừa được xử lý bởi thao tác khác.");
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: "booking.change_request.applied",
        entityType: "booking",
        entityId: bookingId,
        metadata: {
          requestId: request.id,
          type: request.type,
          allRemoved,
          charged: chargeAmount,
          credit: Number(frozen.creditAmount ?? 0),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      requestId: request.id,
      status: "applied",
      type: request.type,
      cancelled: allRemoved,
      rentAfter: newRentalTotal,
      depositAfter: newDepositTotal,
      discountAfter: newDiscount,
    };
  }

  /**
   * Giữ chỗ asset thay thế khi đơn đã ở bước giữ đồ vật lý (preparing /
   * ready_for_pickup). Bàn giao chỉ chấp nhận asset `reserved`; để `available`
   * thì nhân viên không thể xác nhận bàn giao.
   *
   * Lịch + hold đã được xác thực ngay trước đó (và chính hold của request được
   * loại khỏi bước kiểm tra) nên ở đây chỉ đổi trạng thái, không kiểm lịch lại.
   */
  private async reserveReplacementAssets(tx: Prisma.TransactionClient, assetIds: string[]): Promise<void> {
    for (const assetId of assetIds) {
      const asset = await tx.garmentAsset.findUnique({
        where: { id: assetId },
        select: { id: true, status: true },
      });
      if (!asset) throw new ConflictException("Asset thay thế không còn tồn tại.");
      // Đã `reserved` (kể cả bởi lịch nền của đơn khác không trùng ngày) thì giữ
      // nguyên; assignment mới của đơn này đã đủ để xác định quyền sở hữu vật lý.
      if (asset.status === AssetStatus.reserved) continue;
      if (asset.status !== AssetStatus.available) {
        throw new ConflictException("Asset thay thế không còn khả dụng để giữ chỗ.");
      }
      const claimed = await tx.garmentAsset.updateMany({
        where: { id: assetId, status: AssetStatus.available },
        data: { status: AssetStatus.reserved },
      });
      if (claimed.count !== 1) throw new ConflictException("Asset thay thế đã được đơn khác giữ.");
    }
  }

  // ── §7.3/§12 Khi tiền về + cron hết hạn ──────────────────────────────────

  /**
   * Tiền về cho phần chênh (webhook hoặc cron đối soát). Tìm request theo
   * `paymentId` **không lọc status** (payment có thể về sau khi request đã
   * `expired/cancelled`).
   *
   * - `awaiting_payment` + còn đủ hàng/giữ chỗ → áp dụng: charge → `collected`,
   *   credit → `accrued`. Chạy lại là no-op.
   * - `expired` / `cancelled` mà payment đã `paid` → request + incident
   *   `needs_manager`, KHÔNG tự hoàn tiền, báo manager xử lý thủ công.
   * - Hết hàng (kể cả áp dụng muộn) → `needs_manager`, không tự hoàn.
   */
  async handlePaymentPaid(paymentId: string) {
    const request = await this.prisma.bookingChangeRequest.findFirst({
      where: { paymentId },
    });
    if (!request) return ok({ applied: false, reason: "no_request" });

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { status: true },
    });
    if (payment?.status !== "paid") return ok({ applied: false, reason: "payment_not_paid" });

    if (request.status === "expired" || request.status === "cancelled") {
      const note =
        request.status === "expired"
          ? "Tiền về sau khi yêu cầu đã hết hạn giữ chỗ."
          : "Tiền về sau khi yêu cầu đã bị hủy.";
      const moved = await this.markNeedsManager(request.id, request.bookingId, note, [
        "expired",
        "cancelled",
      ]);
      return ok({
        requestId: request.id,
        status: moved ? "needs_manager" : request.status,
        applied: false,
      });
    }

    if (request.status !== "awaiting_payment") {
      // applied / needs_manager: đã xử lý xong — chạy lại là no-op.
      return ok({ applied: false, reason: "already_processed", status: request.status });
    }

    try {
      const applied = await this.prisma.runSerializable(async (tx) =>
        this.applyChangeRequestTx(tx, {
          bookingId: request.bookingId,
          actorId: request.createdBy ?? undefined,
          paidChargePaymentId: paymentId,
          request: {
            id: request.id,
            type: request.type,
            selection: request.selection as Record<string, unknown>,
            beforeSnapshot: request.beforeSnapshot as Record<string, unknown>,
            afterSnapshot: request.afterSnapshot as Record<string, unknown>,
            holdExpiresAt: request.holdExpiresAt,
          },
        }),
      );
      return ok(applied);
    } catch (error) {
      // Tranh chấp SERIALIZABLE hết lượt retry là lỗi TẠM THỜI: payment đã paid
      // nên cron/webhook sau sẽ thử lại; không đẩy sang needs_manager.
      if (error instanceof ConflictException && error.message === SERIALIZABLE_BUSY_MESSAGE) throw error;
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        await this.markNeedsManager(request.id, request.bookingId, error.message);
        return ok({ requestId: request.id, status: "needs_manager", applied: false });
      }
      throw error;
    }
  }

  /**
   * Cron mỗi 10 phút (§7.4): request `quoted/awaiting_payment` quá `holdExpiresAt`
   * → `expired`, incident → `needs_manager`, báo manager 1 lần.
   *
   * Với request đã tạo PayOS link: **đóng intent TRƯỚC** rồi mới hết hạn. Nếu
   * PayOS báo tiền có thể đang chuyển (PROCESSING/PAID/UNDERPAID) hoặc không đọc
   * được → bỏ qua vòng này. Payment đã `paid` (webhook lỡ mất) → áp dụng lại.
   */
  async expireChangeRequests(now = new Date()) {
    const due = await this.prisma.bookingChangeRequest.findMany({
      where: { status: { in: [...PENDING_STATUSES] }, holdExpiresAt: { lt: now } },
      select: { id: true, bookingId: true, paymentId: true },
    });

    const expired: string[] = [];
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const row of due) {
      if (row.paymentId) {
        // Đóng intent PayOS trước khi đánh dấu hết hạn (tránh khách trả tiền cho
        // một yêu cầu đã hết hạn). Lỗi = tiền có thể đang chuyển → để vòng sau.
        try {
          if (this.payments) await this.payments.releaseClosedPayosIntents(row.bookingId, { strict: true });
        } catch (error) {
          this.logger.warn(
            `Bỏ qua hết hạn yêu cầu ${row.id}: chưa đóng được PayOS (${this.errorMessage(error)}).`,
          );
          skipped.push(row.id);
          continue;
        }
        const payment = await this.prisma.payment.findUnique({
          where: { id: row.paymentId },
          select: { status: true },
        });
        if (payment?.status === "paid") {
          const result = await this.handlePaymentPaid(row.paymentId).catch(() => null);
          const status = (result?.data as { status?: string } | undefined)?.status;
          if (status === "applied") applied.push(row.id);
          continue;
        }
      }
      if (await this.expireOne(row.id, row.bookingId, now)) expired.push(row.id);
    }

    return ok({ expired, applied, skipped });
  }

  private async expireOne(requestId: string, bookingId: string, now: Date) {
    const didExpire = await this.prisma.runSerializable(async (tx) => {
      const claimed = await tx.bookingChangeRequest.updateMany({
        where: { id: requestId, status: { in: [...PENDING_STATUSES] }, holdExpiresAt: { lt: now } },
        data: { status: "expired" },
      });
      if (claimed.count !== 1) return false;
      await tx.bookingIncident.updateMany({
        where: { changeRequestId: requestId, status: { in: ["open", "awaiting_customer"] } },
        data: { status: "needs_manager", note: "Hết hạn giữ chỗ đổi mẫu/bỏ món." },
      });
      return true;
    });
    if (didExpire) await this.notifyNeedsManager(bookingId, "Hết hạn giữ chỗ đổi mẫu/bỏ món.");
    return didExpire;
  }

  /** Request + incident sang `needs_manager` (chỉ 1 lần) rồi báo manager. */
  private async markNeedsManager(
    requestId: string,
    bookingId: string,
    note: string,
    fromStatuses: string[] = ["awaiting_payment"],
  ) {
    const moved = await this.prisma.runSerializable(async (tx) => {
      const claimed = await tx.bookingChangeRequest.updateMany({
        where: { id: requestId, status: { in: fromStatuses } },
        data: { status: "needs_manager" },
      });
      if (claimed.count !== 1) return false;
      await tx.bookingIncident.updateMany({
        where: { changeRequestId: requestId, status: { in: ["open", "awaiting_customer"] } },
        data: { status: "needs_manager", note },
      });
      return true;
    });
    if (moved) await this.notifyNeedsManager(bookingId, note);
    return moved;
  }

  private async notifyNeedsManager(bookingId: string, note: string) {
    if (!this.notifications) return;
    try {
      await this.notifications.notifyStaffBooking({
        templateKey: "booking.staff.incident_open",
        bookingId,
        roles: [AppRole.manager_owner],
        linkUrl: "/dashboard/manager/incidents",
        note,
        extra: { reason: note },
      });
    } catch (error) {
      this.logger.warn(
        `Không gửi được thông báo cần quản lý cho đơn ${bookingId}: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  // ── §13.2 Manager/Staff xử lý sự cố ─────────────────────────────────────

  /**
   * Danh sách sự cố cho staff/manager, có phân trang.
   *
   * Thứ tự hàng đợi: sự cố còn mở luôn lên đầu (theo mức khẩn: `awaiting_customer`
   * → `needs_manager` → `open`), `resolved` xuống cuối; trong cùng trạng thái thì
   * `dueAt ASC` rồi `detectedAt ASC`.
   */
  async listStaffIncidents(
    filters: { status?: string; q?: string; page?: number; limit?: number } = {},
  ) {
    const statuses = filters.status
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const q = filters.q?.trim();
    const page = Math.max(1, Math.trunc(filters.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Math.trunc(filters.limit ?? 20) || 20));
    const where: Prisma.BookingIncidentWhereInput = {};
    if (statuses?.length) where.status = { in: statuses };
    if (q) {
      const or: Prisma.BookingIncidentWhereInput[] = [
        { booking: { customer: { email: { contains: q, mode: "insensitive" } } } },
        {
          booking: {
            customer: { profile: { is: { fullName: { contains: q, mode: "insensitive" } } } },
          },
        },
        {
          booking: {
            customer: { profile: { is: { phone: { contains: q, mode: "insensitive" } } } },
          },
        },
      ];
      // `bookingId` là cột UUID nên chỉ so khớp chính xác khi `q` là UUID đầy đủ;
      // tìm theo mã đơn rút gọn không dùng được `startsWith` trên kiểu uuid.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
        or.push({ bookingId: { equals: q.toLowerCase() } });
      }
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      this.prisma.bookingIncident.findMany({
        where,
        include: { booking: { include: { customer: { include: { profile: true } } } } },
        // Hàng đợi: sự cố còn mở lên đầu (`status ASC`; "resolved" xuống cuối vì
        // "r" > "o"). Trong nhóm đã xử lý, sự cố VỪA xử lý xong đứng đầu nhóm
        // (`resolvedAt DESC`) thay vì bị đẩy xuống cuối trang theo `dueAt`.
        // Sự cố còn mở vẫn ưu tiên theo hạn thuê: `dueAt ASC`, rồi `detectedAt ASC`.
        orderBy: [
          { status: "asc" },
          // Postgres mặc định NULL đứng đầu khi DESC → phải đẩy NULL xuống cuối,
          // nếu không sự cố còn mở (resolvedAt = null) lại bị đảo xuống dưới.
          { resolvedAt: { sort: "desc", nulls: "last" } },
          { dueAt: "asc" },
          { detectedAt: "asc" },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bookingIncident.count({ where }),
    ]);
    const today = vietnamToday();

    const items = rows.map((row) => {
      const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
      const booking = row.booking as typeof row.booking & {
        customer?: { email?: string | null; profile?: { fullName?: string | null; phone?: string | null } | null };
      };
      const daysUntilStart = Math.ceil(
        (new Date(booking.rentalStartDate).getTime() - today.getTime()) / DAY_MS,
      );
      const daysRemaining = Math.max(0, daysUntilStart);
      const daysOverdue = Math.max(0, -daysUntilStart);
      return {
        id: row.id,
        bookingId: row.bookingId,
        bookingCode: row.bookingId.slice(0, 8).toUpperCase(),
        status: row.status,
        reason: row.reason,
        dueAt: row.dueAt,
        detectedAt: row.detectedAt,
        rentalStartDate: booking.rentalStartDate,
        rentalEndDate: booking.rentalEndDate,
        daysRemaining,
        daysOverdue,
        bookingStatus: booking.status,
        customer: {
          fullName: booking.customer?.profile?.fullName ?? null,
          phone: booking.customer?.profile?.phone ?? null,
          email: booking.customer?.email ?? null,
        },
        item: {
          kind: row.itemKind,
          bookingItemId: row.bookingItemId,
          bookingAccessoryItemId: row.bookingAccessoryItemId,
          assetCode: row.assetCode,
          name: (snapshot.name as string | undefined) ?? null,
          sizeLabel: (snapshot.sizeLabel as string | undefined) ?? null,
          imageUrl: (snapshot.imageUrl as string | undefined) ?? null,
        },
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

  /** Chi tiết sự cố + snapshot + các yêu cầu đổi liên quan. */
  async getStaffIncident(incidentId: string) {
    const incident = await this.prisma.bookingIncident.findUnique({
      where: { id: incidentId },
      include: {
        item: {
          include: {
            garment_sizes: { include: { garments: true } },
            garment: true,
            garmentAsset: true,
          },
        },
        accessoryItem: { include: { accessoryAsset: true } },
        booking: {
          include: {
            customer: { include: { profile: true } },
            items: { include: { garment_sizes: { include: { garments: true } } } },
            accessoryItems: true,
            changeRequests: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    });
    if (!incident) throw new NotFoundException("Không tìm thấy sự cố.");

    // §13.3: gợi ý mẫu thay thế dùng CHUNG `buildSuggestions` với trang khách
    // (`GET /bookings/:id/incidents`) — cùng nguồn, cùng khoảng ngày thuê.
    const suggestions = await this.buildSuggestions(incident.booking as unknown as BookingRow, [
      {
        id: incident.id,
        itemKind: incident.itemKind,
        bookingItemId: incident.bookingItemId,
        bookingAccessoryItemId: incident.bookingAccessoryItemId,
        snapshot: incident.snapshot,
      },
    ]);

    // Tác động tiền của sự cố (theo trạng thái đơn + yêu cầu đã áp dụng):
    // - Đơn bị huỷ (bỏ hết món) → số tiền hoàn (0 nếu chưa thu được gì).
    // - Yêu cầu đã áp dụng làm TĂNG tiền → tổng thu thêm.
    // - Yêu cầu đã áp dụng làm GIẢM tiền → tổng hoàn trả.
    const appliedRequests = (incident.booking.changeRequests ?? []).filter(
      (request) => request.status === "applied" || Boolean(request.appliedAt),
    );
    const bookingCancelled = CANCELLED_BOOKING_STATUSES.includes(incident.booking.status as never);
    let extraChargeAmount = 0;
    let appliedCreditAmount = 0;
    for (const request of appliedRequests) {
      extraChargeAmount += Math.max(0, Number(request.chargeAmount ?? 0));
      const after = (request.afterSnapshot ?? {}) as Record<string, unknown>;
      appliedCreditAmount += Math.max(0, Number(after.creditAmount ?? 0));
    }
    const refundAmount = bookingCancelled
      ? await this.cancelledBookingRefundAmount(incident.bookingId)
      : appliedCreditAmount;

    return ok({
      id: incident.id,
      bookingId: incident.bookingId,
      bookingCode: incident.bookingId.slice(0, 8).toUpperCase(),
      itemKind: incident.itemKind,
      reason: incident.reason,
      // Nhãn tiếng Việt: trang quản lý hiển thị "lỗi gì" và "đã xử lý ra sao".
      reasonLabel: incidentReasonLabel(incident.reason, incident.itemKind as IncidentItemKind),
      status: incident.status,
      dueAt: incident.dueAt,
      detectedAt: incident.detectedAt,
      assetCode: incident.assetCode,
      snapshot: incident.snapshot,
      resolution: incident.resolution,
      resolutionLabel: incidentResolutionLabel(incident.resolution),
      resolvedAt: incident.resolvedAt,
      note: incident.note,
      item: incident.item,
      accessoryItem: incident.accessoryItem,
      booking: {
        id: incident.booking.id,
        status: incident.booking.status,
        rentalStartDate: incident.booking.rentalStartDate,
        rentalEndDate: incident.booking.rentalEndDate,
        rentalTotal: incident.booking.rentalTotal,
        depositTotal: incident.booking.depositTotal,
        customerId: incident.booking.customerId,
        customer: incident.booking.customer,
        items: incident.booking.items,
        accessoryItems: incident.booking.accessoryItems,
      },
      relatedRequests: incident.booking.changeRequests,
      suggestions,
      /**
       * Tác động tiền của sự cố (đơn vị VND):
       * - Đơn bị huỷ → `refundAmount` = tiền hoàn cọc/tiền đã thu (0 nếu chưa thu).
       * - Đơn bị thu thêm → `extraChargeAmount` = tổng phần chênh đã/đang thu.
       * - Đơn được giảm → `refundAmount` = tổng hoàn trả dự kiến.
       */
      settlement: {
        bookingCancelled,
        /** Tổng phần chênh phải thu thêm của các yêu cầu đã áp dụng. */
        extraChargeAmount,
        /** Số tiền sẽ hoàn (đơn huỷ: tiền cọc/đã thu; đơn giảm: tiền hoàn dự kiến). */
        refundAmount,
        /** Số dư cọc hiện tại của đơn (đơn huỷ → hoàn cọc). */
        depositAmount: Number(incident.booking.depositTotal ?? 0),
      },
    });
  }

  /**
   * Manager/Admin xử lý sự cố: cancel | remove | proposal | preview.
   * - cancel: `cancelBookingTx` (void credit → release → refund → voucher → cancelled)
   *   rồi gửi email thông báo huỷ đơn + tiền hoàn.
   * - remove: áp dụng ngay qua pricing engine (đơn paid → credit `accrued`) rồi
   *   gửi email "đơn trước/sau"; bỏ hết món thì đơn bị huỷ và email nói rõ.
   * - proposal: tạo yêu cầu `source=manager`, giữ chỗ 30 phút, gửi email đề xuất.
   * - preview: chỉ dựng bản xem trước email (không tạo yêu cầu/không giữ chỗ).
   */
  async applyStaffIncidentAction(
    actor: Pick<AuthenticatedUser, "id" | "role">,
    incidentId: string,
    dto: ManagerIncidentActionDto,
  ) {
    if (actor.role !== AppRole.manager_owner && actor.role !== AppRole.admin) {
      throw new ForbiddenException("Chỉ quản lý được xử lý sự cố.");
    }
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException("Cần lý do xử lý sự cố.");

    const incident = await this.prisma.bookingIncident.findUnique({
      where: { id: incidentId },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            customerId: true,
            rentalStartDate: true,
            rentalEndDate: true,
          },
        },
      },
    });
    if (!incident) throw new NotFoundException("Không tìm thấy sự cố.");
    if (!OPEN_INCIDENT_STATUSES.includes(incident.status as never)) {
      throw new ConflictException("Sự cố này đã được xử lý.");
    }

    // Trang `/booking/incidents/[bookingId]` gộp theo ĐƠN: manager gửi danh sách
    // toàn bộ sự cố đang mở. Không gửi → giữ hành vi cũ (chỉ sự cố trong URL).
    // Mọi sự cố phải thuộc ĐÚNG đơn của sự cố gốc và còn mở.
    let incidentIds = dto.incidents?.length ? [...new Set(dto.incidents)] : [incident.id];
    if (!incidentIds.includes(incident.id)) incidentIds = [incident.id, ...incidentIds];
    if (incidentIds.length > 1) {
      const rows = await this.prisma.bookingIncident.findMany({
        where: { id: { in: incidentIds }, bookingId: incident.bookingId },
        select: { id: true, status: true },
      });
      if (
        rows.length !== incidentIds.length ||
        rows.some((row) => !OPEN_INCIDENT_STATUSES.includes(row.status as never))
      ) {
        throw new BadRequestException("Danh sách sự cố không hợp lệ hoặc đã được xử lý.");
      }
    }

    if (dto.action === "preview") {
      return this.previewIncidentEmail(actor, incident, incidentIds, dto, reason);
    }
    if (dto.action === "cancel") {
      return this.cancelIncidentBooking(actor, incident, incidentIds, reason, dto);
    }
    if (dto.action === "remove") {
      return this.removeIncidentItem(actor, incident, incidentIds, reason, dto);
    }
    return this.proposeIncidentResolution(actor, incident, incidentIds, dto, reason);
  }

  /**
   * Dựng bản xem trước email (HTML) mà quản lý sắp gửi; KHÔNG giữ chỗ, KHÔNG tạo
   * yêu cầu, KHÔNG gửi mail. Báo giá lấy từ cùng engine với lúc gửi để nội dung
   * khớp. Hỗ trợ 3 loại: đề xuất đổi mẫu, bỏ món, huỷ đơn.
   */
  private async previewIncidentEmail(
    actor: Pick<AuthenticatedUser, "id" | "role">,
    incident: {
      id: string;
      bookingId: string;
      itemKind: string;
      snapshot: unknown;
      booking: { customerId: string; rentalStartDate: Date; rentalEndDate: Date };
    },
    incidentIds: string[],
    dto: ManagerIncidentActionDto,
    reason: string,
  ) {
    const bookingId = incident.bookingId;
    const previewAction = dto.previewAction ?? "proposal";

    // Huỷ đơn: không cần báo giá (đơn bị huỷ toàn bộ) → dựng thẳng email huỷ.
    if (previewAction === "cancel") {
      const built = await this.buildCancellationEmailData(bookingId, incidentIds, reason, dto);
      return ok({
        action: "preview" as const,
        previewAction,
        incidentId: incident.id,
        incidentIds,
        bookingId,
        portal: "preview",
        emailSubject: built.emailSubject,
        emailHtml: built.emailHtml,
        emailRecipient: built.context.customerEmail,
        quote: null,
      });
    }

    // Bỏ món: tính báo giá "trước/sau" bằng engine (không lưu yêu cầu/không giữ chỗ).
    if (previewAction === "remove") {
      const created = await this.createChangeRequest(
        actor as AuthenticatedUser,
        bookingId,
        { type: "remove", incidents: incidentIds, note: reason },
        { source: "manager", holdMinutes: INCIDENT_MANAGER_HOLD_MINUTES, preview: true },
      );
      const quote = created.data as Record<string, unknown>;
      const built = await this.buildRemovalEmailData({
        bookingId,
        incidentIds,
        reason,
        dto,
        beforeRentalTotal: Number(quote.rentBefore ?? 0),
        afterRentalTotal: Number(quote.rentAfter ?? 0),
        beforeDepositTotal: Number(quote.depositBefore ?? 0),
        afterDepositTotal: Number(quote.depositAfter ?? 0),
        creditAmount: Number(quote.accruedCredit ?? 0),
        cancelled: quote.cancelled === true,
      });
      return ok({
        action: "preview" as const,
        previewAction,
        incidentId: incident.id,
        incidentIds,
        bookingId,
        portal: "preview",
        emailSubject: built.emailSubject,
        emailHtml: built.emailHtml,
        emailRecipient: built.context.customerEmail,
        cancelled: built.cancelled,
        quote,
      });
    }

    if (dto.action === "preview" && dto.type !== "remove" && !dto.replacements?.length && !dto.accessoryReplacements?.length) {
      // Không có lựa chọn thay thế → không thể là đề xuất đổi mẫu.
      throw new BadRequestException("Vui lòng chọn mẫu thay thế trước khi xem trước email đề xuất.");
    }

    const created = await this.createChangeRequest(
      actor as AuthenticatedUser,
      bookingId,
      {
        type: dto.type ?? "replace",
        incidents: incidentIds,
        replacements: dto.replacements,
        accessoryReplacements: dto.accessoryReplacements,
        removeAccessoryItemIds: dto.removeAccessoryItemIds,
        addAccessories: dto.addAccessories,
        note: reason,
      },
      { source: "manager", holdMinutes: INCIDENT_MANAGER_HOLD_MINUTES, preview: true },
    );
    const quote = created.data as Record<string, unknown>;

    const context = await this.loadEmailContext(bookingId);
    const emailIncidents = await this.loadEmailIncidents(bookingId, incidentIds);
    const affectedItems = this.affectedItemsForEmail(context, emailIncidents);
    const proposedItems = await this.proposedItemsForEmail(context, dto);
    const bufferMinutes = INCIDENT_MANAGER_HOLD_MINUTES;
    // Bản xem trước dùng mốc giữ chỗ giả định để khách thấy đúng hạn.
    const holdExpiresAt = new Date(Date.now() + bufferMinutes * 60_000);
    const chargeNow = Number(quote.chargeNow ?? 0);

    const emailSubject = dto.emailSubject?.trim() || proposalEmailSubject(context.bookingCode);
    const emailHtml = buildProposalEmail({
      bookingId,
      bookingCode: context.bookingCode,
      customerName: context.customerName,
      rentalStartDate: context.booking.rentalStartDate,
      rentalEndDate: context.booking.rentalEndDate,
      affectedItems,
      proposedItems,
      rentBefore: Number(quote.rentBefore ?? context.booking.rentalTotal),
      rentAfter: Number(quote.rentAfter ?? context.booking.rentalTotal),
      depositBefore: Number(quote.depositBefore ?? context.booking.depositTotal),
      depositAfter: Number(quote.depositAfter ?? context.booking.depositTotal),
      chargeNow,
      creditAmount: Number(quote.accruedCredit ?? 0),
      reason,
      holdExpiresAt,
      actionUrl: incidentActionUrl(bookingId),
      emailSubject,
      emailMessage: dto.emailMessage,
    });

    return ok({
      action: "preview" as const,
      previewAction,
      incidentId: incident.id,
      incidentIds,
      bookingId,
      portal: "preview",
      emailSubject,
      emailHtml,
      emailRecipient: context.customerEmail,
      quote,
    });
  }

  /**
   * Dữ liệu email BỎ MÓN (dùng chung cho gửi thật + xem trước). `cancelled` =
   * bỏ hết trang phục → email chuyển sang bố cục huỷ đơn.
   */
  private async buildRemovalEmailData(input: {
    bookingId: string;
    incidentIds: string[];
    reason: string;
    dto: Pick<ManagerIncidentActionDto, "emailSubject" | "emailMessage">;
    beforeRentalTotal: number;
    afterRentalTotal: number;
    beforeDepositTotal: number;
    afterDepositTotal: number;
    creditAmount: number;
    refundAmount?: number;
    /** Bỏ hết trang phục → đơn bị huỷ → email dùng bố cục huỷ đơn. */
    cancelled: boolean;
  }) {
    const context = await this.loadEmailContext(input.bookingId);
    const emailIncidents = await this.loadEmailIncidents(input.bookingId, input.incidentIds);
    const removedItems = this.affectedItemsForEmail(context, emailIncidents);
    const cancelled = input.cancelled;

    const emailSubject =
      input.dto.emailSubject?.trim() ||
      (cancelled
        ? cancellationEmailSubject(context.bookingCode)
        : removalEmailSubject(context.bookingCode));
    const emailHtml = buildRemovalEmail({
      bookingId: input.bookingId,
      bookingCode: context.bookingCode,
      customerName: context.customerName,
      rentalStartDate: context.booking.rentalStartDate,
      rentalEndDate: context.booking.rentalEndDate,
      removedItems,
      beforeRentalTotal: input.beforeRentalTotal,
      afterRentalTotal: input.afterRentalTotal,
      beforeDepositTotal: input.beforeDepositTotal,
      afterDepositTotal: input.afterDepositTotal,
      cancelled,
      reason: input.reason,
      refundAmount: cancelled ? (input.refundAmount ?? context.refundEstimate) : 0,
      creditAmount: cancelled ? 0 : input.creditAmount,
      actionUrl: incidentActionUrl(input.bookingId),
      emailSubject,
      emailMessage: input.dto.emailMessage,
    });

    return { context, cancelled, emailSubject, emailHtml };
  }

  /** Dữ liệu email HUỶ ĐƠN (dùng chung cho gửi thật + xem trước). */
  private async buildCancellationEmailData(
    bookingId: string,
    incidentIds: string[],
    reason: string,
    dto: Pick<ManagerIncidentActionDto, "emailSubject" | "emailMessage">,
    refundAmount?: number,
  ) {
    const context = await this.loadEmailContext(bookingId);
    const emailIncidents = await this.loadEmailIncidents(bookingId, incidentIds);
    // Có món gặp sự cố → mục 2 là "Trang phục gặp sự cố"; không có → liệt kê món
    // trong đơn để khách vẫn thấy đơn gồm những gì.
    const affected = this.affectedItemsForEmail(context, emailIncidents);
    const items = affected.length > 0 ? affected : this.bookingItemsForEmail(context);
    const emailSubject = dto.emailSubject?.trim() || cancellationEmailSubject(context.bookingCode);
    const emailHtml = buildCancellationEmail({
      bookingId,
      bookingCode: context.bookingCode,
      customerName: context.customerName,
      rentalStartDate: context.booking.rentalStartDate,
      rentalEndDate: context.booking.rentalEndDate,
      items,
      reason,
      refundAmount: refundAmount ?? context.refundEstimate,
      beforeRentalTotal: Number(context.booking.rentalTotal),
      afterRentalTotal: 0,
      beforeDepositTotal: Number(context.booking.depositTotal),
      afterDepositTotal: 0,
      actionUrl: incidentActionUrl(bookingId),
      emailSubject,
      emailMessage: dto.emailMessage,
    });

    return { context, emailSubject, emailHtml };
  }

  /** Mọi món trong đơn (trang phục + phụ kiện) kèm số lượng + giá — cho email huỷ. */
  private bookingItemsForEmail(
    context: Awaited<ReturnType<BookingChangeRequestsService["loadEmailContext"]>>,
  ): IncidentEmailItem[] {
    const days = Math.max(
      1,
      Math.round(
        (new Date(context.booking.rentalEndDate).getTime() -
          new Date(context.booking.rentalStartDate).getTime()) /
          DAY_MS,
      ) + 1,
    );
    const garments: IncidentEmailItem[] = context.booking.items.map((item) => ({
      name: item.garment_sizes?.garments?.name ?? "Trang phục",
      sizeLabel: item.garment_sizes?.size_label ?? null,
      imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
      quantity: 1,
      price: Number(item.dailyPrice ?? 0) * days,
    }));
    const accessories: IncidentEmailItem[] = context.booking.accessoryItems.map((row) => ({
      name: row.accessory?.name ?? "Phụ kiện",
      imageUrl: row.accessory?.image_url ?? null,
      quantity: Math.max(1, row.quantity ?? 1),
      price: Number(row.rentalTotal ?? 0),
    }));
    return [...garments, ...accessories];
  }

  /** Sự cố theo danh sách (đã xác thực cùng đơn) để dựng email nhiều món. */
  private async loadEmailIncidents(bookingId: string, incidentIds: string[]) {
    return this.prisma.bookingIncident.findMany({
      where: { bookingId, id: { in: incidentIds } },
    });
  }

  /** Dữ liệu dùng chung để dựng email: đơn + khách + ảnh sản phẩm + tiền đã thu. */
  private async loadEmailContext(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { include: { profile: true } },
        items: {
          include: {
            garment_sizes: {
              include: {
                garments: {
                  include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } },
                },
              },
            },
          },
        },
        accessoryItems: { include: { accessory: true } },
        payments: { where: { status: "paid" }, select: { amount: true } },
        refunds: {
          where: { status: { in: ["pending", "refunding", "refunded", "partially_refunded"] } },
          select: { amount: true },
        },
      },
    });
    if (!booking) throw new NotFoundException("Booking not found.");

    const paidTotal = booking.payments.reduce((sum, row) => sum + Number(row.amount), 0);
    const refundedTotal = booking.refunds.reduce((sum, row) => sum + Number(row.amount), 0);

    return {
      booking,
      bookingCode: booking.id.slice(0, 8).toUpperCase(),
      customerName: booking.customer?.profile?.fullName ?? null,
      customerEmail: booking.customer?.email ?? null,
      refundEstimate: Math.max(0, paidTotal - refundedTotal),
    };
  }

  /**
   * Món bị ảnh hưởng (lấy từ snapshot sự cố, có ảnh + giá dòng + loại sự cố).
   * Giá dòng ưu tiên snapshot; snapshot cũ thiếu giá (0) thì lấy lại từ dòng
   * đơn hiện tại để email KHÔNG bao giờ thiếu giá cho một món.
   */
  private affectedItemsForEmail(
    context: Awaited<ReturnType<BookingChangeRequestsService["loadEmailContext"]>>,
    incidents: Array<{
      id: string;
      itemKind: string;
      reason?: string | null;
      snapshot: unknown;
      bookingItemId?: string | null;
      bookingAccessoryItemId?: string | null;
    }>,
  ): IncidentEmailItem[] {
    const accessoryById = new Map(context.booking.accessoryItems.map((row) => [row.id, row]));
    const itemById = new Map(context.booking.items.map((row) => [row.id, row]));
    return incidents.map((incident) => {
      const snapshot = (incident.snapshot ?? {}) as Record<string, unknown>;
      const name =
        (snapshot.name as string | undefined) ??
        (incident.itemKind === "garment" ? "Trang phục" : "Phụ kiện");
      const imageUrl = (snapshot.imageUrl as string | undefined) ?? null;
      let lineRental = Number(snapshot.lineRental ?? 0);
      let quantity = Number(snapshot.quantity ?? 1);

      // Snapshot cũ có thể thiếu `lineRental` → lấy giá trị dòng đơn tương ứng.
      if (lineRental <= 0 && incident.itemKind === "accessory" && incident.bookingAccessoryItemId) {
        const row = accessoryById.get(incident.bookingAccessoryItemId);
        if (row) {
          lineRental = Number(row.rentalTotal ?? 0);
          quantity = Math.max(1, row.quantity ?? quantity);
        }
      }
      if (lineRental <= 0 && incident.itemKind === "garment" && incident.bookingItemId) {
        const row = itemById.get(incident.bookingItemId);
        if (row) {
          const days = Math.max(
            1,
            Math.round(
              (new Date(context.booking.rentalEndDate).getTime() -
                new Date(context.booking.rentalStartDate).getTime()) /
                DAY_MS,
            ) + 1,
          );
          lineRental = Number(row.dailyPrice ?? 0) * days;
        }
      }

      return {
        name,
        sizeLabel: (snapshot.sizeLabel as string | undefined) ?? null,
        imageUrl,
        quantity: Math.max(1, quantity),
        price: lineRental > 0 ? lineRental : 0,
        note: incident.reason ? incidentReasonLabel(incident.reason, incident.itemKind as IncidentItemKind) : null,
      };
    });
  }

  /** Mẫu thay thế quản lý đã chọn — kèm ảnh + giá để khách so sánh. */
  private async proposedItemsForEmail(
    context: Awaited<ReturnType<BookingChangeRequestsService["loadEmailContext"]>>,
    dto: ManagerIncidentActionDto,
  ): Promise<IncidentEmailItem[]> {
    const rows: IncidentEmailItem[] = [];
    const days = Math.max(
      1,
      Math.ceil(
        (new Date(context.booking.rentalEndDate).getTime() - new Date(context.booking.rentalStartDate).getTime()) /
          DAY_MS,
      ) + 1,
    );

    const sizeIds = (dto.replacements ?? []).map((row) => row.sizeId).filter(Boolean);
    if (sizeIds.length > 0) {
      const sizes = await this.prisma.garment_sizes.findMany({
        where: { id: { in: sizeIds } },
        select: {
          id: true,
          size_label: true,
          daily_price: true,
          garments: {
            select: { name: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { imageUrl: true } } },
          },
        },
      });
      const byId = new Map(sizes.map((size) => [size.id, size]));
      for (const sizeId of sizeIds) {
        const size = byId.get(sizeId);
        if (!size) continue;
        rows.push({
          name: size.garments?.name ?? "Trang phục",
          sizeLabel: size.size_label ?? null,
          imageUrl: size.garments?.images?.[0]?.imageUrl ?? null,
          quantity: 1,
          price: Number(size.daily_price ?? 0) * days,
        });
      }
    }

    const accessoryIds = [
      ...(dto.accessoryReplacements ?? []).map((row) => row.accessoryId).filter((id): id is string => Boolean(id)),
      ...(dto.addAccessories ?? []).map((row) => row.accessoryId),
    ];
    if (accessoryIds.length > 0) {
      const accessories = await this.prisma.accessories.findMany({
        where: { id: { in: [...new Set(accessoryIds)] } },
        select: { id: true, name: true, image_url: true },
      });
      const byId = new Map(accessories.map((row) => [row.id, row]));
      // Phụ kiện đổi sang mẫu khác: giá lấy theo liên kết `garment_accessories`
      // của trang phục tương ứng (is_included → 0). Không tra được → 0 (Miễn phí).
      const accessoryPriceCache = new Map<string, number>();
      const priceForAccessory = async (accessoryId: string, itemId?: string) => {
        const garmentId = itemId
          ? context.booking.items.find((item) => item.id === itemId)?.garmentId
          : context.booking.items[0]?.garmentId;
        if (!garmentId) return 0;
        const cacheKey = `${garmentId}:${accessoryId}`;
        const cached = accessoryPriceCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const link = await this.prisma.garment_accessories.findFirst({
          where: { garment_id: garmentId, accessory_id: accessoryId },
          select: { is_included: true, extra_price: true },
        });
        const price = !link || link.is_included ? 0 : Number(link.extra_price ?? 0) * days;
        accessoryPriceCache.set(cacheKey, price);
        return price;
      };

      for (const row of dto.accessoryReplacements ?? []) {
        if (!row.accessoryId) continue;
        const accessory = byId.get(row.accessoryId);
        if (!accessory) continue;
        // Đổi chiếc CÙNG mẫu (mẫu không đổi, chỉ đổi chiếc vật lý): giá phải lấy
        // đúng `rentalTotal` đang có trong đơn, KHÔNG tính lại từ `extra_price × days`.
        // `buildAfterItems` (dòng "Sản phẩm thuê sau thay đổi") cũng dùng giá đã chốt,
        // nên nếu email tính lại theo công thức hiện tại thì bản xem trước sẽ lệch
        // với email dù mẫu phụ kiện không đổi (vd giá đơn chốt theo rule/voucher khác).
        const current = context.booking.accessoryItems.find(
          (item) => item.accessoryId === row.accessoryId,
        );
        rows.push({
          name: accessory.name,
          imageUrl: accessory.image_url ?? null,
          quantity: 1,
          price: current ? Number(current.rentalTotal) : await priceForAccessory(row.accessoryId, undefined),
        });
      }
      for (const row of dto.addAccessories ?? []) {
        const accessory = byId.get(row.accessoryId);
        if (!accessory) continue;
        rows.push({
          name: accessory.name,
          imageUrl: accessory.image_url ?? null,
          quantity: Math.max(1, row.quantity ?? 1),
          price: (await priceForAccessory(row.accessoryId, row.itemId)) * Math.max(1, row.quantity ?? 1),
        });
      }
    }

    return rows;
  }

  /**
   * Đóng PayOS intent trước khi manager hủy đơn / bỏ món khi đơn đang có yêu cầu
   * `awaiting_payment` hoặc Payment PayOS `pending`. Trả về yêu cầu
   * `awaiting_payment` (nếu có) để nơi gọi dọn tiếp.
   *
   * PayOS đang xử lý/không đọc được/đã thu tiền → `409` (ConflictException),
   * KHÔNG tiếp tục thao tác.
   */
  private async closePayosBeforeManagerAction(bookingId: string) {
    const awaitingRequest = await this.prisma.bookingChangeRequest.findFirst({
      where: { bookingId, status: "awaiting_payment" },
      select: { id: true, paymentId: true },
    });
    const pendingPayosPayment = awaitingRequest
      ? null
      : await this.prisma.payment.findFirst({
          where: { bookingId, provider: "payos", status: "pending", providerTransactionId: { not: null } },
          select: { id: true },
        });
    if (!awaitingRequest && !pendingPayosPayment) return null;

    if (awaitingRequest?.paymentId) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: awaitingRequest.paymentId },
        select: { status: true },
      });
      if (payment?.status === "paid") {
        throw new ConflictException("Yêu cầu đổi đã được thanh toán, không thể tiếp tục xử lý sự cố.");
      }
    }

    if (this.payments) {
      try {
        await this.payments.releaseClosedPayosIntents(bookingId, { strict: true });
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
    }
    return awaitingRequest;
  }

  private async cancelIncidentBooking(
    actor: Pick<AuthenticatedUser, "id" | "role">,
    incident: { id: string; bookingId: string; booking: { status: BookingStatus } },
    incidentIds: string[],
    reason: string,
    dto: ManagerIncidentActionDto,
  ) {
    const cancellableStatuses: BookingStatus[] = [
      BookingStatus.pending_confirmation,
      BookingStatus.confirmed,
      BookingStatus.awaiting_payment,
      ...STAFF_CANCELLABLE_STATUSES,
    ];
    const bookingId = incident.bookingId;

    // Tiền hoàn phải tính TRƯỚC khi huỷ: `cancelBookingTx` tạo phiếu hoàn nên đọc
    // sau đó sẽ ra 0 (email từng báo "0đ" dù khách đã trả tiền).
    const refundEstimate = await this.estimateRefund(bookingId);

    // §13.2: đơn đang có yêu cầu chờ thanh toán / Payment PayOS `pending` → đóng
    // intent TRƯỚC. PayOS đang xử lý/không đọc được → 409, KHÔNG hủy đơn.
    await this.closePayosBeforeManagerAction(bookingId);

    const result = await this.prisma.runSerializable(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!current) throw new NotFoundException("Booking not found.");
      if (!cancellableStatuses.includes(current.status)) {
        throw new BadRequestException("Đơn ở trạng thái này không thể hủy.");
      }
      const cancelled = await cancelBookingTx(tx, {
        bookingId,
        fromStatus: current.status,
        actorId: actor.id,
        reason,
        vouchers: this.vouchers,
      });
      if (!cancelled) throw new ConflictException("Đơn vừa được xử lý bởi thao tác khác.");

      // Yêu cầu đổi đang chờ không còn hiệu lực; hold hết tác dụng ngay.
      await tx.bookingChangeRequest.updateMany({
        where: { bookingId, status: { in: [...PENDING_STATUSES] } },
        data: { status: "cancelled" },
      });
      await tx.bookingChangeHold.updateMany({
        where: { bookingId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      // Sự cố đang mở của đơn đã được `cancelBookingTx` đóng (resolved/booking_cancelled).
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "booking.staff.incident.cancel",
          entityType: "booking",
          entityId: bookingId,
          metadata: { incidentId: incident.id, reason, fromStatus: current.status } as Prisma.InputJsonValue,
        },
      });
      return { status: "cancelled" };
    });

    // Manager huỷ đơn vì sự cố: khách PHẢI nhận email nói rõ đơn bị huỷ, lý do và
    // tiền hoàn (nếu có) — không im lặng huỷ đơn sau lưng khách.
    await this.sendIncidentCancellationEmail(actor, incident.bookingId, incidentIds, reason, dto, refundEstimate).catch((error) => {
      this.logger.warn(
        `Không gửi được email huỷ đơn ${incident.bookingId}: ${this.errorMessage(error)}`,
      );
    });

    return ok({ incidentId: incident.id, bookingId, action: "cancel", status: result.status });
  }

  private async removeIncidentItem(
    actor: Pick<AuthenticatedUser, "id" | "role">,
    incident: { id: string; bookingId: string; itemKind: string; snapshot: unknown },
    incidentIds: string[],
    reason: string,
    dto: ManagerIncidentActionDto,
  ) {
    // §13.2: nếu đơn đang có yêu cầu chờ thanh toán / PayOS `pending`, đóng intent
    // TRƯỚC rồi mới hủy yêu cầu cũ và áp dụng bỏ món. PayOS lỗi → 409.
    const awaiting = await this.closePayosBeforeManagerAction(incident.bookingId);
    if (awaiting) {
      await this.prisma.bookingChangeRequest.updateMany({
        where: { id: awaiting.id, status: "awaiting_payment" },
        data: { status: "cancelled" },
      });
      await this.prisma.bookingChangeHold.updateMany({
        where: { changeRequestId: awaiting.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    }

    const created = await this.createChangeRequest(
      actor as AuthenticatedUser,
      incident.bookingId,
      { type: "remove", incidents: incidentIds, note: reason },
      { source: "manager", holdMinutes: INCIDENT_MANAGER_HOLD_MINUTES },
    );
    const requestId = (created.data as { requestId: string }).requestId;
    const request = await this.prisma.bookingChangeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu đổi.");

    // Email cần số tiền hoàn TRƯỚC khi áp dụng: huỷ đơn tạo phiếu hoàn nên đọc sau
    // đó sẽ ra 0. `allRemoved` đã chốt sẵn trong snapshot của yêu cầu.
    const beforeSnapshot = (request.beforeSnapshot ?? {}) as Record<string, unknown>;
    const afterSnapshot = (request.afterSnapshot ?? {}) as Record<string, unknown>;
    const willCancel = afterSnapshot.allRemoved === true;
    const refundEstimate = willCancel ? await this.estimateRefund(incident.bookingId) : 0;

    const applied = await this.prisma.runSerializable(async (tx) =>
      this.applyChangeRequestTx(tx, {
        bookingId: incident.bookingId,
        actorId: actor.id,
        request: {
          id: request.id,
          type: request.type,
          selection: request.selection as Record<string, unknown>,
          beforeSnapshot: request.beforeSnapshot as Record<string, unknown>,
          afterSnapshot: request.afterSnapshot as Record<string, unknown>,
          holdExpiresAt: request.holdExpiresAt,
        },
      }),
    );

    // Xác nhận bỏ món là gửi email luôn: không còn bước "gửi mail trước rồi khách
    // mới xác nhận được". Bỏ hết trang phục → đơn huỷ, email nói rõ tiền hoàn.
    await this.sendRemovalEmail({
      actorId: actor.id,
      incidentId: incident.id,
      bookingId: incident.bookingId,
      incidentIds,
      reason,
      dto,
      beforeRentalTotal: Number(beforeSnapshot.rentalTotal ?? 0),
      afterRentalTotal: Number(afterSnapshot.newRentalTotal ?? applied.rentAfter ?? 0),
      beforeDepositTotal: Number(beforeSnapshot.depositTotal ?? 0),
      afterDepositTotal: Number(afterSnapshot.newDepositTotal ?? applied.depositAfter ?? 0),
      creditAmount: Number(afterSnapshot.creditAmount ?? 0),
      refundAmount: refundEstimate,
      cancelled: willCancel,
    }).catch((error) => {
      this.logger.warn(
        `Không gửi được email bỏ món ${incident.bookingId}: ${this.errorMessage(error)}`,
      );
    });

    return ok({ incidentId: incident.id, bookingId: incident.bookingId, action: "remove", ...applied });
  }

  /**
   * Email sau khi BỎ MÓN được xác nhận (quản lý bỏ trực tiếp hoặc khách xác nhận
   * yêu cầu bỏ món): đơn trước/sau, món đã bỏ, lý do. Bỏ hết trang phục thì đơn
   * bị huỷ → email dùng bố cục huỷ đơn kèm tiền hoàn dự kiến.
   */
  private async sendRemovalEmail(input: {
    actorId?: string | null;
    incidentId?: string | null;
    bookingId: string;
    incidentIds: string[];
    reason: string;
    dto: Pick<ManagerIncidentActionDto, "emailSubject" | "emailMessage">;
    beforeRentalTotal: number;
    afterRentalTotal: number;
    beforeDepositTotal: number;
    afterDepositTotal: number;
    creditAmount: number;
    refundAmount: number;
    /** Bỏ hết trang phục → đơn bị huỷ. */
    cancelled: boolean;
  }) {
    if (!this.notifications) return;
    const built = await this.buildRemovalEmailData(input);
    if (!built.context.customerEmail) return;

    await this.notifications.notifyUser({
      userId: built.context.booking.customerId,
      email: built.context.customerEmail,
      templateKey: "booking.incident_removed_email",
      channels: ["email"],
      data: {
        bookingId: input.bookingId,
        bookingCode: built.context.bookingCode,
        emailSubject: built.emailSubject,
        html: built.emailHtml,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: "booking.incident.removal_email_sent",
        entityType: "booking",
        entityId: input.bookingId,
        metadata: {
          incidentId: input.incidentId ?? null,
          cancelled: built.cancelled,
          email: built.context.customerEmail,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** Σ payment đã thu − Σ refund đang/đã xử lý = số tiền sẽ hoàn nếu huỷ đơn. */
  private async estimateRefund(bookingId: string): Promise<number> {
    const [payments, refunds] = await Promise.all([
      this.prisma.payment.findMany({ where: { bookingId, status: "paid" }, select: { amount: true } }),
      this.prisma.refund.findMany({
        where: {
          bookingId,
          status: { in: ["pending", "refunding", "refunded", "partially_refunded"] },
        },
        select: { amount: true },
      }),
    ]);
    const paidTotal = payments.reduce((sum, row) => sum + Number(row.amount), 0);
    const refundedTotal = refunds.reduce((sum, row) => sum + Number(row.amount), 0);
    return Math.max(0, paidTotal - refundedTotal);
  }

  /**
   * Số tiền HOÀN của một đơn ĐÃ BỊ HUỶ — khác `estimateRefund` (phần còn phải
   * hoàn). Đơn huỷ thường đã có phiếu hoàn toàn bộ tiền thực thu nên
   * `estimateRefund` trả 0 dù khách đã được/đang được hoàn. Ưu tiên tổng các
   * phiếu hoàn đã tạo; nếu chưa có phiếu nào thì đó chính là toàn bộ tiền đã thu.
   */
  private async cancelledBookingRefundAmount(bookingId: string): Promise<number> {
    const [payments, refunds] = await Promise.all([
      this.prisma.payment.findMany({ where: { bookingId, status: "paid" }, select: { amount: true } }),
      this.prisma.refund.findMany({
        where: {
          bookingId,
          status: { in: ["pending", "refunding", "refunded", "partially_refunded"] },
        },
        select: { amount: true },
      }),
    ]);
    const paidTotal = payments.reduce((sum, row) => sum + Number(row.amount), 0);
    const refundedTotal = refunds.reduce((sum, row) => sum + Number(row.amount), 0);
    return Math.max(0, refundedTotal > 0 ? refundedTotal : paidTotal);
  }

  /** Email thông báo huỷ đơn (kèm lý do + tiền hoàn dự kiến) cho khách của đơn. */
  private async sendIncidentCancellationEmail(
    actor: Pick<AuthenticatedUser, "id">,
    bookingId: string,
    incidentIds: string[],
    reason: string,
    dto: ManagerIncidentActionDto,
    refundAmount?: number,
  ) {
    if (!this.notifications) return;
    const built = await this.buildCancellationEmailData(
      bookingId,
      incidentIds,
      reason,
      dto,
      refundAmount,
    );
    if (!built.context.customerEmail) return;

    await this.notifications.notifyUser({
      userId: built.context.booking.customerId,
      email: built.context.customerEmail,
      templateKey: "booking.incident_cancelled_email",
      channels: ["email"],
      data: {
        bookingId,
        bookingCode: built.context.bookingCode,
        emailSubject: built.emailSubject,
        html: built.emailHtml,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "booking.incident.cancellation_email_sent",
        entityType: "booking",
        entityId: bookingId,
        metadata: {
          refundEstimate: refundAmount ?? built.context.refundEstimate,
          email: built.context.customerEmail,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async proposeIncidentResolution(
    actor: Pick<AuthenticatedUser, "id" | "role">,
    incident: {
      id: string;
      bookingId: string;
      itemKind: string;
      snapshot: unknown;
      booking: { customerId: string; rentalStartDate: Date };
    },
    incidentIds: string[],
    dto: ManagerIncidentActionDto,
    reason: string,
  ) {
    const type =
      dto.type ??
      (dto.replacements?.length || dto.accessoryReplacements?.length ? "replace" : "remove");
    const created = await this.createChangeRequest(
      actor as AuthenticatedUser,
      incident.bookingId,
      {
        type,
        incidents: incidentIds,
        replacements: dto.replacements,
        accessoryReplacements: dto.accessoryReplacements,
        removeAccessoryItemIds: dto.removeAccessoryItemIds,
        addAccessories: dto.addAccessories,
        note: reason,
      },
      { source: "manager", holdMinutes: INCIDENT_MANAGER_HOLD_MINUTES },
    );
    const requestId = (created.data as { requestId: string }).requestId;

    await this.prisma.bookingIncident.updateMany({
      where: { id: { in: incidentIds }, bookingId: incident.bookingId },
      data: { status: "awaiting_customer", changeRequestId: requestId },
    });

    // §7.2: gửi email đề xuất đầy đủ cho khách (ảnh, giá cũ/mới, chênh lệch,
    // lý do, hạn giữ chỗ 30 phút, nút xác nhận). Lỗi email không được chặn thao tác.
    await this.sendIncidentProposalEmail(actor, incident, incidentIds, dto, reason, requestId).catch((error) => {
      this.logger.warn(
        `Không gửi được email đề xuất đổi mẫu ${incident.id}: ${this.errorMessage(error)}`,
      );
    });

    if (this.notifications) {
      const emailIncidents = await this.loadEmailIncidents(incident.bookingId, incidentIds);
      const firstTwo = emailIncidents.slice(0, 2).map((row) => {
        const snap = (row.snapshot ?? {}) as Record<string, unknown>;
        return (snap.name as string | undefined) ?? "trang phục";
      });
      const garmentName =
        firstTwo.length > 1 ? `${firstTwo.join(", ")}${emailIncidents.length > 2 ? "…" : ""}` : (firstTwo[0] ?? "trang phục");
      try {
        await this.notifications.notifyUser({
          userId: incident.booking.customerId,
          templateKey: "booking.incident_action_required",
          linkUrl: `/booking/incidents/${incident.bookingId}`,
          data: {
            bookingId: incident.bookingId,
            bookingCode: incident.bookingId.slice(0, 8).toUpperCase(),
            garmentName,
            startDate: new Date(incident.booking.rentalStartDate).toISOString().slice(0, 10),
            note: reason,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Không gửi được thông báo đề xuất xử lý sự cố ${incident.id}: ${this.errorMessage(error)}`,
        );
      }
    }

    return ok({
      incidentId: incident.id,
      incidentIds,
      bookingId: incident.bookingId,
      action: "proposal",
      source: "manager",
      ...(created.data as Record<string, unknown>),
    });
  }

  /**
   * Gửi email đề xuất đổi mẫu cho khách. Tái dùng ĐÚNG những gì bản xem trước
   * dựng để nội dung khách nhận khớp bản quản lý đã duyệt.
   */
  private async sendIncidentProposalEmail(
    actor: Pick<AuthenticatedUser, "id">,
    incident: { id: string; bookingId: string; itemKind: string; snapshot: unknown },
    incidentIds: string[],
    dto: ManagerIncidentActionDto,
    reason: string,
    requestId: string,
  ) {
    if (!this.notifications) return;
    const context = await this.loadEmailContext(incident.bookingId);
    if (!context.customerEmail) return;
    const emailIncidents = await this.loadEmailIncidents(incident.bookingId, incidentIds);

    const request = await this.prisma.bookingChangeRequest.findUnique({
      where: { id: requestId },
      select: { id: true, holdExpiresAt: true, rentBefore: true, rentAfter: true, depositBefore: true, depositAfter: true, chargeAmount: true, afterSnapshot: true },
    });
    const after = (request?.afterSnapshot ?? {}) as Record<string, unknown>;
    const proposedItems = await this.proposedItemsForEmail(context, dto);

    const emailSubject = dto.emailSubject?.trim() || proposalEmailSubject(context.bookingCode);
    const emailHtml = buildProposalEmail({
      bookingId: incident.bookingId,
      bookingCode: context.bookingCode,
      customerName: context.customerName,
      rentalStartDate: context.booking.rentalStartDate,
      rentalEndDate: context.booking.rentalEndDate,
      affectedItems: this.affectedItemsForEmail(context, emailIncidents),
      proposedItems,
      rentBefore: Number(request?.rentBefore ?? context.booking.rentalTotal),
      rentAfter: Number(request?.rentAfter ?? context.booking.rentalTotal),
      depositBefore: Number(request?.depositBefore ?? context.booking.depositTotal),
      depositAfter: Number(request?.depositAfter ?? context.booking.depositTotal),
      chargeNow: Number(request?.chargeAmount ?? 0),
      creditAmount: Number(after.creditAmount ?? 0),
      reason,
      holdExpiresAt: request?.holdExpiresAt ?? new Date(Date.now() + INCIDENT_MANAGER_HOLD_MINUTES * 60_000),
      actionUrl: incidentActionUrl(incident.bookingId),
      emailSubject,
      emailMessage: dto.emailMessage,
    });

    await this.notifications.notifyUser({
      userId: context.booking.customerId,
      email: context.customerEmail,
      templateKey: "booking.incident_proposal_email",
      channels: ["email"],
      data: { bookingId: incident.bookingId, bookingCode: context.bookingCode, emailSubject, html: emailHtml },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "booking.incident.proposal_email_sent",
        entityType: "booking",
        entityId: incident.bookingId,
        metadata: { incidentId: incident.id, email: context.customerEmail } as Prisma.InputJsonValue,
      },
    });
  }

  // ── §7.4 Hết hạn / khách hủy / từ chối ──────────────────────────────────

  async getChangeRequest(user: AuthenticatedUser, bookingId: string, requestId: string) {
    await this.loadOwnedBooking(user, bookingId);
    const request = await this.prisma.bookingChangeRequest.findFirst({ where: { id: requestId, bookingId } });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu đổi.");

    return ok({
      id: request.id,
      bookingId: request.bookingId,
      type: request.type,
      status: request.status,
      source: request.source,
      /**
       * Email thông báo bỏ món giờ gửi ĐÚNG LÚC xác nhận (không còn bước gửi
       * trước), nên khách luôn xác nhận được ngay. Giữ trường để FE/bản cũ
       * không vỡ.
       */
      removalEmailSent: true,
      rentBefore: Number(request.rentBefore),
      rentAfter: Number(request.rentAfter),
      depositBefore: Number(request.depositBefore),
      depositAfter: Number(request.depositAfter),
      discountBefore: Number(request.discountBefore),
      discountAfter: Number(request.discountAfter),
      chargeAmount: Number(request.chargeAmount),
      holdExpiresAt: request.holdExpiresAt,
      countdownSeconds: this.countdown(request.holdExpiresAt),
      requiresHold: this.selectionRequiresHold(request.selection),
      checkoutUrl: request.checkoutUrl,
      selection: request.selection,
      beforeSnapshot: request.beforeSnapshot,
      afterSnapshot: request.afterSnapshot,
    });
  }

  async cancelChangeRequest(user: AuthenticatedUser, bookingId: string, requestId: string) {
    await this.loadOwnedBooking(user, bookingId);
    const request = await this.prisma.bookingChangeRequest.findFirst({
      where: { id: requestId, bookingId },
      select: { status: true, paymentId: true },
    });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu đổi.");
    if (!PENDING_STATUSES.includes(request.status as never)) {
      throw new BadRequestException("Yêu cầu này không còn hủy được.");
    }

    // §7.4: yêu cầu đang chờ thanh toán → đóng intent PayOS TRƯỚC. PayOS đang
    // xử lý / không đọc được / đã thu tiền → 409, KHÔNG hủy yêu cầu.
    if (request.status === "awaiting_payment") {
      if (request.paymentId) {
        const payment = await this.prisma.payment.findUnique({
          where: { id: request.paymentId },
          select: { status: true },
        });
        if (payment?.status === "paid") {
          throw new ConflictException("Yêu cầu đã được thanh toán, không thể hủy.");
        }
      }
      if (this.payments) {
        try {
          await this.payments.releaseClosedPayosIntents(bookingId, { strict: true });
        } catch (error) {
          if (error instanceof BadRequestException || error instanceof ConflictException) {
            throw new ConflictException(error.message);
          }
          throw error;
        }
      }
    }

    await this.prisma.runSerializable(async (tx) => {
      const updated = await tx.bookingChangeRequest.updateMany({
        where: { id: requestId, bookingId, status: { in: [...PENDING_STATUSES] } },
        data: { status: "cancelled" },
      });
      if (updated.count !== 1) throw new ConflictException("Yêu cầu vừa được xử lý bởi thao tác khác.");
      // Hold hết tác dụng ngay (không cần purge) và sự cố về cho khách chọn lại.
      await tx.bookingChangeHold.updateMany({
        where: { changeRequestId: requestId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.bookingIncident.updateMany({
        where: { bookingId, status: "needs_manager" },
        data: { status: "awaiting_customer" },
      });
    });

    return ok({ id: requestId, status: "cancelled" });
  }

  async declineIncident(user: AuthenticatedUser, bookingId: string, incidentId: string) {
    await this.loadOwnedBooking(user, bookingId);
    const updated = await this.prisma.bookingIncident.updateMany({
      where: { id: incidentId, bookingId, status: "awaiting_customer" },
      data: { status: "needs_manager", note: "Khách từ chối phương án đổi mẫu." },
    });
    if (updated.count !== 1) throw new ConflictException("Sự cố vừa được xử lý bởi thao tác khác.");
    return ok({ id: incidentId, status: "needs_manager" });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async loadOwnedBooking(user: AuthenticatedUser, bookingId: string): Promise<BookingRow> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: {
            garment_sizes: {
              include: { garments: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } } },
            },
          },
        },
        accessoryItems: {
          include: { accessory: true, bookingItem: { select: { id: true, garmentId: true } } },
        },
        customer: { include: { profile: true } },
      },
    });
    if (!booking) throw new NotFoundException("Booking not found.");
    // Ownership là bước RIÊNG ngoài guard (defense in depth).
    if (user.role === "customer" && booking.customerId !== user.id) {
      throw new ForbiddenException("Bạn không có quyền xem đơn này.");
    }
    return booking as BookingRow;
  }

  private countdown(deadline: Date): number {
    return Math.max(0, Math.floor((+deadline - Date.now()) / 1000));
  }

  /**
   * Khóa advisory (transaction-scoped) theo từng nhóm size/accessory trước bước
   * check-then-hold. Hai giao dịch cùng chọn một size (dù thuộc hai đơn khác nhau)
   * sẽ nối tiếp nhau, nên chỉ một yêu cầu giữ được một asset cụ thể.
   *
   * Lưu ý: khóa advisory chỉ giúp GIẢM tranh chấp. Snapshot SERIALIZABLE có thể đã
   * được lấy trước khi lấy khóa, nên cơ chế chống oversell thật vẫn là SERIALIZABLE
   * + retry (xem `PrismaService.runSerializable`).
   *
   * Dùng câu lệnh CÓ THAM SỐ (`hashtext($1)`) — không ghép chuỗi — để tránh SQL injection.
   */
  private async lockCandidateGroups(
    tx: Prisma.TransactionClient,
    groups: { garmentSizeIds: string[]; accessoryIds: string[] },
  ): Promise<void> {
    const client = tx as unknown as {
      $executeRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<unknown>;
    };
    if (typeof client.$executeRawUnsafe !== "function") return;
    // Sắp theo thứ tự key cố định để mọi giao dịch lấy khóa cùng thứ tự → tránh deadlock.
    const keys = [
      ...new Set(groups.garmentSizeIds.map((id) => `change-hold:size:${id}`)),
      ...new Set(groups.accessoryIds.map((id) => `change-hold:accessory:${id}`)),
    ].sort();
    for (const key of keys) {
      await client.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", key);
    }
  }

  /** Số ngày đệm giặt đọc từ cài đặt hệ thống, giống đường gán tự động. */
  private async laundryBufferDays(): Promise<number> {
    const client = this.prisma as unknown as {
      systemSetting?: { findUnique?: (args: { where: { key: string } }) => Promise<{ value: unknown } | null> };
    };
    if (!client.systemSetting?.findUnique) return DEFAULT_LAUNDRY_BUFFER_DAYS;
    const setting = await client.systemSetting.findUnique({ where: { key: "laundry_buffer_days" } });
    const raw = setting?.value as unknown;
    const value = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
      ? (raw as { value: unknown }).value
      : raw;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LAUNDRY_BUFFER_DAYS;
  }

  /** Chọn asset cụ thể còn trống cho mẫu mới, đã tính hold (§10). `null` nếu hết hàng. */
  private async chooseGarmentAsset(
    tx: Prisma.TransactionClient,
    input: {
      garmentId: string;
      sizeId: string;
      bookingId: string;
      startDay: Date;
      endDay: Date;
      bufferDays: number;
      usedAssets: Set<string>;
    },
  ): Promise<string | null> {
    const rows = await tx.garmentAsset.findMany({
      where: { garmentId: input.garmentId, garment_size_id: input.sizeId, status: { in: RENTABLE_ASSET_STATUSES } },
      select: {
        id: true,
        assetCode: true,
        status: true,
        bookingItems: { select: { booking: { select: { status: true, rentalStartDate: true, rentalEndDate: true } } } },
      },
    });
    const ranked = rankAssetCandidates(
      rows
        .filter((row) => !input.usedAssets.has(row.id))
        .map((row) => ({
          id: row.id,
          code: row.assetCode,
          status: row.status,
          bookings: row.bookingItems.map((item) => item.booking),
        })),
      input.startDay,
      { minTurnaroundDays: Math.max(2, input.bufferDays + 1) },
    );
    for (const candidate of ranked) {
      try {
        await assertAssetScheduleAvailable(tx, {
          assetId: candidate.id,
          bookingId: input.bookingId,
          garmentId: input.garmentId,
          garmentSizeId: input.sizeId,
          startDay: input.startDay,
          endDay: input.endDay,
          laundryBufferDays: input.bufferDays,
        });
        return candidate.id;
      } catch {
        // Ứng viên bận → thử ứng viên kế tiếp.
      }
    }
    return null;
  }

  /** Chọn accessory asset cụ thể còn trống cho phụ kiện thêm, đã tính hold (§10). */
  private async chooseAccessoryAsset(
    tx: Prisma.TransactionClient,
    input: {
      accessoryId: string;
      bookingId: string;
      startDay: Date;
      endDay: Date;
      bufferDays: number;
      usedAssets: Set<string>;
      /** Dòng phụ kiện sẽ bị bỏ trong cùng yêu cầu → chiếc của nó được tái dùng. */
      excludeItemIds?: Set<string>;
    },
  ): Promise<string | null> {
    const rows = await tx.accessory_assets.findMany({
      where: { accessory_id: input.accessoryId, status: { in: RENTABLE_ASSET_STATUSES } },
      select: {
        id: true,
        asset_code: true,
        status: true,
        booking_accessory_items: {
          select: { booking: { select: { status: true, rentalStartDate: true, rentalEndDate: true } } },
        },
      },
    });
    const ranked = rankAssetCandidates(
      rows
        .filter((row) => !input.usedAssets.has(row.id))
        .map((row) => ({
          id: row.id,
          code: row.asset_code,
          status: row.status,
          bookings: row.booking_accessory_items.map((item) => item.booking),
        })),
      input.startDay,
      { minTurnaroundDays: Math.max(2, input.bufferDays + 1) },
    );
    for (const candidate of ranked) {
      try {
        await assertAccessoryAssetScheduleAvailable(tx, {
          assetId: candidate.id,
          bookingId: input.bookingId,
          accessoryId: input.accessoryId,
          excludeAccessoryItemIds: input.excludeItemIds ? [...input.excludeItemIds] : undefined,
          startDay: input.startDay,
          endDay: input.endDay,
          laundryBufferDays: input.bufferDays,
        });
        return candidate.id;
      } catch {
        // Ứng viên bận → thử ứng viên kế tiếp.
      }
    }
    return null;
  }

  /**
   * Gợi ý thay thế còn trống đúng khoảng ngày thuê (tối đa 8 lựa chọn).
   *
   * - **Trang phục**: cùng mẫu/cùng danh mục + ĐÚNG size của món bị sự cố, kèm
   *   danh sách phụ kiện đi kèm (`garment_accessories`) + ảnh để khách chọn.
   * - **Phụ kiện** (đơn chỉ lỗi phụ kiện): các MẪU phụ kiện KHÁC của cùng trang
   *   phục còn hàng và không trùng lịch thuê, kèm giá thuê theo liên kết.
   */
  private async buildSuggestions(
    booking: BookingRow,
    incidents: Array<{
      id: string;
      itemKind: string;
      bookingItemId: string | null;
      bookingAccessoryItemId?: string | null;
      snapshot?: unknown;
    }>,
  ) {
    const startDay = booking.rentalStartDate;
    const endDay = booking.rentalEndDate;
    const { days } = parseRentalDateRange(startDay, endDay);

    type AccessoryOption = {
      accessoryId: string;
      name: string;
      imageUrl: string | null;
      isIncluded: boolean;
      extraPrice: number;
      available: number;
      /**
       * Số đơn vị tối đa khách được chọn cho mẫu phụ kiện này: nhỏ hơn giữa
       * `garment_accessories.quantity` của mẫu mới và số chiếc còn thuê được.
       */
      maxQuantity: number;
    };
    type GarmentOption = {
      garmentId: string;
      sizeId: string;
      sizeLabel: string | null;
      name: string;
      imageUrl: string | null;
      available: number;
      /** Giá/ngày của size (trước giảm giá) để hiện trên card gợi ý. */
      dailyPrice: number;
      /** Tiền thuê cả kỳ của size (đã áp rule giá nếu có). */
      rentalTotal: number;
      /** Tiền cọc của size. */
      depositAmount: number;
      accessories: AccessoryOption[];
    };
    type GarmentRow = {
      id: string;
      name: string;
      images: Array<{ imageUrl: string | null }>;
      garment_sizes: Array<{
        id: string;
        size_label: string | null;
        daily_price: Prisma.Decimal | number | null;
        deposit_amount: Prisma.Decimal | number | null;
      }>;
      garment_accessories: Array<{
        quantity: number | null;
        is_included: boolean;
        extra_price: Prisma.Decimal | number | null;
        accessories: { id: string; name: string; image_url: string | null };
      }>;
    };

    const garmentOptionsByIncident = new Map<string, GarmentOption[]>();
    const accessoryOptionsByIncident = new Map<
      string,
      { accessoryId: string; name: string; options: AccessoryOption[] }
    >();
    const accessoryIds = new Set<string>();

    for (const incident of incidents) {
      if (incident.itemKind === "garment" && incident.bookingItemId) {
        const item = booking.items.find((row) => row.id === incident.bookingItemId);
        if (!item) continue;
        const targetLabel = item.garment_sizes?.size_label ?? null;
        const sizeFilter = targetLabel
          ? { size_label: { equals: targetLabel, mode: Prisma.QueryMode.insensitive } }
          : {};
        const selectShape = {
          id: true,
          name: true,
          images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { imageUrl: true } },
          garment_sizes: {
            where: { is_active: true, ...sizeFilter },
            select: { id: true, size_label: true, daily_price: true, deposit_amount: true },
            take: 1,
          },
          garment_accessories: {
            select: {
              quantity: true,
              is_included: true,
              extra_price: true,
              accessories: { select: { id: true, name: true, image_url: true } },
            },
            take: 8,
          },
        } satisfies Prisma.GarmentSelect;

        const target = await this.prisma.garment.findUnique({
          where: { id: item.garmentId },
          select: { categoryId: true },
        });
        let rows: GarmentRow[];
        if (target?.categoryId) {
          // Cùng mẫu HOẶC cùng danh mục, nhưng luôn ĐÚNG size của món bị sự cố.
          rows = await this.prisma.garment.findMany({
            where: {
              isActive: true,
              deletedAt: null,
              OR: [{ id: item.garmentId }, { categoryId: target.categoryId }],
              garment_sizes: { some: { is_active: true, ...sizeFilter } },
            },
            select: selectShape,
            orderBy: { name: "asc" },
            take: 8,
          });
        } else {
          // Mẫu gốc thiếu danh mục → không đoán mẫu khác, chỉ xét cùng mẫu.
          const sizes = await this.prisma.garment_sizes.findMany({
            where: { garment_id: item.garmentId, is_active: true, ...sizeFilter },
            select: { id: true, size_label: true, daily_price: true, deposit_amount: true },
            take: 8,
          });
          rows = sizes.map((size) => ({
            id: item.garmentId,
            name: item.garment_sizes?.garments?.name ?? "Trang phục",
            images: item.garment_sizes?.garments?.images ?? [],
            garment_sizes: [size],
            garment_accessories: [],
          }));
        }

        const options: GarmentOption[] = [];
        for (const row of rows) {
          const size = row.garment_sizes?.[0];
          if (!size) continue;
          const availability = sizeAvailability(
            await loadSizeInventory(this.prisma, size.id, startDay, endDay, {
              excludeBookingId: booking.id,
            }),
          );
          if (availability.available <= 0) continue;
          const accessories: AccessoryOption[] = [];
          for (const link of row.garment_accessories ?? []) {
            if (!link.accessories) continue;
            accessoryIds.add(link.accessories.id);
            accessories.push({
              accessoryId: link.accessories.id,
              name: link.accessories.name,
              imageUrl: link.accessories.image_url ?? null,
              isIncluded: Boolean(link.is_included),
              extraPrice: Number(link.extra_price ?? 0),
              available: 0,
              maxQuantity: Math.max(0, Number(link.quantity ?? 1)),
            });
          }
          const dailyPrice = Number(size.daily_price ?? 0);
          options.push({
            garmentId: row.id,
            sizeId: size.id,
            sizeLabel: size.size_label ?? null,
            name: row.name,
            imageUrl: row.images?.[0]?.imageUrl ?? null,
            available: availability.available,
            dailyPrice,
            rentalTotal: dailyPrice * days,
            depositAmount: Number(size.deposit_amount ?? 0),
            accessories,
          });
          if (options.length >= 8) break;
        }
        if (options.length > 0) garmentOptionsByIncident.set(incident.id, options);
        continue;
      }

      if (incident.itemKind !== "accessory" || !incident.bookingAccessoryItemId) continue;
      const item = booking.accessoryItems.find((row) => row.id === incident.bookingAccessoryItemId);
      if (!item) continue;
      const hostItem = booking.items.find((row) => row.id === item.bookingItemId);
      const garmentId = item.bookingItem?.garmentId ?? hostItem?.garmentId;
      if (!garmentId) continue;
      // Mẫu phụ kiện để đổi: KHÁC mẫu đang hỏng và CHƯA được thuê trong chính đơn
      // này (mẫu đã có trong đơn = đã được thuê → không gợi ý đổi sang nữa).
      const takenAccessoryIds = [
        ...new Set([item.accessoryId, ...booking.accessoryItems.map((row) => row.accessoryId)]),
      ];
      const links = await this.prisma.garment_accessories.findMany({
        where: { garment_id: garmentId, accessory_id: { notIn: takenAccessoryIds } },
        select: {
          is_included: true,
          extra_price: true,
          accessories: { select: { id: true, name: true, image_url: true } },
        },
        take: 8,
      });
      const options: AccessoryOption[] = [];
      for (const link of links) {
        if (!link.accessories) continue;
        accessoryIds.add(link.accessories.id);
        options.push({
          accessoryId: link.accessories.id,
          name: link.accessories.name,
          imageUrl: link.accessories.image_url ?? null,
          isIncluded: Boolean(link.is_included),
          extraPrice: Number(link.extra_price ?? 0),
          available: 0,
          // Đổi mẫu phụ kiện giữ nguyên số lượng dòng hiện tại (1 đơn vị/dòng).
          maxQuantity: 1,
        });
      }
      if (options.length > 0) {
        accessoryOptionsByIncident.set(incident.id, {
          accessoryId: item.accessoryId,
          name:
            (((incident.snapshot ?? {}) as Record<string, unknown>).name as string | undefined) ??
            item.accessory?.name ??
            "Phụ kiện",
          options,
        });
      }
    }

    // Giá thuê/cọc của từng size gợi ý — một truy vấn chung thay vì N+1.
    const suggestedSizeIds = [
      ...new Set(
        [...garmentOptionsByIncident.values()].flatMap((options) => options.map((option) => option.sizeId)),
      ),
    ];
    if (suggestedSizeIds.length > 0 && this.pricing) {
      try {
        const quotes = await this.pricing.quoteRental(suggestedSizeIds, startDay, endDay);
        for (const options of garmentOptionsByIncident.values()) {
          for (const option of options) {
            const quote = quotes.get(option.sizeId);
            if (quote) option.rentalTotal = quote.rentalTotal;
          }
        }
      } catch (error) {
        // Không chặn gợi ý chỉ vì bảng giá lỗi — fallback giá/ngày × số ngày.
        this.logger.warn(
          `Không lấy được bảng giá gợi ý đổi mẫu: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const counts = await this.countAvailableAccessoryAssets([...accessoryIds], booking.id, startDay, endDay);

    const suggestions: Array<
      | { incidentId: string; itemKind: "garment"; garmentId: string; options: GarmentOption[] }
      | {
          incidentId: string;
          itemKind: "accessory";
          accessoryId: string;
          name: string;
          options: AccessoryOption[];
        }
    > = [];
    for (const incident of incidents) {
      const garmentOptions = garmentOptionsByIncident.get(incident.id);
      if (garmentOptions && garmentOptions.length > 0) {
        for (const option of garmentOptions) {
          for (const accessory of option.accessories) {
            accessory.available = counts.get(accessory.accessoryId) ?? 0;
            accessory.maxQuantity = Math.min(accessory.maxQuantity, accessory.available);
          }
        }
        suggestions.push({
          incidentId: incident.id,
          itemKind: "garment",
          garmentId: garmentOptions[0].garmentId,
          options: garmentOptions,
        });
      }
      const accessorySuggestion = accessoryOptionsByIncident.get(incident.id);
      if (accessorySuggestion) {
        // Chỉ gợi ý mẫu phụ kiện thật sự còn hàng + không trùng lịch thuê.
        const options = accessorySuggestion.options
          .map((option) => {
            const available = counts.get(option.accessoryId) ?? 0;
            return { ...option, available, maxQuantity: Math.min(option.maxQuantity, available) };
          })
          .filter((option) => option.available > 0);
        if (options.length > 0) {
          suggestions.push({
            incidentId: incident.id,
            itemKind: "accessory",
            accessoryId: accessorySuggestion.accessoryId,
            name: accessorySuggestion.name,
            options,
          });
        }
      }
    }
    return suggestions;
  }

  /**
   * Đếm số chiếc còn thuê được cho từng mẫu phụ kiện trong đúng khoảng ngày thuê.
   *
   * Một truy vấn asset + một truy vấn hold dùng chung cho MỌI gợi ý, thay vì gọi
   * `assertAccessoryAssetScheduleAvailable` từng chiếc (N+1). Quy tắc trùng lịch
   * giống hệt hàm assert: buffer giặt, đơn quá hạn chưa trả, hold của yêu cầu đổi.
   */
  private async countAvailableAccessoryAssets(
    accessoryIds: string[],
    bookingId: string,
    startDay: Date,
    endDay: Date,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>(accessoryIds.map((id) => [id, 0]));
    if (accessoryIds.length === 0) return counts;

    const bufferDays = await this.laundryBufferDays();
    const { endDay: normalizedEndDay } = parseRentalDateRange(startDay, endDay);
    const today = vietnamToday();
    const requestEndWithBuffer = new Date(+normalizedEndDay + bufferDays * DAY_MS);
    const [assets, holds] = await Promise.all([
      this.prisma.accessory_assets.findMany({
        where: { accessory_id: { in: accessoryIds }, status: { in: RENTABLE_ASSET_STATUSES } },
        select: {
          id: true,
          accessory_id: true,
          booking_accessory_items: {
            select: {
              id: true,
              bookingId: true,
              booking: { select: { id: true, status: true, rentalStartDate: true, rentalEndDate: true } },
            },
          },
        },
      }),
      loadActiveHolds(this.prisma, {
        from: new Date(+startDay - bufferDays * DAY_MS),
        to: requestEndWithBuffer,
        excludeBookingId: bookingId,
      }),
    ]);
    const holdAssetIds = new Set(
      holds.map((hold) => hold.accessoryAssetId).filter((id): id is string => Boolean(id)),
    );

    for (const asset of assets) {
      if (holdAssetIds.has(asset.id)) continue;
      const busy = asset.booking_accessory_items.some((item) => {
        // Chiếc đang nằm trong CHÍNH đơn này vẫn thuê tiếp được: khách có thể
        // giữ dòng phụ kiện hiện tại hoặc bỏ dòng để tái dùng chiếc đó cho mẫu
        // mới. (Trước đây coi là bận nên phụ kiện còn đủ vẫn hiện "hết".)
        if (item.bookingId === bookingId) return false;
        if (INVENTORY_RELEASED_STATUSES.includes(item.booking.status)) return false;
        if (isUnreturnedOverdue(item.booking, today)) return true;
        const bookingEndWithBuffer = new Date(+item.booking.rentalEndDate + bufferDays * DAY_MS);
        return item.booking.rentalStartDate <= requestEndWithBuffer && bookingEndWithBuffer >= startDay;
      });
      if (busy) continue;
      counts.set(asset.accessory_id, (counts.get(asset.accessory_id) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Yêu cầu có giữ chỗ asset vật lý hay không. Bỏ món (chỉ remove) không cần
   * giữ chỗ: asset cũ đang thuộc chính đơn này. `selection` đọc từ DB nên dùng
   * được cho cả yêu cầu đã tạo trước khi có cờ này.
   */
  private selectionRequiresHold(selection: unknown): boolean {
    const row = (selection ?? {}) as Record<string, unknown>;
    const count = (key: string) => (Array.isArray(row[key]) ? (row[key] as unknown[]).length : 0);
    return count("replacements") + count("addAccessories") + count("accessoryReplacements") > 0;
  }

  private serializeQuote(
    request: {
      id: string;
      status: string;
      type?: string;
      source?: string | null;
      holdExpiresAt: Date;
      rentBefore: Prisma.Decimal;
      depositBefore: Prisma.Decimal;
      discountBefore: Prisma.Decimal;
    },
    quote: ReturnType<typeof quoteChange>,
    isPaid: boolean,
    requiresHold = true,
    afterItems: RentedItemSummary[] = [],
    /** Bỏ hết trang phục → áp dụng xong đơn sẽ bị huỷ. */
    cancelled = false,
  ) {
    return {
      requestId: request.id,
      status: request.status,
      type: request.type,
      source: request.source,
      /**
       * Email thông báo bỏ món giờ gửi ĐÚNG LÚC xác nhận (không còn bước gửi
       * trước), nên khách luôn xác nhận được ngay.
       */
      removalEmailSent: true,
      cancelled,
      rentBefore: Number(request.rentBefore),
      rentAfter: quote.newRentalTotal,
      rentComponent: quote.rentComponent,
      accessoryDelta: quote.accessoryDelta,
      depositBefore: Number(request.depositBefore),
      depositAfter: quote.newDepositTotal,
      depositDelta: quote.depositDelta,
      discountBefore: Number(request.discountBefore),
      discountAfter: quote.newDiscount,
      chargeNow: quote.chargeAmount,
      // Đơn chưa thanh toán: không có gì để "ghi nhận hoàn khi trả đồ" ⇒ credit = 0.
      accruedCredit: isPaid ? quote.creditAmount : 0,
      lines: quote.lines,
      paymentRequired: quote.chargeAmount > 0,
      requiresHold,
      holdExpiresAt: request.holdExpiresAt,
      countdownSeconds: this.countdown(request.holdExpiresAt),
      afterItems,
    };
  }

  /**
   * Danh sách món được thuê SAU thay đổi — để panel báo giá cho khách thấy ngay
   * đơn sẽ gồm những gì (trang phục thay thế + phụ kiện giữ/thêm với số lượng).
   */
  private buildAfterItems(input: {
    booking: BookingRow;
    replaced: ReplacedGarment[];
    removeGarmentIds: Set<string>;
    addedAccessories: AddedAccessory[];
    removeAccessoryIds: Set<string>;
    accessoryReplacements: ReplacedAccessory[];
    /** Tiền thuê đã phân bổ cho từng dòng áo trước thay đổi (dòng giữ nguyên). */
    allocationByItem: Map<string, number>;
  }): RentedItemSummary[] {
    const replacedByItemId = new Map(input.replaced.map((row) => [row.itemId, row]));
    const replacementByAccessoryItemId = new Map(
      input.accessoryReplacements.map((row) => [row.accessoryItemId, row]),
    );
    const addUnits = new Map<string, AddedAccessory>();
    const addCounts = new Map<string, number>();
    for (const row of input.addedAccessories) {
      if (!addUnits.has(row.accessoryId)) addUnits.set(row.accessoryId, row);
      addCounts.set(row.accessoryId, (addCounts.get(row.accessoryId) ?? 0) + 1);
    }

    const items: RentedItemSummary[] = [];
    for (const item of input.booking.items) {
      if (input.removeGarmentIds.has(item.id)) continue;
      const replacement = replacedByItemId.get(item.id);
      if (replacement) {
        items.push({
          id: item.id,
          kind: "garment",
          name: replacement.name || item.garment_sizes?.garments?.name || "Trang phục",
          imageUrl: replacement.imageUrl ?? null,
          sizeLabel: replacement.sizeLabel ?? null,
          quantity: 1,
          lineTotal: replacement.newLine,
          isIncluded: false,
        });
      } else {
        items.push({
          id: item.id,
          kind: "garment",
          name: item.garment_sizes?.garments?.name ?? "Trang phục",
          imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
          sizeLabel: item.garment_sizes?.size_label ?? null,
          quantity: 1,
          lineTotal: input.allocationByItem.get(item.id) ?? 0,
          isIncluded: false,
        });
      }
    }

    // Gộp phụ kiện theo mẫu (giữ dòng + đổi mẫu + thêm mới) thành 1 dòng mỗi mẫu
    // để khớp những gì khách thấy trên checklist.
    const accessorySummaries = new Map<string, RentedItemSummary>();
    const bump = (row: {
      accessoryId: string;
      name: string;
      imageUrl: string | null;
      quantity: number;
      lineTotal: number;
      isIncluded: boolean;
    }) => {
      const existing = accessorySummaries.get(row.accessoryId);
      if (existing) {
        existing.quantity += row.quantity;
        existing.lineTotal += row.lineTotal;
        return;
      }
      accessorySummaries.set(row.accessoryId, {
        id: `acc-${row.accessoryId}`,
        kind: "accessory",
        name: row.name,
        imageUrl: row.imageUrl,
        sizeLabel: null,
        quantity: row.quantity,
        lineTotal: row.lineTotal,
        isIncluded: row.isIncluded,
      });
    };

    for (const row of input.booking.accessoryItems) {
      if (input.removeAccessoryIds.has(row.id)) continue;
      const replacement = replacementByAccessoryItemId.get(row.id);
      if (replacement) {
        bump({
          accessoryId: replacement.accessoryId,
          name: replacement.name,
          imageUrl: row.accessory?.image_url ?? null,
          quantity: Math.max(1, row.quantity ?? 1),
          lineTotal: replacement.lineTotal,
          isIncluded: replacement.isIncluded,
        });
        continue;
      }
      bump({
        accessoryId: row.accessoryId,
        name: row.accessory?.name ?? "Phụ kiện",
        imageUrl: row.accessory?.image_url ?? null,
        quantity: Math.max(1, row.quantity ?? 1),
        lineTotal: Number(row.rentalTotal),
        isIncluded: row.isIncluded,
      });
    }
    for (const [accessoryId, count] of addCounts) {
      const unit = addUnits.get(accessoryId);
      if (!unit) continue;
      bump({
        accessoryId,
        name: unit.name,
        imageUrl: unit.imageUrl,
        quantity: count,
        lineTotal: unit.lineTotal * count,
        isIncluded: unit.unitPrice === 0,
      });
    }

    return [...items, ...accessorySummaries.values()];
  }
}
