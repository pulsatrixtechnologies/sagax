// The sidebar's mascot loop sleeps once every avatar rests: it used to run at
// the display's rate forever, rewriting every face (2026-10-18).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSidebarMascotRoot, registerSidebarMascot, resetSidebarMascotLoopForTests, setSidebarMascotReducedMotion } from "./loop";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function fakeSidebar() {
  const listeners: Record<string, (event: never) => void> = {};
  return {
    el: {
      getBoundingClientRect: () => rect(0, 0, 260, 600),
      addEventListener: (type: string, fn: (event: never) => void) => (listeners[type] = fn),
      removeEventListener: () => {},
    } as unknown as HTMLElement,
    fire: (type: string, event: object = {}) => listeners[type]?.(event as never),
  };
}

describe("the sidebar mascot loop", () => {
  let frames: FrameRequestCallback[] = [];
  let clock = 0;
  const run = (max = 400) => {
    let n = 0;
    while (frames.length && n < max) {
      clock += 16;
      frames.shift()!(clock);
      n += 1;
    }
    return n;
  };

  beforeEach(() => {
    frames = [];
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    resetSidebarMascotLoopForTests();
    setSidebarMascotReducedMotion(false);
  });
  afterEach(() => {
    attachSidebarMascotRoot(null);
    resetSidebarMascotLoopForTests();
    vi.unstubAllGlobals();
  });

  it("stops at rest, follows the pointer, then sleeps again once it is still or gone", () => {
    const side = fakeSidebar();
    attachSidebarMascotRoot(side.el);
    const gazes: number[] = [];
    let rests = 0;
    registerSidebarMascot({ getBox: () => rect(10, 100, 36, 36), onRest: () => (rests += 1), onGaze: (g) => gazes.push(g.x) });
    // registering asks for one frame; nothing moves, so the loop ends there
    expect(run()).toBeLessThanOrEqual(1);
    expect(frames).toHaveLength(0);

    side.fire("pointermove", { pointerType: "mouse", clientX: 200, clientY: 120 });
    const following = run();
    expect(following).toBeGreaterThan(5);
    // a still pointer: the gaze settles and the loop sleeps instead of spinning at display rate
    expect(following).toBeLessThan(400);
    expect(frames).toHaveLength(0);
    expect(gazes[gazes.length - 1]).toBeGreaterThan(0);

    side.fire("pointerleave");
    run();
    expect(frames).toHaveLength(0);
    expect(rests).toBeGreaterThan(0);
  });

  it("a scroll under a still pointer wakes it", () => {
    const side = fakeSidebar();
    attachSidebarMascotRoot(side.el);
    registerSidebarMascot({ getBox: () => rect(10, 100, 36, 36), onRest: () => {}, onGaze: () => {} });
    run();
    side.fire("scroll");
    expect(frames.length).toBe(1);
  });
});
