import { describe, expect, it } from "vitest";
import { menuRoomAbove } from "./ModelPickerMenu";

// 2026-11-03: the composer's model menu opened upward from a chip in the
// middle of a dialog and its top left the window.
describe("menuRoomAbove", () => {
  it("never lets a menu opened upward pass the window's top", () => {
    // chip at 350px from the top of a 900px window: bottom edge 556px from the bottom
    expect(menuRoomAbove(556, 900)).toBe(336);
  });
  it("keeps the 560px ceiling when there is room", () => {
    expect(menuRoomAbove(100, 1200)).toBe(560);
  });
  it("keeps a usable height when the chip sits near the top", () => {
    expect(menuRoomAbove(850, 900)).toBe(120);
  });
});
