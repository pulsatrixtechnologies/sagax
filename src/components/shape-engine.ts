// The Shapes engine (clean room, 2026-10-08): everything that moves a shape,
// as pure functions of time, so tests and the static render share it with
// the live avatar (ShapeMascot.tsx).
//
// - The face: two rounded bars on the body, always the same two capsules
//   (2026-10-28: no eye ever fades, shrinks or tilts on its own). Their
//   middle rests on the body's face anchor (shared/mascot-geometry.json) and
//   moves from there with the gaze: an imaginary head (a unit sphere) turned
//   HEAD.yaw degrees and tilted HEAD.pitch degrees says how far a look moves
//   the pair; the bounds solver keeps both eyes inside the outline.
// - Idle: the gaze wanders on five slow loops, the body drifts and breathes
//   on a BREATH_S cycle, the eyes blink on a seeded schedule.
// - Hover: the gaze turns toward the pointer, easing in over HOVER.turn s.
// - Changes of shape, expression and color slide over MORPH_S.
// - Moves: the fourteen one-shot moves of shape-moves.ts, blended over the
//   resting pose. A move never takes the body apart: it stays one whole
//   outline with its two eyes; what a move adds (thought dots, a mark, rings,
//   ribbons, specks) is drawn around it.
//
// All lengths are in R (the circle's radius) until frame() turns them into
// the 0..100 box (shape-art.ts BODY).
import type { MascotShape } from "../../shared/mascot-look";
import type { ShapeAvatarDef } from "../../shared/shape-avatar-def";
import {
  blendOutlines,
  liveOutlineFromDef,
  radiiFromOutlinePoints,
  smoothClosedOutline,
  type LiveShapeOutline,
  type OutlinePoint,
} from "../../shared/shape-avatar-outline";
import { blendRadii, BODY, clamp01, easeInOut, easeOutQuint, FACE_ANCHOR, GEOMETRY, lerp, RAD, radiusToward, SHAPE_RADII, smoothClosed, stemPath, toBox, type Radii } from "./shape-art";
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
/** How much of the body's lean (shape-motion.ts, degrees) the gaze follows. */
export const LEAN_GAZE = 0.35;
/** The imaginary head's own turn and tilt, degrees: the resting gaze looks back at the viewer through it. */
export const HEAD: { readonly yaw: number; readonly pitch: number } = GEOMETRY.eyes.head;
/** The resting face sits a little below the head's middle (degrees of pitch), so the eyes rest about mid-body. */
export const FACE_DROP: number = GEOMETRY.eyes.faceDrop;
/** The eyes' size on the body (2026-10-18: bigger, simpler, readable from the sidebar up). */
export const EYE_SCALE: { readonly w: number; readonly h: number } = GEOMETRY.eyes.scale;
/** How much of a face's roll the eyes keep: they stand nearly upright on the turned body. */
export const EYE_ROLL = 0;
/** How far apart the eyes sit, on top of each face's own split. */
export const EYE_SPREAD: number = GEOMETRY.eyes.spread;
/** How far a turn of the head (a look, the pointer) moves the face's middle across the body. */
export const EYE_GAZE: number = GEOMETRY.eyes.gaze;
/** The eyes are a little longer than wide scaling alone gives (tall capsules). */
export const EYE_LENGTH = 1;
/** Where a face rests on a body that names no anchor of its own (R): to the right, a little up. */
export const EYE_SHIFT = { x: 0.1, y: 0.2 } as const;


/* --------------------------------------------------------- expressions */

export type { EyeShape, Expression } from "./shape-expression";
import type { EyeShape, Expression } from "./shape-expression";

const eye = (w: number, h: number, tilt = 0, open = 1): EyeShape => ({ w, h, tilt, open });
const both = (yaw: number, pitch: number, roll: number, split: number, shape: EyeShape, right: EyeShape = shape): Expression => ({ yaw, pitch, roll, split, left: shape, right });

/** The sixteen faces, in the order the tests and the editor list them. */
export const SHAPE_EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"] as const;
export type ShapeExpression = (typeof SHAPE_EXPRESSIONS)[number];

