// The moves a character can play on request: the bot page's hero mascot
// (MascotHero.tsx) and the desktop mascot's "Moves" menu play the same
// list, with the same names.
import type { LocaleKey } from "@/locales";
import type { ShapeMove } from "@/components/shape-engine";
import { MAUS_WING_MOTIONS } from "@/lib/mascot";
import type { MascotLook } from "../../../shared/mascot-look";
import type { MascotActivity } from "./behavior";
import { CLIP_MS } from "./clips";
import { mascotFor } from "./mascots";

export type OwlMove = (typeof MAUS_WING_MOTIONS)[number];

export const OWL_MOVE_LABEL = {
  "spread-wings": "mascot.motion.spreadWings",
  flap: "mascot.motion.flap",
  "take-off": "mascot.motion.takeOff",
  shake: "mascot.motion.shake",
  hoot: "mascot.motion.hoot",
} satisfies Record<OwlMove, LocaleKey>;

/** The clip each of the owl's wing moves plays (and the skin effect the popover's preview shows with it). */
export const OWL_MOVE_FX: Record<OwlMove, MascotActivity> = {
  "spread-wings": "wave",
  flap: "hop",
  "take-off": "jump",
  shake: "dance",
  hoot: "hoot",
};

/** The fourteen Shapes moves' names. */
export const SHAPE_MOVE_LABEL = {
  thinking: "mascot.shapeMove.thinking",
  wink: "mascot.shapeMove.wink",
  wide: "mascot.shapeMove.wide",
  alert: "mascot.shapeMove.alert",
  notify: "mascot.shapeMove.notify",
  exclaim: "mascot.shapeMove.exclaim",
  sleep: "mascot.shapeMove.sleep",
  egg: "mascot.shapeMove.egg",
  hexagon: "mascot.shapeMove.hexagon",
  play: "mascot.shapeMove.play",
  orbit: "mascot.shapeMove.orbit",
  swirl: "mascot.shapeMove.swirl",
  burst: "mascot.shapeMove.burst",
  comet: "mascot.shapeMove.comet",
} satisfies Record<ShapeMove, LocaleKey>;

export const MOVE_LABEL: Partial<Record<string, LocaleKey>> = {
  ...SHAPE_MOVE_LABEL,
  wave: "floatingBots.move.wave",
  dance: "floatingBots.move.dance",
  jump: "floatingBots.move.jump",
  hop: "floatingBots.move.hop",
  love: "floatingBots.move.love",
  hoot: "floatingBots.move.hoot",
};

export interface CharacterMove {
  id: string;
  /** The behavior clip that plays it, or a Shapes move. */
  clip: string;
  label: LocaleKey;
  /** The owl's wing move, for the popover's own preview. */
  owl?: OwlMove;
}

/** A character's moves, in the popover's order: the owl's wing moves, or the registry's list. */
export function characterMoves(look: MascotLook | undefined): CharacterMove[] {
  if (!look || look.character === "owl") return MAUS_WING_MOTIONS.map((owl) => ({ id: owl, clip: OWL_MOVE_FX[owl], label: OWL_MOVE_LABEL[owl], owl }));
  const entry = mascotFor(look);
  return entry.moves.map((clip) => ({ id: clip, clip, label: entry.moveLabels?.[clip] ?? MOVE_LABEL[clip] ?? "floatingBots.move.hop" }));
}

/** Whether a clip may be asked for by name (a timed clip, so it ends by itself). */
export const isMoveClip = (clip: string): clip is MascotActivity => Object.hasOwn(CLIP_MS, clip);
