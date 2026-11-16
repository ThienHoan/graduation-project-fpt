import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { InspectionsService } from "./inspections.service";

const BOOKING_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const ASSET_ID = "00000000-0000-4000-8000-000000000003";

function createCompleteService(accessoryRows: Array<{ accessoryAssetId: string | null; conditionStatus: string | null }>) {
  const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const tx = {
    inspectionSession: {
      findUnique: vi.fn().mockResolvedValue({
        id: SESSION_ID, bookingId: BOOKING_ID, garmentAssetId: ASSET_ID, status: "in_progress",
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ garmentAssetId: ASSET_ID }]),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: SESSION_ID, bookingId: BOOKING_ID, garmentAssetId: ASSET_ID,
        status: "completed", note: null, createdAt: day("2026-10-10"), completedAt: day("2026-10-10"),
        inspector: null,
        garmentAsset: { id: ASSET_ID, assetCode: "AD-001", status: "laundry", conditionNote: null, garment_sizes: null },
        booking: {
          id: BOOKING_ID, status: "inspection_pending",
          rentalStartDate: day("2026-10-10"), rentalEndDate: day("2026-10-12"), items: [],
        },
        findings: [],
        photos: [],
      }),
    },
    garmentAsset: {
      findUnique: vi.fn().mockResolvedValue({ id: ASSET_ID, status: "inspection_pending" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    laundryTicket: { create: vi.fn().mockResolvedValue({ id: "lt-1" }) },
    maintenanceJob: { create: vi.fn().mockResolvedValue({ id: "mj-1" }) },
    inspectionFinding: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { penaltyAmount: 0 } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    booking: {
      update: vi.fn().mockResolvedValue({ id: BOOKING_ID, status: "inspection_pending", depositTotal: 0, penaltyTotal: 0 }),
      findUnique: vi.fn().mockResolvedValue({
        id: BOOKING_ID,
        items: [{ garmentAssetId: ASSET_ID }],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingAccessoryItem: {
      findMany: vi.fn().mockResolvedValue(accessoryRows),
    },
    bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    penalty: { create: vi.fn().mockResolvedValue({ id: "pen-1" }) },
    refund: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => ({ id: "refund-1", ...data })) },
    bookingAdjustment: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    financialTransaction: { create: vi.fn().mockResolvedValue({}) },
    payment: { findFirst: vi.fn().mockResolvedValue({ id: "p1", paymentMethod: "cash", provider: "manual" }) },
  };
  const prisma = {
    runSerializable: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
    // Service đọc lại session bằng prisma (ngoài transaction) để emit realtime và serialize.
    inspectionSession: tx.inspectionSession,
  };
  const realtime = {
    inspectionChanged: vi.fn(), assetChanged: vi.fn(),
    bookingChanged: vi.fn(), bookingChangedForCustomer: vi.fn(),
    laundryChanged: vi.fn(), maintenanceChanged: vi.fn(),
  };
  const service = new InspectionsService(prisma as never, realtime as never);
  return { service, tx };
}

describe("InspectionsService.findAccessoryLog", () => {
  it("returns inspected accessory rows with inspector names", async () => {
    const day = new Date("2026-10-10T00:00:00.000Z");
    const prisma = {
      bookingAccessoryItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "row-1", bookingId: BOOKING_ID, quantity: 1,
            conditionStatus: "damaged", conditionNote: "Xước", penaltyAmount: 150000,
            inspectedAt: day, inspectedBy: "staff-1",
            accessory: { name: "Kiềng" },
            accessoryAsset: { asset_code: "K-001" },
            booking: { id: BOOKING_ID },
          },
        ]),
      },
      userAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: "staff-1", email: "s@shop.vn", profile: { fullName: "Staff A" } },
        ]),
      },
    };
    const service = new InspectionsService(prisma as never, {} as never);

    const res = await service.findAccessoryLog();

    expect(res.data).toHaveLength(1);
    expect(res.data![0]).toMatchObject({
      accessoryName: "Kiềng",
      assetCode: "K-001",
      conditionStatus: "damaged",
      penaltyAmount: 150000,
      inspectorName: "Staff A",
    });
  });
});

