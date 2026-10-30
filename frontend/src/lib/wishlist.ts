"use client";

import {
  type WishlistGarmentItem,
  getWishlist,
  addToWishlist as apiAddToWishlist,
  removeFromWishlist as apiRemoveFromWishlist,
  syncWishlist as apiSyncWishlist,
} from "./api";
import { readStoredAccessToken } from "./auth";

export type { WishlistGarmentItem };

const WISHLIST_STORAGE_KEY = "co_phuc_wishlist";

function isUserLoggedIn(): boolean {
  return Boolean(readStoredAccessToken());
}

function readLocalWishlist(): WishlistGarmentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalWishlist(items: WishlistGarmentItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("wishlist:updated"));
  } catch {
    // LocalStorage quota or access error
  }
}

export function getWishlistItems(): WishlistGarmentItem[] {
  return readLocalWishlist();
}

export function wishlistCount(): number {
  return readLocalWishlist().length;
}

export function isGarmentWishlisted(garmentId: string): boolean {
  if (!garmentId) return false;
  return readLocalWishlist().some((item) => item.garmentId === garmentId);
}

/**
 * Thêm hoặc xóa cổ phục khỏi danh sách yêu thích
 */
export async function toggleWishlist(item: WishlistGarmentItem): Promise<boolean> {
  const current = readLocalWishlist();
  const exists = current.some((i) => i.garmentId === item.garmentId);

  if (exists) {
    // Remove
    const next = current.filter((i) => i.garmentId !== item.garmentId);
    writeLocalWishlist(next);

    if (isUserLoggedIn()) {
      try {
        await apiRemoveFromWishlist(item.garmentId);
      } catch {
        // Backend failure will sync on next load
      }
    }
    return false;
  } else {
    // Add
    const next = [item, ...current];
    writeLocalWishlist(next);

    if (isUserLoggedIn()) {
      try {
        await apiAddToWishlist(item.garmentId);
      } catch {
        // Backend failure will sync on next load
      }
    }
    return true;
  }
}

/**
 * Xóa một món khỏi wishlist
 */
export async function removeWishlistItem(garmentId: string): Promise<void> {
  const current = readLocalWishlist();
  const next = current.filter((i) => i.garmentId !== garmentId);
  writeLocalWishlist(next);

  if (isUserLoggedIn()) {
    try {
      await apiRemoveFromWishlist(garmentId);
    } catch {
      // Backend sync fallback
    }
  }
}

/**
 * Tải và đồng bộ danh sách từ server khi người dùng đăng nhập
 */
export async function refreshWishlistFromServer(): Promise<WishlistGarmentItem[]> {
  if (!isUserLoggedIn()) {
    return readLocalWishlist();
  }

  const localItems = readLocalWishlist();
  try {
    if (localItems.length > 0) {
      // Có món lưu lúc làm khách vãng lai -> sync lên server
      const res = await apiSyncWishlist(localItems.map((i) => i.garmentId));
      if (res.success && Array.isArray(res.data)) {
        writeLocalWishlist(res.data);
        return res.data;
      }
    }

    // Tải danh sách đầy đủ từ server
    const res = await getWishlist();
    if (res.success && Array.isArray(res.data)) {
      writeLocalWishlist(res.data);
      return res.data;
    }
  } catch {
    // Mạng lỗi -> giữ danh sách local
  }

  return readLocalWishlist();
}
