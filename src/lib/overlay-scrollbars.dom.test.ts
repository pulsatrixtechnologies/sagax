// @vitest-environment happy-dom
// Overlay scrollbars (2026-10-18): the scrolled element wears is-scrolling and
// its thumb shows only after a person's gesture, then both fade after IDLE_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GESTURE_WINDOW_MS,
  IDLE_MS,
  SCROLLING_CLASS,
  THUMB_BASE_LAYER,
  installOverlayScrollbars,
  scrollerLayer,
  scrollDeltaForThumbDelta,
  thumbGeometry,
} from "./overlay-scrollbars";

describe("thumbGeometry", () => {
  it("sizes the thumb by the visible share and places it by the scroll ratio", () => {
    expect(thumbGeometry({ scrollSize: 1000, clientSize: 250, scrollPos: 0, trackLength: 200 })).toEqual({ size: 50, offset: 0 });
    expect(thumbGeometry({ scrollSize: 1000, clientSize: 250, scrollPos: 750, trackLength: 200 })).toEqual({ size: 50, offset: 150 });
    expect(thumbGeometry({ scrollSize: 1000, clientSize: 250, scrollPos: 375, trackLength: 200 })).toEqual({ size: 50, offset: 75 });
  });

  it("keeps a minimum size and reads RTL negative offsets", () => {
    expect(thumbGeometry({ scrollSize: 100_000, clientSize: 100, scrollPos: -99_900, trackLength: 100 })).toEqual({ size: 32, offset: 68 });
  });

  it("returns null when nothing overflows", () => {
    expect(thumbGeometry({ scrollSize: 300, clientSize: 300, scrollPos: 0, trackLength: 300 })).toBeNull();
  });

  it("maps a thumb drag to the scroll distance", () => {
    expect(scrollDeltaForThumbDelta(15, { scrollSize: 1000, clientSize: 250, scrollPos: 0, trackLength: 200 })).toBe(75);
  });
});

describe("installOverlayScrollbars", () => {
  let uninstall: () => void = () => undefined;
  let scroller: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
    document.documentElement.dataset.skin = "pulsatrix";
    scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.style.height = "100px";
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    scroller.getBoundingClientRect = () => ({ top: 0, left: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(scroller);
    uninstall = installOverlayScrollbars(document);
  });

  afterEach(() => {
    uninstall();
    scroller.remove();
    delete document.documentElement.dataset.skin;
    vi.useRealTimers();
  });

  const wheel = () => scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 40 }));
  const scroll = () => scroller.dispatchEvent(new Event("scroll"));

  it("adds is-scrolling while the person scrolls and removes it after a second of rest", () => {
    wheel();
    scroll();
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(true);
    vi.advanceTimersByTime(IDLE_MS - 50);
    scroll();
    vi.advanceTimersByTime(IDLE_MS - 50);
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(false);
  });

  it("ignores a programmatic scroll, such as the chat following a stream", () => {
    scroll();
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(false);
    wheel();
    vi.advanceTimersByTime(GESTURE_WINDOW_MS + 1);
    scroll();
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(false);
  });

  it("shows a thumb part that never takes focus and is hidden from assistive tech", () => {
    wheel();
    scroll();
    vi.advanceTimersByTime(20);
    const thumb = document.querySelector<HTMLElement>('[data-overlay-scrollbar-part="y"]');
    expect(thumb).not.toBeNull();
    expect(thumb!.getAttribute("aria-hidden")).toBe("true");
    expect(thumb!.tabIndex).toBe(-1);
    expect(thumb!.dataset.visible).toBe("true");
    vi.advanceTimersByTime(IDLE_MS + 10);
    expect(thumb!.dataset.visible).toBe("false");
  });

  it("leaves Hibou 98 and opted-out elements to their native bars", () => {
    document.documentElement.dataset.skin = "retro98";
    wheel();
    scroll();
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(false);
    document.documentElement.dataset.skin = "pulsatrix";
    scroller.dataset.nativeScrollbar = "";
    wheel();
    scroll();
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(false);
  });

  it("removes its listeners and parts on uninstall", () => {
    uninstall();
    uninstall = () => undefined;
    wheel();
    scroll();
    expect(scroller.classList.contains(SCROLLING_CLASS)).toBe(false);
    expect(document.querySelector("[data-overlay-scrollbar-part]")).toBeNull();
  });

  // 2026-11-04: the thread list's bar painted over the thread menu (z 2147483646).
  it("paints the thumb at its scroller's level, under a menu layered above it", () => {
    wheel();
    scroll();
    vi.advanceTimersByTime(20);
    const thumb = document.querySelector<HTMLElement>('[data-overlay-scrollbar-part="y"]')!;
    expect(Number(thumb.style.zIndex)).toBe(THUMB_BASE_LAYER);
    expect(Number(thumb.style.zIndex)).toBeLessThan(50);
  });

  it("hides the thumb while an open menu crosses its strip", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.getBoundingClientRect = () => ({ top: 10, left: 280, right: 500, bottom: 300, width: 220, height: 290, x: 280, y: 10, toJSON: () => ({}) });
    document.body.appendChild(menu);
    try {
      wheel();
      scroll();
      vi.advanceTimersByTime(20);
      const thumb = document.querySelector<HTMLElement>('[data-overlay-scrollbar-part="y"]')!;
      thumb.getBoundingClientRect = () => ({ top: 2, left: 288, right: 298, bottom: 12, width: 10, height: 10, x: 288, y: 2, toJSON: () => ({}) });
      scroll();
      vi.advanceTimersByTime(20);
      expect(thumb.dataset.visible).toBe("false");
      menu.remove();
      scroll();
      vi.advanceTimersByTime(20);
      expect(thumb.dataset.visible).toBe("true");
    } finally {
      menu.remove();
    }
  });
});

describe("scrollerLayer", () => {
  it("takes the z-index of the scroller's outermost stacking context", () => {
    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.zIndex = "50";
    const inner = document.createElement("div");
    inner.style.position = "relative";
    inner.style.zIndex = "3";
    const list = document.createElement("div");
    inner.appendChild(list);
    modal.appendChild(inner);
    document.body.appendChild(modal);
    try {
      expect(scrollerLayer(list, document.body, window)).toBe(50);
      modal.style.zIndex = "";
      modal.style.position = "";
      expect(scrollerLayer(list, document.body, window)).toBe(3);
      inner.style.zIndex = "";
      expect(scrollerLayer(list, document.body, window)).toBe(THUMB_BASE_LAYER);
    } finally {
      modal.remove();
    }
  });
});
