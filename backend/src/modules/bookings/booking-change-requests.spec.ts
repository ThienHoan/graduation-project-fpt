import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BookingChangeRequestsService } from "./booking-change-requests.service";
import type { AuthenticatedUser } from "../auth/auth-user";

const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const ASSET_ID = "00000000-0000-4000-8000-000000000006";
const NEW_SIZE_ID = "00000000-0000-4000-8000-000000000007";
const NEW_ASSET_ID = "00000000-0000-4000-8000-000000000008";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000f1";
const INCIDENT_ID = "00000000-0000-4000-8000-0000000000f2";
const ACCESSORY_ITEM_ID = "00000000-0000-4000-8000-0000000000b1";
const ACCESSORY_ITEM_ID_2 = "00000000-0000-4000-8000-0000000000b6";
const ACCESSORY_ID = "00000000-0000-4000-8000-0000000000b2";
const ACCESSORY_ASSET_OLD = "00000000-0000-4000-8000-0000000000b3";
const ACCESSORY_ASSET_NEW = "00000000-0000-4000-8000-0000000000b4";
const ACCESSORY_INCIDENT_ID = "00000000-0000-4000-8000-0000000000b5";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const customer = { id: CUSTOMER_ID, role: "customer" } as AuthenticatedUser;
const manager = { id: "staff-1", role: "manager_owner" } as unknown as AuthenticatedUser;

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: "paid",
    rentalStartDate: day("2026-11-11"),
    rentalEndDate: day("2026-11-12"),
    subtotal: new Prisma.Decimal(400_000),
    discountTotal: new Prisma.Decimal(0),
    rentalTotal: new Prisma.Decimal(400_000),
    depositTotal: new Prisma.Decimal(400_000),
    items: [
      {
        id: ITEM_ID,
        garmentId: "garment-1",
        garmentAssetId: ASSET_ID,
        garment_size_id: "size-1",
        dailyPrice: new Prisma.Decimal(400_000),
        depositAmount: new Prisma.Decimal(400_000),
        garment_sizes: { size_label: "M", garments: { name: "Áo A" } },
      },
    ],
    accessoryItems: [],
    payments: [],
    refunds: [],
    ...overrides,
  };
}

function garmentIncident() {
  return {
    id: INCIDENT_ID,
    itemKind: "garment",
    bookingItemId: ITEM_ID,
    bookingAccessoryItemId: null,
    reason: "asset_damaged",
    status: "awaiting_customer",
    dedupeKey: `g:${ITEM_ID}`,
  };
}

function accessoryIncident() {
  return {
    id: ACCESSORY_INCIDENT_ID,
    itemKind: "accessory",
    bookingItemId: null,
    bookingAccessoryItemId: ACCESSORY_ITEM_ID,
    reason: "accessory_unavailable",
    status: "awaiting_customer",
    dedupeKey: `a:${ACCESSORY_ITEM_ID}`,
    snapshot: { name: "Quạt giấy" },
  };
}

function makeAccessoryBooking(overrides: Record<string, unknown> = {}) {
  return makeBooking({
    accessoryItems: [
      {
        id: ACCESSORY_ITEM_ID,
        accessoryId: ACCESSORY_ID,
        accessoryAssetId: ACCESSORY_ASSET_OLD,
        quantity: 1,
        unitPrice: new Prisma.Decimal(50_000),
        rentalTotal: new Prisma.Decimal(50_000),
      },
    ],
    ...overrides,
  });
}

function createHarness(options: {
  booking?: Record<string, unknown> | null;
  pendingRequest?: Record<string, unknown> | null;
  pendingExtension?: Record<string, unknown> | null;
  paid?: boolean;
  sizes?: Array<Record<string, unknown>>;
  garmentAssets?: Array<Record<string, unknown>>;
  accessoryAssets?: Array<Record<string, unknown>>;
  accessoryLinks?: Array<Record<string, unknown>>;
  applyRequest?: Record<string, unknown> | null;
  awaitingPaymentRequest?: Record<string, unknown> | null;
  dueChangeRequests?: Array<Record<string, unknown>>;
  changeHolds?: Array<Record<string, unknown>>;
  qrIntent?: boolean;
  incidents?: Array<Record<string, unknown>>;
  /** Danh mục của mẫu gốc để tìm mẫu tương tự. */
  garmentTarget?: Record<string, unknown> | null;
  /** Mẫu tương tự trả từ `garment.findMany` (kèm `garment_sizes`). */
  similarGarments?: Array<Record<string, unknown>>;
  /** Liên kết `garment_accessories` trả từ `findMany` (gợi ý phụ kiện khác mẫu). */
  garmentAccessoryLinks?: Array<Record<string, unknown>>;
  /** Payment đã thu của đơn (tính tiền hoàn dự kiến khi bỏ hết món). */
  paidPayments?: Array<Record<string, unknown>>;
  /** Refund đang/đã xử lý của đơn (trừ khỏi tiền hoàn dự kiến). */
  refunds?: Array<Record<string, unknown>>;
} = {}) {
  const booking = options.booking === undefined ? makeBooking() : options.booking;
  const pendingRequest = options.pendingRequest ?? null;
  const pendingExtension = options.pendingExtension ?? null;
  const created: Array<Record<string, unknown>> = [];
  const holds: Array<Record<string, unknown>> = [];
  const adjustments: Array<Record<string, unknown>> = [];
  const itemUpdates: Array<Record<string, unknown>> = [];
  const sizes = options.sizes ?? [];
  const garmentAssets = options.garmentAssets ?? [];
  const accessoryAssets = options.accessoryAssets ?? [];
  const accessoryLinks = options.accessoryLinks ?? [];
  const changeHolds = options.changeHolds ?? [];

  const prisma = {
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    runSerializable: vi.fn(),
    bookingIncident: {
      findMany: vi.fn().mockResolvedValue(options.incidents ?? [garmentIncident()]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingStatusHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    bookingAdjustment: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        adjustments.push(data);
        return data;
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    voucher_usages: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingChangeRequest: {
      findFirst: vi.fn().mockImplementation(async (args: { where?: Record<string, unknown> }) => {
        if (args?.where && "id" in args.where) return options.applyRequest ?? pendingRequest;
        if (args?.where && "paymentId" in args.where) return options.awaitingPaymentRequest ?? null;
        return pendingRequest;
      }),
      findMany: vi.fn().mockResolvedValue(options.dueChangeRequests ?? []),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          id: REQUEST_ID,
          status: "quoted",
          holdExpiresAt: data.holdExpiresAt,
          rentBefore: data.rentBefore,
          depositBefore: data.depositBefore,
          discountBefore: data.discountBefore,
          checkoutUrl: null,
          selection: data.selection,
        };
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingExtension: {
      findFirst: vi.fn().mockResolvedValue(pendingExtension),
    },
    payment: {
      findMany: vi.fn().mockResolvedValue(options.paidPayments ?? []),
      findFirst: vi.fn().mockImplementation(async (args: { where?: Record<string, unknown> }) => {
        if (args?.where && args.where.status === "pending") {
          return options.qrIntent ? { id: "pay-qr-1" } : null;
        }
        return options.paid === false ? null : { id: "pay-1" };
      }),
      findUnique: vi.fn().mockResolvedValue({ status: "paid" }),
    },
    bookingChangeHold: {
      findMany: vi.fn().mockResolvedValue(changeHolds),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        holds.push(data);
        return data;
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingItem: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        itemUpdates.push(data);
        return data;
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingAccessoryItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    garmentAsset: {
      findMany: vi.fn().mockResolvedValue(garmentAssets),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        const match = garmentAssets.find((row) => row.id === where.id);
        return (
          match ?? { id: where.id, garmentId: "garment-1", garment_size_id: NEW_SIZE_ID, status: "available" }
        );
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    accessory_assets: {
      findMany: vi.fn().mockResolvedValue(accessoryAssets),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        const match = accessoryAssets.find((row) => row.id === where.id);
        return match ?? { id: where.id, accessory_id: "acc-1", status: "available" };
      }),
    },
    garment_accessories: {
      findFirst: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) =>
        accessoryLinks.find(
          (row) => row.garment_id === args.where.garment_id && row.accessory_id === args.where.accessory_id,
        ) ?? null,
      ),
      findMany: vi.fn().mockResolvedValue(options.garmentAccessoryLinks ?? []),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: BOOKING_ID }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    refund: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "refund-1", ...data })),
      findMany: vi.fn().mockResolvedValue(options.refunds ?? []),
    },
    financialTransaction: {
      create: vi.fn().mockResolvedValue({}),
    },
    garment_sizes: {
      findMany: vi.fn().mockResolvedValue(sizes),
    },
    garment: {
      findUnique: vi.fn().mockResolvedValue(options.garmentTarget ?? { categoryId: null }),
      findMany: vi.fn().mockResolvedValue(options.similarGarments ?? []),
    },
  };
  prisma.runSerializable.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));

  const pricing = options.sizes
    ? {
        quoteRental: vi.fn().mockImplementation(async (sizeIds: string[]) => {
          const map = new Map<string, { rentalTotal: number; basePrice: number; discountPrice: number }>();
          for (const id of sizeIds) {
            const size = sizes.find((row) => row.id === id);
            if (size) {
              const price = Number(size.daily_price ?? 0);
              map.set(id, { rentalTotal: price * 2, basePrice: price, discountPrice: price });
            }
          }
          return map;
        }),
      }
    : { quoteRental: vi.fn().mockResolvedValue(new Map()) };

  const vouchers = { releaseForBooking: vi.fn().mockResolvedValue(undefined) };
  const payments = {
    releaseClosedPayosIntents: vi.fn().mockImplementation(async () => {
      if (options.qrIntent) {
        // Mô phỏng PayOS đóng intent PENDING thành công (giống createPaymentLink).
        prisma.payment.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
          args?.where && args.where.status === "pending" ? null : options.paid === false ? null : { id: "pay-1" },
        );
      }
    }),
    createChangeRequestPaymentLink: vi.fn().mockResolvedValue({
      paymentId: "pay-charge",
      checkoutUrl: "https://pay.example/change-request",
    }),
  };
  const notifications = { notifyStaffBooking: vi.fn().mockResolvedValue({ data: { notified: 1 } }) };

  const service = new BookingChangeRequestsService(
    prisma as never,
    pricing as never,
    vouchers as never,
    payments as never,
    notifications as never,
  );
  return { service, prisma, pricing, vouchers, payments, notifications, created, holds, adjustments, itemUpdates };
}

