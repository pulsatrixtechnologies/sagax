// The bot's mascot as its profile page's hero (Grok Bot, the owner
// 2026-11-09): the stage (hover plays the first move; a click opens the
// mascot picker under it, #5369, or plays the next move where nothing opens),
// bare on the left, no card, the bot's name and label stacked under it,
// aligned left. No strip under the name: no summary line, no In use pill, no
// moves menu, no Play a move (the owner 2026-11-12, #4076). A bot wearing a
// picture shows it on the stage. It was the Appearance editor's preview band
// too (a card with the character's name and Randomize) until the picker
// replaced that editor.
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { agentStateForBot, type MascotLiveBot, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { BotAvatar } from "@/components/Avatar";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotCharacter, MascotLook, ShapeMoodSetting } from "../../../shared/mascot-look";
import { ShapeStageContext } from "@/components/shape-stage";
import type { FxMoveRequest } from "@/components/skin-fx/skin-fx";
import type { OwlMove } from "./moves";
import { useDrawnLeftInset } from "./drawn-inset";
import { MascotTurnReset, turnCursor, useMascotTurn } from "./use-mascot-turn";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
/** The mascot's size in the profile page's hero (Grok Bot's avatar, on the
 * left, the owner 2026-11-09): the reference's avatar reads larger than the
 * owl drawn at 84px, whose art leaves room around it (#4420). */
export const MASCOT_HERO_SIZE = 96;
/** The profile header's avatar (JC 2026-11-19: the bot's real picture, not a
 * line of text tall): the 160px artwork centred in its 168px frame. */
export const MASCOT_PROFILE_SIZE = 160;

export interface MascotLookPreviewProps {
  bot: { name?: string; color: MausColor; mascotSkin?: MascotSkinId | null };
  shown: MascotCharacter;
  shownName: string;
  shownLook: MascotLook;
  owlSkin: MascotSkinId;
  moves: { clip: string; owl?: OwlMove }[];
  owlMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  fxMove: FxMoveRequest | null;
  onPlay: (move: { clip: string; owl?: OwlMove }) => void;
  onPlayNext: () => void;
  /** The page's title block, under the mascot: the bot's name. */
  heading?: ReactNode;
  subheading?: ReactNode;
  /** The profile page's hero: the mascot at 64px in its 70px frame, with a soft drop shadow. */
  profile?: boolean;
  /** A bot wearing a picture: the stage shows it. */
  picture?: Parameters<typeof BotAvatar>[0]["bot"];
  /** The profile hero's mascot opens something (the Appearance modal): a click calls it,
   * the button is named `activateLabel` and shows it as its tooltip, the cursor is a hand. */
  onActivate?: (() => void) | undefined;
  activateLabel?: string | undefined;
  /** The bot's live state and the moves it plays across the app. */
  liveState?: MausState;
  liveMotion?: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  /** The M key on a shape mascot changes its mood (#5384); none where the look is not the person's to change here. */
  onMood?: ((mood: ShapeMoodSetting) => void) | undefined;
}

type StageProps = Pick<MascotLookPreviewProps, "bot" | "shown" | "shownName" | "shownLook" | "owlSkin" | "moves" | "fxMove" | "onPlay" | "onPlayNext" | "picture" | "liveState" | "onActivate" | "activateLabel" | "onMood"> & {
  motion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  size: number;
  profile?: boolean;
  /** The room around the mascot inside its button (a thin 4px on the hero, none on the profile page's). */
  pad?: number;
  /** Clip the mascot to its frame (the profile hero: never spill over the
   * banner or the text under it, the owner 2026-11-09). */
  clip?: boolean;
};

