import { describe, expect, it } from "vitest";
import { placeAnchored } from "./anchored-placement";

const viewport = { width: 1000, height: 800 };
const anchor = (left: number, top: number, width = 80, height = 28) => ({ left, top, right: left + width, bottom: top + height, width, height });

describe("placeAnchored", () => {
  it("opens under the trigger, end-aligned, with the gap", () => {
    const place = placeAnchored({ anchor: anchor(700, 100), size: { width: 200, height: 120 }, viewport, align: "end" });
    expect(place).toMatchObject({ side: "bottom", top: 100 + 28 + 4, left: 780 - 200 });
  });

  it("aligns the start edge when asked", () => {
    const place = placeAnchored({ anchor: anchor(300, 100), size: { width: 200, height: 120 }, viewport, align: "start" });
    expect(place.left).toBe(300);
  });

  it("flips above when there is no room below and more room above", () => {
    const place = placeAnchored({ anchor: anchor(300, 700), size: { width: 200, height: 200 }, viewport, align: "start" });
    expect(place.side).toBe("top");
    expect(place.top).toBe(700 - 4 - 200);
  });

  it("stays below and caps the height when neither side fits, using the larger side", () => {
    const place = placeAnchored({ anchor: anchor(300, 300), size: { width: 200, height: 900 }, viewport, align: "start" });
    expect(place.side).toBe("bottom");
    expect(place.maxHeight).toBe(800 - (300 + 28 + 4) - 8);
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(800);
  });

  it("shifts left so the right edge stays inside the viewport", () => {
    const place = placeAnchored({ anchor: anchor(950, 100, 40), size: { width: 300, height: 100 }, viewport, align: "start" });
    expect(place.left).toBe(1000 - 300 - 8);
  });

  it("shifts right so the left edge stays inside the viewport", () => {
    const place = placeAnchored({ anchor: anchor(10, 100, 40), size: { width: 300, height: 100 }, viewport, align: "end" });
    expect(place.left).toBe(8);
  });

  it("centres on the trigger", () => {
    const place = placeAnchored({ anchor: anchor(400, 100, 100), size: { width: 200, height: 100 }, viewport, align: "center" });
    expect(place.left).toBe(450 - 100);
  });

  it("prefers opening above when side is top and it fits", () => {
    const place = placeAnchored({ anchor: anchor(300, 400), size: { width: 200, height: 100 }, viewport, align: "start", side: "top" });
    expect(place).toMatchObject({ side: "top", top: 400 - 4 - 100 });
  });

  it("never pushes a popover wider than the viewport off the left edge", () => {
    const place = placeAnchored({ anchor: anchor(100, 100), size: { width: 2000, height: 100 }, viewport, align: "start" });
    expect(place.left).toBe(8);
  });
});
