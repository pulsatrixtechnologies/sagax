/**
 * Our own object-shaped Shape presets (clean room, v2.1): closed path
 * silhouettes with concavities and appendages that read at 28..96 px.
 * Geometry only; colour is the bot's. Path bodies are the live form.
 *
 * The bodies and eye anchors live in shared/mascot-geometry.json (`path`,
 * `eyes`), the single geometry source: the iOS port reads the same values
 * through the generated ShapeGeometryData.swift. A body need not be seen
 * whole from the centre (the sprout's leaves, the say's tail): its volume
 * slices must still touch the face, which shape-set.regression.test.ts
 * measures on the drawn body, and its look is pinned by
 * shape-object-look.regression.test.ts.
 */
import geometry from "./mascot-geometry.json" with { type: "json" };
import {
  defaultPillEyes,
  SHAPE_AVATAR_SCHEMA_VERSION,
  type ShapeAvatarDef,
} from "./shape-avatar-def.ts";
import { liveOutlineFromDef, smoothClosedOutline } from "./shape-avatar-outline.ts";

export { compileShapeAvatar } from "./shape-avatar-def.ts";
export { liveOutlineFromDef };

type ObjectBody = { path: string; eyes: { anchor: number[]; w: number; h: number } };

function objectDef(id: "pad" | "cup" | "bulb" | "say" | "sprout" | "tin" | "tome" | "ship", name: string): ShapeAvatarDef {
  const body = (geometry.shapes as Record<string, Partial<ObjectBody>>)[id];
  if (!body?.path || !body.eyes) throw new Error(`mascot-geometry.json: ${id} has no path body`);
  const { anchor, w, h } = body.eyes;
  return {
    schemaVersion: SHAPE_AVATAR_SCHEMA_VERSION,
    id,
    name,
    body: { kind: "path", d: body.path },
    eyes: defaultPillEyes([anchor[0], anchor[1]], { w, h }),
  };
}

/** Pad: wide body with clear side grips that read at 28 px. */
const pad = objectDef("pad", "Pad");
/** Cup: mug body with a C-handle (evenodd hole keeps the C open). */
const cup = objectDef("cup", "Cup");
/** Bulb: round glass plus a stepped screw base. */
const bulb = objectDef("bulb", "Bulb");
/** Say: rounded speech bubble with a long pointed tail. */
const say = objectDef("say", "Say");
/** Sprout: round pot with two leaves above its rim. */
const sprout = objectDef("sprout", "Sprout");
/** Tin: tall can with a pull-tab on the top-right. */
const tin = objectDef("tin", "Tin");
/** Tome: closed book with a thick left spine step. */
const tome = objectDef("tome", "Tome");
/** Ship: rocket with wide side fins and a pointed nose. */
const ship = objectDef("ship", "Ship");

export const OBJECT_SHAPE_PRESETS = [pad, cup, bulb, say, sprout, tin, tome, ship] as const;

export const OBJECT_SHAPE_IDS = OBJECT_SHAPE_PRESETS.map((preset) => preset.id!) as unknown as readonly [
  "pad",
  "cup",
  "bulb",
  "say",
  "sprout",
  "tin",
  "tome",
  "ship",
];

export type ObjectShapeId = (typeof OBJECT_SHAPE_IDS)[number];

export const OBJECT_SHAPE_BY_ID = Object.fromEntries(
  OBJECT_SHAPE_PRESETS.map((preset) => [preset.id!, preset]),
) as Record<ObjectShapeId, ShapeAvatarDef>;

export function isObjectShapeId(value: string): value is ObjectShapeId {
  return (OBJECT_SHAPE_IDS as readonly string[]).includes(value);
}

/** Flat still SVG for export (no volume). Eyes as rounded pills. */
export function shapeAvatarStillSvg(
  def: ShapeAvatarDef,
  fill: string,
  options: { size?: number } = {},
): string {
  const size = options.size ?? 96;
  const live = liveOutlineFromDef(def);
  const path = live.path || (live.points.length ? smoothClosedOutline(live.points) : "M50 10A40 40 0 1 1 49.9 10Z");
  const [ax, ay] = live.face;
  const ew = live.eye.w;
  const eh = live.eye.h;
  const gap = live.eye.gap;
  const left = `<rect x="${ax - gap / 2 - ew}" y="${ay - eh / 2}" width="${ew * 2}" height="${eh}" rx="${ew}" ry="${ew}" fill="#16181d"/>`;
  const right = `<rect x="${ax + gap / 2 - ew}" y="${ay - eh / 2}" width="${ew * 2}" height="${eh}" rx="${ew}" ry="${ew}" fill="#16181d"/>`;
  const extras = live.extras.map((d) => `<path d="${d}" fill="${fill}"/>`).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">`,
    `<path d="${path}" fill="${fill}" fill-rule="evenodd"/>`,
    extras,
    left,
    right,
    `</svg>\n`,
  ].join("");
}
