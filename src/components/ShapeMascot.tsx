// The mascot shapes, drawn by the open-bot-avatar engine (#4145, MIT, see
// NOTICE): one body per shape (shape-avatar.ts) in the bot's colour, with two
// eyes on it, its volume inferred from the outline. One component for every
// place a shape shows (the sidebar rows and rail, the pinned tile, the chat
// header pill, the bot page, the pickers, the Appearance page, the desktop
// mascot):
// - a still (small avatars, lists, reduced motion) is the shape's baked
//   frame (shape-stills.ts), one image shared by every avatar of the same
//   shape, colour and mood: no volume inference and no animation loop on the
//   page for a sidebar of bots;
// - the large mascot (LIVE_MIN and up, animated, or asked for in full) is
//   live: the engine's frames (avatarFrame) on the engine's one shared clock
//   (subscribeFrames), written straight onto one SVG: it breathes, blinks,
//   turns toward the pointer, takes the bot's mood and rests off screen;
// - a skin paints the body's face (the largest cross-section, under its own
//   projection) with its fill, texture, edge and the effects around it
//   (skin-fx/shape-skins.tsx), the eyes on top, still or live;
// - the fourteen Shapes moves (SHAPE_MOVES) play over the engine at any size,
//   then the mascot rests again: the body's motion, the eyes closing or
//   opening, its turn into the egg, the hexagon or the triangle, and what the
//   move adds beside it (thought dots, a mark, a badge, rings, ribbons,
//   specks), all from the moves' own timelines (shape-moves.ts).
import "./shape-mascot.css";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { avatarFrame, createAnimator, pointerGaze, type AvatarDefinition, type AvatarMotion, type EyeMark, type FrameShape, type Matrix } from "open-bot-avatar";
import { requestFrame, subscribeFrames, trackPointer } from "open-bot-avatar/dom";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { isBodyShape, MASCOT_SHAPES, SHAPE_SKIN_TIER, SHAPE_SKINS, type BodyShape, type MascotShape, type ShapeSkin, type SkinTier } from "../../shared/mascot-look";
import type { ShapeAvatarDef } from "../../shared/shape-avatar-def";
import { isObjectShapeId } from "../../shared/shape-avatar-presets";
import { engineMood, eyeMarkup, lookDefinition, moodFrame, pathsMarkup, runtimeStill, shapesMarkup, stillUrl, type BakedStill, type ShapeMood, type StillFrame, type StillPath } from "./shape-avatar";
import { mixHex, MOVE_TIMING, ShapeEngine, stillFrame as restFrame, isShapeMove, rainbowStops, type ShapeFrame, type ShapeMove } from "./shape-engine";
import { loadBakedStill, useBakedStill } from "./shape-stills";
import { shapeSkinBase, shapeSkinLayers, type ShapeSkinBase, type ShapeSkinLayers } from "./skin-fx/shape-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type { ShapeMood };

export interface ShapeMascotProps {
  shape?: MascotShape;
  skin?: ShapeSkin;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: ShapeMood;
  /** Off draws the still (thumbnails, lists); a move still plays. */
  animated?: boolean;
  /** "static" forces the still at any size (pickers, thumbnails); "full" asks for the live mascot at any size (skin cards, the desktop mascot). */
  detail?: FxDetail;
  /** A one-shot move: one of the fourteen Shapes moves, or a skin's move (wave, dance...) that plays its effect. */
  move?: FxMoveRequest | null;
  /** The body plays a skin move itself (app avatars); the desktop mascot moves the body on its own. */
  moveBody?: boolean;
  /** The face turns toward the pointer (on by default while live). */
  trackPointer?: boolean;
  /** A person's own drawing (mascotLook.avatarDef). */
  avatarDef?: ShapeAvatarDef;
  /** The accessible name (the bot's name); none marks the mascot decorative. */
  label?: string | null;
  className?: string;
}

// The engine draws a body across its whole 0..100 box (and turns it a little
// past it): the drawing takes 84% of the mascot's box, centred, the room the
// shapes had before, so a mascot never runs into its name or its badge.

/** The smallest mascot drawn live: the bot page's and the Appearance page's (92 px and up); smaller ones are stills. */
export const LIVE_MIN = 88;
/** Live mascots under this size redraw at 30 frames a second, as the engine's own small avatars do. */
const SMALL_LIVE = 128;
const SMALL_FRAME_S = 1 / 30 - 0.004;

