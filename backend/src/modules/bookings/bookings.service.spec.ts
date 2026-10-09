import { validate } from "class-validator";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BookingsService } from "./bookings.service";
import { ConditionBeforeRental, ConfirmHandoverDto, HandoverStatus } from "./dto/confirm-handover.dto";

const SIZE_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const GARMENT_ID = "00000000-0000-4000-8000-000000000005";
const ASSET_ID = "00000000-0000-4000-8000-000000000006";
const STAFF_ID = "00000000-0000-4000-8000-000000000007";

process.env.SUPABASE_URL = "https://example.supabase.co";
const HANDOVER_IMAGE = `https://example.supabase.co/storage/v1/object/public/products/handover/${STAFF_ID}/00000000-0000-4000-8000-000000000008.jpg`;

function makeBooking(startDate: string, endDate: string, overrides?: { status?: string; penaltyTotal?: number }) {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: overrides?.status ?? "pending_confirmation",
    rentalStartDate: new Date(`${startDate}T00:00:00.000Z`),
    rentalEndDate: new Date(`${endDate}T00:00:00.000Z`),
    pickupMethod: "store_pickup",
    rentalTotal: 100,
    depositTotal: 50,
    penaltyTotal: overrides?.penaltyTotal ?? 0,
    shippingFee: 0,
    paymentMethod: "cash",
    note: null,
    deliveryAddressId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    items: [
      {
        id: ITEM_ID,
        garmentId: GARMENT_ID,
        garment_size_id: SIZE_ID,
        dailyPrice: 100,
        depositAmount: 50,
        garmentAssetId: null,
        garmentAsset: null,
        garment_sizes: {
          size_label: "M",
          garments: { name: "Áo dài mẫu" },
        },
      },
    ],
    deliveryAddress: null,
  };
}

function createService(options?: {
  committed?: number;
  capacity?: number;
  serializeTransactions?: boolean;
}) {
  const size = {
    id: SIZE_ID,
    garment_id: GARMENT_ID,
    size_label: "M",
    deposit_amount: 50,
    is_active: true,
    garments: { name: "Áo dài mẫu" },
  };
  const committed = options?.committed ?? 0;
  const capacity = options?.capacity ?? 1;
  let transactionQueue = Promise.resolve();
  let successfulTransactions = 0;

  const tx = {
    garmentAsset: {
      count: vi.fn().mockResolvedValue(capacity),
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: capacity }, (_, index) => ({ id: `asset-${index + 1}`, status: "available" })),
      ),
    },
    garment_sizes: {
      findFirst: vi.fn().mockResolvedValue({ id: SIZE_ID }),
    },
    bookingItem: {
      count: vi.fn().mockImplementation(async () => committed + successfulTransactions),
      findMany: vi.fn().mockImplementation(async () => committed + successfulTransactions > 0 ? [{ garmentAssetId: null, booking: { id: "existing", status: "confirmed", rentalStartDate: new Date("2026-01-01"), rentalEndDate: new Date("2026-12-31") } }] : []),
    },
    booking: {
      create: vi.fn().mockImplementation(async () => {
        successfulTransactions += 1;
        return makeBooking("2026-10-10", "2026-10-12");
      }),
    },
    accessories: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    accessory_assets: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  const prisma = {
    userAccount: {
      findUnique: vi.fn().mockResolvedValue({ email: "customer@example.com", profile: { fullName: "Test Customer" } }),
    },
    garment_sizes: {
      findMany: vi.fn().mockResolvedValue([size]),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const run = async () => callback(tx);
      if (!options?.serializeTransactions) return run();

      const current = transactionQueue.then(run);
      transactionQueue = current.then(() => undefined, () => undefined);
      return current;
    }),
    runSerializable: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      return prisma.$transaction(callback);
    }),
  };

  const service = new BookingsService(
    prisma as never,
    { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
    {} as never,
    { effectiveDailyPrice: vi.fn().mockResolvedValue(100), quoteRental: vi.fn().mockResolvedValue(new Map()) } as never,
    { bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn(), assetChanged: vi.fn(), inspectionChanged: vi.fn(), refundChanged: vi.fn(), laundryChanged: vi.fn(), maintenanceChanged: vi.fn(), notificationCreated: vi.fn() } as never,
  );

  return { service, prisma, tx };
}

function makeHandoverBooking(overrides?: {
  status?: string;
  handoverStatus?: string | null;
  assetStatus?: string;
  conditionImages?: unknown;
  conditionBeforeRental?: string | null;
  confirmedAt?: Date | null;
  confirmedBy?: string | null;
}) {
  return {
    ...makeBooking("2026-10-10", "2026-10-12", { status: overrides?.status ?? "ready_for_pickup" }),
    handoverStatus: overrides?.handoverStatus ?? null,
    conditionBeforeRental: overrides?.conditionBeforeRental ?? null,
    conditionImages: overrides?.conditionImages ?? null,
    confirmedAt: overrides?.confirmedAt ?? null,
    confirmedBy: overrides?.confirmedBy ?? null,
    payments: [],
    items: [
      {
        id: ITEM_ID,
        garmentId: GARMENT_ID,
        garment_size_id: SIZE_ID,
        dailyPrice: 100,
        depositAmount: 50,
        garmentAssetId: ASSET_ID,
        garmentAsset: {
          id: ASSET_ID,
          garmentId: GARMENT_ID,
          garment_size_id: SIZE_ID,
          status: overrides?.assetStatus ?? "reserved",
          assetCode: "AD-001",
          conditionNote: null,
        },
        garment_sizes: {
          size_label: "M",
          garments: { name: "Áo dài mẫu", images: [{ imageUrl: "https://example.com/aodai.jpg" }] },
        },
      },
    ],
    deliveryAddress: null,
  };
}

