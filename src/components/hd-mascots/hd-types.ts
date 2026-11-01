import type { MascotCharacter } from "../../../shared/mascot-look";

/** The looping clips a character can ship. */
export const HD_LOOPS = ["idle", "walk", "jump", "turn", "happy", "sad"] as const;
export type HdLoop = (typeof HD_LOOPS)[number];

/** The still poses a character can ship (ten faces, then poses and views). */
export const HD_STILLS = [
  "neutral",
  "happy",
  "laughing",
  "sad",
  "angry",
  "surprised",
  "thinking",
  "sleepy",
  "love",
  "confused",
  "walk",
  "jump",
  "sit",
  "wave",
  "front",
  "lookLeft",
  "lookRight",
] as const;
export type HdStill = (typeof HD_STILLS)[number];

/** What a state shows: a loop (with the still it falls back on), or a still only. */
export type HdKey = { loop: HdLoop } | { still: HdStill };

export interface HdManifest {
  character: MascotCharacter;
  /** The loops, animated WebP with alpha (URLs). */
  loops: Readonly<Record<HdLoop, string>>;
  /** The stills, WebP with alpha (URLs). */
  stills: Readonly<Record<HdStill, string>>;
  /** The still each loop shows under reduced motion, in thumbnails, or when the loop fails to load. */
  loopStill: Readonly<Record<HdLoop, HdStill>>;
  /** Intrinsic size of every asset, px (all square, the character framed the same in each). */
  px: number;
}
