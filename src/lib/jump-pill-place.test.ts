import { describe, expect, it } from "vitest";
import { placeJumpPill } from "./jump-pill-place";

const pane = { left: 0, right: 800 };
// centered pill, 120 wide, in the band 500..530
const pill = { left: 340, right: 460, top: 500, bottom: 530 };

describe("placeJumpPill", () => {
  it("stays centered when no chip is in its band", () => {
    expect(placeJumpPill({ pane, pill, obstacles: [] })).toEqual({ mode: "center" });
    expect(placeJumpPill({ pane, pill, obstacles: [{ left: 300, right: 500, top: 200, bottom: 224 }] })).toEqual({ mode: "center" });
  });

  it("steps beside the chip it would cover, right first", () => {
    const chip = { left: 300, right: 500, top: 505, bottom: 529 };
    expect(placeJumpPill({ pane, pill, obstacles: [chip] })).toEqual({ mode: "beside", left: 508 });
  });

  it("goes left of the chip when the right has no room", () => {
    const chip = { left: 300, right: 700, top: 505, bottom: 529 };
    expect(placeJumpPill({ pane, pill, obstacles: [chip] })).toEqual({ mode: "beside", left: 172 });
  });

  it("hides while it cannot clear the chip", () => {
    const chip = { left: 100, right: 700, top: 505, bottom: 529 };
    expect(placeJumpPill({ pane, pill, obstacles: [chip] })).toEqual({ mode: "hidden" });
  });

  it("is relative to the pane's left edge", () => {
    const chip = { left: 1300, right: 1500, top: 505, bottom: 529 };
    expect(placeJumpPill({ pane: { left: 1000, right: 1800 }, pill: { ...pill, left: 1340, right: 1460 }, obstacles: [chip] })).toEqual({ mode: "beside", left: 508 });
  });
});
