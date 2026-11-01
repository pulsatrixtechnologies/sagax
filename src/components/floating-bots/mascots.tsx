// The desktop mascot registry: every character a bot can wear on the
// desktop, one entry each (id, label, what it can animate, how it draws on
// the desktop and as a thumbnail). Adding a character is adding an entry.
// The same behavior state machine (behavior.ts) drives them all; each
// renderer maps the clips it can show and degrades gracefully: the shapes,
// Trombi, Bunbu, Shiba, Grump, Ogre and Frog have no wings, so a flight is a bouncing hop across. The
// character and its look come from the bot (bot.mascotLook); the desktop
// draws a skin's full effects, and its move effects with each move.
import { useCallback, useEffect, useId, useRef, type ComponentType } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import type { LocaleKey } from "@/locales";
import { owlSkinId } from "@/lib/owl/owl-skins";
import { owlFxPalette } from "@/components/OwlSkinFx";
import { EquipFx, MoveFx } from "@/components/skin-fx/SkinFx";
import { OwlAvatar } from "@/components/OwlAvatar";
import { ShapeMascot, type ShapeMood } from "@/components/ShapeMascot";
import { SHAPE_MOVES, type ShapeExpression, type ShapeMove } from "@/components/shape-engine";
import type { TrombiPose } from "@/components/retro-assistant/Trombi";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import { BUNBU_EARFLOP_CLIP, BunbuMascot, type BunbuAction, type BunbuMood } from "@/components/BunbuMascot";
import { ShibaMascot } from "@/components/ShibaMascot";
import { HdOrVector } from "@/components/hd-mascots/HdMascot";
import { hdKeyForActivity, hdManifestFor } from "@/components/hd-mascots/manifest";
import { useHdMascots } from "@/lib/hd-mascots-preference";
import { SHIBA_BARKS, SHIBA_MOVE_TIMING, shibaMoveFor, type ShibaMove } from "@/components/shiba-moves";
import { playShibaBark } from "@/lib/shiba-bark";
import { readFloatingBotPrefs } from "@/lib/floating-bots";
import { GrumpMascot } from "@/components/GrumpMascot";
import { GRUMP_MOVE_TIMING, grumpMoveFor, type GrumpMove } from "@/components/grump-moves";
import { OgreMascot } from "@/components/OgreMascot";
import { OGRE_MENU_CLIPS, ogreDesktopAction, ogreDesktopShot } from "@/components/ogre-moves";
import { FrogMascot } from "@/components/FrogMascot";
import { FROG_TRACKS, frogCueFor, frogHeldFor, frogMoveFor, type FrogDesktopState } from "@/components/frog-moves";
import { CrabMascot } from "@/components/CrabMascot";
import { CRAB_TRACKS, crabHeldFor, crabMoveFor } from "@/components/crab-moves";
import { mascotAsleep } from "./sleep";
import { fxMoveFor, useEquipBurst, useMoveBurst, useReducedMotion, type FxMoveRequest } from "@/components/skin-fx/skin-fx";
import { completeMascotLook, MASCOT_SHAPES, type MascotCharacter, type MascotLook, type MascotShape } from "../../../shared/mascot-look";
import { createFrameSmoother, type MascotActivity, type MascotFrame, type MascotTask } from "./behavior";
import Owl25D, { flatTilt, flatTurn } from "./Owl25D";
import type { FloatingPose } from "./protocol";
import type { MascotFamily } from "./wardrobe";
import { createFrameGate } from "@/lib/frame-gate";

export interface MascotRenderProps {
  color: string;
  /** The owl's skin (bot.mascotSkin). */
  skin: string;
  /** The bot's character and its look, every choice filled in. */
  look: CompleteLook;
  /** The bot's work, when the desktop knows it (a frog sinks in its pond while its bot waits). */
  task?: MascotTask;
  /** The character's box, px. */
  size: number;
  activity: MascotActivity;
  /** A cat stalking out on its prowl (a walk drawn low and slow). */
  prowling?: boolean;
  pose: FloatingPose;
  frame: (now: number) => MascotFrame;
  fps: () => number;
  onHitTest: (test: ((clientX: number, clientY: number) => boolean) | null) => void;
  /** The whole stage around the character's box (a 3D canvas covers it, fit.ts). */
  stage?: { width: number; height: number; left: number; top: number };
}

export interface MascotThumbProps {
  color: string;
  skin: string;
  look: CompleteLook;
  size: number;
}

