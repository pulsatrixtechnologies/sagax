// Left-edge tail: the bot's activity line while it works (BotActivityIndicator:
// dots and a rotating phrase while it thinks, its mascot and "Typing…" while
// answer text arrives). The moment there is an answer, the line is gone while
// the canonical transcript row performs the settle-in animation above it.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useStreaming } from "@/state/store";
import type { BotAvatarProps } from "@/components/Avatar";
import { BotActivityIndicator, THINKING_PHASE } from "@/components/BotActivityIndicator";

export function TurnPresence({
  bot,
  visible,
  label,
  phrases,
  phase,
  seed = "",
  answering = false,
  ultracode = false,
  streamThreadId = null,
  typing,
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
  /** Ultracode effort: purple activity shimmer while the turn runs. */
  ultracode?: boolean;
  /** the thread whose in-flight answer text (useStreaming) means typing */
  streamThreadId?: string | null;
  /** forces typing on or off (tests, gallery); otherwise read from the stream */
  typing?: boolean;
}) {
  const { streaming } = useStreaming();
  const streamingText = streamThreadId ? Boolean(streaming[streamThreadId]) : false;
  const mode = (typing ?? streamingText) ? "typing" : "thinking";
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

  if (!mounted) return null;
  const showWorking = presencePhase !== "answer";
  const list = phrases && phrases.length > 0 ? phrases : label ? [label] : undefined;
  return (
    <div className={cn("turn-presence flex flex-col items-start", ultracode && visible && "ultracode-active")}>
      {showWorking && (
        <div
          className={cn(
            "flex items-center",
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
        </div>
      )}
    </div>
  );
}
