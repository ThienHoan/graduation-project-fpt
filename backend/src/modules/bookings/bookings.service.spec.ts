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
    { effectiveDailyPrice: vi.fn().mockResolvedValue(100) } as never,
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
    { effectiveDailyPrice: vi.fn().mockResolvedValue(100) } as never,
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
      { effectiveDailyPrice: vi.fn().mockResolvedValue(100) } as never,
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

describe("BookingsService overdue reporting", () => {
  type Serialized = { overdueDays: number; overdueAmount: number; overdueFeePerDay: number };

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
