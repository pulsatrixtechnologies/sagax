import { Check, ChevronRight, CircleSlash, Play, Repeat, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { routineAutoPausedText, routineDateTime, routineResultText, routineRunBlockedLine, routineRunBrief, routineRunDuration, routineRunError, routineRunProblems } from "@/lib/routine-display";
import { isRoutineResult, routineResultNeedsPerson } from "@/lib/routine-result-stack";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ASK_QUIET_BUTTON, AskCard, AskSettledLine } from "./AskCard";
import { AttentionItems } from "./AttentionCard";
import { DottedSpinner } from "./bot-settings/CodingSessionRow";
import { DelegationLine, DelegationList, type DelegationEntry } from "./DelegationList";
import type { RoutineRunCardData } from "../../shared/routine-run";
import { ROUTINE_PROBLEM_STREAK_TOLD } from "../../shared/routine-repeat";
import { formatTime, type Bot, type Message } from "@/state/store";
import { dayLabel, localDay } from "@/lib/transcript-derivations";

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

/** How long a lasting problem has been there (#3479), or for a repeating
 * routine's summary card how many runs in a row had problems (#3695). */
function routineRepeatText(repeat: NonNullable<RoutineRunCardData["repeat"]>): string {
  const vars = { since: routineDateTime(repeat.since), count: repeat.count };
  return repeat.streak || repeat.anyProblem ? t("routineRun.problemStreak", vars) : t("routineRun.sameProblem", vars);
}

/** #3695: the one summary card of a lasting problem of a routine that
 * repeats more than once a day (the server writes it at the third run). */
function isProblemStreakCard(run: RoutineRunCardData): boolean {
  return Boolean(run.repeat?.streak && run.repeat.count >= ROUTINE_PROBLEM_STREAK_TOLD);
}

function compactDetail(value: string | undefined): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > DETAIL_LIMIT ? `${clean.slice(0, DETAIL_LIMIT - 1).trimEnd()}…` : clean;
}

/** The whole of a structured result, folded (2026-11-03). */
export function RunResultDetails({ details }: { details: string }) {
  return (
    <details data-run-result-details className="mt-1.5 text-[12px] text-ink-secondary">
      <summary className="cursor-pointer select-none font-medium text-accent-text hover:text-ink">{t("routineResult.showDetails")}</summary>
      <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink">{details}</pre>
    </details>
  );
}

/** The teammates a run handed work to, as the sub-agent list (2026-11-06,
 * DelegationList); the click is the one the rows always had. */
