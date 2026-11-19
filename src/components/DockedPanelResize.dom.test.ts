// @vitest-environment happy-dom
// The app's one resize handle, driven the way a person drives it: a docked
// column's left edge (unchanged), and the edges and corner of a box that
// floats (the record card, #5053): which way it grows, its bounds, the room
// the window leaves, the kept value, and the return to the default.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampPanelSize, DockedPanelResizeHandle, ResizeHandle, useDockedPanelWidth, type DockedPanelBounds, type DockedPanelSize } from "./DockedPanelResize";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WIDE: DockedPanelBounds = { key: "test.wide", min: 480, max: 3840, fallback: 1000 };
const TALL: DockedPanelBounds = { key: "test.tall", min: 320, max: 2160, fallback: 720 };
let host: HTMLDivElement;
let root: Root;
let stored: Map<string, string>;
let sizes: { wide: DockedPanelSize; tall: DockedPanelSize };

const pointer = (target: Element, type: string, x = 0, y = 0) =>
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })); });
const drag = (target: Element, dx: number, dy = 0) => {
  pointer(target, "pointerdown", 500, 400);
  pointer(target, "pointermove", 500 + dx, 400 + dy);
  pointer(target, "pointerup", 500 + dx, 400 + dy);
};
const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });

/** A floating box with every handle the record card has; `room` is the window's. */
function Box({ room }: { room?: { width: number; height: number } }) {
  const wide = useDockedPanelWidth(WIDE);
  const tall = useDockedPanelWidth(TALL);
  sizes = { wide, tall };
  const across = (toward: 1 | -1) => ({ panel: wide, toward, rate: 2, room: room ? () => room.width : undefined });
  const down = { panel: tall, toward: 1 as const, room: room ? () => room.height : undefined };
  const reset = [wide, tall];
  return createElement("div", null,
    createElement(ResizeHandle, { label: "left", x: across(-1), reset, quiet: true }),
    createElement(ResizeHandle, { label: "right", x: across(1), reset }),
    createElement(ResizeHandle, { label: "bottom", y: down, reset }),
    createElement(ResizeHandle, { label: "corner", x: across(1), y: down, reset, quiet: true, corner: "se" }),
  );
}
const handle = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const show = (room?: { width: number; height: number }) => act(() => root.render(createElement(Box, { room })));

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => { stored.set(name, value); },
    removeItem: (name: string) => { stored.delete(name); },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a docked column's handle", () => {
  function Column() {
    const panel = useDockedPanelWidth();
    return createElement("div", { "data-width": panel.width }, createElement(DockedPanelResizeHandle, { label: "resize", panel }));
  }
  const width = () => Number(host.firstElementChild!.getAttribute("data-width"));

  it("widens as its left edge is pulled left, inside 320 to 720 px, and keeps the width on release", () => {
    act(() => root.render(createElement(Column)));
    expect(width()).toBe(360);
    const edge = handle("resize");
    expect(edge.className).toContain("app-resize-handle");
    expect(edge.getAttribute("aria-orientation")).toBe("vertical");
    expect(edge.tabIndex).toBe(0);
    drag(edge, -100);
    expect(width()).toBe(460);
    expect(stored.get("omb-settings-panel-width")).toBe("460");
    drag(edge, -900);
    expect(width()).toBe(720);
    drag(edge, 900);
    expect(width()).toBe(320);
  });

  it("moves 24 px a step on the arrow keys and has no double-click of its own", () => {
    act(() => root.render(createElement(Column)));
    const edge = handle("resize");
    key(edge, "ArrowLeft");
    expect(width()).toBe(384);
    expect(stored.get("omb-settings-panel-width")).toBe("384");
    key(edge, "ArrowRight");
    expect(width()).toBe(360);
    act(() => { edge.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(width()).toBe(360);
    expect(stored.get("omb-settings-panel-width")).toBe("360");
  });
});

