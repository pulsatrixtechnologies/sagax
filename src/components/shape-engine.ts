// The Shapes engine (clean room, 2026-10-08): everything that moves a shape,
// as pure functions of time, so tests and the static render share it with
// the live avatar (ShapeMascot.tsx).
//
// - The face: two rounded bars cut through the body, placed on an imaginary
//   head (a unit sphere) turned HEAD.yaw degrees and tilted HEAD.pitch
//   degrees, then seen from the front: each eye is foreshortened by the
//   sphere's own curvature, pushed out to the body's outline at its angle,
//   kept inside it by the bounds solver, and fades once it turns away.
// - Idle: the gaze wanders on five slow loops, the body drifts and breathes
//   on a BREATH_S cycle, the eyes blink on a seeded schedule.
// - Hover: the gaze turns toward the pointer, easing in over HOVER.turn s.
// - Changes of shape, expression and color slide over MORPH_S.
// - Moves: the fourteen one-shot moves of shape-moves.ts, blended over the
//   resting pose.
//
// All lengths are in R (the circle's radius) until frame() turns them into
// the 0..100 box (shape-art.ts BODY).
import type { MascotShape } from "../../shared/mascot-look";
import { blendRadii, BODY, clamp01, easeInOut, easeOutQuint, lerp, RAD, radiusToward, SHAPE_RADII, smoothClosed, toBox, type Radii } from "./shape-art";
import { moveAt, moveLength, moveWeight, ringAt, type MovePose, type RibbonDraw, type RingDraw, type ShapeMove } from "./shape-moves";

export { clamp01, easeOutQuint } from "./shape-art";
export * from "./shape-moves";

type Point = [number, number];

/* ------------------------------------------------------------ timing */

/** A change of shape, expression or color slides over this long, s. */
export const MORPH_S = 0.45;
/** One breath (and the body's slight swell), s. */
export const BREATH_S = 3.4;
/** How much a breath stretches the body, as a fraction. */
export const BREATH_AMOUNT = 0.005;
/** The blink schedule, s. */
export const BLINK = { first: 1.1, minGap: 1, maxGap: 4.2, length: 0.16, closing: 0.45, doubleChance: 0.24, doubleAfter: 0.22, floor: 0.06 } as const;
/** How far the gaze turns toward the pointer at the edge of its reach (degrees) and how long the turn eases, s. */
export const HOVER = { yaw: 16, pitch: 13, turn: 0.85 } as const;
/** The imaginary head's own turn and tilt, degrees: the resting gaze looks back at the viewer through it. */
export const HEAD = { yaw: 28, pitch: 29 } as const;
/** The resting face sits a little below the head's middle (degrees of pitch), so the eyes rest about mid-body. */
export const FACE_DROP = 2;
/** The eyes' size on the body (2026-10-18: bigger, simpler, readable from the sidebar up). */
export const EYE_SCALE = { w: 0.92, h: 1.02 } as const;
/** How much of a face's roll the eyes keep: they stand nearly upright on the turned body. */
export const EYE_ROLL = 0;
/** How far apart the eyes sit, on top of each face's own split. */
export const EYE_SPREAD = 1.32;
/** How far a turn of the head (a look, the pointer) moves the face's middle across the body. */
export const EYE_GAZE = 0.55;
/** The eyes are a little longer than wide scaling alone gives (tall capsules). */
export const EYE_LENGTH = 1;
/** Where the face sits on the body before the pose turns it (R): to the right, a little up, so the turned body looks up and to the right. */
export const EYE_SHIFT = { x: 0.1, y: 0.2 } as const;


/* --------------------------------------------------------- expressions */

/** One eye: width and height (R), a tilt (degrees, clockwise) and how open it is (0..1). */
export interface EyeShape {
  w: number;
  h: number;
  tilt: number;
  open: number;
}

/** A face: where it looks (degrees, on top of the head's own turn) and its two eyes. */
export interface Expression {
  yaw: number;
  pitch: number;
  roll: number;
  /** Half the angle between the two eyes on the head, degrees. */
  split: number;
  left: EyeShape;
  right: EyeShape;
}

const eye = (w: number, h: number, tilt = 0, open = 1): EyeShape => ({ w, h, tilt, open });
const both = (yaw: number, pitch: number, roll: number, split: number, shape: EyeShape, right: EyeShape = shape): Expression => ({ yaw, pitch, roll, split, left: shape, right });

