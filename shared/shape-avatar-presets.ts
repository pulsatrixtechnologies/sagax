/**
 * Our own object-shaped Shape presets (clean room, v2.1): closed path
 * silhouettes with concavities and appendages that read at 28..96 px.
 * Geometry only; colour is the bot's. Path bodies are the live form;
 * polar radii in mascot-geometry.json remain a morph/catalog bridge.
 */
import {
  defaultPillEyes,
  SHAPE_AVATAR_SCHEMA_VERSION,
  type ShapeAvatarDef,
} from "./shape-avatar-def.ts";
import { liveOutlineFromDef, smoothClosedOutline } from "./shape-avatar-outline.ts";

export { compileShapeAvatar } from "./shape-avatar-def.ts";
export { liveOutlineFromDef };

const ver = SHAPE_AVATAR_SCHEMA_VERSION;

function pathDef(
  id: string,
  name: string,
  d: string,
  eyes: ShapeAvatarDef["eyes"],
  accessories?: ShapeAvatarDef["accessories"],
): ShapeAvatarDef {
  return {
    schemaVersion: ver,
    id,
    name,
    body: { kind: "path", d },
    eyes,
    ...(accessories?.length ? { accessories } : {}),
  };
}

/**
 * Pad: wide body with clear side grips (protruding handles) that read at 28 px.
 */
const pad = pathDef(
  "pad",
  "Pad",
  [
    "M22 34",
    "C22 24 32 18 44 18",
    "L56 18",
    "C68 18 78 24 78 34",
    "L78 42",
    "L90 46",
    "C96 48 98 54 96 60",
    "C94 68 86 72 78 70",
    "L78 74",
    "C76 84 66 90 50 90",
    "C34 90 24 84 22 74",
    "L22 70",
    "C14 72 6 68 4 60",
    "C2 54 4 48 10 46",
    "L22 42",
    "Z",
  ].join(""),
  defaultPillEyes([50, 46], { w: 7, h: 13 }),
);

/**
 * Cup: mug body with a solid C-handle (one outer silhouette, no hole) so
 * volume slices keep the handle readable at small sizes.
 */
const cup = pathDef(
  "cup",
  "Cup",
  [
    "M26 16",
    "L58 16",
    "L60 30",
    "L72 28",
    "C90 28 98 40 98 52",
    "C98 66 88 78 68 78",
    "L60 76",
    "L62 84",
    "C62 92 54 96 44 96",
    "C34 96 26 92 26 84",
    "Z",
    // Inner handle cut (evenodd): keeps the C open
    "M60 38",
    "L68 36",
    "C80 36 86 44 86 52",
    "C86 62 78 70 66 70",
    "L60 68",
    "Z",
  ].join(""),
  defaultPillEyes([42, 48], { w: 7, h: 14 }),
);

/**
 * Bulb: round glass plus a clear stepped screw base.
 */
const bulb = pathDef(
  "bulb",
  "Bulb",
  [
    "M50 6",
    "C72 6 90 26 90 46",
    "C90 60 80 70 66 76",
    "L60 80",
    "L66 84",
    "L66 88",
    "L60 90",
    "L64 94",
    "L36 94",
    "L40 90",
    "L34 88",
    "L34 84",
    "L40 80",
    "L34 76",
    "C20 70 10 60 10 46",
    "C10 26 28 6 50 6",
    "Z",
  ].join(""),
  defaultPillEyes([50, 36], { w: 7.5, h: 14 }),
);

/**
 * Say: rounded speech bubble with a large triangular tail.
 */
const say = pathDef(
  "say",
  "Say",
  [
    "M20 14",
    "L72 14",
    "C86 14 94 24 94 36",
    "L94 52",
    "C94 66 84 76 70 76",
    "L44 76",
    "L22 96",
    "L34 76",
    "L28 76",
    "C14 76 6 66 6 52",
    "L6 36",
    "C6 24 10 14 20 14",
    "Z",
  ].join(""),
  defaultPillEyes([50, 40], { w: 7.5, h: 14 }),
);

/**
 * Sprout: pot with two leaf lobes that stick above the rim.
 */
const sprout = pathDef(
  "sprout",
  "Sprout",
  [
    "M50 52",
    "C40 42 22 34 14 26",
    "C6 18 10 6 24 6",
    "C38 6 46 22 50 36",
    "C54 22 62 6 76 6",
    "C90 6 94 18 86 26",
    "C78 34 60 42 50 52",
    "L68 56",
    "C78 56 84 66 82 76",
    "L78 94",
    "C76 98 62 100 50 100",
    "C38 100 24 98 22 94",
    "L18 76",
    "C16 66 22 56 32 56",
    "Z",
  ].join(""),
  defaultPillEyes([50, 74], { w: 6.5, h: 12 }),
);

/**
 * Tin: tall can with a clear spout / pull-tab on the top-right.
 */
const tin = pathDef(
  "tin",
  "Tin",
  [
    "M30 22",
    "L58 22",
    "L66 10",
    "L80 10",
    "L80 22",
    "L70 26",
    "L70 88",
    "C70 96 60 100 50 100",
    "C40 100 30 96 30 88",
    "Z",
  ].join(""),
  defaultPillEyes([50, 52], { w: 7, h: 14 }),
);

/**
 * Tome: closed book with a thick left spine step.
 */
const tome = pathDef(
  "tome",
  "Tome",
  [
    "M12 20",
    "L28 12",
    "L86 12",
    "C94 12 98 18 98 26",
    "L98 82",
    "C98 90 94 96 86 96",
    "L28 96",
    "L12 88",
    "Z",
  ].join(""),
  defaultPillEyes([60, 48], { w: 7, h: 13 }),
);

/**
 * Ship: rocket with wide side fins and a pointed nose.
 */
const ship = pathDef(
  "ship",
  "Ship",
  [
    "M50 4",
    "C62 4 70 18 70 32",
    "L70 58",
    "L92 86",
    "L70 74",
    "L70 90",
    "C70 98 60 100 50 100",
    "C40 100 30 98 30 90",
    "L30 74",
    "L8 86",
    "L30 58",
    "L30 32",
    "C30 18 38 4 50 4",
    "Z",
  ].join(""),
  defaultPillEyes([50, 38], { w: 7, h: 13 }),
);

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
