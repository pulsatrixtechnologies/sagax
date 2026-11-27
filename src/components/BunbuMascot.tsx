// Bunbu: our own collectible-vinyl little monster (an original character,
// bunbu-art.ts), in the bot's color and a Bunbu skin (skin-fx/bunbu-skins.tsx).
// Pure SVG and CSS, like the shapes: small avatars draw a skin's still look
// (no filter, nothing moving); larger ones play its idle effect, its equip
// animation and its move effects. It breathes, blinks, twitches an ear now
// and then, flops its ears (its signature move), waves an arm, perks its
// ears up while listening and moves its grin while speaking; reduced motion
// keeps it still. The desktop mascot draws the same component and moves the
// whole body itself (mascots.tsx), passing the action of the clip playing.
import "./bunbu-mascot.css";
import "./skin-fx/skin-fx.css";
import { useEffect, useId, useRef, useState } from "react";
import { mascotHex } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { BUNBU_SKIN_TIER, BUNBU_SKINS, type BunbuSkin, type SkinTier } from "../../shared/mascot-look";
import { relativeLuminance } from "../../shared/mascot-colors";
import { BUNBU_ART, BUNBU_SILHOUETTE, bunbuLipY } from "./bunbu-art";
import { bunbuSkinBase, bunbuSkinLayers } from "./skin-fx/bunbu-skins";
import { mix } from "./skin-fx/skin-fx";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, MOVE_FX_MS, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type BunbuMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** What the limbs and ears are doing: the signature ear flop, a wave, dangling while dragged, ears back in a hop. */
export type BunbuAction = "earflop" | "wave" | "drag" | "hop" | "walk";

/** The clip the Appearance gallery sends for Bunbu's signature move (an idle clip every character plays). */
export const BUNBU_EARFLOP_CLIP = "ruffle";

