import { describe, expect, it } from "vitest";
import { sameOgreShapes, writeOgreTransforms } from "./OgreMascot";
import { drawShape, REST_POSE, writeShape } from "./shape-volume";
import { ogreFrameLayers, restFrame } from "./ogre-rig";
import { stillFrame } from "./shape-engine";

/** A stand-in svg: elements found by attribute, with their attribute writes. */
function fakeSvg(elements: Record<string, Array<Record<string, string>>>) {
  const wrap = (attrs: Record<string, string>) => ({
    getAttribute: (name: string) => attrs[name] ?? null,
    setAttribute: (name: string, value: string) => { attrs[name] = value; },
    removeAttribute: (name: string) => { delete attrs[name]; },
  });
  return {
    querySelectorAll: (selector: string) => (elements[selector.slice(1, -1)] ?? []).map(wrap),
  } as unknown as SVGSVGElement;
}

describe("Ogre's rig writes a frame that only moves parts straight onto the drawing", () => {
  it("a turn of the head keeps the shapes: only transforms change", () => {
    const rest = restFrame("rest", "neutral");
    const a = ogreFrameLayers(rest, { size: 96 });
    const b = ogreFrameLayers({ ...rest, head: { ...rest.head, rot: 6 }, look: 0.4 }, { size: 96 });
    expect(sameOgreShapes(a, b)).toBe(true);
    const groups = a.flatMap(function all(layer): Array<Record<string, string>> {
      return [{ "data-ogre-layer": layer.key }, ...(layer.children ?? []).flatMap(all)];
    });
    writeOgreTransforms(fakeSvg({ "data-ogre-layer": groups }), b);
    expect(groups.find((group) => group["data-ogre-layer"] === "head")?.transform).toContain("rotate(6)");
    expect(groups.find((group) => group["data-ogre-layer"] === "face")?.transform).toContain("translate(");
    expect(groups.find((group) => group["data-ogre-layer"] === "log")?.transform).toBeUndefined();
  });

  it("a new face draws through React", () => {
    const a = ogreFrameLayers(restFrame("rest", "neutral"), { size: 96 });
    const b = ogreFrameLayers(restFrame("rest", "happy"), { size: 96 });
    expect(sameOgreShapes(a, b)).toBe(false);
  });
});

// the phone's reference drawing (shape-volume.ts, ShapeVolume.swift); the app draws the shapes with the engine since #4145
describe("a shape's idle frame goes straight onto its drawing", () => {
  const still = stillFrame({ shape: "circle", expression: "neutral", color: "#3fb950" });

  it("writes the outline, the eyes, the transform and the light: one drawing, every part", () => {
    const moved = { ...still, transform: "translate(1 2)", light: { x: 30, y: 20, r: 70 } };
    const cuts = [{}, {}] as Array<Record<string, string>>;
    const faces = [{}] as Array<Record<string, string>>;
    const eyes = [{}] as Array<Record<string, string>>;
    const motion = [{}] as Array<Record<string, string>>;
    const light = [{}] as Array<Record<string, string>>;
    const drawing = drawShape(moved, REST_POSE, "full");
    writeShape(fakeSvg({ "data-shape-cut": cuts, "data-shape-face": faces, "data-shape-eyes": eyes, "data-shape-motion": motion, "data-shape-light": light }), drawing);
    expect(cuts.every((path) => path.d === moved.body + moved.eyes)).toBe(true);
    expect(faces[0].d).toBe(drawing.outline);
    expect(eyes[0].d).toBe(drawing.eyes);
    expect(motion[0].transform).toBe("translate(1 2)");
    expect(light[0]).toEqual({ cx: "30", cy: "20", r: "70" });
  });
});