const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** How a skin paints a shape: its body and eye colours, tier and effect family. Plain is the bot's colour. */
export function shapeSkinPaint(skin: ShapeSkin, hex: string): ShapeSkinBase & { tier: SkinTier } {
  const known = SHAPE_SKINS.includes(skin) ? skin : "plain";
  return { ...shapeSkinBase(known, hex), tier: SHAPE_SKIN_TIER[known] };
}

/**
 * Whether a shape is live: animated and large (LIVE_MIN), or asked for in
 * full (the Appearance page's skin cards, the desktop mascot); never forced
 * still, never under reduced motion. A move makes any size live while it plays.
 */
export function shapeIsLive(size: number, animated: boolean, detail: FxDetail | undefined, reduced: boolean): boolean {
  if (!animated || reduced || detail === "static") return false;
  return detail === "full" || size >= LIVE_MIN;
}

/** Whether a skin draws anything over the flat body (a fill of its own, texture, edge, glow, shine): such a skin is drawn as SVG, a flat one as the shared image. */
export function skinIsFlat(layers: ShapeSkinLayers, paint: ShapeSkinBase): boolean {
  return !layers.defs && !layers.under && !layers.inner && !layers.edge && !layers.around && HEX.test(layers.fill) && !paint.stroke && !paint.shine;
}

/* ------------------------------------------------------------ drawing */

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const matrixAttr = (m: Matrix) => `matrix(${m.map((v, i) => (i < 4 ? Math.round(v * 10000) / 10000 : Math.round(v * 100) / 100)).join(" ")})`;

/**
 * The face a skin paints: the frame's largest cross-section facing the
 * viewer (the body's full outline), placed with its projection and the
 * frame's root motion. Null when the body is turned side on.
 */
export function skinFace(frame: StillFrame): { d: string; transform: string } | null {
  const area = new Map<string, StillPath>(frame.paths.map((path) => [path[0], path]));
  let best: { path: StillPath; matrix: Matrix } | null = null;
  for (const shape of frame.shapes) {
    if (shape.kind !== "slice" || /^\d+x\d+$/.test(shape.key)) continue;
    const path = area.get(shape.path);
    if (path && (!best || path[3] >= best.path[3])) best = { path, matrix: shape.matrix };
  }
  return best ? { d: best.path[1], transform: matrixAttr(mul(frame.root, best.matrix)) } : null;
}

/** The eyes of a frame alone, over a skin (each in its own plane, the root motion applied). */
function eyesMarkup(frame: StillFrame, ink: string): string {
  return frame.shapes.map((shape) => (shape.kind === "eye" ? `<g transform="${matrixAttr(mul(frame.root, shape.matrix))}">${eyeMarkup(shape.mark, ink)}</g>` : "")).join("");
}

/** The skin's layers on the face, under the eyes (inner layers clipped to the face). */
function SkinFace({ uid, d, layers, paint }: { uid: string; d: string; layers: ShapeSkinLayers; paint: ShapeSkinBase }) {
  return (
    <>
      <path d={d} fill={layers.fill} stroke={!layers.ownEdge && paint.stroke ? paint.stroke : undefined} strokeWidth={!layers.ownEdge && paint.stroke ? paint.strokeWidth : undefined} strokeLinejoin="round" data-skin-face="" />
      {paint.shine && <path d={d} fill={`url(#${uid}-shine)`} />}
      {layers.inner && <g clipPath={`url(#${uid}-face)`}>{layers.inner}</g>}
      {layers.edge}
    </>
  );
}

/**
 * One SVG for a shape: the body (the engine's cross-sections and eyes, in
 * the body's colour), the skin on its face with the eyes over it, and the
 * move's extras behind and in front. Drawn from a still frame; the live loop
 * writes each frame onto the same nodes (refs).
 */
interface DrawRefs {
  paths: React.RefObject<SVGDefsElement | null>;
  move: React.RefObject<SVGGElement | null>;
  back: React.RefObject<SVGGElement | null>;
  body: React.RefObject<SVGGElement | null>;
  face: React.RefObject<SVGGElement | null>;
  under: React.RefObject<SVGGElement | null>;
  eyes: React.RefObject<SVGGElement | null>;
  front: React.RefObject<SVGGElement | null>;
}