export function TeammateThreadLinks({ handedTo, onOpenThread, botOf, modelOf }: {
  handedTo: ReadonlyArray<DelegationEntry>;
  onOpenThread?: (botId: string, threadId: string) => void;
  botOf?: (botId: string) => Bot | undefined;
  modelOf?: (botId: string, threadId: string) => string | undefined;
}) {
  return <DelegationList entries={handedTo} botOf={botOf} modelOf={modelOf} onOpen={onOpenThread} />;
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

/** #3581: the form a run takes in the chat. The card (AskCard): a finished
 * result with something to read, and any result that needs the person. The
 * row (AskSettledLine): a run in progress, queued, waiting, failed,
 * cancelled or with nothing to report, and a card a newer result folded. */
export function routineRunForm(message: Pick<Message, "routineRun" | "attention">, run: RoutineRunCardData, folded: boolean): "card" | "row" {
  // #3695: a repeating routine's one summary card is the one thing its runs
  // say in the chat: a card whatever the third run's status, so its count,
  // since when and what is wrong are read whole.
  if (isProblemStreakCard(run)) return "card";
  if (folded) return "row";
  const shown = { ...message, routineRun: run };
  if (routineResultNeedsPerson(shown)) return "card";
  if (!isRoutineResult(run)) return "row";
  return routineRunBrief(run) || run.recovered || run.handedTo?.length ? "card" : "row";
}

/** One routine run in the conversation it reports to. The run works in the
 * background (2026-10-22) and the server upserts this one message per run,
 * so a running run is one live row patched in place, never a second one.
 *
 * #3581 (the owner, 2026-11-10: "why is it not a card"): a result is the
 * chat's compact card (AskCard): the routine's name, the time, the report's
 * closing line in at most two lines, "Details" opening the run window with
 * the whole report as a normal bot message. The report never unfolds inside
 * the card (the big card refused on 2026-11-05). A result a newer result
 * follows, and every run with nothing to read, is the one quiet row
 * (AskSettledLine). The form follows the settled status only, and each form
 * is one tree whose parts only change classes and text (the flash rule,
 * 2026-11-03). Unified chat: no thread link unless onOpenThread is set. */
export function RoutineRunCard({
  message,
  bot,
  botOf,
  folded = false,
  onOpen,
  onResume,
  onStop,
  onOpenThread,
  modelOf,
}: {
  message: Message;
  /** 2026-11-06: the model a teammate works on, grey in its row. */
  modelOf?: (botId: string, threadId: string) => string | undefined;
  /** The bot that ran the routine (the Asked line names it). */
  bot?: Bot;
  /** A teammate a run handed work to, for its name and mascot. */
  botOf?: (botId: string) => Bot | undefined;
  /** #3581: a newer result follows this one (src/lib/routine-result-stack.ts). */
  folded?: boolean;
  /** Opens the run's window (2026-10-29: never a conversation beside the
   * chat). Absent: no Details. */
  onOpen?: () => void;
  /** 2026-10-26: the failure paused its routine (N in a row): turn it back
   * on in one click, the failure count from zero. Absent: no button. */
  onResume?: () => void;
  /** 2026-11-05 (#2096): Stop lives on the run itself, beside Details, as
   * long as the run is live. Absent: no button. */
  onStop?: () => void;
  /** 2026-11-03: opens the thread a teammate works in (the run handed work
   * to it). Absent (threads hidden, the unified chat): the teammate is
   * named without a link; its outcome reaches this chat as a message. */
  onOpenThread?: (botId: string, threadId: string) => void;
}) {
  const run = useSettledRoutineRun(message.routineRun);
  const running = run?.status === "running" && !run.goalStatus;
  // A live run (queued, running, waiting on someone) keeps Stop beside Details (#2096).
  const live = Boolean(run && !run.goalStatus && (run.status === "queued" || run.status === "running" || run.status === "waiting"));
  const now = useNow(Boolean(running && run?.startedAt));
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

  const withProblems = Boolean(routineRunProblems(run));
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
  const name = run.routineName?.trim() ?? "";
  // 2026-11-06: the run sits where it posted, so its time is when it posted;
  // the trigger's time (a late schedule, a queued webhook) is in the tooltip.
  const at = message.at;
  const triggeredAt = run.scheduledFor && Math.abs(run.scheduledFor - at) >= 60_000 ? run.scheduledFor : undefined;
  // the chat's own stamps: the time alone today, the day before it otherwise
  const posted = localDay(at) === localDay(Date.now()) ? formatTime(at) : `${dayLabel(at)} ${formatTime(at)}`;
  const time = <time key="at" dateTime={new Date(at).toISOString()} title={triggeredAt ? routineDateTime(triggeredAt) : undefined}>{posted}</time>;
  const pausedAfter = run.autoPausedAfter && run.autoPausedAfter > 0 ? run.autoPausedAfter : null;
  const elapsed = running && run.startedAt ? routineRunDuration({ startedAt: run.startedAt, status: "running" }, now) : undefined;
  // #3695: a summary card whose run failed or was blocked carries the
  // streak's own failure texts (card.error): they are its brief.
  const streakFailed = isProblemStreakCard(run) && !run.goalStatus && run.status !== "completed";
  const brief = isRoutineResult(run) || run.goalStatus
    ? routineRunBrief(run)
    : streakFailed
      ? routineResultText(routineRunError(run.error) ?? run.summary).text || (run.status === "blocked" ? routineRunBlockedLine(run) : "")
      : "";
  const form = routineRunForm(message, run, folded);
  const openLabel = t(run.goalStatus === "needs-input" ? "routines.post.reviewFor" : "routines.post.openRunFor", { name: run.routineName });

  const details = onOpen && (
    <button key="open" type="button" data-routine-run-open onClick={onOpen} title={run.routineName} aria-label={openLabel} className={ASK_QUIET_BUTTON}>
      {t("routineRun.details")}
      {form === "card" && <ChevronRight aria-hidden="true" size={14} />}
    </button>
  );
  const stop = live && onStop && (
    <button key="stop" type="button" data-run-stop onClick={onStop} aria-label={t("routines.post.stopRunFor", { name: run.routineName })} className={ASK_QUIET_BUTTON}>
      {t("routineRun.stop")}
    </button>
  );
  const resume = pausedAfter && onResume && (
    <button key="resume" type="button" data-routine-resume onClick={onResume} aria-label={t("routines.autoPause.resumeLabel", { name: run.routineName })} className={ASK_QUIET_BUTTON}>
      <Play aria-hidden="true" size={12} />
      {t("routines.autoPause.resume")}
    </button>
  );
  const handedTo = run.handedTo ?? [];
  const asked = handedTo.length > 0 && <DelegationLine entries={handedTo} owner={bot} botOf={botOf} modelOf={modelOf} onOpen={onOpenThread} />;
  const shell = (body: ReactNode) => (
    <section
      data-routine-run-card
      data-routine-run={run.runId}
      data-routine-run-state={run.goalStatus ?? run.status}
      data-routine-run-form={form}
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className="flex w-full min-w-0 flex-col items-start gap-1"
    >
      {body}
    </section>
  );

  // #3479: a lasting problem is said once; its card counts the runs since.
  // #3695: a repeating routine's one summary card counts its runs with
  // problems, whatever they said, a failure or a block included.
  const repeat = run.repeat && run.repeat.count > 1 && (withProblems || run.repeat.streak) ? (
    <span data-routine-run-repeat title={routineDateTime(run.repeat.lastAt)}>
      {" · "}{routineRepeatText(run.repeat)}
    </span>
  ) : null;

  if (form === "card") {
    const warn = withProblems || streakFailed || run.status === "blocked" || (run.goalStatus && run.goalStatus !== "completed") || Boolean(message.attention?.items.length && !message.attention.handledAt);
    // one state line, only when there is something to say: a finished result
    // without problems has no state word (the reference's active state)
    const state = streakFailed
      // #3695: the failure words are the brief; the state line says how
      // many runs in a row and since when, like a result with problems
      ? <span data-routine-run-status className={copy.tone}>{statusLabel}{repeat}</span>
      : run.status === "blocked" && !run.goalStatus
      ? <span data-routine-run-status className={copy.tone}>{routineRunBlockedLine(run)}</span>
      : withProblems || (run.goalStatus && run.goalStatus !== "completed")
        ? (
          <span data-routine-run-status className={copy.tone}>
            {statusLabel}
            {/* #3479: a lasting problem is said once; its card counts the runs since */}
            {withProblems && repeat}
          </span>
        )
        : run.recovered
          // #3479: the first success after it says once that it works again
          ? <span data-routine-run-recovered className="text-success">{t("routineRun.worksAgain", { since: routineDateTime(run.recovered.since) })}</span>
          : null;
    const items = message.attention?.items.length ? (
      <div data-routine-run-attention className="w-full">
        <div className="mb-1.5 text-[12px] font-medium text-ink-secondary">{t("needsYou.title", { bot: message.attention.botName })}</div>
        <AttentionItems items={message.attention.items} />
      </div>
    ) : null;
    const footer = details || stop || resume ? <>{resume}{stop}{details}</> : undefined;
    return shell(
      <AskCard
        result
        icon={live
          ? <DottedSpinner size={16} />
          : warn
            ? <TriangleAlert size={16} className="text-warning" />
            : <Repeat size={16} />}
        title={<span data-routine-run-name title={name}>{name}</span>}
        meta={time}
        explanation={brief ? <p data-routine-run-brief dir="auto" title={brief} className="line-clamp-2">{brief}</p> : undefined}
        ariaLabel={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
        footer={footer}
      >
        {state || items || asked ? (
          <div className="flex flex-col gap-2">
            {state && <div className="text-[12px] leading-snug">{state}</div>}
            {items}
            {asked}
          </div>
        ) : undefined}
      </AskCard>,
    );
  }

  // The row: what the run is doing, or what it said, in one quiet line.
  const said = (() => {
    if (running || (live && run.status !== "queued" && run.status !== "waiting")) return t("routines.status.running");
    if (run.status === "blocked" && !run.goalStatus) return routineRunBlockedLine(run);
    if (run.status === "failed" || run.status === "missed") {
      const why = compactDetail(routineResultText(routineRunError(run.error) ?? run.summary).text);
      return why ? t("routineRun.stateLine", { status: statusLabel, reason: why }) : statusLabel;
    }
    if (run.status === "queued" || run.status === "waiting") {
      const why = compactDetail(routineResultText(run.attention ?? run.summary ?? routineRunError(run.error)).text);
      return why ? t("routineRun.stateLine", { status: statusLabel, reason: why }) : statusLabel;
    }
    if (withProblems) return brief ? t("routineRun.stateLine", { status: statusLabel, reason: brief }) : statusLabel;
    if (run.recovered && !brief) return t("routineRun.worksAgain", { since: routineDateTime(run.recovered.since) });
    return brief || statusLabel;
  })();
  const parts: ReactNode[] = [
    name && <span key="name" data-routine-run-name className="font-medium text-ink-secondary">{name}</span>,
    <span key="said" data-routine-run-status className={cn(running && "thinking-shimmer animate-shimmer motion-reduce:animate-none")}>{said}</span>,
    pausedAfter && <span key="paused" data-routine-auto-paused={pausedAfter}>{routineAutoPausedText(pausedAfter)}</span>,
    elapsed ? <span key="elapsed" data-routine-run-elapsed className="tabular-nums">{elapsed}</span> : !live && time,
  ].filter(Boolean);
  const icon = run.status === "waiting"
    ? <TriangleAlert size={13} className="text-warning" />
    : live
    ? <DottedSpinner size={13} />
    : run.status === "cancelled"
      ? <CircleSlash size={13} className="text-ink-tertiary" />
      : run.status === "failed" || run.status === "missed" || run.status === "blocked" || withProblems || (run.goalStatus && run.goalStatus !== "completed")
        ? <TriangleAlert size={13} className="text-warning" />
        : <Check size={13} className="text-success/80" />;
  return shell(
    <>
      <AskSettledLine
        icon={icon}
        ariaLabel={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
        action={details || stop || resume ? <span className="ms-auto flex shrink-0 items-center gap-1">{resume}{stop}{details}</span> : undefined}
      >
        {/* the line is cut with an ellipsis; its whole text is in the tooltip */}
        <span title={[name, said, pausedAfter ? routineAutoPausedText(pausedAfter) : "", elapsed ?? (live ? "" : routineDateTime(at))].filter(Boolean).join(" · ")}>
          {parts.flatMap((part, index) => (index === 0 ? [part] : [<span key={`sep-${index}`} aria-hidden="true">{" · "}</span>, part]))}
        </span>
      </AskSettledLine>
      {asked}
    </>,
  );
}
