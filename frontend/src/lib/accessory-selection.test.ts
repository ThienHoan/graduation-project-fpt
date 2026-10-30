/**
 * @blast-radius: core
 * Unit tests for accessory-selection.ts: toggle, prune, flatten, count, and persistence.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAccessorySelection,
  countSelectedAccessories,
  flattenAccessorySelection,
  getAccessorySelection,
  pruneAccessorySelection,
  removeGarmentAccessories,
  setAccessorySelection,
  toggleAccessory,
} from "./accessory-selection";

describe("accessory-selection.ts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty selection initially", () => {
    expect(getAccessorySelection()).toEqual({});
    expect(countSelectedAccessories({})).toBe(0);
  });

  it("toggles accessory on and off for a garment size", () => {
    // Toggle ON
    const sel1 = toggleAccessory("size-1", "acc-101");
    expect(sel1["size-1"]).toEqual(["acc-101"]);
    expect(countSelectedAccessories(sel1)).toBe(1);

    // Toggle another accessory ON
    const sel2 = toggleAccessory("size-1", "acc-102");
    expect(sel2["size-1"]).toEqual(["acc-101", "acc-102"]);
    expect(countSelectedAccessories(sel2)).toBe(2);

    // Toggle acc-101 OFF
    const sel3 = toggleAccessory("size-1", "acc-101");
    expect(sel3["size-1"]).toEqual(["acc-102"]);
    expect(countSelectedAccessories(sel3)).toBe(1);
  });

  it("removes accessories for a specific garment size", () => {
    setAccessorySelection({
      "size-1": ["acc-101"],
      "size-2": ["acc-201"],
    });

    removeGarmentAccessories("size-1");
    const current = getAccessorySelection();
    expect(current["size-1"]).toBeUndefined();
    expect(current["size-2"]).toEqual(["acc-201"]);
  });

  it("flattens selection into array of pairs", () => {
    const sel = {
      "size-1": ["acc-1", "acc-2"],
      "size-2": ["acc-3"],
    };

    const flattened = flattenAccessorySelection(sel);
    expect(flattened).toEqual([
      { garmentSizeId: "size-1", accessoryId: "acc-1" },
      { garmentSizeId: "size-1", accessoryId: "acc-2" },
      { garmentSizeId: "size-2", accessoryId: "acc-3" },
    ]);
  });

  it("prunes invalid sizes and deleted accessories", () => {
    setAccessorySelection({
      "size-1": ["acc-1", "acc-invalid"],
      "size-old": ["acc-99"],
    });

    const pruned = pruneAccessorySelection(["size-1"], {
      "size-1": ["acc-1", "acc-2"],
    });

    expect(pruned).toEqual({
      "size-1": ["acc-1"],
    });
    expect(pruned["size-old"]).toBeUndefined();
  });

  it("clears accessory selection", () => {
    setAccessorySelection({ "size-1": ["acc-1"] });
    clearAccessorySelection();
    expect(getAccessorySelection()).toEqual({});
  });
});
