// The phone draws and decodes the same mascot looks the desktop stores
// (ios/Sources/CompanionCore/MascotLook.swift). This file keeps the two in
// step from the desktop's own sources:
//
// - ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json: every look the
//   desktop can store in `bot.mascotLook` (each character, shape and skin,
//   the editor's saved form with all three skins, the legacy ids) with what
//   `botMascotLook` reads from it, every owl skin with `botMascotSkin`, and
//   every bot color with its value. The Swift decoder is tested against it.
// - ios/Sources/CompanionCore/ShapeStillArt.swift: the Shapes still frames
//   (body outline and cut-out eyes for each mood), from `stillFrame`.
// - ios/Sources/CompanionCore/ShapeEngineData.swift: the Shapes engine's own
//   numbers (the 64 radii of every body and of the bodies the moves take, the
//   sixteen faces, the fourteen moves' timings and rings, the idle loops, the
//   blink schedule, the light), which ShapeEngine.swift moves exactly as
//   shape-engine.ts and shape-moves.ts do. Fixtures/shape-frames.json holds
//   frames the desktop's engine draws (every face, every move at a few
//   moments, the idle loop, a morph); ShapeEngineTests checks the Swift port
//   against them.
// - ios/Sources/CompanionCore/ShibaStillArt.swift: Shiba's parts as draw
//   operations with paint roles (shiba-art.ts), for each stance and each of
//   the sixteen faces, the rig's pivots and the walk cycle's keyframes
//   (shiba-moves.ts). The fixture also carries Shiba's palette for each skin
//   on a few colors, which ShibaArt.swift must match.
// - ios/Sources/CompanionCore/FrogStillArt.swift: Frog's parts as draw
//   operations with paint roles (frog-art.ts) for each of the sixteen faces,
//   the parts its moves add (throat sac, tongue, fly, legs, pad), the pivots
//   and the hop and throat puff keyframes (frog-moves.ts). The fixture carries
//   Frog's palette for each skin on a few colors, which FrogArt.swift must match.
//
// - ios/Sources/CompanionCore/OgreStillArt.swift: Ogre's still drawing (the
//   approved head and shoulders, `ogreParts` in ogre-art.ts) as draw
//   operations, every face, the skins' fixed colors and palette samples.
// - ios/Sources/CompanionCore/CrabArt.swift: Crab's pixel rects and skins,
//   written by hand (Clawd-Still 24x16: stub arms, four legs, 2x2 eyes).
//   The fixture carries each skin's fill and eyes (`crabPalettes`) which
//   CrabArt.paint must match.
//
// They are all checked here; `UPDATE_IOS_MASCOT=1 pnpm vitest run
// src/components/ios-mascot-export.test.ts` rewrites them after a desktop
// change.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNBU_SKINS,
  GRUMP_SKINS,
  CRAB_SKINS,
  FROG_SKINS,
  LEGACY_BUNBU_SKINS,
  LEGACY_CRAB_SKINS,
  LEGACY_GRUMP_SKINS,
  LEGACY_OGRE_SKINS,
  LEGACY_FROG_SKINS,
  LEGACY_SHAPE_SKINS,
  LEGACY_SHAPES,
  LEGACY_SHIBA_SKINS,
  LEGACY_TROMBI_SKINS,
  MASCOT_CHARACTERS,
  BODY_SHAPES,
  OGRE_SKINS,
  SHAPE_SKINS,
  SHIBA_SKINS,
  TROMBI_SKINS,
  botMascotLook,
  completeMascotLook,
} from "../../shared/mascot-look";
import { LEGACY_OWL_SKINS, MASCOT_SKIN_IDS, botMascotSkin } from "../../shared/mascot-skins";
import { MASCOT_COLOR_GROUPS, MASCOT_COLOR_HEX, MASCOT_COLOR_PALETTES } from "../../shared/mascot-colors";
import type { ShapeMood } from "./shape-avatar";
import { BLINK, blinkSchedule, expressionForMood, IDLE_FRAME_S, gazeFrame, BREATH_AMOUNT, BREATH_S, CLAY_LIGHT, EXPRESSIONS, DEPTH_FULL, EYE_GAP, EYE_GAZE, EYE_LENGTH, EYE_MARGIN, EYE_ROLL, EYE_SCALE, EYE_SHIFT, EYE_SPREAD, FACE_DROP, HEAD, HOVER, LEAN_GAZE, MORPH_S, SHAPE_EXPRESSIONS, ShapeEngine, stillFrame, WANDER, type ShapeExpression, type ShapeFrame } from "./shape-engine";
import { EXCLAIM, MOVE_TIMING, ORBIT_RINGS, SHAPE_MOVES, SWIRL_RINGS, THOUGHT_DOTS, type RingSpec } from "./shape-moves";
import { BODY_3D, drawShape, EYE_INK, EYE_INK_ON_DARK, eyeStyleFor, groundLift, inkPaint, OUT_OF_PLANE, poseMatrices, REST_POSE, SHAPE_FIT, SIDE_TINT, styledEyes, TURN_SQUASH, uprightPose, VOLUME_SIZES, type EyeStyle, type Pose, type VolumeDetail } from "./shape-volume";
import { BASE_DROP, GLANCE, MOTION_BLEND, MOTION_MOODS, MOTIONS, motionForMood, POKE, ROLL_LIMIT, ShapeMotion, TURN_TOWARD, type MotionSpec } from "./shape-motion";
import { BODY, FACE_ANCHOR, GEOMETRY, MOVE_RADII, RADII_COUNT, SHAPE_RADII, STEM, STEM_INK } from "./shape-art";
import { legOps, SHIBA_ART, SHIBA_BUST, SHIBA_BUST_MAX, SHIBA_EXPRESSIONS, SHIBA_HIPS, SHIBA_LEGS, SHIBA_PIVOTS, SHIBA_ROLES, shibaOutline, shibaParts, STANCE_HEAD, MOUTHS, mouthOps, type ShibaOp, type ShibaStance } from "./shiba-art";
import { blendPose, restPose, SHIBA_MOVE_TIMING, shibaMoveAt } from "./shiba-moves";
import { shibaSkinPaint } from "./skin-fx/shiba-skins";
import { GRUMP_BUST, GRUMP_EXPRESSIONS, GRUMP_ROLES, grumpParts, type GrumpOp } from "./grump-art";
import { grumpFlatPalette } from "./skin-fx/grump-skins";
import { GRUMP_SKINS as GRUMP_SKIN_IDS } from "../../shared/mascot-look";
import { OGRE_EXPRESSIONS, ogreOutline, ogrePalette, ogreParts, type OgreOp, type OgreParts } from "./ogre-art";
import { ogreSkinPaint } from "./skin-fx/ogre-skins";
import { FROG_BUST, FROG_BUST_MAX, FROG_EXPRESSIONS, FROG_MOUTHS, FROG_PIVOTS, FROG_ROLES, frogFlyOps, frogHaunchOps, frogLegOps, frogMouthOps, frogOutline, frogPadOps, frogParts, frogThroatOps, frogTongueOps, type FrogOp } from "./frog-art";
import { FLY_AT, FROG_TRACKS, frogMoveAt, THROAT_TOP, type FrogMove } from "./frog-moves";
import { frogSkinPaint } from "./skin-fx/frog-skins";
import { crabSkinPaint } from "./skin-fx/crab-skins";
import { HD_LOOP_MIN_PX, HD_LOOPS, HD_MASCOTS, HD_STATE_MAP, HD_STILLS } from "./hd-mascots/manifest";

const ROOT = join(__dirname, "..", "..");
const FIXTURE = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json");
const SWIFT_ART = join(ROOT, "ios/Sources/CompanionCore/ShapeStillArt.swift");
const SWIFT_SHAPE_ENGINE = join(ROOT, "ios/Sources/CompanionCore/ShapeEngineData.swift");
const SHAPE_FRAMES = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/shape-frames.json");
const SWIFT_SHAPE_VOLUME = join(ROOT, "ios/Sources/CompanionCore/ShapeVolumeData.swift");
const SWIFT_GEOMETRY = join(ROOT, "ios/Sources/CompanionCore/ShapeGeometryData.swift");
const SHAPE_VOLUME = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/shape-volume.json");
const SWIFT_HD = join(ROOT, "ios/Sources/CompanionCore/HdMascotData.swift");
const SWIFT_SHIBA = join(ROOT, "ios/Sources/CompanionCore/ShibaStillArt.swift");
const OGRE_ART_SWIFT = join(ROOT, "ios/Sources/CompanionCore/OgreStillArt.swift");
const SWIFT_FROG = join(ROOT, "ios/Sources/CompanionCore/FrogStillArt.swift");
const UPDATE = process.env.UPDATE_IOS_MASCOT === "1";

type Case = { name: string; input: unknown; expected: unknown };

/** What botMascotLook reads, with an empty skins object left out (the same look). */
function read(input: unknown): unknown {
  const look = botMascotLook(input) as Record<string, unknown>;
  const skins = look.skins as Record<string, unknown> | undefined;
  if (skins && Object.keys(skins).length === 0) {
    const { skins: _drop, ...rest } = look;
    return rest;
  }
  return look;
}

function lookCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, input: unknown) => cases.push({ name, input, expected: read(input) });
  for (const character of MASCOT_CHARACTERS) add(`bare ${character}`, { character });
  add("owl 2d", { character: "owl", style: "2d" });
  add("owl 3d", { character: "owl", style: "3d" });
  for (const shape of BODY_SHAPES) {
    for (const skin of SHAPE_SKINS) add(`shape ${shape} ${skin}`, { character: "shape", shape, skins: { shape: skin } });
  }
  for (const skin of TROMBI_SKINS) add(`trombi ${skin}`, { character: "trombi", skins: { trombi: skin } });
  for (const skin of BUNBU_SKINS) add(`bunbu ${skin}`, { character: "bunbu", skins: { bunbu: skin } });
  for (const skin of SHIBA_SKINS) add(`shiba ${skin}`, { character: "shiba", skins: { shiba: skin } });
  for (const skin of GRUMP_SKINS) add(`grump ${skin}`, { character: "grump", skins: { grump: skin } });
  for (const skin of OGRE_SKINS) add(`ogre ${skin}`, { character: "ogre", skins: { ogre: skin } });
  for (const skin of FROG_SKINS) add(`frog ${skin}`, { character: "frog", skins: { frog: skin } });
  for (const skin of CRAB_SKINS) add(`crab ${skin}`, { character: "crab", skins: { crab: skin } });
  // the desktop editor saves every choice made (completeMascotLook), every character's skin at once
  for (const character of MASCOT_CHARACTERS) {
    add(`editor ${character}`, completeMascotLook({ character, shape: "cloud", skins: { shape: "galaxy", trombi: "holo", bunbu: "velvet", shiba: "sesame", grump: "calico", ogre: "lava", frog: "poison", crab: "mint" } }));
    add(`editor default ${character}`, completeMascotLook({ character }));
  }
  for (const [legacy] of Object.entries(LEGACY_SHAPES)) add(`legacy shape ${legacy}`, { character: "shape", shape: legacy });
  for (const [legacy] of Object.entries(LEGACY_SHAPE_SKINS)) add(`legacy shape skin ${legacy}`, { character: "shape", shape: "circle", skins: { shape: legacy } });
  for (const [legacy] of Object.entries(LEGACY_TROMBI_SKINS)) add(`legacy trombi skin ${legacy}`, { character: "trombi", skins: { trombi: legacy } });
  for (const [legacy] of Object.entries(LEGACY_BUNBU_SKINS)) add(`legacy bunbu skin ${legacy}`, { character: "bunbu", skins: { bunbu: legacy } });
  for (const [legacy] of Object.entries(LEGACY_SHIBA_SKINS)) add(`legacy shiba skin ${legacy}`, { character: "shiba", skins: { shiba: legacy } });
  for (const [legacy] of Object.entries(LEGACY_GRUMP_SKINS)) add(`legacy grump skin ${legacy}`, { character: "grump", skins: { grump: legacy } });
  for (const [legacy] of Object.entries(LEGACY_OGRE_SKINS)) add(`legacy ogre skin ${legacy}`, { character: "ogre", skins: { ogre: legacy } });
  for (const [legacy] of Object.entries(LEGACY_FROG_SKINS)) add(`legacy frog skin ${legacy}`, { character: "frog", skins: { frog: legacy } });
  for (const [legacy] of Object.entries(LEGACY_CRAB_SKINS)) add(`legacy crab skin ${legacy}`, { character: "crab", skins: { crab: legacy } });
  // a newer build's skin is dropped, never the character
  add("unknown shape skin", { character: "shape", shape: "pill", skins: { shape: "plasma" } });
  add("unknown bunbu skin", { character: "bunbu", skins: { bunbu: "plasma", shape: "gold" } });
  add("unknown shiba skin", { character: "shiba", skins: { shiba: "plasma", bunbu: "gold" } });
  add("unknown grump skin", { character: "grump", skins: { grump: "plasma", shiba: "gold" } });
  add("unknown ogre skin", { character: "ogre", skins: { ogre: "plasma", shiba: "red" } });
  add("unknown frog skin", { character: "frog", skins: { frog: "plasma", shiba: "red" } });
  add("unknown crab skin", { character: "crab", skins: { crab: "plasma", frog: "tree" } });
  add("unknown skins key", { character: "trombi", skins: { trombi: "gold", dragon: "red" } });
  add("null skins", { character: "bunbu", skins: null });
  add("null skin value", { character: "shape", shape: "drop", skins: { shape: null } });
  // what the desktop itself reads as the owl
  add("unknown character", { character: "dragon" });
  add("unknown top-level key", { character: "shape", color: "red" });
  add("unknown shape", { character: "shape", shape: "star-of-david" });
  add("null shape", { character: "shape", shape: null });
  add("bad style", { character: "owl", style: "4d" });
  add("no character", { shape: "circle" });
  add("not an object", "bunbu");
  return cases;
}

function fixture() {
  const owlSkins = [...MASCOT_SKIN_IDS, ...Object.keys(LEGACY_OWL_SKINS), "plasma", 7, null].map((input) => ({ input, expected: botMascotSkin(input) }));
  return {
    note: "Generated by src/components/ios-mascot-export.test.ts from shared/mascot-look.ts, mascot-skins.ts and mascot-colors.ts. Do not edit.",
    characters: MASCOT_CHARACTERS,
    shapes: BODY_SHAPES,
    shapeSkins: SHAPE_SKINS,
    trombiSkins: TROMBI_SKINS,
    bunbuSkins: BUNBU_SKINS,
    shibaSkins: SHIBA_SKINS,
    grumpSkins: GRUMP_SKINS,
    ogreSkins: OGRE_SKINS,
    frogSkins: FROG_SKINS,
    crabSkins: CRAB_SKINS,
    owlSkins: MASCOT_SKIN_IDS,
    colorGroups: Object.fromEntries(MASCOT_COLOR_GROUPS.map((group) => [group, Object.keys(MASCOT_COLOR_PALETTES[group])])),
    colors: MASCOT_COLOR_HEX,
    looks: lookCases(),
    owlSkinCases: owlSkins,
    shibaPalettes: shibaPalettes(),
    frogPalettes: frogPalettes(),
    crabPalettes: crabPalettes(),
  };
}

/** Shiba's palette for every skin on a few colors (a gradient as `gradient`), which ShibaArt.palette must match. */
function shibaPalettes() {
  const colors = ["orange", "blue", "white", "butter", "black", "mint"] as const;
  return SHIBA_SKINS.flatMap((skin) =>
    colors.map((color) => {
      const palette = shibaSkinPaint(skin, MASCOT_COLOR_HEX[color], "u").palette;
      return { skin, color, palette: Object.fromEntries(SHIBA_ROLES.map((role) => [role, palette[role].startsWith("url(") ? "gradient" : palette[role].toUpperCase()])) };
    }),
  );
}

/* --------------------------------------------------------------- Shiba */

const SHIBA_A = 60;
const SHIBA_B = 200;
const num = (v: number) => String(Math.round(v * 10000) / 10000);
const str = (v: string) => JSON.stringify(v);

/**
 * Ops drawn at two sizes (two outline widths) as Swift: each width is
 * `width + perOutline * outline`, solved from the two, so the phone draws
 * every size with the desktop's outline rule.
 */
function swiftOps(a: readonly ShibaOp[], b: readonly ShibaOp[], indent: string, hideInBust?: (op: ShibaOp) => boolean): string {
  expect(a.length).toBe(b.length);
  const [owA, owB] = [shibaOutline(SHIBA_A), shibaOutline(SHIBA_B)];
  const items = a.map((op, i) => {
    const other = b[i];
    expect(other.d).toBe(op.d);
    const wa = op.width ?? 0;
    const wb = other.width ?? 0;
    const per = owA === owB ? 0 : (wa - wb) / (owA - owB);
    const base = wa - per * owA;
    const fields = [
      `d: ${str(op.d)}`,
      op.fill ? `fill: .${op.fill}` : null,
      op.stroke ? `stroke: .${op.stroke}` : null,
      op.stroke ? `width: ${num(base)}, perOutline: ${num(per)}` : null,
      op.opacity !== undefined ? `opacity: ${num(op.opacity)}` : null,
      op.clip ? `clip: ${str(op.clip)}` : null,
      op.round ? "round: true" : null,
      hideInBust?.(op) ? "bust: false" : null,
    ].filter(Boolean);
    return `${indent}ShibaOp(${fields.join(", ")}),`;
  });
  return items.length ? `[\n${items.join("\n")}\n${indent.slice(4)}]` : "[]";
}

function shibaSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Shiba (src/components/shiba-art.ts, shiba-moves.ts): its parts as draw",
    "// operations with paint roles for each stance and each face, the rig's",
    "// pivots and the walk cycle's keyframes. Box 0..100. Do not edit; regenerate",
    "// with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "import CoreGraphics",
    "",
    "public enum ShibaStillArt {",
  ];
  const at = (size: number, stance: ShibaStance, expression: (typeof SHIBA_EXPRESSIONS)[number] = "neutral") => shibaParts({ expression, size, stance });
  const stances: ShibaStance[] = ["sit", "stand", "lie"];
  const z = (op: ShibaOp) => op.d.startsWith("M80 13");
  for (const key of ["tail", "body", "pawL", "pawR"] as const) {
    lines.push(`    public static let ${key}: [ShibaStance: [ShibaOp]] = [`);
    for (const stance of stances) lines.push(`        .${stance}: ${swiftOps(at(SHIBA_A, stance)[key], at(SHIBA_B, stance)[key], "            ")},`);
    lines.push("    ]");
  }
  for (const key of ["earL", "earR", "head", "nose"] as const) lines.push(`    public static let ${key}: [ShibaOp] = ${swiftOps(at(SHIBA_A, "sit")[key], at(SHIBA_B, "sit")[key], "        ")}`);
  for (const key of ["brows", "eyeL", "eyeR", "mouth", "extras"] as const) {
    lines.push(`    public static let ${key}: [ShibaExpression: [ShibaOp]] = [`);
    for (const expression of SHIBA_EXPRESSIONS) lines.push(`        .${expression}: ${swiftOps(at(SHIBA_A, "sit", expression)[key], at(SHIBA_B, "sit", expression)[key], "            ", z)},`);
    lines.push("    ]");
  }
  lines.push("    /// A move's own mouth over the face's (the walk's pant, the bark).", "    public static let mouths: [String: [ShibaOp]] = [");
  for (const mouth of MOUTHS) lines.push(`        ${str(mouth)}: ${swiftOps(mouthOps(mouth, shibaOutline(SHIBA_A)), mouthOps(mouth, shibaOutline(SHIBA_B)), "            ")},`);
  lines.push("    ]", "    /// The standing legs at rest, far ones first.", "    public static let legs: [(name: String, hip: CGPoint, ops: [ShibaOp])] = [");
  for (const leg of SHIBA_LEGS.filter((name) => name.endsWith("Far")).concat(SHIBA_LEGS.filter((name) => name.endsWith("Near")))) {
    const [x, y] = SHIBA_HIPS[leg];
    lines.push(`        (name: ${str(leg)}, hip: CGPoint(x: ${x}, y: ${y}), ops: ${swiftOps(legOps(leg, 0, 0, shibaOutline(SHIBA_A)), legOps(leg, 0, 0, shibaOutline(SHIBA_B)), "            ")}),`);
  }
  lines.push("    ]");
  lines.push("    /// Where each part turns.", "    public static let pivots: [String: CGPoint] = [");
  for (const [name, [x, y]] of Object.entries(SHIBA_PIVOTS)) lines.push(`        ${str(name)}: CGPoint(x: ${x}, y: ${y}),`);
  lines.push("    ]", "    /// Where the head sits on each body (offset, scale about the neck).", "    public static let stanceHead: [ShibaStance: (x: CGFloat, y: CGFloat, scale: CGFloat)] = [");
  for (const stance of stances) {
    const head = STANCE_HEAD[stance];
    lines.push(`        .${stance}: (x: ${head.x}, y: ${head.y}, scale: ${head.scale}),`);
  }
  lines.push("    ]", `    /// The bust an avatar of ${SHIBA_BUST_MAX} pt or less shows.`, `    public static let bust = CGRect(x: ${SHIBA_BUST.x}, y: ${SHIBA_BUST.y}, width: ${SHIBA_BUST.w}, height: ${SHIBA_BUST.h})`, `    public static let bustMax: CGFloat = ${SHIBA_BUST_MAX}`);
  // the walk cycle, sixteen keyframes (the desktop's eight and the ones between)
  const cycle = SHIBA_MOVE_TIMING.walk.duration;
  lines.push(`    /// The walk cycle (s) and its keyframes: legs (angle forward, lift), body, head, ears, tail.`, `    public static let walkCycle: Double = ${cycle}`, "    public static let walk: [ShibaWalkFrame] = [");
  for (let i = 0; i < 16; i += 1) {
    const pose = blendPose(restPose(), shibaMoveAt("walk", (i / 16) * cycle), 1);
    const legs = SHIBA_LEGS.map((leg) => `${str(leg)}: (${num(pose.legs[leg].angle)}, ${num(pose.legs[leg].lift)})`).join(", ");
    lines.push(`        ShibaWalkFrame(legs: [${legs}], y: ${num(pose.y)}, sy: ${num(pose.sy)}, headY: ${num(pose.headY)}, headRot: ${num(pose.headRot)}, earL: ${num(pose.earL)}, earR: ${num(pose.earR)}, tail: ${num(pose.tail)}),`);
  }
  lines.push("    ]", `    /// The art's own box, for reference: the head path.`, `    public static let headPath = ${str(SHIBA_ART.head)}`, "}", "");
  return lines.join("\n");
}

/* ---------------------------------------------------------------- Frog */

/** Frog's palette for every skin on a few colors (a gradient or a pattern as `gradient`), which FrogArt.paint must match. */
function frogPalettes() {
  const colors = ["green", "blue", "white", "butter", "black", "orange"] as const;
  return FROG_SKINS.flatMap((skin) =>
    colors.map((color) => {
      const palette = frogSkinPaint(skin, MASCOT_COLOR_HEX[color], "u").palette;
      return { skin, color, palette: Object.fromEntries(FROG_ROLES.map((role) => [role, palette[role].startsWith("url(") ? "gradient" : palette[role].toUpperCase()])) };
    }),
  );
}

/** Crab's fill and eyes for every skin on a few colors, which CrabArt.paint must match. */
function crabPalettes() {
  const colors = ["orange", "blue", "white", "butter", "black", "mint"] as const;
  return CRAB_SKINS.flatMap((skin) =>
    colors.map((color) => {
      const paint = crabSkinPaint(skin, MASCOT_COLOR_HEX[color]);
      return { skin, color, fill: paint.fill.toUpperCase(), eyes: paint.eyes.toUpperCase() };
    }),
  );
}

/** Frog's ops drawn at two sizes as Swift, each stroke `width + perOutline * outline` (the Shiba's rule). */
function frogOps(a: readonly FrogOp[], b: readonly FrogOp[], indent: string, hideInBust?: (op: FrogOp) => boolean): string {
  expect(a.length).toBe(b.length);
  const [owA, owB] = [frogOutline(SHIBA_A), frogOutline(SHIBA_B)];
  const items = a.map((op, i) => {
    const other = b[i];
    expect(other.d).toBe(op.d);
    const wa = op.width ?? 0;
    const wb = other.width ?? 0;
    const per = owA === owB ? 0 : (wa - wb) / (owA - owB);
    const base = wa - per * owA;
    const fields = [
      `d: ${str(op.d)}`,
      op.fill ? `fill: .${op.fill}` : null,
      op.stroke ? `stroke: .${op.stroke}` : null,
      op.stroke ? `width: ${num(base)}, perOutline: ${num(per)}` : null,
      op.opacity !== undefined ? `opacity: ${num(op.opacity)}` : null,
      op.clip ? `clip: ${str(op.clip)}` : null,
      op.round ? "round: true" : null,
      hideInBust?.(op) ? "bust: false" : null,
    ].filter(Boolean);
    return `${indent}FrogOp(${fields.join(", ")}),`;
  });
  return items.length ? `[\n${items.join("\n")}\n${indent.slice(4)}]` : "[]";
}

/** A track sampled at `count` evenly spaced times, as Swift keyframes. */
function frogFrames(move: FrogMove, count: number): string[] {
  const { duration } = FROG_TRACKS[move];
  return Array.from({ length: count }, (_, i) => {
    const p = frogMoveAt(move, (i / count) * duration, true);
    return `        FrogFrame(y: ${num(p.y)}, rot: ${num(p.rot)}, sx: ${num(p.sx)}, sy: ${num(p.sy)}, headY: ${num(p.headY)}, headRot: ${num(p.headRot)}, legs: ${num(p.legs)}, puff: ${num(p.puff)}, blinkL: ${num(p.blinkL)}, blinkR: ${num(p.blinkR)}),`;
  });
}

function frogSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Frog (src/components/frog-art.ts, frog-moves.ts): its parts as draw",
    "// operations with paint roles for each face, the parts its moves add, the",
    "// pivots and the hop and throat puff keyframes. Box 0..100. Do not edit;",
    "// regenerate with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "import CoreGraphics",
    "",
    "public enum FrogStillArt {",
  ];
  const at = (size: number, expression: (typeof FROG_EXPRESSIONS)[number] = "neutral") => frogParts({ expression, size });
  const two = (fn: (ow: number) => FrogOp[]) => frogOps(fn(frogOutline(SHIBA_A)), fn(frogOutline(SHIBA_B)), "        ");
  const z = (op: FrogOp) => op.d.startsWith("M82 12");
  for (const key of ["body", "handL", "handR", "head"] as const) lines.push(`    public static let ${key}: [FrogOp] = ${frogOps(at(SHIBA_A)[key], at(SHIBA_B)[key], "        ")}`);
  for (const key of ["eyeL", "eyeR", "mouth", "extras"] as const) {
    lines.push(`    public static let ${key}: [FrogExpression: [FrogOp]] = [`);
    for (const expression of FROG_EXPRESSIONS) lines.push(`        .${expression}: ${frogOps(at(SHIBA_A, expression)[key], at(SHIBA_B, expression)[key], "            ", z)},`);
    lines.push("    ]");
  }
  lines.push("    /// A move's own lips over the face's (the croak, the open mouth).", "    public static let mouths: [String: [FrogOp]] = [");
  for (const mouth of FROG_MOUTHS) lines.push(`        ${str(mouth)}: ${frogOps(frogMouthOps(mouth, frogOutline(SHIBA_A)), frogMouthOps(mouth, frogOutline(SHIBA_B)), "            ")},`);
  lines.push("    ]");
  lines.push(`    /// The throat sac full; a puff scales it about its top.`, `    public static let throat: [FrogOp] = ${two((ow) => frogThroatOps(1, ow))}`);
  lines.push(`    /// The hind legs kicked out (a hop scales them from the hips), palmate feet behind the body, haunches over it.`);
  lines.push(`    public static let legs: [FrogOp] = ${two((ow) => [...frogLegOps(-1, 1, ow), ...frogLegOps(1, 1, ow)])}`);
  lines.push(`    public static let haunches: [FrogOp] = ${two((ow) => [...frogHaunchOps(-1, 1, ow), ...frogHaunchOps(1, 1, ow)])}`);
  lines.push(`    public static let tongue: [FrogOp] = ${two((ow) => frogTongueOps(FLY_AT, 1, ow))}`);
  lines.push(`    public static let fly: [FrogOp] = ${two((ow) => frogFlyOps(FLY_AT, 0.4, ow))}`);
  lines.push(`    public static let pad: [FrogOp] = ${two((ow) => frogPadOps(ow))}`);
  lines.push("    /// Where each part turns.", "    public static let pivots: [String: CGPoint] = [");
  for (const [name, [x, y]] of Object.entries(FROG_PIVOTS)) lines.push(`        ${str(name)}: CGPoint(x: ${x}, y: ${y}),`);
  lines.push(`        "throatTop": CGPoint(x: ${THROAT_TOP[0]}, y: ${THROAT_TOP[1]}),`, `        "fly": CGPoint(x: ${FLY_AT[0]}, y: ${FLY_AT[1]}),`);
  lines.push("    ]", `    /// The bust an avatar of ${FROG_BUST_MAX} pt or less shows.`, `    public static let bust = CGRect(x: ${FROG_BUST.x}, y: ${FROG_BUST.y}, width: ${FROG_BUST.w}, height: ${FROG_BUST.h})`, `    public static let bustMax: CGFloat = ${FROG_BUST_MAX}`);
  lines.push(`    /// The hop (s) and its keyframes, 24 of them: the jump arc with its squashes.`, `    public static let hopCycle: Double = ${FROG_TRACKS.hop.duration}`, "    public static let hop: [FrogFrame] = [", ...frogFrames("hop", 24), "    ]");
  lines.push(`    /// The throat puff while thinking (s) and its keyframes.`, `    public static let puffCycle: Double = ${FROG_TRACKS.puff.duration}`, "    public static let puff: [FrogFrame] = [", ...frogFrames("puff", 24), "    ]", "}", "");
  return lines.join("\n");
}