export type CompleteLook = ReturnType<typeof completeMascotLook>;

export interface MascotCapabilities {
  walk: boolean;
  fly: boolean;
  wings: boolean;
  blink: boolean;
  turn: boolean;
  flip: boolean;
}

export interface MascotDefinition {
  id: MascotCharacter;
  /** Its family in the Appearance gallery (a filter chip and the tile's second line). */
  family: MascotFamily;
  /** A paid edition: the tile shows its price and it sits on the Premium shelf. None is sold yet. */
  premium?: { price: string };
  /** A NEW badge on its tile, for a character just added. */
  isNew?: boolean;
  capabilities: MascotCapabilities;
  /** What the Appearance gallery offers for it: the bot colors, the owl skins. */
  paint: { colors: boolean; skins: boolean };
  /** The moves the Appearance gallery can preview for a character without wings (the owl keeps its wing moves): clips, or the Shapes moves. */
  moves: readonly string[];
  /** A move's own name for this character (Bunbu's ear flop is the ruffle clip). */
  moveLabels?: Partial<Record<string, LocaleKey>>;
  Render: ComponentType<MascotRenderProps>;
  Thumb: ComponentType<MascotThumbProps>;
}

const DEG = 180 / Math.PI;

/**
 * A whole-character 2.5D transform for a frame: a perspective turn (spins,
 * facing the other way), a flip in its plane (backflips), lift, lean, squash
 * and size. For characters drawn in one piece (the shapes, Trombi).
 */
export function motion25dTransform(frame: MascotFrame, size: number): string {
  const facing = flatTurn(frame.face);
  const lift = (frame.y + facing.lift) * size * 0.32;
  const shift = ((frame.x ?? 0) + frame.sway * 0.6) * size * 0.32;
  const squash = frame.squash * facing.sy;
  const tilt = flatTilt((frame.headTilt * 0.5 + frame.lean * 0.4) * DEG);
  // flat drawings never turn in depth: only a tilt, a lift, a squash and the facing swap
  return (
    `translate(${shift.toFixed(2)}px, ${(-lift).toFixed(2)}px) rotate(${tilt.toFixed(2)}deg) ` +
    `scale(${((facing.sx * frame.scale * (frame.puff ?? 1)) / Math.sqrt(squash)).toFixed(4)}, ${(frame.scale * squash).toFixed(4)})`
  );
}

/**
 * Shiba's share of the frames: only which way it faces and a sideways shift.
 * Its rig (shiba-moves.ts) does the rest (hops, leans, the walk), so a hop is
 * never lifted twice.
 */
export function shibaMotionTransform(frame: MascotFrame, size: number): string {
  const facing = flatTurn(frame.face);
  const shift = ((frame.x ?? 0) + frame.sway * 0.6) * size * 0.32;
  return `translate(${shift.toFixed(2)}px, 0px) scale(${facing.sx.toFixed(4)}, 1)`;
}