/** The sixteen faces, in the order the tests and the editor list them. */
export const SHAPE_EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"] as const;
export type ShapeExpression = (typeof SHAPE_EXPRESSIONS)[number];

export const EXPRESSIONS: Readonly<Record<ShapeExpression, Expression>> = {
  neutral: both(0, 0, -13, 15.5, eye(0.25, 0.46)),
  attentive: both(-2, 2, -9, 15, eye(0.26, 0.5)),
  surprised: both(-3, 2, -6, 18, eye(0.44, 0.44)),
  excited: both(-1, 4, -10, 16.5, eye(0.28, 0.54)),
  happy: both(0, 3, -10, 16, eye(0.34, 0.17, -10), eye(0.34, 0.17, 10)),
  laughing: both(0, 6, -8, 17, eye(0.31, 0.11, -18), eye(0.31, 0.11, 18)),
  angry: both(-2, -3, -12, 14.5, eye(0.27, 0.19, 24), eye(0.27, 0.19, -24)),
  sad: both(2, -7, -14, 15, eye(0.2, 0.32, -18), eye(0.2, 0.32, 18)),
  scared: both(-6, 1, -8, 13, eye(0.24, 0.38)),
  suspicious: both(7, -1, -11, 15, eye(0.29, 0.13, 6)),
  confused: both(3, 1, -20, 15.5, eye(0.25, 0.46), eye(0.25, 0.28, 10)),
  curious: both(5, 6, -17, 15.5, eye(0.26, 0.48)),
  proud: both(-3, 9, -6, 15, eye(0.28, 0.12, 4)),
  shy: both(10, -8, -16, 13.5, eye(0.18, 0.32)),
  bored: both(4, -3, -12, 15, eye(0.27, 0.14)),
  sleepy: both(1, -4, -13, 15.5, eye(0.26, 0.46, 0, 0.38)),
};

function blendEye(a: EyeShape, b: EyeShape, t: number): EyeShape {
  return { w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), tilt: lerp(a.tilt, b.tilt, t), open: lerp(a.open, b.open, t) };
}

export function blendExpression(a: Expression, b: Expression, t: number): Expression {
  return {
    yaw: lerp(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    roll: lerp(a.roll, b.roll, t),
    split: lerp(a.split, b.split, t),
    left: blendEye(a.left, b.left, t),
    right: blendEye(a.right, b.right, t),
  };
}

/* ------------------------------------------------------------ colors */

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Two colors blended (t 0..1), as #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `#${x.map((c, i) => Math.round(lerp(c, y[i], clamp01(t))).toString(16).padStart(2, "0")).join("")}`;
}

/** The clay finish: a light from the upper left fading to a dark rim, four stops. */
export function clayStops(hex: string): { offset: number; color: string }[] {
  return [
    { offset: 0, color: mixHex(hex, "#ffffff", 0.62) },
    { offset: 0.3, color: mixHex(hex, "#ffffff", 0.2) },
    { offset: 0.7, color: hex },
    { offset: 1, color: mixHex(hex, "#0b0b0e", 0.4) },
  ];
}

/** Where the clay light sits and how far it spreads, R units from the body's middle. */
export const CLAY_LIGHT = { x: -0.5, y: -0.62, r: 2.5 } as const;

/* --------------------------------------------------------------- idle */

/** A smooth loop of period `period` s: three harmonics, never the same twice in a cycle. */
export function loopNoise(t: number, period: number, seed: number): number {
  const x = (t / period) * Math.PI * 2;
  return 0.6 * Math.sin(x + seed) + 0.27 * Math.sin(2 * x + 1.7 * seed + 0.9) + 0.13 * Math.sin(3 * x + 0.4 - seed);
}

/** The five slow wander loops: periods (s) and reach (degrees). */
export const WANDER = {
  yaw: [
    { period: 10.9, reach: 5.2 },
    { period: 3.9, reach: 1.5 },
  ],
  pitch: [
    { period: 8.7, reach: 4 },
    { period: 4.6, reach: 1.2 },
  ],
  roll: [{ period: 13.1, reach: 2 }],
} as const;

export function wander(t: number, seed: number): { yaw: number; pitch: number; roll: number } {
  const sum = (loops: readonly { period: number; reach: number }[], k: number) => loops.reduce((total, loop, i) => total + loop.reach * loopNoise(t, loop.period, seed * (k + 1) + i * 2.3), 0);
  return { yaw: sum(WANDER.yaw, 0), pitch: sum(WANDER.pitch, 1), roll: sum(WANDER.roll, 2) };
}

