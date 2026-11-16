import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetStatus, Prisma } from "@prisma/client";

const notifications = vi.hoisted(() => ({
  sendBookingNotification: vi.fn(),
  notifyStaffBooking: vi.fn(),
}));

const reservations = vi.hoisted(() => ({
  assertAssetScheduleAvailable: vi.fn().mockResolvedValue(undefined),
  assertAccessoryAssetScheduleAvailable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./booking-reservations", () => reservations);

import { BookingIncidentsService } from "./booking-incidents.service";

const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const ASSET_ID = "00000000-0000-4000-8000-000000000006";
const SIZE_ID = "00000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "00000000-0000-4000-8000-0000000000f1";
const ACCESSORY_ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const ACCESSORY_ID = "00000000-0000-4000-8000-0000000000a2";
const ACCESSORY_ASSET_ID = "00000000-0000-4000-8000-0000000000a3";
const NEW_ASSET_ID = "00000000-0000-4000-8000-0000000000a4";
const NEW_ACCESSORY_ASSET_ID = "00000000-0000-4000-8000-0000000000a5";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const today = day("2026-11-10");

type Asset = { id: string; assetCode: string; status: AssetStatus };

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    bookingId: BOOKING_ID,
    garmentId: "garment-1",
    garment_size_id: SIZE_ID,
    garmentAssetId: ASSET_ID,
    dailyPrice: new Prisma.Decimal(100_000),
    depositAmount: new Prisma.Decimal(200_000),
    ...overrides,
  };
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: "paid",
    rentalStartDate: day("2026-11-11"),
    rentalEndDate: day("2026-11-12"),
    items: [makeItem()],
    accessoryItems: [],
    ...overrides,
  };
}

function makeAccessoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCESSORY_ITEM_ID,
    bookingId: BOOKING_ID,
    accessoryId: ACCESSORY_ID,
    accessoryAssetId: ACCESSORY_ASSET_ID,
    rentalTotal: new Prisma.Decimal(50_000),
    ...overrides,
  };
}

