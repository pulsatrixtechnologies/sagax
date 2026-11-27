// Shiba, the dog (an original character, shiba-art.ts: direction C, "aplat
// net"), in the bot's color or a coat of its own and a Shiba skin
// (skin-fx/shiba-skins.tsx). Pure SVG: every part is its own group (the
// tail, the legs, the paws, the body, the ears, the head, the eyes, the
// mouth) that turns about its pivot. Small avatars draw a skin's still look
// (no filter, nothing moving) and the bust under 48 px. Larger ones breathe,
// blink, wag and twitch an ear in CSS (shiba-mascot.css), which costs no
// script; a move (a bark, a spin, a stretch...) or a held activity (walking,
// sleeping...) runs the rig of shiba-moves.ts instead, one pose per frame
// written straight onto the groups, and it hands back to CSS once done. The
// desktop mascot keeps the rig running. Reduced motion keeps it still: a
// move then only shows its face.
import "./shiba-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { MAUS_COLORS, mascotHex } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { SHIBA_SKIN_TIER, type ShibaSkin } from "../../shared/mascot-look";
import {
  SHIBA_ART,
  SHIBA_LEGS,
  SHIBA_PIVOTS,
  SHIBA_BUST_MAX,
  shibaOutline,
  shibaParts,
  shibaViewBox,
  STANCE_HEAD,
  legOps,
  type MouthKind,
  type ShibaExpression,
  type ShibaOp,
  type ShibaPalette,
  type ShibaStance,
} from "./shiba-art";
import { reducedFace, SHIBA_BARKS, SHIBA_MOVE_TIMING, ShibaRig, shibaMoveFor, shibaTransforms, type ShibaMove, type ShibaPose, type ShibaTransforms } from "./shiba-moves";
import { shibaSkinId, shibaSkinLayers, shibaSkinPaint } from "./skin-fx/shiba-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type ShibaMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** The face a mood wears (the five v3 moods, and the call's listening and speaking). */
export function shibaExpressionForMood(mood: ShibaMood): ShibaExpression {
  switch (mood) {
    case "thinking":
      return "curious";
    case "working":
      return "attentive";
    case "happy":
      return "happy";
    case "sleeping":
      return "sleepy";
    case "listening":
      return "attentive";
    case "speaking":
      return "excited";
    default:
      return "neutral";
  }
}

export interface ShibaMascotProps {
  skin?: ShibaSkin | string;
  /** A bot color name (orange) or any hex. */
  color: string;
  size?: number;
  mood?: ShibaMood;
  /** A face of its own, over the mood's (one of the sixteen). */
  expression?: ShibaExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: one of Shiba's (a clip name or a move id, shiba-moves.ts) plays on the rig; a skin's effect plays with it. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  /** A held activity (walk, sleep, talk, listen, work, drag): the rig runs it until it changes. */
  activity?: ShibaMove | null;
  /** The rig runs all the time (the desktop mascot), not only during a move or an activity. */
  rig?: boolean;
  /** Rings at each bark of the bark move (the sound, off unless the person turned it on). */
  onBark?: () => void;
  label?: string | null;
  className?: string;
}

