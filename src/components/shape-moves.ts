// The Shapes moves (clean room, 2026-10-08; whole bodies since 2026-10-28):
// fourteen one-shot timelines (SHAPE_MOVES) that move the body, change its
// face, morph it into another whole body of the set and add thought dots,
// an exclamation mark, rings, ribbons, specks or a badge beside it. No move
// takes the body apart into a dot or a bar any more: the mascot stays one
// outline with its two eyes, which is what every "broken shape" report was.
// Each move is a pure function of the time since it started (moveAt);
// shape-engine.ts blends it over the resting pose (moveWeight: slides in
// over its morph, holds for its duration, slides back over its morph). The
// ring and ribbon generators are our own: a circle in 3D tilted twice and
// split by depth, and a bundle of quadratic curves fanned around a line.
import type { Expression } from "./shape-expression";
import { blendRadii, BODY, clamp01, easeInOut, easeOutQuint, lerp, MOVE_RADII, RAD, SHAPE_RADII, toBox, type Radii } from "./shape-art";

type Point = [number, number];

/* ---------------------------------------------------------- rings */

export interface RingSpec {
  /** Radius, R. */
  a: number;
  /** Tilt of the ring's plane: about the x axis, then about the z axis, degrees. */
  tiltX: number;
  tiltZ: number;
  /** Turns per second around the ring's own axis (the arc travels). */
  speed: number;
  phase: number;
  /** How much of the ring is drawn (0..1). */
  sweep: number;
  hue: number;
  hueSpan: number;
  width: number;
}

export interface RingDraw {
  /** The parts behind the body and in front of it, box units. */
  back: string;
  front: string;
  hue: number;
  hueSpan: number;
  width: number;
  opacity: number;
  /** The gradient's ends, box units. */
  x1: number;
  x2: number;
}

const pathOf = (runs: Point[][]) =>
  runs
    .filter((run) => run.length > 1)
    .map((run) => run.map((p, i) => `${i ? "L" : "M"}${(Math.round(p[0] * 100) / 100).toString()} ${(Math.round(p[1] * 100) / 100).toString()}`).join(""))
    .join("");

/** A ring in 3D around the body at time t (s), split into its back and front halves by depth. */
export function ringAt(spec: RingSpec, t: number, opacity: number, center: Point = [0, 0]): RingDraw {
  const count = 72;
  const start = (spec.phase + spec.speed * t) * Math.PI * 2;
  const tx = spec.tiltX * RAD;
  const tz = spec.tiltZ * RAD;
  const back: Point[][] = [[]];
  const front: Point[][] = [[]];
  let wasFront: boolean | null = null;
  for (let i = 0; i <= count; i += 1) {
    const f = start + (i / count) * spec.sweep * Math.PI * 2;
    const x0 = Math.cos(f) * spec.a;
    const y0 = Math.sin(f) * spec.a;
    // tilt about x (the ring leans toward the viewer), then about z (it turns in the picture)
    const y1 = y0 * Math.cos(tx);
    const z1 = y0 * Math.sin(tx);
    const x2 = x0 * Math.cos(tz) - y1 * Math.sin(tz);
    const y2 = x0 * Math.sin(tz) + y1 * Math.cos(tz);
    const p = toBox([center[0] + x2, center[1] + y2]);
    const isFront = z1 >= 0;
    if (wasFront !== null && isFront !== wasFront) {
      // keep the line continuous across the switch
      (wasFront ? front : back).at(-1)!.push(p);
      (isFront ? front : back).push([]);
    }
    (isFront ? front : back).at(-1)!.push(p);
    wasFront = isFront;
  }
  const span = spec.a * BODY.unit;
  return { back: pathOf(back), front: pathOf(front), hue: spec.hue, hueSpan: spec.hueSpan, width: spec.width * BODY.unit, opacity, x1: BODY.center[0] + center[0] * BODY.unit - span, x2: BODY.center[0] + center[0] * BODY.unit + span };
}

/** The hue stops of a ring or ribbon's gradient. */
export function rainbowStops(hue: number, span: number): string[] {
  return [0, 0.5, 1].map((k) => `hsl(${Math.round((hue + span * k) % 360)}, 55%, 62%)`);
}

/* --------------------------------------------------------- ribbons */

export interface RibbonDraw {
  d: string;
  hue: number;
  hueSpan: number;
  width: number;
  opacity: number;
  /** The visible part of the ribbon, as a dash over a path of length 1. */
  dash: number;
  offset: number;
  x1: number;
  x2: number;
}

