// Bot avatar: the Sagax owl (OwlAvatar.tsx), wrapped in the app's
// historical MausAvatar API so no call site changes. The bot's color is the
// owl's plumage; the app's MausState vocabulary and one-shot MausMotion beats
// are translated to the owl's six states by src/lib/owl/owl-state.ts. A bot
// may wear another character instead (bot.mascotLook: one of the shapes, or
// Trombi), drawn by BotAvatar for every bot avatar in the app.
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { OWL_BEAT_MS, owlBeatForMotion, owlStateForMaus } from "@/lib/owl/owl-state";
import { OwlAvatar, type OwlAvatarHandle } from "./OwlAvatar";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop } from "../../shared/bot-avatar";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import type { MascotSkinId } from "../../shared/mascot-skins";
import { botMascotLook, completeMascotLook, type MascotLook } from "../../shared/mascot-look";
import { ShapeMascot, type ShapeMood } from "./ShapeMascot";
import type { TrombiPose } from "./retro-assistant/Trombi";
import { SkinnedTrombi } from "./skin-fx/SkinnedTrombi";
import { BunbuMascot, type BunbuMood } from "./BunbuMascot";
import { ShibaMascot } from "./ShibaMascot";
import { HdOrVector } from "./hd-mascots/HdMascot";
import { hdKeyForState } from "./hd-mascots/manifest";
import type { ShibaExpression } from "./shiba-art";
import { GrumpMascot } from "./GrumpMascot";
import { OgreMascot } from "./OgreMascot";
import { FrogMascot } from "./FrogMascot";
import { CrabMascot } from "./CrabMascot";
import type { FrogExpression } from "./frog-art";
import type { FxMoveRequest } from "./skin-fx/skin-fx";

/** Kept for API compatibility (the preview page reads them); the owl ignores both. */
export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

/** A head turn of this many degrees looks all the way to one side. */
const TURN_FULL_DEG = 90;

export interface MausAvatarHandle {
  blink: () => void;
  /** The old engine spun the body; the owl hops. */
  spin: (durationMs?: number) => void;
  /** The owl has no expression sheet; kept so old callers still compile. */
  setExpression: (index: number) => void;
  setPointerGaze: (offset: { x: number; y: number } | null) => void;
}

export type MausAvatarProps = {
  color: MausColor;
  /** Named behaviour, mapped to one of the owl's six states. */
  state?: MausState;
  /** Ignored by the owl (it has no expression sheet). */
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  /** Head turn in degrees: moves the owl's gaze sideways. */
  turn?: number;
  /** Pins the gaze (-1..1 per axis). */
  gaze?: { x?: number; y?: number };
  /** Ignored by the owl. */
  spring?: number;
  /** Ignored by the owl. */
  eyeScale?: number;
  /** Ignored by the owl (it has no mouth). */
  showMouth?: boolean;
  /** Ignored by the owl. */
  mouthStroke?: number;
  /** Ignored by the owl. */
  forward?: boolean;
  /** Ignored by the owl. */
  lookAround?: number;
  /** Let the eye follow the pointer across this avatar. */
  trackPointer?: boolean;
  /** Run the animation. Off draws the resting pose once. */
  animated?: boolean;
  /** Sidebar: shared pointer gaze while idle (no full body loop). */
  sidebarGaze?: boolean;
  /** Ignored: every bot is the owl now. The field stays on the wire. */
  bodyId?: MascotBodyId;
  /** Special-edition skin. Missing or unknown values wear none. */
  skin?: MascotSkinId | null;
  /** Play the skin's effects even while `animated` is off (skin pickers). */
  skinAnimated?: boolean;
  /** A one-shot move's skin effect (the Appearance gallery's Moves). */
  move?: FxMoveRequest | null;
};

