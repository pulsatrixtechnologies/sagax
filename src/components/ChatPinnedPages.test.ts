import { describe, expect, it } from "vitest";

import { pagesFitInBar } from "./ChatPinnedPages";

describe("pagesFitInBar", () => {
  it("needs positive bar and pages widths", () => {
    expect(pagesFitInBar(0, 100, 80, 12, 120)).toBe(false);
    expect(pagesFitInBar(800, 100, 80, 12, 0)).toBe(false);
  });

  it("fits when the free left side covers the names", () => {
    // bar 800, center 200, right 120, pages start at 12, need 160 -> free 468
    expect(pagesFitInBar(800, 200, 120, 12, 160)).toBe(true);
  });

  it("overflows when names need more than the free side", () => {
    expect(pagesFitInBar(500, 200, 120, 12, 200)).toBe(false);
  });
});