function MascotStage({ bot, shownName, shownLook, owlSkin, moves, fxMove, onPlay, onPlayNext, picture, liveState, onActivate, activateLabel, onMood, motion, size, profile, pad = 4, clip = false }: StageProps) {
  // a shape is turned by hand, as on the engine's site (#5384); a press that barely moved still opens the picker
  const turn = useMascotTurn({ look: shownLook, picture: Boolean(picture), onMood });
  return (
    <span className="relative inline-grid shrink-0" data-mascot-turn={turn.enabled ? (turn.dragging ? "dragging" : "") : undefined}>
    <button
      type="button"
      data-mascot-stage=""
      aria-label={activateLabel ?? t("appearance.preview", { name: shownName })}
      aria-description={turn.enabled ? t("mascotStage.hint") : undefined}
      title={activateLabel}
      data-mascot-activate={onActivate ? "" : undefined}
      onMouseEnter={() => { if (moves[0]) onPlay(moves[0]); }}
      onClick={onActivate ?? onPlayNext}
      {...turn.handlers}
      style={{ width: size + pad, height: size + pad }}
      className={cn("relative grid shrink-0 place-items-center rounded-2xl", onActivate && !turn.enabled && "cursor-pointer", turnCursor(turn), clip && "overflow-hidden", focusRing)}
    >
      <ShapeStageContext.Provider value={turn.stage}>
      <span aria-hidden="true" className={cn("pointer-events-none", profile && "profile-mascot-shadow")}>
        <BotAvatar
          bot={picture ?? { name: bot.name, color: bot.color, mascotSkin: owlSkin, mascotLook: shownLook, avatarCrop: "mascot" }}
          size={size}
          state={liveState ?? "idle"}
          // the bot's own state on its page; at rest where no live state is given
          agentState={liveState !== undefined ? agentStateForBot(bot as MascotLiveBot) : "idle"}
          motion={motion?.kind ?? "none"}
          motionKey={motion?.nonce ?? 0}
          characterMove={fxMove}
          label={t("appearance.preview", { name: shownName })}
        />
      </span>
      </ShapeStageContext.Provider>
    </button>
    <MascotTurnReset turn={turn} className="-right-2 -top-2" />
    </span>
  );
}

export function MascotLookPreview({
  bot,
  shown,
  shownName,
  shownLook,
  owlSkin,
  moves,
  owlMotion,
  fxMove,
  onPlay,
  onPlayNext,
  heading,
  subheading,
  profile,
  picture,
  onActivate,
  activateLabel,
  liveState,
  liveMotion,
  onMood,
}: MascotLookPreviewProps): ReactNode {
  const motion = owlMotion ?? liveMotion ?? null;
  const stage = { bot, shown, shownName, shownLook, owlSkin, moves, fxMove, onPlay, onPlayNext, picture, liveState, onActivate, activateLabel, onMood, motion };
  // The profile hero's frame moves left by the air its art leaves, so the
  // art's left edge lines up with the name's first letter (M-20261119-081).
  const frameRef = useRef<HTMLSpanElement>(null);
  const artInset = useDrawnLeftInset(frameRef, profile ? `${shown}|${owlSkin}|${picture ? "picture" : ""}|${JSON.stringify(shownLook)}` : null);
  // The mascot small and bare on the left of the column, over the banner's
  // lower edge, the name and label stacked under it, aligned left.
  return (
    <section
      data-mascot-detail={shown}
      data-mascot-hero=""
      aria-label={t("appearance.preview", { name: shownName })}
      className={cn("relative flex w-full flex-col items-start text-left", profile ? "gap-2" : "gap-1")}
    >
      {profile ? (
        <span ref={frameRef} data-mascot-frame="" data-mascot-art-inset={String(artInset)} style={artInset ? { marginLeft: -artInset } : undefined} className="grid size-[168px] shrink-0 place-items-center">
          <MascotStage {...stage} size={MASCOT_PROFILE_SIZE} pad={0} profile />
        </span>
      ) : (
        <MascotStage {...stage} size={MASCOT_HERO_SIZE} pad={4} clip />
      )}
      <div data-mascot-heading="" className="flex min-w-0 max-w-full flex-col items-start">
        {heading}
        {subheading}
      </div>
    </section>
  );
}
