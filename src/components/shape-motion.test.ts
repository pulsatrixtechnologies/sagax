// The shapes' motion library (shape-motion.ts): deterministic, a mood that
// slides, a rest that holds still between glances and breathes from the base,
// a turn that never tips a shape over.
import { describe, expect, it } from "vitest";
import { GLANCE, MOTION_BLEND, MOTION_MOODS, MOTIONS, ROLL_LIMIT, ShapeMotion, motionForMood, softLimit } from "./shape-motion";

const run = (mood: (typeof MOTION_MOODS)[number], seed: number, until: number, step = 1 / 30) => {
  const m = new ShapeMotion(mood, seed, 0);
  const poses = [];
  for (let t = 0; t <= until; t += step) poses.push({ t, ...m.pose(t) });
  return poses;
};

describe("the motion library", () => {
  it("has a spec for every mood and maps the app's moods onto it", () => {
    for (const mood of MOTION_MOODS) expect(MOTIONS[mood]).toBeDefined();
    expect(motionForMood("happy")).toBe("done");
    expect(motionForMood("working")).toBe("working");
    expect(motionForMood("anything")).toBe("idle");
  });

  it("is deterministic for a seed and different between seeds", () => {
    const a = run("idle", 4.2, 6);
    const b = run("idle", 4.2, 6);
    const c = run("idle", 9.1, 6);
    expect(a.map((p) => p.yaw)).toEqual(b.map((p) => p.yaw));
    expect(a.map((p) => p.yaw)).not.toEqual(c.map((p) => p.yaw));
  });

  it("at rest holds a pose still, then glances to a new one", () => {
    const poses = run("idle", 3.3, 20);
    // stretches where the turn does not move at all
    let still = 0;
    for (let i = 1; i < poses.length; i += 1) if (Math.abs(poses[i].yaw - poses[i - 1].yaw) < 1e-9) still += 1;
    expect(still / poses.length).toBeGreaterThan(0.5);
    // and real changes of pose within GLANCE.hold.max + move
    const yaws = poses.map((p) => p.yaw);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(10);
    expect(GLANCE.move).toBeLessThan(GLANCE.hold.min);
  });

  it("at rest breathes from the base: no bob, the lift only answers the breath", () => {
    expect(MOTIONS.idle.bob.amount).toBe(0);
    const poses = run("idle", 1.7, 8);
    for (const p of poses) {
      // the bottom (base) stays put: a swell up is paired with a lift up of the same size
      const swell = p.scale / poses[0].scale - 1;
      expect(Math.abs(p.lift - poses[0].lift + swell * 40 * poses[0].scale)).toBeLessThan(0.2);
    }
  });

  it("never tips a shape over and slides between moods", () => {
    for (const mood of MOTION_MOODS) {
      for (const p of run(mood, 5.5, 12)) {
        expect(p.roll).toBeGreaterThanOrEqual(ROLL_LIMIT.min - 1e-9);
        expect(p.roll).toBeLessThanOrEqual(ROLL_LIMIT.max + 1e-9);
      }
    }
    expect(softLimit(1000, -10, 10)).toBeLessThanOrEqual(10);
    expect(softLimit(5, -10, 10)).toBeLessThan(5);
    const m = new ShapeMotion("idle", 2, 0);
    m.pose(1);
    m.setMood("working", 1);
    const a = m.pose(1 + 1 / 60);
    const b = m.pose(1 + 2 / 60);
    // no jump on the change itself
    expect(Math.abs(b.yaw - a.yaw)).toBeLessThan(2);
    expect(MOTION_BLEND).toBeGreaterThan(0.3);
  });

  it("a click squashes and hops, then settles", () => {
    const m = new ShapeMotion("idle", 2, 0);
    const before = m.pose(1);
    m.pokeAt(1);
    const mid = m.pose(1.3);
    const after = m.pose(2.5);
    expect(mid.lift).toBeLessThan(before.lift - 1);
    expect(Math.abs(after.lift - before.lift)).toBeLessThan(1);
  });
});
