import { describe, expect, it, vi } from "vitest";
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
    refund: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const prisma = {
    runSerializable: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
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
});