function handoverDto(overrides?: Partial<ConfirmHandoverDto>): ConfirmHandoverDto {
  return {
    handoverStatus: HandoverStatus.CONFIRMED,
    conditionBeforeRental: ConditionBeforeRental.GOOD,
    conditionImages: [HANDOVER_IMAGE],
    correctProductConfirmed: true,
    noDefectConfirmed: true,
    customerAgreed: true,
    deliveredBy: "Staff A",
    receivedBy: "Customer A",
    receiverPhone: "0900000000",
    note: "Looks good",
    ...overrides,
  };
}

function createHandoverService(initialBooking = makeHandoverBooking()) {
  let booking = initialBooking;
  const realtime = {
    bookingChanged: vi.fn(),
    bookingChangedForCustomer: vi.fn(),
    assetChanged: vi.fn(),
    inspectionChanged: vi.fn(),
    refundChanged: vi.fn(),
    laundryChanged: vi.fn(),
    maintenanceChanged: vi.fn(),
    notificationCreated: vi.fn(),
  };

  const tx = {
    booking: {
      findUnique: vi.fn().mockImplementation(async () => booking),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => booking),
      updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        booking = { ...booking, ...data };
        return { count: 1 };
      }),
    },
    bookingItem: {
      findMany: vi.fn().mockResolvedValue([{ id: ITEM_ID, bookingId: BOOKING_ID, garmentAssetId: ASSET_ID, booking: { id: BOOKING_ID, status: "ready_for_pickup", rentalStartDate: booking.rentalStartDate, rentalEndDate: booking.rentalEndDate } }]),
    },
    garmentAsset: {
      findUnique: vi.fn().mockImplementation(async () => booking.items[0].garmentAsset),
      updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status?: string } }) => {
        booking = {
          ...booking,
          items: booking.items.map((item) => ({
            ...item,
            garmentAsset: item.garmentAsset ? { ...item.garmentAsset, ...data } : item.garmentAsset,
          })),
        };
        return { count: booking.items.length };
      }),
    },
    bookingStatusHistory: {
      create: vi.fn().mockResolvedValue({ id: "history-1" }),
    },
  };

  const prisma = {
    runSerializable: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  const service = new BookingsService(
    prisma as never,
    { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
    {} as never,
    { effectiveDailyPrice: vi.fn().mockResolvedValue(100), quoteRental: vi.fn().mockResolvedValue(new Map()) } as never,
    realtime as never,
  );

  return { service, prisma, tx, realtime, getBooking: () => booking };
}

const dto = (startDate: string, endDate: string) => ({
  garmentSizeIds: [SIZE_ID],
  startDate,
  endDate,
  pickupMethod: "store_pickup",
  paymentMethod: "cash",
});

describe("BookingsService.create availability", () => {
  it("rejects a booking whose dates overlap an existing booking", async () => {
    const { service, tx } = createService({ committed: 1, capacity: 1 });

    await expect(service.create(CUSTOMER_ID, dto("2026-10-11", "2026-10-13"))).rejects.toThrow(
      "không còn đủ sản phẩm khả dụng",
    );

    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.bookingItem.findMany).toHaveBeenCalled();
    expect(tx.garmentAsset.findMany).toHaveBeenCalled();
  });

  it("allows bookings that only touch at the checkout/pickup boundary", async () => {
    const { service, tx } = createService({ committed: 0, capacity: 1 });

    await expect(service.create(CUSTOMER_ID, dto("2026-10-12", "2026-10-14"))).resolves.toBeDefined();

    expect(tx.booking.create).toHaveBeenCalledTimes(1);
    expect(tx.bookingItem.findMany).toHaveBeenCalled();
    expect(tx.garmentAsset.findMany).toHaveBeenCalled();
  });

  it("allows only one of two concurrent bookings when one asset is available", async () => {
    const { service } = createService({ committed: 0, capacity: 1, serializeTransactions: true });

    const results = await Promise.allSettled([
      service.create(CUSTOMER_ID, dto("2026-11-10", "2026-11-12")),
      service.create("00000000-0000-4000-8000-000000000006", dto("2026-11-10", "2026-11-12")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});

describe("BookingsService handover", () => {
  it("confirms a ready_for_pickup handover, advances booking to renting, and marks reserved assets as rented", async () => {
    const { service, tx, realtime } = createHandoverService();

    const result = await service.confirmHandover(BOOKING_ID, handoverDto(), { id: STAFF_ID, role: "staff" });
    expect(result.data).toBeDefined();
    const data = result.data!;

    expect(data.status).toBe("renting");
    expect(data.handover.status).toBe("CONFIRMED");
    expect(data.handover.correctProduct).toBe(true);
    expect(data.handover.noVisibleDefect).toBe(true);
    expect(data.handover.customerAgreed).toBe(true);
    expect(data.handover.images).toEqual([HANDOVER_IMAGE]);
    expect(data.handover.note).toBe("Looks good");
    expect(data.handover.receiverName).toBe("Customer A");
    expect(data.handover.deliveryPersonName).toBe("Staff A");
    expect(data.handover.receiverPhone).toBe("0900000000");
    expect(data.handover.confirmedBy).toBe(STAFF_ID);
    expect(data.handover.decidedAt).toEqual(expect.any(String));
    expect(data.handover.receivedAt).toEqual(data.handover.decidedAt);
    expect(data.items[0].assetStatus).toBe("rented");

    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: BOOKING_ID, status: "ready_for_pickup", handoverStatus: null },
      data: expect.objectContaining({
        status: "renting",
        handoverStatus: "CONFIRMED",
        conditionBeforeRental: "GOOD",
        confirmedBy: STAFF_ID,
      }),
    }));
    expect(tx.garmentAsset.updateMany).toHaveBeenCalledWith({
      where: { id: ASSET_ID, status: "reserved" },
      data: { status: "rented" },
    });
    expect(tx.bookingStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        fromStatus: "ready_for_pickup",
        toStatus: "renting",
        changedBy: STAFF_ID,
        note: "Bàn giao CONFIRMED: Looks good",
      }),
    });
    expect(realtime.bookingChanged).toHaveBeenCalledWith({ id: BOOKING_ID, bookingId: BOOKING_ID, status: "renting" });
    expect(realtime.assetChanged).toHaveBeenCalledWith({ bookingId: BOOKING_ID });
    expect(realtime.bookingChangedForCustomer).toHaveBeenCalledWith(CUSTOMER_ID, {
      id: BOOKING_ID,
      bookingId: BOOKING_ID,
      status: "renting",
    });
  });

  it("preserves the booking status and reserved asset when handover is rejected", async () => {
    const { service, tx, realtime } = createHandoverService();

    const result = await service.confirmHandover(
      BOOKING_ID,
      handoverDto({ handoverStatus: HandoverStatus.REJECTED, note: "Customer saw a defect" }),
      { id: STAFF_ID, role: "staff" },
    );
    expect(result.data).toBeDefined();
    const data = result.data!;

    expect(data.status).toBe("ready_for_pickup");
    expect(data.handover.status).toBe("REJECTED");
    expect(data.handover.note).toBe("Customer saw a defect");
    expect(data.handover.receivedAt).toBeNull();
    expect(data.items[0].assetStatus).toBe("reserved");
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ready_for_pickup", handoverStatus: "REJECTED" }),
    }));
    expect(tx.garmentAsset.updateMany).not.toHaveBeenCalled();
    expect(tx.bookingStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: "ready_for_pickup", toStatus: "ready_for_pickup" }),
    });
    expect(realtime.assetChanged).not.toHaveBeenCalled();
  });

  it("requires the confirmation checklist before confirming handover", async () => {
    const { service, tx } = createHandoverService();

    await expect(service.confirmHandover(
      BOOKING_ID,
      handoverDto({ correctProductConfirmed: false }),
      { id: STAFF_ID, role: "staff" },
    )).rejects.toThrow("Cần xác nhận đúng sản phẩm");

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.garmentAsset.updateMany).not.toHaveBeenCalled();
    expect(tx.bookingStatusHistory.create).not.toHaveBeenCalled();
  });

  it("requires a rejection note when handover is rejected", async () => {
    const { service, tx } = createHandoverService();

    await expect(service.confirmHandover(
      BOOKING_ID,
      handoverDto({ handoverStatus: HandoverStatus.REJECTED, note: "   " }),
      { id: STAFF_ID, role: "staff" },
    )).rejects.toThrow("Cần ghi rõ lý do từ chối bàn giao.");

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.garmentAsset.updateMany).not.toHaveBeenCalled();
    expect(tx.bookingStatusHistory.create).not.toHaveBeenCalled();
  });

  it("requires evidence, actor names, and minor-damage description for confirmation", async () => {
    const { service, tx } = createHandoverService();
    await expect(service.confirmHandover(BOOKING_ID, handoverDto({ conditionImages: [] }), { id: STAFF_ID, role: "staff" })).rejects.toThrow("ảnh bàn giao");
    await expect(service.confirmHandover(BOOKING_ID, handoverDto({ deliveredBy: "  " }), { id: STAFF_ID, role: "staff" })).rejects.toThrow("người giao");
    await expect(service.confirmHandover(BOOKING_ID, handoverDto({ receivedBy: "  " }), { id: STAFF_ID, role: "staff" })).rejects.toThrow("người giao");
    await expect(service.confirmHandover(BOOKING_ID, handoverDto({ conditionBeforeRental: ConditionBeforeRental.MINOR_DAMAGE, note: "  " }), { id: STAFF_ID, role: "staff" })).rejects.toThrow("mô tả lỗi nhẹ");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("blocks direct advanceStatus to renting until handover is confirmed", async () => {
    const booking = makeHandoverBooking();
    const tx = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({ ...booking, payments: [], penalties: [] }),
        updateMany: vi.fn(),
      },
      garmentAsset: { updateMany: vi.fn() },
      bookingStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      runSerializable: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new BookingsService(
      prisma as never,
      { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
      {} as never,
      { effectiveDailyPrice: vi.fn().mockResolvedValue(100), quoteRental: vi.fn().mockResolvedValue(new Map()) } as never,
      { bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn(), assetChanged: vi.fn(), inspectionChanged: vi.fn(), refundChanged: vi.fn(), laundryChanged: vi.fn(), maintenanceChanged: vi.fn(), notificationCreated: vi.fn() } as never,
    );

    await expect(service.advanceStatus(BOOKING_ID, { status: "renting" }, STAFF_ID)).rejects.toThrow(
      "Vui lòng xác nhận bàn giao trước khi chuyển đơn sang trạng thái đang thuê.",
    );

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.garmentAsset.updateMany).not.toHaveBeenCalled();
    expect(tx.bookingStatusHistory.create).not.toHaveBeenCalled();
  });
});

