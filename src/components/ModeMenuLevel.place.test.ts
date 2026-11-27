// @vitest-environment happy-dom
// Where a level of the mode menu opens (PR #5412 review, round 2; M-20261126-104):
// - over the message box (the menu opened from the chip) a level never runs
//   lower than the menu, so the voice button and the meter stay in view;
// - anywhere else (the menu opened from the + menu of a narrow window, at the
//   window's top) a level keeps its natural height in the window: every level
//   of Effort shows and the list Custom opens is not scrolled;
// - a level of a fixed width that holds on neither side of the menu narrows to
//   the wider side's room, so it opens beside the menu, not over its edge.
// The numbers are the ones measured in the real app at 560 x 800 and 560 x 600.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { levelPlace, levelWidth, menuSitsOnBox, ModeMenuLevel } from "./ModeMenuLevel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top });
// the menu from the + menu of a narrow window: at the window's top
const TOP_MENU = rect(8, 6, 288, 247);
// the menu from the chip of a wide window: over the message box, its bottom 6 px over the chip
const BOX_MENU = rect(992, 441, 1272, 682);
const WIDE_BOX = rect(520, 676, 1272, 732);
// Effort's six levels and their padding: 216 px of rows
const EFFORT_HEIGHT = 224;

describe("menuSitsOnBox", () => {
  it("is the menu opened from the chip: its bottom falls on the box it is over", () => {
    expect(menuSitsOnBox(BOX_MENU, [WIDE_BOX])).toBe(true);
    // the gallery's menu stops 6 px over the box's top: still on it
    expect(menuSitsOnBox(rect(992, 435, 1272, 670), [WIDE_BOX])).toBe(true);
  });

  it("is not the menu at the window's top, a box that is not under it, or a box folded away", () => {
    expect(menuSitsOnBox(TOP_MENU, [rect(8, 700, 552, 756)])).toBe(false);
    expect(menuSitsOnBox(TOP_MENU, [rect(8, 500, 552, 556)])).toBe(false);
    // another conversation's box beside it
    expect(menuSitsOnBox(BOX_MENU, [rect(0, 676, 500, 732)])).toBe(false);
    expect(menuSitsOnBox(BOX_MENU, [rect(0, 0, 0, 0)])).toBe(false);
    expect(menuSitsOnBox(BOX_MENU, [])).toBe(false);
  });
});

describe("levelPlace", () => {
  const row = (menu: typeof TOP_MENU, top: number) => ({ left: menu.left, right: menu.right, top });

  it.each([800, 600])("a menu at the window's top (560 x %i): the level keeps its natural height, nothing cut", (height) => {
    // the Effort row is the menu's last: its level opens level with it
    const place = levelPlace(row(TOP_MENU, 205), { width: 260, height: EFFORT_HEIGHT }, { width: 560, height }, undefined);
    expect(place.top).toBe(205);
    expect(place.maxHeight).toBeGreaterThanOrEqual(EFFORT_HEIGHT);
    expect(place.top + EFFORT_HEIGHT).toBeLessThanOrEqual(height - 12);
  });

  it("a menu over the message box: the level stops at the menu's bottom, moved up to show whole", () => {
    const place = levelPlace(row(BOX_MENU, 636), { width: 260, height: EFFORT_HEIGHT }, { width: 1280, height: 800 }, undefined, BOX_MENU.bottom);
    expect(place.top + place.maxHeight).toBe(BOX_MENU.bottom);
    expect(place.maxHeight).toBe(EFFORT_HEIGHT);
    expect(place.top).toBe(BOX_MENU.bottom - EFFORT_HEIGHT);
  });
});

