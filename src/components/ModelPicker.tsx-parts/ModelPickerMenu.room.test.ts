import { describe, expect, it } from "vitest";
import { menuListMinHeight } from "./helpers";
import { menuRoomAbove, menuRoomBelow, windowOnlyMenuPlace } from "./ModelPickerMenu";

// 2026-11-03: the composer's model menu opened upward from a chip in the
// middle of a dialog and its top left the window.
describe("menuRoomAbove", () => {
  it("never lets a menu opened upward pass the window's top", () => {
    // chip at 350px from the top of a 900px window: bottom edge 556px from the bottom
    expect(menuRoomAbove(556, 900)).toBe(336);
  });
  it("keeps the 520px ceiling when there is room", () => {
    expect(menuRoomAbove(100, 1200)).toBe(520);
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
    expect(menuRoomBelow(96, 1032)).toBe(520);
    expect(menuRoomBelow(96, 200)).toBe(120);
    // 1376 x 1032 capture: room from top 96 down leaves the full 520 ceiling
    expect(96 + menuRoomBelow(96, 1032)).toBeLessThanOrEqual(1032 - 8);
  });
  it("clamps the top pin on a short viewport so the menu stays on screen", () => {
    expect(windowOnlyMenuPlace(1032)).toEqual({ left: 24, top: 96 });
    expect(windowOnlyMenuPlace(180)).toEqual({ left: 24, top: 52 });
    expect(windowOnlyMenuPlace(100)).toEqual({ left: 24, top: 8 });
  });
});

// #3116: the list of the chat-bar menu kept a few rows when the fixed
// chrome (search, settings, Manage) took the rest of a short menu. It now
// keeps a floor and the footer scrolls instead.
describe("menuListMinHeight", () => {
  it("keeps about seven rows in a full-height menu", () => {
    expect(menuListMinHeight(520)).toBe(240);
    expect(menuListMinHeight(1000)).toBe(240);
  });
  it("leaves the chrome its room in a shorter menu, never under 120px", () => {
    expect(menuListMinHeight(400)).toBe(220);
    expect(menuListMinHeight(300)).toBe(120);
    expect(menuListMinHeight(120)).toBe(120);
  });
});