function createHarness(options: {
  booking?: Record<string, unknown> | null;
  asset?: Asset | null;
  accessoryItem?: Record<string, unknown> | null;
  accessoryAsset?: { id: string; asset_code: string; accessory_id: string; status: AssetStatus } | null;
  openIncident?: Record<string, unknown> | null;
  createError?: unknown;
  bookings?: { autoAssignAssets: ReturnType<typeof vi.fn> };
  /** Ứng viên thay thế cho trang phục / phụ kiện (mục 4.4 — tự thay khi quét). */
  garmentCandidates?: Array<{ id: string; assetCode: string }>;
  accessoryCandidates?: Array<{ id: string; asset_code: string }>;
  /** Có yêu cầu đổi đang chờ → quét không được đổi asset ngầm. */
  pendingChangeRequest?: Record<string, unknown> | null;
} = {}) {
  let booking = options.booking === undefined ? makeBooking() : options.booking;
  let asset: Asset | null = options.asset === undefined
    ? { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.available }
    : options.asset;
  let accessoryItem = options.accessoryItem ?? null;
  let accessoryAsset = options.accessoryAsset ?? null;
  let openIncident = options.openIncident ?? null;
  const createdIncidents: Array<Record<string, unknown>> = [];
  const history: Array<Record<string, unknown>> = [];

  // Kho giả lập: asset hiện tại + ứng viên thay thế (đều available).
  const garmentAssets = new Map<string, Asset>();
  if (asset) garmentAssets.set(asset.id, asset);
  for (const candidate of options.garmentCandidates ?? []) {
    garmentAssets.set(candidate.id, {
      id: candidate.id,
      assetCode: candidate.assetCode,
      status: AssetStatus.available,
    });
  }
  type AccessoryAssetRow = { id: string; asset_code: string; accessory_id: string; status: AssetStatus };
  const accessoryAssets = new Map<string, AccessoryAssetRow>();
  if (accessoryAsset) accessoryAssets.set(accessoryAsset.id, accessoryAsset);
  for (const candidate of options.accessoryCandidates ?? []) {
    accessoryAssets.set(candidate.id, {
      id: candidate.id,
      asset_code: candidate.asset_code,
      accessory_id: ACCESSORY_ID,
      status: AssetStatus.available,
    });
  }

  const prisma = {
    booking: {
      findMany: vi.fn().mockImplementation(async () => (booking ? [{ id: (booking as { id: string }).id }] : [])),
      findUnique: vi.fn().mockImplementation(async () => booking),
    },
    bookingItem: {
      findUnique: vi.fn().mockImplementation(async () => booking ? (booking as { items: unknown[] }).items[0] : null),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const item = (booking as { items: Array<Record<string, unknown>> } | null)?.items?.[0];
        if (item) Object.assign(item, data);
        return item;
      }),
    },
    bookingAccessoryItem: {
      findUnique: vi.fn().mockImplementation(async () => accessoryItem ? { accessoryAssetId: accessoryItem.accessoryAssetId } : null),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (accessoryItem) Object.assign(accessoryItem, data);
        return accessoryItem;
      }),
    },
    bookingChangeRequest: {
      findFirst: vi.fn().mockImplementation(async () => options.pendingChangeRequest ?? null),
    },
    bookingStatusHistory: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        history.push(data);
        return data;
      }),
    },
    garmentAsset: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
        garmentAssets.get(where.id) ?? null,
      ),
      findMany: vi.fn().mockResolvedValue(options.garmentCandidates ?? []),
    },
    accessory_assets: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
        accessoryAssets.get(where.id) ?? null,
      ),
      findMany: vi.fn().mockResolvedValue(options.accessoryCandidates ?? []),
    },
    bookingIncident: {
      findFirst: vi.fn().mockImplementation(async () => openIncident),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (options.createError) throw options.createError;
        createdIncidents.push(data);
        return { id: INCIDENT_ID };
      }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if ((data as { status?: string }).status === "resolved") openIncident = null;
        return { id: INCIDENT_ID };
      }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  const service = new BookingIncidentsService(
    prisma as never,
    notifications as never,
    (options.bookings as never) ?? undefined,
  );
  return { service, prisma, createdIncidents, history, setBooking: (b: Record<string, unknown> | null) => { booking = b; }, setAsset: (a: Asset | null) => { asset = a; if (a) garmentAssets.set(a.id, a); }, setAccessoryItem: (a: Record<string, unknown> | null) => { accessoryItem = a; }, setOpen: (i: Record<string, unknown> | null) => { openIncident = i; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifications.sendBookingNotification.mockResolvedValue({});
  notifications.notifyStaffBooking.mockResolvedValue({});
});

describe("BookingIncidentsService.scanIncidents — cửa sổ N ngày", () => {
  it("chỉ quét đơn có ngày thuê trong [hôm nay, hôm nay + 2 ngày]", async () => {
    const { service, prisma } = createHarness();
    await service.scanIncidents(today);
    const where = prisma.booking.findMany.mock.calls[0][0].where;
    expect(where.rentalStartDate.gte.getTime()).toBe(today.getTime());
    expect(where.rentalStartDate.lte.getTime()).toBe(day("2026-11-12").getTime());
    expect(where.status.in).toContain("paid");
  });
});

