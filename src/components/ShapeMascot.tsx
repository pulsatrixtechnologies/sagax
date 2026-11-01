// The mascot shapes: one soft body in every shape of the set
// (shared/mascot-geometry.json through shape-art.ts) with two rounded eyes on
// it, in thirteen skins (Plain is the flat clay finish) (skin-fx/shape-skins.tsx).
// One drawing (shape-volume.ts drawShape) serves React and the live loop: the
// loop writes it straight onto the SVG at the display's rate (writeShape);
// React draws only when a move adds or drops its extras, or the colour
// changes. The eyes live in the face's own group, so whatever moves the
// outline moves them with it.
// shape-engine.ts moves it: the gaze wanders, the body drifts and breathes,
// the eyes blink, the face turns toward the pointer, changes of shape, face
// and color slide, and the fourteen moves (SHAPE_MOVES) play on request.
// Small avatars and thumbnails draw the still pose (nothing moving, no
// filter), so the sidebar and the chat cost nothing; reduced motion keeps
// every size still and plays no move. The desktop mascot draws the same
// component and moves the whole drawing itself.
import "./shape-mascot.css";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { MASCOT_SHAPES, SHAPE_SKIN_TIER, SHAPE_SKINS, type MascotShape, type ShapeSkin, type SkinTier } from "../../shared/mascot-look";
import { SHAPE_ART, STEM_INK } from "./shape-art";
import type { ShapeAvatarDef } from "../../shared/shape-avatar-def";
import { isObjectShapeId, OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import { gazeFrame, isShapeMove, mixHex, rainbowStops, ShapeEngine, stillFrame, type ShapeExpression, type ShapeFrame } from "./shape-engine";
import { blinkIdleShape, idleSeed, registerIdleShape } from "./shape-idle";
import { motionForMood, ShapeMotion } from "./shape-motion";
import { drawShape, eyeStyleFor, grounded, inkPaint, REST_POSE, uprightPose, volumeDetail, writeShape, type EyeStyle, type Pose } from "./shape-volume";
import { shapeSkinBase, shapeSkinLayers, tint, type ShapeSkinBase, type ShapeSkinLayers } from "./skin-fx/shape-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export { SHAPE_ART, EYES } from "./shape-art";
export { uprightPose, writeShape } from "./shape-volume";

export type ShapeMood = "idle" | "thinking" | "working" | "streaming" | "happy" | "blocked" | "sleeping";

/** The face a mood wears. */
export function expressionForMood(mood: ShapeMood): ShapeExpression {
  switch (mood) {
    case "thinking":
      return "curious";
    case "working":
    case "streaming":
      return "attentive";
    case "blocked":
      return "curious";
    case "happy":
      // open, bright eyes: the flat "happy" bars read as dashes on a turned body
      return "excited";
    case "sleeping":
      return "sleepy";
    default:
      return "neutral";
  }
}

export interface ShapeMascotProps {
  shape?: MascotShape;
  skin?: ShapeSkin;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: ShapeMood;
  /** A face of its own, over the mood's. */
  expression?: ShapeExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  /** The skin's full effects or its cheap still look; by default full when animated and large enough (FX_FULL_MIN). */
  detail?: FxDetail;
  /** A one-shot move to show: one of the fourteen Shapes moves, or a skin effect's move (wave, dance...). */
  move?: FxMoveRequest | null;
  /** The body plays a skin move itself (app avatars); the desktop mascot moves the body on its own. */
  moveBody?: boolean;
  /** The face turns toward the pointer (on by default while live). */
  trackPointer?: boolean;
  /** Sidebar idle: gaze from the shared loop without the full live engine. */
  sidebarGaze?: boolean;
  /** Filled with an imperative gaze setter when `sidebarGaze` is on. */
  sidebarGazeRef?: React.MutableRefObject<((gaze: { x: number; y: number }) => void) | null>;
  /** Path-based portable definition (object presets or custom). */
  avatarDef?: ShapeAvatarDef;
  label?: string | null;
  className?: string;
}

/** Resolve the live path body: explicit def, else the object preset for this shape id. */
export function avatarDefForShape(shape: MascotShape, avatarDef?: ShapeAvatarDef): ShapeAvatarDef | undefined {
  if (avatarDef) return avatarDef;
  if (isObjectShapeId(shape)) return OBJECT_SHAPE_BY_ID[shape];
  return undefined;
}

const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);

