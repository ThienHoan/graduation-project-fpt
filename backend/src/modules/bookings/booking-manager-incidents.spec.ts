import { ForbiddenException, BadRequestException, ConflictException } from "@nestjs/common";
import { BookingStatus, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { BookingChangeRequestsService } from "./booking-change-requests.service";

const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const INCIDENT_ID = "00000000-0000-4000-8000-0000000000aa";
const ITEM_ID = "00000000-0000-4000-8000-0000000000bb";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000cc";

const manager = { id: "manager-1", role: "manager_owner" } as const;
const staff = { id: "staff-1", role: "staff" } as const;

function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: BookingStatus.paid,
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
        garmentAssetId: null,
        garment_size_id: "size-1",
        dailyPrice: new Prisma.Decimal(400_000),
        depositAmount: new Prisma.Decimal(400_000),
        garment_sizes: { size_label: "M", garments: { name: "Áo A" } },
      },
    ],
    accessoryItems: [],
    customer: { email: "khach@example.com", profile: { fullName: "Nguyễn Văn A", phone: "0909" } },
    payments: [{ id: "pay-1", amount: new Prisma.Decimal(800_000), status: "paid", paymentMethod: "cash" }],
    refunds: [],
    ...overrides,
  };
}

function makeIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    bookingId: BOOKING_ID,
    itemKind: "garment",
    bookingItemId: ITEM_ID,
    bookingAccessoryItemId: null,
    reason: "asset_damaged",
    status: "needs_manager",
    snapshot: { name: "Áo A", sizeLabel: "M", imageUrl: "https://cdn.example/a.jpg" },
    dueAt: day("2026-11-11"),
    detectedAt: new Date("2026-11-09T03:00:00.000Z"),
    assetCode: "G-001",
    booking: {
      id: BOOKING_ID,
      status: BookingStatus.paid,
      customerId: CUSTOMER_ID,
      rentalStartDate: day("2026-11-11"),
    },
    ...overrides,
  };
}

function createHarness(options: { incident?: Record<string, unknown> | null; booking?: Record<string, unknown> } = {}) {
  const booking = options.booking ?? makeBooking();
  const incident = options.incident === undefined ? makeIncident() : options.incident;
  const createdRequests: Array<Record<string, unknown>> = [];

  const prisma = {
    runSerializable: vi.fn(),
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingIncident: {
      findUnique: vi.fn().mockResolvedValue(incident),
      findMany: vi.fn().mockResolvedValue(
        incident
          ? [
              {
                ...incident,
                booking: {
                  ...booking,
                  customer: { email: "khach@example.com", profile: { fullName: "Nguyễn Văn A", phone: "0909" } },
                },
              },
            ]
          : [],
      ),
      count: vi.fn().mockImplementation(async () => (incident ? 1 : 0)),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    bookingChangeRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockImplementation(async () => ({
        id: REQUEST_ID,
        bookingId: BOOKING_ID,
        type: "remove",
        status: "quoted",
        selection: {
          removeAccessoryItemIds: [],
          incidentIds: [INCIDENT_ID],
          replacements: [],
          addAccessories: [],
        },
        beforeSnapshot: { rentalTotal: 400_000, depositTotal: 400_000, discountTotal: 0, items: [], accessoryItems: [] },
        afterSnapshot: {
          newSubtotal: 0,
          newDiscount: 0,
          newRentalTotal: 0,
          newDepositTotal: 0,
          chargeAmount: 0,
          creditAmount: 400_000,
          adjustmentLines: [{ component: "rent", direction: "credit", amount: 400_000 }],
          wasPaid: true,
          allRemoved: false,
          removedGarmentItemIds: [ITEM_ID],
        },
        holdExpiresAt: new Date(Date.now() + 24 * 3600_000),
        rentBefore: new Prisma.Decimal(400_000),
        depositBefore: new Prisma.Decimal(400_000),
        discountBefore: new Prisma.Decimal(0),
      })),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        createdRequests.push(data);
        return { id: REQUEST_ID, ...data };
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingChangeHold: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingItem: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingAccessoryItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingAdjustment: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    garment_sizes: { findMany: vi.fn().mockResolvedValue([]) },
    garment: {
      findUnique: vi.fn().mockResolvedValue({ categoryId: null }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    garment_accessories: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    garmentAsset: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: "asset-1", status: "available" }),
    },
    accessory_assets: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    accessories: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue({ id: "pay-1" }),
      findUnique: vi.fn().mockResolvedValue({ status: "paid" }),
      findMany: vi.fn().mockResolvedValue([{ amount: new Prisma.Decimal(800_000) }]),
    },
    bookingExtension: { findFirst: vi.fn().mockResolvedValue(null) },
    refund: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "refund-1",
        ...data,
      })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    financialTransaction: { create: vi.fn().mockResolvedValue({}) },
    voucher_usages: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    bookingStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: BOOKING_ID }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  prisma.runSerializable.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));

  const notifications = {
    notifyUser: vi.fn().mockResolvedValue({}),
    notifyStaffBooking: vi.fn().mockResolvedValue({}),
  };
  const vouchers = { releaseForBooking: vi.fn().mockResolvedValue(undefined) };
  const payments = {
    releaseClosedPayosIntents: vi.fn().mockResolvedValue(undefined),
    createChangeRequestPaymentLink: vi.fn().mockResolvedValue({
      paymentId: "pay-charge",
      checkoutUrl: "https://pay.example/charge",
    }),
  };
  const service = new BookingChangeRequestsService(
    prisma as never,
    undefined,
    vouchers as never,
    payments as never,
    notifications as never,
  );
  return { service, prisma, notifications, createdRequests, payments };
}

