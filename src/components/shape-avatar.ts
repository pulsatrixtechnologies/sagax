// The shapes, drawn by the open-bot-avatar engine (MIT, see NOTICE; #4145):
// every shape id of the app is one avatar definition of the engine (a body
// path in a 0 0 100 100 box and where the eyes sit). The engine infers the
// body's volume from the outline, turns it, breathes, blinks and follows the
// pointer; ShapeMascot.tsx draws its frames (avatarFrame) live for the large
// mascots and as a still everywhere else.
//
// The stills are baked (src/components/shape-stills, by
// scripts/bake-engine-shapes.mjs): the engine infers a body's volume once,
// at bake time, so a sidebar of forty bots never runs that inference on the
// page; only the live mascot and a person's own drawing do.
//
// Where the engine's examples or gallery already draw a shape (the star, the
// mug, the rocket...), the shape id points at that definition; the other
// bodies are our own, baked from shared/mascot-geometry.json into
// shared/shape-avatars.json by scripts/bake-engine-shapes.mjs. The gallery's
// other avatars are shapes of their own in the picker (GALLERY_SHAPES).
import { avatarFrame, getExample, validateAvatar, type AvatarDefinition, type AvatarFrame, type AvatarMood, type AvatarMotion, type AvatarMotionBlend, type AvatarState, type EyeMark, type FrameShape, type Matrix } from "open-bot-avatar";
import baked from "../../shared/shape-avatars.json" with { type: "json" };
import type { MascotShape } from "../../shared/mascot-look.ts";
import { isEngineAvatarDef, type EngineAvatarDef } from "../../shared/engine-avatar-def.ts";
import type { MascotAvatarDef } from "../../shared/mascot-look.ts";
import type { ShapeAvatarDef } from "../../shared/shape-avatar-def.ts";
import { isObjectShapeId } from "../../shared/shape-avatar-presets.ts";
import { boxFit, fitPath, flattenPath, liveOutlineFromDef, smoothClosedOutline } from "../../shared/shape-avatar-outline.ts";
import book from "../../third_party/open-bot-avatar/gallery/book.json" with { type: "json" };
import brain from "../../third_party/open-bot-avatar/gallery/brain.json" with { type: "json" };
import bull from "../../third_party/open-bot-avatar/gallery/bull.json" with { type: "json" };
import bunny from "../../third_party/open-bot-avatar/gallery/bunny.json" with { type: "json" };
import camera from "../../third_party/open-bot-avatar/gallery/camera.json" with { type: "json" };
import cat from "../../third_party/open-bot-avatar/gallery/cat.json" with { type: "json" };
import cloud from "../../third_party/open-bot-avatar/gallery/cloud.json" with { type: "json" };
import ghost from "../../third_party/open-bot-avatar/gallery/ghost.json" with { type: "json" };
import magnifier from "../../third_party/open-bot-avatar/gallery/magnifier.json" with { type: "json" };
import paintBrush from "../../third_party/open-bot-avatar/gallery/paint-brush.json" with { type: "json" };
import palette from "../../third_party/open-bot-avatar/gallery/palette.json" with { type: "json" };
import rocket from "../../third_party/open-bot-avatar/gallery/rocket.json" with { type: "json" };
import shield from "../../third_party/open-bot-avatar/gallery/shield.json" with { type: "json" };
import star from "../../third_party/open-bot-avatar/gallery/star.json" with { type: "json" };
import witchHat from "../../third_party/open-bot-avatar/gallery/witch-hat.json" with { type: "json" };

/** The engine's gallery (third_party/open-bot-avatar/gallery, copied verbatim), by id. */
const GALLERY: Readonly<Record<string, unknown>> = {
  book, brain, bull, bunny, camera, cat, cloud, ghost, magnifier, "paint-brush": paintBrush, palette, rocket, shield, star, "witch-hat": witchHat,
};

type BakedShape = { engine: string } | { own: unknown };
const SHAPES = baked.shapes as Readonly<Record<string, BakedShape>>;

/** A definition from the baked file, the gallery or the package's examples, checked once. */
function checked(value: unknown, id: string): AvatarDefinition {
  const result = validateAvatar(value);
  if (!result.ok) throw new Error(`shape ${id}: ${result.errors.join("; ")}`);
  return result.value;
}

