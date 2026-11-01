import { beforeEach, describe, expect, it, vi } from "vitest";
import { DbHandlersService } from "./db-handlers.service";

function garment(overrides: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    name: "Áo dài đỏ thêu sen",
    color: "Đỏ",
    categoryId: "cat-1",
    garment_sizes: [
      { id: "s-1", size_label: "M", daily_price: 350000, is_active: true },
      { id: "s-2", size_label: "L", daily_price: 380000, is_active: true },
    ],
    images: [{ imageUrl: "https://example.com/a.jpg" }],
    ...overrides,
  };
}

describe("DbHandlersService", () => {
  let prisma: any;
  let service: DbHandlersService;

  beforeEach(() => {
    prisma = {
      garment: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      booking: {
        findUnique: vi.fn(),
      },
      garmentAsset: {
        findMany: vi.fn(),
      },
      bookingItem: {
        findMany: vi.fn(),
      },
      garment_accessories: {
        findMany: vi.fn(),
      },
      garmentCategory: {
        findMany: vi.fn(),
      },
    };
    service = new DbHandlersService(prisma as never);
  });

  it("answers price from the latest product card without touching catalog search", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_price",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "bộ này giá bao nhiêu",
    });

    expect(prisma.garment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "g-1" } }),
    );
    expect(prisma.garment.findMany).not.toHaveBeenCalled();
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).toContain("350.000đ");
    expect(result.productIds).toEqual(["g-1"]);
  });

  it("sends product info, a product card and asks what the customer needs when they send a card", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_card_detail",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).toContain("màu Đỏ");
    expect(result.reply).toContain("M, L");
    expect(result.reply).toContain("350.000đ");
    expect(result.reply).toContain("cần em tư vấn thêm gì");
    expect(result.productIds).toEqual(["g-1"]);
  });

  it("still answers a product card whose sizes are all closed", async () => {
    prisma.garment.findUnique.mockResolvedValue(
      garment({
        garment_sizes: [{ id: "s-1", size_label: "M", daily_price: 350000, is_active: false }],
      }),
    );

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_card_detail",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("chưa có size đang mở thuê");
    expect(result.reply).toContain("cần em tư vấn thêm gì");
    expect(result.productIds).toEqual(["g-1"]);
  });

  it("uses the requested size when it exists", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_price",
      slots: { lastProductCardId: "g-1", size: "L" },
      content: "size L giá bao nhiêu",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("380.000đ");
    expect(result.reply).toContain("size L");
  });

  it("matches exactly one catalog item by name and colour", async () => {
    prisma.garment.findMany.mockResolvedValue([garment()]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { color: "do", productReference: "named" },
      content: "áo dài đỏ còn không",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).toContain("M, L");
  });

  it("searches the catalog when the open product card does not match the colour", async () => {
    prisma.garment.findUnique.mockResolvedValue(
      garment({ id: "g-1", name: "Áo dài đỏ thêu sen", color: "Đỏ" }),
    );
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-2", name: "Áo dài hồng lụa", color: "Hồng" }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: {
        lastProductCardId: "g-1",
        productReference: "last_card",
        color: "hong",
      },
      content: "shop có sản phẩm màu hồng không",
    });

    expect(prisma.garment.findMany).toHaveBeenCalled();
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài hồng lụa");
    expect(result.reply).not.toContain("Áo dài đỏ thêu sen");
    expect(result.productIds).toEqual(["g-2"]);
  });

  it("filters catalog matches by the occasion the customer asks about", async () => {
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-1", name: "Áo dài đỏ thêu sen", occasion: ["Dự tiệc"] }),
      garment({ id: "g-2", name: "Áo dài công sở", occasion: ["Công sở"] }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { size: "L", productReference: "named" },
      content: "có sản phẩm size L và hợp cho dự tiệc không",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).not.toContain("Áo dài công sở");
    expect(result.productIds).toEqual(["g-1"]);
  });

  it("lists up to three matching products with cards when the catalog returns several", async () => {
    prisma.garment.findMany.mockResolvedValue([
      garment(),
      garment({ id: "g-2", name: "Áo dài đỏ lụa" }),
      garment({ id: "g-3", name: "Áo dài đỏ gấm" }),
      garment({ id: "g-4", name: "Áo dài đỏ nhung" }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { color: "do", productReference: "named" },
      content: "áo dài đỏ còn không",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("3 mẫu phù hợp");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).toContain("Áo dài đỏ gấm");
    expect(result.reply).not.toContain("Áo dài đỏ nhung");
    expect(result.productIds).toEqual(["g-1", "g-2", "g-3"]);
  });

  it("replies honestly when the requested colour is not in the catalog", async () => {
    prisma.garment.findMany.mockResolvedValue([]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { color: "tim", productReference: "named" },
      content: "shop có sản phẩm màu tím không",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("chưa có mẫu");
    expect(result.reply).toContain("màu tím");
    expect(result.productIds).toBeUndefined();
  });

  it("lists every open size of the sample and its price", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_sizes",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "có size nào khác k",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("M (350.000đ");
    expect(result.reply).toContain("L (380.000đ");
    expect(result.productIds).toEqual(["g-1"]);
  });

  it("says clearly when only one size is open", async () => {
    prisma.garment.findUnique.mockResolvedValue(
      garment({
        garment_sizes: [
          { id: "s-1", size_label: "L", daily_price: 360000, is_active: true },
        ],
      }),
    );

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_sizes",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "sản phẩm còn size khác k",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("chỉ mở thuê size L");
  });

  it("reports today's available stock for the open sample", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());
    prisma.garmentAsset.findMany.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
    prisma.bookingItem.findMany.mockResolvedValue([]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_stock",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "hiện còn hàng k",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("còn 2 bộ");
  });

  it("says the sample is out of stock today when no asset is free", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());
    prisma.garmentAsset.findMany.mockResolvedValue([{ id: "a-1" }]);
    prisma.bookingItem.findMany.mockResolvedValue([{ garmentAssetId: "a-1" }]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_stock",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "hiện còn hàng k",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("hết bộ trống hôm nay");
  });

  it("returns product info with sizes and accessory quantities", async () => {
    prisma.garment.findMany.mockResolvedValue([garment()]);
    prisma.garment_accessories.findMany.mockResolvedValue([
      {
        quantity: 2,
        is_included: true,
        extra_price: 0,
        note: null,
        accessories: {
          name: "Khăn đóng",
          category: "Đi kèm",
          color: "Đỏ",
          material: "Lụa",
          is_active: true,
        },
      },
      {
        quantity: 1,
        is_included: false,
        extra_price: 50000,
        note: null,
        accessories: {
          name: "Quạt xếp",
          category: "Phụ kiện",
          color: null,
          material: null,
          is_active: true,
        },
      },
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_info",
      slots: { color: "do", size: "L", productReference: "named" },
      content: "Tư vấn tôi sản phẩm áo dài đỏ thêu sen size L",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).toContain("Giá");
    expect(result.reply).toContain("Khăn đóng");
    expect(result.reply).toContain("số lượng 2");
    expect(result.reply).toContain("thuê thêm 50.000đ/ngày");
    expect(result.productIds).toEqual(["g-1"]);
  });

  it("says the product has no accessories instead of staying silent", async () => {
    prisma.garment.findMany.mockResolvedValue([garment()]);
    prisma.garment_accessories.findMany.mockResolvedValue([]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_info",
      slots: { productReference: "named" },
      content: "cho tôi thông tin áo dài",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("chưa gắn phụ kiện");
  });

  it("returns product info for a garment named in full even though the generic noun also matches many", async () => {
    // Câu nêu tên mẫu cụ thể; từ khoá chung "ao dai"/"ao" khớp cả catalog.
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-1", name: "Áo dài đỏ thêu sen", color: "Đỏ" }),
      garment({ id: "g-2", name: "Áo dài trắng lụa mềm", color: "Trắng" }),
      garment({ id: "g-3", name: "Áo dài hồng pastel", color: "Hồng pastel" }),
      garment({ id: "g-4", name: "Áo Dài Nam Ngũ Thân", color: "Xanh lá" }),
      garment({ id: "g-5", name: "Áo dài tím hoa cúc", color: "Tím" }),
    ]);
    prisma.garment_accessories.findMany.mockResolvedValue([]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_info",
      slots: { productReference: "named" },
      content: "tư vấn tôi sản phẩm Áo Dài Nam Ngũ Thân",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo Dài Nam Ngũ Thân");
    expect(result.reply).toContain("Xanh lá");
    expect(result.productIds).toEqual(["g-4"]);
  });

  it("prefers the longest matching name so a shorter name does not steal the request", async () => {
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-4", name: "Áo Dài Nam Ngũ Thân", color: "Xanh lá" }),
      garment({
        id: "g-6",
        name: "Áo Dài Nam Tay Thụng Ngũ Thân",
        color: "Đỏ",
      }),
    ]);
    prisma.garment_accessories.findMany.mockResolvedValue([]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_info",
      slots: { productReference: "named" },
      content: "Tư vấn tôi sản phẩm Áo Dài Nam Tay Thụng Ngũ Thân",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo Dài Nam Tay Thụng Ngũ Thân");
    expect(result.productIds).toEqual(["g-6"]);
  });

  it("still asks when the customer only names a generic product type", async () => {
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-1", name: "Áo dài đỏ thêu sen", color: "Đỏ" }),
      garment({ id: "g-2", name: "Áo dài trắng lụa mềm", color: "Trắng" }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_info",
      slots: { productReference: "named" },
      content: "tư vấn tôi sản phẩm áo dài",
    });

    expect(result.status).toBe("ask");
    if (result.status !== "ask") throw new Error("expected ask");
    expect(result.reply).toContain("nhiều mẫu phù hợp");
  });

  it("names the requested grey colour instead of white", async () => {
    prisma.garment.findMany.mockResolvedValue([]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { color: "xam", productReference: "named" },
      content: "có trang phục xám k",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("màu xám");
    expect(result.reply).not.toContain("màu trắng");
  });

  it("finds a black garment when the customer says 'trang phuc' generically", async () => {
    prisma.garment.findMany.mockResolvedValue([
      garment({
        id: "g-9",
        name: "Vest đen 3 mảnh nam",
        color: "Đen",
      }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { color: "den", productReference: "named" },
      content: "có trang phục màu đen k",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Vest đen 3 mảnh nam");
    expect(result.productIds).toEqual(["g-9"]);
  });

  it("still requires the real garment name when the customer names one", async () => {
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-9", name: "Vest đen 3 mảnh nam", color: "Đen" }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.catalog_search",
      slots: { color: "den", productReference: "named" },
      content: "shop có áo dài đen không",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("chưa có mẫu");
    expect(result.reply).toContain("màu đen");
  });

  it("lists accessories attached to the product in the last card", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());
    prisma.garment_accessories.findMany.mockResolvedValue([
      {
        quantity: 1,
        is_included: true,
        extra_price: 0,
        note: null,
        accessories: {
          name: "Khăn đóng",
          category: "Đi kèm",
          color: "Đỏ",
          material: "Lụa",
          is_active: true,
        },
      },
      {
        quantity: 2,
        is_included: false,
        extra_price: 50000,
        note: null,
        accessories: {
          name: "Quạt giấy",
          category: "Phụ kiện",
          color: null,
          material: null,
          is_active: true,
        },
      },
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_accessories",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "mẫu này có phụ kiện đi kèm không",
    });

    expect(prisma.garment_accessories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ garment_id: "g-1" }) }),
    );
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Khăn đóng (Đi kèm, Đỏ)");
    expect(result.reply).toContain("kèm theo");
    expect(result.reply).toContain("Quạt giấy x2");
    expect(result.reply).toContain("50.000đ/ngày");
  });

  it("answers stock for a requested date from garment assets and overlapping bookings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T03:00:00.000Z"));
    try {
      prisma.garment.findUnique.mockResolvedValue(garment());
      prisma.garmentAsset.findMany.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
      prisma.bookingItem.findMany.mockResolvedValue([
        { garmentAssetId: "a-1" },
        { garmentAssetId: null },
      ]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.product_availability",
        slots: { lastProductCardId: "g-1", productReference: "last_card" },
        content: "ngày mai mẫu này còn không",
      });

      expect(prisma.bookingItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ garmentId: "g-1" }),
        }),
      );
      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("kín lịch ngày 30/10/2026");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports remaining stock for a requested date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T03:00:00.000Z"));
    try {
      prisma.garment.findUnique.mockResolvedValue(garment());
      prisma.garmentAsset.findMany.mockResolvedValue([
        { id: "a-1" },
        { id: "a-2" },
        { id: "a-3" },
      ]);
      prisma.bookingItem.findMany.mockResolvedValue([{ garmentAssetId: "a-1" }]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.product_availability",
        slots: { lastProductCardId: "g-1", productReference: "last_card" },
        content: "ngày mai còn hàng không",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("còn 2 bộ trống ngày 30/10/2026");
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks stock for the requested size only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T03:00:00.000Z"));
    try {
      prisma.garment.findUnique.mockResolvedValue(garment());
      prisma.garmentAsset.findMany.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
      prisma.bookingItem.findMany.mockResolvedValue([]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.product_availability",
        slots: { lastProductCardId: "g-1", productReference: "last_card", size: "L" },
        content: "ngày mai còn size L không",
      });

      expect(prisma.garmentAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ garment_size_id: "s-2" }),
        }),
      );
      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("size L");
      expect(result.reply).toContain("còn 2 bộ trống ngày 30/10/2026");
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers that the size does not exist without checking stock", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_availability",
      slots: { lastProductCardId: "g-1", productReference: "last_card", size: "XL" },
      content: "ngày mai còn size XL không",
    });

    expect(prisma.garmentAsset.findMany).not.toHaveBeenCalled();
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("không có size XL");
  });

  it("asks for a concrete date when the availability question has none", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_availability",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "mẫu này còn hàng không",
    });

    expect(result.status).toBe("ask");
    if (result.status !== "ask") throw new Error("expected ask");
    expect(result.askKey).toBe("availability:date");
  });

  it("suggests two other active products in the same category", async () => {
    prisma.garment.findUnique.mockResolvedValue(garment());
    prisma.garment.findMany.mockResolvedValue([
      garment({
        id: "g-2",
        name: "Áo dài xanh ngọc",
        color: "Xanh",
        garment_sizes: [
          { id: "s-3", size_label: "S", daily_price: 320000, is_active: true },
        ],
      }),
      garment({
        id: "g-3",
        name: "Áo dài trắng",
        color: "Trắng",
        garment_sizes: [
          { id: "s-4", size_label: "M", daily_price: 300000, is_active: true },
        ],
      }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_alternatives",
      slots: { lastProductCardId: "g-1", productReference: "last_card" },
      content: "còn mẫu khác không",
    });

    expect(prisma.garment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: "cat-1", id: { not: "g-1" } }),
      }),
    );
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài xanh ngọc");
    expect(result.reply).toContain("Áo dài trắng");
    expect(result.productIds).toEqual(["g-2", "g-3"]);
  });

  it("lists active categories when the customer asks what the shop sells", async () => {
    prisma.garmentCategory.findMany.mockResolvedValue([
      { id: "cat-1", name: "Áo dài" },
      { id: "cat-2", name: "Vest" },
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.product_categories",
      slots: {},
      content: "shop có những sản phẩm gì",
    });

    expect(prisma.garmentCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài, Vest");
    expect(result.reply).toContain("muốn xem loại nào");
  });

  it("returns two active product cards for the selected category", async () => {
    prisma.garmentCategory.findMany.mockResolvedValue([{ id: "cat-1", name: "Áo dài" }]);
    prisma.garment.findMany.mockResolvedValue([
      garment(),
      garment({ id: "g-2", name: "Áo dài xanh ngọc", color: "Xanh" }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.category_products",
      slots: {},
      content: "áo dài",
    });

    expect(prisma.garment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: "cat-1", isActive: true }),
      }),
    );
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Áo dài đỏ thêu sen");
    expect(result.reply).toContain("Áo dài xanh ngọc");
    expect(result.productIds).toEqual(["g-1", "g-2"]);
  });

  it("matches a shorthand category name", async () => {
    prisma.garmentCategory.findMany.mockResolvedValue([
      { id: "cat-2", name: "Bộ vest" },
    ]);
    prisma.garment.findMany.mockResolvedValue([
      garment({ id: "g-9", name: "Vest đen", color: "Đen" }),
    ]);

    const result = await service.handle({
      customerId: "c-1",
      intent: "db.category_products",
      slots: {},
      content: "vest",
    });

    expect(prisma.garment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: "cat-2" }),
      }),
    );
    expect(result.status).toBe("reply");
  });

  it("prefers the exact category over a longer category name", async () => {
    prisma.garmentCategory.findMany.mockResolvedValue([
      { id: "cat-1", name: "Áo dài" },
      { id: "cat-2", name: "Áo dài cách tân" },
    ]);
    prisma.garment.findMany.mockResolvedValue([garment()]);

    await service.handle({
      customerId: "c-1",
      intent: "db.category_products",
      slots: {},
      content: "áo dài",
    });

    expect(prisma.garment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: "cat-1" }),
      }),
    );
  });

  it("looks up order status by conversation bookingId and verifies the customer", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b-1",
      customerId: "c-1",
      status: "confirmed",
      rentalStartDate: new Date("2026-11-01T00:00:00.000Z"),
      rentalEndDate: new Date("2026-11-03T00:00:00.000Z"),
      rentalTotal: 700000,
      depositTotal: 200000,
    });

    const result = await service.handle({
      customerId: "c-1",
      bookingId: "b-1",
      intent: "db.order_status",
      slots: {},
      content: "trạng thái đơn của tôi",
    });

    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toContain("Đã xác nhận");
    expect(result.reply).toContain("700.000đ");
  });

  it("refuses another customer's booking instead of leaking status", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b-1",
      customerId: "someone-else",
      status: "confirmed",
    });

    const result = await service.handle({
      customerId: "c-1",
      bookingId: "b-1",
      intent: "db.order_status",
      slots: {},
      content: "trạng thái đơn của tôi",
    });

    expect(result).toEqual({ status: "staff", reason: "order_lookup_denied" });
  });

  it("asks for the conversation bookingId instead of accepting a typed code", async () => {
    const result = await service.handle({
      customerId: "c-1",
      bookingId: null,
      intent: "db.order_status",
      slots: {},
      content: "mã đơn BK123456",
    });

    expect(result.status).toBe("ask");
    if (result.status !== "ask") throw new Error("expected ask");
    expect(result.askKey).toBe("order_status:booking");
  });

  describe("lọc catalog theo khoảng giá", () => {
    const aoDai = garment({
      id: "g-ao-dai",
      name: "Áo dài đỏ thêu sen",
      color: "Đỏ",
      garment_sizes: [
        { id: "s-a", size_label: "M", daily_price: 250000, is_active: true },
        { id: "s-b", size_label: "L", daily_price: 320000, is_active: true },
      ],
    });
    const vest = garment({
      id: "g-vest",
      name: "Bộ vest trắng",
      color: "Trắng",
      garment_sizes: [
        { id: "s-c", size_label: "M", daily_price: 180000, is_active: true },
      ],
    });
    const dam = garment({
      id: "g-dam",
      name: "Đầm dạ hội xanh",
      color: "Xanh",
      garment_sizes: [
        { id: "s-d", size_label: "S", daily_price: 900000, is_active: true },
      ],
    });

    it("chỉ trả mẫu có size nằm trong khoảng giá, sắp xếp từ rẻ nhất", async () => {
      prisma.garment.findMany.mockResolvedValue([dam, aoDai, vest]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_price",
        slots: { priceMax: 300000, productReference: "named" },
        content: "cho tôi các sản phẩm giá thuê dưới 300k",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("2 mẫu");
      expect(result.reply).toContain("Bộ vest trắng");
      expect(result.reply).toContain("Áo dài đỏ thêu sen");
      expect(result.reply).not.toContain("Đầm dạ hội xanh");
      expect(result.productIds).toEqual(["g-vest", "g-ao-dai"]);
    });

    it("áp dụng cả điều kiện màu và cận dưới của khoảng giá", async () => {
      prisma.garment.findMany.mockResolvedValue([dam, aoDai, vest]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_price",
        slots: { priceMin: 200000, priceMax: 500000, color: "do", productReference: "named" },
        content: "cho tôi các sản phẩm màu đỏ giá thuê 200k đến 500k",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("Áo dài đỏ thêu sen");
      expect(result.reply).not.toContain("Bộ vest trắng");
      expect(result.reply).not.toContain("Đầm dạ hội xanh");
      expect(result.productIds).toEqual(["g-ao-dai"]);
    });

    it("báo thật khi không có mẫu nào trong khoảng giá", async () => {
      prisma.garment.findMany.mockResolvedValue([aoDai, vest]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_price",
        slots: { priceMin: 5_000_000, productReference: "named" },
        content: "cho tôi các trang phục giá thuê trên 5 triệu",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("chưa có mẫu");
      expect(result.productIds).toBeUndefined();
    });

    it("chỉ gửi tối đa 3 product card dù khớp nhiều mẫu", async () => {
      const many = Array.from({ length: 5 }, (_, index) =>
        garment({
          id: `g-${index}`,
          name: `Mẫu ${index}`,
          color: "Đỏ",
          garment_sizes: [
            {
              id: `s-${index}`,
              size_label: "M",
              daily_price: 100000 + index * 10000,
              is_active: true,
            },
          ],
        }),
      );
      prisma.garment.findMany.mockResolvedValue(many);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_price",
        slots: { priceMax: 400000, productReference: "named" },
        content: "cho tôi các sản phẩm dưới 400k",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("5 mẫu");
      expect(result.productIds).toEqual(["g-0", "g-1", "g-2"]);
    });
  });

  describe("lọc catalog theo dịp", () => {
    const aoDaiTet = garment({
      id: "g-tet",
      name: "Áo dài đỏ thêu sen",
      color: "Đỏ",
      occasion: ["Tết", "Đám cưới"],
      garment_sizes: [{ id: "s-tet", size_label: "M", daily_price: 300000, is_active: true }],
    });
    const aoDaiTrang = garment({
      id: "g-tet-trang",
      name: "Áo dài trắng lụa mềm",
      color: "Trắng",
      occasion: ["Tết", "Chụp ảnh"],
      garment_sizes: [{ id: "s-trang", size_label: "S", daily_price: 250000, is_active: true }],
    });
    const vestTiec = garment({
      id: "g-tiec",
      name: "Vest đen 3 mảnh nam",
      color: "Đen",
      occasion: ["Tiệc", "Sự kiện"],
      garment_sizes: [{ id: "s-tiec", size_label: "L", daily_price: 180000, is_active: true }],
    });
    const damChuaPhanLoai = garment({
      id: "g-chua-phan-loai",
      name: "Đầm dạ hội xanh",
      color: "Xanh",
      occasion: [],
      garment_sizes: [{ id: "s-dam", size_label: "M", daily_price: 900000, is_active: true }],
    });

    it("chỉ trả mẫu có occasion khớp dịp khách hỏi, sắp xếp từ rẻ nhất", async () => {
      prisma.garment.findMany.mockResolvedValue([aoDaiTet, vestTiec, aoDaiTrang]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_occasion",
        slots: { productReference: "named" },
        content: "mẫu trang phục đi tết",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("2 mẫu phù hợp dịp Tết");
      expect(result.reply).toContain("Áo dài trắng lụa mềm");
      expect(result.reply).toContain("Áo dài đỏ thêu sen");
      expect(result.reply).not.toContain("Vest đen 3 mảnh nam");
      expect(result.productIds).toEqual(["g-tet-trang", "g-tet"]);
    });

    it("nói rõ khi chưa phân loại mẫu theo dịp và vẫn gợi ý mẫu đang mở thuê", async () => {
      prisma.garment.findMany.mockResolvedValue([damChuaPhanLoai, vestTiec]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_occasion",
        slots: { productReference: "named" },
        content: "đồ đi tết",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("chưa phân loại mẫu theo dịp Tết");
      expect(result.reply).toContain("Vest đen 3 mảnh nam");
      expect(result.reply).toContain("Đầm dạ hội xanh");
    });

    it("thu hẹp theo tên mẫu khi khách nêu loại sản phẩm", async () => {
      prisma.garment.findMany.mockResolvedValue([
        aoDaiTet,
        aoDaiTrang,
        { ...vestTiec, occasion: ["Tết"] },
      ]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_occasion",
        slots: { productReference: "named" },
        content: "áo dài đi tết",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("Áo dài đỏ thêu sen");
      expect(result.reply).not.toContain("Vest đen 3 mảnh nam");
      expect(result.productIds).toEqual(["g-tet-trang", "g-tet"]);
    });

    it("chỉ gửi tối đa 3 product card dù khớp nhiều mẫu", async () => {
      const many = Array.from({ length: 5 }, (_, index) =>
        garment({
          id: `g-${index}`,
          name: `Áo dài Tết ${index}`,
          color: "Đỏ",
          occasion: ["Tết"],
          garment_sizes: [
            {
              id: `s-${index}`,
              size_label: "M",
              daily_price: 100000 + index * 10000,
              is_active: true,
            },
          ],
        }),
      );
      prisma.garment.findMany.mockResolvedValue(many);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_occasion",
        slots: { productReference: "named" },
        content: "mẫu đi tết",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("5 mẫu phù hợp dịp Tết");
      expect(result.productIds).toEqual(["g-0", "g-1", "g-2"]);
    });

    it("lọc giá vẫn áp dụng dịp khi khách nêu cả hai điều kiện", async () => {
      prisma.garment.findMany.mockResolvedValue([
        aoDaiTet,
        aoDaiTrang,
        vestTiec,
        damChuaPhanLoai,
      ]);

      const result = await service.handle({
        customerId: "c-1",
        intent: "db.catalog_price",
        slots: { priceMax: 500000, productReference: "named" },
        content: "mẫu đi tết dưới 500k",
      });

      expect(result.status).toBe("reply");
      if (result.status !== "reply") throw new Error("expected reply");
      expect(result.reply).toContain("Áo dài trắng lụa mềm");
      expect(result.reply).toContain("Áo dài đỏ thêu sen");
      expect(result.reply).not.toContain("Vest đen 3 mảnh nam");
      expect(result.productIds).toEqual(["g-tet-trang", "g-tet"]);
    });
  });
});