const MOODS: ShapeMood[] = ["idle", "thinking", "working", "streaming", "happy", "blocked", "sleeping"];

function swiftArt(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Shapes (`stillFrame` in src/components/shape-engine.ts): each shape's",
    "// resting outline and its two eyes, cut through the body, for each mood",
    "// (`expressionForMood`). Box 0..100. Do not edit; regenerate with",
    "// `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "public enum ShapeStillArt {",
    "    /// Where the clay light sits and how far it spreads (box units).",
  ];
  const sample = stillFrame({ shape: "circle", expression: "neutral", color: "#000000" });
  lines.push(`    public static let light: (x: Double, y: Double, r: Double) = (x: ${sample.light.x}, y: ${sample.light.y}, r: ${sample.light.r})`);
  lines.push("", "    /// The body outline of each shape at rest.", "    public static let body: [MascotShape: String] = [");
  const swiftShape = SWIFT_SHAPE;
  for (const shape of BODY_SHAPES) {
    const frame = stillFrame({ shape, expression: "neutral", color: "#000000" });
    lines.push(`        .${swiftShape[shape]}: "${frame.body}",`);
  }
  lines.push("    ]", "", "    /// The eyes (closed subpaths, cut out with the even-odd rule) per shape and mood.", "    public static let eyes: [MascotShape: [ShapeMood: String]] = [");
  for (const shape of BODY_SHAPES) {
    lines.push(`        .${swiftShape[shape]}: [`);
    for (const mood of MOODS) {
      const frame = stillFrame({ shape, expression: expressionForMood(mood), color: "#000000" });
      lines.push(`            .${mood}: "${frame.eyes}",`);
    }
    lines.push("        ],");
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}


/* ------------------------------------------------------- Shapes engine */

/** The Swift case of each shape id: the same name, but for the two the phone has always called otherwise. */
const SWIFT_SHAPE: Record<string, string> = Object.fromEntries(BODY_SHAPES.map((shape) => [shape, ({ bean: "blob", pick: "triangle" } as Record<string, string>)[shape] ?? shape]));
const lit = (value: number) => String(value);
const numbers = (values: readonly number[]) => values.map(lit).join(", ");

function swiftRing(ring: RingSpec): string {
  return `.init(a: ${lit(ring.a)}, tiltX: ${lit(ring.tiltX)}, tiltZ: ${lit(ring.tiltZ)}, speed: ${lit(ring.speed)}, phase: ${lit(ring.phase)}, sweep: ${lit(ring.sweep)}, hue: ${lit(ring.hue)}, hueSpan: ${lit(ring.hueSpan)}, width: ${lit(ring.width)})`;
}

function shapeEngineSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Shapes engine (src/components/shape-art.ts, shape-engine.ts, shape-moves.ts):",
    "// every number ShapeEngine.swift moves a shape with. Do not edit; regenerate",
    "// with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "/// The sixteen faces (`SHAPE_EXPRESSIONS`), in the desktop's order.",
    "public enum ShapeExpression: String, CaseIterable, Sendable {",
    ...SHAPE_EXPRESSIONS.map((id) => `    case ${id}`),
    "}",
    "",
    "/// The fourteen one-shot moves (`SHAPE_MOVES`), in the editor's order.",
    "public enum ShapeMove: String, CaseIterable, Sendable {",
    ...SHAPE_MOVES.map((id) => `    case ${id}`),
    "}",
    "",
    "public enum ShapeEngineData {",
    `    /// How many radii make a body (\`RADII_COUNT\`).`,
    `    public static let radiiCount = ${RADII_COUNT}`,
    `    /// Where the body sits in the 0..100 box and how many box units one R is (\`BODY\`).`,
    `    public static let bodyCenter: (x: Double, y: Double) = (x: ${lit(BODY.center[0])}, y: ${lit(BODY.center[1])})`,
    `    public static let bodyUnit: Double = ${lit(BODY.unit)}`,
    `    /// A change of shape, face or colour slides over this long, s (\`MORPH_S\`).`,
    `    public static let morphSeconds: Double = ${lit(MORPH_S)}`,
    `    /// One breath, s, and how much it stretches the body (\`BREATH_S\`, \`BREATH_AMOUNT\`).`,
    `    public static let breathSeconds: Double = ${lit(BREATH_S)}`,
    `    public static let breathAmount: Double = ${lit(BREATH_AMOUNT)}`,
    `    /// The blink schedule (\`BLINK\`).`,
    `    public static let blink = ShapeBlink(first: ${lit(BLINK.first)}, minGap: ${lit(BLINK.minGap)}, maxGap: ${lit(BLINK.maxGap)}, length: ${lit(BLINK.length)}, closing: ${lit(BLINK.closing)}, doubleChance: ${lit(BLINK.doubleChance)}, doubleAfter: ${lit(BLINK.doubleAfter)}, floor: ${lit(BLINK.floor)})`,
    `    /// The gaze's turn toward a pointer (\`HOVER\`): degrees, and the ease, s.`,
    `    public static let hover: (yaw: Double, pitch: Double, turn: Double) = (yaw: ${lit(HOVER.yaw)}, pitch: ${lit(HOVER.pitch)}, turn: ${lit(HOVER.turn)})`,
    `    /// The imaginary head's own turn and tilt, degrees (\`HEAD\`), and the face's drop (\`FACE_DROP\`).`,
    `    public static let head: (yaw: Double, pitch: Double) = (yaw: ${lit(HEAD.yaw)}, pitch: ${lit(HEAD.pitch)})`,
    `    public static let faceDrop: Double = ${lit(FACE_DROP)}`,
    `    /// The clay light, R units from the body's middle (\`CLAY_LIGHT\`).`,
    `    public static let clayLight: (x: Double, y: Double, r: Double) = (x: ${lit(CLAY_LIGHT.x)}, y: ${lit(CLAY_LIGHT.y)}, r: ${lit(CLAY_LIGHT.r)})`,
    `    /// The five slow wander loops (\`WANDER\`): period, s, and reach, degrees.`,
    `    public static let wanderYaw: [ShapeLoop] = [${WANDER.yaw.map((l) => `.init(period: ${lit(l.period)}, reach: ${lit(l.reach)})`).join(", ")}]`,
    `    public static let wanderPitch: [ShapeLoop] = [${WANDER.pitch.map((l) => `.init(period: ${lit(l.period)}, reach: ${lit(l.reach)})`).join(", ")}]`,
    `    public static let wanderRoll: [ShapeLoop] = [${WANDER.roll.map((l) => `.init(period: ${lit(l.period)}, reach: ${lit(l.reach)})`).join(", ")}]`,
    `    /// The body the eyes keep around them, R (\`EYE_MARGIN\`); no eye ever fades (2026-10-28).`,
    `    public static let eyeMargin: Double = ${lit(EYE_MARGIN)}`,
    `    /// How much of the body's lean the gaze follows (\`LEAN_GAZE\`).`,
    `    public static let leanGaze: Double = ${lit(LEAN_GAZE)}`,
    `    /// The share of an eye's width the two eyes keep between them (\`EYE_GAP\`).`,
    `    public static let eyeGap: Double = ${lit(EYE_GAP)}`,
    `    /// How thick a body must be to carry the volume's full depth, R (\`DEPTH_FULL\`).`,
    `    public static let depthFull: Double = ${lit(DEPTH_FULL)}`,
    `    /// The pumpkin's stem (\`STEM\`): its foot, its tip from the foot, its bow and its half widths, R.`,
    `    public static let stem: (footX: Double, sink: Double, tipX: Double, tipY: Double, bow: Double, footWidth: Double, tipWidth: Double) = (footX: ${lit(STEM.foot.x)}, sink: ${lit(STEM.foot.sink)}, tipX: ${lit(STEM.tip.x)}, tipY: ${lit(STEM.tip.y)}, bow: ${lit(STEM.bow)}, footWidth: ${lit(STEM.width.foot)}, tipWidth: ${lit(STEM.width.tip)})`,
    `    /// The stem's ink (\`STEM_INK\`).`,
    `    public static let stemInk = "${STEM_INK}"`,
    `    /// The eyes' size, how much of a face's roll they keep, how far apart, how long, where the face rests (R) and how far a turn moves it (\`EYE_SCALE\`, \`EYE_ROLL\`, \`EYE_SPREAD\`, \`EYE_LENGTH\`, \`EYE_SHIFT\`, \`EYE_GAZE\`).`,
    `    public static let eyeScale: (w: Double, h: Double) = (w: ${lit(EYE_SCALE.w)}, h: ${lit(EYE_SCALE.h)})`,
    `    public static let eyeRoll: Double = ${lit(EYE_ROLL)}`,
    `    public static let eyeSpread: Double = ${lit(EYE_SPREAD)}`,
    `    public static let eyeLength: Double = ${lit(EYE_LENGTH)}`,
    `    public static let eyeShift: (x: Double, y: Double) = (x: ${lit(EYE_SHIFT.x)}, y: ${lit(EYE_SHIFT.y)})`,
    `    public static let eyeGaze: Double = ${lit(EYE_GAZE)}`,
    "",
    "    /// Every body, one radius (R) per angle, 0 up, clockwise, and where its face rests (`SHAPE_RADII`, `FACE_ANCHOR`): the geometry file's.",
    "    public static var radii: [MascotShape: [Double]] { ShapeGeometryData.radii }",
    "    public static var faceAnchor: [MascotShape: (x: Double, y: Double)] { ShapeGeometryData.faceAnchor }",
    "    /// The whole bodies some moves turn into (`MOVE_RADII`): the geometry file's.",
    "    public static var moveRadii: [String: [Double]] { ShapeGeometryData.moveBodies }",
    "    /// The sixteen faces (`EXPRESSIONS`): the geometry file's.",
    "    public static var expressions: [ShapeExpression: ShapeFace] { ShapeGeometryData.expressions }",
    `    /// The thought dots of the thinking move and the exclamation mark of alert and exclaim, R (\`THOUGHT_DOTS\`, \`EXCLAIM\`).`,
    `    public static let thoughtDots: [(x: Double, y: Double, r: Double)] = [${THOUGHT_DOTS.map((d) => `(x: ${lit(d.x)}, y: ${lit(d.y)}, r: ${lit(d.r)})`).join(", ")}]`,
    `    public static let exclaim: (x: Double, barTop: Double, barBottom: Double, width: Double, dotY: Double, dotR: Double) = (x: ${lit(EXCLAIM.x)}, barTop: ${lit(EXCLAIM.barTop)}, barBottom: ${lit(EXCLAIM.barBottom)}, width: ${lit(EXCLAIM.width)}, dotY: ${lit(EXCLAIM.dotY)}, dotR: ${lit(EXCLAIM.dotR)})`,
  ];
  lines.push("", "    /// Each move's length and its slide in and out, s (`MOVE_TIMING`).", "    public static let moveTiming: [ShapeMove: (duration: Double, morph: Double)] = [");
  for (const id of SHAPE_MOVES) lines.push(`        .${id}: (duration: ${lit(MOVE_TIMING[id].duration)}, morph: ${lit(MOVE_TIMING[id].morph)}),`);
  lines.push("    ]", "", "    /// The rings of Orbit and Swirl (`ORBIT_RINGS`, `SWIRL_RINGS`).");
  lines.push(`    public static let orbitRings: [ShapeRingSpec] = [`, ...ORBIT_RINGS.map((r) => `        ${swiftRing(r)},`), "    ]");
  lines.push(`    public static let swirlRings: [ShapeRingSpec] = [`, ...SWIRL_RINGS.map((r) => `        ${swiftRing(r)},`), "    ]");
  lines.push("", "    /// The face each mood wears (`expressionForMood` in ShapeMascot.tsx).", "    public static let moodExpression: [ShapeMood: ShapeExpression] = [");
  for (const mood of MOODS) lines.push(`        .${mood}: .${expressionForMood(mood)},`);
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