function engineDefinition(id: string): AvatarDefinition | undefined {
  const example = getExample(id);
  if (example) return example;
  return GALLERY[id] ? checked(GALLERY[id], id) : undefined;
}

const BY_SHAPE = new Map<string, AvatarDefinition>();

/** The engine's definition of a shape id (any id of MASCOT_SHAPES). */
export function shapeDefinition(shape: MascotShape): AvatarDefinition {
  const cached = BY_SHAPE.get(shape);
  if (cached) return cached;
  const entry = SHAPES[shape];
  const def = entry ? ("engine" in entry ? engineDefinition(entry.engine) : checked(entry.own, shape)) : engineDefinition(shape);
  const resolved = def ?? shapeDefinition("circle");
  BY_SHAPE.set(shape, resolved);
  return resolved;
}

const BY_OWN = new WeakMap<ShapeAvatarDef, AvatarDefinition>();

/**
 * A person's own drawing (mascotLook.avatarDef, the older portable format) in
 * the engine's terms: its body path and its eyes. A saved copy of an object
 * preset follows the current shape of that id; a drawing the engine cannot
 * take (outside the box, eyes off the body) falls back to the bot's shape.
 */
export function ownDefinition(def: ShapeAvatarDef, shape: MascotShape): AvatarDefinition {
  if (def.id && isObjectShapeId(def.id)) return shapeDefinition(def.id);
  const cached = BY_OWN.get(def);
  if (cached) return cached;
  const outline = liveOutlineFromDef(def);
  // a body of radii (64, angle 0 up, clockwise, in R) drawn as our radial bodies are
  const radii = def.body.kind === "radii" ? def.body.radii : null;
  const path = outline.pathBody
    ? [outline.path, ...outline.extras].join("")
    : radii?.length
      ? smoothClosedOutline(radii.map((r, i) => {
        const a = (i / radii.length) * Math.PI * 2;
        return [50 + r * Math.sin(a) * 40, 50 - r * Math.cos(a) * 40] as [number, number];
      }))
      : "";
  // fitted into the engine's safe area (8..92), the eyes moved and sized with the body
  const fit = path ? boxFit(flattenPath(path).flat()) : null;
  const [x, y] = fit ? fit.at(outline.face) : outline.face;
  const result = fit
    ? validateAvatar({
      version: 1,
      id: (def.id ?? "custom").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom",
      name: (def.name ?? "Custom").replace(/[<>]/g, "").slice(0, 40) || "Custom",
      body: { path: fitPath(path, fit) },
      eyes: { x, y, spacing: Math.max(8, outline.eye.gap * fit.scale), scale: Math.min(1.6, Math.max(0.6, (outline.eye.h * fit.scale) / 14)) },
    })
    : null;
  const resolved = result?.ok ? result.value : shapeDefinition(shape);
  BY_OWN.set(def, resolved);
  return resolved;
}

const BY_PASTED = new WeakMap<EngineAvatarDef, AvatarDefinition>();

/** A pasted open-bot-avatar definition (#4160): the engine's own, checked again; one it refuses falls back to the bot's shape. */
export function pastedDefinition(def: EngineAvatarDef, shape: MascotShape): AvatarDefinition {
  const cached = BY_PASTED.get(def);
  if (cached) return cached;
  const result = validateAvatar(def);
  const resolved = result.ok ? result.value : shapeDefinition(shape);
  BY_PASTED.set(def, resolved);
  return resolved;
}

/** The definition a bot's look draws. */
export function lookDefinition(shape: MascotShape, avatarDef?: MascotAvatarDef): AvatarDefinition {
  if (!avatarDef) return shapeDefinition(shape);
  return isEngineAvatarDef(avatarDef) ? pastedDefinition(avatarDef, shape) : ownDefinition(avatarDef, shape);
}

