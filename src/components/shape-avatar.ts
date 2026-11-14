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
import { avatarFrame, getExample, validateAvatar, type AvatarDefinition, type AvatarMotion, type EyeMark, type FrameShape, type Matrix } from "open-bot-avatar";
import baked from "../../shared/shape-avatars.json" with { type: "json" };
import type { MascotShape } from "../../shared/mascot-look.ts";
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

/** The definition a bot's look draws. */
export function lookDefinition(shape: MascotShape, avatarDef?: ShapeAvatarDef): AvatarDefinition {
  return avatarDef ? ownDefinition(avatarDef, shape) : shapeDefinition(shape);
}

/** The app's moods for a shape (Avatar.tsx shapeMoodFor maps the bot's state onto them). */
export type ShapeMood = "idle" | "thinking" | "working" | "streaming" | "happy" | "blocked" | "sleeping";

/** The engine's mood for a shape mood: at work it thinks, done it is happy, else at rest. */
export function engineMood(mood: ShapeMood): AvatarMotion {
  if (mood === "thinking" || mood === "working" || mood === "streaming" || mood === "blocked") return "thinking";
  if (mood === "happy") return "happy";
  return "idle";
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
const roundMark = (mark: EyeMark): EyeMark =>
  mark.shape === "arc" ? { ...mark, strokeWidth: r2(mark.strokeWidth) } : { shape: "pill", x: r2(mark.x), y: r2(mark.y), width: r2(mark.width), height: r2(mark.height), radius: r2(mark.radius) };

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
    const frame = avatarFrame(def, { motion, reducedMotion: true, ...(depth === undefined ? {} : { depth }) });
    const byId = new Map(frame.paths.map((path) => [path.id, path]));
    m[motion] = {
      r: roundMatrix(frame.root),
      s: frame.shapes.map((shape) => {
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

const f2 = (n: number) => String(r2(n));
const matrixAttr = (m: Matrix) => `matrix(${m.join(" ")})`;

/** One eye of a frame as SVG, in its face plane (the engine's pill or happy arc). */
export function eyeMarkup(mark: EyeMark, ink: string): string {
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
