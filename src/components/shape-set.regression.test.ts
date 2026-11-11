// Every shape holds together and keeps its face (2026-10-28, one drawing).
// Measured on the drawing itself (shape-volume.ts drawShape: what React and
// the live loop both put on screen), in the drawing's own space, for every
// shape of the set, every skin, every face, a blink, the gaze's four corners,
// and each of the fourteen moves at five moments, on a resting and on a
// rolled, squashed body:
// - the body is one closed outline that never shrinks to a dot or a bar;
// - the two eyes sit inside the face, are the same capsule, level, upright
//   at rest, and come back to rest after every move;
// - every slice of the body touches the face (its middle and its outline at
//   half size sit in the face), so no piece ever stands beside the body;
// - the pumpkin's stem stands in the body.
// Object shapes (pad, cup, say, sprout...) are checked as the app draws
// them: their path body (avatarDefForShape), sampled densely, not only the
// polar radii (2026-11-08: the sprout's leaves and the say's tail stood
// beside the body in the capture while this test only saw the radii).
// Before this, moves turned the body into a dot or a bar with the eyes gone
// (the "disassembled" mascot), an eye faded away as the face turned, a sway
// keystoned the outline and spread its slices beside it, and the eyes were
// drawn through a second pipeline that could disagree with the outline.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, SHAPE_SKINS, type MascotShape, type ShapeSkin } from "../../shared/mascot-look";
import { flattenPath, resampleClosed } from "../../shared/shape-avatar-outline";
import { avatarDefForShape, ShapeFrameSvg, shapeSkinPaint } from "./ShapeMascot";
import { SHAPE_ART } from "./shape-art";
import { blinkOpen, blinkSchedule, gazeFrame, MORPH_S, SHAPE_EXPRESSIONS, ShapeEngine, stillFrame, type ShapeFrame } from "./shape-engine";
import { MOVE_TIMING, SHAPE_MOVES } from "./shape-moves";
import { shapeSkinLayers } from "./skin-fx/shape-skins";
import { applyAffine, composeAffine, drawShape, eyeStyleFor, faceNumbers, grounded, motionNumbers, REST_POSE, type Affine, type Pose, type VolumeDetail } from "./shape-volume";

const COLOR = "#3b82f6";
type Point = [number, number];
/** A body rolled hard and squashed (a move's sway at its widest, a poke). */
const ROLLED = (shape: MascotShape): Pose => grounded({ ...REST_POSE, yaw: 40, pitch: -22, roll: 12 }, shape);
const SQUASHED = { x: 3, y: -2, rot: 18, sx: 1.08, sy: 0.9 };
const DETAILS: VolumeDetail[] = ["tiny", "small", "full"];
/** A shape's state as the app holds it: object shapes carry their path body. */
const stateOf = (shape: MascotShape, expression: (typeof SHAPE_EXPRESSIONS)[number] = "neutral") => ({ shape, expression, color: COLOR, avatarDef: avatarDefForShape(shape) });
/** The body's outer outline, sampled along its length (lines and curves alike). */
const outerOutline = (d: string): Point[] => resampleClosed(flattenPath(d)[0] ?? [], 96).map(([x, y]) => [x, y] as Point);