export { tint };

/** How a skin paints a shape: its base fill, outline, tier and effect family. Plain is the clay finish. */
export function shapeSkinPaint(skin: ShapeSkin, hex: string): ShapeSkinBase & { tier: SkinTier } {
  const known = SHAPE_SKINS.includes(skin) ? skin : "plain";
  return { ...shapeSkinBase(known, hex), tier: SHAPE_SKIN_TIER[known] };
}

/** Whether a shape runs its live loop (gaze, breath, blinks, moves): full detail, and never under reduced motion. */
export function shapeIsLive(size: number, animated: boolean, detail: FxDetail | undefined, reduced: boolean): boolean {
  return fxDetail(size, animated, detail) === "full" && !reduced;
}

/**
 * A small shape's sway, on the compositor (shape-mascot.css): the mood's own
 * loop, its period and its reach from the motion library, and a start of its
 * own in the cycle, so a sidebar of bots never moves in step.
 */
function idleStyle(size: number, seed: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    // a start and a pace of its own: 0.88..1.12 of the mood's period
    animationDelay: `${-((seed * 0.137) % 9).toFixed(2)}s`,
    ["--sway-k" as string]: (0.88 + ((seed * 0.0173) % 0.24)).toFixed(3),
  };
}

/** The smallest avatar that blinks and breathes at rest (below it the eyes are a pixel or two). */
export const IDLE_MIN = 16;
/** The live loop's pace at rest, s per frame (a move plays at the display's rate). */
export const IDLE_FRAME_S = 1 / 30 - 0.002;

/** A resting blink's frames, shared by every avatar of a shape and face (20 steps of openness): a blink costs no solve after the first. */
const BLINK_FRAMES = new Map<string, ShapeFrame>();
function blinkFrame(state: { shape: MascotShape; expression: ShapeExpression; color: string; avatarDef?: ShapeAvatarDef }, open: number): ShapeFrame {
  const step = Math.round(open * 20) / 20;
  const defKey = state.avatarDef?.id ?? (state.avatarDef ? "custom" : "");
  const key = `${state.shape}|${defKey}|${state.expression}|${step}`;
  let frame = BLINK_FRAMES.get(key);
  if (!frame) {
    frame = gazeFrame({ ...state, color: "#000000" }, 0, 0, {}, { left: step, right: step });
    if (BLINK_FRAMES.size > 4000) BLINK_FRAMES.clear();
    BLINK_FRAMES.set(key, frame);
  }
  return frame;
}

const seconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** The stem's ink on a body: a dark wood brown, a little of the body's own color in it. */
export function stemInk(fill: string): string {
  return mixHex(STEM_INK, /^#[0-9a-fA-F]{6}$/.test(fill) ? fill : STEM_INK, 0.12);
}

/** Skins drawn flat on purpose (an ink outline): no side, no turn. */
const FLAT_SKINS: ReadonlySet<ShapeSkin> = new Set(["outline"]);

/**
 * One frame of a shape, as SVG: the body in its pose (shape-volume.ts, turned
 * with the top leaning left), one flat colour, whole (no hole), with two
 * opaque capsule eyes on it in the face's own group; then its skin and what a
 * move adds (dots, a mark, a badge, rings, ribbons, specks). No gradient, no
 * highlight, no filter, no raster: crisp at any size. The markup carries the
 * attributes writeShape writes, and nothing else moves a part.
 */
export function ShapeFrameSvg({ frame, uid, skin, paint, layers, bodyRef, bodyClass, size = 56, pose = REST_POSE, eyeStyle = "capsule" }: { frame: ShapeFrame; uid: string; skin: ShapeSkin; paint: ShapeSkinBase; layers: ShapeSkinLayers; bodyRef?: React.Ref<SVGSVGElement>; bodyClass?: string; size?: number; pose?: Pose; eyeStyle?: EyeStyle }) {
  const solid = skin === "plain";
  const ink = inkPaint(solid ? frame.color : paint.fill);
  const fill = solid ? ink.fill : layers.fill;
  const volume = !FLAT_SKINS.has(skin);
  const detail = volumeDetail(size);
  // the one drawing: a plain body bends with the resting turn; a skin's own art is drawn on the outline at rest
  const drawing = drawShape(frame, pose, detail, eyeStyle, solid);
  const settled = frame.morphed < 0.5;
  const dotFill = solid ? ink.fill : layers.fill.startsWith("url(") ? paint.fill : layers.fill;
  const sideFill = solid ? ink.side : paint.fill;
  const rings = (side: "back" | "front"): ReactNode =>
    frame.rings.map((ring, i) =>
      ring[side] ? <path key={`${side}${i}`} d={ring[side]} fill="none" stroke={`url(#${uid}-ring${i})`} strokeWidth={ring.width} strokeLinecap="round" strokeLinejoin="round" opacity={ring.opacity} /> : null,
    );
  const badge = frame.badge ? <circle cx={frame.badge.x} cy={frame.badge.y} r={frame.badge.r} fill="#2a8fe8" /> : null;
  const motion = (
    <g transform={volume ? undefined : drawing.motion} mask={frame.badge ? `url(#${uid}-notch)` : undefined} {...(volume ? {} : { "data-shape-motion": "" })}>
      <path
        className="shape-fill"
        d={volume ? drawing.outline : drawing.cut}
        fillRule="evenodd"
        {...(volume ? { "data-shape-face": "" } : { "data-shape-cut": "" })}
        fill={fill}
        stroke={!layers.ownEdge && paint.stroke ? paint.stroke : undefined}
        strokeWidth={!layers.ownEdge && paint.stroke ? paint.strokeWidth : undefined}
        strokeLinejoin="round"
      />
      {/* a near-white or near-black face keeps its silhouette: one hairline, on the face only */}
      {volume && ink.edge && <use href={`#${uid}-outline`} fill="none" stroke={ink.edge} strokeOpacity={0.2} strokeWidth={detail === "tiny" ? 2.4 : 1.6} strokeLinejoin="round" />}
      {paint.shine && (volume ? <use href={`#${uid}-outline`} fill={`url(#${uid}-shine)`} /> : <path d={drawing.cut} fillRule="evenodd" fill={`url(#${uid}-shine)`} data-shape-cut="" />)}
      {layers.inner && <g clipPath={`url(#${uid}-body)`}>{layers.inner}</g>}
      {settled && layers.edge}
      {frame.dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} fill={dotFill} opacity={dot.opacity} />
      ))}
      {frame.marks.map((mark, i) => (
        <path key={i} d={mark.d} fill={dotFill} opacity={mark.opacity} data-shape-mark="" />
      ))}
    </g>
  );
  const view = (children: ReactNode, extra: Record<string, string> = {}) => (volume ? <g transform={drawing.face} data-pose-face="" {...extra}>{children}</g> : <>{children}</>);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" ref={bodyRef} className={bodyClass} style={{ overflow: "visible", display: "block" }} data-eyes={frame.eyes ? "cut" : "none"} data-volume={volume ? detail : "flat"}>
      <defs>
        {volume && <path id={`${uid}-outline`} d={drawing.outline} data-shape-outline="" />}
        <clipPath id={`${uid}-body`}>
          {/* a body in volume is whole (its eyes sit on top); a flat skin's eyes are cut through it */}
          {volume ? <use href={`#${uid}-outline`} /> : <path d={drawing.cut} clipRule="evenodd" data-shape-cut="" />}
        </clipPath>
        {paint.shine && (
          <radialGradient id={`${uid}-shine`} cx="0.32" cy="0.26" r="0.75">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
          </radialGradient>
        )}
        {[...frame.rings, ...frame.ribbons].map((line, i) => (
          <linearGradient key={i} id={`${uid}-ring${i}`} gradientUnits="userSpaceOnUse" x1={line.x1} y1={0} x2={line.x2} y2={0}>
            {rainbowStops(line.hue, line.hueSpan).map((color, k) => (
              <stop key={k} offset={k / 2} stopColor={color} />
            ))}
          </linearGradient>
        ))}
        {frame.badge && (
          <mask id={`${uid}-notch`} maskUnits="userSpaceOnUse" x={-60} y={-60} width={220} height={220}>
            <rect x={-60} y={-60} width={220} height={220} fill="#fff" />
            <circle cx={frame.badge.x} cy={frame.badge.y} r={frame.badge.r + frame.badge.notch} fill="#000" />
          </mask>
        )}
        {layers.defs}
      </defs>
      {rings("back")}
      {settled && layers.under && view(layers.under)}
      <g className="shape-body">
        {/* a move's motion (breath, drift, a move's turn) carries the whole body in volume: one write per frame */}
        <g transform={volume ? drawing.motion : undefined} {...(volume ? { "data-shape-motion": "" } : {})}>
        {/* the body behind its face: slices of the same outline, turned with it (shape-volume.ts) */}
        {volume &&
          drawing.slices.map((t, i) => (
            <g key={`slice${i}`} transform={t} data-pose-slice={i}>
              <use href={`#${uid}-outline`} fill={sideFill} data-shape-slice="" />
            </g>
          ))}
        {/* the face: the stem behind it, the body, the badge and its notch, and the eyes, all under one matrix */}
        {view(
          <>
            {/* the pumpkin's stem: behind the face, its foot under the body's top */}
            {drawing.stem && <path d={drawing.stem.d} fill={stemInk(solid ? ink.fill : paint.fill)} opacity={drawing.stem.opacity} data-shape-stem="" />}
            {motion}
            {badge}
            {/* the eyes in their ink (dark, or light on a dark body), on the face, in its own group */}
            {volume && frame.eyes && <path d={drawing.eyes} fill={ink.eyes} data-shape-eyes="" />}
          </>,
          { "data-shape-view": "" },
        )}
        </g>
      </g>
      {frame.specks.map((speck, i) => (
        <circle key={i} cx={speck.x} cy={speck.y} r={speck.r} fill={mixHex(frame.color, "#0b0b0e", 0.62)} opacity={speck.opacity} />
      ))}
      {rings("front")}
      {frame.ribbons.map((ribbon, i) => (
        <path
          key={i}
          d={ribbon.d}
          fill="none"
          stroke={`url(#${uid}-ring${frame.rings.length + i})`}
          strokeWidth={ribbon.width}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={ribbon.dash >= 1 ? undefined : `${ribbon.dash} ${1 + ribbon.dash}`}
          strokeDashoffset={ribbon.dash >= 1 ? undefined : -ribbon.offset}
          opacity={ribbon.opacity}
        />
      ))}
      {settled && layers.around && <g className="skin-fx-around" transform={volume ? drawing.face : undefined} data-pose-face={volume ? "" : undefined}>{layers.around}</g>}
    </svg>
  );
}

