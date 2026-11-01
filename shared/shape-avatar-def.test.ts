import { describe, expect, it } from "vitest";
import {
  compileShapeAvatar,
  decodeShapeAvatarShare,
  defaultPillEyes,
  ellipsePath,
  encodeShapeAvatarShare,
  parseShapeAvatarPayload,
  pathCommandCount,
  roundedRectPath,
  SHAPE_AVATAR_LIMITS,
  SHAPE_AVATAR_SCHEMA_VERSION,
  validateShapeAvatarDef,
  type ShapeAvatarDef,
} from "./shape-avatar-def";

const validDef = (): ShapeAvatarDef => ({
  schemaVersion: SHAPE_AVATAR_SCHEMA_VERSION,
  id: "cup",
  name: "Cup",
  body: {
    kind: "parts",
    parts: [
      { type: "ellipse", cx: 48, cy: 52, rx: 22, ry: 26 },
      { type: "path", d: roundedRectPath(62, 40, 14, 22, 6) },
    ],
  },
  eyes: defaultPillEyes([48, 44]),
});

describe("validateShapeAvatarDef", () => {
  it("accepts a versioned parts body with pill eyes", () => {
    const result = validateShapeAvatarDef(validDef());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.def.id).toBe("cup");
      expect(result.def.body.kind).toBe("parts");
    }
  });

  it("accepts a closed path body and a radii body", () => {
    expect(validateShapeAvatarDef({
      schemaVersion: 1,
      body: { kind: "path", d: ellipsePath(50, 50, 30, 30) },
      eyes: defaultPillEyes(),
    }).ok).toBe(true);
    expect(validateShapeAvatarDef({
      schemaVersion: 1,
      body: { kind: "radii", radii: Array.from({ length: 64 }, () => 1) },
      eyes: defaultPillEyes(),
    }).ok).toBe(true);
  });

  it("refuses colour fields, scripts, open paths and GUID ids", () => {
    expect(validateShapeAvatarDef({ ...validDef(), color: "#f00" }).ok).toBe(false);
    expect(validateShapeAvatarDef({ ...validDef(), script: "alert(1)" }).ok).toBe(false);
    expect(validateShapeAvatarDef({
      schemaVersion: 1,
      body: { kind: "path", d: "M0 0L10 10" },
      eyes: defaultPillEyes(),
    }).error).toMatch(/closed path/i);
    expect(validateShapeAvatarDef({
      ...validDef(),
      id: "550e8400-e29b-41d4-a716-446655440000",
    }).ok).toBe(false);
  });

  it("refuses oversized or unsafe path data", () => {
    const long = `M0 0${"L1 1".repeat(SHAPE_AVATAR_LIMITS.pathCommands)}Z`;
    expect(validateShapeAvatarDef({
      schemaVersion: 1,
      body: { kind: "path", d: long },
      eyes: defaultPillEyes(),
    }).ok).toBe(false);
    expect(validateShapeAvatarDef({
      schemaVersion: 1,
      body: { kind: "path", d: 'M0 0L10 10Z<script>' },
      eyes: defaultPillEyes(),
    }).ok).toBe(false);
  });

  it("parses paste payloads and share wrappers", () => {
    const json = JSON.stringify(validDef());
    expect(parseShapeAvatarPayload(json).ok).toBe(true);
    expect(parseShapeAvatarPayload(JSON.stringify({ def: validDef() })).ok).toBe(true);
    expect(parseShapeAvatarPayload("not-json").ok).toBe(false);
  });
});

describe("compileShapeAvatar", () => {
  it("keeps the first part as the outline and the rest as extras", () => {
    const compiled = compileShapeAvatar(validDef());
    expect(compiled.outline.startsWith("M")).toBe(true);
    expect(compiled.extras).toHaveLength(1);
    expect(compiled.face).toEqual([48, 44]);
    expect(compiled.eye.shape).toBe("pill");
  });

  it("carries radii through for legacy morphing", () => {
    const radii = Array.from({ length: 64 }, (_, i) => 0.8 + (i % 4) * 0.05);
    const compiled = compileShapeAvatar({
      schemaVersion: 1,
      body: { kind: "radii", radii },
      eyes: defaultPillEyes(),
    });
    expect(compiled.radii).toEqual(radii);
    expect(compiled.outline).toBe("");
  });
});

describe("share encode/decode", () => {
  it("round-trips colour and mood beside the geometry", () => {
    const encoded = encodeShapeAvatarShare(validDef(), { color: "teal", mood: "happy" });
    const decoded = decodeShapeAvatarShare(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.def.id).toBe("cup");
      expect(decoded.color).toBe("teal");
      expect(decoded.mood).toBe("happy");
    }
  });
});

describe("path helpers", () => {
  it("builds closed rounded rects and ellipses under the command budget", () => {
    const rect = roundedRectPath(10, 10, 40, 50, 8);
    const oval = ellipsePath(50, 50, 20, 25);
    expect(rect.endsWith("Z")).toBe(true);
    expect(oval.endsWith("Z")).toBe(true);
    expect(pathCommandCount(rect)).toBeLessThan(SHAPE_AVATAR_LIMITS.pathCommands);
    expect(validateShapeAvatarDef({
      schemaVersion: 1,
      body: { kind: "path", d: rect },
      eyes: defaultPillEyes(),
    }).ok).toBe(true);
  });
});
