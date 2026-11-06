// The Appearance mascot editor's preview band: stage, name, summary, use /
// unlock action, move chips, Play and Randomize. On the bot's profile page it
// is the page's header (#2313): the bot's name and label take the
// character's name's place (the character's name leads the summary), and the
// page's Appearance button takes Randomize's (Randomize moves into the
// editor). A bot wearing a picture shows it on the stage, without moves.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Lock, Play, Shuffle } from "lucide-react";
import { lockHint, type LockInfo } from "@/lib/achievements";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MausColor, MausMotion, MausState } from "@/lib/mascot";
import { BotAvatar } from "@/components/Avatar";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotCharacter, MascotLook } from "../../../shared/mascot-look";
import type { FxMoveRequest } from "@/components/skin-fx/skin-fx";
import type { OwlMove } from "./moves";

const sectionHeading = "text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
/** The hero card's right-hand buttons (Play a move, Randomize, the profile page's Appearance). */
export const MASCOT_HERO_BUTTON = cn("inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-weak bg-control/70 px-3.5 py-2 text-[13px] leading-4 text-ink hover:bg-raised-hover disabled:opacity-50", focusRing);

export interface MascotLookPreviewProps {
  bot: { name?: string; color: MausColor; mascotSkin?: MascotSkinId | null };
  shown: MascotCharacter;
  shownName: string;
  shownLook: MascotLook;
  shownLock: LockInfo;
  summary: string;
  tint: string;
  owlSkin: MascotSkinId;
  previewSkin: string | null;
  inUse: boolean;
  disabled?: boolean;
  moves: { id: string; label: string; clip: string; owl?: OwlMove }[];
  owlMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  fxMove: FxMoveRequest | null;
  onUse: () => void;
  onPlay: (move: { clip: string; owl?: OwlMove }) => void;
  onPlayNext: () => void;
  /** Without it, no Randomize button (the profile page's hero has Appearance there). */
  onRandomize?: () => void;
  /** The page header's title block, in place of the character's name. */
  heading?: ReactNode;
  subheading?: ReactNode;
  /** The page header's button, in place of Randomize. */
  action?: ReactNode;
  /** A bot wearing a picture: the stage shows it, with no moves and no Use. */
  picture?: Parameters<typeof BotAvatar>[0]["bot"];
  /** The bot's live state and the moves it plays across the app. */
  liveState?: MausState;
  liveMotion?: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
}

