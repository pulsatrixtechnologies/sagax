// The Shapes geometry, read from the one source every drawing shares:
// shared/mascot-geometry.json (the web here, the phone through the Swift
// file generated from it). Every body is one closed outline drawn from 64
// radii around its middle, smoothed into cubic curves, so any two bodies
// morph by blending their radii. The radius unit R is the circle's radius;
// the drawing box is 0..100 with the middle at BODY.center and one R worth
// BODY.unit box units.
//
// Nothing here describes a shape: to add or change a body, its eye anchor
// or a move's body, edit the JSON. This file only turns radii into paths.
import type { BodyShape } from "../../shared/mascot-look";
import geometry from "../../shared/mascot-geometry.json" with { type: "json" };

type Point = [number, number];

const round = (value: number) => Math.round(value * 100) / 100;

/** A closed, smooth path through the points (Catmull-Rom turned into cubic Beziers). */
export function smoothClosed(points: Point[], tension = 1): string {
  const n = points.length;
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1: Point = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: Point = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${d}Z`;
}

/** The geometry file itself, for the tests and the phone's generator. */
export const GEOMETRY = geometry;

/** How many radii make a body. */
export const RADII_COUNT: number = geometry.radiiCount;

/** Where the body sits in the 0..100 box, and how many box units one R is. */
export const BODY = { center: [geometry.box.center[0], geometry.box.center[1]] as Point, unit: geometry.box.unit } as const;

/** A body: one radius (in R) per angle, angle 0 straight up, clockwise. */
export type Radii = readonly number[];

/** The angle of radius i, radians (0 up, clockwise). */
export const angleOf = (i: number) => (i / RADII_COUNT) * Math.PI * 2;

/** The point of radius i in R units (x right, y down). */
export const radiusPoint = (radii: Radii, i: number): Point => {
  const a = angleOf(i);
  return [radii[i] * Math.sin(a), -radii[i] * Math.cos(a)];
};

/** The body's radius toward any angle (radians, 0 up, clockwise), read between the two nearest radii. */
export function radiusAt(radii: Radii, angle: number): number {
  const turn = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
  const at = turn * RADII_COUNT;
  const i = Math.floor(at) % RADII_COUNT;
  const j = (i + 1) % RADII_COUNT;
  const f = at - Math.floor(at);
  return radii[i] * (1 - f) + radii[j] * f;
}

/** The body's radius toward a point (R units). */
export const radiusToward = (radii: Radii, x: number, y: number) => radiusAt(radii, Math.atan2(x, -y));

/** Two bodies blended (t 0..1). */
export function blendRadii(from: Radii, to: Radii, t: number): number[] {
  return from.map((r, i) => r + (to[i] - r) * t);
}

/** Shared easing and math for the shapes' motion. */
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOutQuint = (t: number) => 1 - (1 - clamp01(t)) ** 5;
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const RAD = Math.PI / 180;

/** A point in R units (from the body's middle) in the 0..100 box. */
export const toBox = ([x, y]: Point): Point => [BODY.center[0] + x * BODY.unit, BODY.center[1] + y * BODY.unit];

/** A body's outline in box units, at a scale (1 = R is BODY.unit). */
export function outlinePath(radii: Radii, scale = 1): string {
  const [cx, cy] = BODY.center;
  const u = BODY.unit * scale;
  return smoothClosed(Array.from({ length: RADII_COUNT }, (_, i) => {
    const [x, y] = radiusPoint(radii, i);
    return [cx + x * u, cy + y * u] as Point;
  }));
}

/**
 * Authoring help, not used by the app: casts a ray from the middle at each of
 * the 64 angles and keeps the farthest point still inside a figure described
 * as "is this point inside?", to write a new body's radii into the JSON.
 */
export function radiiOf(inside: (x: number, y: number) => boolean, reach = 2.4): number[] {
  return Array.from({ length: RADII_COUNT }, (_, i) => {
    const a = angleOf(i);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    let r = reach;
    const step = 0.01;
    while (r > 0 && !inside(dx * r, dy * r)) r -= step;
    let lo = Math.max(0, r);
    let hi = Math.min(reach, r + step);
    for (let k = 0; k < 14; k += 1) {
      const mid = (lo + hi) / 2;
      if (inside(dx * mid, dy * mid)) lo = mid;
      else hi = mid;
    }
    return Math.round(lo * 10000) / 10000;
  });
}

/** Every body, in R units. */
export const SHAPE_RADII: Readonly<Record<BodyShape, Radii>> = Object.fromEntries(
  Object.entries(geometry.shapes).map(([shape, entry]) => [shape, entry.radii]),
) as unknown as Record<BodyShape, Radii>;

/** Where each body's face rests (R, from the body's middle; x right, y down): the middle between the two eyes before any turn. */
export const FACE_ANCHOR: Readonly<Record<BodyShape, Point>> = Object.fromEntries(
  Object.entries(geometry.shapes).map(([shape, entry]) => [shape, [entry.face[0], entry.face[1]] as Point]),
) as unknown as Record<BodyShape, Point>;

/** The whole bodies some moves turn into (never a dot or a bar: the body stays a body). */
export const MOVE_RADII: Readonly<Record<"egg" | "hexagon" | "triangle", Radii>> = geometry.moveBodies as Record<"egg" | "hexagon" | "triangle", Radii>;

/**
 * The pumpkin's stem: a short dark stalk standing in the dip on top, leaning
 * a little to the left (R units, from the JSON). Its foot sinks into the body
 * (the body is drawn over it), and it rides on the body's top radius, so it
 * follows the outline while it breathes, morphs or squashes.
 */
export const STEM = geometry.stem;

export function stemPath(radii: Radii): string {
  const top = radiusAt(radii, 0);
  const foot: Point = [STEM.foot.x, -top + STEM.foot.sink];
  const tip: Point = [foot[0] + STEM.tip.x, foot[1] + STEM.tip.y];
  const control: Point = [(foot[0] + tip[0]) / 2 + STEM.bow, (foot[1] + tip[1]) / 2];
  const at = (t: number): Point => [
    (1 - t) ** 2 * foot[0] + 2 * (1 - t) * t * control[0] + t * t * tip[0],
    (1 - t) ** 2 * foot[1] + 2 * (1 - t) * t * control[1] + t * t * tip[1],
  ];
  const steps = [0, 0.35, 0.7, 1];
  const side = (sign: number) =>
    steps.map((t) => {
      const [x, y] = at(t);
      const [x2, y2] = at(Math.min(1, t + 0.01));
      const [x1, y1] = at(Math.max(0, t - 0.01));
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const half = STEM.width.foot + (STEM.width.tip - STEM.width.foot) * t;
      return [x + (-dy / len) * half * sign, y + (dx / len) * half * sign] as Point;
    });
  const left = side(1);
  const right = side(-1).reverse();
  const [tx, ty] = at(1);
  const [px, py] = at(0.97);
  const len = Math.hypot(tx - px, ty - py) || 1;
  // a round cap a little past the tip
  const cap: Point = [tx + ((tx - px) / len) * STEM.width.tip * 0.8, ty + ((ty - py) / len) * STEM.width.tip * 0.8];
  return smoothClosed([...left, cap, ...right].map(toBox));
}

/** The stem's ink: a dark wood brown. */
export const STEM_INK = "#3b2a1c";

/** One shape: its outline (box units) and where its face sits at rest. */
export interface ShapeArt {
  d: string;
  /** The middle between the two eyes at rest (box units). */
  face: Point;
}

export const SHAPE_ART: Record<BodyShape, ShapeArt> = Object.fromEntries(
  (Object.keys(SHAPE_RADII) as BodyShape[]).map((shape) => [shape, { d: outlinePath(SHAPE_RADII[shape]), face: toBox(FACE_ANCHOR[shape]) }]),
) as Record<BodyShape, ShapeArt>;

/**
 * The resting eye, as a half-size in box units (the app icon draws its
 * capsules from these): a rounded bar about 0.19 R wide and 0.41 R tall.
 */
export const EYES = {
  rx: (geometry.eyes.capsule.w * BODY.unit) / 2,
  ry: (geometry.eyes.capsule.h * BODY.unit) / 2,
  tilt: geometry.eyes.capsule.tilt,
} as const;
