// The shapes' motion library (2026-10-18): our own, written for our
// shapes. Every mood is a few slow, smooth loops on the body's 3D pose (yaw,
// pitch, roll around the resting pose of shape-volume.ts), a breath and a
// small lift; the face, the blinks and the gaze stay in shape-engine.ts.
//
// - At rest (settle 1) a shape sits on its base: it holds a pose still, then
//   turns to a new one over GLANCE.move s and holds it, and breathes from the
//   base; busy moods use continuous loops, each a sum of three sines of one
//   period (loopNoise), never repeating exactly and with no corner.
// - A change of mood slides every number over MOTION_BLEND s (smoothstep), so
//   a bot that starts working leans in instead of jumping.
// - A pointer near the mascot turns the whole body a little toward it
//   (TURN_TOWARD), eased; a click gives a quick squash-and-hop (POKE).
// - Every avatar has its own seed, so a sidebar of bots never moves in step.
// - Pure functions of time: the live loop, the tests and the headless bench
//   draw the same pose for the same t.
import { loopNoise, seededRandom } from "./shape-engine";
import { REST_POSE, type Pose } from "./shape-volume";

export const MOTION_MOODS = ["idle", "thinking", "working", "streaming", "done", "blocked", "sleeping"] as const;
export type MotionMood = (typeof MOTION_MOODS)[number];

/** One mood's motion: the sway (degrees, and the loops' periods in s), where the pose leans (degrees), the breath and the lift. */
export interface MotionSpec {
  sway: { yaw: number; pitch: number; roll: number };
  period: { yaw: number; pitch: number; roll: number };
  lean: { yaw: number; pitch: number; roll: number };
  /** The breath: how much the body swells (fraction) and its period (s). */
  breath: { amount: number; period: number };
  /** A bob up and down (box units) and its period (s). */
  bob: { amount: number; period: number };
  /**
   * How much of the sway is "settle and glance" (1) rather than a continuous
   * loop (0): at rest a shape sits still on its base, then now and then turns
   * to a new pose and holds it, instead of drifting all the time.
   */
  settle: number;
}

const spec = (sway: [number, number, number], period: [number, number, number], lean: [number, number, number], breath: [number, number], bob: [number, number], settle = 0): MotionSpec => ({
  sway: { yaw: sway[0], pitch: sway[1], roll: sway[2] },
  period: { yaw: period[0], pitch: period[1], roll: period[2] },
  lean: { yaw: lean[0], pitch: lean[1], roll: lean[2] },
  breath: { amount: breath[0], period: breath[1] },
  bob: { amount: bob[0], period: bob[1] },
  settle,
});

/** The library. Numbers chosen by eye on our own shapes. */
export const MOTIONS: Readonly<Record<MotionMood, MotionSpec>> = {
  // a slow, easy sway, as if floating
  idle: spec([52, 22, 7], [7.4, 5.3, 9.1], [0, 0, 2], [0.007, 3.6], [0, 3.6], 1),
  // looks up and away, turning slowly as if weighing something
  thinking: spec([8, 5, 6], [9.4, 7.2, 11.3], [-16, 9, 6], [0.012, 4.4], [0, 4.4], 1),
  // leans in, a quicker busy rhythm
  working: spec([34, 14, 6], [2.4, 1.7, 3.1], [-6, -4, 2], [0.012, 1.6], [1.2, 0.8]),
  // a light nod on each beat while it answers live
  streaming: spec([4, 7, 2], [3.2, 0.9, 4.1], [3, 2, 0], [0.01, 1.8], [1, 0.9]),
  // pleased: looks up, bouncy
  done: spec([30, 14, 6], [4.2, 2.6, 5.4], [-10, 8, 2], [0.018, 1.3], [2.4, 1.3]),
  // stops and faces the person, a small insistent side to side
  blocked: spec([3, 1.5, 6], [1.9, 3.3, 1.1], [-20, -10, 8], [0.006, 2.4], [0.4, 2.4]),
  // barely moving, head down
  sleeping: spec([2, 2, 1.5], [12, 9.5, 14], [-6, -14, 4], [0.024, 5.6], [0, 5.6], 1),
};

/** How far the body may turn in the picture plane (degrees), softly. */
export const ROLL_LIMIT = { min: -32, max: 10 } as const;

/** A value kept inside [min, max] with a smooth knee (no corner when it reaches a limit). */
export function softLimit(v: number, min: number, max: number): number {
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  return mid + half * Math.tanh((v - mid) / half);
}

/** How far the base sits below the box's middle (box units, before the scale): the breath grows from there. */
export const BASE_DROP = 40;
/** Settle and glance: a held pose lasts hold.min..hold.max s, then the shape turns to the next one over move s. */
export const GLANCE = { hold: { min: 2.2, max: 5.4 }, move: 0.9 } as const;