beforeEach(() => vi.clearAllMocks());

describe("BookingChangeRequestsService — ownership", () => {
  it("khách không sở hữu đơn → 403 (kiểm tra riêng ngoài guard)", async () => {
    const { service } = createHarness({ booking: makeBooking({ customerId: "someone-else" }) });
    await expect(service.listIncidents(customer, BOOKING_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("manager không phải chủ đơn vẫn qua được ownership", async () => {
    const { service } = createHarness({ booking: makeBooking({ customerId: "someone-else" }) });
    await expect(service.listIncidents(manager, BOOKING_ID)).resolves.toBeDefined();
  });
});

describe("BookingChangeRequestsService.createChangeRequest — báo giá live (preview)", () => {
  it("preview: trả giá + danh sách món sau thay đổi, KHÔNG tạo yêu cầu/giữ chỗ", async () => {
    const { service, created, holds, prisma } = createHarness({
      sizes: [
        {
          id: NEW_SIZE_ID,
          garment_id: "garment-1",
          size_label: "L",
          daily_price: new Prisma.Decimal(500_000),
          deposit_amount: new Prisma.Decimal(600_000),
          is_active: true,
          garments: { name: "Áo Cổ Phục", images: [{ imageUrl: "https://cdn.example/ao.jpg" }] },
        },
      ],
      garmentAssets: [
        { id: NEW_ASSET_ID, assetCode: "A2", status: "available", garmentId: "garment-1", garment_size_id: NEW_SIZE_ID, bookingItems: [] },
      ],
    });

    const result = await service.createChangeRequest(
      customer,
      BOOKING_ID,
      {
        type: "replace",
        incidents: [INCIDENT_ID],
        replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }],
      },
      { preview: true },
    );

    const quote = result.data as Record<string, unknown>;
    expect(quote.preview).toBe(true);
    expect(quote.requiresHold).toBe(true);
    // Không tạo request, không giữ chỗ asset nào.
    expect(created).toHaveLength(0);
    expect(holds).toHaveLength(0);
    expect(prisma.bookingChangeRequest.create).not.toHaveBeenCalled();
    // Danh sách món sau thay đổi có mẫu mới (tên/size lấy từ DB).
    const afterItems = quote.afterItems as Array<Record<string, unknown>>;
    expect(afterItems.some((row) => row.kind === "garment" && row.sizeLabel === "L")).toBe(true);
  });
});

describe("BookingChangeRequestsService.createChangeRequest — chặn", () => {
  it("đơn đang có yêu cầu chờ xử lý → 409", async () => {
    const { service } = createHarness({ pendingRequest: { id: REQUEST_ID } });
    await expect(
      service.createChangeRequest(customer, BOOKING_ID, { type: "remove", incidents: [INCIDENT_ID] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("đơn đang có gia hạn pending → 409", async () => {
    const { service } = createHarness({ pendingExtension: { id: "ext-1" } });
    await expect(
      service.createChangeRequest(customer, BOOKING_ID, { type: "remove", incidents: [INCIDENT_ID] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("không chọn sự cố → 400", async () => {
    const { service } = createHarness();
    await expect(
      service.createChangeRequest(customer, BOOKING_ID, { type: "remove", incidents: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("đơn đã bàn giao → 400", async () => {
    const { service } = createHarness({ booking: makeBooking({ status: "renting" }) });
    await expect(
      service.createChangeRequest(customer, BOOKING_ID, { type: "remove", incidents: [INCIDENT_ID] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("BookingChangeRequestsService.createChangeRequest — báo giá + giữ chỗ", () => {
  it("bỏ món áo: ghi quote đúng §6 và tạo hold cho asset cụ thể", async () => {
    const { service, created, holds } = createHarness();
    const result = await service.createChangeRequest(customer, BOOKING_ID, {
      type: "remove",
      incidents: [INCIDENT_ID],
    });

    expect(created).toHaveLength(1);
    const request = created[0] as Record<string, unknown>;
    expect(request.status).toBe("quoted");
    expect(Number(request.chargeAmount)).toBe(0);
    expect(Number(request.rentAfter)).toBe(0);
    expect(Number(request.depositAfter)).toBe(0);

    const payload = result.data as Record<string, unknown>;
    expect(payload.chargeNow).toBe(0);
    expect(payload.accruedCredit).toBe(800_000);
    expect(payload.rentBefore).toBe(400_000);
    expect(payload.rentAfter).toBe(0);
    // Bỏ món KHÔNG giữ chỗ → FE không đếm ngược, chỉ xem báo giá rồi xác nhận.
    expect(payload.requiresHold).toBe(false);

    // Món bị bỏ KHÔNG tạo hold: asset cũ đang thuộc chính đơn này, không cạnh tranh.
    expect(holds).toHaveLength(0);
  });

  it("đơn CHƯA thanh toán: accruedCredit = 0 (không có gì để ghi nhận hoàn)", async () => {
    const { service } = createHarness({ paid: false });
    const result = await service.createChangeRequest(customer, BOOKING_ID, {
      type: "remove",
      incidents: [INCIDENT_ID],
    });
    const payload = result.data as Record<string, unknown>;
    expect(payload.chargeNow).toBe(0);
    expect(payload.accruedCredit).toBe(0);
  });

  it("đổi mẫu: giá mới từ quoteRental, chọn asset mới + hold, giữ phụ kiện", async () => {
    const { service, created, holds } = createHarness({
      sizes: [
        {
          id: NEW_SIZE_ID,
          garment_id: "garment-1",
          daily_price: new Prisma.Decimal(500_000),
          deposit_amount: new Prisma.Decimal(600_000),
          is_active: true,
        },
      ],
      garmentAssets: [
        { id: NEW_ASSET_ID, assetCode: "A2", status: "available", garmentId: "garment-1", garment_size_id: NEW_SIZE_ID, bookingItems: [] },
      ],
    });

    const result = await service.createChangeRequest(customer, BOOKING_ID, {
      type: "replace",
      incidents: [INCIDENT_ID],
      replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }],
    });

    expect(created).toHaveLength(1);
    const request = created[0] as Record<string, unknown>;
    // 500k×2 ngày = 1.000k; cọc 600k. charge = (1000-400) thuê + (600-400) cọc = 800k.
    expect(Number(request.chargeAmount)).toBe(800_000);
    const selection = request.selection as { replacements: Array<Record<string, unknown>> };
    expect(selection.replacements[0]).toMatchObject({
      incidentId: INCIDENT_ID,
      sizeId: NEW_SIZE_ID,
      garmentAssetId: NEW_ASSET_ID,
      newLine: 1_000_000,
      newDeposit: 600_000,
    });

    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ kind: "garment", garmentAssetId: NEW_ASSET_ID });

    const payload = result.data as Record<string, unknown>;
    expect(payload.chargeNow).toBe(800_000);
    expect(payload.rentAfter).toBe(1_000_000);
    expect(payload.depositAfter).toBe(600_000);
    // Đổi mẫu phải giữ chỗ asset mới → FE hiện đếm ngược.
    expect(payload.requiresHold).toBe(true);
  });

  it("thêm phụ kiện được tái dùng chiếc của dòng sắp bỏ trong cùng yêu cầu", async () => {
    const removedItemId = "00000000-0000-4000-8000-0000000000b9";
    const { service, prisma, created, holds } = createHarness({
      booking: makeBooking({
        accessoryItems: [
          {
            id: removedItemId,
            bookingItemId: ITEM_ID,
            accessoryId: ACCESSORY_ID,
            accessoryAssetId: ACCESSORY_ASSET_OLD,
            quantity: 1,
            unitPrice: new Prisma.Decimal(0),
            isIncluded: true,
            rentalTotal: new Prisma.Decimal(0),
          },
        ],
      }),
      sizes: [
        {
          id: NEW_SIZE_ID,
          garment_id: "garment-1",
          daily_price: new Prisma.Decimal(500_000),
          deposit_amount: new Prisma.Decimal(600_000),
          is_active: true,
        },
      ],
      garmentAssets: [
        { id: NEW_ASSET_ID, assetCode: "A2", status: "available", garmentId: "garment-1", garment_size_id: NEW_SIZE_ID, bookingItems: [] },
      ],
      accessoryLinks: [
        {
          garment_id: "garment-1",
          accessory_id: ACCESSORY_ID,
          is_included: true,
          extra_price: new Prisma.Decimal(0),
          accessories: { name: "Kiềng cổ" },
        },
      ],
      accessoryAssets: [
        {
          id: ACCESSORY_ASSET_OLD,
          accessory_id: ACCESSORY_ID,
          status: "available",
          asset_code: "PK-1",
          booking_accessory_items: [
            {
              id: removedItemId,
              bookingId: BOOKING_ID,
              booking: {
                id: BOOKING_ID,
                status: "paid",
                rentalStartDate: day("2026-11-11"),
                rentalEndDate: day("2026-11-12"),
              },
            },
          ],
        },
      ],
    });
    // Dòng bị bỏ vẫn còn assignment trong DB tại thời điểm chọn chiếc.
    prisma.bookingAccessoryItem.findMany.mockResolvedValue([
      {
        id: removedItemId,
        bookingId: BOOKING_ID,
        booking: {
          id: BOOKING_ID,
          status: "paid",
          rentalStartDate: day("2026-11-11"),
          rentalEndDate: day("2026-11-12"),
        },
      },
    ]);

    await service.createChangeRequest(customer, BOOKING_ID, {
      type: "replace",
      incidents: [INCIDENT_ID],
      replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }],
      removeAccessoryItemIds: [removedItemId],
      addAccessories: [{ itemId: ITEM_ID, accessoryId: ACCESSORY_ID, quantity: 1 }],
    });

    const selection = (created[0] as Record<string, unknown>).selection as {
      addAccessories: Array<Record<string, unknown>>;
    };
    expect(selection.addAccessories[0]).toMatchObject({
      accessoryId: ACCESSORY_ID,
      accessoryAssetId: ACCESSORY_ASSET_OLD,
    });
    expect(holds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "accessory", accessoryAssetId: ACCESSORY_ASSET_OLD }),
      ]),
    );
  });

  it("thêm phụ kiện vượt số mẫu cửa hàng cho thuê → 400", async () => {
    const { service } = createHarness({
      sizes: [
        {
          id: NEW_SIZE_ID,
          garment_id: "garment-1",
          daily_price: new Prisma.Decimal(500_000),
          deposit_amount: new Prisma.Decimal(600_000),
          is_active: true,
        },
      ],
      garmentAssets: [
        { id: NEW_ASSET_ID, assetCode: "A2", status: "available", garmentId: "garment-1", garment_size_id: NEW_SIZE_ID, bookingItems: [] },
      ],
      accessoryLinks: [
        {
          garment_id: "garment-1",
          accessory_id: "acc-2",
          is_included: true,
          extra_price: new Prisma.Decimal(0),
          quantity: 1,
          accessories: { name: "Quạt lụa" },
        },
      ],
      accessoryAssets: [
        { id: ACCESSORY_ASSET_NEW, accessory_id: "acc-2", status: "available", asset_code: "PK-2", booking_accessory_items: [] },
      ],
    });

    await expect(
      service.createChangeRequest(customer, BOOKING_ID, {
        type: "replace",
        incidents: [INCIDENT_ID],
        replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }],
        addAccessories: [
          { itemId: ITEM_ID, accessoryId: "acc-2", quantity: 1 },
          { itemId: ITEM_ID, accessoryId: "acc-2", quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("đổi mẫu mà hết hàng (không asset hợp lệ) → 409", async () => {
    const { service } = createHarness({
      sizes: [
        {
          id: NEW_SIZE_ID,
          garment_id: "garment-1",
          daily_price: new Prisma.Decimal(500_000),
          deposit_amount: new Prisma.Decimal(600_000),
          is_active: true,
        },
      ],
      garmentAssets: [],
    });

    await expect(
      service.createChangeRequest(customer, BOOKING_ID, {
        type: "replace",
        incidents: [INCIDENT_ID],
        replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("đổi mẫu thiếu mẫu thay thế → 400", async () => {
    const { service } = createHarness();
    await expect(
      service.createChangeRequest(customer, BOOKING_ID, {
        type: "replace",
        incidents: [INCIDENT_ID],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("khóa advisory theo nhóm size được gọi TRƯỚC khi tạo hold và theo thứ tự key", async () => {
    const { service, prisma } = createHarness({
      sizes: [
        {
          id: NEW_SIZE_ID,
          garment_id: "garment-1",
          daily_price: new Prisma.Decimal(500_000),
          deposit_amount: new Prisma.Decimal(600_000),
          is_active: true,
        },
      ],
      garmentAssets: [
        { id: NEW_ASSET_ID, assetCode: "A2", status: "available", garmentId: "garment-1", garment_size_id: NEW_SIZE_ID, bookingItems: [] },
      ],
    });

    await service.createChangeRequest(customer, BOOKING_ID, {
      type: "replace",
      incidents: [INCIDENT_ID],
      replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }],
    });

    const lockCalls = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(lockCalls).toHaveLength(1);
    // Câu lệnh tham số hóa, không ghép chuỗi key vào SQL.
    expect(lockCalls[0][0]).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");
    expect(lockCalls[0][1]).toBe(`change-hold:size:${NEW_SIZE_ID}`);

    // Lock phải chạy trước khi tạo hold.
    const lockOrder = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const holdCreate = prisma.bookingChangeHold.create as ReturnType<typeof vi.fn>;
    const holdOrder = holdCreate.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(holdOrder);
  });
});

/** Request đã báo giá sẵn để test áp dụng (replace 1 dòng áo, đơn đã thanh toán, charge = 0). */
function applyRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    status: "quoted",
    type: "replace",
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    selection: {
      removeAccessoryItemIds: [],
      incidentIds: [INCIDENT_ID],
      replacedIncidentIds: [INCIDENT_ID],
      replacements: [
        {
          incidentId: INCIDENT_ID,
          itemId: ITEM_ID,
          sizeId: NEW_SIZE_ID,
          garmentId: "garment-1",
          garmentAssetId: NEW_ASSET_ID,
          newLine: 800_000,
          newDeposit: 400_000,
          basePrice: 450_000,
          discountPrice: 400_000,
        },
      ],
      addAccessories: [],
    },
    beforeSnapshot: {
      rentalTotal: 400_000,
      depositTotal: 400_000,
      discountTotal: 0,
      items: [],
      accessoryItems: [],
    },
    afterSnapshot: {
      newSubtotal: 800_000,
      newDiscount: 0,
      newRentalTotal: 800_000,
      newDepositTotal: 400_000,
      rentComponent: 0,
      accessoryDelta: 0,
      depositDelta: 0,
      chargeAmount: 0,
      creditAmount: 0,
      adjustmentLines: [],
      wasPaid: true,
      allRemoved: false,
      replacedGarmentItemIds: [ITEM_ID],
      removedGarmentItemIds: [],
      removedAccessoryItemIds: [],
      addedAccessoryItemIds: [],
    },
    ...overrides,
  };
}

describe("BookingChangeRequestsService.confirmChangeRequest — áp dụng (§7.3, §8.1)", () => {
  it("§10 #3: consume hold + gán asset mới cùng tx, incident resolved, request applied", async () => {
    const { service, prisma } = createHarness({ applyRequest: applyRequest() });
    const result = await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(prisma.bookingChangeHold.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ changeRequestId: REQUEST_ID, consumedAt: null }),
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.bookingItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: expect.objectContaining({
          garmentAssetId: NEW_ASSET_ID,
          garment_size_id: NEW_SIZE_ID,
          // Giá/ngày theo mẫu mới cũng được ghi để trang chi tiết/biên nhận hiện giá MỚI.
          dailyPrice: new Prisma.Decimal(400_000),
          basePrice: new Prisma.Decimal(450_000),
          discountPrice: new Prisma.Decimal(400_000),
        }),
      }),
    );
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "resolved", resolution: "replaced" }) }),
    );
    expect(prisma.bookingChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "applied" }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect((result.data as Record<string, unknown>).status).toBe("applied");
  });

  it("đơn đã sẵn sàng giao: asset thay thế được giữ chỗ (reserved) ngay khi áp dụng", async () => {
    const { service, prisma } = createHarness({
      booking: makeBooking({ status: "ready_for_pickup" }),
      applyRequest: applyRequest(),
    });

    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(prisma.garmentAsset.updateMany).toHaveBeenCalledWith({
      where: { id: NEW_ASSET_ID, status: "available" },
      data: { status: "reserved" },
    });
  });

  it("đơn đã sẵn sàng giao: asset cũ bị thay được nhả về available trước khi gán asset mới", async () => {
    const { service, prisma } = createHarness({
      booking: makeBooking({ status: "ready_for_pickup" }),
      applyRequest: applyRequest(),
      garmentAssets: [
        { id: ASSET_ID, status: "reserved", garmentId: "garment-1", garment_size_id: "size-1" },
        { id: NEW_ASSET_ID, status: "available", garmentId: "garment-1", garment_size_id: NEW_SIZE_ID },
      ],
    });
    (prisma.bookingItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: ITEM_ID,
        bookingId: BOOKING_ID,
        garmentAssetId: ASSET_ID,
        booking: {
          id: BOOKING_ID,
          status: "ready_for_pickup",
          rentalStartDate: day("2026-11-11"),
          rentalEndDate: day("2026-11-12"),
        },
      },
    ]);

    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(prisma.garmentAsset.updateMany).toHaveBeenCalledWith({
      where: { id: ASSET_ID, status: "reserved" },
      data: { status: "available" },
    });
    expect(prisma.garmentAsset.updateMany).toHaveBeenCalledWith({
      where: { id: NEW_ASSET_ID, status: "available" },
      data: { status: "reserved" },
    });
  });

  it("đơn chưa sang bước giữ đồ (paid): không đổi trạng thái asset", async () => {
    const { service, prisma } = createHarness({ applyRequest: applyRequest() });

    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(prisma.garmentAsset.updateMany).not.toHaveBeenCalled();
  });

  it("đơn CHƯA thanh toán: KHÔNG ghi booking_adjustments", async () => {
    const { service, adjustments } = createHarness({
      paid: false,
      applyRequest: applyRequest({
        afterSnapshot: { ...applyRequest().afterSnapshot, wasPaid: false, chargeAmount: 0 },
      }),
    });
    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);
    expect(adjustments).toHaveLength(0);
  });

  it("đơn ĐÃ thanh toán: ghi đúng dòng credit (accrued)", async () => {
    const { service, adjustments } = createHarness({
      applyRequest: applyRequest({
        afterSnapshot: {
          ...applyRequest().afterSnapshot,
          wasPaid: true,
          chargeAmount: 0,
          creditAmount: 200_000,
          adjustmentLines: [{ component: "rent", direction: "credit", amount: 200_000 }],
        },
      }),
    });
    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ component: "rent", direction: "credit", status: "accrued" });
    expect(Number((adjustments[0] as { amount: { toString(): string } }).amount)).toBe(200_000);
  });

  it("quản lý/admin KHÔNG được xác nhận thay khách → 403", async () => {
    const { service } = createHarness();
    const manager = { id: "manager-1", role: "manager_owner" } as AuthenticatedUser;
    const admin = { id: "admin-1", role: "admin" } as AuthenticatedUser;

    await expect(service.confirmChangeRequest(manager, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.confirmChangeRequest(admin, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("đơn đang coi là chưa thanh toán mà đã có Payment paid → 409", async () => {
    const { service } = createHarness({
      paid: true,
      applyRequest: applyRequest({
        afterSnapshot: { ...applyRequest().afterSnapshot, wasPaid: false },
      }),
    });
    await expect(service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("đơn đã thanh toán còn phần chênh → tạo PayOS link, request awaiting_payment (không áp dụng ngay)", async () => {
    const { service, prisma, payments } = createHarness({
      applyRequest: applyRequest({
        afterSnapshot: { ...applyRequest().afterSnapshot, wasPaid: true, chargeAmount: 100_000, depositDelta: 50_000 },
      }),
    });

    const result = await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    // PayOS được gọi NGOÀI transaction áp dụng; đúng số tiền + phần cọc thu thêm.
    expect(payments.createChangeRequestPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        requestId: REQUEST_ID,
        amount: 100_000,
        depositAmount: 50_000,
      }),
    );
    expect(prisma.bookingChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REQUEST_ID },
        data: expect.objectContaining({
          status: "awaiting_payment",
          paymentId: "pay-charge",
          checkoutUrl: "https://pay.example/change-request",
        }),
      }),
    );
    // Chưa áp dụng: không gán asset, không consume hold, không ghi adjustment.
    expect(prisma.bookingItem.update).not.toHaveBeenCalled();
    expect(prisma.bookingAccessoryItem.create).not.toHaveBeenCalled();
    expect((result.data as Record<string, unknown>).status).toBe("awaiting_payment");
    expect((result.data as Record<string, unknown>).paymentRequired).toBe(true);
    expect((result.data as Record<string, unknown>).checkoutUrl).toBe("https://pay.example/change-request");
  });

  it("bỏ hết món → hủy đơn qua cancelBookingTx: void credit trước, ghi refund, không tạo adjustment mới", async () => {
    const { service, prisma, adjustments } = createHarness({
      booking: makeBooking({
        payments: [{ id: "p1", amount: new Prisma.Decimal(1_000_000), status: "paid", paymentMethod: "cash" }],
      }),
      applyRequest: applyRequest({
        type: "remove",
        selection: {
          removeAccessoryItemIds: [],
          incidentIds: [INCIDENT_ID],
          replacedIncidentIds: [],
          replacements: [],
          addAccessories: [],
        },
        afterSnapshot: {
          ...applyRequest().afterSnapshot,
          wasPaid: true,
          chargeAmount: 0,
          allRemoved: true,
          newRentalTotal: 0,
          newDepositTotal: 0,
          // Có credit cũ đang treo + request này cũng có 1 dòng credit → đều bị void.
          creditAmount: 0,
          adjustmentLines: [{ component: "rent", direction: "credit", amount: 200_000 }],
        },
      }),
    });
    const result = await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    // Bỏ hết món: KHÔNG ghi adjustment mới cho request này.
    expect(adjustments).toHaveLength(0);
    // Void credit accrued/pending_payment TRƯỚC khi hoàn (§8.3).
    expect(prisma.bookingAdjustment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID, status: { in: ["accrued", "pending_payment"] } },
      data: { status: "void", note: "void do hủy đơn" },
    });
    // Hoàn = toàn bộ tiền đã thu (payments), KHÔNG cộng credit.
    expect(prisma.refund.create).toHaveBeenCalled();
    const refundArg = (prisma.refund.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: { amount: unknown };
    };
    // Hoàn = toàn bộ tiền đã thu (1.000.000), KHÔNG cộng credit 200.000.
    expect(Number(refundArg.data.amount)).toBe(1_000_000);
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
    );
    // Hủy đơn → dọn sự cố đang mở qua cancelBookingTx (dùng chung mọi đường hủy).
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: BOOKING_ID, status: { in: ["open", "awaiting_customer", "needs_manager"] } },
        data: expect.objectContaining({ status: "resolved", resolution: "booking_cancelled" }),
      }),
    );
    expect((result.data as Record<string, unknown>).cancelled).toBe(true);
  });

  it("giữ chỗ đã hết hạn → 409", async () => {
    const { service } = createHarness({
      applyRequest: applyRequest({ holdExpiresAt: new Date(Date.now() - 60_000) }),
      changeHolds: [
        {
          id: "h1",
          changeRequestId: REQUEST_ID,
          kind: "garment",
          garmentAssetId: NEW_ASSET_ID,
          accessoryAssetId: null,
          expiresAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    await expect(service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("yêu cầu không còn ở bước quoted → 409", async () => {
    const { service } = createHarness({ applyRequest: applyRequest({ status: "applied" }) });
    await expect(service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("đơn chưa thanh toán có QR pending: đóng PayOS intent trước khi áp dụng", async () => {
    // Đơn chưa có Payment paid (paid:false) nhưng có 1 intent QR pending (qrIntent).
    const { service, prisma, payments } = createHarness({
      paid: false,
      qrIntent: true,
      applyRequest: applyRequest({
        afterSnapshot: { ...applyRequest().afterSnapshot, wasPaid: false, chargeAmount: 0 },
      }),
    });
    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    // Intent cũ được hủy/đóng TRƯỚC khi áp dụng (không áp dụng đè lên QR còn sống).
    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID);
    expect(prisma.bookingItem.update).toHaveBeenCalled();
    expect(prisma.bookingChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "applied" }) }),
    );
  });

  it("QR pending nhưng không đóng được intent (PayOS đang xử lý) → 409, không áp dụng", async () => {
    const { service, prisma, payments } = createHarness({
      paid: false,
      qrIntent: true,
      applyRequest: applyRequest({
        afterSnapshot: { ...applyRequest().afterSnapshot, wasPaid: false, chargeAmount: 0 },
      }),
    });
    payments.releaseClosedPayosIntents.mockRejectedValueOnce(
      new BadRequestException("Đơn hàng đang được PayOS ghi nhận thanh toán."),
    );

    await expect(service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.bookingItem.update).not.toHaveBeenCalled();
    expect(prisma.bookingChangeRequest.update).not.toHaveBeenCalled();
  });
});

describe("BookingChangeRequestsService.handlePaymentPaid — §7.3/§12", () => {
  function awaitingPaidRequest(overrides: Record<string, unknown> = {}) {
    return {
      ...applyRequest({ status: "awaiting_payment" }),
      bookingId: BOOKING_ID,
      createdBy: "user-1",
      paymentId: "pay-charge",
      afterSnapshot: {
        ...applyRequest().afterSnapshot,
        wasPaid: true,
        chargeAmount: 100_000,
        adjustmentLines: [{ component: "deposit", direction: "charge", amount: 100_000 }],
      },
      ...overrides,
    };
  }

  it("tiền về → áp dụng: charge thành `collected` + gắn paymentId, request applied", async () => {
    const { service, prisma, adjustments } = createHarness({
      awaitingPaymentRequest: awaitingPaidRequest(),
    });

    const result = await service.handlePaymentPaid("pay-charge");

    expect((result.data as Record<string, unknown>).status).toBe("applied");
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      component: "deposit",
      direction: "charge",
      status: "collected",
      paymentId: "pay-charge",
    });
    expect(prisma.bookingChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "applied" }) }),
    );
  });

  it("idempotent: request không còn awaiting_payment → no-op", async () => {
    const { service, prisma } = createHarness({ awaitingPaymentRequest: null });

    const result = await service.handlePaymentPaid("pay-charge");

    expect((result.data as Record<string, unknown>).applied).toBe(false);
    expect(prisma.runSerializable).not.toHaveBeenCalled();
  });

  it("hết hạn giữ chỗ + asset đã bị đơn khác lấy khi tiền về → needs_manager, KHÔNG tự hoàn", async () => {
    const { service, prisma, notifications } = createHarness({
      awaitingPaymentRequest: awaitingPaidRequest(),
      changeHolds: [
        {
          id: "h1",
          changeRequestId: REQUEST_ID,
          kind: "garment",
          garmentAssetId: NEW_ASSET_ID,
          accessoryAssetId: null,
          expiresAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    // Áp dụng muộn vẫn kiểm tra lại asset: asset không còn cho thuê.
    prisma.garmentAsset.findUnique.mockResolvedValueOnce({
      id: NEW_ASSET_ID,
      garmentId: "garment-1",
      garment_size_id: NEW_SIZE_ID,
      status: "maintenance",
    });

    const result = await service.handlePaymentPaid("pay-charge");

    expect((result.data as Record<string, unknown>).status).toBe("needs_manager");
    expect(prisma.bookingItem.update).not.toHaveBeenCalled();
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REQUEST_ID, status: { in: ["awaiting_payment"] } },
        data: { status: "needs_manager" },
      }),
    );
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "needs_manager" }) }),
    );
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(notifications.notifyStaffBooking).toHaveBeenCalledWith(
      expect.objectContaining({ templateKey: "booking.staff.incident_open" }),
    );
  });

  it("giữ chỗ đã hết hạn nhưng asset còn trống → áp dụng muộn (không đòi hỏi hold còn hạn)", async () => {
    const expiredHolds = [
      {
        id: "h1",
        changeRequestId: REQUEST_ID,
        kind: "garment",
        garmentAssetId: NEW_ASSET_ID,
        accessoryAssetId: null,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ];
    const { service, prisma } = createHarness({
      awaitingPaymentRequest: awaitingPaidRequest(),
      changeHolds: expiredHolds,
    });
    // Lần 1: applyChangeRequestTx đọc hold của request. Lần 2 (assert asset):
    // không còn hold nào khác đang giữ asset.
    prisma.bookingChangeHold.findMany
      .mockResolvedValueOnce(expiredHolds)
      .mockResolvedValueOnce([]);

    const result = await service.handlePaymentPaid("pay-charge");

    expect((result.data as Record<string, unknown>).status).toBe("applied");
    expect(prisma.bookingItem.update).toHaveBeenCalled();
  });

  it("request cancelled + tiền về → needs_manager, báo manager, không tự hoàn", async () => {
    const { service, prisma, notifications } = createHarness({
      awaitingPaymentRequest: awaitingPaidRequest({ status: "cancelled" }),
    });

    const result = await service.handlePaymentPaid("pay-charge");

    expect((result.data as Record<string, unknown>).status).toBe("needs_manager");
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REQUEST_ID, status: { in: ["expired", "cancelled"] } },
        data: { status: "needs_manager" },
      }),
    );
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "needs_manager" }) }),
    );
    expect(prisma.bookingItem.update).not.toHaveBeenCalled();
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(notifications.notifyStaffBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "booking.staff.incident_open",
        linkUrl: "/dashboard/manager/incidents",
      }),
    );
  });

  it("request expired + tiền về → needs_manager (idempotent khi chạy lại)", async () => {
    const { service, prisma } = createHarness({
      awaitingPaymentRequest: awaitingPaidRequest({ status: "expired" }),
    });

    const result = await service.handlePaymentPaid("pay-charge");

    expect((result.data as Record<string, unknown>).status).toBe("needs_manager");
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REQUEST_ID, status: { in: ["expired", "cancelled"] } },
        data: { status: "needs_manager" },
      }),
    );

    // Chạy lại: request đã needs_manager → no-op, không báo lần hai.
    prisma.bookingChangeRequest.findFirst.mockResolvedValue(
      awaitingPaidRequest({ status: "needs_manager" }),
    );
    const again = await service.handlePaymentPaid("pay-charge");
    expect((again.data as Record<string, unknown>).applied).toBe(false);
    expect((again.data as Record<string, unknown>).status).toBe("needs_manager");
  });
});

