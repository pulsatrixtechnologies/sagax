// The shapes' pose and paint (shape-volume.ts) and how ShapeFrameSvg draws
// them: vectors only, a pose that never shears a shape, the out-of-plane turn
// that keeps the top on top, the eyes' styles, one ground for every shape.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, SHAPE_SKINS } from "../../shared/mascot-look";
import { ShapeFrameSvg, ShapeMascot, shapeSkinPaint } from "./ShapeMascot";
import { SHAPE_ART } from "./shape-art";
import { stillFrame } from "./shape-engine";
import { shapeSkinLayers } from "./skin-fx/shape-skins";
import { eyeStyleFor, groundLift, inkPaint, poseMatrices, REST_POSE, styledEyes, volumeDetail, warpPath, EYE_INK, EYE_INK_ON_DARK } from "./shape-volume";

const draw = (props: Record<string, unknown>) => renderToStaticMarkup(h(ShapeMascot, { color: "blue", animated: false, ...props } as never));
const nums = (m: string) => m.match(/-?\d*\.?\d+/g)!.map(Number);
const ys = (d: string) => {
  const n = nums(d);
  return n.filter((_, i) => i % 2 === 1);
};

describe("the pose", () => {
  it("turns and narrows a shape but never shears it", () => {
    for (const pose of [REST_POSE, { ...REST_POSE, yaw: 50, pitch: -20, roll: 10 }, { ...REST_POSE, yaw: -40, pitch: 25, roll: -30 }]) {
      const m = poseMatrices("full", pose);
      for (const t of [...m.slices, m.face, m.eyes]) {
        const [a, b, c, d] = nums(t);
        // the matrix's columns stay perpendicular: a rotation times a scale, no skew
        expect(Math.abs(a * c + b * d)).toBeLessThan(1e-3);
      }
    }
  });

  it("keeps a heart's lobes on top when it turns out of the picture plane", () => {
    const heart = stillFrame({ shape: "bean", expression: "neutral", color: "#00a592" }).body;
    for (const yaw of [-50, 0, 50]) {
      const turned = ys(warpPath(heart, { ...REST_POSE, yaw, roll: 0 }));
      const top = Math.min(...turned);
      const bottom = Math.max(...turned);
      // the lobes (top) stay above the point (bottom), whatever the turn
      expect(bottom - top).toBeGreaterThan(55);
    }
  });

  it("stands every shape on the same ground as the heart", () => {
    expect(groundLift("bean")).toBe(0);
    for (const shape of MASCOT_SHAPES) expect(Math.abs(groundLift(shape))).toBeLessThan(20);
  });

  it("draws fewer slices on small avatars", () => {
    expect(poseMatrices("tiny").slices.length).toBeLessThan(poseMatrices("full").slices.length);
    expect(volumeDetail(18)).toBe("tiny");
    expect(volumeDetail(36)).toBe("full");
  });
});

describe("paints and eyes", () => {
  it("one flat colour, opaque eyes: dark on light and coloured bodies, light on dark ones", () => {
    expect(inkPaint("#2a8fe8")).toMatchObject({ fill: "#2a8fe8", eyes: EYE_INK, edge: null });
    expect(inkPaint("#f4f4f4").eyes).toBe(EYE_INK);
    expect(inkPaint("#f4f4f4").edge).not.toBeNull();
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

describe("the drawing", () => {
  it("is vectors only at every size: no image, no filter", () => {
    for (const size of [16, 24, 40, 56, 102]) {
      for (const skin of SHAPE_SKINS) {
        const html = draw({ size, skin, shape: "hexagon" });
        expect(html).not.toMatch(/<image|<foreignObject|filter=|feGaussianBlur/);
      }
    }
  });

  it("draws one outline turned into slices, a face, and opaque eyes on top", () => {
    const html = draw({ size: 56, shape: "cloud" });
    expect(html).toContain('data-volume="full"');
    // one outline in the defs (shared by the slices) and the face's own fill
    expect((html.match(/data-shape-outline=""/g) ?? []).length).toBe(2);
    expect((html.match(/<use href="#[^"]+-outline"/g) ?? []).length).toBeGreaterThan(3);
    expect((html.match(/data-pose-slice=/g) ?? []).length).toBeGreaterThan(3);
    expect(html).toContain("data-pose-face");
    expect(html).toMatch(/data-shape-eyes=""/);
    expect(html).not.toContain("Gradient id");
  });

  it("keeps the Outline skin flat", () => {
    const html = draw({ size: 56, skin: "outline" });
    expect(html).toContain('data-volume="flat"');
    expect(html).not.toContain("data-pose-slice");
  });

  it("draws a move's badge under the same pose as its notch", () => {
    const frame = { ...stillFrame({ shape: "circle", expression: "neutral", color: "#2a8fe8" }), badge: { x: 72, y: 30, r: 8, notch: 2 } };
    const paint = shapeSkinPaint("plain", "#2a8fe8");
    const html = renderToStaticMarkup(h(ShapeFrameSvg, { frame, uid: "t", skin: "plain", paint, layers: shapeSkinLayers("plain", SHAPE_ART.circle.d, "#2a8fe8", "t", true), size: 56 }));
    const view = html.slice(html.indexOf("data-shape-view"));
    expect(view).toContain('mask="url(#t-notch)"');
    expect(view).toContain('fill="#2a8fe8"');
  });
});
