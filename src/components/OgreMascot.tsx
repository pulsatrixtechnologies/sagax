// Ogre, the big green ogre (an original character, ogre-art.ts: direction C,
// "aplat net"), in the bot's color and an Ogre skin (skin-fx/ogre-skins.tsx).
// Pure SVG: the drawing is the rig's layers (ogre-moves.ts ogreFrameLayers),
// each part its own group (the whole, the legs, the body and its belly, the
// arms, the head, the ears, the eyes, the mouth). Small avatars draw a skin's
// still look (no filter, nothing moving) and the bust under 48 px; larger
// ones breathe, blink and wiggle a trumpet in CSS (ogre-mascot.css) and play
// a skin's idle effect, equip animation and move effects. A move (one of
// Ogre's own, or a clip that maps to one) or an action (the desktop's walk,
// nap, arms crossed) runs the rig at the display's own rate (120 Hz on
// ProMotion): a frame that only moves parts is written straight onto the
// drawing's groups (their `transform`), and React draws again only when a
// part's shape changes (a face, a stance, a limb, a prop). Reduced motion
// keeps it still.
import "./ogre-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { mascotHex } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { OGRE_SKIN_TIER, type OgreSkin } from "../../shared/mascot-look";
import { LOG_DROP, movePath, OGRE_ART, OGRE_PIVOTS, ogreViewBox, type OgreExpression, type OgreOp, type OgrePalette } from "./ogre-art";
import { ogreMoveFor, OgreRig, reducedFace, type OgreMove } from "./ogre-moves";
import { ogreFrameLayers, restFrame, type OgreFrame, type OgreLayer } from "./ogre-rig";
import { ogreSkinId, ogreSkinLayers, ogreSkinPaint } from "./skin-fx/ogre-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type OgreMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** The face a mood wears (the five approved moods, and the call's listening and speaking). */
export function ogreExpressionForMood(mood: OgreMood): OgreExpression {
  switch (mood) {
    case "thinking":
      return "curious";
    case "working":
    case "listening":
      return "attentive";
    case "happy":
      return "happy";
    case "sleeping":
      return "sleepy";
    case "speaking":
      return "excited";
    default:
      return "neutral";
  }
}

export interface OgreMascotProps {
  skin?: OgreSkin | string;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: OgreMood;
  /** A face of its own, over the mood's (one of the sixteen). */
  expression?: OgreExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: its skin effect, and with moveBody the body's own motion (one of Ogre's moves, or a clip that maps to one). */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  /** What the ogre is doing until told otherwise (the desktop: the walk, the nap, arms crossed), and which way it faces. */
  action?: OgreMove | null;
  facing?: 1 | -1;
  /** The ground shakes (box units, each frame of a step or a stomp): the desktop shakes its window. */
  onShake?: (amount: number) => void;
  label?: string | null;
  className?: string;
}

/** Ops as SVG elements with a palette; `uid` keeps clip ids apart. */
export function OgreOpsSvg({ ops, palette, uid }: { ops: readonly OgreOp[]; palette: OgrePalette; uid: string }) {
  return (
    <>
      {ops.map((op, i) => {
        const path = (
          <path
            key={op.clip ? undefined : i}
            d={op.d}
            fill={op.fill ? palette[op.fill] : "none"}
            stroke={op.stroke ? palette[op.stroke] : undefined}
            strokeWidth={op.stroke ? op.width : undefined}
            strokeLinejoin={op.stroke ? "round" : undefined}
            strokeLinecap={op.stroke && op.round ? "round" : undefined}
            opacity={op.opacity}
          />
        );
        if (!op.clip) return path;
        const id = `${uid}-c${i}`;
        return (
          <g key={i}>
            <clipPath id={id}>
              <path d={op.clip} />
            </clipPath>
            <g clipPath={`url(#${id})`}>{path}</g>
          </g>
        );
      })}
    </>
  );
}

const Ops = memo(OgreOpsSvg);

/** Each layer's pivot (CSS idle loops turn about it), box units. */
const PIVOT: Partial<Record<string, readonly [number, number]>> = {
  whole: OGRE_PIVOTS.ground,
  earL: OGRE_PIVOTS.earL,
  earR: OGRE_PIVOTS.earR,
  eyeL: OGRE_PIVOTS.eyeL,
  eyeR: OGRE_PIVOTS.eyeR,
  mouth: OGRE_PIVOTS.mouth,
  belly: OGRE_PIVOTS.belly,
};

const CLASS: Partial<Record<string, string>> = {
  whole: "ogre-whole",
  body: "ogre-body",
  belly: "ogre-belly",
  head: "ogre-head",
  earL: "ogre-ear ogre-ear-l",
  earR: "ogre-ear ogre-ear-r",
  eyeL: "ogre-eye",
  eyeR: "ogre-eye",
  mouth: "ogre-mouth",
  props: "ogre-props",
};

interface SkinLayers {
  head: ReturnType<typeof ogreSkinLayers>;
  body: ReturnType<typeof ogreSkinLayers>;
}

