// Listening to a conversation (#4100), in a bot's chat. While it is on, a
// card floats at the top of the transcript: the bot's avatar, a red dot and
// "Listening to Conversation", the newest line under it, a chat control and
// a red stop button at the right; under it the live transcript, each line
// under its speaker's label, the line being spoken in grey until it is
// final. The chat control switches between the live transcript and the
// conversation; the card stays on top in both. The session's one row in the
// conversation draws nothing while it is on (the card says it, once), then
// settles into "Listened 24 min, 3 speakers" with Transcript, which shows
// the whole transcript read-only. The row's plain text stays on the server
// for released apps.
//
// The card is the compact chat card surface (AskCard's), the red the live
// call bar's recording red (bg-danger), the lines the live phone call card's
// line list (TranscriptLines). This window's session comes from
// lib/listening/listening-session.ts; one listening on another device of
// the same person is followed through its row (newest line, Stop).
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare, MessageSquareText, Square } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { readableError } from "@/lib/plain-error";
import { api, type Bot, type Message } from "@/state/store";
import { newestLine, shownLines, withFinal, EMPTY_LISTENING_VIEW, type ListeningShownLine } from "@/lib/listening/line-store";
import { stopListening, useListening } from "@/lib/listening/listening-session";
import type { ListeningCard as ListeningCardData, ListeningLine, ListeningSessionView } from "../../shared/listening";
import { BotAvatar } from "./Avatar";
import { ASK_CARD_SURFACE, ASK_QUIET_BUTTON, AskSettledLine } from "./AskCard";
import { TRANSCRIPT_BOX, TranscriptLine } from "./TranscriptLines";

/** "Listened 24 min, 3 speakers", in the person's language. */
export function listenedLine(card: Pick<ListeningCardData, "startedAt" | "endedAt" | "speakers">): string {
  const minutes = Math.max(1, Math.round(((card.endedAt ?? card.startedAt) - card.startedAt) / 60_000));
  const count = card.speakers.length;
  if (count === 0) return t("listening.listened.none", { minutes });
  return count === 1 ? t("listening.listened.one", { minutes }) : t("listening.listened.other", { minutes, count });
}

/** The live session in this chat: this window's, else the newest row still
 * listening (another device of the same person). */
function useChatListening(bot: Bot, messages: readonly Message[]) {
  const local = useListening();
  const here = local && local.botId === bot.id && local.threadId === bot.threadId ? local : null;
  const remote = useMemo(() => {
    if (here) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const card = messages[i]!.listening;
      if (card) return card.state === "listening" ? card : null;
    }
    return null;
  }, [here, messages]);
  return { here, remote };
}

