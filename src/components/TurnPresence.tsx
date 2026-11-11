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
}) {
  // what this line needs of its thread's stream, not the text itself: a new
  // word, or another bot's stream, does not render it (#3624)
  const streamed = useStreamSelector((stream) => {
    const raw = streamThreadId ? stream.streaming[streamThreadId] : undefined;
    return raw ? (liveReplyText(raw) ? "words" : "text") : "none";
  });
  const streamingText = streamed !== "none";
  const mode = (typing ?? streamingText) ? "typing" : "thinking";
  // the words themselves are on screen (LiveReply): no "Typing…" line under them
  const liveReply = useStreamReplies() && typing === undefined && streamed === "words";
  const [mounted, setMounted] = useState(visible);
  const [presencePhase, setPhase] = useState<"think" | "answer" | "out">(answering ? "answer" : "think");
  const wasAnswering = useRef(answering);

  useEffect(() => {
    if (visible) {
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
  }, [visible, answering, mounted]);

  if (!mounted || liveReply) return null;
  const showWorking = presencePhase !== "answer";
  const list = phrases && phrases.length > 0 ? phrases : label ? [label] : undefined;
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
            phase={phase ?? (list ? `label:${list[0]}` : THINKING_PHASE)}
            seed={seed}
            ultracode={ultracode}
            active={presencePhase === "think"}
          />
          {presencePhase === "think" && since != null && (
            <WorkingTimer since={since} className="text-[11.5px] text-ink-tertiary" />
          )}
          {presencePhase === "think" && mode === "thinking" && quietSince != null && <QuietAge since={quietSince} />}
        </div>
      )}
    </div>
  );
}