/** A bundle of `count` ribbons along a curve from `from` to `to` bowing by `bow` (R), fanned `spread` R apart. */
export function ribbons(from: Point, to: Point, bow: number, count: number, spread: number, hue: number, opacity: number, dash: number, offset: number, width = 0.06): RibbonDraw[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return Array.from({ length: count }, (_, i) => {
    const k = i - (count - 1) / 2;
    const off = k * spread;
    const a = toBox([from[0] + nx * off * 0.4, from[1] + ny * off * 0.4]);
    const c = toBox([(from[0] + to[0]) / 2 + nx * (bow + off), (from[1] + to[1]) / 2 + ny * (bow + off)]);
    const b = toBox([to[0] + nx * off, to[1] + ny * off]);
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      d: `M${r(a[0])} ${r(a[1])}Q${r(c[0])} ${r(c[1])} ${r(b[0])} ${r(b[1])}`,
      hue: (hue + i * 62) % 360,
      hueSpan: 70,
      width: width * BODY.unit * (1 - Math.abs(k) * 0.12),
      opacity,
      dash,
      offset: offset + i * 0.04,
      x1: Math.min(a[0], b[0]),
      x2: Math.max(a[0], b[0]) + 0.01,
    };
  });
}

/* ------------------------------------------------------------ moves */

/** The fourteen moves of Shapes, in the editor's order. */
export const SHAPE_MOVES = ["thinking", "wink", "wide", "alert", "notify", "exclaim", "sleep", "egg", "hexagon", "play", "orbit", "swirl", "burst", "comet"] as const;
export type ShapeMove = (typeof SHAPE_MOVES)[number];

export const isShapeMove = (value: unknown): value is ShapeMove => typeof value === "string" && (SHAPE_MOVES as readonly string[]).includes(value);

/** A move's length and how long it takes to slide in and out, s. */
export const MOVE_TIMING: Readonly<Record<ShapeMove, { duration: number; morph: number }>> = {
  thinking: { duration: 2.6, morph: 0.4 },
  wink: { duration: 1.6, morph: 0.3 },
  wide: { duration: 1.8, morph: 0.55 },
  alert: { duration: 2.4, morph: 0.45 },
  notify: { duration: 2.2, morph: 0.5 },
  exclaim: { duration: 2, morph: 0.45 },
  sleep: { duration: 2.4, morph: 0.5 },
  egg: { duration: 1.8, morph: 0.4 },
  hexagon: { duration: 1.6, morph: 0.4 },
  play: { duration: 2, morph: 0.5 },
  orbit: { duration: 3.4, morph: 0.6 },
  swirl: { duration: 1.3, morph: 0.3 },
  burst: { duration: 2.6, morph: 0.4 },
  comet: { duration: 2.4, morph: 0.45 },
};

