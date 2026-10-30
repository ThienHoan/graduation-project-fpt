import { beforeEach, describe, expect, it, vi } from "vitest";
import { WishlistService } from "./wishlist.service";
import { NotFoundException } from "@nestjs/common";

describe("WishlistService", () => {
  let service: WishlistService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      customerWishlist: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      garment: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };
    service = new WishlistService(mockPrisma);
  });

  it("should return user wishlist with formatted items", async () => {
    const mockItems = [
      {
        garmentId: "garment-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        garment: {
          name: "Áo Tấc Hoàng Cung",
          category: { name: "Triều Nguyễn" },
          images: [{ imageUrl: "https://example.com/ao-tac.jpg" }],
          garment_sizes: [
            { id: "size-1", size_label: "M", daily_price: 350000, deposit_amount: 1000000 },
            { id: "size-2", size_label: "L", daily_price: 380000, deposit_amount: 1000000 },
          ],
        },
      },
    ];

    mockPrisma.customerWishlist.findMany.mockResolvedValue(mockItems);

    const result = await service.findUserWishlist("user-1");

    expect(result.success).toBe(true);
    expect(result.data!).toHaveLength(1);
    expect(result.data![0].name).toBe("Áo Tấc Hoàng Cung");
    expect(result.data![0].categoryName).toBe("Triều Nguyễn");
    expect(result.data![0].dailyPrice).toBe(350000);
    expect(result.data![0].imageUrl).toBe("https://example.com/ao-tac.jpg");
    expect(result.data![0].sizes).toHaveLength(2);
  });

  it("should add garment to wishlist if active", async () => {
    mockPrisma.garment.findUnique.mockResolvedValue({
      id: "garment-1",
      name: "Nhật Bình",
      isActive: true,
      deletedAt: null,
    });
    mockPrisma.customerWishlist.upsert.mockResolvedValue({});

    const result = await service.addToWishlist("user-1", "garment-1");

    expect(result.success).toBe(true);
    expect(result.data!.isWishlisted).toBe(true);
    expect(mockPrisma.customerWishlist.upsert).toHaveBeenCalledWith({
      where: {
        userId_garmentId: {
          userId: "user-1",
          garmentId: "garment-1",
        },
      },
      create: { userId: "user-1", garmentId: "garment-1" },
      update: {},
    });
  });

  it("should throw NotFoundException if garment does not exist or inactive", async () => {
    mockPrisma.garment.findUnique.mockResolvedValue(null);

    await expect(service.addToWishlist("user-1", "non-existent")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should remove garment from wishlist", async () => {
    mockPrisma.customerWishlist.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.removeFromWishlist("user-1", "garment-1");

    expect(result.success).toBe(true);
    expect(result.data!.isWishlisted).toBe(false);
    expect(mockPrisma.customerWishlist.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", garmentId: "garment-1" },
    });
  });

  it("should sync guest items after login", async () => {
    mockPrisma.garment.findMany.mockResolvedValue([{ id: "garment-1" }, { id: "garment-2" }]);
    mockPrisma.customerWishlist.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.customerWishlist.findMany.mockResolvedValue([]);

    const result = await service.syncWishlist("user-1", ["garment-1", "garment-2"]);

    expect(result.success).toBe(true);
    expect(mockPrisma.customerWishlist.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", garmentId: "garment-1" },
        { userId: "user-1", garmentId: "garment-2" },
      ],
      skipDuplicates: true,
    });
  });
});