/** The catalog shape whose baked still a look draws: its own shape, a saved object preset, or none for a person's own drawing. */
export function bakedShapeFor(shape: MascotShape, avatarDef?: MascotAvatarDef): MascotShape | null {
  if (!avatarDef) return shape;
  if (isEngineAvatarDef(avatarDef)) return null;
  return avatarDef.id && isObjectShapeId(avatarDef.id) ? avatarDef.id : null;
}

/** The app's moods for a shape (Avatar.tsx shapeMoodFor maps the bot's state onto them). */
export type ShapeMood = "idle" | "thinking" | "working" | "streaming" | "happy" | "blocked" | "sleeping";

/** The engine's mood for a shape mood: at work it thinks, done it is happy, else at rest. */
export function engineMood(mood: ShapeMood): AvatarMotion {
  if (mood === "thinking" || mood === "working" || mood === "streaming" || mood === "blocked") return "thinking";
  if (mood === "happy") return "happy";
  return "idle";
}

/**
 * What a shape draws, in the engine's terms (#5349): the state the bot is in
 * (from its activity, AgentState in src/lib/mascot.ts), the mood over it, and
 * `motion`, the app's own pose for a bot at rest (one of the three baked
 * moods), or null while a state other than idle shows.
 *
 * - At rest the bot keeps the face it had: idle, happy, or the at-work pose
 *   of a bot whose own face is a working one (engineFrame).
 * - A state from the bot's activity wins over that face.
 * - `thinking` keeps that at-work body too (#5415): the engine's own thinking
 *   replaces the body with three dots, which the sidebar would show as the
 *   bot's icon and the person would take for a "..." menu.
 * - The person's mood (happy) shapes the eyes on top of any state; a finished
 *   turn (done) is happy, as it was before the states.
 */
export interface EnginePose {
  state: AvatarState;
  mood: AvatarMood;
  motion: AvatarMotion | null;
}

export function enginePose(mood: ShapeMood, state: AvatarState = "idle", moodSetting: AvatarMood = "neutral"): EnginePose {
  // thinking: keep the body via motion (engineFrame), never the engine's three
  // dots; state stays "thinking" so data-agent-state and the animator age it (#5415)
  if (state === "thinking") {
    const happy = moodSetting === "happy";
    return { state: "thinking", mood: happy ? "happy" : "neutral", motion: happy ? "happy" : "thinking" };
  }
  if (state !== "idle") return { state, mood: moodSetting === "happy" || state === "done" ? "happy" : "neutral", motion: null };
  const motion = moodSetting === "happy" ? "happy" : engineMood(mood);
  return { state: "idle", mood: motion === "happy" ? "happy" : "neutral", motion };
}

/**
 * The pose a shape holds at work, as the engine drew its `thinking` until
 * 0.2: the body turned a little, tipped up and rolled, the eyes up and away
 * under two different lids. Since 0.3 the engine's `thinking` replaces the
 * body with three dots; the app keeps the bot's own body at work (its look
 * changes only with the owner's word, shape-object-look.regression.test.ts),
 * so this pose is asked of the engine's `idle` instead.
 */
const AT_WORK = { yaw: 0.12, pitch: 0.08, gazeX: 0.55, gazeY: -0.8, lids: [0.22, 0.32] as const };
/** The engine's own figures a look target goes through (its motion.ts: LOOK_YAW, LOOK_PITCH, LOOK_EYES, BASE_YAW, BASE_PITCH). */
const LOOK = { yaw: 0.32, pitch: 0.18, eyes: 0.7, baseYaw: -0.3, basePitch: 0.2 };

/** A pill eye under a lid, as the engine squints one (its eyeStates): shorter, never under 0.55 of its width, a little lower. */
function underLid(mark: EyeMark, lid: number): EyeMark {
  if (mark.shape !== "pill") return mark;
  const height = Math.max(mark.height * (1 - lid * 0.4), mark.width * 0.55);
  const middle = mark.y + mark.height / 2 + (mark.height - height) * 0.18;
  return { shape: "pill", x: mark.x, y: middle - height / 2, width: mark.width, height, radius: Math.min(mark.width, height) / 2 };
}

export interface EngineFrameOptions {
  time?: number;
  gaze?: { x: number; y: number; weight?: number };
  motionBlend?: AvatarMotionBlend;
  reducedMotion: boolean;
  depth?: number;
}