/** Frames the desktop's engine draws, for ShapeEngineTests: still faces, every move at a few moments, the idle loop, a morph. */
/** A frame as the phone reads it: all of it, its depth included (the phone draws the same slices, shape-volume.ts). */
const phoneFrame = (frame: ShapeFrame) => frame;

function shapeFrames() {
  const shapes = Object.keys(SHAPE_RADII) as (keyof typeof SHAPE_RADII)[];
  const still = SHAPE_EXPRESSIONS.flatMap((expression, i) => {
    const on = [shapes[i % shapes.length], "circle"] as const;
    return [...new Set(on)].map((shape) => ({ shape, expression, frame: stillFrame({ shape, expression, color: "#3b93f0" }) }));
  });
  const seed = 7.25;
  const live: unknown[] = [];
  for (const now of [0, 1.45, 1.5, 3.3, 7.9, 12.6]) live.push({ name: `idle ${now}`, shape: "squircle", expression: "neutral", color: "#e8483f", seed, now, frame: phoneFrame(new ShapeEngine({ shape: "squircle", expression: "neutral", color: "#e8483f" }, 0, seed).frame(now)) });
  SHAPE_MOVES.forEach((move, i) => {
    const shape = shapes[i % shapes.length];
    const { duration, morph } = MOVE_TIMING[move];
    for (const u of [0.15, duration * 0.5, duration + morph * 0.5]) {
      const engine = new ShapeEngine({ shape, expression: "neutral", color: "#3ecf8e" }, 0, seed);
      engine.play(move, 1);
      live.push({ name: `${move} ${Math.round(u * 1000) / 1000}`, shape, expression: "neutral", color: "#3ecf8e", seed, move, moveAt: 1, now: 1 + u, frame: phoneFrame(engine.frame(1 + u)) });
    }
  });
  const morph = new ShapeEngine({ shape: "circle", expression: "neutral", color: "#3b93f0" }, 0, seed);
  morph.set({ shape: "cloud", expression: "happy", color: "#f0b429" }, 2);
  live.push({ name: "morph", shape: "circle", expression: "neutral", color: "#3b93f0", seed, now: 2.2, set: { at: 2, shape: "cloud", expression: "happy", color: "#f0b429" }, frame: phoneFrame(morph.frame(2.2)) });
  const blinks = { seed, until: 30, times: blinkSchedule(seed, 30) };
  return { still: still.map((e) => ({ shape: e.shape, expression: e.expression, body: e.frame.body, eyes: e.frame.eyes })), live, blinks };
}

/* ------------------------------------------------- Shapes volume, motion */

const swiftPose = (p: Pose) => `ShapePose(yaw: ${lit(p.yaw)}, pitch: ${lit(p.pitch)}, roll: ${lit(p.roll)}, scale: ${lit(p.scale)}, lift: ${lit(p.lift)})`;
const triple = (t: { yaw: number; pitch: number; roll: number }) => `(yaw: ${lit(t.yaw)}, pitch: ${lit(t.pitch)}, roll: ${lit(t.roll)})`;
const swiftMotion = (m: MotionSpec) =>
  `ShapeMotionSpec(sway: ${triple(m.sway)}, period: ${triple(m.period)}, lean: ${triple(m.lean)}, breath: (amount: ${lit(m.breath.amount)}, period: ${lit(m.breath.period)}), bob: (amount: ${lit(m.bob.amount)}, period: ${lit(m.bob.period)}), settle: ${lit(m.settle)})`;

/** The volume and motion numbers (shape-volume.ts, shape-motion.ts) the phone's ShapeVolume.swift and ShapeMotion.swift use. */
function shapeVolumeSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Shapes volume and motion (src/components/shape-volume.ts, shape-motion.ts,",
    "// ShapeMascot.tsx): every number ShapeVolume.swift and ShapeMotion.swift",
    "// pose, slice and move a shape with. Do not edit; regenerate with",
    "// `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "/// The motion library's moods (`MOTION_MOODS`).",
    "public enum ShapeMotionMood: String, CaseIterable, Sendable {",
    ...MOTION_MOODS.map((id) => `    case ${id}`),
    "}",
    "",
    "public enum ShapeVolumeData {",
    "    /// The resting pose (`POSE`).",
    `    public static let rest = ${swiftPose(REST_POSE)}`,
    "    /// The body's half thickness (box units), how its edge rounds and how many slices each detail draws (`BODY_3D`).",
    `    public static let depth: Double = ${lit(BODY_3D.depth)}`,
    `    public static let core: Double = ${lit(BODY_3D.core)}`,
    `    public static let slices: [ShapeVolumeDetail: Int] = [.tiny: ${BODY_3D.slices.tiny}, .small: ${BODY_3D.slices.small}, .full: ${BODY_3D.slices.full}]`,
    "    /// Below `small` pt the hairline is thicker; from `full` pt every slice draws (`VOLUME_SIZES`).",
    `    public static let sizes: (small: Double, full: Double) = (small: ${lit(VOLUME_SIZES.small)}, full: ${lit(VOLUME_SIZES.full)})`,
    "    /// How much a turn narrows the body, the out-of-plane bend, and the side's tint on a near-white or near-black body (`TURN_SQUASH`, `OUT_OF_PLANE`, `SIDE_TINT`).",
    `    public static let turnSquash: Double = ${lit(TURN_SQUASH)}`,
    `    public static let sideTint: Double = ${lit(SIDE_TINT)}`,
    `    public static let outOfPlane: (perspective: Double, narrow: Double) = (perspective: ${lit(OUT_OF_PLANE.perspective)}, narrow: ${lit(OUT_OF_PLANE.narrow)})`,
    "    /// The eyes' two inks (`EYE_INK`, `EYE_INK_ON_DARK`).",
    `    public static let eyeInk = "${EYE_INK}"`,
    `    public static let eyeInkOnDark = "${EYE_INK_ON_DARK}"`,
    "    /// Each shape's size in the frame (`SHAPE_FIT`).",
    "    public static let fit: [MascotShape: Double] = [",
    ...Object.entries(SHAPE_FIT).map(([shape, fit]) => `        .${SWIFT_SHAPE[shape]}: ${lit(fit)},`),
    "    ]",
    "",
    "    /// The motion library (`MOTIONS`).",
    "    public static let motions: [ShapeMotionMood: ShapeMotionSpec] = [",
    ...MOTION_MOODS.map((id) => `        .${id}: ${swiftMotion(MOTIONS[id])},`),
    "    ]",
    `    /// The roll's soft limits, the base's drop, the glances, a mood change's slide, the turn toward a pointer and a poke (\`ROLL_LIMIT\`, \`BASE_DROP\`, \`GLANCE\`, \`MOTION_BLEND\`, \`TURN_TOWARD\`, \`POKE\`).`,
    `    public static let rollLimit: (min: Double, max: Double) = (min: ${lit(ROLL_LIMIT.min)}, max: ${lit(ROLL_LIMIT.max)})`,
    `    public static let baseDrop: Double = ${lit(BASE_DROP)}`,
    `    public static let glance: (holdMin: Double, holdMax: Double, move: Double) = (holdMin: ${lit(GLANCE.hold.min)}, holdMax: ${lit(GLANCE.hold.max)}, move: ${lit(GLANCE.move)})`,
    `    public static let motionBlend: Double = ${lit(MOTION_BLEND)}`,
    `    public static let turnToward: (yaw: Double, pitch: Double, settle: Double) = (yaw: ${lit(TURN_TOWARD.yaw)}, pitch: ${lit(TURN_TOWARD.pitch)}, settle: ${lit(TURN_TOWARD.settle)})`,
    `    public static let poke: (length: Double, squash: Double, hop: Double, spin: Double) = (length: ${lit(POKE.length)}, squash: ${lit(POKE.squash)}, hop: ${lit(POKE.hop)}, spin: ${lit(POKE.spin)})`,
    `    /// The live loop's pace at rest, s per frame (\`IDLE_FRAME_S\`).`,
    `    public static let idleFrame: Double = ${lit(IDLE_FRAME_S)}`,
    "",
    "    /// Each shape mood's motion (`motionForMood`) and eyes (`eyeStyleFor`).",
    "    public static let moodMotion: [ShapeMood: ShapeMotionMood] = [",
    ...MOODS.map((mood) => `        .${mood}: .${motionForMood(mood)},`),
    "    ]",
    "    public static let moodEyes: [ShapeMood: ShapeEyeStyle] = [",
    ...MOODS.map((mood) => `        .${mood}: .${eyeStyleFor(mood)},`),
    "    ]",
    "}",
    "",
  ];
  return lines.join("\n");
}