/** Whether a live frame can go straight onto the drawing of the last one React
 * drew: neither has a move's extras (dots, specks, rings, ribbons, a badge),
 * the colour and the eyes are the same and the skin's edge is in the same
 * place. Then only the outline, the transform and the light change. */
export function shapeFrameWritable(drawn: ShapeFrame, next: ShapeFrame): boolean {
  const plain = (frame: ShapeFrame) => !frame.badge && !frame.dots.length && !frame.marks.length && !frame.specks.length && !frame.rings.length && !frame.ribbons.length;
  const eyeCount = (frame: ShapeFrame) => frame.eyes.split("M").length;
  return plain(drawn) && plain(next) && drawn.color === next.color && eyeCount(drawn) === eyeCount(next) && (drawn.morphed < 0.5) === (next.morphed < 0.5) && !drawn.stem === !next.stem;
}

/** The pointer around a box, -1..1 on each axis at about three box widths away. */
function pointerAround(box: DOMRect, x: number, y: number): { x: number; y: number } {
  const reach = Math.max(240, box.width * 3);
  return { x: (x - (box.left + box.width / 2)) / reach, y: (y - (box.top + box.height / 2)) / reach };
}

export function ShapeMascot({
  shape = "circle",
  skin = "plain",
  color,
  size = 44,
  mood = "idle",
  expression,
  animated = true,
  detail,
  move,
  moveBody = false,
  trackPointer = true,
  sidebarGaze = false,
  sidebarGazeRef,
  avatarDef,
  label = null,
  className,
}: ShapeMascotProps) {
  const known: MascotShape = MASCOT_SHAPES.includes(shape) ? shape : "circle";
  const knownSkin: ShapeSkin = SHAPE_SKINS.includes(skin) ? skin : "plain";
  const resolvedDef = avatarDefForShape(known, avatarDef);
  const hex = hexOf(color);
  const paint = shapeSkinPaint(knownSkin, hex);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = shapeIsLive(size, animated, detail, reduced);
  const face = expression ?? expressionForMood(mood);
  const uid = `shape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layers = useMemo(() => shapeSkinLayers(knownSkin, SHAPE_ART[known].d, hex, uid, full), [knownSkin, known, hex, uid, full]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(knownSkin, live);
  const shapeMove = isShapeMove(move?.clip) ? move : null;
  const burst = useMoveBurst(shapeMove ? null : move, live);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);

  const state = { shape: known, expression: face, color: hex, ...(resolvedDef ? { avatarDef: resolvedDef } : {}) };
  const still = useMemo(
    () => stillFrame({ shape: known, expression: face, color: hex, ...(resolvedDef ? { avatarDef: resolvedDef } : {}) }),
    [known, face, hex, resolvedDef],
  );
  const sidebarState = useRef(state);
  sidebarState.current = state;

  // the small shapes' idle life: blinks on the shared clock (shape-idle.ts),
  // the breath in CSS, the sidebar's gaze; the eyes keep both the gaze and the blink
  const idle = !live && !reduced && (animated || sidebarGaze) && size >= IDLE_MIN && knownSkin !== "outline";
  const gazeNow = useRef({ x: 0, y: 0 });
  const openNow = useRef(1);
  const drawIdle = () => {
    if (!body.current) return;
    const g = gazeNow.current;
    const o = openNow.current;
    const f = g.x === 0 && g.y === 0 ? (o === 1 ? still : blinkFrame(sidebarState.current, o)) : gazeFrame(sidebarState.current, g.x, g.y, {}, { left: o, right: o });
    writeShape(body.current, drawShape(f, grounded(REST_POSE, shapeRef.current), volumeDetail(size), eyeStyleFor(moodRef.current), bendRef.current));
  };
  const drawIdleRef = useRef(drawIdle);
  drawIdleRef.current = drawIdle;
  useEffect(() => {
    if (!idle || !root.current) return;
    const unregister = registerIdleShape({
      el: root.current,
      seed: idleSeed(uid),
      blink: (open) => {
        openNow.current = open;
        drawIdleRef.current();
      },
    });
    return () => {
      unregister();
      openNow.current = 1;
    };
  }, [idle, uid]);
  // a click: a double blink on a small shape (the sidebar also squishes its row's avatar)
  const lastIdleMove = useRef(0);
  useEffect(() => {
    if (!idle || !shapeMove || shapeMove.key === lastIdleMove.current || !root.current) return;
    lastIdleMove.current = shapeMove.key;
    blinkIdleShape(root.current);
  }, [idle, shapeMove]);

  useEffect(() => {
    if (!sidebarGaze || live || !sidebarGazeRef) return;
    const apply = (gaze: { x: number; y: number }) => {
      gazeNow.current = gaze;
      drawIdleRef.current();
    };
    sidebarGazeRef.current = apply;
    return () => {
      sidebarGazeRef.current = null;
      gazeNow.current = { x: 0, y: 0 };
      if (body.current) writeShape(body.current, drawShape(still, grounded(REST_POSE, shapeRef.current), volumeDetail(size), eyeStyleFor(moodRef.current), bendRef.current));
    };
  }, [sidebarGaze, live, sidebarGazeRef, still]);
  const engine = useRef<ShapeEngine | null>(null);
  const motion = useRef<ShapeMotion | null>(null);
  const poseRef = useRef<Pose>(grounded(REST_POSE, known));
  const lastFrame = useRef<ShapeFrame | null>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const shapeRef = useRef(known);
  shapeRef.current = known;
  const bendRef = useRef(knownSkin === "plain");
  bendRef.current = knownSkin === "plain";
  const [frame, setFrame] = useState<ShapeFrame | null>(null);
  if (live && engine.current) engine.current.set(state, seconds());

  // the live loop: one frame per animation frame while on screen
  useEffect(() => {
    if (!live) {
      engine.current = null;
      lastFrame.current = null;
      setFrame(null);
      return;
    }
    const run = new ShapeEngine(state, seconds());
    engine.current = run;
    const sway = new ShapeMotion(motionForMood(moodRef.current), idleSeed(uid), seconds());
    motion.current = sway;
    let raf = 0;
    // the frame React drew last: an idle frame (drift, breath, gaze, blink)
    // only moves the outline, so it is written onto the drawing, like Grump's
    let drawn: ShapeFrame | null = null;
    let lastDraw = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || root.current?.hasAttribute("data-fx-paused")) return;
      const at = seconds();
      // resting motion is slow (breath, wander, eased gaze): 30 frames a second
      // are enough and halve the cost; a move plays at the display's rate
      if (at - lastDraw < IDLE_FRAME_S && !run.playing(at)) return;
      lastDraw = at;
      sway.setMood(motionForMood(moodRef.current), at);
      const swayed = sway.pose(at);
      // the sway's lean moves the gaze; the outline keeps its resting turn (shape-volume.ts uprightPose)
      run.lean(swayed.yaw - REST_POSE.yaw, swayed.pitch - REST_POSE.pitch);
      const next = run.frame(at);
      const pose = grounded(uprightPose(swayed), shapeRef.current);
      poseRef.current = pose;
      lastFrame.current = next;
      if (drawn && body.current && shapeFrameWritable(drawn, next)) {
        writeShape(body.current, drawShape(next, pose, volumeDetail(size), eyeStyleFor(moodRef.current), bendRef.current));
        return;
      }
      drawn = next;
      setFrame(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // the engine follows shape, face and color itself (set above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // a Shapes move plays once per request
  const lastMove = useRef(0);
  useEffect(() => {
    if (!live || !shapeMove || !engine.current || shapeMove.key === lastMove.current) return;
    lastMove.current = shapeMove.key;
    if (isShapeMove(shapeMove.clip)) engine.current.play(shapeMove.clip, seconds());
  }, [live, shapeMove]);

  // the face turns toward the pointer (a mouse or a pen; touch is ignored)
  useEffect(() => {
    if (!live || !trackPointer || typeof window === "undefined") return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !root.current) return;
      const around = pointerAround(root.current.getBoundingClientRect(), event.clientX, event.clientY);
      engine.current?.pointer(around);
      motion.current?.pointer(around);
    };
    const onLeave = () => {
      engine.current?.pointer(null);
      motion.current?.pointer(null);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [live, trackPointer]);

  // after any React draw (a parent's re-render included), the last live frame and
  // pose are the ones on screen again, never an older frame React kept in state
  useLayoutEffect(() => {
    const f = lastFrame.current ?? frame;
    if (live && f && body.current) {
      // React may have drawn an older frame of its own: the live drawing goes on again in full
      writeShape(body.current, drawShape(f, poseRef.current, volumeDetail(size), eyeStyleFor(moodRef.current), bendRef.current));
    }
  });

  const shown = live && frame ? frame : still;
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("shape-mascot relative inline-flex shrink-0", animated && `shape-mascot-live shape-mood-${mood}`, live && "skin-fx-live", idle && `shape-idle shape-idle-${motionForMood(mood)}`, className)}
      style={idle ? idleStyle(size, idleSeed(uid)) : { width: size, height: size }}
      onPointerDown={live && !sidebarGaze ? (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        engine.current?.play("wink", seconds());
        motion.current?.pokeAt(seconds());
      } : idle && !sidebarGaze ? (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (root.current) blinkIdleShape(root.current);
      } : undefined}
      data-shape={known}
      data-shape-skin={knownSkin}
      data-skin-tier={paint.tier}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <ShapeFrameSvg
        frame={shown}
        uid={uid}
        skin={knownSkin}
        paint={paint}
        layers={layers}
        size={size}
        pose={live ? poseRef.current : grounded(REST_POSE, known)}
        eyeStyle={eyeStyleFor(mood)}
        bodyRef={body}
        bodyClass={cn(burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")}
      />
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={SHAPE_ART[known].d} />}
    </span>
  );
}
