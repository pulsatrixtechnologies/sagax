/**
 * Portable Shape avatar definition (schema v1): geometry only, colour kept
 * separate (bot colour or skin). Shared by the server, the desktop and iOS.
 *
 * A definition is a silhouette body (one closed path, a composition of
 * primitives, or the legacy 64 radii), eye placement and size, and optional
 * accessory paths. Strict validation refuses scripts, oversized paths and
 * out-of-bounds geometry so a pasted or generated JSON cannot break the
 * drawing (the body stays one whole, never disassembled).
 */
import { z } from "zod";

export const SHAPE_AVATAR_SCHEMA_VERSION = 1 as const;

/** Box the silhouette lives in (same as shared/mascot-geometry.json). */
export const SHAPE_AVATAR_BOX = { min: 0, max: 100, center: 50, unit: 40 } as const;

/** Hard limits the validator enforces on every platform. */
export const SHAPE_AVATAR_LIMITS = {
  idMax: 48,
  nameMax: 80,
  pathChars: 4_000,
  pathCommands: 128,
  parts: 12,
  accessories: 8,
  radiiCount: 64,
  radiusMin: 0.3,
  radiusMax: 1.4,
  eyeMin: 1,
  eyeMax: 18,
  gapMin: 2,
  gapMax: 40,
} as const;

export const SHAPE_AVATAR_EYE_SHAPES = ["pill", "round", "arch"] as const;
export type ShapeAvatarEyeShape = (typeof SHAPE_AVATAR_EYE_SHAPES)[number];

const finite = (min: number, max: number) =>
  z.number().finite().min(min).max(max);

const pointSchema = z.tuple([finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max), finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max)]);

/** Absolute SVG path data: only M/L/C/Q/Z (and lowercase), digits, spaces, commas, periods, signs. */
const PATH_SAFE = /^[MmLlCcQqZz0-9eE.,+\-\s]+$/;

export function pathCommandCount(d: string): number {
  return (d.match(/[MmLlCcQqZz]/g) ?? []).length;
}

export function assertSafePath(d: string, label = "path"): string | null {
  if (typeof d !== "string" || !d.trim()) return `${label} must be a non-empty SVG path`;
  if (d.length > SHAPE_AVATAR_LIMITS.pathChars) return `${label} is too long (max ${SHAPE_AVATAR_LIMITS.pathChars} chars)`;
  if (!PATH_SAFE.test(d)) return `${label} may only use M/L/C/Q/Z commands and numbers`;
  if (/[<>"'`;\\]|javascript:|url\s*\(/i.test(d)) return `${label} contains forbidden content`;
  if (pathCommandCount(d) > SHAPE_AVATAR_LIMITS.pathCommands) {
    return `${label} has too many commands (max ${SHAPE_AVATAR_LIMITS.pathCommands})`;
  }
  if (!/[Mm]/.test(d) || !/[Zz]/.test(d)) return `${label} must be a closed path (M…Z)`;
  return null;
}

const pathString = z.string().superRefine((value, ctx) => {
  const problem = assertSafePath(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

const slugId = z
  .string()
  .min(1)
  .max(SHAPE_AVATAR_LIMITS.idMax)
  .regex(/^[a-z][a-z0-9-]{0,47}$/, "id must be a lowercase slug (a-z, 0-9, hyphen), not a GUID");

export const shapeAvatarPrimitiveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ellipse"),
    cx: finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max),
    cy: finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max),
    rx: finite(0.5, 50),
    ry: finite(0.5, 50),
  }),
  z.object({
    type: z.literal("circle"),
    cx: finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max),
    cy: finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max),
    r: finite(0.5, 50),
  }),
  z.object({
    type: z.literal("rect"),
    x: finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max),
    y: finite(SHAPE_AVATAR_BOX.min, SHAPE_AVATAR_BOX.max),
    w: finite(1, 100),
    h: finite(1, 100),
    rx: finite(0, 50).optional(),
    ry: finite(0, 50).optional(),
  }),
  z.object({
    type: z.literal("path"),
    d: pathString,
  }),
]);

export type ShapeAvatarPrimitive = z.infer<typeof shapeAvatarPrimitiveSchema>;

export const shapeAvatarBodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("radii"),
    radii: z
      .array(finite(SHAPE_AVATAR_LIMITS.radiusMin, SHAPE_AVATAR_LIMITS.radiusMax))
      .length(SHAPE_AVATAR_LIMITS.radiiCount),
  }),
  z.object({
    kind: z.literal("path"),
    d: pathString,
  }),
  z.object({
    kind: z.literal("parts"),
    parts: z.array(shapeAvatarPrimitiveSchema).min(1).max(SHAPE_AVATAR_LIMITS.parts),
  }),
]);

