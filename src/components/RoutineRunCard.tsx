import { ArrowRight, CalendarClock, Loader2, PauseCircle, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BotAvatar } from "@/components/Avatar";
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

/** 2026-11-04 (JC: the grey text rows were ugly and not intuitive): the
 * status reads as a colored pill, as the risk chip on an approval card. */
const PILL: Record<string, string> = {
  "text-accent": "border-accent/35 bg-accent/10 text-accent",
  "text-warning": "border-warning/35 bg-warning/10 text-warning",
  "text-danger": "border-danger/40 bg-danger/10 text-danger",
  "text-success": "border-success/35 bg-success/10 text-success",
  "text-ink-secondary": "border-hairline/60 bg-inset text-ink-secondary",
};

/** The card's outline follows its status, as the team goal card's does. */
const BORDER: Record<string, string> = {
  "text-accent": "border-accent/30",
  "text-warning": "border-warning/35",
  "text-danger": "border-danger/35",
  "text-success": "border-success/30",
  "text-ink-secondary": "border-hairline/45",
};

const DONE = { label: "routineRun.card.done" as const, tone: "text-success" };

/** A status as a pill: always mounted (the flash, 2026-11-03), only its
 * text, color and icon change with the status. */
export function RunStatusPill({ label, tone, live }: { label: string; tone: string; live?: boolean }) {
  return (
    <span
      data-routine-run-status
      aria-live="polite"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none", PILL[tone] ?? PILL["text-ink-secondary"])}
    >
      {live && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
      {label}
    </span>
  );
}

const ACTION_PILL = "inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline/50 px-3 py-1 text-[12.5px] font-medium text-ink transition-colors hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const LINE_LINK = "inline-flex items-center gap-0.5 rounded font-medium text-accent transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/** The teammates a run handed work to. On a status card: mascot, name, pill,
 * optional thread link. Under a plain finished report: one grey line each
 * (2026-11-05, #2081). Thread link only when onOpenThread is given (threads
 * shown); unified chat names the teammate without a link. */
function RunHandoffRows({ handedTo, botOf, onOpenThread, asCard }: {
  handedTo: ReadonlyArray<{ botId: string; threadId: string; name?: string; status: string }>;
  botOf?: (botId: string) => Bot | undefined;
  onOpenThread?: (botId: string, threadId: string) => void;
  asCard?: boolean;
}) {
  return (
    <ul
      data-run-handed-to
      className={cn(
        "flex flex-col",
        asCard ? "mt-3 gap-2 border-t border-hairline/40 pt-3" : "mt-1.5 gap-0.5 pl-0.5 text-[11px] text-ink-secondary",
      )}
    >
      {handedTo.map((entry) => {
        const teammate = botOf?.(entry.botId);
        const name = entry.name || teammate?.name || t("routineRun.aTeammate");
        const known = (COPY as Record<string, { label: LocaleKey; tone: string }>)[entry.status];
        const state = entry.status === "completed" ? DONE : known;
        return (
          <li
            key={entry.threadId}
            data-run-handoff={entry.botId}
            className={cn("flex flex-wrap items-center", asCard ? "gap-2.5" : "gap-x-1.5")}
          >
            {asCard && (
              teammate && "color" in teammate && teammate.color
                ? <BotAvatar bot={teammate} size={22} animated={false} />
                : <span aria-hidden="true" className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-inset"><ArrowRight size={12} className="text-ink-secondary" /></span>
            )}
            {!asCard && entry.status === "running" && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
            <span className={cn("min-w-0 truncate", asCard ? "flex-1 text-[13px] text-ink" : undefined)}>
              {t("routineRun.handedTo", { name })}
            </span>
            {state && (
              asCard
                ? <RunStatusPill label={t(state.label)} tone={state.tone} live={entry.status === "running"} />
                : <>
                    <span aria-hidden="true">·</span>
                    <span data-run-handoff-status className={state.tone === "text-success" || state.tone === "text-accent" ? undefined : state.tone}>{t(state.label)}</span>
                  </>
            )}
            {onOpenThread && (
              asCard ? (
                <button
                  type="button"
                  data-run-teammate-thread={entry.threadId}
                  onClick={() => onOpenThread(entry.botId, entry.threadId)}
                  className={ACTION_PILL}
                >
                  {t("routineRun.openTeammateThread", { name })}
                  <ArrowRight aria-hidden="true" size={12} />
                </button>
              ) : (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    data-run-teammate-thread={entry.threadId}
                    onClick={() => onOpenThread(entry.botId, entry.threadId)}
                    className={LINE_LINK}
                  >
                    {t("routineRun.openTeammateThread", { name })}
                    <ArrowRight aria-hidden="true" size={12} />
                  </button>
                </>
              )
            )}
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
 *
 * 2026-11-05 (#2081): a finished run that has something to say reads as a
 * normal bot message (same bubble, same markdown, wide when a table is
 * present), with a small provenance line above it: Routine · name · Done
 * pill · time · View run, like "Answer from the parallel task". Cards stay
 * for real states: queued, running, waiting, blocked, failed, missed,
 * nothing to report, done with problems, hand-off chrome. One DOM tree for
 * every state (flash rule, 2026-11-03): only classes change when Running
 * settles to Done. Unified chat: no thread link unless onOpenThread is set. */
export function RoutineRunCard({
  message,
  bot,
  botOf,
  onOpen,
  onResume,
  onStop,
  onOpenThread,
}: {
  message: Message;
  /** The bot that ran the routine: its mascot leads the status card. */
  bot?: Bot;
  /** A teammate a run handed work to, for its name and mascot. */
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
  // #2081: a clean finished report is the bot's message. Status cards stay
  // for queued / running / waiting / blocked / failed / missed / nothing to
  // report / done with problems (and any non-completed goal outcome).
  const plain = reported && !withProblems;
  const quiet = !report && !detail;
  const wide = Boolean(report && prefersWideBubble(report));

  return (
    <section
      data-routine-run-card
      data-routine-run={run.runId}
      data-routine-run-state={run.goalStatus ?? run.status}
      data-routine-run-plain={plain ? "" : undefined}
      data-routine-run-quiet={quiet ? "" : undefined}
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className={cn(
        "relative w-full",
        plain
          ? undefined
          : cn("max-w-[680px] overflow-hidden rounded-2xl border bg-card px-3.5 py-3 shadow-sm", BORDER[copy.tone] ?? BORDER["text-ink-secondary"]),
      )}
    >
      {/* Same nodes for every state (flash rule). Plain: small grey provenance
          line above the bot bubble. Card: avatar + title + pill + actions. */}
      <div
        data-routine-run-provenance
        className={cn(
          "flex",
          plain
            ? cn("flex-wrap items-center gap-x-1.5 gap-y-1 pl-0.5 text-[11px] text-ink-secondary", quiet ? undefined : "mb-1")
            : "items-start gap-3",
        )}
      >
        <div
          data-routine-run-avatar
          aria-hidden="true"
          className={cn("shrink-0", plain && "hidden")}
        >
          {bot && "color" in bot && bot.color
            ? <BotAvatar bot={bot} size={30} animated={false} />
            : <div className="flex size-[30px] items-center justify-center rounded-xl bg-inset"><CalendarClock size={15} className="text-ink-secondary" /></div>}
        </div>
        <div className={cn("min-w-0", plain ? "contents" : "flex-1")}>
          <div className={cn("flex flex-wrap items-center", plain ? "contents" : "gap-x-2 gap-y-1")}>
            <span className={cn(plain ? undefined : "hidden")}>{t("routineRun.openRoutine")}</span>
            <span aria-hidden="true" className={cn(plain ? undefined : "hidden")}>·</span>
            <h3 className={cn("min-w-0 truncate", plain ? "font-medium text-ink-secondary" : "text-[14px] font-semibold leading-snug text-ink")}>
              {run.routineName}
            </h3>
            <span aria-hidden="true" className={cn(plain ? undefined : "hidden")}>·</span>
            <RunStatusPill label={statusLabel} tone={copy.tone} live={running} />
          </div>
          <div className={cn("flex flex-wrap items-center gap-x-1.5", plain ? "contents" : "mt-0.5 text-[11.5px] text-ink-secondary")}>
            <span className={cn(plain && "hidden")}>{t("routineRun.openRoutine")}</span>
            <span aria-hidden="true" className={cn(plain && "hidden")}>·</span>
            <span aria-hidden="true" className={cn(plain ? undefined : "hidden")}>·</span>
            <time dateTime={new Date(at).toISOString()}>{routineDateTime(at)}</time>
            {elapsed && <>
              <span aria-hidden="true">·</span>
              <span data-routine-run-elapsed className="tabular-nums">{elapsed}</span>
            </>}
          </div>
        </div>
        <span aria-hidden="true" className={cn(plain && onOpen ? undefined : "hidden")}>·</span>
        {onOpen && (
          <button
            type="button"
            data-routine-run-open
            onClick={onOpen}
            aria-label={t(review ? "routines.post.reviewFor" : "routines.post.openRunFor", { name: run.routineName })}
            className={cn(
              plain ? LINE_LINK : ACTION_PILL,
              !plain && review && "border-warning/40 bg-warning/15 text-warning hover:bg-warning/25",
              plain && review && "text-warning",
            )}
          >
            {actionLabel}
            <ArrowRight aria-hidden="true" size={plain ? 11 : 12} />
          </button>
        )}
        <span aria-hidden="true" className={cn(plain && live && onStop ? undefined : "hidden")}>·</span>
        {live && onStop && (
          <button
            type="button"
            data-run-stop
            onClick={onStop}
            aria-label={t("routines.post.stopRunFor", { name: run.routineName })}
            className={cn(
              plain
                ? "inline-flex items-center gap-1 rounded text-[11px] font-medium text-danger transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                : cn(ACTION_PILL, "text-danger"),
            )}
          >
            <Square aria-hidden="true" size={plain ? 10 : 11} fill="currentColor" />
            {t("routineRun.stop")}
          </button>
        )}
      </div>
      {(report || detail) && (
        <div
          data-routine-run-bubble
          className={cn(
            plain
              ? cn(
                  "rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5",
                  detail && failedTone ? "text-danger" : "text-ink",
                  bubbleWidths[chatBubbleWidth({ terminal: false, wide })],
                )
              : cn("mt-2.5 pl-[42px] text-[14px] leading-relaxed", detail && failedTone ? "text-danger" : "text-ink"),
          )}
        >
          {report ? <ChatMarkdown text={report} inert /> : <p className="whitespace-pre-wrap">{detail}</p>}
          {details && <RunResultDetails details={details} />}
        </div>
      )}
      {/* 2026-11-05: items only the person can do, each with its ticket. */}
      {reported && message.attention?.items.length ? (
        <div data-routine-run-attention className={cn("mt-2", plain ? "pl-0.5" : "pl-[42px]")}>
          <div className="mb-1.5 text-[12px] font-semibold text-warning">{t("needsYou.title", { bot: message.attention.botName })}</div>
          <AttentionItems items={message.attention.items} />
        </div>
      ) : null}
      {/* The failure paused its routine: one line and the way back on. */}
      {pausedAfter && (
        <div className={cn("mt-2.5 flex flex-wrap items-center gap-2", plain ? "pl-0.5" : "pl-[42px]")}>
          <span data-routine-auto-paused={pausedAfter} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-warning">
            <PauseCircle aria-hidden="true" size={13} />
            {routineAutoPausedText(pausedAfter)}
          </span>
          {onResume && (
            <button
              type="button"
              data-routine-resume
              onClick={onResume}
              aria-label={t("routines.autoPause.resumeLabel", { name: run.routineName })}
              className={plain ? LINE_LINK : ACTION_PILL}
            >
              <Play aria-hidden="true" size={11} />
              {t("routines.autoPause.resume")}
            </button>
          )}
        </div>
      )}
      {handedTo.length > 0 && <RunHandoffRows handedTo={handedTo} botOf={botOf} onOpenThread={onOpenThread} asCard={!plain} />}
      {/* A running run's live strip along the bottom edge: it moves, it
          takes no room, so the row keeps its height when the run ends. */}
      {running && <div aria-hidden="true" data-routine-run-live className="absolute inset-x-0 bottom-0 h-[2px] animate-shimmer bg-[linear-gradient(90deg,transparent_0%,var(--color-accent)_50%,transparent_100%)] bg-[length:200%_100%]" />}
    </section>
  );
}
