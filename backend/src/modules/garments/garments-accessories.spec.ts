import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GarmentsService } from "./garments.service";

const GARMENT_ID = "11111111-1111-4111-8111-111111111111";
const ACCESSORY_ID = "22222222-2222-4222-8222-222222222222";

const LINK_ROW = {
  id: "link-1",
  garment_id: GARMENT_ID,
  accessory_id: ACCESSORY_ID,
  quantity: 1,
  is_included: true,
  extra_price: 0,
  note: null,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  accessories: {
    id: ACCESSORY_ID,
    code: "PK-A01",
    name: "Mấn vàng",
    category: "Mấn",
    color: "Vàng",
    image_url: null,
  },
};

function createMockPrisma() {
  return {
    garment: {
      findFirst: vi.fn(),
    },
    accessories: {
      findUnique: vi.fn(),
    },
    accessory_assets: {
      count: vi.fn().mockResolvedValue(99),
    },
    garment_accessories: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

describe("GarmentsService garment accessories", () => {
  let prisma: MockPrisma;
  let service: GarmentsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new GarmentsService(prisma as never);
  });

  it("lists links with accessory info", async () => {
    prisma.garment.findFirst.mockResolvedValue({ id: GARMENT_ID });
    prisma.garment_accessories.findMany.mockResolvedValue([LINK_ROW]);

    const result = await service.findGarmentAccessories(GARMENT_ID);

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      quantity: 1,
      isIncluded: true,
      extraPrice: 0,
      accessory: { code: "PK-A01", name: "Mấn vàng" },
    });
  });

  it("throws NotFound for unknown garment when listing", async () => {
    prisma.garment.findFirst.mockResolvedValue(null);

    await expect(service.findGarmentAccessories(GARMENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects duplicates when adding", async () => {
    prisma.garment.findFirst.mockResolvedValue({ id: GARMENT_ID });
    prisma.accessories.findUnique.mockResolvedValue({ id: ACCESSORY_ID, is_active: true });
    prisma.garment_accessories.findUnique.mockResolvedValue(LINK_ROW);

    await expect(
      service.addGarmentAccessory(GARMENT_ID, { accessoryId: ACCESSORY_ID }),
    ).rejects.toThrow("đã được gắn");
    expect(prisma.garment_accessories.create).not.toHaveBeenCalled();
  });

  it("rejects inactive accessories when adding", async () => {
    prisma.garment.findFirst.mockResolvedValue({ id: GARMENT_ID });
    prisma.accessories.findUnique.mockResolvedValue({ id: ACCESSORY_ID, is_active: false });
    prisma.garment_accessories.findUnique.mockResolvedValue(null);

    await expect(
      service.addGarmentAccessory(GARMENT_ID, { accessoryId: ACCESSORY_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates a link with defaults", async () => {
    prisma.garment.findFirst.mockResolvedValue({ id: GARMENT_ID });
    prisma.accessories.findUnique.mockResolvedValue({ id: ACCESSORY_ID, is_active: true });
    prisma.garment_accessories.findUnique.mockResolvedValue(null);
    prisma.garment_accessories.create.mockImplementation(async (args: any) => ({
      ...LINK_ROW,
      ...args.data,
    }));

    const result = await service.addGarmentAccessory(GARMENT_ID, {
      accessoryId: ACCESSORY_ID,
      quantity: 2,
      isIncluded: false,
      extraPrice: 50000,
    });

    expect(prisma.garment_accessories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          garment_id: GARMENT_ID,
          accessory_id: ACCESSORY_ID,
          quantity: 2,
          is_included: false,
          extra_price: 50000,
        }),
      }),
    );
    expect(result.data).toMatchObject({ quantity: 2, isIncluded: false, extraPrice: 50000 });
  });

  it("rejects quantity exceeding usable accessory assets", async () => {
    prisma.garment.findFirst.mockResolvedValue({ id: GARMENT_ID });
    prisma.accessories.findUnique.mockResolvedValue({ id: ACCESSORY_ID, is_active: true });
    prisma.garment_accessories.findUnique.mockResolvedValue(null);
    prisma.accessory_assets.count.mockResolvedValue(2);

    await expect(
      service.addGarmentAccessory(GARMENT_ID, { accessoryId: ACCESSORY_ID, quantity: 3 }),
    ).rejects.toThrow("vượt quá số tài sản khả dụng");
    expect(prisma.garment_accessories.create).not.toHaveBeenCalled();
  });

  it("rejects quantity update exceeding usable accessory assets", async () => {
    prisma.garment_accessories.findUnique.mockResolvedValue(LINK_ROW);
    prisma.accessory_assets.count.mockResolvedValue(1);

    await expect(
      service.updateGarmentAccessory(GARMENT_ID, ACCESSORY_ID, { quantity: 2 }),
    ).rejects.toThrow("vượt quá số tài sản khả dụng");
    expect(prisma.garment_accessories.update).not.toHaveBeenCalled();
  });

  it("updates and removes links", async () => {
    prisma.garment_accessories.findUnique.mockResolvedValue(LINK_ROW);
    prisma.garment_accessories.update.mockImplementation(async (args: any) => ({
      ...LINK_ROW,
      ...args.data,
    }));

    const updated = await service.updateGarmentAccessory(GARMENT_ID, ACCESSORY_ID, {
      quantity: 3,
    });
    expect(updated.data).toMatchObject({ quantity: 3 });

    await service.removeGarmentAccessory(GARMENT_ID, ACCESSORY_ID);
    expect(prisma.garment_accessories.delete).toHaveBeenCalledWith({
      where: { id: LINK_ROW.id },
    });
  });

  it("throws NotFound when removing a missing link", async () => {
    prisma.garment_accessories.findUnique.mockResolvedValue(null);

    await expect(
      service.removeGarmentAccessory(GARMENT_ID, ACCESSORY_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
