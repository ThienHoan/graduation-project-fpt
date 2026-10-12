import { describe, expect, it, vi } from "vitest";
import { GarmentsService } from "./garments.service";

describe("GarmentsService - findSimilarGarments", () => {
  it("ranks garments with same category, color, and similar price higher", async () => {
    const targetGarment = {
      id: "target-1",
      name: "Áo dài cưới đỏ truyền thống",
      categoryId: "cat-ao-dai",
      color: "đỏ",
      occasion: ["Cưới hỏi", "Lễ hội"],
      isActive: true,
      deletedAt: null,
      garment_sizes: [
        { id: "s-1", size_label: "M", daily_price: 300000, deposit_amount: 500000, is_active: true },
      ],
      category: { id: "cat-ao-dai", name: "Áo dài" },
    };

    const candidates = [
      {
        id: "cand-1",
        name: "Áo dài gấm đỏ thêu phụng",
        categoryId: "cat-ao-dai",
        color: "đỏ",
        occasion: ["Cưới hỏi"],
        isActive: true,
        deletedAt: null,
        category: { id: "cat-ao-dai", name: "Áo dài" },
        images: [{ imageUrl: "https://example.com/red.jpg", sortOrder: 0 }],
        garment_sizes: [
          { id: "cs-1", size_label: "M", daily_price: 320000, deposit_amount: 500000, is_active: true },
        ],
      },
      {
        id: "cand-2",
        name: "Áo tấc vàng hoàng gia",
        categoryId: "cat-ao-tac",
        color: "vàng",
        occasion: ["Chụp ảnh"],
        isActive: true,
        deletedAt: null,
        category: { id: "cat-ao-tac", name: "Áo tấc" },
        images: [{ imageUrl: "https://example.com/yellow.jpg", sortOrder: 0 }],
        garment_sizes: [
          { id: "cs-2", size_label: "L", daily_price: 600000, deposit_amount: 800000, is_active: true },
        ],
      },
    ];

    const prismaMock = {
      garment: {
        findFirst: vi.fn().mockResolvedValue(targetGarment),
        findMany: vi.fn().mockResolvedValue(candidates),
      },
    } as any;

    const service = new GarmentsService(prismaMock);
    const result = await service.findSimilarGarments("target-1", 4);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBeGreaterThan(0);
    // cand-1 should score highest (same category +40, same color +25, shared occasion +20, similar price +15) = 100
    expect(result.data![0].garmentId).toBe("cand-1");
    expect(result.data![0].similarityScore).toBe(100);
    expect(result.data![0].reasons).toContain("Cùng kiểu dáng Áo dài");
    expect(result.data![0].reasons).toContain("Cùng tông màu đỏ");
  });

  it("throws NotFoundException if target garment does not exist", async () => {
    const prismaMock = {
      garment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new GarmentsService(prismaMock);
    await expect(service.findSimilarGarments("non-existent-id")).rejects.toThrow("Garment not found.");
  });
});
