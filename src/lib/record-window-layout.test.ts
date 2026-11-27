// The record window's kept size and place (M-20261127-147): one preference per
// person, a part per type of window, read back whole, bounded by the window.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER_PREFERENCE_KEYS, MAX_PREFERENCE_VALUE } from "../../shared/user-preferences";
import { RECORD_CARD_WIDTH_KEY, RECORD_WINDOWS_KEY, RECORD_WINDOW_TYPES_MAX, keepRecordGrid, keepRecordWindow, parseRecordWindows, readRecordWindow, recordWindowBox, recordWindowType, serializeRecordWindows } from "./record-window-layout";

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => { stored.set(name, value); },
    removeItem: (name: string) => { stored.delete(name); },
  });
});

describe("the record windows preference", () => {
  it("follows the person from device to device", () => {
    expect(USER_PREFERENCE_KEYS).toContain(RECORD_WINDOWS_KEY);
  });

  it("keeps a part per type, forgets a part on undefined, and reads back only what reads", () => {
    const type = recordWindowType({ product: "nimbus_desk", kind: "ticket" });
    keepRecordWindow(type, { w: 1100, h: 700, x: 40, y: 30 });
    keepRecordWindow(type, { split: 400 });
    keepRecordGrid(type, "plan", { order: ["when", "who"], widths: { who: 180 } });
    expect(readRecordWindow(type)).toEqual({ w: 1100, h: 700, x: 40, y: 30, split: 400, grids: { plan: { order: ["when", "who"], widths: { who: 180 } } } });
    keepRecordWindow(type, { x: undefined, y: undefined, split: undefined });
    expect(readRecordWindow(type)).toEqual({ w: 1100, h: 700, grids: { plan: { order: ["when", "who"], widths: { who: 180 } } } });
    expect(parseRecordWindows(JSON.stringify({ "nimbus_desk/ticket": { w: 10, h: "big", x: 5 }, "../x": { w: 900 }, "a/b": { w: 900, grids: { "<x>": { order: [1] } } } }))).toEqual({ "a/b": { w: 900 } });
    expect(parseRecordWindows("not json")).toEqual({});
  });

  it("starts a type never sized at the size the opened card had on this device", () => {
    stored.set(RECORD_CARD_WIDTH_KEY, "1150");
    expect(readRecordWindow("nimbus_desk/company")).toEqual({ w: 1150 });
  });

  it("drops the oldest types first and never grows past one preference's size", () => {
    const many = Object.fromEntries(Array.from({ length: RECORD_WINDOW_TYPES_MAX + 5 }, (_, index) => [`product_${index}/kind`, { w: 900, h: 600, x: 10, y: 10, grids: { plan: { order: ["a", "b", "c"], widths: { a: 100, b: 120, c: 140 } } } }]));
    const text = serializeRecordWindows(many);
    expect(text.length).toBeLessThanOrEqual(MAX_PREFERENCE_VALUE);
    const kept = Object.keys(JSON.parse(text));
    expect(kept.at(-1)).toBe(`product_${RECORD_WINDOW_TYPES_MAX + 4}/kind`);
    expect(kept).not.toContain("product_0/kind");
  });

  it("shows the kept box bounded by the window, 16 px from each side, centred while nobody placed it", () => {
    expect(recordWindowBox({}, { width: 1440, height: 900 })).toEqual({ left: 100, top: 32, width: 1240, height: 852 });
    expect(recordWindowBox({ w: 3000, h: 3000, x: 500, y: 500 }, { width: 1000, height: 700 })).toEqual({ left: 16, top: 16, width: 968, height: 668 });
    expect(recordWindowBox({ w: 600, h: 400, x: 900, y: 900 }, { width: 1000, height: 700 })).toEqual({ left: 384, top: 284, width: 600, height: 400 });
  });
});