export type ShapeAvatarBody = z.infer<typeof shapeAvatarBodySchema>;

export const shapeAvatarEyesSchema = z.object({
  anchor: pointSchema,
  size: z.object({
    w: finite(SHAPE_AVATAR_LIMITS.eyeMin, SHAPE_AVATAR_LIMITS.eyeMax),
    h: finite(SHAPE_AVATAR_LIMITS.eyeMin, SHAPE_AVATAR_LIMITS.eyeMax),
  }),
  shape: z.enum(SHAPE_AVATAR_EYE_SHAPES).optional(),
  gap: finite(SHAPE_AVATAR_LIMITS.gapMin, SHAPE_AVATAR_LIMITS.gapMax).optional(),
});

export type ShapeAvatarEyes = z.infer<typeof shapeAvatarEyesSchema>;

export const shapeAvatarAccessorySchema = z.object({
  d: pathString,
  role: z.string().max(32).regex(/^[a-z][a-z0-9_-]*$/).optional(),
});

export const shapeAvatarDefSchema = z
  .object({
    schemaVersion: z.literal(SHAPE_AVATAR_SCHEMA_VERSION),
    id: slugId.optional(),
    name: z.string().trim().min(1).max(SHAPE_AVATAR_LIMITS.nameMax).optional(),
    body: shapeAvatarBodySchema,
    eyes: shapeAvatarEyesSchema,
    accessories: z.array(shapeAvatarAccessorySchema).max(SHAPE_AVATAR_LIMITS.accessories).optional(),
  })
  .strict();

export type ShapeAvatarDef = z.infer<typeof shapeAvatarDefSchema>;

export type ShapeAvatarValidation =
  | { ok: true; def: ShapeAvatarDef }
  | { ok: false; error: string };