describe("a floating box's handles", () => {
  it("grows by twice the travel on a side (the box stays centred) and by the travel on its bottom edge", () => {
    show();
    drag(handle("right"), 60);
    expect(sizes.wide.width).toBe(1120);
    drag(handle("left"), -40);
    expect(sizes.wide.width).toBe(1200);
    drag(handle("left"), 40);
    expect(sizes.wide.width).toBe(1120);
    drag(handle("bottom"), 0, 50);
    expect(sizes.tall.width).toBe(770);
    // a travel across does nothing to the height, a travel down nothing to the width
    drag(handle("bottom"), 80, 0);
    drag(handle("right"), 0, 80);
    expect([sizes.wide.width, sizes.tall.width]).toEqual([1120, 770]);
  });

  it("moves both sizes from a corner", () => {
    show();
    drag(handle("corner"), 30, 20);
    expect([sizes.wide.width, sizes.tall.width]).toEqual([1060, 740]);
    expect(handle("corner").getAttribute("data-resize-corner")).toBe("se");
  });

  it("stops at its readable minimum and at the room the window leaves", () => {
    show({ width: 1408, height: 812 });
    drag(handle("right"), -2000);
    expect(sizes.wide.width).toBe(480);
    drag(handle("right"), 2000);
    expect(sizes.wide.width).toBe(1408);
    drag(handle("bottom"), 0, -2000);
    expect(sizes.tall.width).toBe(320);
    drag(handle("bottom"), 0, 2000);
    expect(sizes.tall.width).toBe(812);
    // a window smaller than the minimum: the box is the window's, never larger
    expect(clampPanelSize(1000, WIDE, 400)).toBe(400);
  });

  it("keeps the size on release, and only a size that changed", () => {
    show();
    pointer(handle("right"), "pointerdown", 500, 400);
    pointer(handle("right"), "pointermove", 560, 400);
    // while the pointer is down nothing is written
    expect(stored.has(WIDE.key)).toBe(false);
    expect(handle("right").hasAttribute("data-resizing")).toBe(true);
    pointer(handle("right"), "pointerup", 560, 400);
    expect(stored.get(WIDE.key)).toBe("1120");
    expect(stored.has(TALL.key)).toBe(false);
    expect(handle("right").hasAttribute("data-resizing")).toBe(false);
  });

  it("never overwrites the kept size because a smaller window bounds the box", () => {
    stored.set(WIDE.key, "1200");
    stored.set(TALL.key, "780");
    show({ width: 728, height: 462 });
    // a press that moves nothing (and the two presses of a double-click) writes nothing
    pointer(handle("corner"), "pointerdown", 500, 400);
    pointer(handle("corner"), "pointerup", 500, 400);
    expect([stored.get(WIDE.key), stored.get(TALL.key)]).toEqual(["1200", "780"]);
    expect(sizes.wide.width).toBe(1200);
    // a real pull starts from the size shown (728), not from the kept one
    drag(handle("right"), -14);
    expect(stored.get(WIDE.key)).toBe("700");
    expect(stored.get(TALL.key)).toBe("780");
  });

  it("reads the kept size when it opens again", () => {
    show();
    drag(handle("corner"), 100, 60);
    act(() => root.unmount());
    root = createRoot(host);
    show();
    expect([sizes.wide.width, sizes.tall.width]).toEqual([1200, 780]);
  });

  it("returns to the default size on a double-click on any handle, and forgets the kept one", () => {
    show();
    drag(handle("corner"), 100, 60);
    expect([stored.get(WIDE.key), stored.get(TALL.key)]).toEqual(["1200", "780"]);
    act(() => { handle("bottom").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect([sizes.wide.width, sizes.tall.width]).toEqual([1000, 720]);
    expect(stored.has(WIDE.key)).toBe(false);
    expect(stored.has(TALL.key)).toBe(false);
    // Enter on an edge does the same for the keyboard
    drag(handle("right"), 50);
    key(handle("right"), "Enter");
    expect(sizes.wide.width).toBe(1000);
    expect(stored.has(WIDE.key)).toBe(false);
  });

  it("answers the arrow keys on the edges: across for the width, down for the height", () => {
    show();
    key(handle("right"), "ArrowRight");
    expect(sizes.wide.width).toBe(1024);
    key(handle("right"), "ArrowLeft");
    key(handle("right"), "ArrowLeft");
    expect(sizes.wide.width).toBe(976);
    expect(stored.get(WIDE.key)).toBe("976");
    key(handle("bottom"), "ArrowDown");
    expect(sizes.tall.width).toBe(744);
    key(handle("bottom"), "ArrowUp");
    expect(sizes.tall.width).toBe(720);
    // an arrow of the other direction is not the edge's
    key(handle("right"), "ArrowDown");
    expect([sizes.wide.width, sizes.tall.width]).toEqual([976, 720]);
  });

  it("gives the keyboard and a screen reader the right and bottom edges; the left edge and the corner are the pointer's", () => {
    show();
    for (const name of ["right", "bottom"]) {
      expect(handle(name).tabIndex).toBe(0);
      expect(handle(name).getAttribute("aria-hidden")).toBeNull();
      expect(handle(name).getAttribute("role")).toBe("separator");
    }
    expect(handle("right").getAttribute("aria-orientation")).toBe("vertical");
    expect(handle("bottom").getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle("right").getAttribute("aria-valuenow")).toBe("1000");
    for (const name of ["left", "corner"]) {
      expect(handle(name).hasAttribute("tabindex")).toBe(false);
      expect(handle(name).getAttribute("aria-hidden")).toBe("true");
    }
    // one mechanism: every handle is the app's shared one
    for (const name of ["left", "right", "bottom", "corner"]) expect(handle(name).className).toContain("app-resize-handle");
  });
});
