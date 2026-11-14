// A Live call, or a listening (#4100), seen from elsewhere in the app: the
// green phone badge on the bot's sidebar row, a pill at the bottom of the
// sidebar while this window's call (or listening) runs in a chat that is not
// on screen, and the same as a chip in the chat header for windows too
// narrow to show the sidebar. The call bar itself (LiveCallBar) and the
// listening card (ListeningCard) live in their own chat. The listening
// variant is the same pill in the recording red, with Stop for its buttons.
import type { ReactNode } from "react";
import { Ear, Mic, MicOff, Phone, PhoneOff, Square } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { hangUpLiveCall, isLiveCallRunning, liveCallChord, setLiveMuted, useLiveMedia, type LiveMediaState } from "@/lib/live-call-media";
import { stopListening, useListening } from "@/lib/listening/listening-session";
import { useStore, type Bot } from "@/state/store";
import type { LiveCallState } from "../../shared/wire";

export type LivePillVariant = "call" | "listening";

/** Pure: whether a bot's row shows the green phone badge — this window is
 * calling it, or the harness reports a call on it (a phone, another window). */
export function liveBadgeFor(botId: string, media: LiveMediaState, server: LiveCallState | null): boolean {
  if (media.botId === botId && isLiveCallRunning(media.phase)) return true;
  return Boolean(server && server.status !== "ended" && server.botId === botId);
}

/** This window's call (or listening), when it runs in a chat that is not on
 * screen. The bot's `threadId` is the thread its chat shows, so another
 * thread of the same bot counts as elsewhere too. */
function useElsewhere(variant: LivePillVariant, currentBotId: string | null) {
  const { state } = useStore();
  const media = useLiveMedia();
  const listening = useListening();
  const live = variant === "listening"
    ? (listening ? { botId: listening.botId, threadId: listening.threadId } : null)
    : (isLiveCallRunning(media.phase) && media.threadId ? { botId: media.botId, threadId: media.threadId } : null);
  const bot: Bot | undefined = live ? state.bots.find((candidate) => candidate.id === live.botId) : undefined;
  const onScreen = Boolean(bot && live && bot.id === currentBotId && bot.threadId === live.threadId);
  return { media, listening, bot: onScreen ? undefined : bot, threadId: live?.threadId ?? null };
}

const TONE: Record<LivePillVariant, { border: string; text: string; dot: string }> = {
  call: { border: "border-success/40", text: "text-success", dot: "bg-success" },
  listening: { border: "border-danger/40", text: "text-danger", dot: "bg-danger" },
};

/** Bottom of the sidebar while this window is on a Live call, or listens,
 * with another chat open. */
export function LiveCallPill({ onOpen, currentBotId, iconOnly = false, variant = "call" }: {
  /** open the call's chat (its bot and thread) */
  onOpen: (botId: string, threadId: string) => void;
  currentBotId: string | null;
  /** the icons-only sidebar: a column of round buttons instead of a line */
  iconOnly?: boolean;
  variant?: LivePillVariant;
}) {
  const { media, listening, bot, threadId } = useElsewhere(variant, currentBotId);
  if (!bot || !threadId) return null;
  const tone = TONE[variant];
  const round = "flex shrink-0 items-center justify-center rounded-full p-1.5";
  let title: string;
  let back: string;
  let label: ReactNode;
  let icon: ReactNode;
  let actions: ReactNode;
  if (variant === "listening") {
    title = t("listening.pill", { name: bot.name });
    back = t("listening.back");
    // the bot's name first, so a long name stays readable in the sidebar:
    // the short label gives way before the name does
    label = (
      <span className="flex min-w-0 items-baseline gap-1">
        <bdi dir="auto" className="min-w-0 truncate font-medium">{bot.name}</bdi>
        <span className="min-w-0 shrink-[100] truncate text-ink-secondary">{t("listening.pill.label")}</span>
      </span>
    );
    icon = <Ear className="size-4" aria-hidden />;
    actions = (
      <button
        type="button"
        data-listening-pill-stop=""
        disabled={listening?.phase === "stopping"}
        aria-label={t("listening.stop")}
        title={t("listening.stop")}
        onClick={() => void stopListening()}
        className={cn(round, "bg-danger text-white hover:brightness-110 disabled:opacity-60")}
      >
        <Square className="size-3 fill-current" aria-hidden />
      </button>
    );
  } else {
    title = t("call.live.pill", { name: bot.name });
    back = t("call.live.back");
    label = <span className="truncate">{title}</span>;
    icon = <Phone className="size-4" />;
    const isMac = isMacPlatform();
    const muteLabel = media.muted ? t("call.live.unmute") : t("call.live.mute");
    const muteChord = liveCallChord("mute", isMac);
    const hangUpChord = liveCallChord("hangUp", isMac);
    actions = (
      <>
        <button
          type="button"
          aria-label={muteLabel}
          aria-pressed={media.muted}
          aria-keyshortcuts={muteChord.aria}
          title={`${muteLabel} (${muteChord.text})`}
          onClick={() => setLiveMuted(!media.muted)}
          className={cn(round, media.muted ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}
        >
          {media.muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
        </button>
        <button
          type="button"
          disabled={media.phase === "ending"}
          aria-label={t("call.live.hangUp")}
          aria-keyshortcuts={hangUpChord.aria}
          title={`${t("call.live.hangUp")} (${hangUpChord.text})`}
          onClick={() => void hangUpLiveCall()}
          className={cn(round, "bg-danger text-white hover:brightness-110 disabled:opacity-60")}
        >
          <PhoneOff className="size-3.5" />
        </button>
      </>
    );
  }
  if (iconOnly) {
    return (
      <div data-live-pill={variant} className={cn("mx-2 mb-2 flex flex-col items-center gap-1 rounded-xl border bg-panel py-1.5", tone.border)}>
        <button
          type="button"
          aria-label={title}
          title={back}
          onClick={() => onOpen(bot.id, threadId)}
          className={cn(round, "relative hover:bg-raised", tone.text)}
        >
          {icon}
          <span className={cn("absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full", tone.dot)} aria-hidden />
        </button>
        {actions}
      </div>
    );
  }
  return (
    <div data-live-pill={variant} className={cn("mx-2 mb-2 flex items-center gap-1 rounded-xl border bg-panel px-2 py-1.5 text-[12.5px] text-ink", tone.border)}>
      <button type="button" onClick={() => onOpen(bot.id, threadId)} title={back} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cn("size-2 shrink-0 animate-pulse rounded-full", tone.dot)} aria-hidden />
        {label}
      </button>
      {actions}
    </div>
  );
}

/** The same, for windows too narrow to show the sidebar: a chip in the chat header. */
export function LiveCallChip({ currentBotId, onOpen, variant = "call" }: {
  currentBotId: string;
  onOpen: (botId: string, threadId: string) => void;
  variant?: LivePillVariant;
}) {
  const { bot, threadId } = useElsewhere(variant, currentBotId);
  if (!bot || !threadId) return null;
  const tone = TONE[variant];
  const listening = variant === "listening";
  return (
    <button
      type="button"
      data-live-chip={variant}
      onClick={() => onOpen(bot.id, threadId)}
      title={listening ? t("listening.pill", { name: bot.name }) : t("call.live.pill", { name: bot.name })}
      className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-ink hover:bg-raised md:hidden", tone.border)}
    >
      <span className={cn("size-2 animate-pulse rounded-full", tone.dot)} aria-hidden />
      {listening ? t("listening.back") : t("call.live.back")}
    </button>
  );
}