/** The faces, from the geometry file (shared/mascot-geometry.json expressions). */
export const EXPRESSIONS: Readonly<Record<ShapeExpression, Expression>> = Object.fromEntries(
  SHAPE_EXPRESSIONS.map((id) => {
    const face = GEOMETRY.expressions[id];
    return [id, both(face.yaw, face.pitch, face.roll, face.split, eye(face.left.w, face.left.h, face.left.tilt, face.left.open), eye(face.right.w, face.right.h, face.right.tilt, face.right.open))];
  }),
) as Record<ShapeExpression, Expression>;

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

/** One eye as the viewer sees it: its outline points (R units), its middle, its size and tilt, and how visible it is. */
export interface PlacedEye {
  points: Point[];
  center: Point;
  /** The capsule's width and height (R), after the blink. */
  w: number;
  h: number;
  /** The face's own tilt for this eye, degrees (0 at rest: an upright capsule). */
  tilt: number;
  /** 0 (hidden by a move) .. 1; never less than 1 from the gaze alone (2026-10-28: an eye never fades away). */
  alpha: number;
  depth: number;
}

/** The eyes keep at least this much body around them, R. */
export const EYE_MARGIN: number = GEOMETRY.eyes.margin;
/** The two eyes keep at least this share of an eye's width between them. */
export const EYE_GAP: number = GEOMETRY.eyes.gap;

/** A rounded bar's outline (w x h, rounded ends), in its own frame, around its middle. */
export function stadium(w: number, h: number, count = 28): Point[] {
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

/**
 * An eye's outline: an upright capsule w x h around (cx, cy), turned only by
 * the face's own tilt (2026-10-28). Never sheared, never foreshortened: the
 * head's turn moves where the eyes sit, not their shape, so the two eyes of a
 * face are always the same capsule.
 */
export function eyeOutline(cx: number, cy: number, w: number, h: number, tilt: number): Point[] {
  const t = tilt * RAD;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return stadium(w, h).map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c] as Point);
}

function placeEye(yaw: number, pitch: number, roll: number, shape: EyeShape, open: number): PlacedEye {
  const c = toView(direction(yaw, pitch), roll);
  // the size: the face's own capsule, the blink closing its height; the turn only moves it
  const w = shape.w * EYE_SCALE.w;
  const h = Math.max(shape.h * EYE_SCALE.h * EYE_LENGTH * Math.max(open, BLINK.floor), 0.012);
  return { points: eyeOutline(c[0], c[1], w, h, shape.tilt), center: [c[0], c[1]], w, h, tilt: shape.tilt, alpha: 1, depth: c[2] };
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
  const a = placeEye(yaw, pitch, roll, shape, 1);
  if (restMids.size > 500) restMids.clear();
  restMids.set(key, a.center);
  return a.center;
}

/**
 * The gaze solver: both eyes for a face looking `yaw`/`pitch` degrees off
 * rest, on a body. Each eye's middle sits on the head, then the face is
 * pushed out to the outline at its angle (a wide body spreads the eyes, a
 * narrow one gathers them), and finally pulled in until every eye point keeps
 * EYE_MARGIN inside the outline. The two eyes always stand on one level line
 * (2026-10-28): the head's turn moves the face, never one eye above the other.
 * `anchor` is where the face rests on this body (R, shared/mascot-geometry.json).
 */