/** The body's slow drift (R) and its breath (vertical stretch). */
export function drift(t: number, seed: number): { x: number; y: number; breath: number } {
  return {
    x: 0.006 * loopNoise(t, 7.7, seed + 0.5),
    y: 0.007 * loopNoise(t, 5.5, seed + 1.9),
    breath: 1 + BREATH_AMOUNT * Math.sin((t / BREATH_S) * Math.PI * 2),
  };
}

/** A small seeded random source (an xorshift), so every avatar blinks on its own rhythm and tests repeat. */
export function seededRandom(seed: number): () => number {
  let s = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** The blink start times up to `until` s: the first at BLINK.first, then a gap of minGap..maxGap, sometimes a quick second one. */
export function blinkSchedule(seed: number, until: number): number[] {
  const random = seededRandom(seed);
  const times: number[] = [];
  let t = BLINK.first;
  while (t <= until) {
    times.push(t);
    if (random() < BLINK.doubleChance) times.push(t + BLINK.doubleAfter);
    t += BLINK.minGap + random() * (BLINK.maxGap - BLINK.minGap);
  }
  return times;
}

/** How open the eyes are at `t` given blink starts: closing over the first share of a blink, opening over the rest. */
export function blinkOpen(t: number, starts: readonly number[]): number {
  let open = 1;
  for (const start of starts) {
    const p = (t - start) / BLINK.length;
    if (p < 0 || p > 1) continue;
    const value = p < BLINK.closing ? 1 - easeInOut(p / BLINK.closing) : easeInOut((p - BLINK.closing) / (1 - BLINK.closing));
    open = Math.min(open, BLINK.floor + (1 - BLINK.floor) * value);
  }
  return open;
}

/**
 * A value that follows its target with a smooth exponential ease, about 99%
 * of the way there after `settle` seconds (the hover turn).
 */
export class Follower {
  value: number;
  target: number;
  constructor(value = 0, private readonly settle: number = HOVER.turn) {
    this.value = value;
    this.target = value;
  }
  step(dt: number): number {
    const k = 1 - Math.exp((-Math.max(0, dt) * 4.6) / this.settle);
    this.value += (this.target - this.value) * k;
    return this.value;
  }
}

/** The pointer (-1..1 on each axis around the mascot, y down) as a gaze turn, degrees. */
export function hoverGaze(nx: number, ny: number): { yaw: number; pitch: number } {
  const x = Math.max(-1, Math.min(1, nx));
  const y = Math.max(-1, Math.min(1, ny));
  return { yaw: HOVER.yaw * x, pitch: -HOVER.pitch * y };
}

/* -------------------------------------------------------------- gaze */

type Vec3 = [number, number, number];

/** A direction on the head: yaw right, pitch up, seen from the front (x right, y down, z toward the viewer). */
function direction(yaw: number, pitch: number): Vec3 {
  return [Math.sin(yaw * RAD) * Math.cos(pitch * RAD), -Math.sin(pitch * RAD), Math.cos(yaw * RAD) * Math.cos(pitch * RAD)];
}

/** Turns a point on the head into the viewer's frame: undo the head's yaw, then its pitch, then roll in the picture plane. */
function toView([x, y, z]: Vec3, roll: number): Vec3 {
  const b = HEAD.yaw * RAD;
  const x1 = x * Math.cos(b) - z * Math.sin(b);
  const z1 = x * Math.sin(b) + z * Math.cos(b);
  const a = -HEAD.pitch * RAD;
  const y2 = y * Math.cos(a) - z1 * Math.sin(a);
  const z2 = y * Math.sin(a) + z1 * Math.cos(a);
  const r = roll * RAD;
  return [x1 * Math.cos(r) - y2 * Math.sin(r), x1 * Math.sin(r) + y2 * Math.cos(r), z2];
}

/** One eye as the viewer sees it: its outline points (R units), its middle, and how visible it is. */
export interface PlacedEye {
  points: Point[];
  center: Point;
  /** 0 (turned away, hidden) .. 1. */
  alpha: number;
  depth: number;
}

/** How deep an eye must face the viewer to show, and over how much depth it fades in. */
export const EYE_FADE = { hidden: 0.02, over: 0.12 } as const;
/** The eyes keep at least this much body around them, R. */
export const EYE_MARGIN = 0.07;

/** A rounded bar's outline (w x h, rounded ends), in its own frame, around its middle. */
function stadium(w: number, h: number, count = 28): Point[] {
  const r = Math.min(w, h) / 2;
  const long = Math.max(w, h) / 2 - r;
  const tall = h >= w;
  const pts: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (tall) pts.push([x, y + (y >= 0 ? long : -long)]);
    else pts.push([x + (x >= 0 ? long : -long), y]);
  }
  return pts;
}

