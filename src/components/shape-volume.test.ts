// The shapes' pose and paint (shape-volume.ts, the phone's ShapeVolume.swift
// reference; the app draws the shapes with the engine since #4145): a pose
// that never shears a shape, the out-of-plane turn that keeps the top on
// top, the eyes' styles, one ground for every shape.
import { describe, expect, it } from "vitest";
import { BODY_SHAPES } from "../../shared/mascot-look";
import { stillFrame } from "./shape-engine";
import { eyeStyleFor, groundLift, inkPaint, poseMatrices, REST_POSE, styledEyes, uprightPose, volumeDetail, warpPath, EYE_INK, EYE_INK_ON_DARK } from "./shape-volume";

const nums = (m: string) => m.match(/-?\d*\.?\d+/g)!.map(Number);
const ys = (d: string) => {
  const n = nums(d);
  return n.filter((_, i) => i % 2 === 1);
};

describe("the pose", () => {
  it("turns and narrows a shape but never shears it", () => {
    for (const pose of [REST_POSE, { ...REST_POSE, yaw: 50, pitch: -20, roll: 10 }, { ...REST_POSE, yaw: -40, pitch: 25, roll: -30 }]) {
      const m = poseMatrices("full", pose);
      for (const t of [...m.slices, m.face]) {
        const [a, b, c, d] = nums(t);
        // the matrix's columns stay perpendicular: a rotation times a scale, no skew
        expect(Math.abs(a * c + b * d)).toBeLessThan(1e-3);
      }
    }
  });

  it("bends every outline with the resting turn only: a sway's yaw or pitch never keystones it", () => {
    const pebble = stillFrame({ shape: "bean", expression: "neutral", color: "#00a592" }).body;
    const rest = warpPath(pebble, REST_POSE);
    for (const yaw of [-50, 0, 50]) expect(warpPath(pebble, { ...REST_POSE, yaw, pitch: -yaw / 2 })).toBe(rest);
    const turned = ys(rest);
    expect(Math.max(...turned) - Math.min(...turned)).toBeGreaterThan(55);
    expect(uprightPose({ ...REST_POSE, yaw: 40, pitch: -20, roll: 9 })).toEqual({ ...REST_POSE, roll: 9 });
  });

  it("stands every shape on the same ground as the heart", () => {
    expect(groundLift("bean")).toBe(0);
    for (const shape of BODY_SHAPES) expect(Math.abs(groundLift(shape))).toBeLessThan(20);
  });

  it("draws fewer slices on small avatars", () => {
    expect(poseMatrices("tiny").slices.length).toBeLessThan(poseMatrices("full").slices.length);
    expect(volumeDetail(18)).toBe("tiny");
    expect(volumeDetail(36)).toBe("full");
  });
});

describe("paints and eyes", () => {
  it("one flat colour, opaque eyes: dark on light and coloured bodies, light on dark ones", () => {
    expect(inkPaint("#2a8fe8")).toMatchObject({ fill: "#2a8fe8", side: "#2a8fe8", eyes: EYE_INK, edge: null });
    expect(inkPaint("#f4f4f4").eyes).toBe(EYE_INK);
    expect(inkPaint("#f4f4f4").edge).not.toBeNull();
    // a white body's side is a little grey, not a hairline on every slice
    expect(inkPaint("#f4f4f4").side).not.toBe("#f4f4f4");
    expect(inkPaint("#0b0b0e").eyes).toBe(EYE_INK_ON_DARK);
  });

  it("draws ovals while busy and full arches when done, on the eyes' own boxes", () => {
    expect(eyeStyleFor("working")).toBe("oval");
    expect(eyeStyleFor("streaming")).toBe("oval");
    expect(eyeStyleFor("happy")).toBe("arc");
    expect(eyeStyleFor("idle")).toBe("capsule");
    const eyes = stillFrame({ shape: "circle", expression: "neutral", color: "#2a8fe8" }).eyes;
    expect(styledEyes(eyes, "capsule")).toBe(eyes);
    const ovals = styledEyes(eyes, "oval");
    const arcs = styledEyes(eyes, "arc");
    expect((ovals.match(/M/g) ?? []).length).toBe(2);
    expect((arcs.match(/M/g) ?? []).length).toBe(2);
    expect(arcs).toMatch(/A[^A]*A/);
  });
});
