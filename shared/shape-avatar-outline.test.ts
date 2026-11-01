import { describe, expect, it } from "vitest";
import {
  blendOutlines,
  flattenPath,
  liveOutlineFromDef,
  normalizeOutlineWinding,
  pointInsideOutline,
  rayRadiusOutline,
  resampleClosed,
  samplePathToOutline,
  smoothClosedOutline,
} from "./shape-avatar-outline.ts";
import { OBJECT_SHAPE_PRESETS } from "./shape-avatar-presets.ts";
import { validateShapeAvatarDef } from "./shape-avatar-def.ts";

describe("shape-avatar-outline", () => {
  it("flattens cubic and line commands into a closed ring", () => {
    const rings = flattenPath("M10 10 L90 10 L90 90 L10 90 Z");
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBeGreaterThanOrEqual(4);
    expect(pointInsideOutline(rings[0]!, 50, 50)).toBe(true);
    expect(pointInsideOutline(rings[0]!, 2, 2)).toBe(false);
  });

  it("resamples to a fixed count and blends without changing length", () => {
    const a = resampleClosed([[0, 0], [100, 0], [100, 100], [0, 100]], 64);
    const b = resampleClosed([[20, 20], [80, 20], [80, 80], [20, 80]], 64);
    expect(a).toHaveLength(64);
    expect(b).toHaveLength(64);
    const mid = blendOutlines(a, b, 0.5);
    expect(mid).toHaveLength(64);
    expect(mid[0]![0]).toBeGreaterThan(0);
  });

  it("keeps every object preset valid and path-bodied with eyes inside", () => {
    for (const preset of OBJECT_SHAPE_PRESETS) {
      const checked = validateShapeAvatarDef(preset);
      expect(checked.ok, preset.id).toBe(true);
      const live = liveOutlineFromDef(preset);
      expect(live.pathBody, preset.id).toBe(true);
      expect(live.points).toHaveLength(64);
      expect(live.path.length, preset.id).toBeGreaterThan(20);
      const [ax, ay] = live.face;
      expect(pointInsideOutline(live.points, ax, ay), `${preset.id} face`).toBe(true);
      const r = rayRadiusOutline(live.points, 0);
      expect(r, `${preset.id} up radius`).toBeGreaterThan(5);
    }
  });

  it("object presets keep appendages that stick past the body core", () => {
    const extent = (id: string) => {
      const live = liveOutlineFromDef(OBJECT_SHAPE_PRESETS.find((p) => p.id === id)!);
      const nums = [...live.path.matchAll(/(-?\d+\.?\d*)/g)].map((m) => Number(m[1]));
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), subs: (live.path.match(/M/g) || []).length };
    };
    expect(extent("cup").maxX).toBeGreaterThan(90);
    expect(extent("cup").subs).toBeGreaterThanOrEqual(2);
    expect(extent("pad").minX).toBeLessThan(12);
    expect(extent("pad").maxX).toBeGreaterThan(88);
    expect(extent("bulb").maxY).toBeGreaterThan(90);
    expect(extent("say").maxY).toBeGreaterThan(90);
    expect(extent("ship").minX).toBeLessThan(15);
    expect(extent("ship").maxX).toBeGreaterThan(85);
    expect(extent("tin").maxX).toBeGreaterThan(75);
    expect(extent("sprout").minY).toBeLessThan(12);
    expect(extent("tome").minX).toBeLessThan(20);
  });

  it("property: random valid rounded blobs keep eyes inside after resample", () => {
    for (let i = 0; i < 24; i += 1) {
      const cx = 40 + (i % 5) * 4;
      const cy = 40 + (i % 7) * 3;
      const rx = 18 + (i % 6) * 2;
      const ry = 20 + (i % 4) * 3;
      const d = [
        `M${cx} ${cy - ry}`,
        `C${cx + rx * 0.55} ${cy - ry} ${cx + rx} ${cy - ry * 0.55} ${cx + rx} ${cy}`,
        `C${cx + rx} ${cy + ry * 0.55} ${cx + rx * 0.55} ${cy + ry} ${cx} ${cy + ry}`,
        `C${cx - rx * 0.55} ${cy + ry} ${cx - rx} ${cy + ry * 0.55} ${cx - rx} ${cy}`,
        `C${cx - rx} ${cy - ry * 0.55} ${cx - rx * 0.55} ${cy - ry} ${cx} ${cy - ry}`,
        "Z",
      ].join("");
      const def = {
        schemaVersion: 1 as const,
        id: `blob${i}`,
        body: { kind: "path" as const, d },
        eyes: { anchor: [cx, cy - ry * 0.2] as [number, number], size: { w: 6, h: 12 }, shape: "pill" as const, gap: 12 },
      };
      expect(validateShapeAvatarDef(def).ok).toBe(true);
      const live = liveOutlineFromDef(def);
      expect(pointInsideOutline(live.points, def.eyes.anchor[0], def.eyes.anchor[1])).toBe(true);
      const path = smoothClosedOutline(live.points);
      expect(path.startsWith("M")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
    }
  });

  it("normalizes winding so sample 0 sits near the top", () => {
    const pts = normalizeOutlineWinding([
      [60, 60],
      [40, 60],
      [40, 40],
      [60, 40],
    ]);
    expect(pts[0]![1]).toBeLessThanOrEqual(Math.min(...pts.map((p) => p[1])) + 1e-6);
  });

  it("samples a path string for morphing", () => {
    const pts = samplePathToOutline("M20 50 C20 20 80 20 80 50 C80 80 20 80 20 50 Z");
    expect(pts).toHaveLength(64);
  });
});