describe("BookingIncidentsService.evaluateBooking — mở/đóng sự cố", () => {
  it("mở sự cố và chỉ gửi thông báo khi vừa tạo", async () => {
    const { service, createdIncidents } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
    });
    const result = await service.evaluateBooking(BOOKING_ID, today);
    expect(result).toEqual({ opened: 1, resolved: 0 });
    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]).toMatchObject({ reason: "asset_damaged", assetCode: "AO-001", status: "awaiting_customer" });
    expect(notifications.sendBookingNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendBookingNotification.mock.calls[0][0]).toMatchObject({
      templateKey: "booking.incident_action_required",
      linkUrl: `/booking/incidents/${BOOKING_ID}`,
    });
    expect(notifications.notifyStaffBooking).toHaveBeenCalledTimes(1);
  });

  it("dedupe: đã có sự cố mở thì không tạo trùng, không thông báo", async () => {
    const { service, prisma } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      openIncident: { id: INCIDENT_ID, status: "awaiting_customer" },
    });
    const result = await service.evaluateBooking(BOOKING_ID, today);
    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(prisma.bookingIncident.create).not.toHaveBeenCalled();
    expect(notifications.sendBookingNotification).not.toHaveBeenCalled();
  });

  it("dedupe P2002: đua giữa hai vòng quét không làm nổ", async () => {
    const { service } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      createError: new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
    });
    await expect(service.evaluateBooking(BOOKING_ID, today)).resolves.toEqual({ opened: 0, resolved: 0 });
    expect(notifications.sendBookingNotification).not.toHaveBeenCalled();
  });

  it("asset hồi (available) thì đóng sự cố đang mở, không thông báo", async () => {
    const { service, prisma } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.available },
      openIncident: { id: INCIDENT_ID, status: "awaiting_customer" },
    });
    const result = await service.evaluateBooking(BOOKING_ID, today);
    expect(result).toEqual({ opened: 0, resolved: 1 });
    expect(prisma.bookingIncident.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "resolved", resolution: "asset_recovered" }),
    }));
    expect(notifications.sendBookingNotification).not.toHaveBeenCalled();
  });

  it("bỏ qua đơn ngoài cửa sổ ngày thuê", async () => {
    const { service, prisma } = createHarness({
      booking: makeBooking({ rentalStartDate: day("2026-11-20") }),
    });
    const result = await service.evaluateBooking(BOOKING_ID, today);
    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(prisma.bookingIncident.findFirst).not.toHaveBeenCalled();
  });

  it("bỏ qua đơn ĐÃ QUA ngày thuê dù còn kẹt trạng thái trước bàn giao", async () => {
    const { service, prisma } = createHarness({
      booking: makeBooking({ status: "pending_confirmation", rentalStartDate: day("2026-10-15") }),
    });
    const result = await service.evaluateBooking(BOOKING_ID, today);
    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(prisma.bookingIncident.findFirst).not.toHaveBeenCalled();
  });
});