/** How long a change of mood slides, s. */
export const MOTION_BLEND = 0.7;
/** How far the body turns toward a pointer at the edge of its reach (degrees) and how long that eases (s). */
export const TURN_TOWARD = { yaw: 10, pitch: 8, settle: 0.6 } as const;
/** A click: squash, then a hop (box units), over this long (s). */
export const POKE = { length: 0.55, squash: 0.08, hop: 5, spin: 8 } as const;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

function mixSpec(a: MotionSpec, b: MotionSpec, t: number): MotionSpec {
  const m = (x: number, y: number) => x + (y - x) * t;
  const mix3 = (x: MotionSpec["sway"], y: MotionSpec["sway"]) => ({ yaw: m(x.yaw, y.yaw), pitch: m(x.pitch, y.pitch), roll: m(x.roll, y.roll) });
  return {
    sway: mix3(a.sway, b.sway),
    period: mix3(a.period, b.period),
    lean: mix3(a.lean, b.lean),
    breath: { amount: m(a.breath.amount, b.breath.amount), period: m(a.breath.period, b.breath.period) },
    bob: { amount: m(a.bob.amount, b.bob.amount), period: m(a.bob.period, b.bob.period) },
    settle: m(a.settle, b.settle),
  };
}

/**
 * The phase of a loop whose period may slide: the phase is integrated over
 * time (not t / period), so a change of period never makes the body jump.
 */
class Phase {
  value = 0;
  private last: number | null = null;
  step(t: number, period: number): number {
    if (this.last !== null) this.value += Math.max(0, t - this.last) / Math.max(0.2, period);
    this.last = t;
    return this.value;
  }
}

/** The pose at a phase (in cycles) of a mood, with a seed: pure, for tests and the still sidebar. */
export function poseAt(motion: MotionSpec, phase: { yaw: number; pitch: number; roll: number; breath: number; bob: number }, seed: number, glance: { yaw: number; pitch: number; roll: number } = { yaw: 0, pitch: 0, roll: 0 }): Pose {
  const n = (p: number, s: number) => loopNoise(p, 1, s);
  const w = motion.settle;
  const swing = (loop: number, held: number) => loop * (1 - w) + held * w;
  const breath = 1 + motion.breath.amount * Math.sin(phase.breath * Math.PI * 2);
  return {
    yaw: REST_POSE.yaw + motion.lean.yaw + motion.sway.yaw * swing(n(phase.yaw, seed), glance.yaw),
    pitch: REST_POSE.pitch + motion.lean.pitch + motion.sway.pitch * swing(n(phase.pitch, seed * 1.7 + 0.4), glance.pitch),
    roll: REST_POSE.roll + motion.lean.roll + motion.sway.roll * swing(n(phase.roll, seed * 2.3 + 1.1), glance.roll),
    scale: REST_POSE.scale * breath,
    // the breath swells from the base: the bottom stays on its ground, only the top rises
    lift: REST_POSE.lift - motion.bob.amount * (0.5 - 0.5 * Math.cos(phase.bob * Math.PI * 2)) - (breath - 1) * REST_POSE.scale * BASE_DROP,
  };
}

/** One avatar's motion: its mood (sliding), the pointer's pull and a click, on one clock (s). */
export class ShapeMotion {
  private from: MotionSpec;
  private to: MotionSpec;
  private at = -Infinity;
  private mood: MotionMood;
  private readonly phases = { yaw: new Phase(), pitch: new Phase(), roll: new Phase(), breath: new Phase(), bob: new Phase() };
  private turn = { yaw: 0, pitch: 0 };
  private target = { yaw: 0, pitch: 0 };
  private poke = -Infinity;
  private last: number | null = null;
  private readonly glanceRandom: () => number;
  private glanceFrom = { yaw: 0, pitch: 0, roll: 0 };
  private glanceTo = { yaw: 0, pitch: 0, roll: 0 };
  private glanceAt = -Infinity;
  private nextGlance: number;

  constructor(mood: MotionMood, readonly seed: number, start = 0) {
    this.mood = mood;
    this.from = MOTIONS[mood];
    this.to = MOTIONS[mood];
    // each avatar starts somewhere else in its cycles, so a row of them never moves in step
    const random = seededRandom(seed + 3.1);
    for (const phase of Object.values(this.phases)) phase.value = random() * 10;
    this.last = start;
    this.glanceRandom = seededRandom(seed + 7.7);
    this.glanceTo = this.pickGlance();
    this.glanceFrom = this.glanceTo;
    this.nextGlance = start + GLANCE.hold.min + this.glanceRandom() * (GLANCE.hold.max - GLANCE.hold.min);
  }

