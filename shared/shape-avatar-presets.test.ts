import { describe, expect, it } from "vitest";
import { validateShapeAvatarDef } from "./shape-avatar-def.ts";
import {
  OBJECT_SHAPE_IDS,
  OBJECT_SHAPE_PRESETS,
  shapeAvatarStillSvg,
} from "./shape-avatar-presets.ts";
import { generateShapeAvatarDef, matchObjectShapePreset } from "./shape-avatar-generate.ts";

describe("object Shape presets", () => {
  it("ships at least eight validated definitions with slug ids", () => {
    expect(OBJECT_SHAPE_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect([...OBJECT_SHAPE_IDS]).toEqual(OBJECT_SHAPE_PRESETS.map((preset) => preset.id));
    for (const preset of OBJECT_SHAPE_PRESETS) {
      const result = validateShapeAvatarDef(preset);
      expect(result.ok, preset.id).toBe(true);
      expect(preset.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(preset.id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it("exports a still SVG with two pill eyes and no GUID", () => {
    const svg = shapeAvatarStillSvg(OBJECT_SHAPE_PRESETS[0]!, "#3b82f6", { size: 96 });
    expect(svg).toContain("<svg");
    expect(svg.match(/<rect /g)?.length).toBe(2);
    expect(svg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });
});

describe("generateShapeAvatarDef", () => {
  it("matches object words and stays valid", () => {
    expect(matchObjectShapePreset("coffee mug")).toBe("cup");
    expect(validateShapeAvatarDef(generateShapeAvatarDef("coffee mug")).ok).toBe(true);
  });
});