describe("BookingChangeRequestsService.listStaffIncidents — §13.2", () => {
  it("sự cố còn mở lên đầu (status ASC), sự cố vừa xử lý xong lên đầu nhóm đã xử lý (resolvedAt DESC), rồi dueAt ASC, detectedAt ASC; có phân trang", async () => {
    // Ngày thuê tính từ hôm nay để test không phụ thuộc ngày chạy.
    const { vietnamToday, DAY_MS } = await import("./booking-inventory");
    const startDate = new Date(vietnamToday().getTime() + 2 * DAY_MS);
    const { service, prisma } = createHarness({
      booking: makeBooking({ rentalStartDate: startDate }),
    });

    const result = await service.listStaffIncidents({});

    expect(prisma.bookingIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { status: "asc" },
          { resolvedAt: { sort: "desc", nulls: "last" } },
          { dueAt: "asc" },
          { detectedAt: "asc" },
        ],
        skip: 0,
        take: 20,
      }),
    );
    const data = result.data as { items: Array<Record<string, unknown>>; total: number; page: number; limit: number; totalPages: number };
    expect(data).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    const row = data.items[0];
    expect(row).toMatchObject({
      id: INCIDENT_ID,
      bookingCode: BOOKING_ID.slice(0, 8).toUpperCase(),
      status: "needs_manager",
      customer: { fullName: "Nguyễn Văn A" },
      item: { kind: "garment", name: "Áo A" },
    });
    expect(typeof row.daysRemaining).toBe("number");
    expect(row.daysRemaining).toBe(2);
    expect(row.daysOverdue).toBe(0);
  });

  it("truyền page/limit → skip/take tương ứng", async () => {
    const { service, prisma } = createHarness();

    const result = await service.listStaffIncidents({ page: 3, limit: 10 });

    expect(prisma.bookingIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.data).toMatchObject({ page: 3, limit: 10 });
  });

  it("đơn đã qua ngày thuê trả daysOverdue > 0 (không còn bị hiển thị là 'Hôm nay')", async () => {
    const { vietnamToday, DAY_MS } = await import("./booking-inventory");
    const startDate = new Date(vietnamToday().getTime() - 26 * DAY_MS);
    const { service } = createHarness({
      booking: makeBooking({ rentalStartDate: startDate }),
    });

    const result = await service.listStaffIncidents({});

    const row = (result.data as { items: Array<Record<string, unknown>> }).items[0];
    expect(row.daysRemaining).toBe(0);
    expect(row.daysOverdue).toBe(26);
  });
});

