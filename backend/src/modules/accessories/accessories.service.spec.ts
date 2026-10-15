import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessoriesService } from "./accessories.service";

const ACCESSORY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createMockPrisma() {
  return {
    accessories: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    garment_accessories: {
      findMany: vi.fn(),
    },
    accessory_assets: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    accessory_asset_history: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

const ACCESSORY_ROW = {
  id: ACCESSORY_ID,
  code: "PK-A01",
  name: "Mấn vàng",
  category: "Mấn",
  description: null,
  material: null,
  color: "Vàng",
  image_url: null,
  replacement_value: 500000,
  is_active: true,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-01T00:00:00.000Z"),
  accessory_assets: [],
};

describe("AccessoriesService", () => {
  let prisma: MockPrisma;
  let service: AccessoriesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AccessoriesService(prisma as never);
  });

  it("rejects duplicate accessory codes with a Vietnamese message", async () => {
    prisma.accessories.findUnique.mockResolvedValue(ACCESSORY_ROW);

    await expect(
      service.create({ code: "PK-A01", name: "Mấn khác" }),
    ).rejects.toThrow("đã tồn tại");
    expect(prisma.accessories.create).not.toHaveBeenCalled();
  });

  it("creates an accessory with normalized code", async () => {
    prisma.accessories.findUnique.mockResolvedValue(null);
    prisma.accessories.create.mockImplementation(async (args: any) => ({
      ...ACCESSORY_ROW,
      ...args.data,
      accessory_assets: [],
    }));

    const result = await service.create({ code: "  PK-A02 ", name: "Khăn đóng  " });

    expect(prisma.accessories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: "PK-A02", name: "Khăn đóng" }),
      }),
    );
    expect(result.data).toMatchObject({ code: "PK-A02" });
  });

  it("throws NotFound for unknown accessory on update", async () => {
    prisma.accessories.findUnique.mockResolvedValue(null);

    await expect(
      service.update(ACCESSORY_ID, { name: "Mới" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks deactivation while active garments still link the accessory", async () => {
    prisma.accessories.findUnique.mockResolvedValue(ACCESSORY_ROW);
    prisma.garment_accessories.findMany.mockResolvedValue([
      { garments: { name: "Áo dài đỏ" } },
      { garments: { name: "Nhật Bình xanh" } },
    ]);

    await expect(
      service.update(ACCESSORY_ID, { isActive: false }),
    ).rejects.toThrow("Áo dài đỏ, Nhật Bình xanh");
    expect(prisma.accessories.update).not.toHaveBeenCalled();
  });

  it("allows deactivation when no active garment links the accessory", async () => {
    prisma.accessories.findUnique.mockResolvedValue(ACCESSORY_ROW);
    prisma.garment_accessories.findMany.mockResolvedValue([]);
    prisma.accessories.update.mockImplementation(async (args: any) => ({
      ...ACCESSORY_ROW,
      ...args.data,
      accessory_assets: [],
    }));

    const result = await service.update(ACCESSORY_ID, { isActive: false });

    expect(prisma.garment_accessories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accessory_id: ACCESSORY_ID }),
      }),
    );
    expect(result.data).toMatchObject({ isActive: false });
  });

  it("rejects duplicate asset codes", async () => {
    prisma.accessories.findUnique.mockResolvedValue(ACCESSORY_ROW);
    prisma.accessory_assets.findUnique.mockResolvedValue({ id: "asset-1" });

    await expect(
      service.createAsset({ accessoryId: ACCESSORY_ID, assetCode: "PKA-001" }),
    ).rejects.toThrow("đã tồn tại");
    expect(prisma.accessory_assets.create).not.toHaveBeenCalled();
  });

  it("creates an asset as available and logs history", async () => {
    prisma.accessories.findUnique.mockResolvedValue(ACCESSORY_ROW);
    prisma.accessory_assets.findUnique.mockResolvedValue(null);
    prisma.accessory_assets.create.mockImplementation(async (args: any) => ({
      id: "asset-1",
      ...args.data,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    }));

    const result = await service.createAsset(
      {
        accessoryId: ACCESSORY_ID,
        assetCode: "PKA-002",
      },
      "user-1",
    );

    expect(prisma.accessory_assets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "available" }),
      }),
    );
    expect(prisma.accessory_asset_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "created",
          new_status: "available",
          created_by: "user-1",
        }),
      }),
    );
    expect(result.data).toMatchObject({ assetCode: "PKA-002", status: "available" });
  });

  it("logs history only when asset status actually changes", async () => {
    prisma.accessory_assets.findUnique.mockResolvedValue({
      id: "asset-1",
      accessory_id: ACCESSORY_ID,
      status: "available",
    });
    prisma.accessory_assets.update.mockImplementation(async (args: any) => ({
      id: "asset-1",
      accessory_id: ACCESSORY_ID,
      condition_note: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
      ...args.data,
    }));
    prisma.accessories.findUnique.mockResolvedValue(ACCESSORY_ROW);

    await service.updateAssetStatus("asset-1", { status: "rented" }, "user-1");
    expect(prisma.accessory_asset_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "status_change",
          old_status: "available",
          new_status: "rented",
          created_by: "user-1",
        }),
      }),
    );

    vi.clearAllMocks();
    prisma.accessory_assets.findUnique.mockResolvedValue({
      id: "asset-1",
      accessory_id: ACCESSORY_ID,
      status: "rented",
    });
    prisma.accessory_assets.update.mockImplementation(async (args: any) => ({
      id: "asset-1",
      accessory_id: ACCESSORY_ID,
      condition_note: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
      ...args.data,
    }));

    await service.updateAssetStatus("asset-1", { status: "rented" });
    expect(prisma.accessory_asset_history.create).not.toHaveBeenCalled();
  });
});
