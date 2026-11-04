import { ArrowRight, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { routineAutoPausedText, routineDateTime, routineResultText, routineRunBlockedLine, routineRunError, routineRunProblems } from "@/lib/routine-display";
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
  blocked: { label: "routines.status.blocked", tone: "text-warning" },
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

/** 2026-11-03 (JC, 0.8.35: "when the status flips from Running fast, the
 * app flashes"): a card's status change shows once it has held this long, so
 * a burst of flips (queued, running, completed, running again...) renders
 * once, at its end, never each step. */
export const ROUTINE_STATUS_SETTLE_MS = 300;

/** What changes the card's look: its status line. A report growing under
 * the same status shows at once; a different status waits to settle. */
function statusKey(run: RoutineRunCardData | undefined): string {
  if (!run) return "";
  return [run.status, run.goalStatus ?? "", run.problems ? "p" : "", run.deferredAt != null ? "d" : "", run.autoPausedAfter ?? ""].join("|");
}

/** The run the card draws: the latest one while its status holds, the one
 * shown before while a new status has not held ROUTINE_STATUS_SETTLE_MS. */
export function useSettledRoutineRun(run: RoutineRunCardData | undefined): RoutineRunCardData | undefined {
  const [shown, setShown] = useState(run);
  const latest = useRef(run);
  latest.current = run;
  const pending = statusKey(run) !== statusKey(shown);
  useEffect(() => {
    if (!pending) return;
    // each new flip restarts the wait: the burst's last status wins
    const timer = setTimeout(() => setShown(latest.current), ROUTINE_STATUS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pending, run?.status, run?.goalStatus, run?.problems, run?.deferredAt, run?.autoPausedAfter]);
  // the first status, or the same status with a newer report: at once
  if (!shown || !run || shown.runId !== run.runId) return run;
  return pending ? shown : run;
}

function compactDetail(value: string | undefined): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > DETAIL_LIMIT ? `${clean.slice(0, DETAIL_LIMIT - 1).trimEnd()}…` : clean;
}

/** The whole of a structured result, folded (2026-11-03). */
export function RunResultDetails({ details }: { details: string }) {
  return (
    <details data-run-result-details className="mt-1.5 text-[12px] text-ink-secondary">
      <summary className="cursor-pointer select-none font-medium text-accent hover:text-ink">{t("routineResult.showDetails")}</summary>
      <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink">{details}</pre>
    </details>
  );
}

/** The teammates a run handed work to, each linked to the thread where
 * that work's outcome is (2026-11-03: "Sent work to a teammate"). */
export function TeammateThreadLinks({ handedTo, onOpenThread }: {
  handedTo: ReadonlyArray<{ botId: string; threadId: string; name?: string; status: string }>;
  onOpenThread?: (botId: string, threadId: string) => void;
}) {
  return (
    <ul data-run-handed-to className="mt-1 flex flex-col gap-0.5 px-1 text-[12px] text-ink-secondary">
      {handedTo.map((entry) => {
        const name = entry.name || t("routineRun.aTeammate");
        return (
          <li key={entry.threadId} className="flex flex-wrap items-center gap-x-1.5">
            <span>{t("routineRun.handedTo", { name })}</span>
            {onOpenThread && <>
              <span aria-hidden="true">·</span>
              <button type="button" data-run-teammate-thread={entry.threadId} onClick={() => onOpenThread(entry.botId, entry.threadId)} className="inline-flex items-center gap-0.5 rounded font-medium text-accent transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                {t("routineRun.openTeammateThread", { name })}
                <ArrowRight aria-hidden="true" size={12} />
              </button>
            </>}
          </li>
        );
      })}
    </ul>
  );
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
  onOpenThread,
}: {
  message: Message;
  /** Opens the run's detail (2026-10-29: never a conversation beside the
   * chat; Continue in the conversation is in the detail). */
  onOpen?: () => void;
  /** 2026-10-26: the failure paused its routine (N in a row): turn it back
   * on in one click, the failure count from zero. Absent: no button. */
  onResume?: () => void;
  /** 2026-11-03: opens the thread a teammate works in (the run handed work
   * to it). Absent: the teammate is named without a link. */
  onOpenThread?: (botId: string, threadId: string) => void;
}) {
  const run = useSettledRoutineRun(message.routineRun);
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

  const problems = routineRunProblems(run);
  const withProblems = Boolean(problems);
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
  // 2026-11-03 (owner report: the bubble was a lone "{"): a structured
  // report reads as plain sentences, its whole under "Show details"; a
  // blocked run says why in one line (the run list's own line).
  // 2026-11-03 (JC, the flash): the report reads the same while the run is
  // queued or running again (a retry carries the last report) as once it
  // completed. It used to be cut to one 280-character line until Completed,
  // so each Running/Completed flip swapped the bubble's whole content and
  // its height (111 px to 528 px), and the chat above jumped with it.
  const reportStatus = reported || ((run.status === "queued" || run.status === "running") && !run.goalStatus);
  const readable = reportStatus && run.summary?.trim() ? routineResultText(run.summary) : null;
  const report = readable ? (readable.structured ? readable.text : run.summary!.trim()) : undefined;
  const details = readable?.details;
  const detail = report ? "" : compactDetail(
    run.status === "blocked"
      ? routineRunBlockedLine(run)
      : routineResultText(run.status === "failed" || run.status === "missed"
        ? (routineRunError(run.error) ?? run.summary)
        : (run.summary ?? run.attention ?? routineRunError(run.error))).text,
  );
  const handedTo = run.handedTo ?? [];
  const review = run.goalStatus === "needs-input";
  const actionLabel = review ? t("routines.post.review") : t("routines.post.openRun");
  const at = run.scheduledFor ?? message.at;
  const pausedAfter = run.autoPausedAfter && run.autoPausedAfter > 0 ? run.autoPausedAfter : null;

  return (
    <section
      data-routine-run-card
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className="flex w-full max-w-[680px] flex-col items-start"
    >
      {/* the bot's own bubble, as its other messages beside it */}
      {(report || detail) && <div data-routine-run-bubble className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {report ? <ChatMarkdown text={report} inert /> : <p className="whitespace-pre-wrap">{detail}</p>}
        {details && <RunResultDetails details={details} />}
      </div>}
      {handedTo.length > 0 && <TeammateThreadLinks handedTo={handedTo} onOpenThread={onOpenThread} />}
      {/* 2026-11-03 (JC): the problem details stay in the run detail (View run);
          the chat card only says "Completed with problems". */}
      <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11.5px] text-ink-secondary", (report || detail) && "mt-1")}>
        <span className="truncate">{t("routines.post.routine", { name: run.routineName })}</span>
        {/* Always mounted (the flash, 2026-11-03): a status change swaps
            only this text and its icon, a report hides it without
            removing it. Nothing here animates its size. */}
        <span data-routine-run-status className={cn("inline-flex items-center gap-x-1.5", reported && !withProblems && "hidden")}>
          <span aria-hidden="true">·</span>
          <span aria-live="polite" className={cn("inline-flex items-center gap-1 font-medium", copy.tone)}>
            {run.status === "running" && !run.goalStatus && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
            {reported && !withProblems ? "" : statusLabel}
          </span>
        </span>
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