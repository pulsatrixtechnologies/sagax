import { ArrowRight, Loader2, Play } from "lucide-react";

import { cn } from "@/lib/cn";
import { routineAutoPausedText, routineDateTime, routineRunError } from "@/lib/routine-display";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ChatMarkdown } from "./ChatMarkdown";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Message } from "@/state/store";

const DETAIL_LIMIT = 280;

const COPY = {
  queued: { label: "routines.status.queued", tone: "text-ink-secondary" },
  running: { label: "routines.status.running", tone: "text-accent" },
  waiting: { label: "routines.status.waiting", tone: "text-warning" },
  completed: { label: "routines.status.completed", tone: "text-ink-secondary" },
  failed: { label: "routines.status.failed", tone: "text-danger" },
  blocked: { label: "routines.status.blocked", tone: "text-danger" },
  cancelled: { label: "routines.status.cancelled", tone: "text-ink-secondary" },
  missed: { label: "routines.status.missed", tone: "text-danger" },
  nothing_to_report: { label: "routines.status.nothing_to_report", tone: "text-ink-secondary" },
} satisfies Record<
  RoutineRunCardData["status"],
  { label: LocaleKey; tone: string }
>;

const GOAL_COPY = {
  completed: { label: "routines.goal.completed", tone: "text-ink-secondary" },
  "needs-input": { label: "routines.goal.needs-input", tone: "text-warning" },
  blocked: { label: "routines.goal.blocked", tone: "text-danger" },
  "limit-reached": { label: "routines.goal.limit-reached", tone: "text-warning" },
  paused: { label: "routines.goal.paused", tone: "text-warning" },
  stopped: { label: "routines.goal.stopped", tone: "text-ink-secondary" },
  failed: { label: "routines.goal.failed", tone: "text-danger" },
} satisfies Record<
  NonNullable<RoutineRunCardData["goalStatus"]>,
  { label: LocaleKey; tone: string }
>;

const DEFERRED = { label: "routines.status.deferred" as const, tone: "text-warning" };
/** 2026-11-01: completed, but not all of it went right. */
const WITH_PROBLEMS = { label: "routines.status.completedWithProblems" as const, tone: "text-warning" };

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

/** One routine run in the conversation it reports to (2026-10-22): the
 * run works in the background, and only a run with something for the person
 * posts this message. It reads as the bot's own message (its report, never
 * the routine's instructions), with a small "Routine: <name> · View run" line
 * under it. A wait or a failure says so in that line. */
export function RoutineRunCard({
  message,
  onOpen,
  onResume,
}: {
  message: Message;
  /** Opens the run's detail (2026-10-29: never a conversation beside the
   * chat; Continue in the conversation is in the detail). */
  onOpen?: () => void;
  /** 2026-10-26: the failure paused its routine (N in a row): turn it back
   * on in one click, the failure count from zero. Absent: no button. */
  onResume?: () => void;
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

  const withProblems = run.status === "completed" && Boolean(run.problems?.trim());
  const copy = run.goalStatus
    ? GOAL_COPY[run.goalStatus]
    : withProblems
      ? WITH_PROBLEMS
      : run.status === "queued" && run.deferredAt != null
        ? DEFERRED
        : COPY[run.status];
  const statusLabel = t(copy.label);
  const reported = run.status === "completed" && (!run.goalStatus || run.goalStatus === "completed");
  // A report is the bot's words, whole; an error stays one short line.
  const report = reported ? run.summary?.trim() : undefined;
  const detail = report ? "" : compactDetail(
    run.status === "failed" || run.status === "missed"
      ? (routineRunError(run.error) ?? run.summary)
      : (run.summary ?? run.attention ?? routineRunError(run.error)),
  );
  const review = run.goalStatus === "needs-input";
  const actionLabel = review ? t("routines.post.review") : t("routines.post.openRun");
  const at = run.scheduledFor ?? message.at;
  const pausedAfter = run.autoPausedAfter && run.autoPausedAfter > 0 ? run.autoPausedAfter : null;

  return (
    <section
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className="flex w-full max-w-[680px] flex-col items-start"
    >
      {/* the bot's own bubble, as its other messages beside it */}
      {(report || detail) && <div className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {report ? <ChatMarkdown text={report} inert /> : <p className="whitespace-pre-wrap">{detail}</p>}
      </div>}
      {withProblems && <p data-routine-problems className="mt-1 max-w-[min(42rem,88%)] whitespace-pre-wrap px-1 text-[12px] leading-relaxed text-warning">{run.problems!.trim()}</p>}
      <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11.5px] text-ink-secondary", (report || detail || withProblems) && "mt-1")}>
        <span className="truncate">{t("routines.post.routine", { name: run.routineName })}</span>
        {(!reported || withProblems) && <>
          <span aria-hidden="true">·</span>
          <span aria-live="polite" className={cn("inline-flex items-center gap-1 font-medium", copy.tone)}>
            {run.status === "running" && !run.goalStatus && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
            {statusLabel}
          </span>
        </>}
        {pausedAfter && <>
          <span aria-hidden="true">·</span>
          <span data-routine-auto-paused={pausedAfter} className="font-medium text-warning">{routineAutoPausedText(pausedAfter)}</span>
        </>}
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(at).toISOString()}>{routineDateTime(at)}</time>
        {pausedAfter && onResume && <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            data-routine-resume
            onClick={onResume}
            aria-label={t("routines.autoPause.resumeLabel", { name: run.routineName })}
            className="inline-flex items-center gap-0.5 rounded font-medium text-accent transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Play aria-hidden="true" size={11} />
            {t("routines.autoPause.resume")}
          </button>
        </>}
        {onOpen && <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpen}
            aria-label={t(review ? "routines.post.reviewFor" : "routines.post.openRunFor", { name: run.routineName })}
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