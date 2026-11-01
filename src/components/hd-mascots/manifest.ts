// HD mascots: a character that ships painted art instead of only its
// code-drawn vector look. A character with an entry in HD_MASCOTS draws it
// (HdMascot.tsx) while the person keeps "HD mascots" on
// (src/lib/hd-mascots-preference.ts); every other character, and every
// character with HD off, keeps its vector renderer unchanged.
//
// What a manifest holds: looping clips (animated WebP with alpha, so the
// mascot sits on any surface) and still poses (WebP with alpha). The app's
// states map onto them here, in pure functions the tests read:
//
// - an app state (MausState, the avatars) or a desktop clip and pose
//   (MascotActivity, FloatingPose, the desktop mascot) becomes an HdKey;
// - an HdKey becomes the asset to show (hdAssetFor): its loop while motion is
//   allowed and the box is large enough, else its still (reduced motion,
//   thumbnails, small avatars).
//
// The art is painted, so a skin and the bot's color do not tint it: an HD
// character ignores both while it shows its art (the vector look, with HD
// off, keeps them).
import type { MausState } from "@/lib/mascot";
import type { MascotCharacter } from "../../../shared/mascot-look";
import type { MascotActivity } from "../floating-bots/behavior";
import type { FloatingPose } from "../floating-bots/protocol";
import { SHIBA_HD } from "./shiba-hd";
import { HD_LOOPS, HD_STILLS, type HdKey, type HdLoop, type HdManifest, type HdStill } from "./hd-types";

export { HD_LOOPS, HD_STILLS, type HdKey, type HdLoop, type HdManifest, type HdStill };

/** The characters that ship HD art. Only Shiba for now. */
export const HD_MASCOTS: Readonly<Partial<Record<MascotCharacter, HdManifest>>> = Object.freeze({ shiba: SHIBA_HD });

/** The characters with HD art, in MASCOT_CHARACTERS order. */
export const HD_CHARACTERS: readonly MascotCharacter[] = Object.freeze(Object.keys(HD_MASCOTS) as MascotCharacter[]);

export function hdManifestFor(character: MascotCharacter | string | null | undefined): HdManifest | null {
  if (!character || !Object.hasOwn(HD_MASCOTS, character)) return null;
  return HD_MASCOTS[character as MascotCharacter] ?? null;
}

/**
 * The app's states (MausState) onto the art. Six get a clip (idle, the
 * happy and sad clips, the jump for a celebration); the rest the closest
 * still. The table is the one in the PR and docs.
 */
export const HD_STATE_MAP: Readonly<Record<MausState, HdKey>> = Object.freeze({
  // lifecycle
  sleeping: { still: "sleepy" },
  waking: { still: "sleepy" },
  idle: { loop: "idle" },
  listening: { still: "neutral" },
  thinking: { still: "thinking" },
  searching: { still: "lookRight" },
  working: { still: "thinking" },
  // reactions
  excited: { loop: "happy" },
  surprised: { still: "surprised" },
  suspicious: { still: "sit" },
  angry: { still: "angry" },
  drowsy: { still: "sleepy" },
  happy: { loop: "happy" },
  curious: { still: "thinking" },
  confused: { still: "confused" },
  bored: { still: "sleepy" },
  proud: { still: "front" },
  shy: { still: "love" },
  sad: { loop: "sad" },
  laughing: { still: "laughing" },
  scared: { still: "surprised" },
  playful: { still: "wave" },
  celebrate: { loop: "jump" },
  // agent morphs
  orbit: { still: "thinking" },
  radar: { still: "lookRight" },
  progress: { still: "thinking" },
  // product cycle
  spawning: { loop: "idle" },
  humming: { still: "neutral" },
  loading: { still: "thinking" },
  dictating: { still: "neutral" },
  writing: { still: "thinking" },
  sending: { still: "neutral" },
  receiving: { still: "neutral" },
  uploading: { still: "thinking" },
  notifying: { still: "surprised" },
  alerting: { still: "surprised" },
  dragging: { still: "surprised" },
  bouncing: { loop: "jump" },
  "powering-down": { still: "sleepy" },
} satisfies Record<MausState, HdKey>);

const IDLE: HdKey = { loop: "idle" };

