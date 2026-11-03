import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT_CARD_IMAGE,
  buildProductCardPayload,
} from "./product-card-payload";

describe("buildProductCardPayload", () => {
  it("includes every active size, price range, deposit and stock state", () => {
    const product = buildProductCardPayload({
      id: "g-1",
      name: "Áo dài đỏ thêu sen",
      color: "đỏ",
      category: { name: "Áo dài" },
      images: [{ imageUrl: "https://example.com/1.jpg" }],
      garment_sizes: [
        { id: "s-m", size_label: "M", daily_price: 350000, deposit_amount: 500000 },
        { id: "s-l", size_label: "L", daily_price: 380000, deposit_amount: 550000 },
        { id: "s-s", size_label: "S", daily_price: 320000, deposit_amount: 450000 },
      ],
      assets: [
        { id: "a-1", garment_size_id: "s-m" },
        { id: "a-2", garment_size_id: "s-l" },
      ],
    });

    expect(product).toMatchObject({
      id: "g-1",
      name: "Áo dài đỏ thêu sen",
      image: "https://example.com/1.jpg",
      size: "M, L, S",
      sizes: ["M", "L", "S"],
      price: 320000,
      priceFrom: 320000,
      priceTo: 380000,
      depositFrom: 450000,
      detailUrl: "/catalog/s-s",
      inStock: true,
      category: "Áo dài",
      color: "đỏ",
    });
  });

  it("marks the item out of stock when no asset is available", () => {
    const product = buildProductCardPayload({
      id: "g-2",
      name: "Áo dài xanh ngọc",
      images: [],
      garment_sizes: [
        { id: "s-m", size_label: "M", daily_price: 300000, deposit_amount: 0 },
      ],
      assets: [],
    });

    expect(product.inStock).toBe(false);
    expect(product.image).toBe(DEFAULT_PRODUCT_CARD_IMAGE);
    expect(product.depositFrom).toBe(0);
    expect(product.priceTo).toBe(300000);
  });

  it("omits stock when assets are not queried and handles a garment with no sizes", () => {
    const product = buildProductCardPayload({
      id: "g-3",
      name: "Cổ phục hoàng yến",
      images: [{ imageUrl: null }],
      garment_sizes: [],
    });

    expect(product.inStock).toBeUndefined();
    expect(product.size).toBeNull();
    expect(product.sizes).toEqual([]);
    expect(product.price).toBe(0);
    expect(product.detailUrl).toBe("/catalog/g-3");
    expect(product.image).toBe(DEFAULT_PRODUCT_CARD_IMAGE);
    expect(product).not.toHaveProperty("category");
    expect(product).not.toHaveProperty("color");
  });

  it("deduplicates size labels and keeps the cheapest size in detailUrl", () => {
    const product = buildProductCardPayload({
      id: "g-4",
      name: "Vest đen",
      images: [{ imageUrl: "https://example.com/4.jpg" }],
      garment_sizes: [
        { id: "s-l", size_label: "L", daily_price: 400000, deposit_amount: 600000 },
        { id: "s-m", size_label: "M", daily_price: 250000, deposit_amount: 400000 },
        { id: "s-m-2", size_label: "M", daily_price: 260000, deposit_amount: 420000 },
      ],
    });

    expect(product.sizes).toEqual(["L", "M"]);
    expect(product.size).toBe("L, M");
    expect(product.price).toBe(250000);
    expect(product.detailUrl).toBe("/catalog/s-m");
  });
});