const POSES: Record<string, Pose> = {
  rest: REST_POSE,
  turned: { ...REST_POSE, yaw: 28, pitch: 18, roll: 8 },
  away: { yaw: -22, pitch: -6, roll: -14, scale: 0.79, lift: -3.1 },
};

/** What the desktop's volume draws, for ShapeVolumeTests: matrices, bent outlines and eyes, inks, the ground, motion over time. */
function shapeVolume() {
  const details: VolumeDetail[] = ["tiny", "small", "full"];
  const matrices = details.flatMap((detail) =>
    Object.entries(POSES).flatMap(([pose, p]) => [1, 0.62, 0.2, 0].map((depth) => ({ detail, pose, depth, ...poseMatrices(detail, p, depth) }))),
  );
  const styles: EyeStyle[] = ["capsule", "oval", "arc"];
  const shapes = Object.keys(SHAPE_RADII) as (keyof typeof SHAPE_RADII)[];
  const warps = shapes.flatMap((shape, i) =>
    Object.entries(POSES).map(([pose, p], k) => {
      const expression = k === 2 ? "neutral" : (SHAPE_EXPRESSIONS[(i + k) % SHAPE_EXPRESSIONS.length] as ShapeExpression);
      const open = k === 2 ? 0.4 : 1;
      const frame = gazeFrame({ shape, expression, color: "#000000" }, 0, 0, {}, { left: open, right: open });
      const style = styles[(i + k) % styles.length];
      // the one drawing (drawShape): the outline bent with the resting turn, the eyes in the face's space, the matrices
      const motion = k === 1 ? { x: 2.5, y: -1.5, rot: 14, sx: 1.06, sy: 0.92 } : frame.motion;
      const posed = { ...frame, motion };
      const drawing = drawShape(posed, p, "full", style, true);
      return {
        shape,
        expression,
        open,
        pose,
        style,
        motion,
        sourceBody: frame.body,
        sourceEyes: frame.eyes,
        eyeShapes: frame.eyeShapes,
        body: drawing.outline,
        eyes: drawing.eyes,
        flatEyes: styledEyes(frame.eyes, style),
        stem: drawing.stem?.d ?? null,
        slices: drawing.slices,
        face: drawing.face,
        motionTransform: drawing.motion,
      };
    }),
  );
  const ground = Object.fromEntries(shapes.map((shape) => [shape, groundLift(shape)]));
  const inks = ["#3b93f0", "#F4F4F4", "#ffffff", "#111111", "#000000", "#e8483f", "#f0b429", "#0b0b0e", "#2a2a2a"].map((hex) => ({ hex, ...inkPaint(hex) }));
  const upright = uprightPose(POSES.away);
  const motion = MOTION_MOODS.map((mood, i) => {
    const seed = 3.7 + i;
    const run = new ShapeMotion(mood, seed, 0);
    const poses: { t: number; pose: Pose }[] = [];
    for (let k = 0; k <= 60; k += 1) {
      const t = k * 0.2;
      if (k === 20) run.setMood(mood === "working" ? "idle" : "working", t);
      if (k === 30) run.pointer({ x: 0.8, y: -0.5 });
      if (k === 40) run.pointer(null);
      if (k === 45) run.pokeAt(t);
      poses.push({ t, pose: run.pose(t) });
    }
    return { mood, seed, poses };
  });
  return { matrices, warps, ground, inks, upright, motion };
}

/* ----------------------------------------------------------- Geometry */

const swiftPaintRule = (rule: unknown): string => {
  if (rule === "bot") return ".bot";
  const r = rule as { tint?: number; hex?: string; mix?: { toward: string; t: number } };
  if (r.tint !== undefined) return `.tint(${lit(r.tint)})`;
  if (r.mix) return `.mix(${str(r.mix.toward)}, ${lit(r.mix.t)})`;
  return `.hex(${str(r.hex ?? "#000000")})`;
};

/**
 * The geometry file (shared/mascot-geometry.json) as Swift: the one source
 * of every body, face anchor, move body, face and skin finish, which the
 * phone's engine, volume and paint read instead of a copy of their own.
 */