describe("BookingChangeRequestsService.getStaffIncident — gợi ý mẫu thay thế (§13.3)", () => {
  it("trả suggestions cùng nguồn buildSuggestions với trang khách", async () => {
    const { service, prisma } = createHarness({
      incident: makeIncident({
        booking: {
          id: BOOKING_ID,
          status: BookingStatus.paid,
          customerId: CUSTOMER_ID,
          rentalStartDate: day("2026-11-11"),
          rentalEndDate: day("2026-11-12"),
          rentalTotal: new Prisma.Decimal(400_000),
          depositTotal: new Prisma.Decimal(400_000),
          customer: null,
          items: [
            {
              id: ITEM_ID,
              garmentId: "garment-1",
              garment_sizes: { size_label: "M", garments: { name: "Áo A" } },
            },
          ],
          accessoryItems: [],
          changeRequests: [],
        },
      }),
    });

    // 1 size đang hoạt động của garment → có cơ hội gợi ý.
    prisma.garment_sizes.findMany.mockResolvedValue([
      { id: "size-1", size_label: "M" },
      { id: "size-2", size_label: "L" },
    ]);
    // size-1 còn 1 asset trống; size-2 không có asset → available 0 nên bị loại.
    prisma.garmentAsset.findMany.mockImplementation(
      async (args: { where?: { garment_size_id?: string } }) =>
        args?.where?.garment_size_id === "size-1" ? [{ id: "asset-1", status: "available" }] : [],
    );
    prisma.bookingItem.findMany.mockResolvedValue([]);

    const result = await service.getStaffIncident(INCIDENT_ID);

    const detail = result.data as {
      suggestions: Array<{ incidentId: string; garmentId: string; options: Array<{ sizeId: string; available: number }> }>;
    };
    expect(detail.suggestions).toHaveLength(1);
    expect(detail.suggestions[0]).toMatchObject({ incidentId: INCIDENT_ID, garmentId: "garment-1" });
    expect(detail.suggestions[0].options).toEqual([
      expect.objectContaining({ sizeId: "size-1", sizeLabel: "M", name: "Áo A", available: 1 }),
    ]);
  });

  it("không có sự cố → 404", async () => {
    const { service } = createHarness({ incident: null });
    await expect(service.getStaffIncident(INCIDENT_ID)).rejects.toMatchObject({ status: 404 });
  });

  it("đơn bị huỷ (từ chối bàn giao): settlement hiện số đã hoàn, không phải 0", async () => {
    const { service, prisma } = createHarness({
      incident: makeIncident({
        booking: {
          id: BOOKING_ID,
          status: BookingStatus.cancelled,
          customerId: CUSTOMER_ID,
          rentalStartDate: day("2026-11-11"),
          rentalEndDate: day("2026-11-12"),
          rentalTotal: new Prisma.Decimal(0),
          depositTotal: new Prisma.Decimal(300_000),
          customer: null,
          items: [],
          accessoryItems: [],
          changeRequests: [],
        },
      }),
    });
    prisma.payment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(800_000) }]);
    // Đơn huỷ đã có phiếu hoàn toàn bộ tiền thực thu đang chờ duyệt.
    prisma.refund.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(800_000) }]);

    const result = await service.getStaffIncident(INCIDENT_ID);
    const detail = result.data as { settlement: { bookingCancelled: boolean; refundAmount: number } };

    expect(detail.settlement.bookingCancelled).toBe(true);
    // `estimateRefund` (tiền còn phải hoàn) sẽ ra 0; trang sự cố phải hiện 800.000
    // đã/đang hoàn để khớp phiếu hoàn toàn bộ tiền thực thu.
    expect(detail.settlement.refundAmount).toBe(800_000);
  });

  it("đơn bị huỷ nhưng chưa có phiếu hoàn: settlement = toàn bộ tiền đã thu", async () => {
    const { service, prisma } = createHarness({
      incident: makeIncident({
        booking: {
          id: BOOKING_ID,
          status: BookingStatus.cancelled,
          customerId: CUSTOMER_ID,
          rentalStartDate: day("2026-11-11"),
          rentalEndDate: day("2026-11-12"),
          rentalTotal: new Prisma.Decimal(0),
          depositTotal: new Prisma.Decimal(300_000),
          customer: null,
          items: [],
          accessoryItems: [],
          changeRequests: [],
        },
      }),
    });
    prisma.payment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(800_000) }]);
    prisma.refund.findMany.mockResolvedValue([]);

    const result = await service.getStaffIncident(INCIDENT_ID);
    const detail = result.data as { settlement: { refundAmount: number } };
    expect(detail.settlement.refundAmount).toBe(800_000);
  });

  it("sự cố phụ kiện → gợi ý các MẪU phụ kiện khác còn hàng, không trùng lịch", async () => {
    const { service, prisma } = createHarness({
      incident: makeIncident({
        itemKind: "accessory",
        bookingItemId: null,
        bookingAccessoryItemId: "acc-item-1",
        snapshot: { name: "Quạt giấy" },
        booking: {
          id: BOOKING_ID,
          status: BookingStatus.paid,
          customerId: CUSTOMER_ID,
          rentalStartDate: day("2026-11-11"),
          rentalEndDate: day("2026-11-12"),
          rentalTotal: new Prisma.Decimal(400_000),
          depositTotal: new Prisma.Decimal(400_000),
          customer: null,
          items: [
            {
              id: ITEM_ID,
              garmentId: "garment-1",
              garment_sizes: { size_label: "M", garments: { name: "Áo A" } },
            },
          ],
          accessoryItems: [
            {
              id: "acc-item-1",
              accessoryId: "acc-1",
              accessoryAssetId: "acc-asset-old",
              bookingItemId: ITEM_ID,
            },
          ],
          changeRequests: [],
        },
      }),
    });

    // Mẫu phụ kiện KHÁC của cùng trang phục, còn 1 chiếc trống lịch.
    prisma.garment_accessories.findMany.mockResolvedValue([
      {
        is_included: false,
        extra_price: new Prisma.Decimal(30_000),
        accessories: { id: "acc-2", name: "Quạt lụa", image_url: "https://cdn.example/q2.jpg" },
      },
    ]);
    prisma.accessory_assets.findMany.mockResolvedValue([
      {
        id: "acc-asset-2",
        accessory_id: "acc-2",
        status: "available",
        booking_accessory_items: [],
      },
    ]);

    const result = await service.getStaffIncident(INCIDENT_ID);

    const detail = result.data as { suggestions: Array<Record<string, unknown>> };
    expect(detail.suggestions).toEqual([
      {
        incidentId: INCIDENT_ID,
        itemKind: "accessory",
        accessoryId: "acc-1",
        name: "Quạt giấy",
        options: [
          {
            accessoryId: "acc-2",
            name: "Quạt lụa",
            imageUrl: "https://cdn.example/q2.jpg",
            isIncluded: false,
            extraPrice: 30_000,
            available: 1,
            maxQuantity: 1,
          },
        ],
      },
    ]);
    // Chỉ lấy mẫu phụ kiện KHÁC mẫu đang bị sự cố của cùng trang phục.
    expect(prisma.garment_accessories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ garment_id: "garment-1", accessory_id: { notIn: ["acc-1"] } }),
      }),
    );
  });
});