describe("InspectionsService.complete accessory gate", () => {
  it("does not finalize while an accessory is still unchecked", async () => {
    const { service, tx } = createCompleteService([
      { accessoryAssetId: "aa-1", conditionStatus: null },
    ]);

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    // Không tạo hoàn cọc, không chuyển trạng thái đơn.
    expect(tx.refund.findFirst).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("finalizes once every accessory is inspected", async () => {
    const { service, tx } = createCompleteService([
      { accessoryAssetId: "aa-1", conditionStatus: "good" },
      { accessoryAssetId: "aa-2", conditionStatus: "laundry" },
    ]);

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }),
    );
  });

  it("finalizes bookings without accessories as before", async () => {
    const { service, tx } = createCompleteService([]);

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect(tx.booking.updateMany).toHaveBeenCalled();
  });

  it("cộng credit accrued vào phiếu hoàn cọc rồi tất toán (§11)", async () => {
    const { service, tx } = createCompleteService([]);
    // depositTotal = 0 (fixture) + credit 200k − penalty 0 → hoàn 200k.
    tx.bookingAdjustment.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(200_000) },
    ]);

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect((tx as unknown as { refund: { create: ReturnType<typeof vi.fn> } }).refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 200_000 }) }),
    );
    expect(tx.bookingAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "accrued", direction: "credit" }),
        data: expect.objectContaining({ status: "settled" }),
      }),
    );
  });

  it("không có credit → hành vi cũ: không update adjustment, refund = cọc − phạt", async () => {
    const { service, tx } = createCompleteService([]);
    // depositTotal = 0 (fixture), penalty 0 → refundAmount 0, không tạo phiếu.
    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect(tx.bookingAdjustment.findMany).toHaveBeenCalled();
    expect(tx.bookingAdjustment.updateMany).not.toHaveBeenCalled();
  });

  it("phiếu pending 600k + credit 200k → amount 800k, financialTransaction khớp 800k (không tính lại cọc−phạt)", async () => {
    const { service, tx } = createCompleteService([]);
    tx.bookingAdjustment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(200_000) }]);
    tx.refund.findFirst.mockResolvedValue({ id: "refund-pending", status: "pending", amount: new Prisma.Decimal(600_000) });
    (tx as unknown as { refund: { update: ReturnType<typeof vi.fn> } }).refund.update = vi
      .fn()
      .mockResolvedValue({ id: "refund-pending" });
    (tx as unknown as { financialTransaction: { create: unknown; findFirst: unknown; update: unknown } }).financialTransaction = {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({ id: "ft-1", amount: new Prisma.Decimal(600_000) }),
      update: vi.fn().mockResolvedValue({}),
    };

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect((tx as unknown as { refund: { create: ReturnType<typeof vi.fn> } }).refund.create).not.toHaveBeenCalled();
    expect((tx as unknown as { refund: { update: ReturnType<typeof vi.fn> } }).refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "refund-pending" },
        data: expect.objectContaining({ amount: new Prisma.Decimal(800_000) }),
      }),
    );
    expect((tx as unknown as { financialTransaction: { update: ReturnType<typeof vi.fn> } }).financialTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ft-1" },
        data: expect.objectContaining({ amount: new Prisma.Decimal(800_000) }),
      }),
    );
    expect(tx.bookingAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "settled", refundId: "refund-pending" }),
      }),
    );
  });

  it("phiếu refunding (tiền có thể đang chuyển) → KHÔNG sửa amount, tạo phiếu MỚI cho credit", async () => {
    const { service, tx } = createCompleteService([]);
    tx.bookingAdjustment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(150_000) }]);
    tx.refund.findFirst.mockResolvedValue({ id: "refund-moving", status: "refunding", amount: new Prisma.Decimal(600_000) });

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    // Không cập nhật phiếu đang chuyển tiền; tạo phiếu mới chỉ cho phần credit.
    expect((tx as unknown as { refund: { update?: unknown } }).refund.update).toBeUndefined();
    expect((tx as unknown as { refund: { create: ReturnType<typeof vi.fn> } }).refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 150_000 }) }),
    );
    expect(tx.bookingAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "settled", refundId: "refund-1" }),
      }),
    );
  });

  it("phiếu cũ đã refunded → tạo phiếu MỚI cho phần credit", async () => {
    const { service, tx } = createCompleteService([]);
    tx.bookingAdjustment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(150_000) }]);
    tx.refund.findFirst.mockResolvedValue({ id: "refund-old", status: "refunded" });

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect((tx as unknown as { refund: { create: ReturnType<typeof vi.fn> } }).refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 150_000 }) }),
    );
    expect(tx.bookingAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "settled", refundId: "refund-1" }),
      }),
    );
  });

  it("refund 0 nhưng còn credit → settle với refundId null (không treo vô hạn)", async () => {
    const { service, tx } = createCompleteService([]);
    // credit 150k, phạt 200k, cọc đơn (depositTotal) 0 → refundAmount = 0, còn credit.
    tx.bookingAdjustment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(150_000) }]);
    tx.inspectionFinding.aggregate.mockResolvedValue({ _sum: { penaltyAmount: 200_000 } });
    // Cọc theo item lớn (10M) ⇒ tỉ lệ phạt < 30%, không cần manager duyệt.
    tx.inspectionSession.findUnique.mockResolvedValue({
      id: SESSION_ID, bookingId: BOOKING_ID, garmentAssetId: ASSET_ID, status: "in_progress",
      booking: { items: [{ garmentAssetId: ASSET_ID, depositAmount: 10_000_000 }] },
      garmentAsset: { purchaseCost: 10_000_000, garment_sizes: { deposit_amount: 10_000_000 } },
    });
    tx.booking.update.mockResolvedValue({ id: BOOKING_ID, status: "inspection_pending", depositTotal: 0, penaltyTotal: 200_000 });

    await service.complete(SESSION_ID, { finalAssetStatus: "laundry" }, "staff-1");

    expect(tx.refund.create).not.toHaveBeenCalled();
    const updateArgs = (tx.bookingAdjustment.updateMany as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.status).toBe("settled");
    expect(updateArgs.data.refundId).toBeUndefined();
  });

  // Ca "refund 0 nhưng còn credit → settle(refundId=null)" cũng được kiểm trực tiếp ở
  // settlement.helper.spec.ts.
});
