// One stretch of a bot's work, between two visible messages, as a single
// quiet row: "Worked 2m 53s", the duration only, like "Thought 2s" in Grok
// (the tools and failures are spoken by VoiceOver and seen once open). It opens to the steps
// in order, each on a row of the same kind; the same step repeated back to
// back reads once with a count ("Read a file ×3") and opens to each call.
// A turn's notes sit among the steps where they were written (#3581: in a
// person's chat only the answer stays a bubble). With Tool calls hidden the
// row is still drawn and opens to the notes alone.
//
// While the turn still runs, the row says "Working" (the words shimmer like
// "Thinking"); the working line under the transcript names the step. The
// steps never pile up.
// Collapsed by default. A search hit inside opens it, and it stays open
// once the person has opened it.
import type { ReactNode } from "react";
import type { Message } from "@/state/store";
import { describeRun } from "@/lib/activity-runs";
import { mergeSteps, stepGroupWords, summarizeSteps } from "@/lib/step-group";
import { stepDuration, type StepNameOf } from "@/lib/step-label";
import { StepBoundary, stepFallbackText, stepIdOf } from "./MessageBoundary";
import { StepRow } from "./StepRow";

export function ActivityRun({
  messages,
  elapsedMs,
  focusedId,
  nameOf,
  renderStep,
  renderMessage,
  live = false,
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
  /** the turn this row folds still runs: "Working", even between two steps */
  live?: boolean;
}) {
  const summary = summarizeSteps(messages);
  const words = stepGroupWords(summary, elapsedMs, live);
  const narrated = messages.some((message) => message.kind !== "activity");
  const hit = Boolean(focusedId) && messages.some((message) => message.id === focusedId);
  return (
    <div className="flex justify-start" data-testid="activity-run" data-live={words.phase === "running" ? "true" : undefined}>
      <StepRow
        label={words.label}
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
              if (entry.messages.length === 1) {
                const step = entry.messages[0]!;
                return (
                  <div key={entry.id} className="contents">
                    <StepBoundary stepId={stepIdOf(step)} fallbackText={stepFallbackText(step)}>
                      {renderStep(step)}
                    </StepBoundary>
                  </div>
                );
              }
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
                  {() => (
                    <div className="flex flex-col gap-0.5 py-0.5">
                      {entry.messages.map((message) => (
                        <div key={message.id} className="contents">
                          <StepBoundary stepId={stepIdOf(message)} fallbackText={stepFallbackText(message)}>
                            {renderStep(message)}
                          </StepBoundary>
                        </div>
                      ))}
                    </div>
                  )}
                </StepRow>
              );
            })}
          </div>
        )}
      </StepRow>
    </div>
  );
}
