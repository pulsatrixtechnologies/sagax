import { describe, expect, it } from "vitest";

import { placeMenu } from "./AnchoredMenu";

const view = { width: 1000, height: 700 };

describe("a dropdown that is never clipped", () => {
  it("opens under its trigger, its end edge on the trigger's", () => {
    const spot = placeMenu({ left: 600, right: 700, top: 100, bottom: 132 }, { width: 200, height: 120 }, view, "end");
    expect(spot).toEqual({ left: 500, top: 136, flipped: false });
  });
  it("flips above the trigger at the bottom of the window", () => {
    const spot = placeMenu({ left: 600, right: 700, top: 640, bottom: 672 }, { width: 200, height: 120 }, view, "end");
    expect(spot.flipped).toBe(true);
    expect(spot.top).toBe(640 - 4 - 120);
  });
  it("stays 8px inside the window at the right and left edges", () => {
    expect(placeMenu({ left: 960, right: 990, top: 10, bottom: 40 }, { width: 200, height: 80 }, view, "start").left).toBe(1000 - 200 - 8);
    expect(placeMenu({ left: 0, right: 20, top: 10, bottom: 40 }, { width: 200, height: 80 }, view, "end").left).toBe(8);
  });
  it("stays below when there is less room above than below", () => {
    expect(placeMenu({ left: 10, right: 40, top: 20, bottom: 52 }, { width: 100, height: 900 }, view, "start").flipped).toBe(false);
  });
});