function clippedLayer(id: string, d: string, layer: ReactNode) {
  if (!layer) return null;
  return (
    <g>
      <clipPath id={id}>
        <path d={d} />
      </clipPath>
      <g clipPath={`url(#${id})`}>{layer}</g>
    </g>
  );
}

/** The rig's layers as SVG groups, the skin's treatment on the head and the body. */
function Layers({ layers, palette, uid, fx, bodyPath }: { layers: readonly OgreLayer[]; palette: OgrePalette; uid: string; fx: SkinLayers; bodyPath: string }) {
  return (
    <>
      {layers.map((layer) => {
        const pivot = PIVOT[layer.key];
        const children = layer.children ? <Layers layers={layer.children} palette={palette} uid={`${uid}-${layer.key}`} fx={fx} bodyPath={bodyPath} /> : null;
        return (
          <g key={layer.key} data-ogre-layer={layer.key} transform={layer.transform || undefined} className={CLASS[layer.key]} style={pivot ? { transformOrigin: `${pivot[0]}px ${pivot[1]}px` } : undefined}>
            {layer.key === "head" && fx.head?.under}
            {layer.key === "body" && fx.body?.under}
            <Ops ops={layer.ops} palette={palette} uid={`${uid}-${layer.key}`} />
            {layer.key === "body" && clippedLayer(`${uid}-bclip`, bodyPath, fx.body?.inner)}
            {layer.key === "body" && fx.body?.edge}
            {layer.key === "skull" && clippedLayer(`${uid}-hclip`, OGRE_ART.head, fx.head?.inner)}
            {layer.key === "skull" && fx.head?.edge}
            {children}
          </g>
        );
      })}
    </>
  );
}

/** Whether two drawings have the same parts, so only their groups' transforms
 * differ (exported for tests). Ops from the parts cache are the same arrays
 * from one frame to the next; a limb or a prop is rebuilt every frame and
 * compared by its paths. */
export function sameOgreShapes(a: readonly OgreLayer[], b: readonly OgreLayer[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.key !== y.key || !sameOps(x.ops, y.ops)) return false;
    if (Boolean(x.children) !== Boolean(y.children)) return false;
    if (x.children && y.children && !sameOgreShapes(x.children, y.children)) return false;
  }
  return true;
}

function sameOps(a: readonly OgreOp[], b: readonly OgreOp[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x.d !== y.d || x.fill !== y.fill || x.stroke !== y.stroke || x.width !== y.width || x.opacity !== y.opacity || x.clip !== y.clip || x.round !== y.round) return false;
  }
  return true;
}

/** Write each layer's transform onto its group in `svg` (exported for tests). */
export function writeOgreTransforms(svg: Pick<SVGSVGElement, "querySelectorAll">, layers: readonly OgreLayer[]): void {
  const groups = new Map<string, Element>();
  svg.querySelectorAll("[data-ogre-layer]").forEach((group) => groups.set(group.getAttribute("data-ogre-layer") ?? "", group));
  const write = (list: readonly OgreLayer[]) => {
    for (const layer of list) {
      const group = groups.get(layer.key);
      if (group) {
        if (layer.transform) group.setAttribute("transform", layer.transform);
        else group.removeAttribute("transform");
      }
      if (layer.children) write(layer.children);
    }
  };
  write(layers);
}

/**
 * Runs the rig while something plays (a one-shot move, or a held action): a
 * frame on every display frame (120 Hz on ProMotion), none while the page is
 * hidden; null when the rig rests (the still drawing and its CSS idle show).
 * A frame that keeps every part's shape goes straight onto the drawing's
 * groups (`svg`); only a change of shape draws through React.
 */