function placeEye(yaw: number, pitch: number, roll: number, shape: EyeShape, open: number, axes: { yaw: number; pitch: number }): PlacedEye {
  const c = toView(direction(yaw, pitch), roll);
  // both eyes share the face's own axes (across and up at the face's middle),
  // each narrowed by how far it has turned from the viewer compared with the face
  const step = 0.5;
  const mid = toView(direction(axes.yaw, axes.pitch), roll);
  const across = toView(direction(axes.yaw + step, axes.pitch), roll);
  const up = toView(direction(axes.yaw, axes.pitch + step), roll);
  const k = 1 / (step * RAD);
  // a step in yaw covers cos(pitch) of a step on a great circle: undo it so the eye keeps its width
  const kx = k / Math.max(0.2, Math.cos(axes.pitch * RAD));
  const turn = clamp01(c[2] / Math.max(0.05, mid[2]));
  const ex: Point = [(across[0] - mid[0]) * kx * turn, (across[1] - mid[1]) * kx * turn];
  const ey: Point = [(up[0] - mid[0]) * k, (up[1] - mid[1]) * k];
  const alpha = clamp01((c[2] - EYE_FADE.hidden) / EYE_FADE.over);
  const h = Math.max(shape.h * EYE_SCALE.h * EYE_LENGTH * Math.max(open, BLINK.floor), 0.012);
  const tilt = shape.tilt * RAD;
  const points = stadium(shape.w * EYE_SCALE.w, h).map(([u, v]) => {
    // tilt in the eye's own plane, then lay it on the head (v grows downward, "up" is -v)
    const tu = u * Math.cos(tilt) - v * Math.sin(tilt);
    const tv = u * Math.sin(tilt) + v * Math.cos(tilt);
    return [c[0] + (tu * ex[0] - tv * ey[0]) * alpha, c[1] + (tu * ex[1] - tv * ey[1]) * alpha] as Point;
  });
  return { points, center: [c[0], c[1]], alpha, depth: c[2] };
}

/** The face's middle at rest (no look, no face of its own), R: where a turn is measured from. */
const restMids = new Map<number, Point>();
function solveRest(roll: number): Point {
  const key = Math.round(roll * 100);
  const hit = restMids.get(key);
  if (hit) return hit;
  const yaw = HEAD.yaw;
  const pitch = HEAD.pitch + FACE_DROP;
  const shape = EXPRESSIONS.neutral.left;
  const a = placeEye(yaw, pitch, roll, shape, 1, { yaw, pitch });
  if (restMids.size > 500) restMids.clear();
  restMids.set(key, a.center);
  return a.center;
}

/**
 * The gaze solver: both eyes for a face looking `yaw`/`pitch` degrees off
 * rest, on a body. Each eye sits on the head, then the face is pushed out to
 * the outline at its angle (a wide body spreads the eyes, a narrow one
 * gathers them), and finally pulled in until every eye point keeps
 * EYE_MARGIN inside the outline.
 */
