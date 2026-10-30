import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWishlistItems,
  isGarmentWishlisted,
  toggleWishlist,
  removeWishlistItem,
  wishlistCount,
  type WishlistGarmentItem,
} from "./wishlist";

describe("wishlist client library", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const sampleItem: WishlistGarmentItem = {
    garmentId: "garment-test-1",
    name: "Áo Tấc Ngũ Thân",
    categoryName: "Triều Nguyễn",
    imageUrl: "https://example.com/ao-tac.jpg",
    dailyPrice: 400000,
    depositAmount: 1200000,
    sizes: [{ sizeId: "size-1", sizeLabel: "M", dailyPrice: 400000, depositAmount: 1200000 }],
    addedAt: "2026-01-01T00:00:00.000Z",
  };

  it("should start with an empty wishlist", () => {
    expect(getWishlistItems()).toEqual([]);
    expect(wishlistCount()).toBe(0);
    expect(isGarmentWishlisted("garment-test-1")).toBe(false);
  });

  it("should toggle garment into wishlist", async () => {
    const isAdded = await toggleWishlist(sampleItem);
    expect(isAdded).toBe(true);
    expect(wishlistCount()).toBe(1);
    expect(isGarmentWishlisted("garment-test-1")).toBe(true);
    expect(getWishlistItems()[0].name).toBe("Áo Tấc Ngũ Thân");
  });

  it("should toggle garment out of wishlist if already present", async () => {
    await toggleWishlist(sampleItem);
    expect(wishlistCount()).toBe(1);

    const isAddedSecondTime = await toggleWishlist(sampleItem);
    expect(isAddedSecondTime).toBe(false);
    expect(wishlistCount()).toBe(0);
    expect(isGarmentWishlisted("garment-test-1")).toBe(false);
  });

  it("should remove garment by id directly", async () => {
    await toggleWishlist(sampleItem);
    expect(wishlistCount()).toBe(1);

    await removeWishlistItem("garment-test-1");
    expect(wishlistCount()).toBe(0);
    expect(isGarmentWishlisted("garment-test-1")).toBe(false);
  });
});