export function solveEyes(radii: Radii, face: Expression, gaze: { yaw: number; pitch: number; roll: number }, open: { left: number; right: number }, anchor: Point = [EYE_SHIFT.x, EYE_SHIFT.y]): [PlacedEye, PlacedEye] {
  const yaw = HEAD.yaw + face.yaw + gaze.yaw;
  const pitch = HEAD.pitch + FACE_DROP + face.pitch + gaze.pitch;
  const roll = face.roll * EYE_ROLL + gaze.roll;
  const split = face.split * EYE_SPREAD;
  const left = placeEye(yaw - split, pitch, roll, face.left, face.left.open * open.left);
  const right = placeEye(yaw + split, pitch, roll, face.right, face.right.open * open.right);
  // the face, seen from the front (2026-10-18): its middle rests at the anchor (R, from the
  // body's middle) and moves from there as much as the head's turn moves it (a look, a
  // face, the pointer); the eyes keep their own distance from it, the width spread by
  // the body's own width. The fit below pulls the middle in toward the body's middle.
  const mid: Point = [(left.center[0] + right.center[0]) / 2, (left.center[1] + right.center[1]) / 2];
  const rest = solveRest(roll);
  const spread = radiusToward(radii, 1, 0) * 0.5 + radiusToward(radii, -1, 0) * 0.5;
  const sx = Math.max(0.35, Math.min(1.25, spread));
  const target: Point = [anchor[0] + (mid[0] - rest[0]) * EYE_GAZE, anchor[1] + (mid[1] - rest[1]) * EYE_GAZE];
  const place = (eyeAt: PlacedEye, s: number, k = 1): PlacedEye => {
    const nx = target[0] * s + (eyeAt.center[0] - mid[0]) * sx;
    const ny = target[1] * s;
    const w = eyeAt.w * k;
    const h = eyeAt.h * k;
    return { ...eyeAt, center: [nx, ny], w, h, points: eyeOutline(nx, ny, w, h, eyeAt.tilt) };
  };
  // inside the outline with EYE_MARGIN to spare, and never touching each other
  const apart = (eyes: PlacedEye[]) => eyes.length < 2 || Math.abs(eyes[1].center[0] - eyes[0].center[0]) >= (eyes[0].w + eyes[1].w) / 2 + EYE_GAP * Math.max(eyes[0].w, eyes[1].w);
  const fits = (eyes: PlacedEye[]) => apart(eyes) && eyes.every((e) => e.points.every(([x, y]) => Math.hypot(x, y) <= radiusToward(radii, x, y || -1e-6) - EYE_MARGIN));
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
  // a body too small for these eyes even with the face in the middle: shrink both eyes alike
  let shrink = 1;
  while (shrink > 0.1 && !fits(placed)) {
    shrink *= 0.9;
    placed = [place(left, hi, shrink), place(right, hi, shrink)];
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
  /**
   * The same eyes as capsules (box units): middle, width, height, the face's
   * tilt. The volume drawing places each one upright on the turned body from
   * these (shape-volume.ts posedEyes), so no turn, roll or squash of the body
   * ever bends an eye.
   */
  eyeShapes: EyeBox[];
  /** The body's motion in numbers (frame.transform): a shift (box units), a turn (degrees) and a scale on each axis. */
  motion: { x: number; y: number; rot: number; sx: number; sy: number };
  /** The pumpkin's stem (box units, before the transform) and how much of it shows, or null for every other body. */
  stem: { d: string; opacity: number } | null;
  /** The body's transform (drift, breath, a move's turn and size), around the body's middle. */
  transform: string;
  /** The body color now (blended while a color change slides). */
  color: string;
  /** How far the body is from its resting outline (0..1): a skin's edge and aura step aside while it moves. */
  morphed: number;
  /**
   * The body's thickness (0..1, bodyDepth): its thinnest half-width now over
   * DEPTH_FULL. A move that shrinks the body to a
   * dot, a bar or a speck thins its depth with it (shape-volume.ts
   * poseMatrices), so the slices never smear a dot into a pill beside its own
   * thought dots.
   */
  depth: number;
  /** The light's place for the clay gradient (box units, before the transform). */
  light: { x: number; y: number; r: number };
  dots: { x: number; y: number; r: number; opacity: number }[];
  specks: { x: number; y: number; r: number; opacity: number }[];
  badge: { x: number; y: number; r: number; notch: number } | null;
  /** A move's marks in the body's colour beside the body (the exclamation mark), box units, closed paths. */
  marks: { d: string; opacity: number }[];
  rings: RingDraw[];
  ribbons: RibbonDraw[];
}

/** One eye as a capsule in the 0..100 box. */
export interface EyeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  tilt: number;
}