describe("BookingChangeRequestsService.expireChangeRequests — cron §7.4", () => {
  it("quá hạn không có payment → expired + incident needs_manager + báo manager", async () => {
    const { service, prisma, notifications } = createHarness({
      dueChangeRequests: [{ id: REQUEST_ID, bookingId: BOOKING_ID, paymentId: null }],
    });

    const result = await service.expireChangeRequests(new Date());

    expect(result.data?.expired).toEqual([REQUEST_ID]);
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: REQUEST_ID, holdExpiresAt: expect.any(Object) }),
        data: { status: "expired" },
      }),
    );
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "needs_manager" }) }),
    );
    expect(notifications.notifyStaffBooking).toHaveBeenCalled();
  });

  it("đóng intent PayOS TRƯỚC; PayOS đang xử lý → bỏ qua, không expired", async () => {
    const { service, prisma, payments } = createHarness({
      dueChangeRequests: [{ id: REQUEST_ID, bookingId: BOOKING_ID, paymentId: "pay-qr-1" }],
    });
    payments.releaseClosedPayosIntents.mockRejectedValueOnce(
      new BadRequestException("Đơn hàng đang được PayOS ghi nhận thanh toán."),
    );

    const result = await service.expireChangeRequests(new Date());

    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID, { strict: true });
    expect(result.data?.skipped).toEqual([REQUEST_ID]);
    expect(result.data?.expired).toEqual([]);
    expect(prisma.bookingChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("payment đã paid (webhook lỡ mất) → áp dụng yêu cầu thay vì hết hạn", async () => {
    const { service } = createHarness({
      dueChangeRequests: [{ id: REQUEST_ID, bookingId: BOOKING_ID, paymentId: "pay-charge" }],
      awaitingPaymentRequest: {
        ...applyRequest({ status: "awaiting_payment" }),
        bookingId: BOOKING_ID,
        createdBy: "user-1",
        paymentId: "pay-charge",
        afterSnapshot: { ...applyRequest().afterSnapshot, wasPaid: true, chargeAmount: 100_000 },
      },
    });

    const result = await service.expireChangeRequests(new Date());

    expect(result.data?.applied).toEqual([REQUEST_ID]);
    expect(result.data?.expired).toEqual([]);
  });
});

