/**
 * @blast-radius: core
 * Unit tests for cart.ts: storage read/write, adding items, removing, summary calculations, legacy migration.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  addToCart,
  cartCount,
  clearCart,
  getCart,
  getCartSummary,
  removeFromCart,
  type CartItem,
} from "./cart";

const item1: CartItem = {
  garmentId: "g-1",
  garmentSizeId: "s-1",
  name: "Áo Nhật Bình",
  sizeLabel: "M",
  dailyPrice: 200000,
  depositAmount: 500000,
  imageUrl: "/img/ao-nhat-binh.jpg",
};

const item2: CartItem = {
  garmentId: "g-2",
  garmentSizeId: "s-2",
  name: "Áo Tấc Nam",
  sizeLabel: "L",
  dailyPrice: 150000,
  depositAmount: 400000,
  imageUrl: null,
};

describe("cart.ts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty cart initially", () => {
    expect(getCart()).toEqual([]);
    expect(cartCount()).toBe(0);
  });

  it("adds items to cart and ignores duplicate garmentSizeId", () => {
    addToCart(item1);
    expect(getCart()).toHaveLength(1);
    expect(cartCount()).toBe(1);

    // Duplicate add should not increase count
    addToCart(item1);
    expect(getCart()).toHaveLength(1);

    addToCart(item2);
    expect(getCart()).toHaveLength(2);
    expect(cartCount()).toBe(2);
  });

  it("removes items by garmentSizeId", () => {
    addToCart(item1);
    addToCart(item2);

    removeFromCart("s-1");
    const cart = getCart();
    expect(cart).toHaveLength(1);
    expect(cart[0].garmentSizeId).toBe("s-2");
  });

  it("clears all cart items", () => {
    addToCart(item1);
    addToCart(item2);
    clearCart();

    expect(getCart()).toEqual([]);
    expect(cartCount()).toBe(0);
  });

  it("calculates summary totals correctly", () => {
    addToCart(item1); // 200k daily, 500k deposit
    addToCart(item2); // 150k daily, 400k deposit

    const summary = getCartSummary();
    expect(summary.count).toBe(2);
    expect(summary.rentalTotal).toBe(350000);
    expect(summary.depositTotal).toBe(900000);
  });

  it("migrates legacy cart data stored as array in 'cart' key", () => {
    localStorage.setItem("cart", JSON.stringify([item1]));
    const cart = getCart();

    expect(cart).toHaveLength(1);
    expect(cart[0].garmentSizeId).toBe("s-1");
    // Verify legacy key was cleaned up
    expect(localStorage.getItem("cart")).toBeNull();
  });
});
