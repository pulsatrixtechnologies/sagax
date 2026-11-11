// #3624: the owl's steady motions moved from the pose (a script per frame)
// to CSS keyframes. The look must not change: every keyframe is the pose at
// that point of its cycle, and each cycle lasts what the pose's does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { OWL_BREATH_PERIOD_S, OWL_GEOM, OWL_WORKING_PERIOD_S, owlPose } from "./owl-art";

const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");

/** The keyframes of `name`: [fraction of the cycle, transform]. */
function keyframes(name: string): Array<[number, string]> {
  const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1];
  if (!block) throw new Error(`no @keyframes ${name}`);
  return [...block.matchAll(/([\d.]+)% \{ transform: ([^;]+); \}/g)].map((match) => [Number(match[1]) / 100, match[2]!]);
}

const numbers = (text: string) => [...text.matchAll(/-?[\d.]+/g)].map((match) => Number(match[0]));

describe("the owl's motions in CSS match its pose (#3624)", () => {
  it("lasts what the pose's cycles last", () => {
    expect(css).toMatch(/svg\[data-owl-motion="breath"\] \{\s*animation: owl-breathe 3\.4s linear/);
    expect(OWL_BREATH_PERIOD_S).toBe(3.4);
    expect(css).toMatch(/owl-working-bounce calc\(1s \/ 6\) linear/);
    expect(css).toMatch(/owl-working-wing calc\(1s \/ 6\) linear/);
    expect(OWL_WORKING_PERIOD_S).toBe(1 / 6);
    // the pose repeats on those cycles
    for (const t of [0.013, 0.07, 0.11]) {
      expect(owlPose("idle", t + OWL_BREATH_PERIOD_S).sy).toBeCloseTo(owlPose("idle", t).sy, 9);
      expect(owlPose("working", t + OWL_WORKING_PERIOD_S).wing).toBeCloseTo(owlPose("working", t).wing, 9);
      expect(owlPose("working", t + OWL_WORKING_PERIOD_S).y).toBeCloseTo(owlPose("working", t).y, 9);
    }
  });

  it("breathes as the resting pose does", () => {
    const frames = keyframes("owl-breathe");
    expect(frames.length).toBeGreaterThanOrEqual(24);
    for (const [at, transform] of frames) {
      const [sx, sy] = numbers(transform);
      expect(sx).toBe(1);
      expect(sy).toBeCloseTo(owlPose("idle", at * OWL_BREATH_PERIOD_S).sy, 4);
    }
  });

  it("bounces as the working pose does, in the svg's own box (256 units)", () => {
    for (const [at, transform] of keyframes("owl-working-bounce")) {
      const [percent] = numbers(transform);
      expect((percent! / 100) * 256).toBeCloseTo(owlPose("working", at * OWL_WORKING_PERIOD_S).y, 2);
    }
  });

  it("flaps the wing as the working pose does, about the shoulder", () => {
    const { x, y } = OWL_GEOM.pivots.shoulder;
    for (const [at, transform] of keyframes("owl-working-wing")) {
      const [tx, ty, deg, bx, by] = numbers(transform);
      expect([tx, ty, bx, by]).toEqual([x, y, -x, -y]);
      expect(deg).toBeCloseTo(owlPose("working", at * OWL_WORKING_PERIOD_S).wing, 2);
    }
  });
});