describe("BookingChangeRequestsService.cancelChangeRequest — §7.4", () => {
  it("hủy yêu cầu: đánh dấu cancelled, tiêu thụ hold, trả sự cố về khách", async () => {
    const { service, prisma } = createHarness({ pendingRequest: { id: REQUEST_ID, status: "quoted" } });
    const result = await service.cancelChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(result.data).toEqual({ id: REQUEST_ID, status: "cancelled" });
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
    );
    expect(prisma.bookingChangeHold.updateMany).toHaveBeenCalled();
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "awaiting_customer" }) }),
    );
  });

  it("không tìm thấy yêu cầu → 404", async () => {
    const { service, prisma } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValue(null);
    await expect(service.cancelChangeRequest(customer, BOOKING_ID, REQUEST_ID)).rejects.toThrow();
  });

  it("awaiting_payment: đóng PayOS intent TRƯỚC rồi mới hủy", async () => {
    const { service, prisma, payments } = createHarness({
      applyRequest: applyRequest({ status: "awaiting_payment", paymentId: "pay-charge" }),
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: "pending" });

    const result = await service.cancelChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID, { strict: true });
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
    );
    expect(result.data).toEqual({ id: REQUEST_ID, status: "cancelled" });
  });

  it("awaiting_payment + PayOS đang xử lý/không đọc được → 409, KHÔNG hủy", async () => {
    const { service, prisma, payments } = createHarness({
      applyRequest: applyRequest({ status: "awaiting_payment", paymentId: "pay-charge" }),
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: "pending" });
    payments.releaseClosedPayosIntents.mockRejectedValueOnce(
      new BadRequestException("Đơn hàng đang được PayOS ghi nhận thanh toán."),
    );

    await expect(service.cancelChangeRequest(customer, BOOKING_ID, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.bookingChangeRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe("BookingChangeRequestsService.declineIncident — §7.4", () => {
  it("khách từ chối → sự cố chuyển needs_manager", async () => {
    const { service, prisma } = createHarness();
    const result = await service.declineIncident(customer, BOOKING_ID, INCIDENT_ID);
    expect(result.data).toEqual({ id: INCIDENT_ID, status: "needs_manager" });
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalled();
  });

  it("sự cố vừa được xử lý (count 0) → 409", async () => {
    const { service, prisma } = createHarness();
    prisma.bookingIncident.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.declineIncident(customer, BOOKING_ID, INCIDENT_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("BookingChangeRequestsService — thay phụ kiện cùng accessory_id (mục 4.4 / 1.5)", () => {
  it("chấp nhận chiếc cùng accessory_id lấy từ kho chung, KHÔNG cần garment_accessories", async () => {
    const { service, prisma, created, holds } = createHarness({
      booking: makeAccessoryBooking(),
      incidents: [accessoryIncident()],
      accessoryAssets: [
        {
          id: ACCESSORY_ASSET_NEW,
          accessory_id: ACCESSORY_ID,
          status: "available",
          asset_code: "PK-2",
          booking_accessory_items: [],
        },
      ],
    });

    await service.createChangeRequest(customer, BOOKING_ID, {
      type: "replace",
      incidents: [ACCESSORY_INCIDENT_ID],
      accessoryReplacements: [
        { incidentId: ACCESSORY_INCIDENT_ID, accessoryAssetId: ACCESSORY_ASSET_NEW },
      ],
    });

    const request = created[0] as Record<string, unknown>;
    const selection = request.selection as Record<string, unknown>;
    expect(selection.accessoryReplacements).toEqual([
      expect.objectContaining({
        incidentId: ACCESSORY_INCIDENT_ID,
        accessoryItemId: ACCESSORY_ITEM_ID,
        accessoryId: ACCESSORY_ID,
        accessoryAssetId: ACCESSORY_ASSET_NEW,
        // Thay chiếc cùng mẫu → không đổi giá.
        changedModel: false,
      }),
    ]);
    // Thay thế KHÔNG bỏ món phụ kiện cũ.
    expect(selection.removeAccessoryItemIds).toEqual([]);
    // Giữ chỗ đúng chiếc thay thế.
    expect(holds).toEqual([
      expect.objectContaining({
        kind: "accessory",
        accessoryAssetId: ACCESSORY_ASSET_NEW,
      }),
    ]);
    // 1.5: không ràng buộc mẫu phụ kiện phải nằm trong garment_accessories.
    expect(prisma.garment_accessories.findFirst).not.toHaveBeenCalled();
  });

  it("chiếc được chọn khác accessory_id → 400", async () => {
    const { service } = createHarness({
      booking: makeAccessoryBooking(),
      incidents: [accessoryIncident()],
      accessoryAssets: [
        { id: ACCESSORY_ASSET_NEW, accessory_id: "acc-khac", status: "available", asset_code: "PK-9" },
      ],
    });

    await expect(
      service.createChangeRequest(customer, BOOKING_ID, {
        type: "replace",
        incidents: [ACCESSORY_INCIDENT_ID],
        accessoryReplacements: [
          { incidentId: ACCESSORY_INCIDENT_ID, accessoryAssetId: ACCESSORY_ASSET_NEW },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("không chỉ định chiếc cụ thể → server tự chọn chiếc cùng accessory_id còn trống", async () => {
    const { service, created, holds } = createHarness({
      booking: makeAccessoryBooking(),
      incidents: [accessoryIncident()],
      accessoryAssets: [
        {
          id: ACCESSORY_ASSET_NEW,
          accessory_id: ACCESSORY_ID,
          status: "available",
          asset_code: "PK-2",
          booking_accessory_items: [],
        },
      ],
    });

    await service.createChangeRequest(customer, BOOKING_ID, {
      type: "replace",
      incidents: [ACCESSORY_INCIDENT_ID],
      accessoryReplacements: [{ incidentId: ACCESSORY_INCIDENT_ID }],
    });

    const selection = (created[0] as Record<string, unknown>).selection as Record<string, unknown>;
    expect(selection.accessoryReplacements).toEqual([
      expect.objectContaining({ accessoryItemId: ACCESSORY_ITEM_ID, accessoryAssetId: ACCESSORY_ASSET_NEW }),
    ]);
    expect(holds).toEqual([
      expect.objectContaining({ kind: "accessory", accessoryAssetId: ACCESSORY_ASSET_NEW }),
    ]);
  });

  it("áp dụng yêu cầu: cập nhật bookingAccessoryItem sang chiếc mới, giữ nguyên mẫu + giá", async () => {
    const { service, prisma } = createHarness({
      booking: makeAccessoryBooking(),
      paid: false,
      applyRequest: {
        id: REQUEST_ID,
        bookingId: BOOKING_ID,
        type: "replace",
        status: "quoted",
        selection: {
          incidentIds: [ACCESSORY_INCIDENT_ID],
          replacements: [],
          addAccessories: [],
          removeAccessoryItemIds: [],
          accessoryReplacements: [
            {
              incidentId: ACCESSORY_INCIDENT_ID,
              accessoryItemId: ACCESSORY_ITEM_ID,
              accessoryId: ACCESSORY_ID,
              accessoryAssetId: ACCESSORY_ASSET_NEW,
            },
          ],
        },
        beforeSnapshot: { rentalTotal: 400_000, depositTotal: 400_000, discountTotal: 0, items: [], accessoryItems: [] },
        afterSnapshot: {
          newSubtotal: 400_000,
          newDiscount: 0,
          newRentalTotal: 400_000,
          newDepositTotal: 400_000,
          chargeAmount: 0,
          creditAmount: 0,
          adjustmentLines: [],
          wasPaid: false,
          allRemoved: false,
          removedGarmentItemIds: [],
        },
        holdExpiresAt: new Date(Date.now() + 60_000),
        rentBefore: new Prisma.Decimal(400_000),
        depositBefore: new Prisma.Decimal(400_000),
        discountBefore: new Prisma.Decimal(0),
      },
    });

    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(prisma.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: { accessoryAssetId: ACCESSORY_ASSET_NEW },
    });
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "resolved", resolution: "replaced" }),
      }),
    );
  });
});

describe("BookingChangeRequestsService.listMyIncidents — tab Sự cố của khách", () => {
  const bookingRow = {
    id: BOOKING_ID,
    status: "confirmed",
    rentalStartDate: day("2026-11-11"),
    rentalEndDate: day("2026-11-12"),
  };

  it("gộp sự cố theo đơn + dịch lý do, đếm theo số ĐƠN", async () => {
    const { service, prisma } = createHarness({
      incidents: [
        {
          ...garmentIncident(),
          bookingId: BOOKING_ID,
          dueAt: day("2026-11-12"),
          snapshot: { name: "Áo A", sizeLabel: "M", imageUrl: null },
          booking: bookingRow,
        },
        {
          ...accessoryIncident(),
          bookingId: BOOKING_ID,
          dueAt: day("2026-11-12"),
          booking: bookingRow,
        },
      ],
      dueChangeRequests: [
        {
          id: REQUEST_ID,
          bookingId: BOOKING_ID,
          holdExpiresAt: new Date(Date.now() + 600_000),
          selection: { replacements: [{ incidentId: INCIDENT_ID, sizeId: NEW_SIZE_ID }] },
        },
      ],
    });

    const result = await service.listMyIncidents(customer);
    const data = result.data as {
      count: number;
      incidentCount: number;
      bookings: Array<{
        bookingId: string;
        bookingCode: string;
        bookingStatus: string;
        incidents: Array<{ reasonLabel: string; name: string | null }>;
        pendingRequest: { id: string; requiresHold: boolean; countdownSeconds: number } | null;
      }>;
    };

    // Badge đếm SỐ ĐƠN có sự cố (không phải số sự cố).
    expect(data.count).toBe(1);
    expect(data.incidentCount).toBe(2);
    expect(data.bookings[0]).toMatchObject({
      bookingId: BOOKING_ID,
      bookingCode: BOOKING_ID.slice(0, 8).toUpperCase(),
      bookingStatus: "confirmed",
    });
    expect(data.bookings[0].incidents.map((row) => row.reasonLabel)).toEqual([
      "trang phục bị hư hỏng",
      "không còn phụ kiện thay thế",
    ]);
    expect(data.bookings[0].incidents[0].name).toBe("Áo A");
    expect(data.bookings[0].pendingRequest).toMatchObject({
      id: REQUEST_ID,
      requiresHold: true,
    });
    expect(data.bookings[0].pendingRequest!.countdownSeconds).toBeGreaterThan(0);

    // Đơn đã huỷ/hoàn tất không được lọt vào tab sự cố.
    expect(prisma.bookingIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: expect.any(Array) },
          booking: { customerId: CUSTOMER_ID, status: { in: expect.any(Array) } },
        }),
      }),
    );
  });

  it("không có sự cố → count 0 (sidebar không gắn badge)", async () => {
    const { service } = createHarness({ incidents: [] });

    const result = await service.listMyIncidents(customer);
    expect(result.data).toEqual({ count: 0, incidentCount: 0, bookings: [] });
  });
});

describe("BookingChangeRequestsService.listIncidents — gợi ý mẫu tương tự", () => {
  it("mẫu gốc hết size còn hàng → gợi ý mẫu CÙNG danh mục, cùng size", async () => {
    const { service, prisma } = createHarness({
      sizes: [],
      garmentTarget: { categoryId: "cat-1" },
      similarGarments: [
        {
          id: "garment-2",
          name: "Áo tứ thân",
          garment_sizes: [{ id: "size-2", size_label: "M" }],
        },
      ],
      garmentAssets: [{ id: "asset-2", status: "available" }],
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as {
      suggestions: Array<{ itemKind: string; options: Array<Record<string, unknown>> }>;
    };

    expect(detail.suggestions).toHaveLength(1);
    expect(detail.suggestions[0]).toMatchObject({ itemKind: "garment" });
    expect(detail.suggestions[0].options).toEqual([
      expect.objectContaining({ sizeId: "size-2", sizeLabel: "M", name: "Áo tứ thân", available: 1 }),
    ]);
    // Tìm mẫu tương tự theo đúng danh mục của mẫu gốc (OR cùng mẫu / cùng danh mục).
    expect(prisma.garment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ categoryId: "cat-1" }]),
        }),
      }),
    );
  });

  it("gợi ý trang phục: tính cả chiếc phụ kiện đang nằm trong CHÍNH đơn + giá/cọc/maxQuantity", async () => {
    const { service } = createHarness({
      sizes: [],
      garmentTarget: { categoryId: "cat-1" },
      similarGarments: [
        {
          id: "garment-2",
          name: "Áo tứ thân",
          garment_sizes: [
            {
              id: "size-2",
              size_label: "M",
              daily_price: new Prisma.Decimal(200_000),
              deposit_amount: new Prisma.Decimal(300_000),
            },
          ],
          garment_accessories: [
            {
              quantity: 2,
              is_included: false,
              extra_price: new Prisma.Decimal(10_000),
              accessories: { id: ACCESSORY_ID, name: "Kiềng cổ", image_url: null },
            },
          ],
        },
      ],
      garmentAssets: [{ id: "asset-2", status: "available" }],
      accessoryAssets: [
        {
          id: ACCESSORY_ASSET_OLD,
          accessory_id: ACCESSORY_ID,
          status: "available",
          asset_code: "PK-1",
          // Chiếc đang gắn với chính đơn này: vẫn phải tính là thuê được.
          booking_accessory_items: [
            {
              id: ACCESSORY_ITEM_ID,
              bookingId: BOOKING_ID,
              booking: {
                id: BOOKING_ID,
                status: "paid",
                rentalStartDate: day("2026-11-11"),
                rentalEndDate: day("2026-11-12"),
              },
            },
          ],
        },
        {
          id: ACCESSORY_ASSET_NEW,
          accessory_id: ACCESSORY_ID,
          status: "available",
          asset_code: "PK-2",
          booking_accessory_items: [],
        },
      ],
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const option = (
      result.data as { suggestions: Array<{ options: Array<Record<string, unknown>> }> }
    ).suggestions[0].options[0];

    expect(option).toMatchObject({
      sizeId: "size-2",
      sizeLabel: "M",
      name: "Áo tứ thân",
      dailyPrice: 200_000,
      // 2 ngày × 200k (pricing mock không có size này → fallback giá/ngày × ngày).
      rentalTotal: 400_000,
      depositAmount: 300_000,
    });
    expect(option.accessories).toEqual([
      expect.objectContaining({
        accessoryId: ACCESSORY_ID,
        name: "Kiềng cổ",
        available: 2,
        maxQuantity: 2,
      }),
    ]);
  });

  it("mẫu gốc không có danh mục → không đoán mẫu tương tự", async () => {
    const { service, prisma } = createHarness({
      sizes: [],
      garmentTarget: { categoryId: null },
      similarGarments: [{ id: "garment-2", name: "Áo khác", garment_sizes: [{ id: "size-2", size_label: "M" }] }],
      garmentAssets: [{ id: "asset-2", status: "available" }],
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as { suggestions: unknown[] };

    expect(detail.suggestions).toEqual([]);
    expect(prisma.garment.findMany).not.toHaveBeenCalled();
  });

  it("báo giá đang chờ của yêu cầu BỎ MÓN → requiresHold=false", async () => {
    const { service } = createHarness({
      pendingRequest: {
        id: REQUEST_ID,
        holdExpiresAt: new Date(Date.now() + 60_000),
        selection: { removeAccessoryItemIds: [], incidentIds: [INCIDENT_ID], replacements: [], addAccessories: [] },
      },
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as { pendingRequest: { requiresHold: boolean } | null };

    expect(detail.pendingRequest).toMatchObject({ id: REQUEST_ID, requiresHold: false });
  });
});

function accessoryBookingWithHost(overrides: Record<string, unknown> = {}) {
  return makeAccessoryBooking({
    accessoryItems: [
      {
        id: ACCESSORY_ITEM_ID,
        bookingItemId: ITEM_ID,
        accessoryId: ACCESSORY_ID,
        accessoryAssetId: ACCESSORY_ASSET_OLD,
        quantity: 1,
        unitPrice: new Prisma.Decimal(50_000),
        isIncluded: false,
        rentalTotal: new Prisma.Decimal(50_000),
      },
    ],
    ...overrides,
  });
}

describe("BookingChangeRequestsService.listIncidents — gợi ý phụ kiện KHÁC mẫu", () => {
  it("đơn chỉ lỗi phụ kiện → gợi ý mẫu phụ kiện khác của cùng trang phục còn hàng", async () => {
    const { service } = createHarness({
      booking: accessoryBookingWithHost(),
      incidents: [accessoryIncident()],
      garmentAccessoryLinks: [
        {
          is_included: false,
          extra_price: new Prisma.Decimal(30_000),
          accessories: { id: "acc-2", name: "Quạt lụa", image_url: "https://cdn.example/q2.jpg" },
        },
      ],
      accessoryAssets: [
        { id: "asset-q2", accessory_id: "acc-2", status: "available", booking_accessory_items: [] },
      ],
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as {
      suggestions: Array<{ itemKind: string; options: Array<Record<string, unknown>> }>;
    };

    expect(detail.suggestions).toHaveLength(1);
    expect(detail.suggestions[0]).toMatchObject({ itemKind: "accessory", accessoryId: ACCESSORY_ID });
    expect(detail.suggestions[0].options).toEqual([
      {
        accessoryId: "acc-2",
        name: "Quạt lụa",
        imageUrl: "https://cdn.example/q2.jpg",
        isIncluded: false,
        extraPrice: 30_000,
        available: 1,
        maxQuantity: 1,
      },
    ]);
  });

  it("mẫu phụ kiện khác hết sạch chiếc → không gợi ý (khách chọn Bỏ món)", async () => {
    const { service } = createHarness({
      booking: accessoryBookingWithHost(),
      incidents: [accessoryIncident()],
      garmentAccessoryLinks: [
        {
          is_included: true,
          extra_price: new Prisma.Decimal(0),
          accessories: { id: "acc-2", name: "Quạt lụa", image_url: null },
        },
      ],
      accessoryAssets: [],
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as { suggestions: unknown[] };

    expect(detail.suggestions).toEqual([]);
  });

  it("mẫu phụ kiện ĐÃ có trong đơn không được gợi ý đổi sang nữa", async () => {
    const { service, prisma } = createHarness({
      booking: accessoryBookingWithHost({
        accessoryItems: [
          {
            id: ACCESSORY_ITEM_ID,
            bookingItemId: ITEM_ID,
            accessoryId: ACCESSORY_ID,
            accessoryAssetId: ACCESSORY_ASSET_OLD,
            quantity: 1,
            unitPrice: new Prisma.Decimal(50_000),
            isIncluded: false,
            rentalTotal: new Prisma.Decimal(50_000),
          },
          {
            id: ACCESSORY_ITEM_ID_2,
            bookingItemId: ITEM_ID,
            accessoryId: "acc-rented",
            accessoryAssetId: "asset-rented",
            quantity: 1,
            unitPrice: new Prisma.Decimal(40_000),
            isIncluded: false,
            rentalTotal: new Prisma.Decimal(40_000),
          },
        ],
      }),
      incidents: [accessoryIncident()],
      garmentAccessoryLinks: [
        {
          is_included: false,
          extra_price: new Prisma.Decimal(30_000),
          accessories: { id: "acc-rented", name: "Quạt lụa", image_url: null },
        },
      ],
    });

    await service.listIncidents(customer, BOOKING_ID);

    // Mẫu đang hỏng và mẫu đã thuê trong đơn đều bị loại khỏi truy vấn gợi ý.
    expect(prisma.garment_accessories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          garment_id: "garment-1",
          accessory_id: { notIn: [ACCESSORY_ID, "acc-rented"] },
        },
      }),
    );
  });

  it("trả kèm nhãn tiếng Việt của lý do để trang khách không hiện mã kỹ thuật", async () => {
    const { service } = createHarness({ incidents: [garmentIncident()] });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as {
      incidents: Array<{ reason: string; reasonLabel: string }>;
    };

    expect(detail.incidents[0]).toMatchObject({
      reason: "asset_damaged",
      reasonLabel: "trang phục bị hư hỏng",
    });
  });

  it("đơn đã thanh toán: trả tiền hoàn dự kiến khi bỏ hết món (trừ refund đang có)", async () => {
    const { service } = createHarness({
      incidents: [garmentIncident()],
      paidPayments: [{ amount: new Prisma.Decimal(1_200_000) }],
      refunds: [{ amount: new Prisma.Decimal(200_000) }],
    });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as { booking: { refundEstimate: number } };

    expect(detail.booking.refundEstimate).toBe(1_000_000);
  });

  it("đơn chưa thanh toán: tiền hoàn dự kiến = 0 (FE không hiện khối hoàn/báo giá)", async () => {
    const { service } = createHarness({ incidents: [garmentIncident()], paid: false });

    const result = await service.listIncidents(customer, BOOKING_ID);
    const detail = result.data as { booking: { refundEstimate: number } };

    expect(detail.booking.refundEstimate).toBe(0);
  });
});

describe("BookingChangeRequestsService — đổi sang mẫu phụ kiện khác", () => {
  it("chốt giá theo garment_accessories và tính chênh lệch phụ kiện", async () => {
    const { service, created } = createHarness({
      booking: accessoryBookingWithHost(),
      incidents: [accessoryIncident()],
      accessoryLinks: [
        {
          garment_id: "garment-1",
          accessory_id: "acc-2",
          is_included: false,
          extra_price: new Prisma.Decimal(80_000),
          accessories: { name: "Quạt lụa" },
        },
      ],
      accessoryAssets: [
        {
          id: ACCESSORY_ASSET_NEW,
          accessory_id: "acc-2",
          status: "available",
          asset_code: "PK-2",
          booking_accessory_items: [],
        },
      ],
    });

    const result = await service.createChangeRequest(customer, BOOKING_ID, {
      type: "replace",
      incidents: [ACCESSORY_INCIDENT_ID],
      accessoryReplacements: [{ incidentId: ACCESSORY_INCIDENT_ID, accessoryId: "acc-2" }],
    });

    const selection = (created[0] as Record<string, unknown>).selection as Record<string, unknown>;
    expect(selection.accessoryReplacements).toEqual([
      expect.objectContaining({
        accessoryItemId: ACCESSORY_ITEM_ID,
        accessoryId: "acc-2",
        accessoryAssetId: ACCESSORY_ASSET_NEW,
        changedModel: true,
        unitPrice: 80_000,
        // 80.000đ/ngày × 2 ngày × 1 chiếc.
        lineTotal: 160_000,
        isIncluded: false,
      }),
    ]);
    expect(selection.removeAccessoryItemIds).toEqual([]);

    // Cũ 50.000 → mới 160.000 ⇒ thu thêm 110.000 tiền phụ kiện.
    const payload = result.data as Record<string, unknown>;
    expect(payload.accessoryDelta).toBe(110_000);
    expect(payload.chargeNow).toBe(110_000);
  });

  it("áp dụng: đổi cả mẫu + đơn giá + thành tiền của dòng phụ kiện", async () => {
    const { service, prisma } = createHarness({
      booking: accessoryBookingWithHost(),
      paid: false,
      applyRequest: {
        id: REQUEST_ID,
        type: "replace",
        status: "quoted",
        selection: {
          removeAccessoryItemIds: [],
          incidentIds: [ACCESSORY_INCIDENT_ID],
          replacements: [],
          addAccessories: [],
          accessoryReplacements: [
            {
              incidentId: ACCESSORY_INCIDENT_ID,
              accessoryItemId: ACCESSORY_ITEM_ID,
              accessoryId: "acc-2",
              accessoryAssetId: ACCESSORY_ASSET_NEW,
              changedModel: true,
              unitPrice: 80_000,
              lineTotal: 160_000,
              isIncluded: false,
            },
          ],
        },
        beforeSnapshot: { rentalTotal: 400_000, depositTotal: 400_000, discountTotal: 0, items: [], accessoryItems: [] },
        afterSnapshot: {
          newSubtotal: 400_000,
          newDiscount: 0,
          newRentalTotal: 400_000,
          newDepositTotal: 400_000,
          chargeAmount: 0,
          creditAmount: 0,
          adjustmentLines: [],
          wasPaid: false,
          allRemoved: false,
          removedGarmentItemIds: [],
        },
        holdExpiresAt: new Date(Date.now() + 60_000),
        rentBefore: new Prisma.Decimal(400_000),
        depositBefore: new Prisma.Decimal(400_000),
        discountBefore: new Prisma.Decimal(0),
      },
    });

    await service.confirmChangeRequest(customer, BOOKING_ID, REQUEST_ID);

    expect(prisma.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: {
        accessoryAssetId: ACCESSORY_ASSET_NEW,
        accessoryId: "acc-2",
        unitPrice: expect.anything(),
        rentalTotal: expect.anything(),
        isIncluded: false,
      },
    });
  });
});