/** Ops as SVG elements with a palette; `uid` keeps clip ids apart. */
export function OpsSvg({ ops, palette, uid }: { ops: readonly ShibaOp[]; palette: ShibaPalette; uid: string }) {
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

const Ops = memo(OpsSvg);

/** The groups the rig (shiba-moves.ts) moves, by name. */
export type ShibaGroup = keyof ShibaTransforms;
export type ShibaGroups = Partial<Record<ShibaGroup, SVGGElement | null>>;

export interface ShibaDrawingProps {
  uid: string;
  palette: ShibaPalette;
  skin: ShibaSkin;
  hex: string;
  size: number;
  expression: ShibaExpression;
  mouth?: MouthKind | null;
  stance?: ShibaStance;
  full: boolean;
  /** Where the live loop finds each moving group. */
  groups?: RefObject<ShibaGroups>;
  /** A pose drawn as it is (a still frame of a move: the keyframe renders, tests). */
  transforms?: ShibaTransforms | null;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
}

/**
 * One drawing of Shiba: the parts in their groups, the skin's treatment on
 * the head and the body. The live loop moves the groups (`groups`), a still
 * frame passes its `transforms`, otherwise CSS moves them (the idle loops)
 * or nothing does (still).
 */
export function ShibaDrawing({ uid, palette, skin, hex, size, expression, mouth = null, stance = "sit", full, groups, transforms, svgRef, svgClass, defs }: ShibaDrawingProps) {
  const parts = useMemo(() => shibaParts({ expression, mouth, stance, size }), [expression, mouth, stance, size]);
  const ow = shibaOutline(size);
  const bodyPath = stance === "stand" ? SHIBA_ART.standBody : stance === "lie" ? SHIBA_ART.lieBody : SHIBA_ART.body;
  const headFx = useMemo(() => shibaSkinLayers(skin, SHIBA_ART.head, hex, `${uid}-hf`, full, "head"), [skin, hex, uid, full]);
  const bodyFx = useMemo(() => shibaSkinLayers(skin, bodyPath, hex, `${uid}-bf`, full), [skin, bodyPath, hex, uid, full]);
  const head = STANCE_HEAD[stance];
  const [nx, ny] = SHIBA_PIVOTS.neck;
  const headPlace = head.scale === 1 && !head.x && !head.y ? undefined : `translate(${head.x} ${head.y}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})`;
  // each moving group: its ref for the live loop and its transform for a still frame. The pivots are in
  // the transforms; the CSS idle sets its own origins (shiba-mascot.css), since an inline origin would
  // also shift the transform attribute.
  const group = (key: ShibaGroup) => ({
    ref: (node: SVGGElement | null) => {
      if (groups?.current) groups.current[key] = node;
    },
    transform: transforms?.[key],
  });
  const legs = (side: "Far" | "Near") =>
    stance === "stand"
      ? SHIBA_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => (
          <g key={leg} className={`shiba-leg shiba-leg-${leg}`} {...group(leg)}>
            <Ops ops={legOps(leg, 0, 0, ow)} palette={palette} uid={`${uid}-${leg}`} />
          </g>
        ))
      : null;
  const clipped = (id: string, d: string, layer: ReactNode) =>
    layer ? (
      <g>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
        <g clipPath={`url(#${id})`}>{layer}</g>
      </g>
    ) : null;
  return (
    <svg viewBox={shibaViewBox(size)} width="100%" height="100%" ref={svgRef} className={svgClass} style={{ overflow: "visible", display: "block" }} data-stance={stance}>
      {(defs || headFx?.defs || bodyFx?.defs) && (
        <defs>
          {defs}
          {headFx?.defs}
          {bodyFx?.defs}
        </defs>
      )}
      <g className="shiba-whole" {...group("whole")}>
        {bodyFx?.under}
        <g className="shiba-tail" {...group("tail")}>
          <Ops ops={parts.tail} palette={palette} uid={`${uid}-t`} />
        </g>
        {legs("Far")}
        <g className="shiba-body">
          <Ops ops={parts.body} palette={palette} uid={`${uid}-b`} />
          {clipped(`${uid}-bclip`, bodyPath, bodyFx?.inner)}
          {bodyFx?.edge}
        </g>
        <g className="shiba-paw" {...group("pawL")}>
          <Ops ops={parts.pawL} palette={palette} uid={`${uid}-pl`} />
        </g>
        <g className="shiba-paw" {...group("pawR")}>
          <Ops ops={parts.pawR} palette={palette} uid={`${uid}-pr`} />
        </g>
        {legs("Near")}
        <g transform={headPlace}>
          <g className="shiba-head" {...group("head")}>
            {headFx?.under}
            <g className="shiba-ear shiba-ear-l" {...group("earL")}>
              <Ops ops={parts.earL} palette={palette} uid={`${uid}-el`} />
            </g>
            <g className="shiba-ear shiba-ear-r" {...group("earR")}>
              <Ops ops={parts.earR} palette={palette} uid={`${uid}-er`} />
            </g>
            <Ops ops={parts.head} palette={palette} uid={`${uid}-h`} />
            {clipped(`${uid}-hclip`, SHIBA_ART.head, headFx?.inner)}
            {headFx?.edge}
            <g className="shiba-face">
              <g className="shiba-brows" {...group("brows")}>
                <Ops ops={parts.brows} palette={palette} uid={`${uid}-br`} />
              </g>
              <g className="shiba-eye shiba-eye-l" {...group("eyeL")}>
                <Ops ops={parts.eyeL} palette={palette} uid={`${uid}-yl`} />
              </g>
              <g className="shiba-eye shiba-eye-r" {...group("eyeR")}>
                <Ops ops={parts.eyeR} palette={palette} uid={`${uid}-yr`} />
              </g>
              <Ops ops={parts.nose} palette={palette} uid={`${uid}-n`} />
              <g className="shiba-mouth" {...group("mouth")}>
                <Ops ops={parts.mouth} palette={palette} uid={`${uid}-m`} />
              </g>
              <Ops ops={parts.extras} palette={palette} uid={`${uid}-x`} />
            </g>
          </g>
        </g>
      </g>
      {headFx?.around && <g className="skin-fx-around">{headFx.around}</g>}
    </svg>
  );
}

const seconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

type Discrete = Pick<ShibaPose, "stance" | "expression" | "mouth">;
const sameDiscrete = (a: Discrete | null, b: Discrete | null) => a === b || (!!a && !!b && a.stance === b.stance && a.expression === b.expression && a.mouth === b.mouth);

