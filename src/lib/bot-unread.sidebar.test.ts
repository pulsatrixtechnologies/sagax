import { describe, expect, it } from "vitest";
import { offscreenUnread, toggleSelected } from "./bot-unread";

const row = (top: number, unread: boolean) => ({ top, bottom: top + 54, unread });

describe("offscreenUnread", () => {
  it("counts unread rows out of the window, with the nearest one each side", () => {
    const rows = [row(-300, true), row(-200, true), row(-100, false), row(0, true), row(500, true), row(700, true)];
    expect(offscreenUnread(rows, { top: 0, bottom: 400 })).toEqual({ above: 2, below: 2, nearestAbove: 1, nearestBelow: 4 });
  });
  it("a row half in view counts as seen", () => {
    expect(offscreenUnread([row(-27, true), row(373, true)], { top: 0, bottom: 400 })).toEqual({ above: 0, below: 0, nearestAbove: null, nearestBelow: null });
  });
  it("nothing unread, nothing offscreen", () => {
    expect(offscreenUnread([row(-300, false), row(900, false)], { top: 0, bottom: 400 }).above).toBe(0);
  });
});

describe("toggleSelected", () => {
  it("adds then removes, keeping order", () => {
    expect(toggleSelected(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelected(["a", "b"], "a")).toEqual(["b"]);
  });
});