const nums = (s: string) => s.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
/** The on-curve points of a path the engine wrote (M, then each C's end point), per subpath. */
function subpaths(d: string): Point[][] {
  return d
    .split("M")
    .filter(Boolean)
    .map((sub) => {
      const n = nums(sub);
      const pts: Point[] = [[n[0], n[1]]];
      for (let i = 2; i + 5 < n.length; i += 6) pts.push([n[i + 4], n[i + 5]]);
      return pts;
    });
}
/** Points along an SVG arc (no rotation), from (sx, sy) to (x, y): the endpoint and eight points on the way. */
function arcPoints(sx: number, sy: number, rx: number, ry: number, large: number, sweep: number, x: number, y: number): Point[] {
  const dx = (sx - x) / 2;
  const dy = (sy - y) / 2;
  let lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
    lambda = 1;
  }
  const sign = large === sweep ? -1 : 1;
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx);
  const den = rx * rx * dy * dy + ry * ry * dx * dx || 1;
  const k = sign * Math.sqrt(num / den);
  const cxp = (k * rx * dy) / ry;
  const cyp = (-k * ry * dx) / rx;
  const cx = cxp + (sx + x) / 2;
  const cy = cyp + (sy + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const a1 = angle(1, 0, (dx - cxp) / rx, (dy - cyp) / ry);
  let da = angle((dx - cxp) / rx, (dy - cyp) / ry, (-dx - cxp) / rx, (-dy - cyp) / ry);
  if (!sweep && da > 0) da -= Math.PI * 2;
  if (sweep && da < 0) da += Math.PI * 2;
  const pts: Point[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const a = a1 + (da * i) / 8;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** Every point along a path the drawing writes (M, L, C with their pairs; an oval's or an arch's arcs sampled), per subpath. */
function allPoints(d: string): Point[][] {
  const out: Point[][] = [];
  let current: Point[] = [];
  let at: Point = [0, 0];
  for (const m of d.matchAll(/([MLCAZ])([^MLCAZ]*)/g)) {
    const cmd = m[1];
    const n = nums(m[2]);
    if (cmd === "M") {
      if (current.length) out.push(current);
      current = [];
    }
    if (cmd === "Z") continue;
    if (cmd === "A") {
      for (let i = 0; i + 6 < n.length; i += 7) {
        current.push(...arcPoints(at[0], at[1], n[i], n[i + 1], n[i + 3], n[i + 4], n[i + 5], n[i + 6]));
        at = [n[i + 5], n[i + 6]];
      }
      continue;
    }
    for (let i = 0; i + 1 < n.length; i += 2) {
      current.push([n[i], n[i + 1]]);
      at = [n[i], n[i + 1]];
    }
  }
  if (current.length) out.push(current);
  return out;
}
const matrix = (t: string): Affine => nums(t) as Affine;

/**
 * How big the body stays (box units): the least distance from the box's middle to its
 * outline, and, for a body the middle does not see whole (an object's path body: the
 * sprout's leaves meet at a point near the middle), the radius of the widest disc it
 * holds. Under 14 the body has turned into a dot or a bar.
 */
function bodyReach(d: string): number {
  const fromMiddle = Math.min(...nums(d).map((_, i, n) => (i % 2 ? Math.hypot(n[i - 1] - 50, n[i] - 50) : Infinity)));
  if (fromMiddle > 14) return fromMiddle;
  const poly = outerOutline(d);
  const edge = (x: number, y: number) => Math.min(...poly.map(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ax - k * dx, y - ay - k * dy);
  }));
  let widest = 0;
  for (let x = 0; x <= 100; x += 2) for (let y = 0; y <= 100; y += 2) if (inside(poly, x, y)) widest = Math.max(widest, edge(x, y));
  return widest;
}

/** The least share of a slice's area that lies in the face for the slice to touch it (shapes.mjs uses the same). */
const SLICE_OVERLAP = 0.75;
/** Points of the area inside an outline, on a grid 2 box units apart (kept per outline: every slice reuses them). */
const areaGrid = new Map<string, Point[]>();
function areaOf(outline: Point[]): Point[] {
  const key = outline.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  let grid = areaGrid.get(key);
  if (!grid) {
    grid = [];
    const xs = outline.map(([x]) => x);
    const ys = outline.map(([, y]) => y);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 2) if (inside(outline, x, y)) grid.push([x, y]);
    areaGrid.set(key, grid);
  }
  return grid;
}
/** The share of a slice's area (the outline under the slice's matrix S) that lies in the face. */
function overlapShare(outline: Point[], S: Affine, face: Point[]): number {
  const area = areaOf(outline);
  const shared = area.filter(([x, y]) => {
    const [fx, fy] = applyAffine(S, x, y);
    return inside(face, fx, fy);
  }).length;
  return area.length ? shared / area.length : 0;
}
/** Where the <g> that opens at `start` closes (balanced). */
function groupEnd(html: string, start: number): number {
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<g[\s>]|<\/g>/g)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return start + (m.index ?? 0);
  }
  return -1;
}

