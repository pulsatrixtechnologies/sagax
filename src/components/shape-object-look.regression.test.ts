/**
 * Blocking guard for the object mascots' look (2026-11-09). #2986 redrew the
 * sprout (two lobes, trapezoid pot, eyes sunk at the bottom) and blew up the
 * say bubble, and the gallery references were regenerated with the bad art.
 * This pins each object preset's face and outline box to the approved look,
 * and checks a saved look carrying a stale copy of a preset follows the preset.
 */
import { describe, expect, it } from "vitest";
import { avatarDefForShape } from "./ShapeMascot";
import { stillFrame } from "./shape-engine";
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import type { ShapeAvatarDef } from "../../shared/shape-avatar-def";

type Box = [number, number, number, number];
const OBJECTS = ["pad", "cup", "bulb", "say", "sprout", "tin", "tome", "ship"] as const;

/** Neutral eye boxes (x, y, w, h), same values as the iOS golden test. */
const EYES: Record<(typeof OBJECTS)[number], [Box, Box]> = {
  pad: [[38.033, 45.423, 9.2, 18.768], [61.967, 45.423, 9.2, 18.768]],
  cup: [[33.4, 48.109, 9.2, 18.768], [54.861, 48.109, 9.2, 18.768]],
  bulb: [[38.474, 35.423, 9.2, 18.768], [61.526, 35.423, 9.2, 18.768]],
  say: [[36.817, 39.423, 9.2, 18.768], [63.183, 39.423, 9.2, 18.768]],
  sprout: [[40.065, 73.423, 9.2, 18.768], [59.935, 73.423, 9.2, 18.768]],
  tin: [[44.008, 51.423, 7.452, 15.202], [55.992, 51.423, 7.452, 15.202]],
  tome: [[47.116, 47.423, 9.2, 18.768], [72.884, 47.423, 9.2, 18.768]],
  ship: [[0, 0, 0, 0], [0, 0, 0, 0]],
};

/** Outline bounds of the path's points (minX, minY, maxX, maxY). */
function outline(def: ShapeAvatarDef): Box {
  const d = def.body.kind === "path" ? def.body.d : "";
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Approved silhouettes: say is a bubble 6..94 x 14..92, sprout a V of leaves on a round pot. */
const OUTLINE: Partial<Record<(typeof OBJECTS)[number], Box>> = {
  say: [6, 14, 94, 92],
};

describe("object mascots keep their approved look", () => {
  for (const shape of OBJECTS) {
    it(`${shape}: eyes sit where the approved art puts them, inside the box`, () => {
      const def = avatarDefForShape(shape)!;
      const eyes = stillFrame({ shape, expression: "neutral", color: "#000000", avatarDef: def }).eyeShapes;
      expect(eyes).toHaveLength(2);
      for (const e of eyes) {
        expect(e.x - e.w / 2).toBeGreaterThanOrEqual(0);
        expect(e.x + e.w / 2).toBeLessThanOrEqual(100);
        expect(e.y - e.h / 2).toBeGreaterThanOrEqual(0);
        expect(e.y + e.h / 2).toBeLessThanOrEqual(100);
      }
      if (shape === "ship") return;
      eyes.forEach((e, i) => {
        const [x, y, w, h] = EYES[shape][i];
        expect([e.x, e.y, e.w, e.h].map((v) => +v.toFixed(3))).toEqual([x, y, w, h]);
      });
      const [minX, minY, maxX, maxY] = outline(def);
      for (const e of eyes) {
        expect(e.x).toBeGreaterThan(minX);
        expect(e.x).toBeLessThan(maxX);
        expect(e.y).toBeGreaterThan(minY);
        expect(e.y).toBeLessThan(maxY);
      }
      if (OUTLINE[shape]) expect(outline(def)).toEqual(OUTLINE[shape]);
    });
  }

  it("sprout: leaves above a wide pot, eyes on the pot", () => {
    const def = OBJECT_SHAPE_BY_ID.sprout;
    const [minX, minY, maxX, maxY] = outline(def);
    expect(minY).toBeLessThanOrEqual(8);
    expect(maxY).toBe(100);
    expect(maxX - minX).toBeLessThanOrEqual(72);
    // The leaf dip sits at the centre top (V of leaves), not a single lobe tip at y 22.
    expect(def.body.kind === "path" && def.body.d).toMatch(/^M\d+ 50C/);
  });

  it("a saved copy of an object preset follows the current preset", () => {
    for (const shape of ["say", "sprout"] as const) {
      const stale: ShapeAvatarDef = { ...OBJECT_SHAPE_BY_ID[shape], body: { kind: "path", d: "M20 8L80 8L80 92L20 92Z" } };
      expect(avatarDefForShape(shape, stale)).toBe(OBJECT_SHAPE_BY_ID[shape]);
    }
    const custom: ShapeAvatarDef = { ...OBJECT_SHAPE_BY_ID.say, id: "custom-1" };
    expect(avatarDefForShape("say", custom)).toBe(custom);
  });
});