/**
 * One frame of a body in one of the app's three engine moods. `idle` and
 * `happy` are the engine's own; `thinking` is the at-work pose above, with
 * the roll and the lift of the engine's `thinking` (its root motion, which
 * 0.3 kept) over the body it no longer draws there.
 */
export function engineFrame(def: AvatarDefinition, mood: AvatarMotion, options: EngineFrameOptions): AvatarFrame {
  const depth = options.depth === undefined ? {} : { depth: options.depth };
  if (mood !== "thinking") return avatarFrame(def, { motion: mood, time: options.time, gaze: options.gaze, motionBlend: options.motionBlend, reducedMotion: options.reducedMotion, ...depth });
  // at rest the eyes take the whole look and the body stays; live, the engine gives the eyes a share and turns the body toward
  // the target, so the target is set further out and the view takes that turn back: the pose is the same either way
  const still = options.reducedMotion;
  const gaze = still ? { x: AT_WORK.gazeX, y: AT_WORK.gazeY } : { x: AT_WORK.gazeX / LOOK.eyes, y: -1 };
  const view = still
    ? { yaw: AT_WORK.yaw, pitch: AT_WORK.pitch }
    : { yaw: AT_WORK.yaw - (gaze.x * LOOK.yaw - LOOK.baseYaw), pitch: AT_WORK.pitch - (-gaze.y * LOOK.pitch - LOOK.basePitch / 2) };
  const body = avatarFrame(def, { state: "idle", mood: "neutral", view, gaze, time: options.time, reducedMotion: still, ...depth });
  const { root } = avatarFrame(def, { state: "thinking", time: options.time, reducedMotion: still, ...depth });
  return { ...body, root, shapes: body.shapes.map((shape) => (shape.kind === "eye" ? { ...shape, mark: underLid(shape.mark, AT_WORK.lids[shape.key === "eye-0" ? 0 : 1]) } : shape)) };
}

/** One cross-section path of a still: its id in the frame, its outline, its fill rule, the area of its box (the largest is the face a skin paints). */
export type StillPath = [id: string, d: string, evenOdd: boolean, area: number];

/** One frame of a body flattened by the engine (avatarFrame), without its colours. */
export interface StillFrame {
  paths: readonly StillPath[];
  /** The 2D motion (hop, roll, squash) about the body's base, applied to every shape. */
  root: Matrix;
  /** Back to front: the cross-sections and the eyes. */
  shapes: readonly FrameShape[];
}

/** A body's still in each of the engine's moods, sharing its paths. */
export interface BakedStill {
  paths: readonly StillPath[];
  moods: Readonly<Record<AvatarMotion, { root: Matrix; shapes: readonly FrameShape[] }>>;
}

/**
 * A still as src/components/shape-stills holds it, compact: the outlines
 * once ([d, 1 for evenodd, the area of its box]), then per mood the root matrix and the shapes
 * back to front, a cross-section as [outline index, matrix...] and an eye as
 * [its mark, matrix...].
 */
export interface StillFile {
  p: [d: string, evenOdd: 0 | 1, area: number][];
  m: Record<AvatarMotion, { r: Matrix; s: (number | EyeMark)[][] }>;
}

const MOODS: readonly AvatarMotion[] = ["idle", "thinking", "happy"];
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const r4 = (n: number) => Math.round(n * 10000) / 10000 || 0;
/** A matrix as the engine writes it (four places for the linear part, two for the shift). */
const roundMatrix = (m: Matrix): Matrix => m.map((v, i) => (i < 4 ? r4(v) : r2(v))) as Matrix;
const roundMark = (mark: EyeMark): EyeMark => {
  // an eye between two shapes is an outline of its own (the engine's morph, 0.3): kept as it is
  if (mark.shape === "path") return mark;
  return mark.shape === "arc" ? { ...mark, strokeWidth: r2(mark.strokeWidth) } : { shape: "pill", x: r2(mark.x), y: r2(mark.y), width: r2(mark.width), height: r2(mark.height), radius: r2(mark.radius) };
};

