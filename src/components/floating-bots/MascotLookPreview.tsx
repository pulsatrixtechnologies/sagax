// The Appearance mascot editor's preview band: the stage (hover plays the
// first move, a click the next), the name and Randomize. No strip under the
// name: no summary line, no In use pill, no moves menu, no Play a move (the
// owner 2026-11-12, #4076). On the bot's profile page it is the page's hero
// (Grok Bot, the owner 2026-11-09): the mascot small and bare on the left,
// no card, the bot's name and label stacked under it, aligned left. A bot
// wearing a picture shows it on the stage.
import type { ReactNode } from "react";
import { Lock, Shuffle } from "lucide-react";
import type { LockInfo } from "@/lib/achievements";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MausColor, MausMotion, MausState } from "@/lib/mascot";
import { BotAvatar } from "@/components/Avatar";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotCharacter, MascotLook } from "../../../shared/mascot-look";
import type { FxMoveRequest } from "@/components/skin-fx/skin-fx";
import type { OwlMove } from "./moves";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
/** The mascot's size in the profile page's hero (Grok Bot's avatar size,
 * the owner 2026-11-09: smaller, on the left). */
export const MASCOT_HERO_SIZE = 84;
/** The preview card's Randomize button (and the tab row's, beside Reset). */
export const MASCOT_HERO_BUTTON = cn("inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-weak bg-control/70 px-3.5 py-2 text-[13px] leading-4 text-ink hover:bg-raised-hover disabled:opacity-50", focusRing);

export interface MascotLookPreviewProps {
  bot: { name?: string; color: MausColor; mascotSkin?: MascotSkinId | null };
  shown: MascotCharacter;
  shownName: string;
  shownLook: MascotLook;
  shownLock: LockInfo;
  tint: string;
  owlSkin: MascotSkinId;
  previewSkin: string | null;
  disabled?: boolean;
  moves: { clip: string; owl?: OwlMove }[];
  owlMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  fxMove: FxMoveRequest | null;
  onPlay: (move: { clip: string; owl?: OwlMove }) => void;
  onPlayNext: () => void;
  /** Without it, no Randomize button. */
  onRandomize?: () => void;
  /** The profile page's title block: with it, the preview is the page's
   * bare hero (the mascot, the name and label under it), no card. */
  heading?: ReactNode;
  subheading?: ReactNode;
  /** A bot wearing a picture: the stage shows it. */
  picture?: Parameters<typeof BotAvatar>[0]["bot"];
  /** The bot's live state and the moves it plays across the app. */
  liveState?: MausState;
  liveMotion?: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
}

type StageProps = Pick<MascotLookPreviewProps, "bot" | "shown" | "shownName" | "shownLook" | "shownLock" | "owlSkin" | "previewSkin" | "moves" | "fxMove" | "onPlay" | "onPlayNext" | "picture" | "liveState"> & {
  motion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  size: number;
  /** The room around the mascot inside its button (20px in the editor's
   * card, a thin 4px on the profile page's hero). */
  pad?: number;
  /** Clip the mascot to its frame (the profile hero: never spill over the
   * banner or the text under it, the owner 2026-11-09). */
  clip?: boolean;
};

function MascotStage({ bot, shown, shownName, shownLook, shownLock, owlSkin, previewSkin, moves, fxMove, onPlay, onPlayNext, picture, liveState, motion, size, pad = 20, clip = false }: StageProps) {
  return (
    <button
      type="button"
      data-mascot-stage=""
      aria-label={t("appearance.preview", { name: shownName })}
      onMouseEnter={() => { if (moves[0]) onPlay(moves[0]); }}
      onClick={onPlayNext}
      style={{ width: size + pad, height: size + pad }}
      className={cn("relative grid shrink-0 place-items-center rounded-2xl", clip && "overflow-hidden", focusRing)}
    >
      <span aria-hidden="true" className={cn("pointer-events-none", shownLock.locked && "opacity-60 grayscale")}>
        <BotAvatar
          bot={picture ?? { name: bot.name, color: bot.color, mascotSkin: (previewSkin && shown === "owl" ? previewSkin : owlSkin) as typeof owlSkin, mascotLook: shownLook, avatarCrop: "mascot" }}
          size={size}
          state={liveState ?? "idle"}
          motion={motion?.kind ?? "none"}
          motionKey={motion?.nonce ?? 0}
          characterMove={fxMove}
          label={t("appearance.preview", { name: shownName })}
        />
      </span>
      {previewSkin && (
        <span data-mascot-skin-preview="" className="absolute inset-x-1 bottom-1 truncate rounded-md bg-control/90 px-2 py-1 text-[11px] leading-4 text-ink-secondary">
          {t("mascot.skinPreview")}
        </span>
      )}
      {shownLock.locked && (
        <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-control text-ink-secondary" aria-hidden="true"><Lock size={12} strokeWidth={2.4} /></span>
      )}
    </button>
  );
}

export function MascotLookPreview({
  bot,
  shown,
  shownName,
  shownLook,
  shownLock,
  tint,
  owlSkin,
  previewSkin,
  disabled,
  moves,
  owlMotion,
  fxMove,
  onPlay,
  onPlayNext,
  onRandomize,
  heading,
  subheading,
  picture,
  liveState,
  liveMotion,
}: MascotLookPreviewProps): ReactNode {
  const motion = owlMotion ?? liveMotion ?? null;
  const stage = { bot, shown, shownName, shownLook, shownLock, owlSkin, previewSkin, moves, fxMove, onPlay, onPlayNext, picture, liveState, motion };
  if (heading !== undefined) {
    // The profile page's hero (Grok Bot, the owner 2026-11-09): the mascot small
    // and bare on the left of the column, over the banner's lower edge, the
    // name and label stacked under it, aligned left.
    return (
      <section
        data-mascot-detail={shown}
        data-mascot-hero=""
        aria-label={t("appearance.preview", { name: shownName })}
        className="relative flex w-full flex-col items-start gap-1.5 text-left"
      >
        <MascotStage {...stage} size={MASCOT_HERO_SIZE} pad={4} clip />
        <div data-mascot-heading="" className="flex min-w-0 max-w-full flex-col items-start">
          {heading}
          {subheading}
        </div>
      </section>
    );
  }
  return (
    <section
      data-mascot-detail={shown}
      aria-label={t("appearance.preview", { name: shownName })}
      className="relative flex flex-col items-center gap-4 rounded-2xl border border-hairline-weak p-4 @[34rem]:h-[210px] @[34rem]:flex-row @[34rem]:gap-7 @[34rem]:px-7 @[34rem]:py-5"
      style={{ background: `radial-gradient(120% 140% at 20% 50%, color-mix(in srgb, ${tint} 26%, var(--color-panel)) 0%, var(--color-panel) 58%)` }}
    >
      <MascotStage {...stage} size={150} />

      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center @[34rem]:items-start @[34rem]:text-left">
        <div className="max-w-full truncate text-[24px] font-semibold leading-8 text-ink" data-mascot-name="">{shownName}</div>
      </div>

      {onRandomize && (
        <button
          type="button"
          data-mascot-randomize=""
          disabled={disabled}
          onClick={onRandomize}
          className={cn(MASCOT_HERO_BUTTON, "shrink-0")}
        >
          <Shuffle size={13} aria-hidden="true" />
          {t("appearance.randomize")}
        </button>
      )}
    </section>
  );
}
