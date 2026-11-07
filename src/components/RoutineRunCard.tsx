import { ChevronRight, Loader2, PauseCircle, Play } from "lucide-react";
import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";

import { chatBubbleWidth, useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { cn } from "@/lib/cn";
import { prefersWideBubble } from "@/lib/rich-blocks";
import { routineAutoPausedText, routineDateTime, routineResultText, routineRunBlockedLine, routineRunDuration, routineRunError, routineRunProblems } from "@/lib/routine-display";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ChatMarkdown } from "./ChatMarkdown";
import { AttentionItems } from "./AttentionCard";
import { DelegationList, type DelegationEntry } from "./DelegationList";
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

/** 2026-11-04 (JC: the grey text rows were ugly and not intuitive): the
 * status reads as a colored pill, as the risk chip on an approval card. */
const PILL: Record<string, string> = {
  "text-accent": "border-accent/35 bg-accent/10 text-accent",
  "text-warning": "border-warning/35 bg-warning/10 text-warning",
  "text-danger": "border-danger/40 bg-danger/10 text-danger",
  "text-success": "border-success/35 bg-success/10 text-success",
  "text-ink-secondary": "border-hairline/60 bg-inset text-ink-secondary",
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

const QUIET_LINK = "inline-flex items-center gap-0.5 rounded text-ink-tertiary transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/** The parts of the quiet line, one "·" between each two present parts:
 * an absent part (false, null, undefined, "") never leaves its separator. */
export function provenanceLine(parts: ReadonlyArray<ReactNode>): ReactNode[] {
  const present = parts.filter((part) => part !== false && part !== null && part !== undefined && part !== "");
  // each separator is keyed by the part it leads, so a part that leaves takes
  // its own separator with it and the others stay the same nodes (flash rule,
  // 2026-11-03): an index key moved them when the status settled
  return present.flatMap((part, index) => index === 0
    ? [part]
    : [<span key={`sep-${isValidElement(part) && part.key != null ? part.key : index}`} aria-hidden="true" data-routine-run-sep>·</span>, part]);
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
  bot: _bot,
  botOf,
  onOpen,
  onResume,
  onStop,
  onOpenThread,
  modelOf,
}: {
  message: Message;
  /** 2026-11-06: the model a teammate works on, grey in its row. */
  modelOf?: (botId: string, threadId: string) => string | undefined;
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
  const handedTo = run.handedTo ?? [];
  // 2026-11-06 (JC, Wren's chat read 7:24, 7:27, 7:30, 7:34, 7:28,
  // 7:30): the bubble sits where the run posted it, so its time is when it
  // posted. The trigger's time (a webhook queued behind another run, a late
  // schedule) stays in the tooltip. Showing scheduledFor put times out of order.
  const at = message.at;
  const triggeredAt = run.scheduledFor && Math.abs(run.scheduledFor - at) >= 60_000 ? run.scheduledFor : undefined;
  const pausedAfter = run.autoPausedAfter && run.autoPausedAfter > 0 ? run.autoPausedAfter : null;
  const elapsed = running && run.startedAt ? routineRunDuration({ startedAt: run.startedAt, status: "running" }, now) : undefined;
  // #2081 + JC 2026-11-06 (2 h): a routine run in the chat is never a card.
  // Its result is the bot's own message (the same bubble as a reply), the
  // run's detail one discreet "Details" away; no title, no badge, no
  // "Routine · date", no "View run", no red. A pass with nothing for the
  // person is one muted line. One DOM tree for every state (flash rule).
  const plain = true;
  const quiet = !report && !detail;
  const wide = Boolean(report && prefersWideBubble(report));
  const lead = running || (live && quiet)
    ? t("routines.status.running")
    : quiet || withProblems || !reported
      ? statusLabel
      : undefined;

  return (
    <section
      data-routine-run-card
      data-routine-run={run.runId}
      data-routine-run-state={run.goalStatus ?? run.status}
      data-routine-run-plain={plain ? "" : undefined}
      data-routine-run-quiet={quiet ? "" : undefined}
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className={cn("relative flex w-full flex-col items-start", quiet && !live && "opacity-70")}
    >
      {(report || detail) && (
        <div
          data-routine-run-bubble
          className={cn(
            "rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink",
            bubbleWidths[chatBubbleWidth({ terminal: false, wide })],
          )}
        >
          {/* 2026-11-06 (#2186): a routine report is the bot's own message.
              Widgets (```widget / ```widget-imperfect) draw like chat, never
              as a raw CodeBlock. An unclosed fence at the end still waits as
              a pending widget. */}
          {report ? <ChatMarkdown text={report} /> : <p className="whitespace-pre-wrap">{detail}</p>}
          {details && <RunResultDetails details={details} />}
        </div>
      )}
      {/* The quiet line under the message: time, what is still going on,
          and the run's detail behind a discreet link. */}
      <div
        data-routine-run-provenance
        className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-1 text-[11px] text-ink-tertiary", (report || detail) && "mt-1")}
      >
        {/* 2026-11-06 (pre-0.8.59): the separators are drawn between the
            parts present, never beside an absent one, so two never meet.
            Stop carries no square glyph: at this size it read as a second
            separator ("Details · · Stop"). */}
        {provenanceLine([
          lead && (
            <span
              key="status"
              data-routine-run-status
              className={cn(running && "thinking-shimmer animate-shimmer motion-reduce:animate-none")}
            >{lead}</span>
          ),
          <time key="at" dateTime={new Date(at).toISOString()} title={triggeredAt ? routineDateTime(triggeredAt) : undefined}>{routineDateTime(at)}</time>,
          elapsed && <span key="elapsed" data-routine-run-elapsed className="tabular-nums">{elapsed}</span>,
          onOpen && (
            <button
              key="open"
              type="button"
              data-routine-run-open
              onClick={onOpen}
              title={run.routineName}
              aria-label={t(run.goalStatus === "needs-input" ? "routines.post.reviewFor" : "routines.post.openRunFor", { name: run.routineName })}
              className={QUIET_LINK}
            >
              {t("routineRun.details")}
              <ChevronRight aria-hidden="true" size={11} />
            </button>
          ),
          live && onStop && (
            <button
              key="stop"
              type="button"
              data-run-stop
              onClick={onStop}
              aria-label={t("routines.post.stopRunFor", { name: run.routineName })}
              className={QUIET_LINK}
            >
              {t("routineRun.stop")}
            </button>
          ),
        ])}
      </div>
      {/* 2026-11-05: items only the person can do, each with its ticket. */}
      {reported && message.attention?.items.length ? (
        <div data-routine-run-attention className="mt-2 w-full pl-0.5">
          <div className="mb-1.5 text-[12px] font-medium text-ink-secondary">{t("needsYou.title", { bot: message.attention.botName })}</div>
          <AttentionItems items={message.attention.items} />
        </div>
      ) : null}
      {/* The failure paused its routine: one line and the way back on. */}
      {pausedAfter && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1 text-[11px] text-ink-tertiary">
          <span data-routine-auto-paused={pausedAfter} className="inline-flex items-center gap-1">
            <PauseCircle aria-hidden="true" size={11} />
            {routineAutoPausedText(pausedAfter)}
          </span>
          {onResume && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                data-routine-resume
                onClick={onResume}
                aria-label={t("routines.autoPause.resumeLabel", { name: run.routineName })}
                className={QUIET_LINK}
              >
                <Play aria-hidden="true" size={10} />
                {t("routines.autoPause.resume")}
              </button>
            </>
          )}
        </div>
      )}
      {handedTo.length > 0 && <DelegationList entries={handedTo} botOf={botOf} modelOf={modelOf} onOpen={onOpenThread} />}
    </section>
  );
}
