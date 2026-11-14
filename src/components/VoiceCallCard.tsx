// One voice call in the thread: a quiet line, or the spoken lines inside
// a card. The messages stay stored. Thumbs use the message reaction route
// on the first real person line of the call (one choice: up or down).
import { copyText } from "@/lib/copy-text";
import { useEffect, useState } from "react";
import { AudioLines, Check, Copy, MoreHorizontal, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { api, useStore, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { myReactions, reactionSelfIds } from "@/lib/reactions";
import { cn } from "@/lib/cn";
import { MENU_FIT_ROW, MENU_SURFACE, MenuGlyph, menuRow } from "@/components/menu-look";
import { useLiveCall } from "@/lib/voice-mode/live-call-store";
import { useVoiceCallClock } from "@/lib/voice-call-clock";
import {
  formatVoiceCallDuration,
  spokenLines,
  voiceCallDurationMs,
  voiceCallTranscriptText,
  type SpokenLine,
} from "@/lib/voice-call-transcript";

const UP = "👍";
const DOWN = "👎";

function reactionAnchor(messages: readonly Message[]): Message | undefined {
  return messages.find((message) => message.role === "user" && !message.id.startsWith("optimistic-"));
}

/** The viewer's thumb on the call, from the reactions they hold on its
 * first line (src/lib/reactions.ts). */
function storedThumbs(message: Message | undefined, selfIds: readonly string[]): string[] {
  return myReactions(message?.reactions, selfIds).filter((emoji) => emoji === UP || emoji === DOWN);
}

function storedThumb(message: Message | undefined, selfIds: readonly string[]): "up" | "down" | null {
  const last = storedThumbs(message, selfIds).at(-1);
  if (!last) return null;
  return last === UP ? "up" : "down";
}

export function VoiceCallCard({
  threadId,
  botName,
  callId,
  messages,
  forceOpen = false,
}: {
  threadId: string;
  botName: string;
  callId: string;
  messages: Message[];
  forceOpen?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selfIds = reactionSelfIds(state.config);
  const clock = useVoiceCallClock(callId);
  const live = useLiveCall();
  const liveHere = clock?.endedAt === null && live?.botId === clock.botId;
  const [open, setOpen] = useState(forceOpen);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<"up" | "down" | null>(null);
  const [posting, setPosting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  useEffect(() => {
    if (!liveHere) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [liveHere]);

  const you = t("voiceMode.you");
  const title = t("chat.voiceCall.title");
  const duration = formatVoiceCallDuration(voiceCallDurationMs(messages, now, clock));
  const heading = `${title} · ${duration}`;
  const lines = spokenLines(messages);
  const heard = liveHere ? (live?.heard ?? "").trim() : "";
  const caption = liveHere ? (live?.caption ?? "").trim() : "";
  const shown: SpokenLine[] = [...lines];
  if (open && heard && shown.at(-1)?.text !== heard) shown.push({ id: "live-heard", role: "user", text: heard });
  if (open && caption && shown.at(-1)?.text !== caption) shown.push({ id: "live-caption", role: "bot", text: caption });
  const anchor = reactionAnchor(messages);
  const choice = pending ?? storedThumb(anchor, selfIds);

  const copy = () => {
    const text = voiceCallTranscriptText(shown.filter((line) => !line.id.startsWith("live-")), you, botName);
    void copyText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const choose = (next: "up" | "down") => {
    if (!anchor || posting) {
      setPending(choice === next ? null : next);
      return;
    }
    const want = choice === next ? null : next;
    setPending(want);
    setPosting(true);
    void (async () => {
      try {
        let current = anchor;
        const mine = storedThumbs(current, selfIds);
        const drop = mine.filter((emoji) => emoji !== (want === "up" ? UP : want === "down" ? DOWN : ""));
        for (const emoji of want === null ? mine : drop) {
          const body = await api<{ message?: Message }>(`/api/threads/${threadId}/messages/${current.id}/reactions`, {
            method: "POST",
            body: JSON.stringify({ emoji }),
          });
          if (body?.message) {
            current = body.message;
            dispatch({ type: "messagePatched", threadId, message: body.message });
          }
        }
        if (want && !mine.includes(want === "up" ? UP : DOWN)) {
          const body = await api<{ message?: Message }>(`/api/threads/${threadId}/messages/${current.id}/reactions`, {
            method: "POST",
            body: JSON.stringify({ emoji: want === "up" ? UP : DOWN }),
          });
          if (body?.message) dispatch({ type: "messagePatched", threadId, message: body.message });
        }
      } catch {
        setPending(null);
      } finally {
        setPosting(false);
        setPending(null);
      }
    })();
  };

  const thumbs = (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={t("chat.voiceCall.up")}
        aria-pressed={choice === "up"}
        onClick={() => choose("up")}
        className={cn("rounded p-1 text-ink-tertiary hover:bg-raised hover:text-ink", choice === "up" && "text-accent")}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        aria-label={t("chat.voiceCall.down")}
        aria-pressed={choice === "down"}
        onClick={() => choose("down")}
        className={cn("rounded p-1 text-ink-tertiary hover:bg-raised hover:text-ink", choice === "down" && "text-accent")}
      >
        <ThumbsDown size={14} />
      </button>
    </span>
  );

  if (!open) {
    return (
      <div data-voice-call={callId} data-voice-open="false" className="flex items-center gap-2 px-0.5 py-0.5 text-[13px] text-ink-secondary">
        <AudioLines size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="min-w-0 flex-1 truncate text-left text-ink hover:text-ink"
        >
          {heading}
        </button>
        {thumbs}
      </div>
    );
  }

  return (
    <div data-voice-call={callId} data-voice-open="true" className="rounded-xl border border-hairline/40 bg-card px-3 py-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <details className="relative">
          <summary
            aria-label={t("chat.voiceCall.menu")}
            className="flex size-7 cursor-pointer list-none items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink [&::-webkit-details-marker]:hidden"
          >
            <MoreHorizontal size={16} />
          </summary>
          <div role="menu" aria-label={t("chat.voiceCall.menu")} className={cn(MENU_SURFACE, MENU_FIT_ROW, "absolute left-0 top-full z-20 mt-1")}>
            <button type="button" role="menuitem" onClick={copy} className={menuRow()}>
              <MenuGlyph>{copied ? <Check /> : <Copy />}</MenuGlyph>
              <span className="min-w-0 flex-1 truncate">{copied ? t("chat.voiceCall.copied") : t("chat.voiceCall.copy")}</span>
            </button>
          </div>
        </details>
        <div className="truncate text-center text-[13px] text-ink">{heading}</div>
        <span className="flex items-center">
          {thumbs}
          <button
            type="button"
            aria-label={t("chat.voiceCall.collapse")}
            onClick={() => setOpen(false)}
            className="rounded p-1 text-ink-tertiary hover:bg-raised hover:text-ink"
          >
            <X size={14} />
          </button>
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {shown.length === 0 && <p className="text-[12.5px] text-ink-tertiary">{t("chat.voiceCall.empty")}</p>}
        {shown.map((line) => (
          <div key={line.id} data-mid={line.id.startsWith("live-") ? undefined : line.id} className="min-w-0">
            <div className="text-[11px] text-ink-tertiary">{line.role === "user" ? you : (line.name || botName)}</div>
            <div className="chat-text whitespace-pre-wrap text-[13px] leading-5 text-ink">{line.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