describe("BookingsService delivery workflow", () => {
  const immutableSnapshot = {
    version: 1 as const,
    receiverName: "Original Receiver",
    phone: "0900000000",
    line1: "1 Original Street",
    ward: "Ward 1",
    district: "District 1",
    city: "HCMC",
    latitude: 10.77,
    longitude: 106.69,
  };

  function createDeliveryService(status: "ready_for_pickup" | "renting") {
    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    const assetStatus = status === "renting" ? "rented" : "reserved";
    let booking: any = {
      ...makeHandoverBooking({ status, assetStatus }),
      pickupMethod: "delivery",
      customerId: CUSTOMER_ID,
      penalties: [],
      deliveryAddress: {
        receiverName: "Edited Receiver",
        phone: "0999999999",
        line1: "99 Edited Street",
        ward: "Edited Ward",
        district: "Edited District",
        city: "Edited City",
        latitude: 1,
        longitude: 2,
      },
      deliveryRecords: [{
        id: "delivery-original",
        method: "delivery",
        addressSnapshot: JSON.stringify(immutableSnapshot),
        deliveredAt: null,
        receivedAt: null,
        note: null,
        createdAt,
      }],
    };

    const tx = {
      booking: {
        findUnique: vi.fn().mockImplementation(async () => booking),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => booking),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          booking = { ...booking, ...data };
          return { count: 1 };
        }),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          booking = { ...booking, ...data };
          return booking;
        }),
      },
      bookingItem: {
        findMany: vi.fn().mockImplementation(async () => booking.items.map((item: any) => ({
          id: item.id,
          bookingId: BOOKING_ID,
          garmentAssetId: item.garmentAssetId,
          booking: {
            id: BOOKING_ID,
            status: booking.status,
            rentalStartDate: booking.rentalStartDate,
            rentalEndDate: booking.rentalEndDate,
          },
        }))),
      },
      garmentAsset: {
        findUnique: vi.fn().mockImplementation(async () => booking.items[0].garmentAsset),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
          booking = {
            ...booking,
            items: booking.items.map((item: any) => ({
              ...item,
              garmentAsset: { ...item.garmentAsset, status: data.status },
            })),
          };
          return { count: 1 };
        }),
      },
      deliveryRecord: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          const record = {
            id: `delivery-${booking.deliveryRecords.length + 1}`,
            deliveredAt: null,
            receivedAt: null,
            note: null,
            ...data,
            createdAt: new Date("2026-10-08T00:00:00.000Z"),
          };
          booking = { ...booking, deliveryRecords: [record, ...booking.deliveryRecords] };
          return record;
        }),
      },
      bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "history-1" }) },
      penalty: { create: vi.fn(), update: vi.fn() },
    };
    const realtime = {
      bookingChanged: vi.fn(),
      bookingChangedForCustomer: vi.fn(),
      assetChanged: vi.fn(),
      inspectionChanged: vi.fn(),
      refundChanged: vi.fn(),
      laundryChanged: vi.fn(),
      maintenanceChanged: vi.fn(),
      notificationCreated: vi.fn(),
    };
    const prisma = {
      runSerializable: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new BookingsService(
      prisma as never,
      { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
      {} as never,
      { effectiveDailyPrice: vi.fn().mockResolvedValue(100) } as never,
      realtime as never,
    );
    return { service, tx, realtime, getBooking: () => booking };
  }

  it("marks a delivery in progress without replacing the immutable address snapshot", async () => {
    const { service, tx, realtime } = createDeliveryService("ready_for_pickup");

    const result = await service.markDelivered(BOOKING_ID, { note: "  Handed to courier  " }, STAFF_ID);

    expect(result.data).toBeDefined();
    expect(result.data!.status).toBe("delivering");
    expect(result.data!.deliverySnapshot).toEqual(immutableSnapshot);
    expect(tx.deliveryRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        method: "delivery",
        addressSnapshot: JSON.stringify(immutableSnapshot),
        note: "Handed to courier",
      }),
    });
    expect(tx.bookingStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: "ready_for_pickup",
        toStatus: "delivering",
        changedBy: STAFF_ID,
      }),
    });
    expect(realtime.bookingChangedForCustomer).toHaveBeenCalledWith(CUSTOMER_ID, expect.objectContaining({ status: "delivering" }));
  });

  it("transitions rented assets before marking a booking returned", async () => {
    const { service, tx, realtime, getBooking } = createDeliveryService("renting");

    const result = await service.markReturned(BOOKING_ID, { note: "  Returned at store  " }, STAFF_ID);

    expect(result.data).toBeDefined();
    expect(result.data!.status).toBe("returned");
    expect(result.data!.deliverySnapshot).toEqual(immutableSnapshot);
    expect(getBooking().items[0].garmentAsset.status).toBe("inspection_pending");
    expect(tx.garmentAsset.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.booking.updateMany.mock.invocationCallOrder[0]);
    expect(tx.deliveryRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        method: "return",
        addressSnapshot: JSON.stringify(immutableSnapshot),
        note: "Returned at store",
      }),
    });
    expect(realtime.assetChanged).toHaveBeenCalledWith({ bookingId: BOOKING_ID });
    expect(realtime.bookingChangedForCustomer).toHaveBeenCalledWith(CUSTOMER_ID, expect.objectContaining({ status: "returned" }));
  });
});