export interface BunbuMascotProps {
  skin?: BunbuSkin | string;
  /** A bot color name (mint) or any hex. */
  color: string;
  size?: number;
  mood?: BunbuMood;
  /** The ears' and arms' own motion now (the desktop mascot's clip). */
  action?: BunbuAction | null;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: its effect, and with moveBody the body's own motion. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

/** A Bunbu skin id this build knows, else Plain. */
export function bunbuSkinId(skin: string | null | undefined): BunbuSkin {
  return (BUNBU_SKINS as readonly string[]).includes(skin ?? "") ? (skin as BunbuSkin) : "plain";
}

/** How a skin paints Bunbu: its base finish, its tier and its effect family. */
export function bunbuSkinPaint(skin: BunbuSkin | string, hex: string) {
  const known = bunbuSkinId(skin);
  return { ...bunbuSkinBase(known, hex), tier: BUNBU_SKIN_TIER[known] as SkinTier };
}

/** The ears' inside: a soft pink on light finishes, a quiet glow on dark ones. */
function innerEarPaint(fill: string, hex: string, dark: boolean): { fill: string; opacity: number } {
  if (dark) return { fill: mix(hex, "#ffffff", 0.5), opacity: 0.28 };
  return { fill: mix(fill.startsWith("#") ? fill : hex, "#f59ac0", 0.78), opacity: 0.9 };
}

/** A move request the body plays (fx-body-*) and its burst: the ear flop bursts like a hop. */
function burstRequest(move: FxMoveRequest | null | undefined): FxMoveRequest | null {
  if (!move) return null;
  return move.clip === BUNBU_EARFLOP_CLIP ? { clip: "hop", key: move.key } : move;
}

/** The action a one-shot move plays on the ears and arms, for as long as its burst. */
function useMoveAction(move: FxMoveRequest | null | undefined, enabled: boolean): BunbuAction | null {
  const [action, setAction] = useState<BunbuAction | null>(null);
  const clip = move?.clip;
  const key = move?.key ?? 0;
  useEffect(() => {
    if (!enabled || !key) return;
    const next: BunbuAction | null = clip === BUNBU_EARFLOP_CLIP ? "earflop" : clip === "wave" || clip === "hoot" ? "wave" : clip === "hop" || clip === "jump" ? "hop" : null;
    if (!next) return;
    setAction(next);
    const timer = setTimeout(() => setAction((current) => (current === next ? null : current)), MOVE_FX_MS);
    return () => clearTimeout(timer);
  }, [clip, key, enabled]);
  return enabled ? action : null;
}

function Eyes({ mood, ink, highlight }: { mood: BunbuMood; ink: string; highlight: string }) {
  const { left, right, rx, ry } = BUNBU_ART.eyes;
  const eye = ([x, y]: readonly [number, number], key: string) => {
    if (mood === "sleeping") return <path key={key} d={`M${x - 5.5} ${y + 1}q5.5 4.4 11 0`} fill="none" stroke={ink} strokeWidth={2.8} strokeLinecap="round" />;
    if (mood === "happy") return <path key={key} d={`M${x - 5.5} ${y + 2.5}q5.5 -7 11 0`} fill="none" stroke={ink} strokeWidth={3} strokeLinecap="round" />;
    const look = mood === "thinking" || mood === "listening" ? -1.6 : 0;
    return (
      <g key={key} className="bunbu-eye">
        <ellipse cx={x} cy={y + look} rx={rx} ry={ry} fill={ink} />
        <circle cx={x + 2.2} cy={y - 2.6 + look} r={2.2} fill={highlight} />
        <circle cx={x - 2} cy={y + 3 + look} r={0.95} fill={highlight} opacity={0.85} />
      </g>
    );
  };
  return (
    <g className="bunbu-eyes">
      {eye(left, "l")}
      {eye(right, "r")}
    </g>
  );
}

function Mouth({ mood, lip }: { mood: BunbuMood; lip: string | null }) {
  const ink = "#2b1420";
  if (mood === "sleeping") return <path d="M45 64.5q5 2.6 10 0" fill="none" stroke={lip ?? ink} strokeWidth={2} strokeLinecap="round" />;
  if (mood === "thinking") return <ellipse cx={51} cy={65.5} rx={2.6} ry={2.2} fill={ink} stroke={lip ?? undefined} strokeWidth={lip ? 0.8 : undefined} />;
  const wide = mood === "happy";
  const d = wide ? BUNBU_ART.mouthWide : BUNBU_ART.mouth;
  const { cx, cy, rx, ry } = BUNBU_ART.tongue;
  return (
    <g className="bunbu-mouth">
      <path d={d} fill={ink} stroke={lip ?? undefined} strokeWidth={lip ? 0.8 : undefined} strokeLinejoin="round" />
      <ellipse cx={cx} cy={cy + (wide ? 1.6 : 0)} rx={rx} ry={ry} fill="#f07f7a" />
      <g fill="#ffffff">
        {BUNBU_ART.teeth.map((x) => {
          const tx = wide ? 50 + (x - 50) * 1.18 : x;
          const y = bunbuLipY(tx, wide) - 0.4;
          return <path key={x} d={`M${(tx - 1.7).toFixed(2)} ${y.toFixed(2)}L${(tx + 1.7).toFixed(2)} ${y.toFixed(2)}L${tx.toFixed(2)} ${(y + 3).toFixed(2)}Z`} />;
        })}
      </g>
    </g>
  );
}

export function BunbuMascot({ skin = "plain", color, size = 44, mood = "idle", action = null, animated = true, detail, move, moveBody = false, label = null, className }: BunbuMascotProps) {
  const known = bunbuSkinId(skin);
  const hex = mascotHex(color, "#98DDB9");
  const paint = bunbuSkinPaint(known, hex);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `bunbu-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const request = burstRequest(move);
  const burst = useMoveBurst(request, live);
  const moveAction = useMoveAction(move, animated && !reduced);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);
  const palette = fxPalette(paint.fx, hex);

  const bodyLayers = bunbuSkinLayers(known, BUNBU_ART.body, hex, `${uid}-b`, full);
  const earL = bunbuSkinLayers(known, BUNBU_ART.earLeft, hex, `${uid}-el`, full);
  const earR = bunbuSkinLayers(known, BUNBU_ART.earRight, hex, `${uid}-er`, full);
  const aura = bunbuSkinLayers(known, BUNBU_SILHOUETTE, hex, `${uid}-s`, full);
  // light eyes mean a dark finish (night, neon, galaxy, molten, velvet)
  const dark = relativeLuminance(paint.eyes) > 0.5;
  const inner = innerEarPaint(paint.fill, hex, dark);
  const edgeStroke = paint.stroke ?? mix(hex, "#000000", 0.2);
  const highlight = dark ? "#1b1f27" : "#ffffff";
  const lip = dark ? paint.eyes : null;
  const shown = moveAction ?? (animated && !reduced ? action : null);
  const tummy = known === "plain" || known === "pastel" || known === "plush" ? { fill: mix(paint.fill.startsWith("#") ? paint.fill : hex, "#ffffff", 0.45), opacity: 0.9 } : { fill: "#ffffff", opacity: 0.16 };

  const part = (key: string, d: string, layers: typeof bodyLayers) => (
    <g key={key}>
      <defs>
        <clipPath id={`${uid}-${key}-clip`}>
          <path d={d} />
        </clipPath>
        {layers.defs}
      </defs>
      <path d={d} fill={layers.fill} stroke={!layers.ownEdge && paint.stroke ? paint.stroke : undefined} strokeWidth={!layers.ownEdge && paint.stroke ? paint.strokeWidth : undefined} strokeLinejoin="round" />
      {paint.shine && <path d={d} fill={`url(#${uid}-shine)`} />}
      {layers.inner && <g clipPath={`url(#${uid}-${key}-clip)`}>{layers.inner}</g>}
      {layers.edge}
    </g>
  );
  const arm = (spec: { cx: number; cy: number; rx: number; ry: number; rotate: number; pivot: readonly [number, number] }, side: "l" | "r") => (
    <g className={`bunbu-arm bunbu-arm-${side}`} style={{ transformOrigin: `${spec.pivot[0]}px ${spec.pivot[1]}px` }}>
      <ellipse cx={spec.cx} cy={spec.cy} rx={spec.rx} ry={spec.ry} transform={`rotate(${spec.rotate} ${spec.cx} ${spec.cy})`} fill={bodyLayers.fill} stroke={edgeStroke} strokeOpacity={0.55} strokeWidth={1} />
    </g>
  );

  return (
    <span
      ref={root}
      className={cn("bunbu-mascot relative inline-flex shrink-0", animated && `bunbu-live bunbu-mood-${mood}`, shown && `bunbu-act-${shown}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="bunbu"
      data-bunbu-skin={known}
      data-skin-tier={paint.tier}
      data-fx={full ? "full" : "static"}
      data-bunbu-action={shown ?? undefined}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} ref={body} className={cn(burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")} style={{ overflow: "visible", display: "block" }}>
        {paint.shine && (
          <defs>
            <radialGradient id={`${uid}-shine`} cx="0.32" cy="0.26" r="0.75">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
              <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.06" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.16" />
            </radialGradient>
          </defs>
        )}
        {aura.defs && <defs>{aura.defs}</defs>}
        {aura.under}
        <g className="bunbu-body">
          <g className="bunbu-ear bunbu-ear-l" style={{ transformOrigin: `${BUNBU_ART.earPivot.left[0]}px ${BUNBU_ART.earPivot.left[1]}px` }}>
            {part("el", BUNBU_ART.earLeft, earL)}
            <path d={BUNBU_ART.innerLeft} fill={inner.fill} opacity={inner.opacity} />
          </g>
          <g className="bunbu-ear bunbu-ear-r" style={{ transformOrigin: `${BUNBU_ART.earPivot.right[0]}px ${BUNBU_ART.earPivot.right[1]}px` }}>
            {part("er", BUNBU_ART.earRight, earR)}
            <path d={BUNBU_ART.innerRight} fill={inner.fill} opacity={inner.opacity} />
          </g>
          {part("b", BUNBU_ART.body, bodyLayers)}
          <path d={BUNBU_ART.heart} fill={tummy.fill} opacity={tummy.opacity} />
          <path d={BUNBU_ART.tuft} fill="none" stroke={edgeStroke} strokeWidth={2} strokeLinecap="round" opacity={0.75} />
          {arm(BUNBU_ART.armLeft, "l")}
          {arm(BUNBU_ART.armRight, "r")}
          <g className="bunbu-face">
            <ellipse cx={BUNBU_ART.cheeks.left[0]} cy={BUNBU_ART.cheeks.left[1]} rx={BUNBU_ART.cheeks.rx} ry={BUNBU_ART.cheeks.ry} fill="#ff8fa3" opacity={dark ? 0.25 : 0.4} />
            <ellipse cx={BUNBU_ART.cheeks.right[0]} cy={BUNBU_ART.cheeks.right[1]} rx={BUNBU_ART.cheeks.rx} ry={BUNBU_ART.cheeks.ry} fill="#ff8fa3" opacity={dark ? 0.25 : 0.4} />
            <Eyes mood={mood} ink={paint.eyes} highlight={highlight} />
            <path d={BUNBU_ART.nose} fill="#f07f7a" />
            <Mouth mood={mood} lip={lip} />
          </g>
        </g>
        {bodyLayers.around && <g className="skin-fx-around">{bodyLayers.around}</g>}
      </svg>
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={BUNBU_ART.body} />}
    </span>
  );
}
