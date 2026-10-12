"use client";

const ACCESSORY_SELECTION_KEY = "co_phuc_accessory_selection";

/** garmentSizeId -> accessoryId[] đã tick chọn thuê kèm. */
export type AccessorySelection = Record<string, string[]>;

function readSelection(): AccessorySelection {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACCESSORY_SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: AccessorySelection = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeSelection(sel: AccessorySelection): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESSORY_SELECTION_KEY, JSON.stringify(sel));
}

export function getAccessorySelection(): AccessorySelection {
  return readSelection();
}

export function setAccessorySelection(sel: AccessorySelection): void {
  writeSelection(sel);
}

export function toggleAccessory(garmentSizeId: string, accessoryId: string): AccessorySelection {
  const sel = readSelection();
  const list = sel[garmentSizeId] ?? [];
  sel[garmentSizeId] = list.includes(accessoryId)
    ? list.filter((id) => id !== accessoryId)
    : [...list, accessoryId];
  writeSelection(sel);
  return sel;
}

/** Xoá selection của 1 món khi món đó bị xoá khỏi giỏ. */
export function removeGarmentAccessories(garmentSizeId: string): void {
  const sel = readSelection();
  if (sel[garmentSizeId]) {
    delete sel[garmentSizeId];
    writeSelection(sel);
  }
}

/** Chỉ giữ selection của các size còn trong giỏ + accessory còn tồn tại.
 * Giữ nguyên key rỗng nếu trước đó đã có (tôn trọng việc user bỏ chọn hết). */
export function pruneAccessorySelection(
  validSizeIds: string[],
  validAccessoryIdsBySize: Record<string, string[]>,
): AccessorySelection {
  const sel = readSelection();
  const out: AccessorySelection = {};
  for (const sizeId of validSizeIds) {
    const valid = new Set(validAccessoryIdsBySize[sizeId] ?? []);
    const kept = (sel[sizeId] ?? []).filter((id) => valid.has(id));
    if (kept.length > 0 || sizeId in sel) out[sizeId] = kept;
  }
  writeSelection(out);
  return out;
}

export function flattenAccessorySelection(sel: AccessorySelection): Array<{ garmentSizeId: string; accessoryId: string }> {
  return Object.entries(sel).flatMap(([garmentSizeId, ids]) =>
    ids.map((accessoryId) => ({ garmentSizeId, accessoryId })),
  );
}

export function countSelectedAccessories(sel: AccessorySelection): number {
  return Object.values(sel).reduce((sum, ids) => sum + ids.length, 0);
}

export function clearAccessorySelection(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESSORY_SELECTION_KEY);
}