export function ListeningCard({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const { here, remote } = useChatListening(bot, messages);
  const [showTranscript, setShowTranscript] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const lines: ListeningShownLine[] = useMemo(() => {
    if (here) return shownLines(here.view, (channel) => here.liveSpeaker[channel] ?? t("listening.speaker", { n: 1 }));
    if (remote?.last) return [{ key: "last", speaker: remote.last.speaker, text: remote.last.text, live: false }];
    return [];
  }, [here, remote]);
  // the newest line stays in view as lines arrive
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);
  if (!here && !remote) return null;
  const newest = newestLine(lines);
  // #5377: with a reason on the card and no line yet, the reason is the
  // one thing said; "nobody has spoken yet" would deny what the person did
  const unheard = Boolean(here?.error) && lines.length === 0;
  const stop = async () => {
    setStopping(true);
    setError(null);
    try {
      if (here) await stopListening();
      else if (remote) await api(`/api/listening/${remote.sessionId}/stop`, { method: "POST" });
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setStopping(false);
    }
  };
  const busy = stopping || here?.phase === "stopping";
  const chatLabel = showTranscript ? t("listening.showChat") : t("listening.showTranscript");
  const round = "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60";
  return (
    <div className="relative z-20 mx-auto mb-2 w-full max-w-[720px] px-3" data-listening-card={here ? "here" : "elsewhere"}>
      <div role="region" aria-label={t("listening.title")} className={cn(ASK_CARD_SURFACE, "shadow-sm")}>
        <div className="flex min-w-0 items-center gap-3">
          <BotAvatar bot={bot} size={32} animated={false} forward={false} trackPointer={false} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" aria-hidden data-listening-dot="" />
              {/* the short title fits a 390px phone; the source is the muted word after it, cut first */}
              <span className="shrink-0 text-[13.5px] font-semibold text-ink">{t("listening.titleShort")}</span>
              {here && (
                <span data-listening-sources="" className="min-w-0 truncate text-[11.5px] text-ink-tertiary">
                  {here.sources.computer ? t("listening.source.both") : t("listening.source.microphone")}
                </span>
              )}
            </div>
            <p dir="auto" aria-live="polite" data-listening-newest="" className="truncate text-[12.5px] text-ink-secondary">
              {newest ? (
                <>
                  <span className="font-medium">{newest.speaker}</span> {newest.text}
                </>
              ) : here?.phase === "starting" ? t("listening.starting") : unheard ? null : t("listening.waiting")}
            </p>
          </div>
          {here && (
            <button
              type="button"
              data-listening-chat=""
              aria-pressed={!showTranscript}
              aria-label={chatLabel}
              title={chatLabel}
              onClick={() => setShowTranscript((value) => !value)}
              className={cn(round, "text-ink-secondary hover:bg-ink/[0.07] hover:text-ink")}
            >
              {showTranscript ? <MessageSquare className="size-4" aria-hidden /> : <MessageSquareText className="size-4" aria-hidden />}
            </button>
          )}
          <button
            type="button"
            data-listening-stop=""
            disabled={busy}
            aria-label={t("listening.stop")}
            title={t("listening.stop")}
            onClick={() => void stop()}
            className={cn(round, "bg-danger text-white hover:brightness-110")}
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        </div>
        {(error || here?.error) && <p role="alert" className="mt-1.5 text-[12px] text-danger">{error ?? here?.error}</p>}
        {here?.computerDenied && (
          <p data-listening-computer-denied="" className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-secondary">
            <span>{t("listening.computerDenied")}</span>
            {typeof window !== "undefined" && window.ogb?.permOpenSettings && (
              <button type="button" className={ASK_QUIET_BUTTON} onClick={() => void window.ogb?.permOpenSettings?.("screen")}>
                {t("listening.openSettings")}
              </button>
            )}
          </p>
        )}
        {here && showTranscript && !unheard && (
          <div ref={list} data-listening-transcript="" aria-live="polite" className={cn("mt-2.5 max-h-[min(50vh,420px)]", TRANSCRIPT_BOX)}>
            {lines.length === 0 && <p className="text-[12px] text-ink-tertiary">{t("listening.waiting")}</p>}
            {lines.map((line) => (
              <TranscriptLine key={line.key} speaker={line.speaker} live={line.live} stacked data-listening-line={line.live ? "live" : "final"}>
                {line.text}
              </TranscriptLine>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The session's row in the conversation: nothing while it is live (the
 *  floating card says it), one settled line once it has ended. */
export function ListeningRowLine({ message }: { message: Message }) {
  const card = message.listening!;
  const [open, setOpen] = useState(false);
  if (card.state === "listening") return null;
  const text = listenedLine(card);
  return (
    <div data-listening-row="ended">
      <AskSettledLine
        icon={open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        ariaLabel={text}
        action={card.lineCount > 0 ? (
          <button type="button" data-listening-open-transcript="" aria-expanded={open} className={ASK_QUIET_BUTTON} onClick={() => setOpen((value) => !value)}>
            {t("listening.transcript")}
          </button>
        ) : undefined}
        detail={open ? <ListeningTranscript sessionId={card.sessionId} /> : undefined}
      >
        {text}
      </AskSettledLine>
    </div>
  );
}

/** The whole transcript of an ended session, read-only. */
function ListeningTranscript({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<{ lines: ListeningLine[]; session: ListeningSessionView } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ session: ListeningSessionView; lines: ListeningLine[] }>(`/api/listening/${sessionId}`)
      .then((answer) => {
        if (!live) return;
        // an answer without the transcript (an older server, a proxy page) says so instead of breaking the row
        setState(Array.isArray(answer?.lines) && answer.session ? answer : { error: t("listening.unreadable") });
      })
      .catch((failure) => { if (live) setState({ error: readableError(failure) }); });
    return () => { live = false; };
  }, [sessionId]);
  if (!state) return <p className="mt-1.5 text-[12px] text-ink-tertiary">{t("listening.loading")}</p>;
  if ("error" in state) return <p role="alert" className="mt-1.5 text-[12px] text-danger">{state.error}</p>;
  const view = withFinal(EMPTY_LISTENING_VIEW, state.lines, state.session.speakers);
  return (
    <div data-listening-full-transcript="" className={cn("mt-1.5 max-h-72", TRANSCRIPT_BOX)}>
      {shownLines(view, () => "").map((line) => (
        <TranscriptLine key={line.key} speaker={line.speaker} stacked>{line.text}</TranscriptLine>
      ))}
    </div>
  );
}

/** The red listening dot on the bot's sidebar row while this window listens to it. */
export function ListeningBadge({ botId }: { botId: string }) {
  const live = useListening();
  if (!live || live.botId !== botId) return null;
  return (
    <span data-listening-badge="" role="img" aria-label={t("listening.title")} title={t("listening.title")} className="flex shrink-0 items-center">
      <span className="size-2 animate-pulse rounded-full bg-danger motion-reduce:animate-none" aria-hidden />
    </span>
  );
}
