// One stretch of a bot's work, between two visible messages, as a single
// quiet row: "Worked 2m 53s", the duration only, like "Thought 2s" in Grok
// (the tools and failures are spoken by VoiceOver and seen once open). It opens to the steps
// in order, each on a row of the same kind; the same step repeated back to
// back reads once with a count ("Read a file ×3") and opens to each call.
// A settled turn's narration sits among the steps where it was written.
//
// While the bot still works, the row says what it is doing now (the words
// shimmer like "Thinking") and changes in place: the steps never pile up.
// Collapsed by default. A search hit inside opens it, and it stays open
// once the person has opened it.
import type { ReactNode } from "react";
import type { Message } from "@/state/store";
import { describeRun } from "@/lib/activity-runs";
import { mergeSteps, stepGroupWords, summarizeSteps } from "@/lib/step-group";
import { stepDuration, type StepNameOf } from "@/lib/step-label";
import { StepRow } from "./StepRow";

export function ActivityRun({
  messages,
  elapsedMs,
  focusedId,
  nameOf,
  renderStep,
  renderMessage,
  bare = false,
}: {
  messages: Message[];
  /** how long the bot worked, when known */
  elapsedMs?: number;
  /** a search hit: the group, and the merged row holding it, open */
  focusedId?: string | null;
  nameOf?: StepNameOf;
  /** one tool step's own row, as the transcript that owns it draws it */
  renderStep: (message: Message) => ReactNode;
  /** anything else in the group (a turn's narration) */
  renderMessage?: (message: Message) => ReactNode;
  /** tool calls hidden: a settled group draws its narration without the
   * "Worked 2m 53s" line above it */
  bare?: boolean;
}) {
  const summary = summarizeSteps(messages);
  if (bare && !summary.running && summary.tools === 0) {
    return (
      <div className="flex flex-col gap-0.5" data-testid="activity-run-bare">
        {messages.map((message) => <div key={message.id} className="contents">{renderMessage?.(message)}</div>)}
      </div>
    );
  }
  const words = stepGroupWords(summary, elapsedMs, nameOf);
  const narrated = messages.some((message) => message.kind !== "activity");
  const hit = Boolean(focusedId) && messages.some((message) => message.id === focusedId);
  return (
    <div className="flex justify-start" data-testid="activity-run" data-live={summary.running ? "true" : undefined}>
      <StepRow
        label={words.label}
        target={words.target}
        phase={words.phase}
        title={summary.tools ? describeRun(messages) : undefined}
        ariaLabel={words.ariaLabel}
        forceOpen={hit}
        wide={narrated}
        quietChevron
      >
        {() => (
          <div className="flex flex-col gap-0.5 py-0.5">
            {mergeSteps(messages, nameOf).map((entry) => {
              if (entry.kind === "message") return <div key={entry.id} className="contents">{renderMessage?.(entry.message)}</div>;
              if (entry.messages.length === 1) return <div key={entry.id} className="contents">{renderStep(entry.messages[0]!)}</div>;
              return (
                <StepRow
                  key={entry.id}
                  testId="activity-run-repeat"
                  label={`${entry.label} ×${entry.messages.length}`}
                  target={entry.target}
                  phase={entry.phase}
                  duration={stepDuration(entry.durationMs)}
                  forceOpen={Boolean(focusedId) && entry.messages.some((message) => message.id === focusedId)}
                >
                  {() => <div className="flex flex-col gap-0.5 py-0.5">{entry.messages.map((message) => <div key={message.id} className="contents">{renderStep(message)}</div>)}</div>}
                </StepRow>
              );
            })}
          </div>
        )}
      </StepRow>
    </div>
  );
}