function inside(poly: Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The face's outline in the drawing's space (the body's motion, then the face's matrix). */
function faceOutline(drawing: ReturnType<typeof drawShape>, frame: ShapeFrame, pose: Pose): { poly: Point[]; T: Affine } {
  // the drawing's face matrix is the pose's (the motion is the group above it)
  const expected = faceNumbers(pose, frame.depth);
  for (const [i, v] of matrix(drawing.face).entries()) expect(v).toBeCloseTo(expected[i], 3);
  const T = composeAffine(motionNumbers(frame.motion), matrix(drawing.face));
  const outline = outerOutline(drawing.outline);
  return { poly: outline.map(([x, y]) => applyAffine(T, x, y)), T };
}

/** One drawing checked whole: outline, eyes, slices, stem. */
function expectHolds(frame: ShapeFrame, pose: Pose, label: string, detail: VolumeDetail = "full", bend = true, style = eyeStyleFor("idle")) {
  const drawing = drawShape(frame, pose, detail, style, bend);
  expect(drawing.outline, `${label} outline`).toMatch(/^M[^M]*Z(?:M[^M]*Z)*$/);
  const { poly, T } = faceOutline(drawing, frame, pose);
  const faults: string[] = [];
  // the eyes: two, inside the face
  const eyes = allPoints(drawing.eyes);
  expect(eyes, `${label} eyes`).toHaveLength(2);
  for (const eye of eyes) for (const [x, y] of eye) {
    const [dx, dy] = applyAffine(T, x, y);
    if (!inside(poly, dx, dy)) faults.push(`eye point ${x},${y} outside the face`);
  }
  // the slices touch the face: each one's middle and its half-size outline sit in the face.
  // The half-size outline is a proxy that holds for a body seen whole from the box's middle;
  // an object's path body is not (the sprout's leaves, the say's tail), so a slice whose
  // half-size outline leaves the face is measured directly: it touches the face when most
  // of its own area lies in the face (SLICE_OVERLAP).
  const outline = outerOutline(drawing.outline);
  for (const [i, t] of drawing.slices.entries()) {
    const S = composeAffine(motionNumbers(frame.motion), matrix(t));
    const [cx, cy] = applyAffine(S, 50, 50);
    if (!inside(poly, cx, cy)) faults.push(`slice ${i} middle outside the face`);
    for (const [x, y] of outline) {
      const [sx, sy] = applyAffine(S, 50 + (x - 50) * 0.5, 50 + (y - 50) * 0.5);
      if (!inside(poly, sx, sy)) {
        const share = overlapShare(outline, S, poly);
        if (share < SLICE_OVERLAP) faults.push(`slice ${i} outside the face at ${x},${y} (${(share * 100).toFixed(0)} % of it in the face)`);
        break;
      }
    }
  }
  expect(faults, label).toEqual([]);
  // the stem's foot in the body, its tip above it
  if (drawing.stem) {
    const stem = subpaths(drawing.stem.d)[0];
    expect(stem.some(([x, y]) => inside(outline, x, y)), `${label} stem foot in the body`).toBe(true);
    expect(Math.min(...stem.map(([, y]) => y)), `${label} stem tip above`).toBeLessThan(Math.min(...outline.map(([, y]) => y)));
  }
  return { drawing, eyes };
}

/** The two eyes as one pair: the same capsule, level, upright at rest. */
function expectPair(d: string, label: string, rest: boolean) {
  const boxes = allPoints(d).map((pts) => {
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  });
  expect(boxes, label).toHaveLength(2);
  const [l, r] = boxes;
  expect(Math.abs(l.w - r.w), `${label} same width`).toBeLessThan(0.02);
  expect(Math.abs(l.h - r.h), `${label} same height`).toBeLessThan(0.02);
  expect(Math.abs(l.y - r.y), `${label} level`).toBeLessThan(0.02);
  expect(r.x - l.x, `${label} apart`).toBeGreaterThan((l.w + r.w) / 2);
  if (rest) expect(l.h, `${label} taller than wide`).toBeGreaterThan(l.w * 1.4);
}

/** A moment with no blink on this seed, after `from` s. */
function openMoment(seed: number, from: number): number {
  const starts = blinkSchedule(seed, from + 30);
  for (let t = from; t < from + 30; t += 0.05) if (blinkOpen(t, starts) === 1 && blinkOpen(t - 0.3, starts) === 1) return t;
  throw new Error("no open moment");
}

const svgFor = (frame: ShapeFrame, pose: Pose, skin: ShapeSkin = "plain", size = 96) => {
  const paint = shapeSkinPaint(skin, COLOR);
  const layers = shapeSkinLayers(skin, SHAPE_ART.circle.d, COLOR, "t", false);
  return renderToStaticMarkup(h(ShapeFrameSvg, { frame, uid: "t", skin, paint, layers, size, pose }));
};

describe("every shape holds together and keeps its face", () => {
  it("at rest, in every face, blinking and looking around, on a resting and on a rolled, squashed body, at every detail", () => {
    for (const shape of MASCOT_SHAPES) {
      const frames: [string, ShapeFrame][] = [
        ...SHAPE_EXPRESSIONS.map((expression) => [expression, stillFrame(stateOf(shape, expression))] as [string, ShapeFrame]),
        ["blink", gazeFrame(stateOf(shape), 0, 0, {}, { left: 0.06, right: 0.06 })],
        ...[[1, 1], [-1, -1], [1, -1], [-1, 1]].map(([x, y]) => [`look ${x},${y}`, gazeFrame(stateOf(shape), x, y)] as [string, ShapeFrame]),
      ];
      for (const [name, frame] of frames) {
        expect(frame.body, `${shape} ${name}`).toMatch(/^M[^M]*Z(?:M[^M]*Z)*$/);
        // every face at full detail; the small and tiny slices (fewer of them) on the neutral face
        for (const detail of name === "neutral" ? DETAILS : (["full"] as VolumeDetail[])) {
          expectHolds(frame, grounded(REST_POSE, shape), `${shape} ${name} rest ${detail}`, detail);
          expectHolds({ ...frame, motion: SQUASHED }, ROLLED(shape), `${shape} ${name} rolled ${detail}`, detail);
        }
      }
      const rest = drawShape(stillFrame(stateOf(shape)), grounded(REST_POSE, shape), "full");
      expectPair(rest.eyes, `${shape} rest`, true);
      expectPair(drawShape({ ...stillFrame(stateOf(shape)), motion: SQUASHED }, ROLLED(shape), "full").eyes, `${shape} rolled`, true);
      expectPair(drawShape(gazeFrame(stateOf(shape), 0.8, -0.7), ROLLED(shape), "full").eyes, `${shape} looking`, true);
    }
  }, 60_000);

  it("through every move, at five moments, the body stays one whole outline with its two eyes, and comes back to rest", () => {
    for (const shape of MASCOT_SHAPES) {
      for (const move of SHAPE_MOVES) {
        const seed = 7;
        const state = stateOf(shape);
        const run = new ShapeEngine(state, 0, seed);
        const calm = new ShapeEngine(state, 0, seed);
        const { duration, morph } = MOVE_TIMING[move];
        run.play(move, 0.5);
        const moments = [morph / 2, morph + 0.05, duration / 2, duration, duration + morph / 2].map((u) => 0.5 + u);
        let at = 0;
        for (const t of moments) {
          for (; at < t; at += 0.1) {
            run.frame(at);
            calm.frame(at);
          }
          const frame = run.frame(t);
          expect(bodyReach(frame.body), `${shape} ${move} ${t} body never a dot`).toBeGreaterThan(14);
          for (const pose of [grounded(REST_POSE, shape), ROLLED(shape)]) {
            expectHolds(frame, pose, `${shape} ${move} ${t}`, "full", true, eyeStyleFor("idle"));
            expectHolds(frame, pose, `${shape} ${move} ${t} ovals`, "full", true, "oval");
            expectHolds(frame, pose, `${shape} ${move} ${t} arcs`, "small", true, "arc");
          }
          const d = drawShape(frame, grounded(REST_POSE, shape), "full").eyes;
          expect(allPoints(d), `${shape} ${move} ${t} two eyes`).toHaveLength(2);
        }
        const settled = openMoment(seed, 0.5 + duration + MORPH_S + 0.2);
        for (; at < settled; at += 0.1) {
          run.frame(at);
          calm.frame(at);
        }
        const after = run.frame(settled);
        expect(after.eyeShapes, `${shape} ${move} back to rest`).toEqual(calm.frame(settled).eyeShapes);
        expect(after.body).toBe(calm.frame(settled).body);
        expectPair(drawShape(after, grounded(REST_POSE, shape), "full").eyes, `${shape} after ${move}`, true);
      }
    }
  }, 60_000);

  it("in every skin: the face and the eyes under one matrix, the eyes inside the outline the skin draws", () => {
    for (const shape of MASCOT_SHAPES) {
      const frame = stillFrame(stateOf(shape));
      for (const skin of SHAPE_SKINS) {
        const html = svgFor(frame, grounded(REST_POSE, shape), skin);
        if (skin === "outline") {
          // a flat skin cuts the eyes through its body: one path, the body's subpaths (a cup keeps its handle hole) then the two eyes, inside the body
          const cut = /class="shape-fill" d="([^"]+)"/.exec(html)?.[1] ?? "";
          const body = outerOutline(cut);
          const eyes = subpaths(cut).slice(frame.body.split("M").filter(Boolean).length);
          expect(eyes, `${shape} ${skin}`).toHaveLength(2);
          for (const eye of eyes) for (const [x, y] of eye) expect(inside(body, x, y), `${shape} ${skin} eye inside`).toBe(true);
          continue;
        }
        const face = html.indexOf("data-shape-face");
        const eyes = html.indexOf("data-shape-eyes");
        expect(face, `${shape} ${skin} face`).toBeGreaterThan(0);
        expect(eyes, `${shape} ${skin} eyes after the face`).toBeGreaterThan(face);
        // the same group: the eyes close inside the face's <g data-pose-face>, under its matrix
        const view = html.lastIndexOf("<g ", html.indexOf("data-shape-view"));
        expect(groupEnd(html, view), `${shape} ${skin} eyes in the face's group`).toBeGreaterThan(eyes);
        expect(html, `${shape} ${skin}`).not.toContain("eyes-clip");
        expectHolds(frame, grounded(REST_POSE, shape), `${shape} ${skin}`, "full", skin === "plain");
      }
    }
  });

  it("draws the eyes and the outline from one drawing on the page: the markup carries exactly what writeShape writes", () => {
    const frame = stillFrame({ shape: "drop", expression: "neutral", color: COLOR });
    const pose = grounded(REST_POSE, "drop");
    const drawing = drawShape(frame, pose, "full");
    const html = svgFor(frame, pose);
    expect(html).toContain(`d="${drawing.outline}" data-shape-outline=""`);
    expect(html).toContain(`d="${drawing.outline}" fill-rule="evenodd" data-shape-face=""`);
    expect(html).toContain(`d="${drawing.eyes}"`);
    expect(html).toContain(`transform="${drawing.face}" data-pose-face`);
    for (const [i, t] of drawing.slices.entries()) expect(html).toContain(`transform="${t}" data-pose-slice="${i}"`);
    expect(html).toContain(`transform="${drawing.motion}" data-shape-motion`);
  });

  it("stands the pumpkin's stem in its body, under the face's matrix, and nothing else wears one", () => {
    const frame = stillFrame({ shape: "pumpkin", expression: "neutral", color: COLOR });
    expect(frame.stem).not.toBeNull();
    const html = svgFor(frame, grounded(REST_POSE, "pumpkin"));
    expect(html).toContain("data-shape-stem");
    expect(html.indexOf("data-pose-face")).toBeLessThan(html.indexOf("data-shape-stem"));
    expect(html.indexOf("data-shape-stem")).toBeLessThan(html.indexOf('class="shape-fill"'));
    for (const shape of MASCOT_SHAPES) if (shape !== "pumpkin") expect(stillFrame(stateOf(shape)).stem, shape).toBeNull();
  });
});