function MausAvatarComponent(
  {
    color,
    state = "idle",
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    gaze,
    trackPointer = true,
    animated = true,
    sidebarGaze = false,
    skin,
    skinAnimated,
    move,
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  const owl = useRef<OwlAvatarHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => owl.current?.blink(),
    spin: () => owl.current?.play("success"),
    setExpression: () => {},
    setPointerGaze: (offset) => owl.current?.setPointerGaze(offset),
  }));

  // success/alert are one-shots: the owl rests as idle and plays the beat
  // when the bot enters the state (not on first mount, so a list of happy
  // bots does not all jump at once).
  const mapped = owlStateForMaus(state);
  const restState = mapped.oneShot ? "idle" : mapped.state;
  const entered = useRef(mapped.state);
  useEffect(() => {
    if (mapped.state === entered.current) return;
    entered.current = mapped.state;
    if (animated && mapped.oneShot) owl.current?.play(mapped.state);
  }, [mapped.state, mapped.oneShot, animated]);

  // A one-shot motion borrows a state (or a blink) for a moment.
  useEffect(() => {
    if (!animated) return;
    const beat = owlBeatForMotion(motion);
    if (!beat) return;
    if (beat.blink) owl.current?.blink();
    if (beat.play) owl.current?.play(beat.play, OWL_BEAT_MS);
    if (beat.wings) owl.current?.flourish(beat.wings);
  }, [motion, motionKey, animated]);

  const pinned =
    gaze || turn
      ? {
          x: Math.max(-1, Math.min(1, (gaze?.x ?? 0) + (turn ?? 0) / TURN_FULL_DEG)),
          y: Math.max(-1, Math.min(1, gaze?.y ?? 0)),
        }
      : undefined;

  return (
    <OwlAvatar
      ref={owl}
      color={color}
      state={animated ? restState : mapped.state === "alert" ? "alert" : restState}
      size={size}
      label={label ?? null}
      animated={animated}
      sidebarGaze={sidebarGaze}
      trackPointer={trackPointer}
      gaze={pinned}
      skin={skin}
      skinAnimated={skinAnimated}
      move={move}
    />
  );
}

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color"> & {
  /** Sidebar hover gaze and tap reactions while the row mascot is idle. */
  sidebarAlive?: boolean;
  /** Blink / hop for owls in the sidebar. */
  mascotRef?: React.Ref<MausAvatarHandle>;
  shapeGazeRef?: React.MutableRefObject<((gaze: { x: number; y: number }) => void) | null>;
  bot: {
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: MascotBodyId | null;
    mascotSkin?: MascotSkinId | null;
    /** The bot's character (owl, shape, Trombi); absent means the owl. */
    mascotLook?: MascotLook | null;
  };
  /** A one-shot move (the Appearance gallery's Moves): a shape's or Trombi's body motion and skin effect, the owl's skin effect. */
  characterMove?: FxMoveRequest | null;
  /** Mark this avatar as its person's Primary Bot: a small orange circle with
   * a white star at the bottom-right corner. Lists pass it (sidebar,
   * pickers, team map, chat header); a transcript does not. */
  primary?: boolean;
  /** The ring around the star, in the colour of what the avatar sits on. */
  primaryRingClassName?: string;
  /** Draw the mascot as large as its box, as Grok Bot's sidebar does (avatarFillScale). */
  fillBox?: boolean;
};

/** The Primary Bot mark: orange circle, white star, bottom-right. */
export function PrimaryBotBadge({ size, ringClassName = "ring-panel", label }: { size: number; ringClassName?: string; label?: string }) {
  // Grok Bot's main-bot corner: 16px on a 60px portrait (scaled with it,
  // never under 10px), flush in the avatar box's bottom-right corner, an
  // 8px star (half the badge), cut out of the avatar by a ring of the
  // ground about 2.7px wide at 60px.
  const badge = Math.min(16, Math.max(10, Math.round((size * 16) / 60)));
  const star = Math.max(6, Math.round(badge / 2));
  const ring = size >= 48 ? "ring-[2.5px]" : "ring-[1.5px]";
  return (
    <span
      data-testid="primary-bot-badge"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={`pointer-events-none absolute flex items-center justify-center rounded-full bg-primary-badge text-primary-badge-ink ${ring} ${ringClassName}`}
      style={{ width: badge, height: badge, right: 0, bottom: 0 }}
    >
      <svg viewBox="0 0 24 24" width={star} height={star} fill="currentColor" aria-hidden="true">
        <path d="M12 2.6l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.03l-5.66 2.98 1.08-6.3-4.58-4.46 6.33-.92z" />
      </svg>
    </span>
  );
}

/** A shape's mood for the app's mascot states. */
export function shapeMoodFor(state: MausState | undefined): ShapeMood {
  if (!state) return "idle";
  if (["thinking", "searching", "loading", "curious", "confused"].includes(state)) return "thinking";
  if (state === "alerting") return "blocked";
  if (["writing", "sending", "receiving", "dictating"].includes(state)) return "streaming";
  if (["working", "progress", "orbit", "radar", "uploading", "humming"].includes(state)) return "working";
  if (["happy", "celebrate", "proud", "laughing", "excited", "playful", "notifying"].includes(state)) return "happy";
  if (["sleeping", "drowsy", "powering-down"].includes(state)) return "sleeping";
  return "idle";
}

