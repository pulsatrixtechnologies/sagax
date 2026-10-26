// The clean-room Shapes engine (shape-art.ts, shape-engine.ts): geometry,
// timings, the gaze solver's bounds, the moves and reduced motion.
import { REST_POSE, warpPath } from "./shape-volume";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MASCOT_SHAPES } from "../../shared/mascot-look";
import { paletteSwatches, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { BODY, MOVE_RADII, outlinePath, RADII_COUNT, radiusToward, SHAPE_RADII } from "./shape-art";
import {
  BLINK,
  blinkOpen,
  blinkSchedule,
  BREATH_AMOUNT,
  BREATH_S,
  clayStops,
  drift,
  EXPRESSIONS,
  EYE_MARGIN,
  Follower,
  HOVER,
  hoverGaze,
  MORPH_S,
  MOVE_TIMING,
  moveAt,
  moveWeight,
  ShapeEngine,
  SHAPE_EXPRESSIONS,
  SHAPE_MOVES,
  solveEyes,
  stillFrame,
  WANDER,
} from "./shape-engine";
import { ShapeMascot, shapeIsLive } from "./ShapeMascot";

const BLUE = "#3b93f0";

describe("geometry", () => {
  it("draws every shape and every move body from 64 positive radii, as one closed smooth outline", () => {
    const tables = { ...SHAPE_RADII, ...MOVE_RADII };
    for (const [name, radii] of Object.entries(tables)) {
      expect(radii, name).toHaveLength(RADII_COUNT);
      for (const r of radii) {
        expect(Number.isFinite(r), name).toBe(true);
        expect(r, name).toBeGreaterThan(0.1);
        expect(r, name).toBeLessThan(1.3);
      }
      const d = outlinePath(radii);
      expect(d.startsWith("M"), name).toBe(true);
      expect(d.endsWith("Z"), name).toBe(true);
      expect(d.match(/C/g), name).toHaveLength(RADII_COUNT);
    }
  });

  it("has eight different shapes: a circle of radius 1, a heart, a wide capsule, a triangle and a teardrop pointing up", () => {
    expect(MASCOT_SHAPES).toHaveLength(8);
    expect(new Set(MASCOT_SHAPES.map((shape) => SHAPE_RADII[shape].join())).size).toBe(8);
    expect(SHAPE_RADII.circle.every((r) => r === 1)).toBe(true);
    const at = (shape: keyof typeof SHAPE_RADII, x: number, y: number) => radiusToward(SHAPE_RADII[shape], x, y);
    expect(at("pill", 1, 0)).toBeGreaterThan(at("pill", 0, -1) * 1.5);
    expect(at("pick", 0, -1)).toBeGreaterThan(at("pick", 0, 1));
    expect(at("drop", 0, -1)).toBeGreaterThan(1);
    expect(at("drop", 0, -1)).toBeGreaterThan(at("drop", 0, 1));
    expect(at("hexagon", 1, 0)).toBeGreaterThan(at("hexagon", 0, -1));
    // bean is a heart: a cleft on top, lobes to the sides, a point at the bottom
    expect(at("bean", 0, 1)).toBeGreaterThan(at("bean", 0, -1));
    expect(at("bean", 0, -1)).toBeLessThan(at("bean", 0.7, -0.7));
    expect(at("bean", 0, -1)).toBeLessThan(at("bean", -0.7, -0.7));
  });
});

describe("timing", () => {
  it("slides a change of shape over 0.45 s", () => {
    const engine = new ShapeEngine({ shape: "circle", expression: "neutral", color: BLUE }, 0, 3);
    engine.set({ shape: "pill", expression: "neutral", color: BLUE }, 1);
    const target = stillFrame({ shape: "pill", expression: "neutral", color: BLUE }).body;
    const start = stillFrame({ shape: "circle", expression: "neutral", color: BLUE }).body;
    const mid = engine.frame(1 + MORPH_S / 3).body;
    expect(mid).not.toBe(target);
    expect(mid).not.toBe(start);
    expect(MORPH_S).toBe(0.45);
    expect(engine.frame(1 + MORPH_S).body).toBe(target);
  });

  it("blinks first at BLINK.first, then every BLINK.minGap to BLINK.maxGap s, sometimes twice, each blink BLINK.length", () => {
    for (const seed of [1, 7, 42, 99]) {
      const times = blinkSchedule(seed, 120);
      expect(times[0]).toBe(BLINK.first);
      for (let i = 1; i < times.length; i += 1) {
        const gap = times[i] - times[i - 1];
        const double = Math.abs(gap - BLINK.doubleAfter) < 1e-9;
        if (!double) {
          expect(gap).toBeGreaterThanOrEqual(BLINK.minGap - BLINK.doubleAfter - 1e-9);
          expect(gap).toBeLessThanOrEqual(BLINK.maxGap + 1e-9);
        }
      }
    }
    const doubles = blinkSchedule(5, 2000).filter((t, i, all) => i > 0 && Math.abs(t - all[i - 1] - BLINK.doubleAfter) < 1e-9).length;
    expect(doubles).toBeGreaterThan(0);
    // a natural, irregular rhythm (measured 2026-10-18): about one blink every 1 to 4 s, each under 0.2 s
    expect(BLINK.length).toBeLessThan(0.2);
    expect(BLINK.minGap).toBeLessThan(BLINK.maxGap);
    const at = [10];
    expect(blinkOpen(10 + BLINK.length * BLINK.closing, at)).toBeCloseTo(BLINK.floor, 5);
    expect(blinkOpen(9.99, at)).toBe(1);
    expect(blinkOpen(10 + BLINK.length + 0.001, at)).toBe(1);
  });

  it("breathes on a 3.4 s cycle and drifts by less than 1% of the body", () => {
    expect(BREATH_S).toBe(3.4);
    for (const t of [0, 0.7, 1.9, 5.3]) {
      expect(drift(t, 4).breath).toBeCloseTo(drift(t + BREATH_S, 4).breath, 9);
      expect(Math.abs(drift(t, 4).breath - 1)).toBeLessThanOrEqual(BREATH_AMOUNT + 1e-12);
      expect(Math.abs(drift(t, 4).x)).toBeLessThan(0.01);
      expect(Math.abs(drift(t, 4).y)).toBeLessThan(0.01);
    }
    expect(drift(BREATH_S / 4, 4).breath).toBeCloseTo(1 + BREATH_AMOUNT, 9);
    // the gaze wanders on five slow loops
    expect([...WANDER.yaw, ...WANDER.pitch, ...WANDER.roll]).toHaveLength(5);
  });

  it("turns toward the pointer, 16 degrees sideways and 13 up or down, settling within 0.85 s", () => {
    expect(hoverGaze(1, 0)).toEqual({ yaw: HOVER.yaw, pitch: -0 });
    expect(hoverGaze(0, -1).pitch).toBe(13);
    expect(hoverGaze(5, 5)).toEqual({ yaw: 16, pitch: -13 });
    const follow = new Follower(0);
    follow.target = 16;
    for (let t = 0; t < HOVER.turn - 1e-9; t += 1 / 60) follow.step(1 / 60);
    expect(follow.value).toBeGreaterThan(16 * 0.985);
    const early = new Follower(0);
    early.target = 16;
    early.step(0.1);
    expect(early.value).toBeLessThan(16 * 0.6);
  });
});

describe("the gaze solver", () => {
  it("keeps both eyes inside every outline, for every face, wherever the pointer is", () => {
    const pointers = [[0, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const shape of MASCOT_SHAPES) {
      for (const name of SHAPE_EXPRESSIONS) {
        for (const [x, y] of pointers) {
          const gaze = hoverGaze(x, y);
          const eyes = solveEyes(SHAPE_RADII[shape], EXPRESSIONS[name], { ...gaze, roll: 0 }, { left: 1, right: 1 });
          for (const eye of eyes) {
            if (eye.alpha <= 0) continue;
            for (const [px, py] of eye.points) {
              expect(Math.hypot(px, py), `${shape} ${name} ${x},${y}`).toBeLessThanOrEqual(radiusToward(SHAPE_RADII[shape], px, py || -1e-6) - EYE_MARGIN + 1e-6);
            }
          }
        }
      }
    }
  });

  it("fades an eye that turns away and moves the face toward the pointer", () => {
    const away = solveEyes(SHAPE_RADII.circle, EXPRESSIONS.neutral, { yaw: 110, pitch: 0, roll: 0 }, { left: 1, right: 1 });
    expect(Math.min(...away.map((eye) => eye.alpha))).toBe(0);
    const rest = solveEyes(SHAPE_RADII.circle, EXPRESSIONS.neutral, { yaw: 0, pitch: 0, roll: 0 }, { left: 1, right: 1 });
    expect(rest.every((eye) => eye.alpha === 1)).toBe(true);
    const right = solveEyes(SHAPE_RADII.circle, EXPRESSIONS.neutral, { ...hoverGaze(1, 0), roll: 0 }, { left: 1, right: 1 });
    expect(right[0].center[0]).toBeGreaterThan(rest[0].center[0]);
    const up = solveEyes(SHAPE_RADII.circle, EXPRESSIONS.neutral, { ...hoverGaze(0, -1), roll: 0 }, { left: 1, right: 1 });
    expect(up[0].center[1]).toBeLessThan(rest[0].center[1]);
  });

  it("offers sixteen faces", () => {
    expect(SHAPE_EXPRESSIONS).toHaveLength(16);
    expect(Object.keys(EXPRESSIONS)).toHaveLength(16);
  });
});

describe("moves", () => {
  it("has the fourteen moves, each sliding in and back to rest", () => {
    expect(SHAPE_MOVES).toEqual(["thinking", "wink", "wide", "alert", "notify", "exclaim", "sleep", "egg", "hexagon", "play", "orbit", "swirl", "burst", "comet"]);
    for (const move of SHAPE_MOVES) {
      const { duration, morph } = MOVE_TIMING[move];
      expect(moveWeight(move, 0), move).toBe(0);
      expect(moveWeight(move, duration / 2), move).toBeGreaterThan(0.5);
      expect(moveWeight(move, duration + morph + 0.01), move).toBe(0);
    }
  });

  it("turns the body into three dots while thinking, a mark for alerts, adds rings and ribbons", () => {
    const thinking = moveAt("thinking", 1);
    expect(thinking.eyes).toBe(0);
    expect(thinking.dots).toHaveLength(2);
    expect(thinking.radii).toBe(MOVE_RADII.dot);
    expect(moveAt("exclaim", 1).radii).toBe(MOVE_RADII.bar);
    expect(moveAt("alert", 1).rot).toBeGreaterThan(10);
    expect(moveAt("notify", 1).badge).toBeTruthy();
    expect(moveAt("orbit", 1).rings).toHaveLength(6);
    expect(moveAt("swirl", 0.5).rings).toHaveLength(3);
    expect(moveAt("play", 1).ribbons).toHaveLength(4);
    expect(moveAt("comet", 1).ribbons).toHaveLength(4);
    expect(moveAt("burst", 1).specks).toHaveLength(5);
    expect(moveAt("burst", 2).radii).toBeUndefined();
  });

  it("draws a move's frame: the body changes, the rings split in front and behind", () => {
    const engine = new ShapeEngine({ shape: "circle", expression: "neutral", color: BLUE }, 0, 9);
    engine.play("orbit", 0);
    const frame = engine.frame(1);
    expect(frame.rings).toHaveLength(6);
    expect(frame.rings.some((ring) => ring.front && ring.back)).toBe(true);
    expect(engine.playing(1)).toBe(true);
    expect(engine.playing(10)).toBe(false);
    const rest = engine.frame(10);
    expect(rest.rings).toHaveLength(0);
    expect(rest.eyes.split("M").filter(Boolean)).toHaveLength(2);
  });
});

describe("clay and colors", () => {
  it("lights the clay from the upper left to a darker rim, in four steps", () => {
    const stops = clayStops(BLUE);
    expect(stops.map((stop) => stop.offset)).toEqual([0, 0.3, 0.7, 1]);
    expect(stops[2].color).toBe(BLUE);
    const lum = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + Number.parseInt(hex.slice(i, i + 2), 16), 0);
    expect(lum(stops[0].color)).toBeGreaterThan(lum(stops[1].color));
    expect(lum(stops[1].color)).toBeGreaterThan(lum(stops[2].color));
    expect(lum(stops[3].color)).toBeLessThan(lum(stops[2].color));
    expect(stillFrame({ shape: "circle", expression: "neutral", color: BLUE }).light.x).toBeLessThan(BODY.center[0]);
  });

  it("offers twelve Clay colors, blue among them", () => {
    const row = paletteSwatches("clay");
    expect(row).toHaveLength(12);
    expect(row[1]).toBe("brown");
    expect(MASCOT_COLOR_HEX.cobalt.toLowerCase()).toBe("#3b93f0");
  });

  it("blends a color change over the morph", () => {
    const engine = new ShapeEngine({ shape: "circle", expression: "neutral", color: "#000000" }, 0, 2);
    engine.set({ shape: "circle", expression: "neutral", color: "#ffffff" }, 1);
    const mid = engine.frame(1.05).color;
    expect(mid).not.toBe("#000000");
    expect(mid).not.toBe("#ffffff");
    expect(engine.frame(1 + MORPH_S).color).toBe("#ffffff");
  });
});

describe("reduced motion", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("keeps every shape still: no live loop, the resting frame, no move", () => {
    expect(shapeIsLive(112, true, undefined, true)).toBe(false);
    expect(shapeIsLive(112, true, undefined, false)).toBe(true);
    expect(shapeIsLive(24, true, undefined, false)).toBe(false);
    (globalThis as { window?: unknown }).window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
    const html = renderToStaticMarkup(createElement(ShapeMascot, { shape: "cloud", color: BLUE, size: 120, move: { clip: "orbit", key: 1 } }));
    expect(html).not.toContain("skin-fx-live");
    const still = stillFrame({ shape: "cloud", expression: "neutral", color: BLUE });
    // the resting outline, in the resting pose (a plain body bends a little into its turn)
    expect(html).toContain(`d="${warpPath(still.body, REST_POSE)}"`);
    expect(html).not.toContain("-ring0");
  });
});