/** Validate unknown JSON into a Shape avatar definition. */
export function validateShapeAvatarDef(value: unknown): ShapeAvatarValidation {
  if (value === null || value === undefined) return { ok: false, error: "definition is missing" };
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, error: "definition must be valid JSON" };
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "definition must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  if ("color" in record || "fill" in record || "palette" in record) {
    return { ok: false, error: "definition is geometry only; colour is separate" };
  }
  if ("script" in record || "onClick" in record || "href" in record) {
    return { ok: false, error: "definition must not carry scripts or links" };
  }
  const parsed = shapeAvatarDefSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue?.message ?? "invalid definition"}` };
  }
  return { ok: true, def: parsed.data };
}

/** Parse a pasted or dropped payload (raw JSON or a share wrapper). */
export function parseShapeAvatarPayload(raw: string): ShapeAvatarValidation {
  const text = raw.trim();
  if (!text) return { ok: false, error: "definition is empty" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "definition must be valid JSON" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrap = value as Record<string, unknown>;
    if (wrap.def && typeof wrap.def === "object") return validateShapeAvatarDef(wrap.def);
    if (wrap.avatar && typeof wrap.avatar === "object") return validateShapeAvatarDef(wrap.avatar);
  }
  return validateShapeAvatarDef(value);
}

/* ------------------------------------------------------------------ math */

type Point = [number, number];

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Rounded rect as a closed cubic path in box units. */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const x2 = x + w;
  const y2 = y + h;
  if (rr <= 0) return `M${round2(x)} ${round2(y)}L${round2(x2)} ${round2(y)}L${round2(x2)} ${round2(y2)}L${round2(x)} ${round2(y2)}Z`;
  return [
    `M${round2(x + rr)} ${round2(y)}`,
    `L${round2(x2 - rr)} ${round2(y)}`,
    `Q${round2(x2)} ${round2(y)} ${round2(x2)} ${round2(y + rr)}`,
    `L${round2(x2)} ${round2(y2 - rr)}`,
    `Q${round2(x2)} ${round2(y2)} ${round2(x2 - rr)} ${round2(y2)}`,
    `L${round2(x + rr)} ${round2(y2)}`,
    `Q${round2(x)} ${round2(y2)} ${round2(x)} ${round2(y2 - rr)}`,
    `L${round2(x)} ${round2(y + rr)}`,
    `Q${round2(x)} ${round2(y)} ${round2(x + rr)} ${round2(y)}`,
    "Z",
  ].join("");
}

/** Ellipse as four cubic Beziers (absolute). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  const ox = round2(rx * k);
  const oy = round2(ry * k);
  const x0 = round2(cx - rx);
  const x1 = round2(cx + rx);
  const y0 = round2(cy - ry);
  const y1 = round2(cy + ry);
  const c = round2(cx);
  const m = round2(cy);
  return [
    `M${c} ${y0}`,
    `C${round2(cx + ox)} ${y0} ${x1} ${round2(cy - oy)} ${x1} ${m}`,
    `C${x1} ${round2(cy + oy)} ${round2(cx + ox)} ${y1} ${c} ${y1}`,
    `C${round2(cx - ox)} ${y1} ${x0} ${round2(cy + oy)} ${x0} ${m}`,
    `C${x0} ${round2(cy - oy)} ${round2(cx - ox)} ${y0} ${c} ${y0}`,
    "Z",
  ].join("");
}

export function circlePath(cx: number, cy: number, r: number): string {
  return ellipsePath(cx, cy, r, r);
}

/** Turn one primitive into a closed path string. */
export function primitivePath(part: ShapeAvatarPrimitive): string {
  switch (part.type) {
    case "ellipse":
      return ellipsePath(part.cx, part.cy, part.rx, part.ry);
    case "circle":
      return circlePath(part.cx, part.cy, part.r);
    case "rect":
      return roundedRectPath(part.x, part.y, part.w, part.h, part.rx ?? part.ry ?? 0);
    case "path":
      return part.d;
  }
}

/**
 * Compile a definition into drawing inputs the Shape volume layer uses:
 * one primary outline (first part or path), optional extra body fills, face
 * anchor in box units, eye size, and accessories. Colour stays out.
 */
export interface CompiledShapeAvatar {
  outline: string;
  /** Extra filled subpaths that make up the body (parts after the first). */
  extras: string[];
  face: Point;
  eye: { w: number; h: number; shape: ShapeAvatarEyeShape; gap: number };
  accessories: Array<{ d: string; role?: string }>;
  /** When the body was radii, the radii for morphing with the legacy engine. */
  radii?: readonly number[];
}

export function compileShapeAvatar(def: ShapeAvatarDef): CompiledShapeAvatar {
  const eyeShape = def.eyes.shape ?? "pill";
  const gap = def.eyes.gap ?? Math.max(def.eyes.size.w * 1.6, 8);
  const eye = { w: def.eyes.size.w, h: def.eyes.size.h, shape: eyeShape, gap };
  const accessories = (def.accessories ?? []).map((item) => ({ d: item.d, role: item.role }));
  if (def.body.kind === "radii") {
    // outline is produced by the radii pipeline (shape-art); keep radii here
    return {
      outline: "",
      extras: [],
      face: def.eyes.anchor,
      eye,
      accessories,
      radii: def.body.radii,
    };
  }
  if (def.body.kind === "path") {
    return { outline: def.body.d, extras: [], face: def.eyes.anchor, eye, accessories };
  }
  const paths = def.body.parts.map(primitivePath);
  return {
    outline: paths[0]!,
    extras: paths.slice(1),
    face: def.eyes.anchor,
    eye,
    accessories,
  };
}

/** Default pill eyes near the upper middle of the 0..100 box. */
export function defaultPillEyes(anchor: Point = [54, 42], size = { w: 7.5, h: 16 }): ShapeAvatarEyes {
  return { anchor, size, shape: "pill", gap: 14 };
}

/**
 * Share payload: definition plus optional colour and mood so a link can
 * reopen the avatar. Colour and mood are outside the geometry schema.
 */
export interface ShapeAvatarShare {
  v: 1;
  def: ShapeAvatarDef;
  color?: string;
  mood?: string;
}

export function shapeAvatarSharePayload(def: ShapeAvatarDef, extras?: { color?: string; mood?: string }): ShapeAvatarShare {
  return {
    v: 1,
    def,
    ...(extras?.color ? { color: extras.color } : {}),
    ...(extras?.mood ? { mood: extras.mood } : {}),
  };
}

export function encodeShapeAvatarShare(def: ShapeAvatarDef, extras?: { color?: string; mood?: string }): string {
  return JSON.stringify(shapeAvatarSharePayload(def, extras));
}

export function decodeShapeAvatarShare(raw: string): ShapeAvatarValidation & { color?: string; mood?: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return { ok: false, error: "share link must be valid JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "share link must be an object" };
  }
  const record = value as Record<string, unknown>;
  const nested = record.def ?? record.avatar ?? value;
  const result = validateShapeAvatarDef(nested);
  if (!result.ok) return result;
  return {
    ...result,
    ...(typeof record.color === "string" ? { color: record.color } : {}),
    ...(typeof record.mood === "string" ? { mood: record.mood } : {}),
  };
}