describe("ConfirmHandoverDto validation", () => {
  it("validates required handover status and condition before rental fields", async () => {
    const dto = new ConfirmHandoverDto();

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "handoverStatus",
      "conditionBeforeRental",
    ]));
  });

  it("validates handover rejection note type when present", async () => {
    const dto = Object.assign(new ConfirmHandoverDto(), {
      handoverStatus: HandoverStatus.REJECTED,
      conditionBeforeRental: ConditionBeforeRental.MINOR_DAMAGE,
      note: 123,
    });

    const errors = await validate(dto);

    expect(errors.find((error) => error.property === "note")?.constraints).toHaveProperty("isString");
  });
});

describe("BookingsService.create accessories", () => {
  const ACCESSORY_ID = "00000000-0000-4000-8000-000000000009";

  function createAccessoryService(link: { quantity: number; is_included: boolean; extra_price: number } | null) {
    const { service, prisma, tx } = createService({ committed: 0, capacity: 1 });
    (prisma as unknown as Record<string, unknown>).garment_accessories = {
      findMany: vi.fn().mockResolvedValue(
        link ? [{ garment_id: GARMENT_ID, accessory_id: ACCESSORY_ID, ...link }] : [],
      ),
    };
    (tx as unknown as Record<string, unknown>).bookingAccessoryItem = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000010" }),
    };
    // Kho phụ kiện đủ cho các test tạo đơn (không test cạn kho ở đây).
    (tx as unknown as Record<string, unknown>).accessory_assets = {
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: `acc-asset-${i}`, status: "available" })),
      ),
    };
    return { service, prisma, tx };
  }

  it("creates booking accessory items and adds extra price (per day x qty x days) to subtotal", async () => {
    const { service, tx } = createAccessoryService({ quantity: 1, is_included: false, extra_price: 20000 });

    const result = await service.create(CUSTOMER_ID, {
      ...dto("2026-10-10", "2026-10-12"),
      accessories: [{ garmentSizeId: SIZE_ID, accessoryId: ACCESSORY_ID }],
    });

    expect(result.data).toBeDefined();
    expect((tx as unknown as { bookingAccessoryItem: { create: ReturnType<typeof vi.fn> } }).bookingAccessoryItem.create).toHaveBeenCalledTimes(1);
    const createArg = (tx.booking.create as unknown as { mock: { calls: Array<Array<{ data: { subtotal: number } }>> } }).mock.calls[0][0];
    // 3 ngày thuê × 20.000đ × 1 = 60.000đ (giá garment trong mock = 0).
    expect(Number(createArg.data.subtotal)).toBe(60000);
  });

  it("splits quantity 3 into 3 unit rows so each unit gets its own asset", async () => {
    const { service, tx } = createAccessoryService({ quantity: 3, is_included: false, extra_price: 20000 });

    const result = await service.create(CUSTOMER_ID, {
      ...dto("2026-10-10", "2026-10-12"),
      accessories: [{ garmentSizeId: SIZE_ID, accessoryId: ACCESSORY_ID }],
    });

    expect(result.data).toBeDefined();
    const createMock = (tx as unknown as { bookingAccessoryItem: { create: ReturnType<typeof vi.fn> } }).bookingAccessoryItem.create;
    expect(createMock).toHaveBeenCalledTimes(3);
    for (const call of createMock.mock.calls) {
      expect(call[0].data.quantity).toBe(1);
    }
    const createArg = (tx.booking.create as unknown as { mock: { calls: Array<Array<{ data: { subtotal: number } }>> } }).mock.calls[0][0];
    // 3 đơn vị × 3 ngày × 20.000đ = 180.000đ (tổng tiền không đổi khi tách dòng).
    expect(Number(createArg.data.subtotal)).toBe(180000);
  });

  it("does not charge subtotal for included (free) accessories but still records them", async () => {
    const { service, tx } = createAccessoryService({ quantity: 2, is_included: true, extra_price: 0 });

    await service.create(CUSTOMER_ID, {
      ...dto("2026-10-10", "2026-10-12"),
      accessories: [{ garmentSizeId: SIZE_ID, accessoryId: ACCESSORY_ID }],
    });

    // Số lượng 2 → tách thành 2 dòng đơn vị, đều miễn phí nên subtotal = 0.
    expect((tx as unknown as { bookingAccessoryItem: { create: ReturnType<typeof vi.fn> } }).bookingAccessoryItem.create).toHaveBeenCalledTimes(2);
    const createArg = (tx.booking.create as unknown as { mock: { calls: Array<Array<{ data: { subtotal: number } }>> } }).mock.calls[0][0];
    expect(Number(createArg.data.subtotal)).toBe(0);
  });

  it("rejects accessories that do not belong to the ordered garment", async () => {    const { service, tx } = createAccessoryService(null);

    await expect(service.create(CUSTOMER_ID, {
      ...dto("2026-10-10", "2026-10-12"),
      accessories: [{ garmentSizeId: SIZE_ID, accessoryId: ACCESSORY_ID }],
    })).rejects.toThrow("không thuộc sản phẩm");

    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("rejects creating when accessories exceed available stock for the dates", async () => {
    const { service, tx } = createAccessoryService({ quantity: 3, is_included: false, extra_price: 20000 });
    // Kho chỉ còn 1 asset khả dụng nhưng đơn cần 3 đơn vị.
    ((tx as unknown as { accessory_assets: { findMany: ReturnType<typeof vi.fn> } }).accessory_assets.findMany)
      .mockResolvedValue([{ id: "only-one", status: "available" }]);

    await expect(service.create(CUSTOMER_ID, {
      ...dto("2026-10-10", "2026-10-12"),
      accessories: [{ garmentSizeId: SIZE_ID, accessoryId: ACCESSORY_ID }],
    })).rejects.toThrow("không còn đủ số lượng khả dụng");

    expect(tx.booking.create).not.toHaveBeenCalled();
  });
});

