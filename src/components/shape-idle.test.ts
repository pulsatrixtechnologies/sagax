// The small shapes' idle life (shape-idle.ts): one shared clock that sleeps
// between blinks, skips avatars off screen and the hidden window, and the
// reduced-motion rule (no avatar registers, nothing breathes).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLINK } from "./shape-engine";
import { blinkIdleShape, idleSeed, idleShapeCount, idleStats, registerIdleShape, resetIdleShapesForTests } from "./shape-idle";
import { ShapeMascot } from "./ShapeMascot";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fakeEl = () => {
  const attrs: Record<string, string> = {};
  return { setAttribute: (k: string, v: string) => (attrs[k] = v), removeAttribute: (k: string) => delete attrs[k], attrs } as unknown as Element;
};

describe("the shared idle clock", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    resetIdleShapesForTests();
  });
  afterEach(() => {
    resetIdleShapesForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const runFrames = () => {
    let guard = 0;
    while (frames.length && guard < 200) {
      const cb = frames.shift()!;
      vi.advanceTimersByTime(16);
      cb(performance.now());
      guard += 1;
    }
  };

  it("sleeps between blinks: no frame until one is due, then a short run that ends open", () => {
    const opens: number[] = [];
    registerIdleShape({ el: fakeEl(), seed: 7, blink: (o) => opens.push(o) });
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(BLINK.maxGap * 1000 + 1000);
    expect(frames.length).toBe(1);
    runFrames();
    expect(Math.min(...opens)).toBeLessThan(0.5);
    expect(opens[opens.length - 1]).toBe(1);
    // a blink is about BLINK.length (or a double one) long: a dozen or two frames, not a loop
    expect(idleStats.frames).toBeLessThan(40);
    expect(frames).toHaveLength(0);
  });

  it("one timer serves many avatars and each keeps its own rhythm", () => {
    const counts = [0, 0, 0];
    counts.forEach((_, i) => registerIdleShape({ el: fakeEl(), seed: idleSeed(`bot-${i}`), blink: (o) => { if (o < 0.5) counts[i] += 1; } }));
    expect(idleShapeCount()).toBe(3);
    for (let s = 0; s < 30; s += 1) {
      vi.advanceTimersByTime(1000);
      runFrames();
    }
    expect(counts.every((c) => c > 0)).toBe(true);
    // over 30 s each blinks every 1.9 to 4.6 s: never at display rate
    expect(idleStats.wakeups).toBeLessThan(60);
  });

  it("a click blinks at once, and leaving stops the clock", () => {
    const el = fakeEl();
    const opens: number[] = [];
    const off = registerIdleShape({ el, seed: 3, blink: (o) => opens.push(o) });
    blinkIdleShape(el);
    expect(frames).toHaveLength(1);
    runFrames();
    expect(Math.min(...opens)).toBeLessThan(0.5);
    off();
    expect(idleShapeCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(frames).toHaveLength(0);
  });
});

describe("reduced motion", () => {
  it("the breath is off under prefers-reduced-motion", () => {
    const css = readFileSync(join(process.cwd(), "src/components/shape-mascot.css"), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.shape-idle\s*\{\s*animation: none;/);
  });

  it("a still drawing (thumbnail) never takes the idle class", () => {
    const html = renderToStaticMarkup(h(ShapeMascot, { color: "blue", size: 36, animated: false } as never));
    expect(html).not.toContain("shape-idle");
  });
});
