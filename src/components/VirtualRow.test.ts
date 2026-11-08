import { describe, expect, it } from "vitest";

import { eagerTailStart, rememberRowHeight, rememberedRowHeight } from "./VirtualRow";

describe("virtualized rows (#2755)", () => {
  it("draws at once only the tail that fills the screen", () => {
    const keys = Array.from({ length: 120 }, (_, index) => `row-${index}`);
    // 160 px estimated per row: 1350 px are filled by the last 9 rows
    expect(eagerTailStart(keys, 1350, 160, () => undefined)).toBe(111);
  });

  it("uses a remembered height before the estimate", () => {
    const keys = ["a", "b", "c", "d"];
    const heights: Record<string, number> = { d: 900, c: 500 };
    expect(eagerTailStart(keys, 1350, 160, (key) => heights[key])).toBe(2);
  });

  it("draws the whole list when it is shorter than the screen", () => {
    expect(eagerTailStart(["a", "b"], 1350, 160, () => undefined)).toBe(0);
    expect(eagerTailStart([], 1350, 160, () => undefined)).toBe(0);
  });

  it("remembers heights by key, rounded, and ignores a missing size", () => {
    rememberRowHeight("unit:a", 41.6);
    expect(rememberedRowHeight("unit:a")).toBe(42);
    rememberRowHeight("unit:a", Number.NaN);
    expect(rememberedRowHeight("unit:a")).toBe(42);
    rememberRowHeight("unit:b", 0);
    expect(rememberedRowHeight("unit:b")).toBe(0);
  });

  it("forgets the oldest heights past its bound", () => {
    rememberRowHeight("unit:first", 10);
    for (let index = 0; index < 4000; index++) rememberRowHeight(`unit:fill-${index}`, 20);
    expect(rememberedRowHeight("unit:first")).toBeUndefined();
    expect(rememberedRowHeight("unit:fill-3999")).toBe(20);
  });
});