describe("BookingChangeRequestsService.applyStaffIncidentAction — quyền + validate", () => {
  it("staff gọi actions → 403", async () => {
    const { service, prisma } = createHarness();
    await expect(
      service.applyStaffIncidentAction(staff, INCIDENT_ID, { action: "cancel", reason: "hết hàng" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.bookingIncident.findUnique).not.toHaveBeenCalled();
  });

  it("thiếu reason → 400", async () => {
    const { service } = createHarness();
    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, { action: "remove", reason: "   " }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("sự cố đã xử lý → 409", async () => {
    const { service } = createHarness({ incident: makeIncident({ status: "resolved" }) });
    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, { action: "cancel", reason: "hết hàng" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("BookingChangeRequestsService.applyStaffIncidentAction — 3 action", () => {
  it("cancel: dùng cancelBookingTx (void credit trước refund), incident resolved, audit", async () => {
    const { service, prisma } = createHarness();

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "cancel",
      reason: "Không còn mẫu thay thế",
    });

    expect(prisma.bookingAdjustment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID, status: { in: ["accrued", "pending_payment"] } },
      data: { status: "void", note: "void do hủy đơn" },
    });
    expect(prisma.bookingStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: BookingStatus.paid, toStatus: BookingStatus.cancelled }),
      }),
    );
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "resolved", resolution: "booking_cancelled" }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "booking.staff.incident.cancel" }) }),
    );
    expect((result.data as Record<string, unknown>).status).toBe("cancelled");
  });

  it("cancel đơn CHƯA thanh toán cũng đi cancelBookingTx (không cần incident mở riêng)", async () => {
    const { service, prisma } = createHarness({
      booking: makeBooking({ status: BookingStatus.confirmed, payments: [] }),
    });

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "cancel",
      reason: "Khách báo bận",
    });

    expect(prisma.bookingStatusHistory.create).toHaveBeenCalled();
    expect((result.data as Record<string, unknown>).status).toBe("cancelled");
  });

  it("remove: áp dụng ngay, đơn paid → credit accrued, incident resolved", async () => {
    const { service, prisma, createdRequests } = createHarness({
      booking: makeBooking(),
      incident: makeIncident({ booking: { ...makeIncident().booking, status: BookingStatus.paid } }),
    });

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "remove",
      reason: "Mẫu bị rách",
    });

    // Tạo request source=manager rồi áp dụng ngay (không chờ khách xác nhận).
    expect(createdRequests[0]).toMatchObject({ type: "remove", source: "manager", status: "quoted" });
    expect(prisma.bookingAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ direction: "credit", status: "accrued" }),
      }),
    );
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "resolved", resolution: "removed" }) }),
    );
    expect((result.data as Record<string, unknown>).action).toBe("remove");
    expect((result.data as Record<string, unknown>).status).toBe("applied");
  });

  it("proposal: tạo request source=manager giữ chỗ 30 phút, incident awaiting_customer, báo khách kèm link", async () => {
    const { service, prisma, notifications, createdRequests } = createHarness();

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "proposal",
      reason: "Đề xuất bỏ món",
      type: "remove",
    });

    const created = createdRequests[0] as { source: string; status: string; holdExpiresAt: Date };
    expect(created).toMatchObject({ source: "manager", status: "quoted" });
    expect(created.holdExpiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(created.holdExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [INCIDENT_ID] }, bookingId: BOOKING_ID },
        data: expect.objectContaining({ status: "awaiting_customer", changeRequestId: REQUEST_ID }),
      }),
    );
    expect(notifications.notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CUSTOMER_ID,
        templateKey: "booking.incident_action_required",
        linkUrl: `/booking/incidents/${BOOKING_ID}`,
      }),
    );
    expect((result.data as Record<string, unknown>).action).toBe("proposal");
    expect((result.data as Record<string, unknown>).source).toBe("manager");
  });

  it("proposal: gửi email đề xuất cho khách + ghi audit (30 phút)", async () => {
    const { service, prisma, notifications } = createHarness();

    await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "proposal",
      reason: "Mẫu bị lỗi, đề xuất mẫu khác",
      type: "remove",
      emailSubject: "Đề xuất riêng",
    });

    const emailCall = notifications.notifyUser.mock.calls.find(
      (call) => (call[0] as { templateKey?: string }).templateKey === "booking.incident_proposal_email",
    );
    expect(emailCall).toBeDefined();
    expect(emailCall![0]).toMatchObject({
      userId: CUSTOMER_ID,
      email: "khach@example.com",
      channels: ["email"],
    });
    const html = (emailCall![0] as { data: { html: string } }).data.html;
    expect(html).toContain("Đề xuất riêng");
    expect(html).toContain("30 phút");
    expect(html).toContain(`/booking/incidents/${BOOKING_ID}`);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "booking.incident.proposal_email_sent" }) }),
    );
  });

  it("preview: dựng HTML xem trước, KHÔNG tạo request / KHÔNG giữ chỗ", async () => {
    const { service, prisma, createdRequests } = createHarness();

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "preview",
      reason: "Mẫu bị lỗi",
      type: "remove",
    });

    const data = result.data as Record<string, unknown>;
    expect(data.action).toBe("preview");
    expect(typeof data.emailHtml).toBe("string");
    expect(data.emailHtml as string).toContain("Lý do đề xuất");
    expect(data.emailRecipient).toBe("khach@example.com");
    expect(createdRequests).toHaveLength(0);
    expect(prisma.bookingChangeRequest.create).not.toHaveBeenCalled();
    expect(prisma.bookingChangeHold.create).not.toHaveBeenCalled();
  });

  it("preview remove: dựng đúng email bỏ món (previewAction=remove), không tạo request", async () => {
    const { service, prisma, createdRequests } = createHarness();

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "preview",
      previewAction: "remove",
      reason: "Mẫu bị rách",
    });

    const data = result.data as Record<string, unknown>;
    expect(data.action).toBe("preview");
    expect(data.previewAction).toBe("remove");
    expect(data.emailHtml as string).toContain("1. Thông tin đơn thuê");
    expect(data.emailHtml as string).toContain("Thay đổi giá trị đơn hàng");
    expect(data.emailRecipient).toBe("khach@example.com");
    expect(createdRequests).toHaveLength(0);
    expect(prisma.bookingChangeRequest.create).not.toHaveBeenCalled();
    expect(prisma.bookingChangeHold.create).not.toHaveBeenCalled();
  });

  it("preview cancel: dựng email huỷ đơn, không trả báo giá / không tạo request", async () => {
    const { service, prisma, createdRequests } = createHarness();

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "preview",
      previewAction: "cancel",
      reason: "Không còn mẫu thay thế",
    });

    const data = result.data as Record<string, unknown>;
    expect(data.action).toBe("preview");
    expect(data.previewAction).toBe("cancel");
    expect(data.emailHtml as string).toContain("Đơn thuê đã bị hủy");
    expect(data.emailHtml as string).toContain("4. Thông tin hoàn tiền");
    expect(data.quote).toBeNull();
    expect(createdRequests).toHaveLength(0);
    expect(prisma.bookingChangeRequest.create).not.toHaveBeenCalled();
  });

  it("remove: gửi email bỏ món cho khách + audit", async () => {
    const { service, prisma, notifications } = createHarness();

    await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "remove",
      reason: "Mẫu bị rách",
    });

    const emailCall = notifications.notifyUser.mock.calls.find(
      (call) => (call[0] as { templateKey?: string }).templateKey === "booking.incident_removed_email",
    );
    expect(emailCall).toBeDefined();
    expect((emailCall![0] as { data: { html: string } }).data.html).toContain("Đơn thuê đã được cập nhật");
    expect((emailCall![0] as { data: { html: string } }).data.html).toContain("Thay đổi giá trị đơn hàng");
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "booking.incident.removal_email_sent" }) }),
    );
  });

  it("cancel: gửi email huỷ đơn kèm lý do + hoàn tiền + audit", async () => {
    const { service, prisma, notifications } = createHarness();

    await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "cancel",
      reason: "Không còn mẫu thay thế",
    });

    const emailCall = notifications.notifyUser.mock.calls.find(
      (call) => (call[0] as { templateKey?: string }).templateKey === "booking.incident_cancelled_email",
    );
    expect(emailCall).toBeDefined();
    const html = (emailCall![0] as { data: { html: string } }).data.html;
    expect(html).toContain("Không còn mẫu thay thế");
    expect(html).toContain("Số tiền hoàn dự kiến");
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "booking.incident.cancellation_email_sent" }) }),
    );
  });

  it("gộp theo đơn: nhận nhiều sự cố cùng đơn đang mở và áp dụng cho tất cả", async () => {
    const otherId = "00000000-0000-4000-8000-0000000000ab";
    const { service, prisma, createdRequests } = createHarness();
    // Cả 2 sự cố thuộc cùng đơn và còn mở (dùng cho cả kiểm tra chéo và createChangeRequest).
    prisma.bookingIncident.findMany.mockResolvedValue([
      { id: INCIDENT_ID, status: "needs_manager" },
      { id: otherId, status: "open" },
    ]);

    await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "proposal",
      reason: "Đổi cả hai món",
      type: "remove",
      incidents: [INCIDENT_ID, otherId],
    });

    // Yêu cầu đổi mẫu chứa cả hai sự cố.
    expect(createdRequests[0]).toMatchObject({ selection: expect.objectContaining({ incidentIds: [INCIDENT_ID, otherId] }) });
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [INCIDENT_ID, otherId] }, bookingId: BOOKING_ID },
        data: expect.objectContaining({ status: "awaiting_customer" }),
      }),
    );
  });

  it("gộp theo đơn: từ chối khi có sự cố không thuộc đơn của sự cố gốc", async () => {
    const foreignId = "00000000-0000-4000-8000-0000000000ad";
    const { service, prisma } = createHarness();
    // findMany chỉ trả 1 dòng → sự cố ngoài đơn không tồn tại trong phạm vi đơn này.
    prisma.bookingIncident.findMany.mockResolvedValueOnce([{ id: INCIDENT_ID, status: "needs_manager" }]);

    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, {
        action: "proposal",
        reason: "Gộp lậu",
        type: "remove",
        incidents: [INCIDENT_ID, foreignId],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.bookingChangeRequest.create).not.toHaveBeenCalled();
  });

  it("gộp theo đơn: từ chối khi một sự cố đã được xử lý", async () => {
    const closedId = "00000000-0000-4000-8000-0000000000ae";
    const { service, prisma } = createHarness();
    prisma.bookingIncident.findMany.mockResolvedValueOnce([
      { id: INCIDENT_ID, status: "needs_manager" },
      { id: closedId, status: "resolved" },
    ]);

    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, {
        action: "remove",
        reason: "Bỏ cả hai",
        incidents: [INCIDENT_ID, closedId],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.bookingChangeRequest.create).not.toHaveBeenCalled();
  });

  it("bỏ trống incidents → chỉ áp dụng sự cố trong URL (hành vi cũ)", async () => {
    const { service, createdRequests } = createHarness();

    await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "proposal",
      reason: "Chỉ một món",
      type: "remove",
    });

    expect(createdRequests[0]).toMatchObject({ selection: expect.objectContaining({ incidentIds: [INCIDENT_ID] }) });
    // Chỉ 1 sự cố → không kích hoạt nhánh kiểm tra chéo nhiều sự cố.
  });
});