  setMood(mood: MotionMood, now: number): void {
    if (mood === this.mood) return;
    this.from = this.specAt(now);
    this.to = MOTIONS[mood];
    this.at = now;
    this.mood = mood;
  }

  /** The pointer around the mascot (-1..1 each axis), or null. */
  pointer(at: { x: number; y: number } | null): void {
    this.target = at ? { yaw: TURN_TOWARD.yaw * Math.max(-1, Math.min(1, at.x)), pitch: -TURN_TOWARD.pitch * Math.max(-1, Math.min(1, at.y)) } : { yaw: 0, pitch: 0 };
  }

  pokeAt(now: number): void {
    this.poke = now;
  }

  /** A new held pose: anywhere in the sway's reach, never too close to the last one. */
  private pickGlance(): { yaw: number; pitch: number; roll: number } {
    const r = () => this.glanceRandom() * 2 - 1;
    let next = { yaw: r(), pitch: r(), roll: r() };
    for (let i = 0; i < 4 && Math.abs(next.yaw - this.glanceTo.yaw) < 0.5; i += 1) next = { yaw: r(), pitch: r(), roll: r() };
    return next;
  }

  private glanceNow(now: number): { yaw: number; pitch: number; roll: number } {
    if (now >= this.nextGlance) {
      this.glanceFrom = this.glanceNowAt(now);
      this.glanceTo = this.pickGlance();
      this.glanceAt = now;
      this.nextGlance = now + GLANCE.move + GLANCE.hold.min + this.glanceRandom() * (GLANCE.hold.max - GLANCE.hold.min);
    }
    return this.glanceNowAt(now);
  }

  private glanceNowAt(now: number): { yaw: number; pitch: number; roll: number } {
    const u = Math.min(1, Math.max(0, (now - this.glanceAt) / GLANCE.move));
    // smootherstep: leaves and lands with no jolt, then holds still
    const k = u * u * u * (u * (u * 6 - 15) + 10);
    const m = (a: number, b: number) => a + (b - a) * k;
    return { yaw: m(this.glanceFrom.yaw, this.glanceTo.yaw), pitch: m(this.glanceFrom.pitch, this.glanceTo.pitch), roll: m(this.glanceFrom.roll, this.glanceTo.roll) };
  }

  private specAt(now: number): MotionSpec {
    const k = smooth((now - this.at) / MOTION_BLEND);
    return k >= 1 ? this.to : mixSpec(this.from, this.to, k);
  }

  pose(now: number): Pose {
    const dt = this.last === null ? 0 : Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    const motion = this.specAt(now);
    const phase = {
      yaw: this.phases.yaw.step(now, motion.period.yaw),
      pitch: this.phases.pitch.step(now, motion.period.pitch),
      roll: this.phases.roll.step(now, motion.period.roll),
      breath: this.phases.breath.step(now, motion.breath.period),
      bob: this.phases.bob.step(now, motion.bob.period),
    };
    const k = 1 - Math.exp((-dt * 4.6) / TURN_TOWARD.settle);
    this.turn.yaw += (this.target.yaw - this.turn.yaw) * k;
    this.turn.pitch += (this.target.pitch - this.turn.pitch) * k;
    const pose = poseAt(motion, phase, this.seed, this.glanceNow(now));
    // a shape stays upright enough to read at every moment: the turn in the picture
    // plane eases into its limits instead of tipping the shape over
    pose.roll = softLimit(pose.roll, ROLL_LIMIT.min, ROLL_LIMIT.max);
    pose.yaw += this.turn.yaw;
    pose.pitch += this.turn.pitch;
    const u = (now - this.poke) / POKE.length;
    if (u >= 0 && u <= 1) {
      // squash on the way down, a hop and a little spin, then settle
      const squash = Math.sin(Math.min(1, u * 3) * Math.PI) * (u < 0.33 ? 1 : 0);
      const hop = u > 0.25 ? Math.sin(((u - 0.25) / 0.75) * Math.PI) : 0;
      pose.scale *= 1 - POKE.squash * squash;
      pose.lift -= POKE.hop * hop;
      pose.roll += POKE.spin * hop;
    }
    return pose;
  }
}

/** The motion mood for a shape mood (ShapeMascot's moods map onto the library). */
export function motionForMood(mood: string): MotionMood {
  switch (mood) {
    case "thinking":
      return "thinking";
    case "working":
      return "working";
    case "streaming":
      return "streaming";
    case "happy":
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "sleeping":
      return "sleeping";
    default:
      return "idle";
  }
}