export function solveEyes(radii: Radii, face: Expression, gaze: { yaw: number; pitch: number; roll: number }, open: { left: number; right: number }): [PlacedEye, PlacedEye] {
  const yaw = HEAD.yaw + face.yaw + gaze.yaw;
  const pitch = HEAD.pitch + FACE_DROP + face.pitch + gaze.pitch;
  const roll = face.roll * EYE_ROLL + gaze.roll;
  const axes = { yaw, pitch };
  const split = face.split * EYE_SPREAD;
  const left = placeEye(yaw - split, pitch, roll, face.left, face.left.open * open.left, axes);
  const right = placeEye(yaw + split, pitch, roll, face.right, face.right.open * open.right, axes);
  // the face, seen from the front (2026-10-18): its middle rests at EYE_SHIFT (R, from the
  // body's middle) and moves from there as much as the head's turn moves it (a look, a
  // face, the pointer); the eyes keep their own distance from it, the width spread by
  // the body's own width. The fit below pulls the middle in toward the body's middle.
  const mid: Point = [(left.center[0] + right.center[0]) / 2, (left.center[1] + right.center[1]) / 2];
  const rest = solveRest(roll);
  const spread = radiusToward(radii, 1, 0) * 0.5 + radiusToward(radii, -1, 0) * 0.5;
  const sx = Math.max(0.35, Math.min(1.25, spread));
  const target: Point = [EYE_SHIFT.x + (mid[0] - rest[0]) * EYE_GAZE, EYE_SHIFT.y + (mid[1] - rest[1]) * EYE_GAZE];
  const place = (eyeAt: PlacedEye, s: number): PlacedEye => {
    const [cx, cy] = eyeAt.center;
    const nx = target[0] * s + (cx - mid[0]) * sx;
    const ny = target[1] * s + (cy - mid[1]);
    return { ...eyeAt, center: [nx, ny], points: eyeAt.points.map(([x, y]) => [x - cx + nx, y - cy + ny] as Point) };
  };
  const fits = (eyes: PlacedEye[]) => eyes.every((e) => e.alpha <= 0 || e.points.every(([x, y]) => Math.hypot(x, y) <= radiusToward(radii, x, y || -1e-6) - EYE_MARGIN));
  let lo = 0;
  let hi = 1;
  if (!fits([place(left, 1), place(right, 1)])) {
    for (let i = 0; i < 18; i += 1) {
      const s = (lo + hi) / 2;
      if (fits([place(left, s), place(right, s)])) lo = s;
      else hi = s;
    }
    hi = lo;
  }
  let placed: [PlacedEye, PlacedEye] = [place(left, hi), place(right, hi)];
  // a body too small for these eyes even with the face in the middle: shrink the eyes
  if (!fits(placed)) {
    let shrink = 1;
    while (shrink > 0.1 && !fits(placed)) {
      shrink *= 0.9;
      placed = placed.map((e) => ({ ...e, points: e.points.map(([x, y]) => [e.center[0] + (x - e.center[0]) * shrink, e.center[1] + (y - e.center[1]) * shrink] as Point) })) as [PlacedEye, PlacedEye];
    }
  }
  return placed;
}

/* ------------------------------------------------------------ frames */

/** One drawn frame, in the 0..100 box. */
export interface ShapeFrame {
  /** The body's outline. */
  body: string;
  /** The eyes, closed subpaths to cut out of the body (fill-rule evenodd). */
  eyes: string;
  /** The body's transform (drift, breath, a move's turn and size), around the body's middle. */
  transform: string;
  /** The body color now (blended while a color change slides). */
  color: string;
  /** How far the body is from its resting outline (0..1): a skin's edge and aura step aside while it moves. */
  morphed: number;
  /** The light's place for the clay gradient (box units, before the transform). */
  light: { x: number; y: number; r: number };
  dots: { x: number; y: number; r: number; opacity: number }[];
  specks: { x: number; y: number; r: number; opacity: number }[];
  badge: { x: number; y: number; r: number; notch: number } | null;
  rings: RingDraw[];
  ribbons: RibbonDraw[];
}

export interface ShapeState {
  shape: MascotShape;
  expression: ShapeExpression;
  color: string;
}

