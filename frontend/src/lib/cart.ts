"use client";

const CART_STORAGE_KEY = "co_phuc_cart";
const LEGACY_CART_STORAGE_KEY = "cart";

export type CartItem = {
  garmentSizeId: string;
  garmentId: string;
  name: string;
  sizeLabel: string | null;
  dailyPrice: number;
  depositAmount: number;
  imageUrl: string | null;
};

type CartData = {
  items: CartItem[];
};

function normalizeItem(item: Partial<CartItem>): CartItem | null {
  if (!item.garmentSizeId || !item.garmentId || !item.name) {
    return null;
  }

  return {
    garmentSizeId: item.garmentSizeId,
    garmentId: item.garmentId,
    name: item.name,
    sizeLabel: item.sizeLabel ?? null,
    dailyPrice: Number(item.dailyPrice ?? 0),
    depositAmount: Number(item.depositAmount ?? 0),
    imageUrl: item.imageUrl ?? null,
  };
}

function readCartData(): CartData {
  if (typeof window === "undefined") return { items: [] };

  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CartData>;
      if (parsed && Array.isArray(parsed.items)) {
        return { items: parsed.items.map(normalizeItem).filter((item): item is CartItem => item !== null) };
      }
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_CART_STORAGE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw) as unknown;
      if (Array.isArray(legacyParsed)) {
        const items = legacyParsed.map(normalizeItem).filter((item): item is CartItem => item !== null);
        writeCartData({ items });
        window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
        return { items };
      }
    }

    return { items: [] };
  } catch {
    return { items: [] };
  }
}

function writeCartData(data: CartData): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(data));
}

export function getCart(): CartItem[] {
  return readCartData().items;
}

export function addToCart(item: CartItem): void {
  const data = readCartData();
  const exists = data.items.some((i) => i.garmentSizeId === item.garmentSizeId);
  if (!exists) {
    data.items.push(normalizeItem(item) ?? item);
    writeCartData(data);
  }
}

export function removeFromCart(garmentSizeId: string): void {
  const data = readCartData();
  data.items = data.items.filter((i) => i.garmentSizeId !== garmentSizeId);
  writeCartData(data);
}

export function clearCart(): void {
  if (typeof window === "undefined") return;
  writeCartData({ items: [] });
  window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
}

export function cartCount(): number {
  return readCartData().items.length;
}

export function getCartSummary(): {
  items: CartItem[];
  rentalTotal: number;
  depositTotal: number;
  count: number;
} {
  const items = readCartData().items;
  return {
    items,
    rentalTotal: items.reduce((sum, i) => sum + i.dailyPrice, 0),
    depositTotal: items.reduce((sum, i) => sum + i.depositAmount, 0),
    count: items.length,
  };
}

export function onCartChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key === CART_STORAGE_KEY || event.key === LEGACY_CART_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