/** A round part drawn on its own beside the body (a thought dot, the mark's dot), R units. */
export interface BodyDot {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/** A small dark speck around the body (the burst's particles), R units. */
export interface Speck {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/** A mark in the body's colour beside the body (the exclamation's bar), as a closed polygon, R units. */
export interface Mark {
  points: Point[];
  opacity: number;
}

/**
 * What a move does at a moment: the whole body it takes (another body of the
 * set, never a dot or a bar: the mascot stays in one piece, eyes on), the
 * face, the motion, and what it adds around the body.
 */
export interface MovePose {
  radii?: Radii;
  x?: number;
  y?: number;
  rot?: number;
  scale?: number;
  /** 0 hides the eyes (no move does any more; kept for a skin's own effects). */
  eyes?: number;
  face?: Partial<Expression>;
  dots?: BodyDot[];
  specks?: Speck[];
  marks?: Mark[];
  badge?: { angle: number; r: number; scale: number };
  rings?: { spec: RingSpec; opacity: number }[];
  ribbons?: RibbonDraw[];
}

export const ORBIT_RINGS: RingSpec[] = Array.from({ length: 6 }, (_, i) => ({
  a: 1.24 + (i % 3) * 0.07,
  tiltX: 64 + i * 7,
  tiltZ: -70 + i * 31,
  speed: 0.18 + i * 0.04,
  phase: i * 0.17,
  sweep: 1,
  hue: (i * 58 + 340) % 360,
  hueSpan: 80,
  width: 0.05 + (i % 3) * 0.015,
}));

export const SWIRL_RINGS: RingSpec[] = [
  { a: 1.36, tiltX: 74, tiltZ: -8, speed: 0.55, phase: 0, sweep: 0.86, hue: 20, hueSpan: 70, width: 0.06 },
  { a: 1.22, tiltX: 66, tiltZ: 62, speed: 0.7, phase: 0.33, sweep: 0.8, hue: 120, hueSpan: 70, width: 0.055 },
  { a: 1.3, tiltX: 70, tiltZ: -58, speed: 0.62, phase: 0.66, sweep: 0.8, hue: 210, hueSpan: 70, width: 0.05 },
];

/** A rounded bar standing at x from y0 (top) to y1 (bottom), `w` wide (R), as polygon points. */
function barPoints(x: number, y0: number, y1: number, w: number, count = 20): Point[] {
  const r = w / 2;
  const long = Math.max(0, (y1 - y0) / 2 - r);
  const cy = (y0 + y1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    return [x + px, cy + py + (py >= 0 ? long : -long)] as Point;
  });
}

/** The exclamation mark above the body's right shoulder: a bar and a dot, in the body's colour. */
export const EXCLAIM = { x: 0.94, barTop: -1.9, barBottom: -1.26, width: 0.2, dotY: -0.99, dotR: 0.11 } as const;

function exclamation(opacity: number): { marks: Mark[]; dots: BodyDot[] } {
  return {
    marks: [{ points: barPoints(EXCLAIM.x, EXCLAIM.barTop, EXCLAIM.barBottom, EXCLAIM.width), opacity }],
    dots: [{ x: EXCLAIM.x, y: EXCLAIM.dotY, r: EXCLAIM.dotR, opacity }],
  };
}

/** Three thought dots rising to the upper right, R units. */
export const THOUGHT_DOTS: readonly { x: number; y: number; r: number }[] = [
  { x: 1.02, y: -0.84, r: 0.09 },
  { x: 1.3, y: -1.12, r: 0.12 },
  { x: 1.62, y: -1.44, r: 0.155 },
];

/** The eyes shut (the sleep): the neutral capsule closed to a line. */
const SHUT = { w: 0.26, h: 0.46, tilt: 0, open: 0.06 } as const;
const WIDE = { w: 0.3, h: 0.56, tilt: 0, open: 1 } as const;

/** A move's pose `u` seconds in. `d` is its duration; `rest` is the body at rest, which a morph comes back to. */
export function moveAt(move: ShapeMove, at: number, rest: Radii = SHAPE_RADII.circle): MovePose {
  const d = MOVE_TIMING[move].duration;
  const u = Math.min(at, d);
  switch (move) {
    case "thinking": {
      // the body stays, looks up and away; three thought dots pulse one after the other
      const pulse = (k: number) => 0.5 + 0.5 * Math.sin(((u - k * 0.25) / 1.5) * Math.PI * 2 - Math.PI / 2);
      const dots = THOUGHT_DOTS.map((dot, k): BodyDot => ({ x: dot.x, y: dot.y, r: dot.r * (1 + 0.12 * pulse(k)), opacity: 0.5 + 0.5 * pulse(k) }));
      return { face: { yaw: 7, pitch: 9 }, scale: 1 + 0.025 * pulse(1), dots };
    }
    case "wink":
      return { face: { right: { w: 0.34, h: 0.09, tilt: -6, open: 1 }, roll: -10 } };
    case "wide":
      return { face: { left: { w: 0.27, h: 0.62, tilt: 0, open: 1 }, right: { w: 0.27, h: 0.62, tilt: 0, open: 1 }, split: 17, pitch: 2 }, scale: 1.02 };
    case "alert": {
      // the body rocks and hops, eyes wide; an exclamation mark pops up beside it
      const sway = Math.sin(u * Math.PI * 2 * 2.5) * 4 * (1 - clamp01(u / d) * 0.6);
      const hop = -0.07 * Math.abs(Math.sin(u * Math.PI * 1.25)) * (1 - clamp01(u / d) * 0.5);
      return { rot: sway, y: hop, face: { left: WIDE, right: WIDE, split: 17 }, ...exclamation(1) };
    }
    case "notify": {
      const pop = u < 0.45 ? 1.14 * easeOutQuint(u / 0.3) - Math.max(0, (u - 0.3) / 0.15) * 0.14 : 1;
      return { face: { left: { w: 0.42, h: 0.42, tilt: 0, open: 1 }, right: { w: 0.42, h: 0.42, tilt: 0, open: 1 }, split: 19 }, badge: { angle: 42, r: 0.17, scale: Math.max(0, pop) } };
    }
    case "exclaim":
      // a startled jump, eyes round; the exclamation mark beside the body
      return { y: -0.06 * Math.max(0, Math.sin(u * Math.PI * 2)), scale: 1 + 0.03 * Math.max(0, Math.sin(u * Math.PI * 2)), face: { left: { w: 0.4, h: 0.44, tilt: 0, open: 1 }, right: { w: 0.4, h: 0.44, tilt: 0, open: 1 }, split: 18, pitch: 3 }, ...exclamation(1) };
    case "sleep": {
      // eyes shut, a slow bob, two small dots drifting up like a snore
      const breath = Math.sin((u / 1.2) * Math.PI * 2);
      const rise = (u / 1.2) % 1;
      return {
        y: 0.05 * breath,
        scale: 1 - 0.015 * breath,
        face: { left: SHUT, right: SHUT, pitch: -8 },
        dots: [
          { x: 1.02, y: -0.85 - rise * 0.25, r: 0.06, opacity: 0.8 * (1 - rise) },
          { x: 1.26, y: -1.12 - rise * 0.25, r: 0.085, opacity: 0.6 * (1 - rise) },
        ],
      };
    }
    case "egg":
      return { radii: MOVE_RADII.egg, y: -0.02 };
    case "hexagon":
      return { radii: MOVE_RADII.hexagon };
    case "play": {
      const slide = (u / d) * 1.3;
      return { radii: MOVE_RADII.triangle, rot: -8, ribbons: ribbons([1.35, -0.7], [-1.55, 0.42], -0.32, 4, 0.075, 280, 1, 0.7, -0.35 + slide, 0.055) };
    }
    case "orbit": {
      const spinFor = d - 1.1;
      const rot = u < spinFor ? 360 * 1.25 * u : 360 * 1.25 * spinFor;
      const settle = clamp01((u - spinFor) / 0.6);
      // the spinning triangle settles back into this body's own outline, never a circle
      const radii = settle < 1 ? blendRadii(MOVE_RADII.triangle, rest, easeOutQuint(settle)) : undefined;
      return { ...(radii ? { radii } : {}), rot: rot * (1 - easeOutQuint(settle)), rings: ORBIT_RINGS.map((spec) => ({ spec, opacity: 1 - settle })) };
    }
    case "swirl": {
      const fade = 1 - clamp01((u - d * 0.55) / (d * 0.45));
      return { rings: SWIRL_RINGS.map((spec) => ({ spec, opacity: fade })) };
    }
    case "burst": {
      const back = 1.85;
      const specks: Speck[] = Array.from({ length: 5 }, (_, i) => {
        const k = clamp01(u / 1.6);
        const reach = 0.75 * (1 - easeInOut(k)) + 0.2;
        const turn = i * ((Math.PI * 2) / 5) + k * Math.PI * 2.2;
        return { x: Math.sin(turn) * reach, y: -Math.cos(turn) * reach, r: 0.05, opacity: u < 1.7 ? clamp01(u / 0.2) : clamp01((back - u) / 0.15) };
      });
      // the body squeezes down while the specks fly, then springs back from 1.4 s
      const squeeze = easeInOut(clamp01(u / 0.4));
      const grow = easeOutQuint((u - 1.4) / 0.35);
      const scale = lerp(lerp(1, 0.86, squeeze), 1, grow);
      return u < back ? { scale, face: { left: { w: 0.3, h: 0.3, tilt: 0, open: 1 }, right: { w: 0.3, h: 0.3, tilt: 0, open: 1 } }, specks } : { specks: [] };
    }
    case "comet": {
      const back = 2;
      if (u >= back) return {};
      // the body leans and drifts a little; the tail swings across behind it, one diagonal to the other
      const k = easeInOut(clamp01(u / 1.9));
      const x = lerp(-0.08, 0.12, k);
      const y = lerp(0.05, -0.05, k);
      const a = lerp(212, 148, k) * RAD;
      const reach = 0.95;
      const from: Point = [x + Math.cos(a) * reach, y + Math.sin(a) * reach * 0.8 - 0.16];
      const to: Point = [x - Math.cos(a) * reach * 0.75, y - Math.sin(a) * reach * 0.6 - 0.04];
      const fade = clamp01(u / 0.2) * clamp01((back - u) / 0.25);
      return { x, y, rot: lerp(-6, 6, k), face: { yaw: lerp(-8, 8, k), pitch: 4 }, ribbons: ribbons(from, to, -0.14, 4, 0.06, 300, fade, 1, 0, 0.08) };
    }
  }
}

/** How far a move shows at `u` s: slides in over its morph, holds for its whole duration, then slides back to rest over its morph. */
export function moveWeight(move: ShapeMove, u: number): number {
  const { duration, morph } = MOVE_TIMING[move];
  if (u < 0 || u > duration + morph) return 0;
  const enter = easeOutQuint(u / morph);
  const leave = u > duration ? 1 - easeOutQuint((u - duration) / morph) : 1;
  return Math.min(enter, leave);
}

/** How long a move shows in all, s (its duration, then the slide back). */
export const moveLength = (move: ShapeMove) => MOVE_TIMING[move].duration + MOVE_TIMING[move].morph;