export interface ShapeState {
  shape: MascotShape;
  expression: ShapeExpression;
  color: string;
  /** Path-based body from a portable avatarDef (v2.1). */
  avatarDef?: ShapeAvatarDef;
}

/** Live outline cache for a path-bodied avatarDef. */
export function outlineForState(state: ShapeState): LiveShapeOutline | null {
  if (!state.avatarDef) return null;
  const live = liveOutlineFromDef(state.avatarDef);
  return live.pathBody ? live : null;
}

function eyesPath(eyes: PlacedEye[]): string {
  return eyes
    .filter((e) => e.alpha > 0.001)
    .map((e) => smoothClosed(e.points.map((p) => toBox(p))))
    .join("");
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (v: number) => round3(v).toString();

/** The resting frame of a shape: no wander, no blink, no move (thumbnails, reduced motion, the first paint). */
export function stillFrame(state: ShapeState): ShapeFrame {
  return gazeFrame(state, 0, 0);
}

function pathBodyInputs(state: ShapeState): Pick<FrameInputs, "radii" | "rest" | "outline"> | null {
  const live = outlineForState(state);
  if (!live) return null;
  const radii = radiiFromOutlinePoints(live.points);
  return {
    radii,
    rest: radii,
    outline: { path: live.path, points: live.points, face: live.face, morphing: false },
  };
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
  const path = pathBodyInputs(state);
  const radii = path?.radii ?? SHAPE_RADII[state.shape];
  return composeFrame({
    shape: state.shape,
    radii,
    rest: path?.rest ?? SHAPE_RADII[state.shape],
    face: EXPRESSIONS[state.expression],
    gaze: { ...gaze, roll: 0 },
    open,
    color: state.color,
    body: { x: 0, y: 0, rot: body.rot ?? 0, sx: body.sx ?? 1, sy: body.sy ?? 1 },
    eyes: 1,
    pose: null,
    t: 0,
    stem: state.shape === "pumpkin" && !path ? 1 : 0,
    outline: path?.outline,
  });
}

interface FrameInputs {
  /** The body the face anchor is read for. */
  shape: MascotShape;
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
  /** How much of the pumpkin's stem shows (0 for every other body). */
  stem: number;
  /** Path body: exact silhouette (and morph points). When set, frame.body prefers path. */
  outline?: { path: string; points: OutlinePoint[]; face: OutlinePoint; morphing: boolean };
}

/** Whether a body wears the pumpkin's stem (1) or not (0). */
const stemOf = (shape: MascotShape) => (shape === "pumpkin" ? 1 : 0);

/**
 * How thick a body must be (its thinnest half-width, R) to carry the volume's
 * full depth. A thinner one carries that share of it (2026-10-28).
 */
export const DEPTH_FULL = 0.62;

/**
 * The body's thickness now (ShapeFrame.depth, 0..1): its thinnest half-width
 * over DEPTH_FULL. The slices' depth is a fixed length, so a body thinner than
 * that (a tube, a teardrop's tip, a dot a move shrinks it to) must thin its
 * depth with it or its slices spread wider than the body and it comes apart.
 * Measured on the body's own radii, never against its resting shape: #1106
 * compared a move's body with the rest, which left every naturally thin body
 * at full depth.
 */
export function bodyDepth(radii: Radii): number {
  const thinnest = radii.reduce((least, v) => Math.min(least, v), Infinity);
  return Number.isFinite(thinnest) ? clamp01(thinnest / DEPTH_FULL) : 1;
}

function composeFrame(input: FrameInputs): ShapeFrame {
  const faceAnchor: Point = input.outline
    ? [((input.outline.face[0] - BODY.center[0]) / BODY.unit), ((input.outline.face[1] - BODY.center[1]) / BODY.unit)]
    : FACE_ANCHOR[input.shape];
  const placed = input.eyes > 0.02 ? solveEyes(input.radii, input.face, input.gaze, input.open, faceAnchor) : [];
  const shown = placed.map((e) => {
    // eyes fading out with a move shrink to nothing about their middle
    const s = clamp01(input.eyes);
    return s >= 1 ? e : { ...e, alpha: e.alpha * s, w: e.w * s, h: e.h * s, points: eyeOutline(e.center[0], e.center[1], e.w * s, e.h * s, e.tilt) };
  });
  const eyeShapes = shown
    .filter((e) => e.alpha > 0.001)
    .map((e) => {
      const [bx, by] = toBox(e.center);
      return { x: round3(bx), y: round3(by), w: round3(e.w * BODY.unit), h: round3(e.h * BODY.unit), tilt: e.tilt };
    });
  const [cx, cy] = BODY.center;
  const { x, y, rot, sx, sy } = input.body;
  const transform = `translate(${fmt(x * BODY.unit)} ${fmt(y * BODY.unit)}) rotate(${fmt(rot)} ${cx} ${cy}) translate(${cx} ${cy}) scale(${fmt(sx)} ${fmt(sy)}) translate(${-cx} ${-cy})`;
  const morphed = clamp01(input.radii.reduce((most, r, i) => Math.max(most, Math.abs(r - input.rest[i])), 0) / 0.08);
  const depth = bodyDepth(input.radii);
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
  const marks = (pose?.pose.marks ?? []).map((mark) => ({ d: smoothClosed(mark.points.map((p) => toBox(p))), opacity: round3(mark.opacity * w) })).filter((mark) => mark.opacity > 0.001);
  // Path body: exact silhouette when settled; resampled smooth ring while morphing.
  const polarBody = smoothClosed(input.radii.map((r, i) => toBox([r * Math.sin((i / input.radii.length) * Math.PI * 2), -r * Math.cos((i / input.radii.length) * Math.PI * 2)])));
  const bodyPath = input.outline
    ? (input.outline.morphing ? smoothClosedOutline(input.outline.points) : input.outline.path)
    : polarBody;
  return {
    body: bodyPath,
    eyes: eyesPath(shown),
    eyeShapes,
    motion: { x: x * BODY.unit, y: y * BODY.unit, rot, sx, sy },
    stem: input.stem > 0.01 ? { d: stemPath(input.radii), opacity: round3(input.stem) } : null,
    transform,
    color: input.color,
    morphed,
    depth,
    light: { x: cx + CLAY_LIGHT.x * BODY.unit, y: cy + CLAY_LIGHT.y * BODY.unit, r: CLAY_LIGHT.r * BODY.unit },
    dots,
    specks,
    badge,
    marks,
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
  private fromOutline: OutlinePoint[] | null;
  private shapeAt = -Infinity;
  private fromFace: Expression;
  private faceAt = -Infinity;
  private fromColor: string;
  private colorAt = -Infinity;
  private fromStem: number;
  private move: { id: ShapeMove; at: number } | null = null;
  private readonly yaw = new Follower(0);
  private readonly pitch = new Follower(0);
  /** 1 while the gaze wanders, 0 while it follows the pointer. */
  private readonly wanders = new Follower(1);
  /** The body's lean (shape-motion.ts), degrees off the rest turn: the gaze follows it, the outline never bends for it. */
  private leanGaze = { yaw: 0, pitch: 0 };
  private last: number | null = null;

  constructor(state: ShapeState, now: number, seed = Math.random() * 1000) {
    this.seed = seed;
    this.state = state;
    this.start = now;
    const live = outlineForState(state);
    this.fromRadii = live ? radiiFromOutlinePoints(live.points) : SHAPE_RADII[state.shape];
    this.fromOutline = live ? live.points : null;
    this.fromFace = EXPRESSIONS[state.expression];
    this.fromColor = state.color;
    this.fromStem = stemOf(state.shape);
  }

  /** The current shape, expression and color; a change slides over MORPH_S from what shows now. */
  set(next: ShapeState, now: number): void {
    const shapeChanged = next.shape !== this.state.shape
      || (next.avatarDef?.id ?? "") !== (this.state.avatarDef?.id ?? "")
      || JSON.stringify(next.avatarDef?.body) !== JSON.stringify(this.state.avatarDef?.body);
    if (shapeChanged) {
      this.fromRadii = this.radiiNow(now);
      this.fromOutline = this.outlinePointsNow(now);
      this.fromStem = this.stemNow(now);
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

  /**
   * Where the body's own motion leans (yaw right, pitch up, degrees off the
   * rest turn): the face looks that way (LEAN_GAZE of it), so a sway reads
   * on the eyes while the outline keeps its one resting turn.
   */
  lean(yaw: number, pitch: number): void {
    this.leanGaze = { yaw: yaw * LEAN_GAZE, pitch: pitch * LEAN_GAZE };
  }

  /** Whether a move is still playing at `now`. */
  playing(now: number): boolean {
    return this.move !== null && now - this.move.at <= moveLength(this.move.id);
  }

  private targetOutline(): LiveShapeOutline | null {
    return outlineForState(this.state);
  }

  private targetRadii(): Radii {
    const live = this.targetOutline();
    return live ? radiiFromOutlinePoints(live.points) : SHAPE_RADII[this.state.shape];
  }

  private outlinePointsNow(now: number): OutlinePoint[] | null {
    const to = this.targetOutline();
    const k = easeOutQuint((now - this.shapeAt) / MORPH_S);
    if (!this.fromOutline && !to) return null;
    const from = this.fromOutline ?? (to ? to.points : null);
    const dest = to?.points ?? this.fromOutline;
    if (!from || !dest) return null;
    return k >= 1 ? dest : blendOutlines(from, dest, k);
  }

  private radiiNow(now: number): Radii {
    const k = easeOutQuint((now - this.shapeAt) / MORPH_S);
    const to = this.targetRadii();
    return k >= 1 ? to : blendRadii(this.fromRadii, to, k);
  }

  /** How much of the pumpkin's stem shows: it grows in and out with a change of shape. */
  private stemNow(now: number): number {
    const k = easeOutQuint((now - this.shapeAt) / MORPH_S);
    return lerp(this.fromStem, stemOf(this.state.shape), k);
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
    let stem = this.stemNow(now);
    if (this.move && this.playing(now)) {
      const u = now - this.move.at;
      const weight = moveWeight(this.move.id, u);
      const p = moveAt(this.move.id, u, rest);
      if (p.radii) {
        radii = blendRadii(rest, p.radii, weight);
        // a body turned into another whole body (an egg, a hexagon) loses its stem until it comes back
        stem *= 1 - weight;
      }
      if (p.face) face = blendExpression(face, { ...face, ...p.face }, weight);
      x += (p.x ?? 0) * weight;
      y += (p.y ?? 0) * weight;
      rot = (p.rot ?? 0) * weight;
      scale = lerp(1, p.scale ?? 1, weight);
      eyes = lerp(1, p.eyes ?? 1, weight);
      pose = { pose: p, weight };
    }
    const live = this.targetOutline();
    const outlinePts = this.outlinePointsNow(now);
    const morphK = easeOutQuint((now - this.shapeAt) / MORPH_S);
    const outline = live && outlinePts
      ? {
          path: live.path,
          points: outlinePts,
          face: live.face,
          morphing: morphK < 1 || !!this.fromOutline,
        }
      : undefined;
    return composeFrame({
      shape: this.state.shape,
      radii,
      rest,
      face,
      gaze: { yaw: w.yaw * wanderWeight + yaw + this.leanGaze.yaw, pitch: w.pitch * wanderWeight + pitch + this.leanGaze.pitch, roll: w.roll * wanderWeight },
      open: { left: blink, right: blink },
      color: this.colorNow(now),
      body: { x, y, rot, sx: scale * (2 - body.breath), sy: scale * body.breath },
      eyes,
      pose,
      t,
      stem: live ? 0 : stem,
      outline: outline && morphK >= 1 && !this.move ? { ...outline, morphing: false } : outline,
    });
  }
}