describe("BookingsService.assignAccessoryAsset", () => {
  const ACCESSORY_ID = "00000000-0000-4000-8000-000000000009";
  const ACCESSORY_ITEM_ID = "00000000-0000-4000-8000-000000000010";
  const ACCESSORY_ASSET_ID = "00000000-0000-4000-8000-000000000011";

  function createAssignService(
    asset: { accessory_id: string; status: string },
    itemOverrides?: { quantity?: number; unitPrice?: number; isIncluded?: boolean },
  ) {
    const booking = {
      ...makeBooking("2026-10-10", "2026-10-12", { status: "confirmed" }),
      accessoryItems: [
        {
          id: ACCESSORY_ITEM_ID,
          bookingId: BOOKING_ID,
          bookingItemId: ITEM_ID,
          accessoryId: ACCESSORY_ID,
          accessoryAssetId: null,
          quantity: 1,
          unitPrice: 20000,
          isIncluded: false,
          ...itemOverrides,
        },
      ],
    };
    const tx = {
      booking: { findUnique: vi.fn().mockResolvedValue(booking) },
      accessory_assets: { findUnique: vi.fn().mockResolvedValue({ id: ACCESSORY_ASSET_ID, ...asset, asset_code: "PK-001" }) },
      bookingAccessoryItem: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: ACCESSORY_ITEM_ID }),
        create: vi.fn().mockResolvedValue({ id: "new-acc-item" }),
      },
      bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "history-1" }) },
    };
    const prisma = {
      runSerializable: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
      booking: { findUnique: vi.fn().mockResolvedValue(booking) },
    };
    const service = new BookingsService(
      prisma as never,
      { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
      {} as never,
      {} as never,
      { bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn(), assetChanged: vi.fn() } as never,
    );
    return { service, tx };
  }

  it("assigns an accessory asset belonging to the same accessory", async () => {
    const { service, tx } = createAssignService({ accessory_id: ACCESSORY_ID, status: "available" });

    const result = await service.assignAccessoryAsset(BOOKING_ID, ACCESSORY_ITEM_ID, { accessoryAssetId: ACCESSORY_ASSET_ID });

    expect(result.data).toBeDefined();
    // Dòng quantity 1: gán asset, chốt quantity = 1 và rentalTotal theo snapshot.
    expect(tx.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: { quantity: 1, accessoryAssetId: ACCESSORY_ASSET_ID, rentalTotal: 60000 },
    });
    expect(tx.bookingAccessoryItem.create).not.toHaveBeenCalled();
  });

  it("splits a legacy quantity-3 row on assign so remaining units stay assignable", async () => {
    const { service, tx } = createAssignService(
      { accessory_id: ACCESSORY_ID, status: "available" },
      { quantity: 3 },
    );

    const result = await service.assignAccessoryAsset(BOOKING_ID, ACCESSORY_ITEM_ID, { accessoryAssetId: ACCESSORY_ASSET_ID });

    expect(result.data).toBeDefined();
    expect(tx.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: { quantity: 1, accessoryAssetId: ACCESSORY_ASSET_ID, rentalTotal: 60000 },
    });
    // Phần còn lại (2 đơn vị) tách thành dòng mới chưa gán, tổng tiền giữ nguyên.
    expect(tx.bookingAccessoryItem.create).toHaveBeenCalledTimes(1);
    const remainder = (tx.bookingAccessoryItem.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(remainder.quantity).toBe(2);
    expect(Number(remainder.rentalTotal)).toBe(120000);
    expect(remainder.accessoryAssetId).toBeUndefined();
  });

  it("rejects an asset that belongs to a different accessory", async () => {
    const { service, tx } = createAssignService({ accessory_id: "00000000-0000-4000-8000-000000000099", status: "available" });

    await expect(service.assignAccessoryAsset(BOOKING_ID, ACCESSORY_ITEM_ID, { accessoryAssetId: ACCESSORY_ASSET_ID }))
      .rejects.toThrow("không thuộc phụ kiện");

    expect(tx.bookingAccessoryItem.update).not.toHaveBeenCalled();
  });
});

