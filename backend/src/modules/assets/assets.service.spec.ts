import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsService } from "./assets.service";

const GARMENT_ID = "11111111-1111-4111-8111-111111111111";
const SIZE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SIZE_ID = "33333333-3333-4333-8333-333333333333";

function createMockPrisma() {
  const prisma = {
    garment: { findUnique: vi.fn() },
    garment_sizes: { findFirst: vi.fn(), findMany: vi.fn() },
    garmentAsset: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    bookingItem: { findFirst: vi.fn() },
    runSerializable: vi.fn(),
  };
  prisma.runSerializable.mockImplementation(async (operation: (tx: any) => Promise<unknown>) => operation(prisma as any));
  return prisma;
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

function setupFoundGarment(prisma: MockPrisma) {
  prisma.garment.findUnique.mockResolvedValue({ id: GARMENT_ID, name: "Ao dai" });
  prisma.garmentAsset.findUnique.mockResolvedValue(null);
  prisma.garmentAsset.create.mockImplementation(async (args: any) => ({
    id: "asset-1",
    ...args.data,
    garment: { name: "Ao dai" },
    garment_sizes: { size_label: "M" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
}

describe("AssetsService.create", () => {
  let prisma: MockPrisma;
  let service: AssetsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AssetsService(prisma as never);
  });

  it("auto-links the single active size when garmentSizeId is omitted", async () => {
    setupFoundGarment(prisma);
    prisma.garment_sizes.findMany.mockResolvedValue([{ id: SIZE_ID }]);

    const result = await service.create({ garmentId: GARMENT_ID, assetCode: "A-001" });

    expect(prisma.garmentAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ garment_size_id: SIZE_ID }),
      }),
    );
    expect(result.data).toMatchObject({ assetCode: "A-001" });
  });

  it("uses the explicit garmentSizeId when it belongs to the garment", async () => {
    setupFoundGarment(prisma);
    prisma.garment_sizes.findFirst.mockResolvedValue({ id: SIZE_ID });

    await service.create({ garmentId: GARMENT_ID, assetCode: "A-002", garmentSizeId: SIZE_ID });

    expect(prisma.garment_sizes.findFirst).toHaveBeenCalledWith({
      where: { id: SIZE_ID, garment_id: GARMENT_ID, is_active: true },
    });
    expect(prisma.garmentAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ garment_size_id: SIZE_ID }),
      }),
    );
  });

  it("rejects a garmentSizeId that does not belong to the garment", async () => {
    setupFoundGarment(prisma);
    prisma.garment_sizes.findFirst.mockResolvedValue(null);

    await expect(
      service.create({ garmentId: GARMENT_ID, assetCode: "A-003", garmentSizeId: OTHER_SIZE_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.garmentAsset.create).not.toHaveBeenCalled();
  });

  it("requires an explicit size when the garment has multiple active sizes", async () => {
    setupFoundGarment(prisma);
    prisma.garment_sizes.findMany.mockResolvedValue([{ id: SIZE_ID }, { id: OTHER_SIZE_ID }]);

    await expect(
      service.create({ garmentId: GARMENT_ID, assetCode: "A-004" }),
    ).rejects.toThrow("Vui lòng chọn size");
    expect(prisma.garmentAsset.create).not.toHaveBeenCalled();
  });

  it("rejects creation when the garment has no active size", async () => {
    setupFoundGarment(prisma);
    prisma.garment_sizes.findMany.mockResolvedValue([]);

    await expect(
      service.create({ garmentId: GARMENT_ID, assetCode: "A-005" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.garmentAsset.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate asset codes with a Vietnamese message", async () => {
    setupFoundGarment(prisma);
    prisma.garment_sizes.findMany.mockResolvedValue([{ id: SIZE_ID }]);
    prisma.garmentAsset.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      service.create({ garmentId: GARMENT_ID, assetCode: "A-001" }),
    ).rejects.toThrow("đã tồn tại");
  });

  it("throws NotFound when the garment does not exist", async () => {
    prisma.garment.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ garmentId: GARMENT_ID, assetCode: "A-006" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AssetsService.updateStatus", () => {
  let prisma: MockPrisma;
  let service: AssetsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AssetsService(prisma as never);
  });

  it("rejects direct reserved and rented mutations", async () => {
    prisma.garmentAsset.findUnique.mockResolvedValue({ id: "asset-1", status: "available" });
    await expect(service.updateStatus("asset-1", { status: "reserved" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateStatus("asset-1", { status: "rented" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.garmentAsset.updateMany).not.toHaveBeenCalled();
  });

  it("rejects direct lifecycle changes while an active booking assignment owns the asset", async () => {
    prisma.garmentAsset.findUnique.mockResolvedValue({ id: "asset-1", status: "available" });
    prisma.bookingItem.findFirst.mockResolvedValue({ bookingId: "booking-1" });
    await expect(service.updateStatus("asset-1", { status: "retired" })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.garmentAsset.updateMany).not.toHaveBeenCalled();
  });

  it("uses serializable CAS for an unassigned maintenance transition", async () => {
    prisma.garmentAsset.findUnique
      .mockResolvedValueOnce({ id: "asset-1", status: "available" })
      .mockResolvedValueOnce({ id: "asset-1", assetCode: "A-1", status: "retired", conditionNote: "note", garment: { name: "Ao dai" }, garment_sizes: { size_label: "M" }, updatedAt: new Date("2026-01-01") });
    prisma.bookingItem.findFirst.mockResolvedValue(null);
    prisma.garmentAsset.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.updateStatus("asset-1", { status: "retired", note: "note" })).resolves.toMatchObject({ data: { status: "retired" } });
    expect(prisma.runSerializable).toHaveBeenCalledTimes(1);
    expect(prisma.garmentAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset-1", status: "available" } }));
  });
});
