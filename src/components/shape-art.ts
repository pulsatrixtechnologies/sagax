// The Shapes geometry (clean room, 2026-10-08). Every body is one closed
// outline drawn from 64 radii around its middle, smoothed into cubic curves,
// so any two bodies morph by blending their radii. The radius unit R is the
// circle's radius; the drawing box is 0..100 with the middle at BODY.center
// and one R worth BODY.unit box units.
//
// Each table comes from our own geometry: a figure described as "is this
// point inside?" (a superellipse, a stadium, a triangle or hexagon grown by a
// radius, a union of five circles, the hull of two circles) and a ray cast
// from the middle at each of the 64 angles. Nothing here is copied from
// another drawing: change a number below and the tables follow.
import type { MascotShape } from "../../shared/mascot-look";

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

/** How many radii make a body. */
export const RADII_COUNT = 64;

/** Where the body sits in the 0..100 box, and how many box units one R is. */
export const BODY = { center: [50, 50] as Point, unit: 40 } as const;

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

/* ------------------------------------------------------------ figures */

type Inside = (x: number, y: number) => boolean;

/** Casts a ray from the middle at each angle and keeps the farthest point still inside the figure. */
export function radiiOf(inside: Inside, reach = 2.4): number[] {
  return Array.from({ length: RADII_COUNT }, (_, i) => {
    const a = angleOf(i);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    // walk in from outside so a figure with dents keeps its outermost edge
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

/** Distance from a point to a segment. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Whether a point lies inside a convex polygon (any winding). */
function inConvex(points: Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A convex polygon grown outward by `grow`: its corners come out round. */
function grownPolygon(points: Point[], grow: number): Inside {
  return (x, y) => {
    if (inConvex(points, x, y)) return true;
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if (toSegment(x, y, ax, ay, bx, by) <= grow) return true;
    }
    return false;
  };
}

/** A regular polygon's corners around (cx, cy), the first `turn` degrees clockwise from straight up. */
function regular(sides: number, radius: number, turn = 0, cx = 0, cy = 0): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((i / sides) * 360 + turn) * (Math.PI / 180);
    return [cx + radius * Math.sin(a), cy - radius * Math.cos(a)] as Point;
  });
}

/** The convex hull of two circles (a big belly and a small tip): a drop. */
function circleHull(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }): Inside {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  // the outer tangents touch both circles at the same angle from the axis
  const beta = Math.acos((a.r - b.r) / d);
  const turn = (s: number): Point => [ux * Math.cos(s) - uy * Math.sin(s), ux * Math.sin(s) + uy * Math.cos(s)];
  const [p, q] = [turn(beta), turn(-beta)];
  const quad: Point[] = [
    [a.x + p[0] * a.r, a.y + p[1] * a.r],
    [b.x + p[0] * b.r, b.y + p[1] * b.r],
    [b.x + q[0] * b.r, b.y + q[1] * b.r],
    [a.x + q[0] * a.r, a.y + q[1] * a.r],
  ];
  return (x, y) => Math.hypot(x - a.x, y - a.y) <= a.r || Math.hypot(x - b.x, y - b.y) <= b.r || inConvex(quad, x, y);
}

const circle = (r: number): number[] => Array.from({ length: RADII_COUNT }, () => r);

/** A soft, chubby heart (2026-10-18): two equal round lobes, each joined to
 *  one small round point at the bottom by its tangents (the hull of two
 *  circles), so the sides run straight and smooth into a blunt, centred point.
 *  Symmetric by construction. Stored id `bean` (older builds called it a pebble). */
function heart(): number[] {
  // plump: bigger lobes set closer, so they melt into each other, and a rounder point
  const point = { x: 0, y: 0.7, r: 0.3 };
  const left = { x: -0.38, y: -0.11, r: 0.56 };
  const right = { x: 0.38, y: -0.11, r: 0.56 };
  const sides = [circleHull(left, point), circleHull(right, point)];
  return radiiOf((x, y) => sides.some((inside) => inside(x, y)));
}

/** A rounded square: the superellipse |x|^4 + |y|^4 = s^4. */
const squircle = () => radiiOf((x, y) => (Math.abs(x) / 0.93) ** 4 + (Math.abs(y) / 0.93) ** 4 <= 1);

/** A capsule lying down: every point within 0.6 of a short horizontal segment. */
const capsule = () => radiiOf((x, y) => toSegment(x, y, -0.44, 0, 0.44, 0) <= 0.6);

/** A triangle standing on its base, its three corners rounded. */
const triangle = () => radiiOf(grownPolygon(regular(3, 0.9, 0, 0, 0.12), 0.27));

/** A hexagon with its flat sides up and down, corners rounded. */
const hexagon = (turn = 30) => radiiOf(grownPolygon(regular(6, 0.85, turn), 0.23));

/** Five round puffs: a wide one low in the middle, two on the sides, two on top. */
const CLOUD_PUFFS = [
  { x: 0, y: 0.18, r: 0.6 },
  { x: -0.6, y: 0.24, r: 0.42 },
  { x: 0.6, y: 0.24, r: 0.42 },
  { x: -0.27, y: -0.3, r: 0.47 },
  { x: 0.3, y: -0.26, r: 0.52 },
];
const cloud = () => radiiOf((x, y) => CLOUD_PUFFS.some((puff) => Math.hypot(x - puff.x, y - puff.y) <= puff.r));

/** A teardrop: a round belly low, a soft rounded tip on top (2026-10-18: round, never pointed). Stored id `drop`. */
const droplet = () => radiiOf(circleHull({ x: 0, y: 0.22, r: 0.74 }, { x: 0, y: -0.82, r: 0.2 }));

/** An egg: an ellipse, narrower at the top. */
const egg = () => radiiOf((x, y) => (x / (0.8 * (1 + 0.13 * y))) ** 2 + ((y - 0.02) / 1.04) ** 2 <= 1);

/** An exclamation mark's stroke: a tall capsule standing on the middle. */
const bar = () => radiiOf((x, y) => toSegment(x, y, 0, -0.82, 0, 0.18) <= 0.15);

/** The eight bodies, in R units. Stored ids bean/pick/drop are heart, triangle, teardrop. */
export const SHAPE_RADII: Readonly<Record<MascotShape, Radii>> = {
  circle: circle(1),
  bean: heart(),
  squircle: squircle(),
  pill: capsule(),
  pick: triangle(),
  hexagon: hexagon(),
  cloud: cloud(),
  drop: droplet(),
};

/** The bodies some moves turn into. */
export const MOVE_RADII = {
  dot: circle(0.165),
  sleepDot: circle(0.16),
  burstDot: circle(0.166),
  cometDot: circle(0.13),
  egg: egg(),
  hexagon: hexagon(0),
  triangle: triangle(),
  bar: bar(),
} as const satisfies Record<string, Radii>;

/** One shape: its outline (box units) and where its face sits at rest. */
export interface ShapeArt {
  d: string;
  /** The middle between the two eyes at rest (box units). */
  face: Point;
}

export const SHAPE_ART: Record<MascotShape, ShapeArt> = Object.fromEntries(
  (Object.keys(SHAPE_RADII) as MascotShape[]).map((shape) => [shape, { d: outlinePath(SHAPE_RADII[shape]), face: [52, 50] as Point }]),
) as Record<MascotShape, ShapeArt>;

/**
 * The resting eye, as a half-size in box units (the app icon draws its
 * capsules from these): a rounded bar about 0.19 R wide and 0.41 R tall.
 */
export const EYES = {
  rx: (0.19 * BODY.unit) / 2,
  ry: (0.41 * BODY.unit) / 2,
  tilt: -13,
} as const;