/**
 * A definition's still in every mood, at rest (reduced motion: no breath, no
 * blink), in the compact form the bake writes: the engine's volume
 * inference runs here, once. The bake script writes it for every shape; a
 * person's own drawing gets it at run time.
 */
export function bakeStill(def: AvatarDefinition, depth?: number): StillFile {
  const index = new Map<string, number>();
  const p: StillFile["p"] = [];
  const m = {} as StillFile["m"];
  for (const motion of MOODS) {
    const frame = engineFrame(def, motion, { reducedMotion: true, depth });
    const byId = new Map(frame.paths.map((path) => [path.id, path]));
    m[motion] = {
      r: roundMatrix(frame.root),
      // the engine's ribbons (its working and done states) are no part of a still
      s: frame.shapes.filter((shape) => shape.kind !== "ribbon").map((shape) => {
        if (shape.kind === "eye") return [roundMark(shape.mark), ...roundMatrix(shape.matrix)];
        let at = index.get(shape.path);
        if (at === undefined) {
          const path = byId.get(shape.path)!;
          index.set(shape.path, (at = p.length));
          p.push([path.d, path.evenOdd ? 1 : 0, Math.round(path.box.w * path.box.h)]);
        }
        return [at, ...roundMatrix(shape.matrix)];
      }),
    };
  }
  return { p, m };
}

/** A still file read back into frames (an outline's id is its index). */
export function readStill(file: StillFile): BakedStill {
  const paths: StillPath[] = file.p.map(([d, evenOdd, area], i) => [`s${i}`, d, evenOdd === 1, area]);
  const moods = {} as Record<AvatarMotion, { root: Matrix; shapes: FrameShape[] }>;
  for (const motion of MOODS) {
    const at = file.m[motion] ?? file.m.idle;
    let eyes = 0;
    moods[motion] = {
      root: at.r,
      shapes: at.s.map(([head, ...rest]): FrameShape => {
        const matrix = rest as number[] as Matrix;
        if (typeof head === "number") return { kind: "slice", key: `s${head}`, path: `s${head}`, matrix };
        return { kind: "eye", key: eyes++ === 0 ? "eye-0" : "eye-1", matrix, mark: head };
      }),
    };
  }
  return { paths, moods };
}

/** A baked still's frame in one mood, with only the paths that mood draws. */
export function moodFrame(still: BakedStill, mood: AvatarMotion): StillFrame {
  const at = still.moods[mood] ?? still.moods.idle;
  const used = new Set(at.shapes.map((shape) => (shape.kind === "slice" ? shape.path : "")));
  return { paths: still.paths.filter(([id]) => used.has(id)), root: at.root, shapes: at.shapes };
}

const BY_DEF = new WeakMap<AvatarDefinition, Map<number, BakedStill>>();
/** The still of a definition no bake holds (a person's own drawing, the Outline skin's flat body), inferred once per definition and depth. */
export function runtimeStill(def: AvatarDefinition, depth?: number): BakedStill {
  let byDepth = BY_DEF.get(def);
  if (!byDepth) BY_DEF.set(def, (byDepth = new Map()));
  const key = depth ?? -1;
  let still = byDepth.get(key);
  if (!still) byDepth.set(key, (still = readStill(bakeStill(def, depth))));
  return still;
}

const BY_STATE = new WeakMap<AvatarDefinition, Map<string, StillFrame>>();
/**
 * The still of a state other than idle (#5349): the engine's own frame for
 * it at rest (reduced motion: the marks hold still, no ribbon), drawn the
 * first time a bot of that shape is in that state and kept. Only the bots
 * doing something ask for one; a bot at rest keeps its baked still.
 */
export function stateStill(def: AvatarDefinition, state: AvatarState, mood: AvatarMood, depth?: number): StillFrame {
  let byKey = BY_STATE.get(def);
  if (!byKey) BY_STATE.set(def, (byKey = new Map()));
  const key = `${state}|${mood}|${depth ?? ""}`;
  let still = byKey.get(key);
  if (!still) {
    const frame = avatarFrame(def, { state, mood, reducedMotion: true, ...(depth === undefined ? {} : { depth }) });
    still = {
      paths: frame.paths.map((path): StillPath => [path.id, path.d, path.evenOdd, path.box.w * path.box.h]),
      root: frame.root,
      shapes: frame.shapes.filter((shape) => shape.kind !== "ribbon"),
    };
    byKey.set(key, still);
  }
  return still;
}

