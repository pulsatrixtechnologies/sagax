import { ArrowRight, Loader2, PauseCircle, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { chatBubbleWidth, useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { cn } from "@/lib/cn";
import { prefersWideBubble } from "@/lib/rich-blocks";
import { routineAutoPausedText, routineDateTime, routineResultText, routineRunBlockedLine, routineRunDuration, routineRunError, routineRunProblems } from "@/lib/routine-display";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ChatMarkdown } from "./ChatMarkdown";
import { AttentionItems } from "./AttentionCard";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Bot, Message } from "@/state/store";

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

const DONE = { label: "routineRun.card.done" as const, tone: "text-success" };

/** The teammates a run handed work to, under the bot's message: one grey
 * line each, "Sent work to <name> · <where it stands>", and, only while
 * threads are shown, a link to the teammate's thread (2026-11-05: in the
 * unified chat the outcome comes back here as a message, so no link). */
function RunHandoffRows({ handedTo, botOf, onOpenThread }: {
  handedTo: ReadonlyArray<{ botId: string; threadId: string; name?: string; status: string }>;
  botOf?: (botId: string) => Bot | undefined;
  onOpenThread?: (botId: string, threadId: string) => void;
}) {
  return (
    <ul data-run-handed-to className="mt-1.5 flex flex-col gap-0.5 pl-0.5 text-[11px] text-ink-secondary">
      {handedTo.map((entry) => {
        const name = entry.name || botOf?.(entry.botId)?.name || t("routineRun.aTeammate");
        const known = (COPY as Record<string, { label: LocaleKey; tone: string }>)[entry.status];
        const state = entry.status === "completed" ? DONE : known;
        return (
          <li key={entry.threadId} data-run-handoff={entry.botId} className="flex flex-wrap items-center gap-x-1.5">
            {entry.status === "running" && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
            <span className="min-w-0 truncate">{t("routineRun.handedTo", { name })}</span>
            {state && <>
              <span aria-hidden="true">·</span>
              <span data-run-handoff-status className={state.tone === "text-success" || state.tone === "text-accent" ? undefined : state.tone}>{t(state.label)}</span>
            </>}
            {onOpenThread && <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                data-run-teammate-thread={entry.threadId}
                onClick={() => onOpenThread(entry.botId, entry.threadId)}
                className="inline-flex items-center gap-0.5 rounded font-medium text-accent transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
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

/** Now, for a running run's elapsed time: a quarter-minute tick is enough
 * for "2 min", and nothing ticks once the run is over. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** One routine run in the conversation it reports to. The run works in the
 * background (2026-10-22) and the server upserts this one message per run,
 * so a running run is one live row patched in place, never a second one.
 * 2026-11-05 (the operator, #2081: "why did you put the routine's report in a routine
 * card", then "I don't need to see the routines, only their result; it
 * must feel natural"): no card, for any state. What the run has to say
 * (its report, else its error or why it waits) is the bot's message, in the
 * bot's own bubble (same markdown, same width rules as any reply). Above it
 * one small grey line, as the label over a delegated reply: Routine · time,
 * the status only when it is not a plain Done (Running with its spinner and
 * elapsed time, Failed, Blocked, Completed with problems...), and Details.
 * Details folds the execution: the routine's name, its status, View run,
 * the teammates it handed work to. A hand-off still in flight is one grey
 * line under the bubble, never a card. A quiet run (nothing to report) is
 * the grey line alone. All states are the same DOM (one section, one bubble
 * node): only classes change, so a Running to Done flip never remounts the
 * report (the flash rule, 2026-11-03). */
export function RoutineRunCard({
  message,
  botOf,
  onOpen,
  onResume,
  onStop,
  onOpenThread,
}: {
  message: Message;
  /** The bot that ran the routine; the row is its message, so it draws no
   * mascot of its own (kept for callers). */
  bot?: Bot;
  /** A teammate a run handed work to, for its name. */
  botOf?: (botId: string) => Bot | undefined;
  /** Opens the run's detail (2026-10-29: never a conversation beside the
   * chat; Continue in the conversation is in the detail). */
  onOpen?: () => void;
  /** 2026-10-26: the failure paused its routine (N in a row): turn it back
   * on in one click, the failure count from zero. Absent: no button. */
  onResume?: () => void;
  /** 2026-11-05 (#2096, the operator): Stop lives on the running card, beside View
   * run, as long as the run is live; the run's sheet has no Stop of its own.
   * Absent: no button. */
  onStop?: () => void;
  /** 2026-11-03: opens the thread a teammate works in (the run handed work
   * to it). Absent (threads hidden, the unified chat): the teammate is
   * named without a link; its outcome reaches this chat as a message. */
  onOpenThread?: (botId: string, threadId: string) => void;
}) {
  const run = useSettledRoutineRun(message.routineRun);
  const running = run?.status === "running" && !run.goalStatus;
  // A live run (queued, running, waiting on someone) keeps its own controls
  // on the line: View run and Stop (#2096).
  const live = Boolean(run && !run.goalStatus && (run.status === "queued" || run.status === "running" || run.status === "waiting"));
  const now = useNow(Boolean(running && run?.startedAt));
  const bubbleWidths = useChatBubbleWidthClasses();
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
  const reported = run.status === "completed" && (!run.goalStatus || run.goalStatus === "completed");
  const copy = run.goalStatus
    ? (run.goalStatus === "completed" ? DONE : GOAL_COPY[run.goalStatus])
    : withProblems
      ? WITH_PROBLEMS
      : run.status === "queued" && run.deferredAt != null
        ? DEFERRED
        : run.status === "completed"
          ? DONE
          : COPY[run.status];
  const statusLabel = t(copy.label);
  // A report is the bot's words, whole; an error stays one short line.
  // 2026-11-03 (owner report: the bubble was a lone "{"): a structured
  // report reads as plain sentences, its whole under "Show details"; a
  // blocked run says why in one line (the run list's own line).
  // 2026-11-03 (JC, the flash): the report reads the same while the run is
  // queued or running again (a retry carries the last report) as once it
  // completed, so a Running/Completed flip never swaps the bubble's content.
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
  const failedTone = run.status === "failed" || run.status === "missed" || run.goalStatus === "failed" || run.goalStatus === "blocked";
  const handedTo = run.handedTo ?? [];
  const review = run.goalStatus === "needs-input";
  const actionLabel = review ? t("routines.post.review") : t("routines.post.openRun");
  const at = run.scheduledFor ?? message.at;
  const pausedAfter = run.autoPausedAfter && run.autoPausedAfter > 0 ? run.autoPausedAfter : null;
  const elapsed = running && run.startedAt ? routineRunDuration({ startedAt: run.startedAt, status: "running" }, now) : undefined;
  // A plain Done says nothing in the line: the message is the result. Any
  // other state names itself there (the status node stays, for the flash
  // rule and for screen readers).
  const plain = reported && !withProblems;
  const quiet = !report && !detail;

  return (
    <section
      data-routine-run-card
      data-routine-run={run.runId}
      data-routine-run-state={run.goalStatus ?? run.status}
      data-routine-run-plain={plain ? "" : undefined}
      data-routine-run-quiet={quiet ? "" : undefined}
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className="relative w-full"
    >
      {/* The provenance line: Routine · time · (status) · (elapsed) · Details.
          Details is a disclosure; its panel holds the execution. */}
      <details data-routine-run-provenance className={cn("group pl-0.5 text-[11px] text-ink-secondary", quiet ? "" : "mb-1")}>
        <summary className="flex cursor-pointer select-none list-none flex-wrap items-center gap-x-1.5 gap-y-1 [&::-webkit-details-marker]:hidden">
          <span>{t("routineRun.openRoutine")}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(at).toISOString()}>{routineDateTime(at)}</time>
          <span aria-hidden="true" className={plain ? "hidden" : undefined}>·</span>
          <span
            data-routine-run-status
            aria-live="polite"
            className={cn("inline-flex items-center gap-1", plain ? "sr-only" : (copy.tone === "text-accent" ? "text-ink-secondary" : copy.tone))}
          >
            {running && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
            {statusLabel}
          </span>
          {elapsed && <>
            <span aria-hidden="true">·</span>
            <span data-routine-run-elapsed className="tabular-nums">{elapsed}</span>
          </>}
          {live && onOpen && <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              data-routine-run-open
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(); }}
              aria-label={t("routines.post.openRunFor", { name: run.routineName })}
              className="inline-flex items-center gap-0.5 rounded font-medium text-accent transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t("routines.post.openRun")}
              <ArrowRight aria-hidden="true" size={11} />
            </button>
          </>}
          {live && onStop && <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              data-run-stop
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onStop(); }}
              aria-label={t("routines.post.stopRunFor", { name: run.routineName })}
              className="inline-flex items-center gap-1 rounded font-medium text-danger transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Square aria-hidden="true" size={10} fill="currentColor" />
              {t("routineRun.stop")}
            </button>
          </>}
          <span aria-hidden="true">·</span>
          <span data-routine-run-details-toggle className="font-medium text-ink-tertiary transition-colors group-hover:text-ink group-open:text-ink">{t("routineRun.details")}</span>
        </summary>
        <div data-routine-run-details className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-inset/60 px-2.5 py-1.5 text-[11.5px]">
          <h3 className="min-w-0 truncate font-medium text-ink">{run.routineName}</h3>
          <span aria-hidden="true">·</span>
          <span className={plain ? undefined : "hidden"}>{statusLabel}</span>
          {!live && onOpen && (
            <button
              type="button"
              onClick={onOpen}
              aria-label={t(review ? "routines.post.reviewFor" : "routines.post.openRunFor", { name: run.routineName })}
              className={cn("inline-flex items-center gap-0.5 rounded font-medium text-accent transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", review && "text-warning")}
            >
              {actionLabel}
              <ArrowRight aria-hidden="true" size={12} />
            </button>
          )}
        </div>
      </details>
      {(report || detail) && (
        <div
          data-routine-run-bubble
          // the bot's own bubble: ChatView's Bubble classes for a bot reply
          className={cn("rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5", detail && failedTone ? "text-danger" : "text-ink", bubbleWidths[chatBubbleWidth({ terminal: false, wide: Boolean(report && prefersWideBubble(report)) })])}
        >
          {report ? <ChatMarkdown text={report} inert /> : <p className="whitespace-pre-wrap">{detail}</p>}
          {details && <RunResultDetails details={details} />}
        </div>
      )}
      {/* 2026-11-05: items only the person can do, each with its ticket. */}
      {reported && message.attention?.items.length ? (
        <div data-routine-run-attention className="mt-2 pl-0.5">
          <div className="mb-1.5 text-[12px] font-semibold text-warning">{t("needsYou.title", { bot: message.attention.botName })}</div>
          <AttentionItems items={message.attention.items} />
        </div>
      ) : null}
      {/* The failure paused its routine: one line and the way back on. */}
      {pausedAfter && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[11.5px]">
          <span data-routine-auto-paused={pausedAfter} className="inline-flex items-center gap-1 font-medium text-warning">
            <PauseCircle aria-hidden="true" size={12} />
            {routineAutoPausedText(pausedAfter)}
          </span>
          {onResume && (
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
          )}
        </div>
      )}
      {handedTo.length > 0 && <RunHandoffRows handedTo={handedTo} botOf={botOf} onOpenThread={onOpenThread} />}
      {/* A running run's live strip along the bottom edge: it moves, it
          takes no room, so the row keeps its height when the run ends. */}
      {running && <div aria-hidden="true" data-routine-run-live className="absolute inset-x-0 bottom-0 h-[2px] animate-shimmer bg-[linear-gradient(90deg,transparent_0%,var(--color-accent)_50%,transparent_100%)] bg-[length:200%_100%]" />}
    </section>
  );
}