describe("levelWidth", () => {
  it("at 560 px the 280 px list Custom opens narrows to the room beside the menu", () => {
    // right of the menu: 560 - 12 of margin - (288 - 4 of overlap)
    expect(levelWidth(280, TOP_MENU, 560)).toBe(264);
    // Effort's 260 px fit as they are
    expect(levelWidth(260, TOP_MENU, 560)).toBe(260);
    expect(levelWidth(280, TOP_MENU, 1280)).toBe(280);
  });

  it("takes the left's room when the left is the wider side, and keeps its width when no side has a usable room", () => {
    expect(levelWidth(280, rect(272, 6, 552, 247), 560)).toBe(272 + 4 - 12);
    expect(levelWidth(280, rect(100, 6, 380, 247), 400)).toBe(280);
  });
});

describe("ModeMenuLevel in the page", () => {
  let host: HTMLDivElement;
  let root: Root;
  const restore: Array<() => void> = [];
  const stub = <T extends object>(target: T, key: string, value: PropertyDescriptor) => {
    const own = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...value });
    restore.push(() => (own ? Object.defineProperty(target, key, own) : delete (target as Record<string, unknown>)[key]));
  };
  const at = (node: HTMLElement, box: ReturnType<typeof rect>) => { node.getBoundingClientRect = () => box as DOMRect; };
  const page = (viewport: { width: number; height: number }, menuBox: ReturnType<typeof rect>, rowTop: number, composer: ReturnType<typeof rect>) => {
    stub(window, "innerWidth", { value: viewport.width });
    stub(window, "innerHeight", { value: viewport.height });
    const menu = document.createElement("div");
    menu.dataset.modelMenu = "";
    const row = document.createElement("button");
    row.dataset.modeRow = "reasoning";
    menu.append(row);
    const box = document.createElement("div");
    box.dataset.composerBox = "";
    document.body.append(menu, box);
    at(menu, menuBox);
    at(row, rect(menuBox.left + 4, rowTop, menuBox.right - 4, rowTop + 36));
    at(box, composer);
  };
  const open = (width: number, height = EFFORT_HEIGHT) => {
    // the level's natural size: its width as set, its rows' height
    stub(HTMLElement.prototype, "offsetHeight", { get(this: HTMLElement) { return this.dataset.modeLevel ? height : 0; } });
    stub(HTMLElement.prototype, "offsetWidth", { get(this: HTMLElement) { return this.dataset.modeLevel ? Number.parseFloat(this.style.width) || 0 : 0; } });
    act(() => root.render(createElement(ModeMenuLevel, {
      level: "reasoning", anchor: '[data-mode-row="reasoning"]', label: "Effort", width, focus: false,
      onKeyDown: () => undefined, onPointerEnter: () => undefined, children: null,
    })));
    const level = document.querySelector<HTMLElement>("[data-mode-level]")!;
    return { top: Number.parseFloat(level.style.top), left: Number.parseFloat(level.style.left), maxHeight: Number.parseFloat(level.style.maxHeight), width: level.style.width };
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    while (restore.length) restore.pop()!();
  });

  it.each([800, 600])("from the + menu of a 560 x %i window: Effort's levels open whole, the list Custom opens beside the menu", (height) => {
    page({ width: 560, height }, TOP_MENU, 209, rect(8, height - 100, 552, height - 44));
    const effort = open(260);
    expect(effort.top).toBe(205);
    expect(effort.maxHeight).toBeGreaterThanOrEqual(EFFORT_HEIGHT);
    expect(effort.width).toBe("260px");
    act(() => root.unmount());
    root = createRoot(host);
    // the list: 280 px do not fit beside a 280 px menu in 560 px; it takes the room there and covers nothing
    const custom = open(280, 120);
    expect(custom.width).toBe("264px");
    expect(custom.left).toBe(TOP_MENU.right - 4);
    expect(custom.maxHeight).toBeGreaterThanOrEqual(120);
  });

  it("from the chip of a wide window: the level stops at the menu's bottom, above the voice button and the meter", () => {
    page({ width: 1280, height: 800 }, BOX_MENU, 640, WIDE_BOX);
    const effort = open(260);
    expect(effort.top + effort.maxHeight).toBe(BOX_MENU.bottom);
    expect(effort.maxHeight).toBe(EFFORT_HEIGHT);
  });
});