export function MascotLookPreview({
  bot,
  shown,
  shownName,
  shownLook,
  shownLock,
  summary,
  tint,
  owlSkin,
  previewSkin,
  inUse,
  disabled,
  moves,
  owlMotion,
  fxMove,
  onUse,
  onPlay,
  onPlayNext,
  onRandomize,
  heading,
  subheading,
  action,
  picture,
  liveState,
  liveMotion,
}: MascotLookPreviewProps): ReactNode {
  const [movesOpen, setMovesOpen] = useState(false);
  const motion = owlMotion ?? liveMotion ?? null;
  const header = heading !== undefined;
  return (
    <section
      data-mascot-detail={shown}
      data-mascot-hero={header ? "" : undefined}
      aria-label={t("appearance.preview", { name: shownName })}
      className="relative flex flex-col items-center gap-4 rounded-2xl border border-hairline-weak p-4 @[34rem]:h-[210px] @[34rem]:flex-row @[34rem]:gap-7 @[34rem]:px-7 @[34rem]:py-5"
      style={{ background: `radial-gradient(120% 140% at 20% 50%, color-mix(in srgb, ${tint} 26%, var(--color-panel)) 0%, var(--color-panel) 58%)` }}
    >
      <button
        type="button"
        data-mascot-stage=""
        aria-label={t("appearance.preview", { name: shownName })}
        onMouseEnter={() => { if (moves[0]) onPlay(moves[0]); }}
        onClick={onPlayNext}
        className={cn("relative grid size-[170px] shrink-0 place-items-center rounded-2xl", focusRing)}
      >
        <span aria-hidden="true" className={cn("pointer-events-none", shownLock.locked && "opacity-60 grayscale")}>
          <BotAvatar
            bot={picture ?? { name: bot.name, color: bot.color, mascotSkin: (previewSkin && shown === "owl" ? previewSkin : owlSkin) as typeof owlSkin, mascotLook: shownLook, avatarCrop: "mascot" }}
            size={150}
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

      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center @[34rem]:items-start @[34rem]:text-left">
        {header ? (
          <div data-mascot-heading="" className="flex min-w-0 max-w-full flex-col items-center @[34rem]:items-start">
            {heading}
            {subheading}
          </div>
        ) : (
          <div className="max-w-full truncate text-[24px] font-semibold leading-8 text-ink" data-mascot-name="">{shownName}</div>
        )}
        <div className="max-w-full truncate text-[13.5px] leading-5 text-ink-secondary" data-mascot-summary="">
          {header && !picture ? [shownName, summary].filter(Boolean).join(" · ") : summary}
        </div>
        {!picture && <div className="relative mt-2.5 flex flex-wrap items-center justify-center gap-2 @[34rem]:justify-start">
          <button
            type="button"
            data-mascot-action={shownLock.locked ? "locked" : inUse ? "in-use" : "use"}
            disabled={disabled || inUse || shownLock.locked}
            onClick={onUse}
            className={cn(
              "inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] leading-4",
              focusRing,
              !inUse && !shownLock.locked ? "bg-accent font-medium text-accent-ink hover:brightness-110" : inUse ? "bg-success/15 text-success" : "bg-control text-ink-secondary",
            )}
          >
            {shownLock.locked ? <Lock size={12} className="shrink-0" aria-hidden="true" /> : inUse ? <Check size={13} strokeWidth={3} className="shrink-0" aria-hidden="true" /> : null}
            <span>{shownLock.locked ? lockHint(shownLock) : inUse ? t("appearance.inUse") : t("appearance.use", { name: shownName })}</span>
          </button>
          <button
            type="button"
            data-mascot-moves=""
            aria-expanded={movesOpen}
            aria-controls="mascot-moves"
            onClick={() => setMovesOpen((open) => !open)}
            className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] leading-4 text-ink-tertiary hover:bg-control hover:text-ink", focusRing)}
          >
            {t("appearance.moveCount", { count: moves.length })}
            <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", movesOpen && "rotate-180")} />
          </button>
          <div
            id="mascot-moves"
            data-mascot-move-list=""
            hidden={!movesOpen}
            className="absolute left-0 top-full z-20 mt-1.5 w-[min(22rem,80vw)] rounded-xl border border-hairline-weak bg-elevated p-2.5 shadow-lg"
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMovesOpen(false); } }}
          >
            <div className={cn(sectionHeading, "mb-1.5")}>{t("mascot.moves.title")}</div>
            <div className="flex flex-wrap gap-1">
              {moves.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-character-move={item.id}
                  aria-label={t("mascot.moves.play", { move: item.label })}
                  onClick={() => onPlay(item)}
                  onMouseEnter={() => onPlay(item)}
                  className={cn("rounded-md bg-control px-2 py-0.5 text-[11.5px] leading-4 text-ink hover:bg-raised-hover", focusRing)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>}
      </div>

      <div className="flex shrink-0 flex-row gap-2 @[34rem]:flex-col">
        {!picture && <button
          type="button"
          data-mascot-play=""
          disabled={!moves.length}
          onClick={onPlayNext}
          className={MASCOT_HERO_BUTTON}
        >
          <Play size={13} aria-hidden="true" />
          {t("appearance.playMove")}
        </button>}
        {onRandomize && (
          <button
            type="button"
            data-mascot-randomize=""
            disabled={disabled}
            onClick={onRandomize}
            className={MASCOT_HERO_BUTTON}
          >
            <Shuffle size={13} aria-hidden="true" />
            {t("appearance.randomize")}
          </button>
        )}
        {action}
      </div>
    </section>
  );
}