describe("BookingsService.advanceStatus accessories", () => {
  function createAdvanceService(accessories: Array<{ id: string; accessoryAssetId: string | null }>) {
    const booking = {
      ...makeBooking("2026-10-10", "2026-10-12", { status: "paid" }),
      handoverStatus: null,
      items: [
        { id: ITEM_ID, garmentId: GARMENT_ID, garment_size_id: SIZE_ID, garmentAssetId: ASSET_ID },
      ],
      payments: [],
      penalties: [],
    };
    const tx = {
      booking: {
        findUnique: vi.fn().mockResolvedValue(booking),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn(),
      },
      bookingAccessoryItem: { findMany: vi.fn().mockResolvedValue(accessories) },
      bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    };
    const savedBooking = {
      ...booking,
      status: "preparing",
      items: booking.items,
      payments: [],
      deliveryRecords: [],
      accessoryItems: [],
    };
    (tx.booking as { findUnique: ReturnType<typeof vi.fn> }).findUnique
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(savedBooking);
    const prisma = {
      runSerializable: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    const service = new BookingsService(
      prisma as never,
      { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
      {} as never,
      {} as never,
      { bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn(), assetChanged: vi.fn() } as never,
    );
    return { service, tx };
  }

  it("blocks preparing when an accessory has no assigned asset", async () => {
    const { service } = createAdvanceService([{ id: "acc-1", accessoryAssetId: null }]);

    await expect(service.advanceStatus(BOOKING_ID, { status: "preparing" } as never))
      .rejects.toThrow("accessories must have an assigned asset");
  });

  it("allows preparing when all accessories are assigned", async () => {
    const { service, tx } = createAdvanceService([{ id: "acc-1", accessoryAssetId: ASSET_ID }]);

    // claimBookingAssets needs garment asset rows; stub minimal garment asset flow.
    (tx as unknown as Record<string, unknown>).garmentAsset = {
      findUnique: vi.fn().mockResolvedValue({ id: ASSET_ID, status: "available", garmentId: GARMENT_ID, garment_size_id: SIZE_ID }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    (tx as unknown as Record<string, unknown>).bookingItem = {
      findMany: vi.fn().mockResolvedValue([]),
    };

    const result = await service.advanceStatus(BOOKING_ID, { status: "preparing" } as never);
    expect(result.data).toBeDefined();
  });
});

describe("BookingsService.checkAccessoryAvailability", () => {
  const ACCESSORY_ID = "00000000-0000-4000-8000-000000000009";

  function createCheckService(rows: Array<{ status: string; start: string; end: string }>, assetStatuses: string[]) {
    const prisma = {
      accessories: {
        findFirst: vi.fn().mockResolvedValue({ id: ACCESSORY_ID, is_active: true }),
      },
      accessory_assets: {
        findMany: vi.fn().mockResolvedValue(assetStatuses.map((status, i) => ({ id: `aa-${i}`, status }))),
      },
      bookingAccessoryItem: {
        findMany: vi.fn().mockResolvedValue(
          rows.map((r, i) => ({
            booking: {
              id: `b-${i}`,
              status: r.status,
              rentalStartDate: new Date(`${r.start}T00:00:00.000Z`),
              rentalEndDate: new Date(`${r.end}T00:00:00.000Z`),
            },
          })),
        ),
      },
    };
    const service = new BookingsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service };
  }

  it("reports available when demand fits capacity", async () => {
    const { service } = createCheckService(
      [{ status: "renting", start: "2026-10-10", end: "2026-10-12" }],
      ["available", "available"],
    );
    const res = await service.checkAccessoryAvailability({
      accessoryId: ACCESSORY_ID, startDate: "2026-10-10", endDate: "2026-10-12", quantity: 1,
    });
    expect(res.data?.available).toBe(true);
    expect(res.data?.availableCount).toBe(1);
    expect(res.data?.totalAssets).toBe(2);
  });

  it("reports unavailable when overlapping demand covers capacity", async () => {
    const { service } = createCheckService(
      [
        { status: "renting", start: "2026-10-10", end: "2026-10-12" },
        { status: "confirmed", start: "2026-10-11", end: "2026-10-13" },
      ],
      ["available", "available"],
    );
    const res = await service.checkAccessoryAvailability({
      accessoryId: ACCESSORY_ID, startDate: "2026-10-10", endDate: "2026-10-12", quantity: 1,
    });
    expect(res.data?.available).toBe(false);
    expect(res.data?.availableCount).toBe(0);
  });

  it("ignores released bookings in demand", async () => {
    const { service } = createCheckService(
      [{ status: "cancelled", start: "2026-10-10", end: "2026-10-12" }],
      ["available"],
    );
    const res = await service.checkAccessoryAvailability({
      accessoryId: ACCESSORY_ID, startDate: "2026-10-10", endDate: "2026-10-12", quantity: 1,
    });
    expect(res.data?.available).toBe(true);
  });
});

describe("BookingsService.inspectBookingAccessory", () => {
  const ACCESSORY_ITEM_ID = "00000000-0000-4000-8000-000000000010";
  const ACCESSORY_ASSET_ID = "00000000-0000-4000-8000-000000000011";

  function createInspectService(bookingStatus: string, accessoryAssetId: string | null) {
    const booking = {
      ...makeBooking("2026-10-10", "2026-10-12", { status: bookingStatus }),
      accessoryItems: [
        {
          id: ACCESSORY_ITEM_ID, bookingId: BOOKING_ID, bookingItemId: ITEM_ID,
          accessoryId: "00000000-0000-4000-8000-000000000009",
          accessoryAssetId, quantity: 1, unitPrice: 0, isIncluded: true,
        },
      ],
    };
    const tx = {
      booking: {
        findUnique: vi.fn().mockResolvedValue(booking),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...booking, accessoryItems: [] }),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: BOOKING_ID, status: bookingStatus, depositTotal: 50, penaltyTotal: 0, ...data,
        })),
      },
      accessories: {
        findUnique: vi.fn().mockResolvedValue({ replacement_value: 500000, name: "Mấn" }),
      },
      accessory_assets: {
        findUnique: vi.fn().mockResolvedValue({ id: ACCESSORY_ASSET_ID, status: "available", asset_code: "PK-001" }),
        update: vi.fn().mockResolvedValue({ id: ACCESSORY_ASSET_ID }),
      },
      accessory_asset_history: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
      bookingAccessoryItem: { update: vi.fn().mockResolvedValue({ id: ACCESSORY_ITEM_ID }) },
      bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "h2" }) },
      penalty: { create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pen-1", ...data })) },
      financialTransaction: { create: vi.fn().mockResolvedValue({ id: "ft-1" }) },
    };
    const prisma = {
      runSerializable: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
      booking: {
        findUnique: vi.fn().mockResolvedValue({
          ...booking,
          deliveryAddress: null,
          deliveryRecords: [],
          payments: [],
        }),
      },
    };
    const inspections = {
      tryFinalizeBookingInspection: vi.fn().mockResolvedValue({ data: { finalized: false } }),
    };
    const service = new BookingsService(
      prisma as never,
      { sendBookingNotification: vi.fn(), notifyStaffBooking: vi.fn() } as never,
      {} as never,
      {} as never,
      {
        assetChanged: vi.fn(), inspectionChanged: vi.fn(),
        laundryChanged: vi.fn(), maintenanceChanged: vi.fn(),
        bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn(),
      } as never,
      inspections as never,
    );
    return { service, tx };
  }

  it("records a good inspection and keeps the asset available", async () => {
    const { service, tx } = createInspectService("returned", ACCESSORY_ASSET_ID);
    const res = await service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID, { conditionStatus: "good", note: "OK" }, STAFF_ID,
    );
    expect(res.data).toBeDefined();
    expect(tx.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: expect.objectContaining({ conditionStatus: "good", inspectedBy: STAFF_ID }),
    });
    // good → available, asset đã available nên không update status.
    expect(tx.accessory_assets.update).not.toHaveBeenCalled();
  });

  it("moves the asset to damaged on a damaged inspection", async () => {
    const { service, tx } = createInspectService("inspection_pending", ACCESSORY_ASSET_ID);
    const photoUrl = `https://example.supabase.co/storage/v1/object/public/products/handover/${STAFF_ID}/11111111-1111-4111-8111-111111111111.jpg`;
    await service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID,
      { conditionStatus: "damaged", imageUrls: [photoUrl] },
      STAFF_ID,
    );
    expect(tx.accessory_assets.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ASSET_ID },
      data: { status: "damaged" },
    });
    expect(tx.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: expect.objectContaining({
        conditionStatus: "damaged",
        conditionImages: [photoUrl],
      }),
    });
    expect(tx.accessory_asset_history.create).toHaveBeenCalled();
  });

  it("rejects inspection when the row has no assigned asset", async () => {
    const { service } = createInspectService("returned", null);
    await expect(service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID, { conditionStatus: "good" }, STAFF_ID,
    )).rejects.toThrow("chưa được gán tài sản");
  });

  it("rejects inspection when the booking is still renting", async () => {
    const { service } = createInspectService("renting", ACCESSORY_ASSET_ID);
    await expect(service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID, { conditionStatus: "good" }, STAFF_ID,
    )).rejects.toThrow("đã trả đồ");
  });

  it("creates a manual penalty voucher on damaged inspection", async () => {
    const { service, tx } = createInspectService("returned", ACCESSORY_ASSET_ID);
    await service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID, { conditionStatus: "damaged", penaltyAmount: 150000 }, STAFF_ID,
    );
    expect(tx.penalty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bookingId: BOOKING_ID, amount: 150000 }),
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { penaltyTotal: { increment: 150000 } },
    });
  });

  it("auto-charges replacement value on lost inspection", async () => {
    const { service, tx } = createInspectService("returned", ACCESSORY_ASSET_ID);
    await service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID, { conditionStatus: "lost" }, STAFF_ID,
    );
    expect(tx.penalty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 500000 }),
    });
    expect(tx.accessory_assets.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ASSET_ID },
      data: { status: "lost" },
    });
  });

  it("creates no penalty on good inspection", async () => {
    const { service, tx } = createInspectService("returned", ACCESSORY_ASSET_ID);
    await service.inspectBookingAccessory(
      BOOKING_ID, ACCESSORY_ITEM_ID, { conditionStatus: "good" }, STAFF_ID,
    );
    expect(tx.penalty.create).not.toHaveBeenCalled();
  });
});