/** Moves a one-piece character with the mascot's frames, and hit-tests its painted pixels. */
function Motion25D({ size, frame, fps, onHitTest, children, transform = motion25dTransform }: Pick<MascotRenderProps, "size" | "frame" | "fps" | "onHitTest"> & { children: React.ReactNode; transform?: (frame: MascotFrame, size: number) => string }) {
  const box = useRef<HTMLSpanElement>(null);
  const live = useRef({ frame, fps });
  live.current = { frame, fps };
  useEffect(() => {
    let raf = 0;
    // the display's own rate while it moves (120 Hz on ProMotion), slower at rest (mascotFrameRate)
    const gate = createFrameGate();
    const smooth = createFrameSmoother();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (!gate(now, live.current.fps())) return;
      if (box.current) box.current.style.transform = transform(smooth(live.current.frame(now), now), size);
    };
    raf = requestAnimationFrame(tick);
    onHitTest((x, y) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && box.current?.contains(hit) && hit.tagName.toLowerCase() !== "svg" && hit !== box.current);
    });
    return () => {
      cancelAnimationFrame(raf);
      onHitTest(null);
    };
    // the loop reads the latest callbacks through `live`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);
  return (
    <span ref={box} style={{ display: "grid", placeItems: "end center", width: size, height: size, transformOrigin: "50% 62%" }}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ the owl */

/** The owl skin's equip animation and its move effects, over the desktop owl (the rarity set's effects). */
function OwlSkinBursts({ color, skin, activity }: { color: string; skin: string; activity: MascotActivity }) {
  const reduced = useReducedMotion();
  const skinId = owlSkinId(skin);
  const uid = `owlfx-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const equip = useEquipBurst(skinId, !reduced);
  const burst = useMoveBurst(useClipFx(activity), !reduced);
  const hex = (MAUS_COLORS as Record<string, string>)[color] ?? color;
  if (!equip && !burst) return null;
  return (
    <>
      {equip && <EquipFx key={equip} palette={owlFxPalette(skinId, hex)} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={owlFxPalette(skinId, hex)} uid={`${uid}-mv`} />}
    </>
  );
}

function OwlRender({ color, skin, size, frame, fps, onHitTest, activity }: MascotRenderProps) {
  return (
    <span style={{ position: "relative", display: "block", width: size, height: size }}>
      <Owl25D color={color} skin={skin} size={size} frame={frame} fps={fps} onHitTest={onHitTest} />
      <OwlSkinBursts color={color} skin={skin} activity={activity} />
    </span>
  );
}

function OwlThumb({ color, skin, size }: MascotThumbProps) {
  return <OwlAvatar color={color} skin={skin} size={size} animated={false} trackPointer={false} label={null} />;
}

/* ------------------------------------------------------------ the shapes */

/** A shape's face for a clip. */
export function shapeMoodForClip(activity: MascotActivity, pose: FloatingPose): ShapeMood {
  if (activity === "sleep" || activity === "yawn") return "sleeping";
  if (["petted", "love", "celebrate", "dance", "jump", "wave", "spin", "backflip"].includes(activity)) return "happy";
  if (activity === "working" || activity === "flyOut" || activity === "return") return "working";
  if (activity === "think" || activity === "confused" || pose === "think") return "thinking";
  return "idle";
}

/**
 * The skin effect of the clip playing now: a new request each time a move
 * starts (the behavior machine moves the body itself), none between moves.
 */
export function useClipFx(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: MascotActivity; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    const move = fxMoveFor(activity);
    last.current = { activity, request: move ? { clip: move, key: Date.now() } : null };
  }
  return last.current.request;
}

/** The Shapes move a desktop clip plays (the rest keep the body and change the face). */
export function shapeMoveForClip(activity: MascotActivity): ShapeMove | null {
  switch (activity) {
    case "think":
      return "thinking";
    case "wink":
      return "wink";
    case "surprised":
      return "wide";
    case "startled":
      return "exclaim";
    case "celebrate":
      return "swirl";
    default:
      return null;
  }
}

/** The face a desktop clip wears on a shape, over its mood's. */
export function shapeExpressionForClip(activity: MascotActivity): ShapeExpression | undefined {
  switch (activity) {
    case "angry":
      return "angry";
    case "sad":
      return "sad";
    case "shy":
      return "shy";
    case "confused":
      return "confused";
    case "love":
    case "petted":
      return "laughing";
    case "yawn":
    case "sleep":
      return "sleepy";
    default:
      return undefined;
  }
}

/** A new move request each time a clip with a Shapes move starts. */
function useShapeClipMove(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: MascotActivity; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    const move = shapeMoveForClip(activity);
    last.current = { activity, request: move ? { clip: move, key: Date.now() } : null };
  }
  return last.current.request;
}

function ShapeRender({ color, look, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const fx = useClipFx(activity);
  const own = useShapeClipMove(activity);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <ShapeMascot shape={look.shape} skin={look.skins.shape} color={color} size={size * 0.8} mood={shapeMoodForClip(activity, pose)} expression={shapeExpressionForClip(activity)} detail="full" move={own ?? fx} avatarDef={look.avatarDef} label={null} />
    </Motion25D>
  );
}

function ShapeThumb({ color, look, size }: MascotThumbProps) {
  return <ShapeMascot shape={look.shape} skin={look.skins.shape} color={color} size={size} animated={false} avatarDef={look.avatarDef} label={null} />;
}

/* ------------------------------------------------------------- Trombi */

/** Trombi's pose for a clip: he has no wings, so a flight is a send. */
export function trombiPoseFor(activity: MascotActivity, pose: FloatingPose): TrombiPose {
  if (activity === "sleep" || activity === "yawn") return "sleep";
  if (activity === "think" || activity === "working") return "think";
  if (["celebrate", "dance", "jump", "spin", "backflip", "love", "petted"].includes(activity)) return "celebrate";
  if (activity === "sad" || activity === "confused") return "bored";
  if (activity === "hoot" || activity === "wave") return "speak";
  if (activity === "flyOut" || activity === "return" || activity === "fly") return "send";
  if (pose === "speak") return "speak";
  if (pose === "think") return "think";
  return "idle";
}

/** Trombi on the desktop is drawn this much bigger than his box's share (he is thin). */
export const TROMBI_SCALE = 0.72 * 1.15;

function TrombiRender({ size, look, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const move = useClipFx(activity);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <SkinnedTrombi skin={look.skins.trombi} pose={trombiPoseFor(activity, pose)} size={size} width={size * TROMBI_SCALE} detail="full" move={move} label={null} />
    </Motion25D>
  );
}

function TrombiThumb({ size, look }: MascotThumbProps) {
  return <SkinnedTrombi skin={look.skins.trombi} pose="idle" size={size} width={size * 0.8} animated={false} label={null} />;
}

/* -------------------------------------------------------------- Bunbu */

/** Bunbu's face for a clip, and for the call's states: listening (alert) perks the ears, speaking moves the grin. */
export function bunbuMoodFor(activity: MascotActivity, pose: FloatingPose): BunbuMood {
  if (activity === "sleep" || activity === "yawn") return "sleeping";
  // the brain's sleep pose while it rests (never while carried or flying): asleep too
  if (pose === "sleep" && mascotAsleep(activity, pose)) return "sleeping";
  if (["petted", "love", "celebrate", "dance", "jump", "wave", "spin", "backflip", "hop", "hopForward"].includes(activity)) return "happy";
  if (activity === "working" || activity === "flyOut" || activity === "return") return "working";
  if (activity === "think" || activity === "confused" || pose === "think") return "thinking";
  if (activity === "hoot" || pose === "speak") return "speaking";
  if (pose === "alert" || activity === "surprised" || activity === "startled") return "listening";
  return "idle";
}

/** What Bunbu's ears and arms do for a clip: the owl's preening and wing clips are its ear flop. */
export function bunbuActionFor(activity: MascotActivity): BunbuAction | null {
  if (["ruffle", "preen", "wingStretch", "scratch", "shy"].includes(activity)) return "earflop";
  if (activity === "wave" || activity === "hoot") return "wave";
  if (activity === "drag") return "drag";
  if (["fly", "flyOut", "return", "jump", "hop", "hopForward", "land"].includes(activity)) return "hop";
  if (activity === "walk") return "walk";
  return null;
}

function BunbuRender({ color, look, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const move = useClipFx(activity);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <BunbuMascot skin={look.skins.bunbu} color={color} size={size * 0.86} mood={bunbuMoodFor(activity, pose)} action={bunbuActionFor(activity)} detail="full" move={move} label={null} />
    </Motion25D>
  );
}

function BunbuThumb({ color, look, size }: MascotThumbProps) {
  return <BunbuMascot skin={look.skins.bunbu} color={color} size={size} animated={false} label={null} />;
}

/* -------------------------------------------------------------- Shiba */

/**
 * Shiba's moves in the Appearance gallery and the mascot's "Moves" menu: desktop
 * clips its rig plays (the dog's own first, then the shared ones).
 */
export const SHIBA_MENU_MOVES = ["bark", "turnCircles", "wag", "sniff", "tilt", "stretch", "lieDown", "ruffle", "wave", "excited"] as const;
export const SHIBA_MOVE_LABELS: Partial<Record<string, LocaleKey>> = {
  bark: "floatingBots.move.bark",
  turnCircles: "floatingBots.move.turnCircles",
  wag: "floatingBots.move.wag",
  sniff: "floatingBots.move.sniff",
  tilt: "floatingBots.move.headTilt",
  stretch: "floatingBots.move.stretch",
  lieDown: "floatingBots.move.lieDown",
  ruffle: "floatingBots.move.shakeOff",
  excited: "floatingBots.move.excited",
};

/** Each bark rings out loud only when the person turned the bark sound on (Settings > Appearance; off by default). */
function barkIfWanted() {
  if (readFloatingBotPrefs().barkSound) playShibaBark();
}

/**
 * The move a desktop event plays on a character: Shiba barks at a nudge,
 * turns in circles for an achievement, gets excited when a message lands
 * and lies down to sleep when snoozed. The others keep their own life (null).
 */
export function cueClipFor(character: MascotCharacter, cue: "nudge" | "achievement" | "message" | "snooze" | "refusal" | "error"): MascotActivity | null {
  // a cat: a head bonk for a nudge, kneading for an achievement, a pounce on a new message, curled up asleep
  // before a snooze, a hiss at a refusal, ears flat on an error
  if (character === "grump") return GRUMP_CUES[cue];
  // Ogre wiggles its trumpets at a nudge, stomps in a circle for an achievement, chomps a message and naps on
  // its log when snoozed; like Shiba, it keeps its own life on a refusal or an error
  if (character === "ogre") {
    if (cue === "refusal" || cue === "error") return null;
    return cue === "nudge" ? "petted" : cue === "achievement" ? "dance" : cue === "snooze" ? "yawn" : "peck";
  }
  // Frog croaks at a nudge, celebrates an achievement and catches a fly when a message lands
  if (character === "frog") return cue === "nudge" ? "croak" : cue === "achievement" ? "celebrate" : cue === "message" ? "tongue" : null;
  if (character === "crab") return cue === "nudge" ? "wave" : cue === "achievement" ? "hop" : cue === "message" ? "look" : cue === "snooze" ? "sleep" : null;
  if (character !== "shiba") return null;
  if (cue === "refusal" || cue === "error") return null;
  return cue === "nudge" ? "bark" : cue === "achievement" ? "turnCircles" : cue === "snooze" ? "lieDown" : "excited";
}

/** How long a Shiba naps before its snooze hides it, ms. */
export const SNOOZE_NAP_MS = 1600;

/**
 * What Shiba keeps doing for a clip and the brain's pose: walking while the
 * window walks, running while it flies, asleep, dangling while dragged,
 * working, talking while the reply streams, sitting up attentive while its
 * bot waits for an approval (or hit an error), else its idle life.
 */
export function shibaHeldFor(activity: MascotActivity, pose: FloatingPose): ShibaMove | null {
  if (activity === "walk") return "walk";
  if (activity === "fly" || activity === "flyOut" || activity === "return") return "run";
  if (activity === "sleep" || pose === "sleep") return "sleep";
  if (activity === "drag") return "drag";
  if (activity === "working" || pose === "think") return "work";
  if (pose === "speak") return "talk";
  if (pose === "alert") return "listen";
  return null;
}

/** A new move request each time a clip Shiba has a move for starts (shiba-moves.ts SHIBA_CLIP_MOVES). */
function useShibaClipMove(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: MascotActivity; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    last.current = { activity, request: shibaMoveFor(activity) && !SHIBA_MOVE_TIMING[shibaMoveFor(activity)!].loop ? { clip: activity, key: Date.now() } : null };
  }
  return last.current.request;
}

/** The HD art has no rig to ring the bark sound: it rings at the bark's own beats. */
function useHdBark(activity: MascotActivity, hd: boolean): void {
  useEffect(() => {
    if (!hd || activity !== "bark") return;
    const timers = SHIBA_BARKS.map((at) => setTimeout(barkIfWanted, at * 1000));
    return () => timers.forEach(clearTimeout);
  }, [activity, hd]);
}

function ShibaRender({ color, look, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  useHdBark(activity, useHdMascots() && hdManifestFor("shiba") !== null);
  const own = useShibaClipMove(activity);
  const fx = useClipFx(activity);
  const move = own ?? fx;
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest} transform={shibaMotionTransform}>
      <HdOrVector character="shiba" hdKey={hdKeyForActivity(activity, pose)} size={size * 0.9} label={null}>
        <ShibaMascot skin={look.skins.shiba} color={color} size={size * 0.9} mood={bunbuMoodFor(activity, pose)} expression={shapeExpressionForClip(activity)} detail="full" move={move} activity={shibaHeldFor(activity, pose)} rig onBark={barkIfWanted} label={null} />
      </HdOrVector>
    </Motion25D>
  );
}

function ShibaThumb({ color, look, size }: MascotThumbProps) {
  return (
    <HdOrVector character="shiba" hdKey={{ still: "neutral" }} size={size} animated={false} label={null}>
      <ShibaMascot skin={look.skins.shiba} color={color} size={size} animated={false} label={null} />
    </HdOrVector>
  );
}

/* -------------------------------------------------------------- Grump */

/** What a desktop event plays on Grump (cueClipFor). */
export const GRUMP_CUES: Readonly<Record<"nudge" | "achievement" | "message" | "snooze" | "refusal" | "error", MascotActivity>> = {
  nudge: "bonk",
  achievement: "knead",
  message: "pounce",
  snooze: "curl",
  refusal: "hiss",
  error: "earsFlat",
};

/**
 * Grump's moves in the Appearance gallery and the mascot's "Moves" menu: desktop
 * clips its rig plays (the cat's own first, then the shared ones).
 */
export const GRUMP_MENU_MOVES = ["stretch", "groom", "knead", "pounce", "ledge", "hiss", "bonk", "slowBlink", "tailFlick", "yawn", "curl", "wave"] as const;
export const GRUMP_MOVE_LABELS: Partial<Record<string, LocaleKey>> = {
  stretch: "floatingBots.move.stretch",
  groom: "floatingBots.move.groom",
  knead: "floatingBots.move.knead",
  pounce: "floatingBots.move.pounce",
  ledge: "floatingBots.move.ledge",
  hiss: "floatingBots.move.hiss",
  bonk: "floatingBots.move.bonk",
  slowBlink: "floatingBots.move.slowBlink",
  tailFlick: "floatingBots.move.tailFlick",
  curl: "floatingBots.move.curl",
};

/**
 * What Grump keeps doing for a clip and the brain's pose: walking while the
 * window walks (stalking, low and slow, on its prowl), loafing, curled up
 * asleep, dangling (unimpressed) while dragged, working, talking while the
 * reply streams, sitting up attentive while its bot waits or listens, else
 * its idle life.
 */
export function grumpHeldFor(activity: MascotActivity, pose: FloatingPose, prowling = false): GrumpMove | null {
  if (activity === "walk") return prowling ? "stalk" : "walk";
  if (activity === "fly" || activity === "flyOut" || activity === "return") return "walk";
  if (activity === "loaf") return "loaf";
  if (activity === "sleep" || pose === "sleep") return "sleep";
  if (activity === "drag") return "drag";
  if (activity === "working" || pose === "think") return "work";
  if (pose === "speak") return "talk";
  if (pose === "alert") return "listen";
  return null;
}

/** A new move request each time a clip Grump has a one-shot for starts (grump-moves.ts GRUMP_CLIP_MOVES). */
function useGrumpClipMove(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: MascotActivity; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    const move = grumpMoveFor(activity);
    last.current = { activity, request: move && !GRUMP_MOVE_TIMING[move].loop ? { clip: activity, key: Date.now() } : null };
  }
  return last.current.request;
}

function GrumpRender({ color, look, size, activity, pose, prowling, frame, fps, onHitTest }: MascotRenderProps) {
  const own = useGrumpClipMove(activity);
  const fx = useClipFx(activity);
  return (
    // like the Shiba, the rig does the hops and leans: the frames only face it and shift it
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest} transform={shibaMotionTransform}>
      <GrumpMascot skin={look.skins.grump} color={color} size={size * 0.9} mood={bunbuMoodFor(activity, pose)} expression={shapeExpressionForClip(activity)} detail="full" move={own ?? fx} activity={grumpHeldFor(activity, pose, prowling)} rig label={null} />
    </Motion25D>
  );
}

function GrumpThumb({ color, look, size }: MascotThumbProps) {
  return <GrumpMascot skin={look.skins.grump} color={color} size={size} animated={false} label={null} />;
}

/* --------------------------------------------------------------- Ogre */

/** Ogre's one-shot for a change of clip (ogre-moves.ts ogreDesktopShot), as a move request. */
function useOgreShot(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: string; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    const move = ogreDesktopShot(activity, last.current);
    last.current = { activity, request: move ? { clip: move, key: Date.now() } : null };
  }
  return last.current.request;
}

/**
 * Ogre on the desktop: its rig plays the held activity (the heavy walk, the
 * nap, arms crossed...) and the one-shots (a flex for a task done, a roar for
 * one refused, a chomp when a reply arrives, a stomp, a belly laugh); each
 * heavy step and stomp shakes the ground a little (the drawing jolts by a
 * pixel or two). The frames only turn it and shift it sideways, as for
 * Shiba (shibaMotionTransform): the rig does the hops and the leans.
 */
function OgreRender({ color, look, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const fx = useClipFx(activity);
  const shot = useOgreShot(activity);
  const ground = useRef<HTMLSpanElement>(null);
  const jolt = useRef(1);
  const onShake = useCallback(
    (amount: number) => {
      const node = ground.current;
      if (!node) return;
      jolt.current = -jolt.current;
      node.style.transform = amount > 0.02 ? `translate(${(jolt.current * amount * size * 0.006).toFixed(2)}px, ${(amount * size * 0.012).toFixed(2)}px)` : "";
    },
    [size],
  );
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest} transform={shibaMotionTransform}>
      <span ref={ground} style={{ display: "grid", placeItems: "end center" }}>
        <OgreMascot skin={look.skins.ogre} color={color} size={size * 0.9} mood={bunbuMoodFor(activity, pose)} expression={shapeExpressionForClip(activity)} detail="full" move={shot ?? fx} moveBody action={ogreDesktopAction(activity, pose)} onShake={onShake} label={null} />
      </span>
    </Motion25D>
  );
}

function OgreThumb({ color, look, size }: MascotThumbProps) {
  return <OgreMascot skin={look.skins.ogre} color={color} size={size} animated={false} label={null} />;
}

/* --------------------------------------------------------------- Frog */

/** Frog's moves in the Appearance gallery and the mascot's "Moves" menu: its own first, then the shared ones. */
export const FROG_MENU_MOVES = ["hop", "longJump", "tongue", "croak", "smugNod", "blinkOne", "legStretch", "sideEye", "shiver", "wave"] as const;
export const FROG_MOVE_LABELS: Partial<Record<string, LocaleKey>> = {
  hop: "floatingBots.move.hop",
  longJump: "floatingBots.move.longJump",
  tongue: "floatingBots.move.tongue",
  croak: "floatingBots.move.croak",
  smugNod: "floatingBots.move.smugNod",
  blinkOne: "floatingBots.move.blinkOne",
  legStretch: "floatingBots.move.stretch",
  sideEye: "floatingBots.move.sideEye",
  shiver: "floatingBots.move.shiver",
};

/** A new move request each time a clip Frog has a one-shot for starts, or the desktop's state cues one (frog-moves.ts). */
function useFrogMoves(activity: MascotActivity, pose: FloatingPose, task: MascotTask | undefined): FxMoveRequest | null {
  const last = useRef<{ state: FrogDesktopState | null; request: FxMoveRequest | null }>({ state: null, request: null });
  const state: FrogDesktopState = { activity, pose, task };
  const prev = last.current.state;
  if (!prev || prev.activity !== activity || prev.pose !== pose || prev.task !== task) {
    const own = prev?.activity !== activity ? frogMoveFor(activity) : null;
    const clip = own && !FROG_TRACKS[own].loop ? activity : frogCueFor(prev, state);
    last.current = { state, request: clip ? { clip, key: Date.now() } : last.current.request };
  }
  return last.current.request;
}

function FrogRender({ color, look, size, activity, pose, task, frame, fps, onHitTest }: MascotRenderProps) {
  const own = useFrogMoves(activity, pose, task);
  const fx = useClipFx(activity);
  const move = own ?? fx;
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest} transform={shibaMotionTransform}>
      <FrogMascot skin={look.skins.frog} color={color} size={size * 0.9} mood={bunbuMoodFor(activity, pose)} expression={shapeExpressionForClip(activity)} detail="full" move={move} activity={frogHeldFor({ activity, pose, task })} rig label={null} />
    </Motion25D>
  );
}

function FrogThumb({ color, look, size }: MascotThumbProps) {
  return <FrogMascot skin={look.skins.frog} color={color} size={size} animated={false} label={null} />;
}


/* --------------------------------------------------------------- Crab */

export const CRAB_MENU_MOVES = ["wave", "hop", "look", "scuttle", "celebrate"] as const;
export const CRAB_MOVE_LABELS: Partial<Record<string, LocaleKey>> = {
  wave: "floatingBots.move.wave",
  hop: "floatingBots.move.hop",
  look: "floatingBots.move.headTilt",
  scuttle: "floatingBots.move.scuttle",
  celebrate: "floatingBots.move.excited",
};

function useCrabClipMove(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: MascotActivity; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    const move = crabMoveFor(activity);
    last.current = { activity, request: move && !CRAB_TRACKS[move].loop ? { clip: activity, key: Date.now() } : null };
  }
  return last.current.request;
}

/** The desktop crab's share of the mascot box (the pre-0.4.22 crab's footprint). */
export const CRAB_DESKTOP_SCALE = 0.6;

function CrabRender({ color, look, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const own = useCrabClipMove(activity);
  const fx = useClipFx(activity);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest} transform={shibaMotionTransform}>
      {/* the 24x16 still fills its box edge to edge: draw it at the old crab's
          footprint and stand it on the spot's floor, not mid-air */}
      <span data-crab-desktop className="flex items-end justify-center" style={{ width: size, height: size }}>
        <CrabMascot skin={look.skins.crab} color={color} size={Math.round(size * CRAB_DESKTOP_SCALE)} mood={bunbuMoodFor(activity, pose)} expression={shapeExpressionForClip(activity)} detail="full" move={own ?? fx} activity={crabHeldFor(activity, pose)} rig label={null} />
      </span>
    </Motion25D>
  );
}

function CrabThumb({ color, look, size }: MascotThumbProps) {
  return <CrabMascot skin={look.skins.crab} color={color} size={size} animated={false} label={null} />;
}

/* ----------------------------------------------------------- registry */

export const MASCOTS: readonly MascotDefinition[] = [
  { id: "owl", family: "classics", capabilities: { walk: true, fly: true, wings: true, blink: true, turn: true, flip: true }, paint: { colors: true, skins: true }, moves: [], Render: OwlRender, Thumb: OwlThumb },
  { id: "crab", family: "animals", capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true }, paint: { colors: true, skins: true }, moves: CRAB_MENU_MOVES, moveLabels: CRAB_MOVE_LABELS, Render: CrabRender, Thumb: CrabThumb },
  { id: "shape", family: "shapes", capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true }, paint: { colors: true, skins: true }, moves: SHAPE_MOVES, Render: ShapeRender, Thumb: ShapeThumb },
  { id: "trombi", family: "classics", capabilities: { walk: true, fly: false, wings: false, blink: false, turn: true, flip: true }, paint: { colors: false, skins: true }, moves: ["hop", "jump", "dance", "hoot"], Render: TrombiRender, Thumb: TrombiThumb },
  {
    id: "bunbu",
    family: "animals",
    capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true },
    paint: { colors: true, skins: true },
    moves: ["wave", "dance", "jump", "hop", "love", BUNBU_EARFLOP_CLIP],
    moveLabels: { [BUNBU_EARFLOP_CLIP]: "floatingBots.move.earFlop" },
    Render: BunbuRender,
    Thumb: BunbuThumb,
  },
  {
    id: "shiba",
    family: "animals",
    capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true },
    paint: { colors: true, skins: true },
    moves: SHIBA_MENU_MOVES,
    moveLabels: SHIBA_MOVE_LABELS,
    Render: ShibaRender,
    Thumb: ShibaThumb,
  },
  {
    id: "grump",
    family: "animals",
    capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true },
    paint: { colors: true, skins: true },
    moves: GRUMP_MENU_MOVES,
    moveLabels: GRUMP_MOVE_LABELS,
    Render: GrumpRender,
    Thumb: GrumpThumb,
  },
  {
    id: "ogre",
    family: "animals",
    capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true },
    paint: { colors: true, skins: true },
    moves: OGRE_MENU_CLIPS,
    moveLabels: {
      love: "floatingBots.move.ogre.laugh",
      angry: "floatingBots.move.ogre.roar",
      wingStretch: "floatingBots.move.ogre.flex",
      dance: "floatingBots.move.ogre.stomp",
      peck: "floatingBots.move.ogre.chomp",
      petted: "floatingBots.move.ogre.earWiggle",
      think: "floatingBots.move.ogre.scratch",
      stretch: "floatingBots.move.ogre.stretch",
    },
    Render: OgreRender,
    Thumb: OgreThumb,
  },
  {
    id: "frog",
    family: "animals",
    capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true },
    paint: { colors: true, skins: true },
    moves: FROG_MENU_MOVES,
    moveLabels: FROG_MOVE_LABELS,
    Render: FrogRender,
    Thumb: FrogThumb,
  },
];

export function mascotFor(look: Pick<MascotLook, "character"> | undefined): MascotDefinition {
  return MASCOTS.find((entry) => entry.id === look?.character) ?? MASCOTS[0];
}

/** The shapes, in the picker's order. */
export const SHAPE_CHOICES: readonly MascotShape[] = MASCOT_SHAPES;