function geometrySwift(): string {
  const g = GEOMETRY;
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from shared/mascot-geometry.json,",
    "// the one source of the shapes' geometry: every body's 64 radii and face",
    "// anchor, the object shapes' path bodies, the whole bodies some moves turn into, the stem, the eyes, the",
    "// sixteen faces and each skin's base finish. Do not edit; change the JSON and",
    "// regenerate with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "/// A paint of a skin's finish: the bot's colour, a tint of it toward white, a mix toward another colour, or a fixed hex.",
    "public enum ShapePaintRule: Equatable, Sendable {",
    "    case bot",
    "    case tint(Double)",
    "    case hex(String)",
    "    case mix(String, Double)",
    "}",
    "",
    "/// The eyes' ink of a skin: the ink that contrasts with the fill, the pastel's softer ink, or a paint.",
    "public enum ShapeEyesRule: Equatable, Sendable {",
    "    case auto",
    "    case soft",
    "    case paint(ShapePaintRule)",
    "}",
    "",
    "/// One skin's base finish (`shapeSkinBase`).",
    "public struct ShapeSkinRule: Equatable, Sendable {",
    "    public let fill: ShapePaintRule",
    "    public let stroke: ShapePaintRule?",
    "    public let strokeWidth: Double",
    "    public let eyes: ShapeEyesRule",
    "    public let glow: ShapePaintRule?",
    "    public let shine: Bool",
    "    public let fx: String",
    "}",
    "",
    "public enum ShapeGeometryData {",
    `    /// How many radii make a body, where the body sits in the 0..100 box and how many box units one R is.`,
    `    public static let radiiCount = ${g.radiiCount}`,
    `    public static let bodyCenter: (x: Double, y: Double) = (x: ${lit(g.box.center[0])}, y: ${lit(g.box.center[1])})`,
    `    public static let bodyUnit: Double = ${lit(g.box.unit)}`,
    "",
    "    /// Every body, one radius (R) per angle, 0 up, clockwise.",
    "    public static let radii: [MascotShape: [Double]] = [",
  ];
  for (const shape of BODY_SHAPES) lines.push(`        .${SWIFT_SHAPE[shape]}: [${numbers(SHAPE_RADII[shape])}],`);
  lines.push("    ]", "", "    /// Where each body's face rests (R, from the middle; x right, y down).", "    public static let faceAnchor: [MascotShape: (x: Double, y: Double)] = [");
  for (const shape of BODY_SHAPES) lines.push(`        .${SWIFT_SHAPE[shape]}: (x: ${lit(FACE_ANCHOR[shape][0])}, y: ${lit(FACE_ANCHOR[shape][1])}),`);
  lines.push("    ]", "", "    /// The object shapes' path bodies (box units) and their pill eyes (anchor, half width, height): what the app draws.", "    public static let objectBodies: [MascotShape: (path: String, anchor: (x: Double, y: Double), w: Double, h: Double)] = [");
  for (const shape of BODY_SHAPES) {
    const body = (g.shapes as Record<string, { path?: string; eyes?: { anchor: number[]; w: number; h: number } }>)[shape];
    if (body.path && body.eyes) lines.push(`        .${SWIFT_SHAPE[shape]}: (path: ${str(body.path)}, anchor: (x: ${lit(body.eyes.anchor[0])}, y: ${lit(body.eyes.anchor[1])}), w: ${lit(body.eyes.w)}, h: ${lit(body.eyes.h)}),`);
  }
  lines.push("    ]", "", "    /// The whole bodies some moves turn into.", "    public static let moveBodies: [String: [Double]] = [");
  for (const [name, radii] of Object.entries(MOVE_RADII)) lines.push(`        "${name}": [${numbers(radii)}],`);
  lines.push("    ]", "");
  lines.push(`    /// The pumpkin's stem: its foot, its tip from the foot, its bow and its half widths, R.`);
  lines.push(`    public static let stem: (footX: Double, sink: Double, tipX: Double, tipY: Double, bow: Double, footWidth: Double, tipWidth: Double) = (footX: ${lit(STEM.foot.x)}, sink: ${lit(STEM.foot.sink)}, tipX: ${lit(STEM.tip.x)}, tipY: ${lit(STEM.tip.y)}, bow: ${lit(STEM.bow)}, footWidth: ${lit(STEM.width.foot)}, tipWidth: ${lit(STEM.width.tip)})`);
  lines.push(`    /// The resting eye capsule (R) and its tilt.`);
  lines.push(`    public static let eyeCapsule: (w: Double, h: Double, tilt: Double) = (w: ${lit(g.eyes.capsule.w)}, h: ${lit(g.eyes.capsule.h)}, tilt: ${lit(g.eyes.capsule.tilt)})`);
  lines.push("", "    /// The sixteen faces.", "    public static let expressions: [ShapeExpression: ShapeFace] = [");
  const eyeSwift = (e: { w: number; h: number; tilt: number; open: number }) => `.init(w: ${lit(e.w)}, h: ${lit(e.h)}, tilt: ${lit(e.tilt)}, open: ${lit(e.open)})`;
  for (const id of SHAPE_EXPRESSIONS) {
    const face = EXPRESSIONS[id as ShapeExpression];
    lines.push(`        .${id}: .init(yaw: ${lit(face.yaw)}, pitch: ${lit(face.pitch)}, roll: ${lit(face.roll)}, split: ${lit(face.split)}, left: ${eyeSwift(face.left)}, right: ${eyeSwift(face.right)}),`);
  }
  lines.push("    ]", "", "    /// Each skin's base finish.", "    public static let skins: [ShapeSkin: ShapeSkinRule] = [");
  for (const skin of SHAPE_SKINS) {
    const rule = (g.skins as Record<string, { fill: unknown; stroke: unknown; strokeWidth: number; eyes: unknown; glow: unknown; shine: boolean; fx: string }>)[skin];
    const eyes = rule.eyes === "auto" ? ".auto" : rule.eyes === "soft" ? ".soft" : `.paint(${swiftPaintRule(rule.eyes)})`;
    lines.push(`        .${skin}: ShapeSkinRule(fill: ${swiftPaintRule(rule.fill)}, stroke: ${rule.stroke ? swiftPaintRule(rule.stroke) : "nil"}, strokeWidth: ${lit(rule.strokeWidth)}, eyes: ${eyes}, glow: ${rule.glow ? swiftPaintRule(rule.glow) : "nil"}, shine: ${rule.shine ? "true" : "false"}, fx: ${str(rule.fx)}),`);
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

/* ------------------------------------------------------------ HD mascots */

/** The file an asset URL names (the app bundles src/assets/mascots/<character>/ as it is). */
const assetFile = (url: string) => {
  const name = url.split("/").pop()!.split("?")[0];
  return name.replace(/\.webp$/, "");
};

/** The HD manifests (hd-mascots/manifest.ts, shiba-hd.ts) the phone's HdMascotView draws. */
function hdSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// HD mascots (src/components/hd-mascots/manifest.ts and each character's",
    "// manifest): the loops, the stills, the files in the app bundle (the",
    "// desktop's own src/assets/mascots/<character>/ folder) and how the app's",
    "// states map onto them. Do not edit; regenerate with",
    "// `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "/// The looping clips a character can ship (`HD_LOOPS`).",
    "public enum HdLoop: String, CaseIterable, Sendable {",
    ...HD_LOOPS.map((id) => `    case ${id}`),
    "}",
    "",
    "/// The still poses a character can ship (`HD_STILLS`).",
    "public enum HdStill: String, CaseIterable, Sendable {",
    ...HD_STILLS.map((id) => `    case ${id}`),
    "}",
    "",
    "public enum HdMascotData {",
    `    /// Below this box size a loop is not worth decoding: the still shows (\`HD_LOOP_MIN_PX\`).`,
    `    public static let loopMinSize: Double = ${HD_LOOP_MIN_PX}`,
    "    /// Each character's art: its bundle folder, its files and the still behind each loop.",
    "    public static let manifests: [MascotCharacter: HdManifest] = [",
  ];
  for (const [character, m] of Object.entries(HD_MASCOTS)) {
    if (!m) continue;
    lines.push(`        .${character}: HdManifest(`);
    lines.push(`            folder: "${character}",`);
    lines.push(`            px: ${m.px},`);
    lines.push(`            loops: [${HD_LOOPS.map((id) => `.${id}: "${assetFile(m.loops[id])}"`).join(", ")}],`);
    lines.push(`            stills: [${HD_STILLS.map((id) => `.${id}: "${assetFile(m.stills[id])}"`).join(", ")}],`);
    lines.push(`            loopStill: [${HD_LOOPS.map((id) => `.${id}: .${m.loopStill[id]}`).join(", ")}]`);
    lines.push("        ),");
  }
  lines.push("    ]", "", "    /// The app's states onto the art (`HD_STATE_MAP`).", "    public static let stateMap: [String: HdKey] = [");
  for (const [state, key] of Object.entries(HD_STATE_MAP)) lines.push(`        "${state}": ${"loop" in key ? `.loop(.${key.loop})` : `.still(.${key.still})`},`);
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

/* -------------------------------------------------------------- Grump */

const GRUMP_SWIFT = join(ROOT, "ios/Sources/CompanionCore/GrumpStillArt.swift");
const GRUMP_PALETTE_FIXTURE = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/grump-palettes.json");
/** The skins whose palette follows the bot color: the phone computes them (GrumpArt.swift), checked against this fixture. */
const GRUMP_HEX_SKINS = ["plain", "void", "neon", "retro98"] as const;

const swiftString = (value: string) => JSON.stringify(value);
const swiftOp = (op: GrumpOp) =>
  `.init(d: ${swiftString(op.d)}, fill: ${op.fill ? `.${op.fill}` : "nil"}, stroke: ${op.stroke ? `.${op.stroke}` : "nil"}, width: ${op.width ?? 0}, opacity: ${op.opacity ?? 1}, clip: ${op.clip ? swiftString(op.clip) : "nil"}, round: ${op.round ? "true" : "false"})`;

function grumpSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Grump (`grumpParts` in src/components/grump-art.ts, the palettes of",
    "// skin-fx/grump-skins.tsx flattened): the sitting drawing as paint",
    "// operations with paint roles, the whole box (`full`) and the bust under",
    "// 48 pt (`bust`), each of the sixteen faces, and the palette of every skin",
    "// that does not follow the bot color. Box 0..100. Do not edit; regenerate",
    "// with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "/// What a part is painted with; a skin maps each role to a color.",
    `public enum GrumpRole: String, CaseIterable, Sendable {`,
    `    case ${GRUMP_ROLES.join(", ")}`,
    "}",
    "",
    "/// One drawing operation: a path filled and/or stroked with roles, maybe clipped to another path.",
    "public struct GrumpStillOp: Sendable {",
    "    public let d: String",
    "    public let fill: GrumpRole?",
    "    public let stroke: GrumpRole?",
    "    public let width: Double",
    "    public let opacity: Double",
    "    public let clip: String?",
    "    public let round: Bool",
    "}",
    "",
    "/// The sitting Grump at one scale: what lies under the face, each face, what lies over it.",
    "public struct GrumpStillLayers: Sendable {",
    "    /// The body, the tail, the ears and the head.",
    "    public let under: [GrumpStillOp]",
    "    /// Per expression: the brows, the eyes, the nose, the mouth and the extras.",
    "    public let faces: [String: [GrumpStillOp]]",
    "    /// The folded paws.",
    "    public let over: [GrumpStillOp]",
    "}",
    "",
    "public enum GrumpStillArt {",
    `    /// The sixteen faces, the Shapes ids.`,
    `    public static let expressions: [String] = [${GRUMP_EXPRESSIONS.map(swiftString).join(", ")}]`,
    `    /// The bust crop under 48 pt (x, y, width, height).`,
    `    public static let bustCrop: (x: Double, y: Double, w: Double, h: Double) = (x: ${GRUMP_BUST.x}, y: ${GRUMP_BUST.y}, w: ${GRUMP_BUST.w}, h: ${GRUMP_BUST.h})`,
  ];
  for (const [name, size] of [["full", 120], ["bust", 32]] as const) {
    const base = grumpParts({ expression: "neutral", size });
    lines.push("", `    public static let ${name} = GrumpStillLayers(`, "        under: [");
    for (const op of [...base.body, ...base.tail, ...base.earL, ...base.earR, ...base.head]) lines.push(`            ${swiftOp(op)},`);
    lines.push("        ],", "        faces: [");
    for (const expression of GRUMP_EXPRESSIONS) {
      const parts = grumpParts({ expression, size });
      lines.push(`            ${swiftString(expression)}: [`);
      for (const op of [...parts.brows, ...parts.eyeL, ...parts.eyeR, ...parts.nose, ...parts.mouth, ...parts.extras]) lines.push(`                ${swiftOp(op)},`);
      lines.push("            ],");
    }
    lines.push("        ],", "        over: [");
    for (const op of base.paws) lines.push(`            ${swiftOp(op)},`);
    lines.push("        ]", "    )");
  }
  lines.push("", "    /// The skins with a palette of their own (the bot color does not change them), flattened.", "    public static let skinPalettes: [String: [GrumpRole: String]] = [");
  for (const skin of GRUMP_SKIN_IDS) {
    if ((GRUMP_HEX_SKINS as readonly string[]).includes(skin)) continue;
    const palette = grumpFlatPalette(skin, "#808080");
    lines.push(`        ${swiftString(skin)}: [${GRUMP_ROLES.map((role) => `.${role}: ${swiftString(palette[role])}`).join(", ")}],`);
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

function grumpPaletteFixture() {
  return {
    note: "Generated by src/components/ios-mascot-export.test.ts from skin-fx/grump-skins.tsx (grumpFlatPalette). Do not edit.",
    skins: GRUMP_HEX_SKINS,
    colors: Object.fromEntries(Object.entries(MASCOT_COLOR_HEX).map(([name, hex]) => [name, Object.fromEntries(GRUMP_HEX_SKINS.map((skin) => [skin, grumpFlatPalette(skin, hex)]))])),
  };
}


/* ------------------------------------------------------------- Ogre */

/** Two sizes on either side of the bust: their outlines give each width as a + b * outline. */
const OGRE_FULL = 80;
const OGRE_BUST = 40;

function ogreSwiftOps(full: readonly OgreOp[], bust: readonly OgreOp[], indent: string): string {
  const k = ogreOutline(OGRE_BUST) - ogreOutline(OGRE_FULL);
  const ops = full.map((op, i) => {
    const other = bust[i]!;
    expect(other.d).toBe(op.d);
    const fields = [`d: "${op.d}"`];
    if (op.fill) fields.push(`fill: "${op.fill}"`);
    if (op.stroke) {
      const w = op.width ?? 1;
      const slope = Math.round((((other.width ?? 1) - w) / k) * 1e4) / 1e4;
      const base = Math.round((w - slope * ogreOutline(OGRE_FULL)) * 1e4) / 1e4;
      fields.push(`stroke: "${op.stroke}"`, `width: (${base}, ${slope})`);
    }
    if (op.opacity !== undefined) fields.push(`opacity: ${op.opacity}`);
    if (op.clip) fields.push(`clip: "${op.clip}"`);
    if (op.round) fields.push("round: true");
    return `${indent}Op(${fields.join(", ")}),`;
  });
  return ops.join("\n");
}

function swiftOgre(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Ogre (`ogreParts` in src/components/ogre-art.ts, the approved head and",
    "// shoulders at rest): each part as draw operations with paint roles, every",
    "// face, the skins' fixed colors (`ogreSkinPaint`, a gradient as its solid",
    "// base) and palette samples for the tests. Box 0..100; a stroke's width is",
    "// a + b * outline. Do not edit; regenerate with",
    "// `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "public enum OgreStillArt {",
    "    /// One drawing operation: a path filled and/or stroked with paint roles, maybe clipped.",
    "    public struct Op: Sendable {",
    "        public let d: String",
    "        public var fill: String? = nil",
    "        public var stroke: String? = nil",
    "        public var width: (Double, Double) = (1, 0)",
    "        public var opacity: Double? = nil",
    "        public var clip: String? = nil",
    "        public var round = false",
    "    }",
    "",
    "    /// A face: the layers every expression swaps, and what it adds (in a bust, without the z).",
    "    public struct Face: Sendable {",
    "        public let brows: [Op]",
    "        public let eyeL: [Op]",
    "        public let eyeR: [Op]",
    "        public let mouth: [Op]",
    "        public let extras: [Op]",
    "        public let bustExtras: [Op]",
    "    }",
    "",
  ];
  const at = (expression: (typeof OGRE_EXPRESSIONS)[number], size: number, marks: "cracks" | "rivets" | null = null): OgreParts => ogreParts({ expression, size, marks });
  lines.push("    /// The parts that never change with the face, plain and with each skin's marks: body, earL, earR, head, nose.", "    public static let parts: [String: [String: [Op]]] = [");
  for (const marks of [null, "cracks", "rivets"] as const) {
    const full = at("neutral", OGRE_FULL, marks);
    const bust = at("neutral", OGRE_BUST, marks);
    lines.push(`        "${marks ?? "plain"}": [`);
    for (const key of ["body", "earL", "earR", "head", "nose"] as const) lines.push(`            "${key}": [`, ogreSwiftOps(full[key], bust[key], "                "), "            ],");
    lines.push("        ],");
  }
  lines.push("    ]", "", "    /// The sixteen faces (the Shapes' ids).", "    public static let faces: [String: Face] = [");
  for (const expression of OGRE_EXPRESSIONS) {
    const full = at(expression, OGRE_FULL);
    const bust = at(expression, OGRE_BUST);
    lines.push(`        "${expression}": Face(`);
    for (const key of ["brows", "eyeL", "eyeR", "mouth"] as const) lines.push(`            ${key}: [`, ogreSwiftOps(full[key], bust[key], "                "), "            ],");
    // the z is left out of a bust: its extras are their own list
    lines.push("            extras: [", ogreSwiftOps(full.extras, full.extras, "                "), "            ],");
    lines.push("            bustExtras: [", ogreSwiftOps(bust.extras, bust.extras, "                "), "            ]");
    lines.push("        ),");
  }
  lines.push("    ]", "");
  // each skin's colors that do not depend on the bot color (a gradient drawn as its solid base)
  const SOLID: Record<string, string> = { crack: "#FF8A1F", plate: "#A9B4BF", dither: "#008000", ditherVest: "#000000", gold: "#D9A333", chrome: "#8C98A6", pearl: "#E3E9FF", rock: "#2A120C" };
  const solid = (paint: string) => {
    const name = /^url\(#u-([a-zA-Z]+)\)$/.exec(paint)?.[1];
    return name ? SOLID[name]! : paint.toUpperCase();
  };
  lines.push("    /// Each skin's own colors (the roles it paints whatever the bot color), over the plain palette; and its marks.", "    public static let skins: [String: (colors: [String: String], marks: String?)] = [");
  for (const skin of OGRE_SKINS) {
    const a = ogreSkinPaint(skin, "#377FE6", "u");
    const b = ogreSkinPaint(skin, "#D94B52", "u");
    const fixed = Object.keys(a.palette)
      .filter((role) => a.palette[role as keyof typeof a.palette] === b.palette[role as keyof typeof b.palette] && skin !== "plain")
      .map((role) => `"${role}": "${solid(a.palette[role as keyof typeof a.palette])}"`);
    lines.push(`        "${skin}": (colors: [${fixed.length ? fixed.join(", ") : ":"}], marks: ${a.marks ? `"${a.marks}"` : "nil"}),`);
  }
  lines.push("    ]", "", "    /// The plain palette the desktop paints for each bot color (the phone computes it; the tests compare).", "    public static let paletteSamples: [String: (skin: String, vest: String, line: String, tunicShade: String)] = [");
  for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
    const p = ogrePalette(hex);
    lines.push(`        "${name}": (skin: "${p.skin.toUpperCase()}", vest: "${p.vest.toUpperCase()}", line: "${p.line.toUpperCase()}", tunicShade: "${p.tunicShade.toUpperCase()}"),`);
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

function check(path: string, content: string) {
  if (UPDATE) {
    writeFileSync(path, content);
    return;
  }
  // a Windows checkout can hand these files over with CRLF; the content is what is compared
  expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), `${path} is out of date: run UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`).toBe(content);
}

describe("the phone's copy of the mascot looks", () => {
  it("lists every look the desktop can store, with what the desktop reads", () => {
    check(FIXTURE, `${JSON.stringify(fixture(), null, 2)}\n`);
  });

  it("carries the Shapes still frames the desktop draws", () => {
    check(SWIFT_ART, swiftArt());
  });

  it("carries the geometry file: every body, face anchor, move body, face and skin finish, from the one source", () => {
    check(SWIFT_GEOMETRY, geometrySwift());
  });

  it("carries the Shapes engine's numbers and frames it draws, every face and every move", () => {
    check(SWIFT_SHAPE_ENGINE, shapeEngineSwift());
    check(SHAPE_FRAMES, `${JSON.stringify(shapeFrames(), null, 1)}\n`);
  });

  it("carries the Shapes volume and motion: the slices, the bend, the eyes, the inks, the ground and the moves over time", () => {
    check(SWIFT_SHAPE_VOLUME, shapeVolumeSwift());
    check(SHAPE_VOLUME, `${JSON.stringify(shapeVolume(), null, 1)}\n`);
  });

  it("carries the HD mascots' manifests and state map", () => {
    check(SWIFT_HD, hdSwift());
  });

  it("carries Shiba's parts, faces, pivots and walk cycle as the desktop draws them", () => {
    check(SWIFT_SHIBA, shibaSwift());
  });

  it("carries Grump's still drawing, its sixteen faces and its skins' palettes", () => {
    check(GRUMP_SWIFT, grumpSwift());
    check(GRUMP_PALETTE_FIXTURE, `${JSON.stringify(grumpPaletteFixture(), null, 2)}\n`);
  });

  it("carries Ogre's still drawing, its faces and its skins' colors", () => {
    check(OGRE_ART_SWIFT, swiftOgre());
  });

  it("carries Frog's parts, faces, move parts, pivots and keyframes as the desktop draws them", () => {
    check(SWIFT_FROG, frogSwift());
  });

  it("covers every known character, shape and skin", () => {
    const looks = lookCases();
    for (const character of MASCOT_CHARACTERS) expect(looks.some((c) => (c.expected as { character: string }).character === character)).toBe(true);
    expect(looks.filter((c) => c.name.startsWith("shape ")).length).toBe(BODY_SHAPES.length * SHAPE_SKINS.length);
  });
});
