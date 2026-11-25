// The families the mascot registry carries (mascots.tsx) and the arrow keys
// across the mascot picker's grid (wardrobe.ts).
import { describe, expect, it } from "vitest";
import { MASCOTS } from "./mascots";
import { MASCOT_FAMILIES, wardrobeStep } from "./wardrobe";


describe("the registry's families", () => {
  it("gives every character a family, Owl and Trombi the classics, the rest by kind", () => {
    expect(Object.fromEntries(MASCOTS.map((option) => [option.id, option.family]))).toEqual({
      owl: "classics",
      crab: "animals",
      shape: "shapes",
      trombi: "classics",
      bunbu: "animals",
      shiba: "animals",
      grump: "animals",
      ogre: "animals",
      frog: "animals",
    });
    for (const option of MASCOTS) expect(MASCOT_FAMILIES).toContain(option.family);
  });

  it("sells nothing and marks nothing new yet", () => {
    expect(MASCOTS.filter((option) => option.premium || option.isNew)).toEqual([]);
  });
});

// [M-20261125-064] [D-20261125-030] The blocks "the filter chips" and "shelves and filters", and "names every
// family in English and French", are not ported: the chips (All, Owned, To unlock, Premium, one per family) and
// the shelves (Yours, To unlock, Premium) were the Appearance editor's gallery, which the mascot picker replaced
// (#5369) with two tabs and one grid. Their functions and their strings are removed with them; what narrows the
// grid now and where a locked mascot shows is covered by MascotPicker.dom.test.ts and mascots.test.ts.

describe("arrow keys across the cells", () => {
  it("steps one tile across, one row down and up, and stays at the edges", () => {
    // 8 tiles in rows of 4
    expect(wardrobeStep(0, 8, 4, "ArrowRight")).toBe(1);
    expect(wardrobeStep(7, 8, 4, "ArrowRight")).toBe(7);
    expect(wardrobeStep(0, 8, 4, "ArrowLeft")).toBe(0);
    expect(wardrobeStep(1, 8, 4, "ArrowDown")).toBe(5);
    expect(wardrobeStep(5, 8, 4, "ArrowDown")).toBe(5);
    expect(wardrobeStep(5, 8, 4, "ArrowUp")).toBe(1);
    expect(wardrobeStep(2, 8, 4, "ArrowUp")).toBe(2);
    expect(wardrobeStep(4, 8, 4, "Home")).toBe(0);
    expect(wardrobeStep(0, 8, 4, "End")).toBe(7);
    expect(wardrobeStep(3, 8, 0, "ArrowDown")).toBe(4);
    expect(wardrobeStep(0, 8, 4, "Enter")).toBeNull();
    expect(wardrobeStep(0, 0, 4, "ArrowRight")).toBeNull();
    // the picker's grid: rows of 5, the last row short (the plus at its end)
    expect(wardrobeStep(2, 12, 5, "ArrowDown")).toBe(7);
    expect(wardrobeStep(9, 12, 5, "ArrowDown")).toBe(9);
    expect(wardrobeStep(11, 12, 5, "ArrowUp")).toBe(6);
  });
});