function eyesPath(eyes: PlacedEye[]): string {
  return eyes
    .filter((e) => e.alpha > 0.001)
    .map((e) => smoothClosed(e.points.map((p) => toBox(p))))
    .join("");
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** The resting frame of a shape: no wander, no blink, no move (thumbnails, reduced motion, the first paint). */
export function stillFrame(state: ShapeState): ShapeFrame {
  return gazeFrame(state, 0, 0);
}

/** Gaze toward normalized pointer (-1..1); optional rigid lean on the whole body (sidebar). */
export function gazeFrame(
  state: ShapeState,
  nx: number,
  ny: number,
  body: { rot?: number; sx?: number; sy?: number } = {},
  open = { left: 1, right: 1 },
): ShapeFrame {
  const gaze = hoverGaze(nx, ny);
  return composeFrame({
    radii: SHAPE_RADII[state.shape],
    rest: SHAPE_RADII[state.shape],
    face: EXPRESSIONS[state.expression],
    gaze: { ...gaze, roll: 0 },
    open,
    color: state.color,
    body: { x: 0, y: 0, rot: body.rot ?? 0, sx: body.sx ?? 1, sy: body.sy ?? 1 },
    eyes: 1,
    pose: null,
    t: 0,
  });
}

interface FrameInputs {
  radii: Radii;
  rest: Radii;
  face: Expression;
  gaze: { yaw: number; pitch: number; roll: number };
  open: { left: number; right: number };
  color: string;
  body: { x: number; y: number; rot: number; sx: number; sy: number };
  eyes: number;
  pose: { pose: MovePose; weight: number } | null;
  t: number;
}

function composeFrame(input: FrameInputs): ShapeFrame {
  const placed = input.eyes > 0.02 ? solveEyes(input.radii, input.face, input.gaze, input.open) : [];
  const shown = placed.map((e) => {
    // eyes fading out with a move shrink to nothing about their middle
    const s = clamp01(input.eyes);
    return s >= 1 ? e : { ...e, alpha: e.alpha * s, points: e.points.map(([x, y]) => [e.center[0] + (x - e.center[0]) * s, e.center[1] + (y - e.center[1]) * s] as Point) };
  });
  const [cx, cy] = BODY.center;
  const { x, y, rot, sx, sy } = input.body;
  const transform = `translate(${fmt(x * BODY.unit)} ${fmt(y * BODY.unit)}) rotate(${fmt(rot)} ${cx} ${cy}) translate(${cx} ${cy}) scale(${fmt(sx)} ${fmt(sy)}) translate(${-cx} ${-cy})`;
  const morphed = clamp01(input.radii.reduce((most, r, i) => Math.max(most, Math.abs(r - input.rest[i])), 0) / 0.08);
  const pose = input.pose;
  const w = pose?.weight ?? 0;
  const dots = (pose?.pose.dots ?? []).map((dot) => {
    const p = toBox([dot.x, dot.y]);
    return { x: p[0], y: p[1], r: dot.r * BODY.unit * w, opacity: dot.opacity * w };
  });
  const specks = (pose?.pose.specks ?? []).map((s) => {
    const p = toBox([s.x, s.y]);
    return { x: p[0], y: p[1], r: s.r * BODY.unit, opacity: s.opacity * w };
  });
  let badge: ShapeFrame["badge"] = null;
  if (pose?.pose.badge && pose.pose.badge.scale > 0.001) {
    const { angle, r, scale } = pose.pose.badge;
    const a = angle * RAD;
    const edge = radiusToward(input.radii, Math.sin(a), -Math.cos(a)) * 0.93;
    const p = toBox([Math.sin(a) * edge, -Math.cos(a) * edge]);
    badge = { x: p[0], y: p[1], r: r * BODY.unit * scale * w, notch: 0.054 * BODY.unit * w };
  }
  const rings = (pose?.pose.rings ?? []).map(({ spec, opacity }) => ringAt(spec, input.t, opacity * w, [x, y]));
  const ribbonsNow = (pose?.pose.ribbons ?? []).map((ribbon) => ({ ...ribbon, opacity: ribbon.opacity * w }));
  return {
    body: smoothClosed(input.radii.map((r, i) => toBox([r * Math.sin((i / input.radii.length) * Math.PI * 2), -r * Math.cos((i / input.radii.length) * Math.PI * 2)]))),
    eyes: eyesPath(shown),
    transform,
    color: input.color,
    morphed,
    light: { x: cx + CLAY_LIGHT.x * BODY.unit, y: cy + CLAY_LIGHT.y * BODY.unit, r: CLAY_LIGHT.r * BODY.unit },
    dots,
    specks,
    badge,
    rings,
    ribbons: ribbonsNow,
  };
}

/**
 * One live shape: holds what is sliding (shape, face, color), the blink
 * schedule, the pointer turn and the move playing, and draws a frame for
 * any moment. Times are seconds on one clock (performance.now() / 1000).
 */
export class ShapeEngine {
  private readonly seed: number;
  private blinks: number[] = [];
  private blinkHorizon = 0;
  private start: number;
  private state: ShapeState;
  private fromRadii: Radii;
  private shapeAt = -Infinity;
  private fromFace: Expression;
  private faceAt = -Infinity;
  private fromColor: string;
  private colorAt = -Infinity;
  private move: { id: ShapeMove; at: number } | null = null;
  private readonly yaw = new Follower(0);
  private readonly pitch = new Follower(0);
  /** 1 while the gaze wanders, 0 while it follows the pointer. */
  private readonly wanders = new Follower(1);
  private last: number | null = null;

  constructor(state: ShapeState, now: number, seed = Math.random() * 1000) {
    this.seed = seed;
    this.state = state;
    this.start = now;
    this.fromRadii = SHAPE_RADII[state.shape];
    this.fromFace = EXPRESSIONS[state.expression];
    this.fromColor = state.color;
  }

  /** The current shape, expression and color; a change slides over MORPH_S from what shows now. */
  set(next: ShapeState, now: number): void {
    if (next.shape !== this.state.shape) {
      this.fromRadii = this.radiiNow(now);
      this.shapeAt = now;
    }
    if (next.expression !== this.state.expression) {
      this.fromFace = this.faceNow(now);
      this.faceAt = now;
    }
    if (next.color.toLowerCase() !== this.state.color.toLowerCase()) {
      this.fromColor = this.colorNow(now);
      this.colorAt = now;
    }
    this.state = next;
  }

  /** The pointer around the mascot (-1..1 each axis, y down), or null when it left. */
  pointer(at: { x: number; y: number } | null): void {
    if (!at) {
      this.yaw.target = 0;
      this.pitch.target = 0;
      this.wanders.target = 1;
      return;
    }
    const gaze = hoverGaze(at.x, at.y);
    this.yaw.target = gaze.yaw;
    this.pitch.target = gaze.pitch;
    this.wanders.target = 0;
  }

  play(move: ShapeMove, now: number): void {
    this.move = { id: move, at: now };
  }

  /** Whether a move is still playing at `now`. */
  playing(now: number): boolean {
    return this.move !== null && now - this.move.at <= moveLength(this.move.id);
  }

  private radiiNow(now: number): Radii {
    const k = easeOutQuint((now - this.shapeAt) / MORPH_S);
    return k >= 1 ? SHAPE_RADII[this.state.shape] : blendRadii(this.fromRadii, SHAPE_RADII[this.state.shape], k);
  }

  private faceNow(now: number): Expression {
    const k = easeOutQuint((now - this.faceAt) / MORPH_S);
    return k >= 1 ? EXPRESSIONS[this.state.expression] : blendExpression(this.fromFace, EXPRESSIONS[this.state.expression], k);
  }

  private colorNow(now: number): string {
    const k = easeOutQuint((now - this.colorAt) / MORPH_S);
    return k >= 1 ? this.state.color : mixHex(this.fromColor, this.state.color, k);
  }

  /** The frame at `now`. */
  frame(now: number): ShapeFrame {
    const dt = this.last === null ? 0 : Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    const t = now - this.start;
    if (t + 6 > this.blinkHorizon) {
      this.blinkHorizon = t + 30;
      this.blinks = blinkSchedule(this.seed, this.blinkHorizon);
    }
    const yaw = this.yaw.step(dt);
    const pitch = this.pitch.step(dt);
    const wanderWeight = this.wanders.step(dt);
    const w = wander(t, this.seed);
    const body = drift(t, this.seed);
    const rest = this.radiiNow(now);
    let radii: Radii = rest;
    let face = this.faceNow(now);
    const blink = blinkOpen(t, this.blinks);
    let x = body.x;
    let y = body.y;
    let rot = 0;
    let scale = 1;
    let eyes = 1;
    let pose: FrameInputs["pose"] = null;
    if (this.move && this.playing(now)) {
      const u = now - this.move.at;
      const weight = moveWeight(this.move.id, u);
      const p = moveAt(this.move.id, u);
      if (p.radii) radii = blendRadii(rest, p.radii, weight);
      if (p.face) face = blendExpression(face, { ...face, ...p.face }, weight);
      x += (p.x ?? 0) * weight;
      y += (p.y ?? 0) * weight;
      rot = (p.rot ?? 0) * weight;
      scale = lerp(1, p.scale ?? 1, weight);
      eyes = lerp(1, p.eyes ?? 1, weight);
      pose = { pose: p, weight };
    }
    return composeFrame({
      radii,
      rest,
      face,
      gaze: { yaw: w.yaw * wanderWeight + yaw, pitch: w.pitch * wanderWeight + pitch, roll: w.roll * wanderWeight },
      open: { left: blink, right: blink },
      color: this.colorNow(now),
      body: { x, y, rot, sx: scale * (2 - body.breath), sy: scale * body.breath },
      eyes,
      pose,
      t,
    });
  }
}