describe("BookingIncidentsService.evaluateBooking — tự gán asset", () => {
  it("chỉ gọi autoAssignAssets MỘT lần cho đơn thiếu asset ở trạng thái cho phép", async () => {
    const bookings = { autoAssignAssets: vi.fn().mockResolvedValue({ data: { complete: true } }) };
    const { service, createdIncidents } = createHarness({
      booking: makeBooking({
        status: "paid",
        items: [makeItem({ garmentAssetId: null }), makeItem({ id: "item-2", garmentAssetId: null })],
      }),
      bookings,
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(bookings.autoAssignAssets).toHaveBeenCalledTimes(1);
    expect(bookings.autoAssignAssets).toHaveBeenCalledWith(BOOKING_ID);
    // Vẫn ghi nhận sự cố cho món chưa có asset sau khi thử gán.
    expect(result.opened).toBe(2);
    expect(createdIncidents.every((incident) => incident.reason === "no_asset_available")).toBe(true);
  });

  it("không đánh giá đơn `pending_confirmation` (chưa tới bước gán asset → không mở sự cố giả)", async () => {
    const bookings = { autoAssignAssets: vi.fn().mockRejectedValue(new Error("Không thể tự gán")) };
    const { service, prisma, createdIncidents } = createHarness({
      booking: makeBooking({
        status: "pending_confirmation",
        items: [makeItem({ garmentAssetId: null })],
      }),
      bookings,
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(bookings.autoAssignAssets).not.toHaveBeenCalled();
    // Đơn chưa xác nhận: hệ thống cố ý chưa gán asset, nên không mở sự cố.
    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(createdIncidents).toHaveLength(0);
    expect(prisma.bookingIncident.findFirst).not.toHaveBeenCalled();
  });
});

describe("BookingIncidentsService — quét MỌI trạng thái không cho thuê (trang phục + phụ kiện)", () => {
  it("trang phục ở trạng thái cleaned (chưa đưa về available) vẫn là sự cố", async () => {
    const { service, createdIncidents } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.cleaned },
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(result).toEqual({ opened: 1, resolved: 0 });
    expect(createdIncidents[0]).toMatchObject({
      itemKind: "garment",
      reason: "no_asset_available",
      assetCode: "AO-001",
    });
  });

  it("phụ kiện ở trạng thái laundry (không cho thuê) cũng mở sự cố", async () => {
    const { service, createdIncidents } = createHarness({
      booking: makeBooking({ accessoryItems: [makeAccessoryItem()] }),
      accessoryItem: makeAccessoryItem(),
      accessoryAsset: {
        id: ACCESSORY_ASSET_ID,
        asset_code: "PK-001",
        accessory_id: ACCESSORY_ID,
        status: AssetStatus.laundry,
      },
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(result).toEqual({ opened: 1, resolved: 0 });
    expect(createdIncidents[0]).toMatchObject({
      itemKind: "accessory",
      bookingAccessoryItemId: ACCESSORY_ITEM_ID,
      reason: "accessory_unavailable",
      assetCode: "PK-001",
    });
  });

  it("phụ kiện bị hỏng → lý do asset_damaged và thông báo ghi 'phụ kiện bị hư hỏng'", async () => {
    const { service, createdIncidents } = createHarness({
      booking: makeBooking({ accessoryItems: [makeAccessoryItem()] }),
      accessoryItem: makeAccessoryItem(),
      accessoryAsset: {
        id: ACCESSORY_ASSET_ID,
        asset_code: "PK-002",
        accessory_id: ACCESSORY_ID,
        status: AssetStatus.damaged,
      },
    });

    await service.evaluateBooking(BOOKING_ID, today);

    expect(createdIncidents[0]).toMatchObject({ itemKind: "accessory", reason: "asset_damaged" });
    expect(notifications.sendBookingNotification.mock.calls[0][0]).toMatchObject({
      garmentName: "phụ kiện",
      note: "phụ kiện bị hư hỏng",
    });
    expect(notifications.notifyStaffBooking.mock.calls[0][0]).toMatchObject({
      extra: { reason: "phụ kiện bị hư hỏng" },
    });
  });

  it("tự gán xong phụ kiện thì đọc lại từ DB, không mở sự cố phụ kiện giả", async () => {
    const bookings = {
      autoAssignAssets: vi.fn().mockImplementation(async () => {
        setAccessoryItem(makeAccessoryItem({ accessoryAssetId: ASSET_ID }));
        return { data: { complete: true } };
      }),
    };
    const { service, createdIncidents, setAccessoryItem } = createHarness({
      booking: makeBooking({ accessoryItems: [makeAccessoryItem({ accessoryAssetId: null })] }),
      accessoryItem: makeAccessoryItem({ accessoryAssetId: null }),
      accessoryAsset: { id: ASSET_ID, asset_code: "PK-003", accessory_id: ACCESSORY_ID, status: AssetStatus.available },
      bookings,
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(bookings.autoAssignAssets).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(createdIncidents).toHaveLength(0);
  });
});

describe("BookingIncidentsService — quét TỰ THAY asset khi còn chiếc thay thế", () => {
  it("trang phục hỏng nhưng kho còn chiếc cùng size → tự thay, KHÔNG mở sự cố", async () => {
    const { service, prisma, createdIncidents, history } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      garmentCandidates: [{ id: NEW_ASSET_ID, assetCode: "AO-002" }],
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(createdIncidents).toHaveLength(0);
    expect(prisma.bookingItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { garmentAssetId: NEW_ASSET_ID },
    });
    expect(history[0]).toMatchObject({ bookingId: BOOKING_ID });
    expect(String(history[0].note)).toContain("AO-002");
  });

  it("phụ kiện đang bảo trì nhưng còn chiếc cùng accessory_id → tự thay, KHÔNG mở sự cố", async () => {
    const { service, prisma, createdIncidents } = createHarness({
      booking: makeBooking({ accessoryItems: [makeAccessoryItem()] }),
      accessoryItem: makeAccessoryItem(),
      accessoryAsset: {
        id: ACCESSORY_ASSET_ID,
        asset_code: "QDA-001",
        accessory_id: ACCESSORY_ID,
        status: AssetStatus.maintenance,
      },
      accessoryCandidates: [{ id: NEW_ACCESSORY_ASSET_ID, asset_code: "QDA-002" }],
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(result).toEqual({ opened: 0, resolved: 0 });
    expect(createdIncidents).toHaveLength(0);
    expect(prisma.bookingAccessoryItem.update).toHaveBeenCalledWith({
      where: { id: ACCESSORY_ITEM_ID },
      data: { accessoryAssetId: NEW_ACCESSORY_ASSET_ID },
    });
    // Chỉ tìm ứng viên CÙNG accessory_id.
    expect(prisma.accessory_assets.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accessory_id: ACCESSORY_ID }),
      }),
    );
  });

  it("hết chiếc thay thế → vẫn mở sự cố để khách/manager xử lý", async () => {
    const { service, createdIncidents } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      garmentCandidates: [],
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(result).toEqual({ opened: 1, resolved: 0 });
    expect(createdIncidents[0]).toMatchObject({ itemKind: "garment", reason: "asset_damaged" });
  });

  it("đang có yêu cầu đổi chờ xác nhận → không đổi asset ngầm", async () => {
    const { service, prisma, createdIncidents } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      garmentCandidates: [{ id: NEW_ASSET_ID, assetCode: "AO-002" }],
      pendingChangeRequest: { id: "req-1" },
    });

    await service.evaluateBooking(BOOKING_ID, today);

    expect(prisma.bookingItem.update).not.toHaveBeenCalled();
    expect(prisma.garmentAsset.findMany).not.toHaveBeenCalled();
    // Vẫn đánh giá sự cố bình thường.
    expect(createdIncidents[0]).toMatchObject({ itemKind: "garment", reason: "asset_damaged" });
  });

  it("đơn ready_for_pickup không tự thay (đã đóng gói) → mở sự cố cho manager", async () => {
    const { service, prisma, createdIncidents } = createHarness({
      booking: makeBooking({ status: "ready_for_pickup" }),
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      garmentCandidates: [{ id: NEW_ASSET_ID, assetCode: "AO-002" }],
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(prisma.bookingItem.update).not.toHaveBeenCalled();
    expect(result).toEqual({ opened: 1, resolved: 0 });
    expect(createdIncidents[0]).toMatchObject({ itemKind: "garment", reason: "asset_damaged" });
  });

  it("tự thay xong thì đóng sự cố đang mở của món đó (asset_recovered)", async () => {
    const { service, prisma, createdIncidents } = createHarness({
      asset: { id: ASSET_ID, assetCode: "AO-001", status: AssetStatus.damaged },
      garmentCandidates: [{ id: NEW_ASSET_ID, assetCode: "AO-002" }],
      openIncident: { id: INCIDENT_ID, dedupeKey: `g:${ITEM_ID}`, status: "awaiting_customer" },
    });

    const result = await service.evaluateBooking(BOOKING_ID, today);

    expect(result).toEqual({ opened: 0, resolved: 1 });
    expect(createdIncidents).toHaveLength(0);
    expect(prisma.bookingIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "resolved", resolution: "asset_recovered" }),
      }),
    );
  });
});