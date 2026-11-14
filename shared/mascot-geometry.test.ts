// The geometry file (shared/mascot-geometry.json) is the one source of the
// shapes: the set the app lists, the skins it offers and the faces the engine
// knows must be exactly what the file holds, so a shape, a skin or a face
// added anywhere else cannot exist, and one added to the file reaches every
// drawing (the web through shape-art.ts, the phone through the generated
// ShapeGeometryData.swift, checked by ios-mascot-export.test.ts).
import { describe, expect, it } from "vitest";
import geometry from "./mascot-geometry.json";
import { BODY_SHAPES, SHAPE_SKINS } from "./mascot-look";

const EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"];

describe("the shapes' geometry file", () => {
  it("names exactly the shapes the app lists, in the picker's order, each with 64 positive radii and a face anchor inside the body", () => {
    expect(Object.keys(geometry.shapes)).toEqual([...BODY_SHAPES]);
    for (const [shape, entry] of Object.entries(geometry.shapes)) {
      expect(entry.radii, shape).toHaveLength(geometry.radiiCount);
      expect(entry.radii.every((r) => Number.isFinite(r) && r > 0.3 && r < 1.4), shape).toBe(true);
      expect(entry.face, shape).toHaveLength(2);
      expect(Math.hypot(entry.face[0], entry.face[1]), `${shape} face anchor in the body`).toBeLessThan(Math.min(...entry.radii));
    }
    expect(geometry.radiiCount).toBe(64);
    expect(geometry.box).toEqual({ center: [50, 50], unit: 40 });
  });

  it("holds whole bodies for the moves, never a dot or a bar", () => {
    expect(Object.keys(geometry.moveBodies).sort()).toEqual(["egg", "hexagon", "triangle"]);
    for (const [name, radii] of Object.entries(geometry.moveBodies)) {
      expect(radii, name).toHaveLength(geometry.radiiCount);
      expect(Math.min(...radii), `${name} is a whole body`).toBeGreaterThan(0.5);
    }
  });

  it("names exactly the skins and the faces the app offers", () => {
    expect(Object.keys(geometry.skins)).toEqual([...SHAPE_SKINS]);
    expect(Object.keys(geometry.expressions)).toEqual(EXPRESSIONS);
    for (const [skin, rule] of Object.entries(geometry.skins)) {
      expect(typeof rule.strokeWidth, skin).toBe("number");
      expect(typeof rule.shine, skin).toBe("boolean");
      expect(typeof rule.fx, skin).toBe("string");
    }
    for (const [id, face] of Object.entries(geometry.expressions)) {
      for (const eye of [face.left, face.right]) {
        expect(eye.w, id).toBeGreaterThan(0);
        expect(eye.h, id).toBeGreaterThan(0);
        expect(eye.open, id).toBeGreaterThan(0);
      }
    }
  });
});