/** Whether a slice is a part of a state's mark (the dots of thinking, the exclamation mark of blocked), not the body. */
export const isMarkSlice = (shape: FrameShape) => shape.kind === "slice" && shape.key.startsWith("mark-");

const f2 = (n: number) => String(r2(n));
const matrixAttr = (m: Matrix) => `matrix(${m.join(" ")})`;

/** One eye of a frame as SVG, in its face plane (the engine's pill, its happy arc, or the outline between two shapes). */
export function eyeMarkup(mark: EyeMark, ink: string): string {
  if (mark.shape === "path") return `<path d="${mark.d}" fill="${ink}"/>`;
  if (mark.shape === "arc") return `<path d="${mark.d}" fill="none" stroke="${ink}" stroke-width="${f2(mark.strokeWidth)}" stroke-linecap="round"/>`;
  return `<rect x="${f2(mark.x)}" y="${f2(mark.y)}" width="${f2(mark.width)}" height="${f2(mark.height)}" rx="${f2(mark.radius)}" fill="${ink}"/>`;
}

/** The cross-sections' outlines as SVG defs, their ids prefixed so two drawings on a page never share one by mistake. */
export function pathsMarkup(paths: readonly StillPath[], prefix = ""): string {
  return paths.map(([id, d, evenOdd]) => `<path id="${prefix}${id}" d="${d}"${evenOdd ? ' fill-rule="evenodd"' : ""}/>`).join("");
}

/** The body and its eyes, back to front, as the engine paints them (inside the root transform, the body colour inherited). */
export function shapesMarkup(shapes: readonly FrameShape[], ink: string, prefix = ""): string {
  let out = "";
  for (const shape of shapes) {
    // a ribbon of the working and done states (live only: a still holds none), filled with its own gradient
    if (shape.kind === "ribbon") {
      const { x1, y1, x2, y2, stops } = shape.gradient;
      const id = `${prefix}${shape.key}`;
      out +=
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}">` +
        stops.map((stop, i) => `<stop offset="${stops.length > 1 ? f2(i / (stops.length - 1)) : "0"}" stop-color="${stop}"/>`).join("") +
        `</linearGradient><path d="${shape.d}" fill="url(#${id})" transform="${matrixAttr(shape.matrix)}" data-shape-ribbon=""/>`;
      continue;
    }
    out += shape.kind === "slice" ? `<use href="#${prefix}${shape.path}" transform="${matrixAttr(shape.matrix)}"/>` : `<g transform="${matrixAttr(shape.matrix)}">${eyeMarkup(shape.mark, ink)}</g>`;
  }
  return out;
}

/** A still as a standalone SVG (renderAvatarSvg's markup, from a baked frame): no title or role, the host names the mascot. */
export function stillSvg(frame: StillFrame, color: string, ink: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" overflow="visible">` +
    `<defs>${pathsMarkup(frame.paths)}</defs>` +
    `<g transform="${matrixAttr(frame.root)}" fill="${color}">${shapesMarkup(frame.shapes, ink)}</g></svg>`
  );
}

/** How many stills stay drawn: a sidebar of bots shares a handful (shape, colour, mood). */
const STILL_CACHE_MAX = 600;
const STILLS = new Map<string, string>();

/**
 * A still as an image URL, drawn once per key (shape, colour, eyes, mood)
 * and shared by every avatar that shows it: a list of bots costs one decoded
 * image each and no animation loop.
 */
export function stillUrl(key: string, frame: StillFrame, color: string, ink: string): string {
  const hit = STILLS.get(key);
  if (hit) {
    // the most recent last: the oldest goes first when the cache is full
    STILLS.delete(key);
    STILLS.set(key, hit);
    return hit;
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stillSvg(frame, color, ink))}`;
  STILLS.set(key, url);
  if (STILLS.size > STILL_CACHE_MAX) STILLS.delete(STILLS.keys().next().value as string);
  return url;
}
