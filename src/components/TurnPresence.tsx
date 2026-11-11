// Left-edge tail: the bot's activity line while it works (BotActivityIndicator:
// dots and a rotating phrase while it thinks, its mascot and "Typing…" while
// answer text arrives). The moment there is an answer, the line is gone while
// the canonical transcript row performs the settle-in animation above it.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useStreamSelector } from "@/state/store-selector";
import { useStreamReplies } from "@/lib/stream-replies-preference";
import { liveReplyText } from "@/components/LiveReply";
import type { BotAvatarProps } from "@/components/Avatar";
import { BotActivityIndicator, THINKING_PHASE } from "@/components/BotActivityIndicator";
import { WorkingTimer } from "@/components/WorkingIndicator";
import { quietAgeLabel } from "@/lib/working-step";
import { LIVE_NOTE_PHASE, liveTextPlace, lineWords } from "@/lib/live-text-place";

// what the line needs of its thread's stream: nothing, text not shown yet,
// words that opened a bubble (LiveReply), or the short words it draws itself
const NO_STREAM = Symbol("none");
const STREAM_TEXT = Symbol("text");
const STREAM_BUBBLE = Symbol("bubble");

/** 2026-10-29: "last output 2 min ago" once a named step runs a while. */
function QuietAge({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [since]);
  const label = quietAgeLabel(since, now);
  if (!label) return null;
  return <span data-testid="turn-quiet-age" className="text-[11.5px] text-ink-tertiary">· {label}</span>;
}

export function TurnPresence({
  bot,
  visible,
  label,
  phrases,
  phase,
  seed = "",
  answering = false,
  since = null,
  ultracode = false,
  streamThreadId = null,
  typing,
  quietSince = null,
  onCall = false,
}: {
  bot: BotAvatarProps["bot"];
  visible: boolean;
  /** a single plain label (a tool step); `phrases` wins over it */
  label?: string;
  /** the current step's phrases, plain label first */
  phrases?: readonly string[];
  /** stable key for the current step. A new step starts over at its first phrase. */
  phase?: string;
  /** turn identity, so one turn always reads the same and two turns differ */
  seed?: string;
  answering?: boolean;
  /** Turn start (epoch ms). The elapsed readout counts from this while thinking. */
  since?: number | null;
  /** Ultracode effort: purple activity shimmer while the turn runs. */
  ultracode?: boolean;
  /** the thread whose in-flight answer text (useStreaming) means typing */
  streamThreadId?: string | null;
  /** forces typing on or off (tests, gallery); otherwise read from the stream */
  typing?: boolean;
  /** When the named step started (LiveActivityPhrases.stepSince): the line
   * adds how long nothing has come out once it runs a while. */
  quietSince?: number | null;
  /** on a call the words are spoken, not written (LiveReply hidden) */
  onCall?: boolean;
}) {
  // what this line needs of its thread's stream: the text itself only while
  // the line draws it; another bot's stream, or a new word of a bubble, does
  // not render it (#3624)
  const streamed = useStreamSelector((stream): string | symbol => {
    const raw = streamThreadId ? stream.streaming[streamThreadId] : undefined;
    if (!raw) return NO_STREAM;
    const text = liveReplyText(raw);
    if (!text.trim()) return STREAM_TEXT;
    return liveTextPlace(text) === "line" ? lineWords(text) || STREAM_TEXT : STREAM_BUBBLE;
  });
  const streamingText = streamed !== NO_STREAM;
  const writes = streamed === STREAM_BUBBLE || typeof streamed === "string";
  const replies = useStreamReplies() && typing === undefined;
  // #3696: a short text is written here, in the line's look, from its first
  // word (src/lib/live-text-place.ts); it opens into the bubble past that
  const lineText = replies && !onCall && typeof streamed === "string" ? streamed : "";
  const mode = lineText ? "thinking" : (typing ?? streamingText) ? "typing" : "thinking";
  // the words themselves are on screen (LiveReply): no "Typing…" line under them
  const liveReply = replies && writes && !lineText;
  // the bot's words are written here even after a reply of the same turn
  // that hid the line: the line comes back with them
  const present = visible || lineText !== "";
  const [mounted, setMounted] = useState(present);
  const [presencePhase, setPhase] = useState<"think" | "answer" | "out">(answering ? "answer" : "think");
  const wasAnswering = useRef(answering);

  useEffect(() => {
    if (present) {
      setMounted(true);
      setPhase(answering ? "answer" : "think");
      wasAnswering.current = answering;
      return;
    }
    if (!mounted) return;
    const handoff = wasAnswering.current;
    wasAnswering.current = false;
    if (handoff) {
      setMounted(false);
      return;
    }
    setPhase("out");
    const timer = setTimeout(() => setMounted(false), 280);
    return () => clearTimeout(timer);
  }, [present, answering, mounted]);

  if (!mounted || liveReply) return null;
  const showWorking = presencePhase !== "answer";
  const list = lineText ? [lineText] : phrases && phrases.length > 0 ? phrases : label ? [label] : undefined;
  const linePhase = lineText ? LIVE_NOTE_PHASE : phase;
  return (
    <div className={cn("turn-presence flex flex-col items-start", ultracode && visible && "ultracode-active")}>
      {showWorking && (
        <div
          className={cn(
            "flex items-center gap-2",
            presencePhase === "think" && "turn-mascot-in",
            presencePhase === "out" && "turn-mascot-out",
          )}
        >
          <BotActivityIndicator
            bot={bot}
            mode={mode}
            phrases={list}
            phase={linePhase ?? (list ? `label:${list[0]}` : THINKING_PHASE)}
            wrap={linePhase === LIVE_NOTE_PHASE}
            seed={seed}
            ultracode={ultracode}
            active={presencePhase === "think"}
          />
          {presencePhase === "think" && since != null && (
            <WorkingTimer since={since} className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-tertiary" />
          )}
          {presencePhase === "think" && mode === "thinking" && quietSince != null && <QuietAge since={quietSince} />}
        </div>
      )}
    </div>
  );
}