/** An app state's art; an unknown or absent state is the idle loop. */
export function hdKeyForState(state: MausState | string | null | undefined): HdKey {
  if (!state || !Object.hasOwn(HD_STATE_MAP, state)) return IDLE;
  return HD_STATE_MAP[state as MausState];
}

/** Desktop clips with art of their own (the rest fall back on the pose, then idle). */
const ACTIVITY_MAP: Readonly<Partial<Record<MascotActivity, HdKey>>> = Object.freeze({
  idle: IDLE,
  walk: { loop: "walk" },
  fly: { loop: "walk" },
  flyOut: { loop: "walk" },
  return: { loop: "walk" },
  scuttle: { loop: "walk" },
  jump: { loop: "jump" },
  hop: { loop: "jump" },
  hopForward: { loop: "jump" },
  longJump: { loop: "jump" },
  celebrate: { loop: "jump" },
  dance: { loop: "jump" },
  turn: { loop: "turn" },
  spin: { loop: "turn" },
  headSpin: { loop: "turn" },
  turnCircles: { loop: "turn" },
  backflip: { loop: "turn" },
  excited: { loop: "happy" },
  wag: { loop: "happy" },
  petted: { still: "love" },
  love: { still: "love" },
  sad: { loop: "sad" },
  sleep: { still: "sleepy" },
  lieDown: { still: "sleepy" },
  yawn: { still: "sleepy" },
  wake: { still: "sleepy" },
  think: { still: "thinking" },
  working: { still: "thinking" },
  confused: { still: "confused" },
  tilt: { still: "confused" },
  surprised: { still: "surprised" },
  startled: { still: "surprised" },
  drag: { still: "surprised" },
  angry: { still: "angry" },
  hiss: { still: "angry" },
  wave: { still: "wave" },
  bark: { still: "laughing" },
  look: { still: "lookRight" },
  lookBack: { still: "lookLeft" },
  sniff: { still: "lookLeft" },
  sideEye: { still: "lookLeft" },
  shy: { still: "love" },
  sit: { still: "sit" },
});

/** What the desktop pose alone shows when the clip has no art of its own. */
const POSE_MAP: Readonly<Record<FloatingPose, HdKey>> = Object.freeze({
  idle: IDLE,
  think: { still: "thinking" },
  speak: { still: "neutral" },
  celebrate: { loop: "jump" },
  alert: { still: "surprised" },
  sleep: { still: "sleepy" },
});

/**
 * The desktop mascot's art for a clip and the brain's pose: the clip's own
 * when it has one (walking, a jump, a turn...), else the pose's (thinking
 * while its bot works, asleep), else idle. Sleep wins over a clip while the
 * pose is asleep, as on the vector rig.
 */
export function hdKeyForActivity(activity: MascotActivity | string | null | undefined, pose: FloatingPose = "idle"): HdKey {
  if (pose === "sleep") return POSE_MAP.sleep;
  const own = activity && Object.hasOwn(ACTIVITY_MAP, activity) ? ACTIVITY_MAP[activity as MascotActivity] : undefined;
  if (own && !(own === IDLE && pose !== "idle")) return own;
  return POSE_MAP[pose] ?? IDLE;
}

/** Below this box size a loop is not worth decoding: the still shows. */
export const HD_LOOP_MIN_PX = 48;

export interface HdAsset {
  /** What draws: a looping clip or a still. */
  kind: "loop" | "still";
  src: string;
  /** The still behind a loop (shown first, and if the loop fails), or the still itself. */
  still: string;
  /** For tests and data attributes: the loop or still id. */
  id: HdLoop | HdStill;
}

/**
 * The asset for a key: the loop when it may move (animated, no reduced
 * motion, box of HD_LOOP_MIN_PX or more), otherwise its still.
 */
export function hdAssetFor(manifest: HdManifest, key: HdKey, options: { moving: boolean; size: number }): HdAsset {
  if ("still" in key) return { kind: "still", src: manifest.stills[key.still], still: manifest.stills[key.still], id: key.still };
  const stillId = manifest.loopStill[key.loop];
  const still = manifest.stills[stillId];
  if (options.moving && options.size >= HD_LOOP_MIN_PX) return { kind: "loop", src: manifest.loops[key.loop], still, id: key.loop };
  return { kind: "still", src: still, still, id: stillId };
}