/** Trombi's pose for the app's mascot states. */
export function trombiPoseFor(state: MausState | undefined): TrombiPose {
  // Trombi keeps his own poses: the shapes' newer moods fold back onto them
  if (state === "listening" || state === "notifying") return "speak";
  const mood = shapeMoodFor(state);
  if (mood === "thinking" || mood === "working" || mood === "streaming") return "think";
  if (mood === "happy") return "celebrate";
  if (mood === "sleeping") return "sleep";
  return "idle";
}

/** Bunbu's face for the app's mascot states (listening perks its ears, speaking moves its grin). */
export function bunbuMoodFor(state: MausState | undefined): BunbuMood {
  if (state === "listening" || state === "dictating") return "listening";
  if (state === "notifying") return "speaking";
  // Bunbu keeps its own five moods: the shapes' newer ones fold back onto them
  const mood = shapeMoodFor(state);
  return mood === "streaming" ? "working" : mood === "blocked" ? "idle" : mood;
}

/** Shiba's face for the app's mascot states: most states name one of its sixteen faces. */
export function shibaExpressionFor(state: MausState | undefined): ShibaExpression {
  switch (state) {
    case "sleeping":
    case "drowsy":
    case "powering-down":
      return "sleepy";
    case "thinking":
    case "searching":
    case "loading":
    case "curious":
      return "curious";
    case "listening":
    case "dictating":
    case "waking":
    case "working":
    case "progress":
    case "orbit":
    case "radar":
    case "writing":
    case "uploading":
    case "sending":
    case "receiving":
    case "humming":
      return "attentive";
    case "excited":
    case "celebrate":
    case "playful":
    case "bouncing":
      return "excited";
    case "surprised":
    case "alerting":
    case "notifying":
      return "surprised";
    case "happy":
    case "suspicious":
    case "angry":
    case "confused":
    case "bored":
    case "proud":
    case "shy":
    case "sad":
    case "laughing":
    case "scared":
      return state;
    default:
      return "neutral";
  }
}

/** Ogre's face for the app's mascot states: the same sixteen ids as Shiba's, so the same choice. */
export const ogreExpressionFor = shibaExpressionFor;

/** Frog's face for the app's mascot states: the same sixteen faces as Shiba's, one map for both. */
export function frogExpressionFor(state: MausState | undefined): FrogExpression {
  return shibaExpressionFor(state);
}

/**
 * The bot's character, when it is not the owl: one of the shapes, Trombi, Bunbu, Shiba, Grump, Ogre or Frog, in the bot's look. Every bot avatar in the app comes through
 * BotAvatar, so this is where a character change shows everywhere.
 */
