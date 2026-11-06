import { describe, expect, it } from "vitest";
import { menuRoomAbove, menuRoomBelow, windowOnlyMenuPlace } from "./ModelPickerMenu";

// 2026-11-03: the composer's model menu opened upward from a chip in the
// middle of a dialog and its top left the window.
describe("menuRoomAbove", () => {
  it("never lets a menu opened upward pass the window's top", () => {
    // chip at 350px from the top of a 900px window: bottom edge 556px from the bottom
    expect(menuRoomAbove(556, 900)).toBe(336);
  });
  it("keeps the 392px ceiling when there is room", () => {
    expect(menuRoomAbove(100, 1200)).toBe(392);
  });
  it("keeps a usable height when the chip sits near the top", () => {
    expect(menuRoomAbove(850, 900)).toBe(120);
  });
});

// Refs #1979: the model window pinned with CSS bottom near the top of the
// viewport, so the list drew above the window. It now pins by top.
describe("windowOnly menu place", () => {
  it("anchors by its top inside the viewport", () => {
    expect(windowOnlyMenuPlace()).toEqual({ left: 24, top: 96 });
  });
  it("keeps the menu below that top edge inside the window", () => {
    expect(menuRoomBelow(96, 1032)).toBe(392);
    expect(menuRoomBelow(96, 200)).toBe(120);
    // 1376 x 1032 capture: room from top 96 down leaves the full 392 ceiling
    expect(96 + menuRoomBelow(96, 1032)).toBeLessThanOrEqual(1032 - 8);
  });
  it("clamps the top pin on a short viewport so the menu stays on screen", () => {
    expect(windowOnlyMenuPlace(1032)).toEqual({ left: 24, top: 96 });
    expect(windowOnlyMenuPlace(180)).toEqual({ left: 24, top: 52 });
    expect(windowOnlyMenuPlace(100)).toEqual({ left: 24, top: 8 });
  });
});
