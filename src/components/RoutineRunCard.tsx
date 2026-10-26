import { ArrowRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { routineDateTime, routineRunError } from "@/lib/routine-display";
import { t } from "@/lib/i18n";
import { ChatMarkdown } from "./ChatMarkdown";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Message } from "@/state/store";

const DETAIL_LIMIT = 280;

const COPY = {
  queued: { label: "Queued", tone: "text-ink-secondary" },
  running: { label: "Running", tone: "text-accent" },
  waiting: { label: "Waiting", tone: "text-warning" },
  completed: { label: "Completed", tone: "text-ink-secondary" },
  failed: { label: "Failed", tone: "text-danger" },
  cancelled: { label: "Cancelled", tone: "text-ink-secondary" },
  missed: { label: "Missed", tone: "text-danger" },
  nothing_to_report: { label: "Nothing to report", tone: "text-ink-secondary" },
} satisfies Record<
  RoutineRunCardData["status"],
  { label: string; tone: string }
>;

const GOAL_COPY = {
  completed: COPY.completed,
  "needs-input": { label: "Needs your input", tone: "text-warning" },
  blocked: { label: "Blocked", tone: "text-danger" },
  "limit-reached": { label: "Turn limit reached", tone: "text-warning" },
  paused: { label: "Paused", tone: "text-warning" },
  stopped: { label: "Stopped", tone: "text-ink-secondary" },
  failed: COPY.failed,
} satisfies Record<
  NonNullable<RoutineRunCardData["goalStatus"]>,
  { label: string; tone: string }
>;

function compactDetail(value: string | undefined): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > DETAIL_LIMIT ? `${clean.slice(0, DETAIL_LIMIT - 1).trimEnd()}…` : clean;
}

/** A lifecycle receipt can outlive its isolated execution task. Only offer
 * navigation while the task is still present in the owning bot's task list. */
export function hasRoutineExecutionTask(
  tasks: ReadonlyArray<{ threadId: string }> | undefined,
  executionThreadId: string | undefined,
): executionThreadId is string {
  return Boolean(
    executionThreadId && tasks?.some((task) => task.threadId === executionThreadId),
  );
}

/** One routine run in the conversation it reports to (2026-10-22, JC): the
 * run works in the background, and only a run with something for the person
 * posts this message. It reads as the bot's own message (its report, never
 * the routine's instructions), with a small "Routine: <name> · View run" line
 * under it. A wait or a failure says so in that line. */
export function RoutineRunCard({
  message,
  onOpen,
}: {
  message: Message;
  /** Opens the isolated execution task; absent when it no longer exists. */
  onOpen?: () => void;
}) {
  const run = message.routineRun;
  // Newer computers can send this message kind to an older or partially
  // hydrated client. Keep the concise text fallback visible instead of
  // leaving an unexplained hole in the conversation.
  if (!run) {
    const fallback = compactDetail(message.text);
    return fallback ? (
      <div className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {fallback}
      </div>
    ) : null;
  }

  const copy = run.goalStatus
    ? GOAL_COPY[run.goalStatus]
    : run.status === "queued" && run.deferredAt != null
      ? { label: "Deferred: target busy", tone: "text-warning" }
      : COPY[run.status];
  const reported = run.status === "completed" && (!run.goalStatus || run.goalStatus === "completed");
  // A report is the bot's words, whole; an error stays one short line.
  const report = reported ? run.summary?.trim() : undefined;
  const detail = report ? "" : compactDetail(
    run.status === "failed" || run.status === "missed"
      ? (routineRunError(run.error) ?? run.summary)
      : (run.summary ?? routineRunError(run.error)),
  );
  const review = run.goalStatus === "needs-input";
  const actionLabel = review ? t("routines.post.review") : t("routines.post.openRun");
  const at = run.scheduledFor ?? message.at;

  return (
    <section
      aria-label={`${run.routineName} routine run: ${copy.label}`}
      className="flex w-full max-w-[680px] flex-col items-start"
    >
      {/* the bot's own bubble, as its other messages beside it */}
      {(report || detail) && <div className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {report ? <ChatMarkdown text={report} inert /> : <p className="whitespace-pre-wrap">{detail}</p>}
      </div>}
      <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11.5px] text-ink-secondary", (report || detail) && "mt-1")}>
        <span className="truncate">{t("routines.post.routine", { name: run.routineName })}</span>
        {!reported && <>
          <span aria-hidden="true">·</span>
          <span aria-live="polite" className={cn("inline-flex items-center gap-1 font-medium", copy.tone)}>
            {run.status === "running" && !run.goalStatus && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
            {copy.label}
          </span>
        </>}
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(at).toISOString()}>{routineDateTime(at)}</time>
        {onOpen && run.executionThreadId && <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${actionLabel} for ${run.routineName}`}
            className={cn(
              "inline-flex items-center gap-0.5 rounded font-medium transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              // a team that needs the person keeps its warning chip
              review ? "bg-warning/15 text-warning hover:bg-warning/25 px-1.5" : "text-accent",
            )}
          >
            {actionLabel}
            <ArrowRight aria-hidden="true" size={12} />
          </button>
        </>}
      </div>
    </section>
  );
}