describe("BookingsService overdue reporting", () => {  type Serialized = { overdueDays: number; overdueAmount: number; overdueFeePerDay: number };

  function serializeWith(service: unknown, booking: unknown): Serialized {
    const spy = service as { serializeBooking(b: unknown): Serialized };
    return spy.serializeBooking(booking);
  }

  // Freeze the Vietnam business date for deterministic overdue assertions.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T05:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports how many days overdue a renting booking is", () => {
    const { service } = createService({ committed: 0, capacity: 5 });
    const serialized = serializeWith(service, makeBooking("2026-09-24", "2026-09-28", { status: "renting" }));

    expect(serialized.overdueDays).toBe(3);
    expect(serialized.overdueFeePerDay).toBe(10_000);
    expect(serialized.overdueAmount).toBe(30_000);
  });

  it("reports zero overdue days once the booking is no longer overdue", () => {
    const { service } = createService({ committed: 0, capacity: 5 });

    // Chưa tới hạn.
    expect(serializeWith(service, makeBooking("2026-10-10", "2026-10-12", { status: "renting" })).overdueDays).toBe(0);
    // Quá hạn nhưng khách đã trả đồ → ngày trễ không còn ý nghĩa.
    expect(serializeWith(service, makeBooking("2026-09-30", "2026-10-04", { status: "returned" })).overdueDays).toBe(0);
    // Đã hoàn tất → phí đã chốt, không nhân thêm.
    expect(serializeWith(service, makeBooking("2026-09-30", "2026-10-04", { status: "completed" })).overdueAmount).toBe(0);
  });
});