function ShapeSvg({ uid, frame, color, ink, layers, paint, faceD, refs, live }: { uid: string; frame: StillFrame; color: string; ink: string; layers: ShapeSkinLayers | null; paint: ShapeSkinBase; faceD: string | null; refs: DrawRefs; live: boolean }) {
  const face = layers ? skinFace(frame) : null;
  const at = face?.transform;
  return (
    <svg viewBox="0 0 100 100" overflow="visible" className="block h-[84%] w-[84%]" data-shape-svg="" {...(live ? { "data-shape-live": "" } : {})}>
      <defs ref={refs.paths} dangerouslySetInnerHTML={{ __html: pathsMarkup(frame.paths, `${uid}-`) }} />
      {layers && faceD && (
        <defs>
          <clipPath id={`${uid}-face`}>
            <path d={faceD} />
          </clipPath>
          {paint.shine && (
            <radialGradient id={`${uid}-shine`} cx="0.32" cy="0.26" r="0.75">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
            </radialGradient>
          )}
          {layers.defs}
        </defs>
      )}
      <g ref={refs.move} data-shape-move="">
        <g ref={refs.back} />
        {layers?.under && faceD && (
          <g ref={refs.under} transform={at}>
            {layers.under}
          </g>
        )}
        <g ref={refs.body} fill={color} transform={matrixAttr(frame.root)} dangerouslySetInnerHTML={{ __html: shapesMarkup(frame.shapes, ink, `${uid}-`) }} data-shape-body="" />
        {layers && faceD && (
          <>
            <g ref={refs.face} transform={at} style={at ? undefined : { display: "none" }} data-shape-skin-face="">
              <SkinFace uid={uid} d={faceD} layers={layers} paint={paint} />
            </g>
            <g ref={refs.eyes} dangerouslySetInnerHTML={{ __html: eyesMarkup(frame, ink) }} />
            {layers.around && (
              <g className="skin-fx-around" transform={at} data-skin-around="">
                {layers.around}
              </g>
            )}
          </>
        )}
        <g ref={refs.front} />
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------- moves */

/** The body a move turns into for a while (shape-moves.ts moveBodies), as one of the shapes. */
const MOVE_BODY: Partial<Record<ShapeMove, MascotShape>> = { egg: "egg", hexagon: "hexagon", play: "pick", orbit: "pick" };

/**
 * What a move draws beside the body at one moment of its timeline (the
 * moves' own frame, shape-engine.ts): the parts behind it (the back of the
 * rings) and in front of it (thought dots, a mark, specks, the front of the
 * rings, ribbons, a badge), as SVG in the 0..100 box.
 */
export function moveExtrasMarkup(frame: ShapeFrame, uid: string, color: string): { back: string; front: string } {
  const lines = [...frame.rings, ...frame.ribbons];
  const gradients = lines
    .map((line, i) => `<linearGradient id="${uid}-ring${i}" gradientUnits="userSpaceOnUse" x1="${line.x1}" y1="0" x2="${line.x2}" y2="0">${rainbowStops(line.hue, line.hueSpan).map((stop, k) => `<stop offset="${k / 2}" stop-color="${stop}"/>`).join("")}</linearGradient>`)
    .join("");
  const ring = (side: "back" | "front") =>
    frame.rings.map((r, i) => (r[side] ? `<path d="${r[side]}" fill="none" stroke="url(#${uid}-ring${i})" stroke-width="${r.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${r.opacity}"/>` : "")).join("");
  const dots = frame.dots.map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${color}" opacity="${dot.opacity}"/>`).join("");
  const marks = frame.marks.map((mark) => `<path d="${mark.d}" fill="${color}" opacity="${mark.opacity}"/>`).join("");
  const specks = frame.specks.map((speck) => `<circle cx="${speck.x}" cy="${speck.y}" r="${speck.r}" fill="${mixHex(color, "#0b0b0e", 0.62)}" opacity="${speck.opacity}"/>`).join("");
  const ribbons = frame.ribbons
    .map((ribbon, i) => {
      const dash = ribbon.dash >= 1 ? "" : ` stroke-dasharray="${ribbon.dash} ${1 + ribbon.dash}" stroke-dashoffset="${-ribbon.offset}"`;
      return `<path d="${ribbon.d}" fill="none" stroke="url(#${uid}-ring${frame.rings.length + i})" stroke-width="${ribbon.width}" stroke-linecap="round" pathLength="1"${dash} opacity="${ribbon.opacity}"/>`;
    })
    .join("");
  const badge = frame.badge ? `<circle cx="${frame.badge.x}" cy="${frame.badge.y}" r="${frame.badge.r}" fill="#2a8fe8"/>` : "";
  return { back: (gradients ? `<defs>${gradients}</defs>` : "") + ring("back"), front: dots + marks + specks + ring("front") + ribbons + badge };
}

/** How open each eye is during a move (left, right; 1 at rest), from the moves' own faces against the resting one. */
export function moveEyeOpen(frame: ShapeFrame, rest: ShapeFrame): [number, number] {
  const [a, b] = [...frame.eyeShapes].sort((p, q) => p.x - q.x);
  const [ra, rb] = [...rest.eyeShapes].sort((p, q) => p.x - q.x);
  const open = (eye: { h: number } | undefined, base: { h: number } | undefined) => (eye && base && base.h > 0 ? Math.min(1.5, Math.max(0.08, eye.h / base.h)) : 1);
  return [open(a, ra), open(b, rb)];
}

/** An engine eye opened or closed around its middle (a pill; the happy arc stays). */
function openEye(mark: EyeMark, open: number): EyeMark {
  if (mark.shape !== "pill" || open === 1) return mark;
  const height = Math.max(0.6, mark.height * open);
  return { ...mark, y: mark.y + (mark.height - height) / 2, height, radius: Math.min(mark.width, height) / 2 };
}

/** A frame's eyes opened per the move (the left eye is the one further left on screen). */
function withEyes(frame: StillFrame, open: [number, number]): StillFrame {
  if (open[0] === 1 && open[1] === 1) return frame;
  const eyes = frame.shapes.filter((shape): shape is Extract<FrameShape, { kind: "eye" }> => shape.kind === "eye");
  const xs = eyes.map((eye) => eye.matrix[4] + (eye.mark.shape === "pill" ? eye.mark.x : 0));
  const leftmost = xs.length > 1 && xs[1]! < xs[0]! ? 1 : 0;
  return {
    ...frame,
    shapes: frame.shapes.map((shape) => {
      if (shape.kind !== "eye") return shape;
      const side = eyes.indexOf(shape) === leftmost ? 0 : 1;
      return { ...shape, mark: openEye(shape.mark, open[side]) };
    }),
  };
}

const seconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/* --------------------------------------------------------------- live */

interface LiveInput {
  definition: AvatarDefinition;
  still: BakedStill | undefined;
  color: string;
  ink: string;
  mood: AvatarMotion;
  depth: number | undefined;
  followPointer: boolean;
  size: number;
  /** The move playing (a Shapes move), its body for the moves' timelines. */
  move: { clip: ShapeMove; key: number } | null;
  moveShape: BodyShape;
  skinned: boolean;
}

/** The live loop of one mascot: the engine's frames on its shared clock, written onto the SVG; off screen it rests. */
function useLiveShape(host: React.RefObject<HTMLSpanElement | null>, refs: DrawRefs, uid: string, live: boolean, input: LiveInput) {
  const latest = useRef(input);
  latest.current = input;
  // each React draw puts the still back on the nodes: the loop draws its frame over it on the next tick
  const rendered = useRef(0);
  useEffect(() => {
    rendered.current += 1;
    if (live) requestFrame();
  });
  useEffect(() => {
    const el = host.current;
    if (!live || !el) return;
    const animator = createAnimator();
    let rect: DOMRect | null = null;
    let visible = true;
    let started = false;
    let drawnPaths = "";
    // the moves' own timeline, while one plays
    let moves: { engine: ShapeEngine; rest: ShapeFrame } | null = null;
    let lastKey = 0;
    let seenRender = -1;
    const intersect = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
        const next = entries[entries.length - 1]!.isIntersecting;
        if (next === visible) return;
        visible = next;
        if (visible) requestFrame();
      }, { rootMargin: "100px" });
    intersect?.observe(el);
    const release = latest.current.followPointer ? trackPointer() : null;
    // the first live frame infers the body's volume: after the page has drawn, never in the mount
    const start = window.setTimeout(() => {
      started = true;
      requestFrame();
    }, 0);
    const unsubscribe = subscribeFrames({
      measure: () => {
        rect = started && visible && latest.current.followPointer ? el.getBoundingClientRect() : null;
      },
      draw: (time, pointer) => {
        if (!started || !visible || document.hidden) return false;
        const input = latest.current;
        const now = seconds();
        if (input.move && input.move.key !== lastKey) {
          lastKey = input.move.key;
          const state = { shape: input.moveShape, expression: "neutral" as const, color: input.color };
          const engine = new ShapeEngine(state, now, 7);
          engine.play(input.move.clip, now);
          moves = { engine, rest: restFrame(state) };
        }
        const playing = moves && moves.engine.playing(now) ? moves.engine.frame(now) : null;
        if (!playing) moves = null;

        const target = input.followPointer && pointer && rect && rect.width > 0 ? pointerGaze(pointer, rect, { x: input.definition.eyes.x / 100, y: input.definition.eyes.y / 100 }) : null;
        const step = animator.step({ now: now * 1000, motion: input.mood, target, reducedMotion: false });
        // the move's body (the egg, the hexagon, the triangle) once it has turned more than half way
        const into = playing && input.move ? MOVE_BODY[input.move.clip] : undefined;
        const morphStill = into && playing && playing.morphed >= 0.5 ? morphStills.get(into) : undefined;
        let frame: StillFrame;
        if (morphStill) {
          frame = moodFrame(morphStill, input.mood);
        } else {
          const flat = avatarFrame(input.definition, { motion: input.mood, motionBlend: step.motionBlend, time, gaze: step.gaze, reducedMotion: false, ...(input.depth === undefined ? {} : { depth: input.depth }) });
          frame = { paths: flat.paths.map((path): StillPath => [path.id, path.d, path.evenOdd, path.box.w * path.box.h]), root: flat.root, shapes: flat.shapes };
        }
        if (playing && moves) frame = withEyes(frame, moveEyeOpen(playing, moves.rest));

        // the cross-sections' outlines only when the set changes (a turn side on, a move's body) or React drew the still again
        if (rendered.current !== seenRender) {
          seenRender = rendered.current;
          drawnPaths = "";
        }
        const pathKey = frame.paths.map((path) => path[0]).join(",");
        if (pathKey !== drawnPaths && refs.paths.current) {
          refs.paths.current.innerHTML = pathsMarkup(frame.paths, `${uid}-`);
          drawnPaths = pathKey;
        }
        const body = refs.body.current;
        if (body) {
          body.setAttribute("transform", matrixAttr(frame.root));
          body.innerHTML = shapesMarkup(frame.shapes, input.ink, `${uid}-`);
        }
        if (input.skinned) {
          const face = skinFace(frame);
          for (const node of [refs.face.current, refs.under.current, host.current?.querySelector<SVGGElement>("[data-skin-around]") ?? null]) {
            if (!node) continue;
            if (face) node.setAttribute("transform", face.transform);
            node.style.display = face ? "" : "none";
          }
          if (refs.eyes.current) refs.eyes.current.innerHTML = eyesMarkup(frame, input.ink);
        }
        const extras = playing ? moveExtrasMarkup(playing, uid, input.color) : { back: "", front: "" };
        if (refs.back.current) refs.back.current.innerHTML = extras.back;
        if (refs.front.current) refs.front.current.innerHTML = extras.front;
        refs.move.current?.setAttribute("transform", playing ? playing.transform : "");
        return input.size < SMALL_LIVE && !playing ? SMALL_FRAME_S : true;
      },
    });
    return () => {
      window.clearTimeout(start);
      unsubscribe();
      intersect?.disconnect();
      release?.();
      for (const node of [refs.back.current, refs.front.current]) if (node) node.innerHTML = "";
      refs.move.current?.removeAttribute("transform");
    };
    // the loop reads the latest input on every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, uid]);
}

/** The move bodies' stills, loaded when a move that turns into one starts. */
const morphStills = new Map<MascotShape, BakedStill>();
function preloadMoveBody(clip: ShapeMove) {
  const into = MOVE_BODY[clip];
  if (!into || morphStills.has(into)) return;
  void loadBakedStill(into).then((still) => {
    if (still) morphStills.set(into, still);
  });
}

/* ---------------------------------------------------------- component */

export function ShapeMascot({
  shape = "circle",
  skin = "plain",
  color,
  size = 44,
  mood = "idle",
  animated = true,
  detail,
  move,
  moveBody = false,
  trackPointer: followPointer = true,
  avatarDef,
  label = null,
  className,
}: ShapeMascotProps) {
  const known: MascotShape = MASCOT_SHAPES.includes(shape) ? shape : "circle";
  const knownSkin: ShapeSkin = SHAPE_SKINS.includes(skin) ? skin : "plain";
  const definition = lookDefinition(known, avatarDef);
  const hex = hexOf(color);
  const paint = shapeSkinPaint(knownSkin, hex);
  const body = (HEX.test(paint.fill) ? paint.fill : hex).toLowerCase();
  const ink = (HEX.test(paint.eyes) ? paint.eyes : "#151515").toLowerCase();
  // the Outline skin is drawn flat on purpose
  const depth = knownSkin === "outline" ? 0 : undefined;
  const reduced = useReducedMotion();
  const uid = `shape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // the still: the shape's baked frames, or (a person's own drawing, the flat Outline skin) inferred once here
  const bakedId: MascotShape | null = depth === 0 ? null : avatarDef ? (avatarDef.id && isObjectShapeId(avatarDef.id) ? avatarDef.id : null) : known;
  const baked = useBakedStill(bakedId);
  const still = bakedId ? baked : runtimeStill(definition, depth);
  const motion = engineMood(mood);
  const frame = still ? moodFrame(still, motion) : null;

  // a Shapes move plays at any size, then the mascot rests again
  const shapeMove = move && isShapeMove(move.clip) ? { clip: move.clip, key: move.key } : null;
  const [playing, setPlaying] = useState<{ clip: ShapeMove; key: number } | null>(null);
  const timer = useRef(0);
  const play = (clip: ShapeMove, key: number) => {
    preloadMoveBody(clip);
    setPlaying({ clip, key });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPlaying(null), MOVE_TIMING[clip].duration * 1000 + 120);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const seen = useRef(0);
  useEffect(() => {
    if (!shapeMove || shapeMove.key === seen.current || reduced) return;
    seen.current = shapeMove.key;
    play(shapeMove.clip, shapeMove.key);
  }, [shapeMove?.key, shapeMove?.clip, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = !reduced && (shapeIsLive(size, animated, detail, reduced) || playing !== null);
  // the skin's full look (filters, its moving layers) when large or asked for; it moves only while live
  const full = fxDetail(size, animated, detail) === "full";
  const faceD = frame ? skinFace(frame)?.d ?? null : null;
  const layers = useMemo(() => (faceD ? shapeSkinLayers(knownSkin, faceD, hex, uid, full) : null), [knownSkin, faceD, hex, uid, full]);
  const flatSkin = layers ? skinIsFlat(layers, paint) : knownSkin === "plain";

  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(knownSkin, live);
  const burst = useMoveBurst(shapeMove ? null : move, live);
  useReplayMove(root, burst && moveBody ? burst.key : null);
  const refs: DrawRefs = {
    paths: useRef<SVGDefsElement>(null),
    move: useRef<SVGGElement>(null),
    back: useRef<SVGGElement>(null),
    body: useRef<SVGGElement>(null),
    face: useRef<SVGGElement>(null),
    under: useRef<SVGGElement>(null),
    eyes: useRef<SVGGElement>(null),
    front: useRef<SVGGElement>(null),
  };
  useLiveShape(root, refs, uid, live && frame !== null, {
    definition,
    still,
    color: body,
    ink,
    mood: motion,
    depth,
    followPointer,
    size,
    move: playing,
    moveShape: isBodyShape(known) ? known : "circle",
    skinned: !flatSkin,
  });

  const palette = fxPalette(paint.fx, hex);
  let drawing: ReactNode = null;
  if (frame) {
    drawing = live || !flatSkin
      ? <ShapeSvg uid={uid} frame={frame} color={body} ink={ink} layers={flatSkin ? null : layers} paint={paint} faceD={faceD} refs={refs} live={live} />
      : <img src={stillUrl(`${bakedId ?? definition.id}|${depth ?? ""}|${motion}|${body}|${ink}`, frame, body, ink)} alt="" width={size} height={size} draggable={false} decoding="async" className="block h-[84%] w-[84%] select-none" />;
  }
  return (
    <span
      ref={root}
      className={cn("shape-mascot relative inline-flex shrink-0 items-center justify-center", live && full && "skin-fx-live", burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop", className)}
      style={{ width: size, height: size }}
      onPointerDown={!reduced && (live || animated) && !playing ? (event) => {
        // a poke winks
        if (event.pointerType === "mouse" && event.button !== 0) return;
        play("wink", Date.now());
      } : undefined}
      data-shape={known}
      data-shape-skin={knownSkin}
      data-skin-tier={paint.tier}
      data-mood={motion}
      data-fx={full ? "full" : "static"}
      data-shape-drawn={frame ? "" : undefined}
      {...(playing ? { "data-shape-move": playing.clip } : {})}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      {drawing}
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={definition.body.path} />}
    </span>
  );
}