describe("BookingChangeRequestsService — đóng PayOS trước khi manager cancel/remove", () => {
  it("cancel khi request awaiting_payment: releaseClosedPayosIntents strict TRƯỚC, rồi hủy", async () => {
    const { service, prisma, payments } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: REQUEST_ID,
      paymentId: "pay-charge",
      status: "awaiting_payment",
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: "pending" });

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "cancel",
      reason: "Sự cố không thể khắc phục",
    });

    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID, { strict: true });
    expect((result.data as Record<string, unknown>).status).toBe("cancelled");
  });

  it("cancel khi PayOS đang xử lý/không đọc được → 409, KHÔNG hủy", async () => {
    const { service, prisma, payments } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: REQUEST_ID,
      paymentId: "pay-charge",
      status: "awaiting_payment",
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: "pending" });
    payments.releaseClosedPayosIntents.mockRejectedValueOnce(
      new BadRequestException("Đơn hàng đang được PayOS ghi nhận thanh toán."),
    );

    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, { action: "cancel", reason: "Hết hàng" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
    expect(prisma.bookingIncident.updateMany).not.toHaveBeenCalled();
  });

  it("remove khi request awaiting_payment: đóng PayOS strict, hủy request cũ rồi áp dụng", async () => {
    const { service, prisma, payments } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: "req-old",
      paymentId: "pay-old",
      status: "awaiting_payment",
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: "pending" });

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "remove",
      reason: "Manager bỏ món",
    });

    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID, { strict: true });
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req-old", status: "awaiting_payment" },
      data: { status: "cancelled" },
    });
    expect(prisma.bookingChangeHold.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { changeRequestId: "req-old", consumedAt: null },
      }),
    );
    expect((result.data as Record<string, unknown>).status).toBe("applied");
  });

  it("remove khi PayOS đang xử lý/không đọc được → 409, KHÔNG tạo request", async () => {
    const { service, prisma, payments, createdRequests } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: "req-old",
      paymentId: "pay-old",
      status: "awaiting_payment",
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: "pending" });
    payments.releaseClosedPayosIntents.mockRejectedValueOnce(
      new BadRequestException("Đơn hàng đang được PayOS ghi nhận thanh toán."),
    );

    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, { action: "remove", reason: "Bỏ món" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createdRequests).toHaveLength(0);
  });

  it("cancel khi KHÔNG có request awaiting_payment nhưng còn Payment PayOS pending → vẫn đóng intent strict trước", async () => {
    const { service, prisma, payments } = createHarness();
    // Không có request chờ thanh toán (findFirst → null), nhưng còn QR PayOS pending.
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.payment.findFirst.mockResolvedValueOnce({ id: "pay-pending" });

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "cancel",
      reason: "Hết hàng",
    });

    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID, { strict: true });
    expect((result.data as Record<string, unknown>).status).toBe("cancelled");
  });

  it("remove khi KHÔNG có request awaiting_payment nhưng còn Payment PayOS pending → đóng strict rồi áp dụng", async () => {
    const { service, prisma, payments } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.payment.findFirst.mockResolvedValueOnce({ id: "pay-pending" });

    const result = await service.applyStaffIncidentAction(manager, INCIDENT_ID, {
      action: "remove",
      reason: "Bỏ món",
    });

    expect(payments.releaseClosedPayosIntents).toHaveBeenCalledWith(BOOKING_ID, { strict: true });
    expect((result.data as Record<string, unknown>).status).toBe("applied");
    // Không có request cũ nào để huỷ.
    expect(prisma.bookingChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("cancel/remove khi PayOS lỗi (đơn không có request, chỉ Payment pending) → 409, không đổi trạng thái", async () => {
    const { service, prisma, payments } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.payment.findFirst.mockResolvedValueOnce({ id: "pay-pending" });
    payments.releaseClosedPayosIntents.mockRejectedValueOnce(
      new BadRequestException("Đơn hàng đang được PayOS ghi nhận thanh toán."),
    );

    await expect(
      service.applyStaffIncidentAction(manager, INCIDENT_ID, { action: "cancel", reason: "Hết hàng" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
    expect(prisma.bookingIncident.updateMany).not.toHaveBeenCalled();
  });
});

describe("ManagerIncidentActionDto — body proposal", () => {
  it("chỉ nhận action/reason/type/replacements/addAccessories; amount/price bị whitelist loại bỏ", async () => {
    const { plainToInstance } = await import("class-transformer");
    const { validate } = await import("class-validator");
    const { ManagerIncidentActionDto } = await import("./dto/manager-incident-action.dto");

    const instance = plainToInstance(ManagerIncidentActionDto, {
      action: "proposal",
      reason: "Đề xuất đổi mẫu",
      type: "replace",
      replacements: [
        {
          incidentId: "00000000-0000-4000-8000-0000000000aa",
          sizeId: "00000000-0000-4000-8000-0000000000dd",
        },
      ],
      amount: 1_000_000,
      price: 1_000_000,
      customerId: CUSTOMER_ID,
      chargeAmount: 1_000_000,
    });

    const errors = await validate(instance, { whitelist: true });

    expect(errors).toHaveLength(0);
    const value = instance as unknown as Record<string, unknown>;
    expect(value).not.toHaveProperty("amount");
    expect(value).not.toHaveProperty("price");
    expect(value).not.toHaveProperty("customerId");
    expect(value).not.toHaveProperty("chargeAmount");
    expect(instance.action).toBe("proposal");
    expect(instance.replacements).toHaveLength(1);
  });

  it("thiếu reason → lỗi validate (reason bắt buộc)", async () => {
    const { plainToInstance } = await import("class-transformer");
    const { validate } = await import("class-validator");
    const { ManagerIncidentActionDto } = await import("./dto/manager-incident-action.dto");

    const errors = await validate(plainToInstance(ManagerIncidentActionDto, { action: "proposal" }));

    expect(errors.some((error) => error.property === "reason")).toBe(true);
  });
});

describe("BookingChangeRequestsService — khách xử lý đề xuất source=manager", () => {
  const customer = { id: CUSTOMER_ID, role: "customer" } as const;

  it("khách xác nhận được request source=manager (không chặn bởi source)", async () => {
    const { service, prisma } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: REQUEST_ID,
      bookingId: BOOKING_ID,
      type: "remove",
      source: "manager",
      status: "quoted",
      selection: {
        removeAccessoryItemIds: [],
        incidentIds: [INCIDENT_ID],
        replacements: [],
        addAccessories: [],
      },
      beforeSnapshot: { rentalTotal: 400_000, depositTotal: 400_000, discountTotal: 0, items: [], accessoryItems: [] },
      afterSnapshot: {
        newSubtotal: 0,
        newDiscount: 0,
        newRentalTotal: 0,
        newDepositTotal: 0,
        chargeAmount: 0,
        creditAmount: 400_000,
        adjustmentLines: [{ component: "rent", direction: "credit", amount: 400_000 }],
        wasPaid: true,
        allRemoved: false,
        removedGarmentItemIds: [ITEM_ID],
      },
      holdExpiresAt: new Date(Date.now() + 24 * 3600_000),
    });

    const result = await service.confirmChangeRequest(customer as never, BOOKING_ID, REQUEST_ID);

    expect((result.data as Record<string, unknown>).status).toBe("applied");
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "resolved" }) }),
    );
  });

  it("khách từ chối sự cố của đề xuất manager → needs_manager", async () => {
    const { service, prisma } = createHarness({
      incident: makeIncident({ status: "awaiting_customer", changeRequestId: REQUEST_ID }),
    });

    const result = await service.declineIncident(customer as never, BOOKING_ID, INCIDENT_ID);

    expect(result.data).toEqual({ id: INCIDENT_ID, status: "needs_manager" });
    expect(prisma.bookingIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INCIDENT_ID, bookingId: BOOKING_ID, status: "awaiting_customer" },
        data: expect.objectContaining({ status: "needs_manager" }),
      }),
    );
  });

  it("khách hủy được request source=manager (không lọc theo source), hold được giải phóng", async () => {
    const { service, prisma } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: REQUEST_ID,
      bookingId: BOOKING_ID,
      status: "quoted",
      source: "manager",
      paymentId: null,
    });

    const result = await service.cancelChangeRequest(customer as never, BOOKING_ID, REQUEST_ID);

    expect(result.data).toEqual({ id: REQUEST_ID, status: "cancelled" });
    // Không truy vấn theo `source` khi tìm request của khách.
    expect(prisma.bookingChangeRequest.findFirst).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, bookingId: BOOKING_ID },
      select: { status: true, paymentId: true },
    });
    expect(prisma.bookingChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, bookingId: BOOKING_ID, status: { in: expect.any(Array) } },
      data: { status: "cancelled" },
    });
    expect(prisma.bookingChangeHold.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { changeRequestId: REQUEST_ID, consumedAt: null } }),
    );
  });

  it("đổi chiếc CÙNG mẫu: giá email lấy rentalTotal đang có trong đơn, không tính lại", async () => {
    const ACC_ITEM_ID = "00000000-0000-4000-8000-0000000000c1";
    const ACC_MODEL_ID = "00000000-0000-4000-8000-0000000000c2";
    const { service, prisma } = createHarness({
      booking: makeBooking({
        accessoryItems: [
          {
            id: ACC_ITEM_ID,
            accessoryId: ACC_MODEL_ID,
            quantity: 1,
            unitPrice: new Prisma.Decimal(150_000),
            isIncluded: false,
            rentalTotal: new Prisma.Decimal(300_000),
            accessory: { id: ACC_MODEL_ID, name: "Quạt giấy", image_url: null },
          },
        ],
      }),
    });
    prisma.accessories.findMany.mockResolvedValue([
      { id: ACC_MODEL_ID, name: "Quạt giấy", image_url: null },
    ]);
    // Nếu code tính lại từ `extra_price × days` sẽ ra 50.000 × 2 = 100.000 (sai).
    prisma.garment_accessories.findFirst.mockResolvedValue({
      is_included: false,
      extra_price: new Prisma.Decimal(50_000),
    });

    const context = await service["loadEmailContext"](BOOKING_ID);
    const rows = await service["proposedItemsForEmail"](context as never, {
      accessoryReplacements: [{ incidentId: INCIDENT_ID, accessoryId: ACC_MODEL_ID }],
    } as never);

    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(300_000);
    // Không tra bảng giá khi mẫu không đổi (giá đã chốt trong đơn).
    expect(prisma.garment_accessories.findFirst).not.toHaveBeenCalled();
  });

  it("đổi sang MẪU phụ kiện khác: giá email tính lại từ garment_accessories", async () => {
    const ACC_ITEM_ID = "00000000-0000-4000-8000-0000000000c1";
    const OLD_MODEL_ID = "00000000-0000-4000-8000-0000000000c2";
    const NEW_MODEL_ID = "00000000-0000-4000-8000-0000000000c3";
    const { service, prisma } = createHarness({
      booking: makeBooking({
        accessoryItems: [
          {
            id: ACC_ITEM_ID,
            accessoryId: OLD_MODEL_ID,
            quantity: 1,
            unitPrice: new Prisma.Decimal(150_000),
            isIncluded: false,
            rentalTotal: new Prisma.Decimal(300_000),
            accessory: { id: OLD_MODEL_ID, name: "Quạt giấy", image_url: null },
          },
        ],
      }),
    });
    prisma.accessories.findMany.mockResolvedValue([
      { id: NEW_MODEL_ID, name: "Quạt lụa", image_url: null },
    ]);
    prisma.garment_accessories.findFirst.mockResolvedValue({
      is_included: false,
      extra_price: new Prisma.Decimal(50_000),
    });

    const context = await service["loadEmailContext"](BOOKING_ID);
    const rows = await service["proposedItemsForEmail"](context as never, {
      accessoryReplacements: [{ incidentId: INCIDENT_ID, accessoryId: NEW_MODEL_ID }],
    } as never);

    expect(rows).toHaveLength(1);
    // Mẫu mới → tính lại theo garment_accessories: 50.000 × 2 ngày = 100.000.
    expect(rows[0].price).toBe(100_000);
  });

  it("khách xác nhận request source=manager nhưng hold đã hết hạn → 409", async () => {
    const { service, prisma } = createHarness();
    prisma.bookingChangeRequest.findFirst.mockResolvedValueOnce({
      id: REQUEST_ID,
      bookingId: BOOKING_ID,
      type: "remove",
      source: "manager",
      status: "quoted",
      selection: { removeAccessoryItemIds: [], incidentIds: [INCIDENT_ID], replacements: [], addAccessories: [] },
      beforeSnapshot: { rentalTotal: 400_000, depositTotal: 400_000, discountTotal: 0, items: [], accessoryItems: [] },
      afterSnapshot: {
        newSubtotal: 0,
        newDiscount: 0,
        newRentalTotal: 0,
        newDepositTotal: 0,
        chargeAmount: 0,
        creditAmount: 400_000,
        adjustmentLines: [],
        wasPaid: true,
        allRemoved: false,
        removedGarmentItemIds: [ITEM_ID],
      },
      // Hold đã hết hạn từ trước.
      holdExpiresAt: new Date(Date.now() - 60_000),
    });
    prisma.bookingChangeHold.findMany.mockResolvedValueOnce([
      {
        id: "hold-1",
        kind: "garment",
        garmentAssetId: "asset-1",
        accessoryAssetId: null,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);

    await expect(
      service.confirmChangeRequest(customer as never, BOOKING_ID, REQUEST_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.bookingIncident.updateMany).not.toHaveBeenCalled();
  });
});