export function ShibaMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, activity = null, rig: alwaysRig = false, onBark, label = null, className }: ShibaMascotProps) {
  const known = shibaSkinId(skin);
  const hex = mascotHex(color, MAUS_COLORS.orange);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `shiba-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = useMemo(() => shibaSkinPaint(known, hex, uid), [known, hex, uid]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const body = useRef<SVGSVGElement>(null);
  const shibaMove = shibaMoveFor(move?.clip);
  // a move of its own (a bark, a spin...) moves the parts; a skin's body motion only for the others
  useReplayMove(body, burst && moveBody && !shibaMove ? burst.key : null);
  const groups = useRef<ShibaGroups>({});
  const engine = useRef<ShibaRig | null>(null);
  const [discrete, setDiscrete] = useState<Discrete | null>(null);
  const [running, setRunning] = useState(false);
  const keepRunning = useRef(alwaysRig || activity !== null);
  keepRunning.current = alwaysRig || activity !== null;
  const barkHook = useRef(onBark);
  barkHook.current = onBark;
  const moveKey = move?.key ?? 0;

  // the rig lives while the drawing is live
  useEffect(() => {
    if (!live) {
      engine.current = null;
      return;
    }
    engine.current = new ShibaRig(seconds());
    if (keepRunning.current) setRunning(true);
    return () => {
      engine.current = null;
    };
  }, [live]);

  // a held activity (walking, sleeping, talking...)
  useEffect(() => {
    if (!live) return;
    engine.current?.hold(activity, seconds());
    if (activity || alwaysRig) setRunning(true);
  }, [activity, alwaysRig, live]);

  // a one-shot move, once per request; the bark rings its sound hook at each bark
  const lastMove = useRef(0);
  useEffect(() => {
    if (!live || !shibaMove || !moveKey || moveKey === lastMove.current) return;
    lastMove.current = moveKey;
    engine.current?.play(shibaMove, seconds());
    setRunning(true);
    if (shibaMove !== "bark" || !barkHook.current) return;
    const timers = SHIBA_BARKS.map((at) => setTimeout(() => barkHook.current?.(), at * 1000));
    return () => timers.forEach(clearTimeout);
  }, [live, shibaMove, moveKey]);

  // under reduced motion a move shows its face, still, for as long as it lasts
  const [stillFace, setStillFace] = useState<Discrete | null>(null);
  useEffect(() => {
    if (live || !animated || !shibaMove || !moveKey) return;
    const face = reducedFace(shibaMove);
    if (!face) return;
    setStillFace(face);
    const timer = setTimeout(() => setStillFace(null), SHIBA_MOVE_TIMING[shibaMove].duration * 1000);
    return () => clearTimeout(timer);
  }, [live, animated, shibaMove, moveKey]);
  const heldFace = !live && animated && activity ? reducedFace(activity) : null;

  // the loop: one pose per animation frame, written straight onto the groups
  useEffect(() => {
    if (!running || !live) return;
    let raf = 0;
    const clear = () => {
      for (const node of Object.values(groups.current)) node?.removeAttribute("transform");
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const run = engine.current;
      if (!run || document.hidden || root.current?.hasAttribute("data-fx-paused")) return;
      const now = seconds();
      const pose = run.pose(now);
      const transforms = shibaTransforms(pose);
      for (const key of Object.keys(transforms) as ShibaGroup[]) groups.current[key]?.setAttribute("transform", transforms[key]);
      const next: Discrete = { stance: pose.stance, expression: pose.expression, mouth: pose.mouth };
      setDiscrete((prev) => (sameDiscrete(prev, next) ? prev : next));
      if (!keepRunning.current && !run.busy(now)) {
        cancelAnimationFrame(raf);
        clear();
        setDiscrete(null);
        setRunning(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clear();
    };
  }, [running, live]);

  const shown = (running && live ? discrete : null) ?? stillFace ?? heldFace;
  const face = shown?.expression ?? expression ?? shibaExpressionForMood(mood);
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("shiba-mascot relative inline-flex shrink-0", animated && `shiba-live shiba-mood-${mood}`, running && live && "shiba-rig", live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="shiba"
      data-shiba-skin={known}
      data-skin-tier={SHIBA_SKIN_TIER[known]}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      data-shiba-move={shibaMove ?? undefined}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <ShibaDrawing
        uid={uid}
        palette={paint.palette}
        skin={known}
        hex={hex}
        size={size}
        expression={face}
        mouth={shown?.mouth ?? null}
        stance={size > SHIBA_BUST_MAX ? (shown?.stance ?? "sit") : "sit"}
        full={full}
        groups={groups}
        svgRef={body}
        svgClass={cn(burst && moveBody && !shibaMove && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop", full && paint.bodyClass)}
        defs={paint.defs}
      />
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={SHIBA_ART.head} />}
    </span>
  );
}