function useRig(enabled: boolean, action: OgreMove | null, shot: { move: OgreMove; key: number } | null, facing: 1 | -1, onShake: ((amount: number) => void) | undefined, svg: React.RefObject<SVGSVGElement | null>, draw: { size: number; marks?: ReturnType<typeof ogreSkinPaint>["marks"] }): OgreFrame | null {
  const [frame, setFrame] = useState<OgreFrame | null>(null);
  const rig = useRef<OgreRig | null>(null);
  const live = useRef({ onShake, draw });
  live.current = { onShake, draw };
  const [awake, setAwake] = useState(0);
  // the held action and the facing go straight to the rig
  useEffect(() => {
    if (!enabled) return;
    rig.current ??= new OgreRig(performance.now() / 1000);
    rig.current.facing = facing;
    rig.current.hold(action, performance.now() / 1000);
    setAwake((n) => n + 1);
  }, [enabled, action, facing]);
  const shotKey = shot?.key ?? 0;
  const shotMove = shot?.move ?? null;
  useEffect(() => {
    if (!enabled || !shotMove || !shotKey) return;
    rig.current ??= new OgreRig(performance.now() / 1000);
    rig.current.play(shotMove, performance.now() / 1000);
    setAwake((n) => n + 1);
  }, [enabled, shotMove, shotKey]);
  useEffect(() => {
    const current = rig.current;
    if (!enabled || !current || !awake) {
      setFrame(null);
      return;
    }
    let raf = 0;
    // the layers React drew last: a frame with the same shapes is only written
    let drawn: OgreLayer[] | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (typeof document !== "undefined" && document.hidden) return;
      const now = performance.now() / 1000;
      if (!current.busy(now)) {
        cancelAnimationFrame(raf);
        live.current.onShake?.(0);
        setFrame(null);
        return;
      }
      const next = current.frame(now);
      live.current.onShake?.(next.shake);
      const layers = ogreFrameLayers(next, live.current.draw);
      if (drawn && svg.current && sameOgreShapes(drawn, layers)) {
        writeOgreTransforms(svg.current, layers);
        return;
      }
      drawn = layers;
      setFrame(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, awake]);
  return enabled ? frame : null;
}

export interface OgreDrawingProps {
  uid: string;
  palette: OgrePalette;
  skin: OgreSkin;
  hex: string;
  size: number;
  frame: OgreFrame;
  full: boolean;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
  marks?: ReturnType<typeof ogreSkinPaint>["marks"];
}

/** One drawing of Ogre at a frame (the still rest frame, or the rig's). */
export function OgreDrawing({ uid, palette, skin, hex, size, frame, full, svgRef, svgClass, defs, marks }: OgreDrawingProps) {
  const layers = useMemo(() => ogreFrameLayers(frame, { size, marks }), [frame, size, marks]);
  // The rig writes transforms onto the groups between React's draws; after
  // each draw, put this frame's back, so React's idea of them is the truth.
  const own = useRef<SVGSVGElement | null>(null);
  const setSvg = useCallback((node: SVGSVGElement | null) => {
    own.current = node;
    if (typeof svgRef === "function") svgRef(node);
    else if (svgRef) (svgRef as { current: SVGSVGElement | null }).current = node;
  }, [svgRef]);
  useLayoutEffect(() => {
    if (own.current) writeOgreTransforms(own.current, layers);
  }, [layers]);
  const bodyPath = frame.stance === "rest" ? OGRE_ART.body : frame.stance === "log" ? movePath(OGRE_ART.torso, 0, LOG_DROP) : OGRE_ART.torso;
  const head = useMemo(() => ogreSkinLayers(skin, OGRE_ART.head, hex, `${uid}-hf`, full, "head"), [skin, hex, uid, full]);
  const body = useMemo(() => ogreSkinLayers(skin, bodyPath, hex, `${uid}-bf`, full), [skin, bodyPath, hex, uid, full]);
  const box = frame.stance === "rest" ? ogreViewBox(size) : "0 0 100 100";
  return (
    <svg viewBox={box} width="100%" height="100%" ref={setSvg} className={svgClass} style={{ overflow: "visible", display: "block" }} data-stance={frame.stance}>
      {(defs || head?.defs || body?.defs) && (
        <defs>
          {defs}
          {head?.defs}
          {body?.defs}
        </defs>
      )}
      <Layers layers={layers} palette={palette} uid={uid} fx={{ head, body }} bodyPath={bodyPath} />
      {head?.around && <g className="skin-fx-around">{head.around}</g>}
    </svg>
  );
}

export function OgreMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, action = null, facing = 1, onShake, label = null, className }: OgreMascotProps) {
  const known = ogreSkinId(skin);
  const hex = mascotHex(color);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `ogre-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = useMemo(() => ogreSkinPaint(known, hex, uid), [known, hex, uid]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const svg = useRef<SVGSVGElement>(null);
  useReplayMove(svg, burst && moveBody ? burst.key : null);
  const face = expression ?? ogreExpressionForMood(mood);
  // a one-shot move of the ogre's own (or a clip that maps to one) runs the rig; so does a held action
  const own = moveBody ? ogreMoveFor(move?.clip) : null;
  const shot = useMemo(() => (own && move?.key ? { move: own, key: move.key } : null), [own, move?.key]);
  const rigFrame = useRig(live, action, shot, facing, onShake, svg, { size, marks: paint.marks });
  // reduced motion: a move shows its face and stance, still
  const reducedMove = reduced ? (action ?? own) : null;
  const still = useMemo(() => {
    const shown = reducedMove ? reducedFace(reducedMove) : null;
    return shown ? { ...restFrame(shown.stance, shown.expression), mouth: shown.mouth } : restFrame("rest", face);
  }, [face, reducedMove]);
  const frame = rigFrame ?? still;
  const fxPal = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("ogre-mascot relative inline-flex shrink-0", animated && `ogre-live ogre-mood-${mood}`, rigFrame && "ogre-rig", live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="ogre"
      data-ogre-skin={known}
      data-skin-tier={OGRE_SKIN_TIER[known]}
      data-expression={frame.expression}
      data-ogre-action={action ?? undefined}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <OgreDrawing
        uid={uid}
        palette={paint.palette}
        skin={known}
        hex={hex}
        size={size}
        frame={frame}
        full={full}
        svgRef={svg}
        svgClass={cn(burst && moveBody && !own && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")}
        defs={paint.defs}
        marks={paint.marks}
      />
      {equip && <EquipFx key={equip} palette={fxPal} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={fxPal} uid={`${uid}-mv`} path={OGRE_ART.head} />}
    </span>
  );
}