function CharacterAvatar({
  look,
  color,
  size,
  state,
  animated = true,
  sidebarGaze = false,
  label,
  move,
  shapeGazeRef,
}: {
  look: MascotLook;
  color: MausColor;
  size: number;
  state?: MausState;
  animated?: boolean;
  sidebarGaze?: boolean;
  label?: string | null;
  move?: FxMoveRequest | null;
  shapeGazeRef?: React.MutableRefObject<((gaze: { x: number; y: number }) => void) | null>;
}) {
  const full = completeMascotLook(look);
  if (full.character === "shape") {
    return (
      <ShapeMascot
        shape={full.shape}
        skin={full.skins.shape}
        color={color}
        size={size}
        mood={shapeMoodFor(state)}
        animated={animated}
        sidebarGaze={sidebarGaze}
        sidebarGazeRef={shapeGazeRef}
        move={move}
        moveBody
        label={label ?? null}
      />
    );
  }
  if (full.character === "shiba") {
    // HD art while "HD mascots" is on (src/components/hd-mascots); the vector Shiba otherwise, and while the art loads
    return (
      <HdOrVector character="shiba" hdKey={hdKeyForState(state)} size={size} animated={animated} label={label ?? null}>
        <ShibaMascot skin={full.skins.shiba} color={color} size={size} mood={bunbuMoodFor(state)} expression={shibaExpressionFor(state)} animated={animated} move={move} moveBody label={label ?? null} />
      </HdOrVector>
    );
  }
  if (full.character === "grump") {
    // Grump's sixteen faces carry the Shapes ids, so the Shiba's state map serves both
    return <GrumpMascot skin={full.skins.grump} color={color} size={size} mood={bunbuMoodFor(state)} expression={shibaExpressionFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  if (full.character === "ogre") {
    return <OgreMascot skin={full.skins.ogre} color={color} size={size} mood={bunbuMoodFor(state)} expression={ogreExpressionFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  if (full.character === "frog") {
    return <FrogMascot skin={full.skins.frog} color={color} size={size} mood={bunbuMoodFor(state)} expression={frogExpressionFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  if (full.character === "crab") {
    return <CrabMascot skin={full.skins.crab} color={color} size={size} mood={bunbuMoodFor(state)} expression={frogExpressionFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  if (full.character === "bunbu") {
    return <BunbuMascot skin={full.skins.bunbu} color={color} size={size} mood={bunbuMoodFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  return <SkinnedTrombi skin={full.skins.trombi} pose={trombiPoseFor(state)} size={size} width={Math.round(size * 0.78)} animated={animated} move={move} moveBody label={label ?? null} />;
}

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/**
 * Pick which of the two ways to render a bot's avatar, given the parsed
 * profile plus whether the image has already failed to load. Kept as a pure
 * function — independent of React state and effects — so both arms can be
 * unit-tested directly: `imageFailed` is set by the `<img>`'s own `onError`,
 * which `renderToStaticMarkup` never fires, so the failure fallback is
 * unreachable from a synchronous render test.
 *
 * The iOS half of this decision is `resolveBotAvatarOutcome` in
 * `ios/Sources/CompanionCore/BotAvatarRendering.swift`, which mirrors this
 * union name for name so the two renderers can be read side by side.
 */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

/**
 * The one renderer for a bot's chosen profile image. Malformed persisted
 * values and images that fail to load both fall back to the animated mascot,
 * so an old/corrupt profile can never leave a broken-image icon in the app.
 */
/**
 * Grok Bot's sidebar portrait fills its box (36px in a row, 60px on a pinned
 * tile). A shape mascot's body only uses about 62% of its frame, the rest is
 * room for its moves, so in the sidebar it is drawn 1.6 times larger to fill
 * the same box. Scaled about the point that puts the bodies' centre in the
 * box's centre; the box, its layout and the Primary Bot star do not change.
 */
export const SHAPE_FILL_SCALE = 1.6;
const SHAPE_FILL_ORIGIN = "50% 38%";

/** How much larger a bot's avatar is drawn when it must fill its box. */
export function avatarFillScale(bot: BotAvatarProps["bot"]): number {
  if (botAvatarProfile(bot).avatarUrl) return 1;
  return botMascotLook(bot.mascotLook).character === "shape" ? SHAPE_FILL_SCALE : 1;
}

export function BotAvatar({ primary, primaryRingClassName, fillBox, ...props }: BotAvatarProps) {
  const scale = fillBox ? avatarFillScale(props.bot) : 1;
  if (!primary && scale === 1) return <BotAvatarImage {...props} />;
  const size = props.size ?? 44;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-primary-bot={primary ? "" : undefined}>
      {scale === 1 ? <BotAvatarImage {...props} /> : (
        <span data-avatar-fill="" className="inline-flex" style={{ transform: `scale(${scale})`, transformOrigin: SHAPE_FILL_ORIGIN }}>
          <BotAvatarImage {...props} />
        </span>
      )}
      {primary && <PrimaryBotBadge size={size} ringClassName={primaryRingClassName} label={t("primaryBot.badge")} />}
    </span>
  );
}

function BotAvatarImage({
  bot,
  size = 44,
  label,
  characterMove,
  sidebarAlive,
  mascotRef,
  shapeGazeRef,
  ...mascotProps
}: Omit<BotAvatarProps, "primary" | "primaryRingClassName">) {
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  const look = botMascotLook(bot.mascotLook);
  const sidebarGaze = Boolean(sidebarAlive && !mascotProps.animated);
  if (outcome !== "flatImage" && look.character !== "owl") {
    return (
      <CharacterAvatar
        look={look}
        color={bot.color}
        size={size}
        state={mascotProps.state}
        animated={mascotProps.animated}
        sidebarGaze={sidebarGaze}
        shapeGazeRef={shapeGazeRef}
        label={label ?? bot.name}
        move={characterMove}
      />
    );
  }
  if (outcome !== "flatImage") {
    return (
      <MausAvatar
        ref={mascotRef}
        skin={bot.mascotSkin}
        move={characterMove}
        {...mascotProps}
        sidebarGaze={sidebarGaze}
        showMouth={false}
        color={bot.color}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
