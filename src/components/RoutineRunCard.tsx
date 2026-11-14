import { ChevronRight, CircleAlert, CircleSlash, Clock, Play, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { routineAutoPausedText, routineDateTime, routineResultText, routineRunBlockedLine, routineRunBrief, routineRunDuration, routineRunError, routineRunProblems, routineRunTone } from "@/lib/routine-display";
import { isRoutineResult, routineResultNeedsPerson } from "@/lib/routine-result-stack";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { AttentionItems } from "./AttentionCard";
import { DottedSpinner } from "./bot-settings/CodingSessionRow";
import { DelegationLine, DelegationList, type DelegationEntry } from "./DelegationList";
import type { RoutineRunCardData } from "../../shared/routine-run";
import { formatTime, type Bot, type Message } from "@/state/store";
import { dayLabel, localDay } from "@/lib/transcript-derivations";

const DETAIL_LIMIT = 280;

const COPY = {
  queued: { label: "routines.status.queued" },
  running: { label: "routines.status.running" },
  waiting: { label: "routines.status.waiting" },
  completed: { label: "routines.status.completed" },
  failed: { label: "routines.status.failed" },
  blocked: { label: "routines.status.blocked" },
  cancelled: { label: "routines.status.cancelled" },
  missed: { label: "routines.status.missed" },
  nothing_to_report: { label: "routines.status.nothing_to_report" },
} satisfies Record<
  RoutineRunCardData["status"],
  { label: LocaleKey }
>;

const GOAL_COPY = {
  completed: { label: "routines.goal.completed" },
  "needs-input": { label: "routines.goal.needs-input" },
  blocked: { label: "routines.goal.blocked" },
  "limit-reached": { label: "routines.goal.limit-reached" },
  paused: { label: "routines.goal.paused" },
  stopped: { label: "routines.goal.stopped" },
  failed: { label: "routines.goal.failed" },
} satisfies Record<
  NonNullable<RoutineRunCardData["goalStatus"]>,
  { label: LocaleKey }
>;

const DEFERRED = { label: "routines.status.deferred" as const };
/** 2026-11-01: completed, but not all of it went right. */
const WITH_PROBLEMS = { label: "routines.status.completedWithProblems" as const };

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

/** #3695, #3990: a routine's one summary card of a problem: the server
 * marks it `streak` when it tells the person (at the first run with a
 * problem for a routine that runs at most once a day, the third for one
 * that can run several times a day: shared/routine-repeat.ts). */
function isProblemStreakCard(run: RoutineRunCardData): boolean {
  return Boolean(run.repeat?.streak);
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

const DONE = { label: "routineRun.card.done" as const };

/** #4234: the reference's system event, measured from its installed bundle
 * (docs/design/ux-reference-grokbot-cursor.md 2.7): a 24px chip, pill
 * corners, 4px before the glyph and 6px after the name, 2px between them,
 * 12px type on a 16px line in the secondary ink. */
/** #4275: the one way to a run's details on every row (a problem, a result,
 * a run waiting on the person, a running run): the reference's chip, grown
 * to the row's lines: 4px above and below a 16px line (24px), 4px before
 * the glyph and 6px after, the hover fill; as wide as its words, never the
 * whole column. Its first line ends with the chevron, right after the time. */
const RUN_OPEN = "flex w-fit min-w-0 max-w-full flex-col items-start rounded-xl py-1 ps-1 pe-1.5 text-start text-[12px] leading-4 text-ink-secondary";
const RUN_FIRST_LINE = "flex h-4 min-w-0 max-w-full items-center gap-0.5";
// #4234 review: the name never shrinks (a narrow window cut it after a few
// letters; even a weighted shrink cut a fraction of a pixel, enough for an
// ellipsis): the status words are cut first. Only a name longer than the
// line (its container, cqw) less the room its other parts need at their
// smallest is cut: the glyph, the dots, a few status letters, the time and
// the chevron (9rem), and Stop or Resume beside them on a live or paused
// run (12rem).
const RUN_NAME_ROOM = "max-w-[calc(100cqw-9rem)]";
const RUN_NAME_ROOM_ACTIONS = "max-w-[calc(100cqw-12rem)]";
/** #4275: and on a line wide enough for a live run's whole state word,
 * that word as well (17rem). */
const RUN_NAME_ROOM_WORD = "@min-[30rem]/run-line:max-w-[calc(100cqw-17rem)]";
/** The chip that opens something: the reference's hover fill, 120ms. */
const RUN_CHIP_INTERACTIVE = "cursor-pointer transition-colors duration-[120ms] hover:bg-ink/[0.06] hover:text-ink active:bg-ink/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
/** Stop and Resume on the line: the same chip, without a glyph of its own. */
const RUN_CHIP_ACTION = "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-1.5 text-ink-tertiary transition-colors duration-[120ms] hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
/** The dot between the line's parts: always the same node, empty and
 * hidden when the part after it has nothing to say. */
function Separator({ shown }: { shown: boolean }) {
  return <span aria-hidden="true" className={cn("shrink-0 px-1 text-ink-tertiary", !shown && "hidden")}>{shown ? "·" : ""}</span>;
}
/** #4275: the chevron that ends the opener's first line, on every row. */
function OpenChevron() {
  return <ChevronRight aria-hidden="true" size={12} className="ms-0.5 shrink-0 text-ink-tertiary rtl:rotate-180" />;
}
/** What comes under the line starts where the routine's name does: the
 * chip's 4px, the 12px glyph and the 2px gap. */
const RUN_INDENT = "ps-[18px]";

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

/** #3581: the form a run takes in the chat. The card: a finished result
 * with something to read (#4234: or a widget the run drew for the person);
 * its words under the line. #4161, the problem row: a failure, a streak's
 * summary, a result with problems, a block, an open team goal or items for
 * the person, one compact row the whole of which opens the run. The row: a
 * run in progress, queued, waiting, cancelled or with nothing to report, and
 * a result or failure a newer result folded; its words in the line. */
export function routineRunForm(message: Pick<Message, "routineRun" | "attention">, run: RoutineRunCardData, folded: boolean): "card" | "row" | "problem" {
  // #3695: a repeating routine's one summary is the one thing its runs say
  // in the chat, whatever the third run's status, so its count, since when
  // and what is wrong are read whole.
  if (isProblemStreakCard(run)) return "problem";
  if (folded) return "row";
  const shown = { ...message, routineRun: run };
  if (isProblemRun(shown, run)) return "problem";
  if (!isRoutineResult(run)) return "row";
  return run.widgetId || routineRunBrief(run) || run.recovered || run.handedTo?.length ? "card" : "row";
}

/** #4161: a run whose row tells a problem or waits on the person. */
function isProblemRun(message: Pick<Message, "routineRun" | "attention">, run: RoutineRunCardData): boolean {
  if (!run.goalStatus && (run.status === "failed" || run.status === "missed")) return true;
  return run.goalStatus === "failed" || routineResultNeedsPerson(message);
}

/** One routine run in the conversation it reports to. The run works in the
 * background (2026-10-22) and the server upserts this one message per run,
 * so a running run is one live row patched in place, never a second one.
 *
 * #4234 (the owner, 2026-11-13, on the rounded card: "c'est laid"): every
 * run is drawn as the reference draws a routine in its chat, a system event
 * line: the routine's glyph and name in one chip that opens the run's window
 * (its Details, with the whole report as a normal bot message), then its
 * time. A result's words (the report's closing line, never a sentence that
 * only points at a form) follow under the name in a line or two, then the
 * widget the run drew for the person, usable in place. No surface, no band
 * of empty space, nothing detached. The report never unfolds in the chat
 * (the big card refused on 2026-11-05). A result a newer result follows,
 * and every run with nothing to read, says its state in the line (#3581).
 * The form follows the settled status only, and each form is one tree whose
 * parts only change classes and text (the flash rule, 2026-11-03). Unified
 * chat: no thread link unless onOpenThread is set. */
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
  widget,
}: {
  message: Message;
  /** 2026-11-06: the model a teammate works on, grey in its row. */
  modelOf?: (botId: string, threadId: string) => string | undefined;
  /** #4234: the widget the run drew for the person (its card's `widgetId`),
   * drawn under the row and usable there. */
  widget?: ReactNode;
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
  /** 2026-11-05 (#2096): Stop lives on the run itself, beside its chip, as
   * long as the run is live. Absent: no button. */
  onStop?: () => void;
  /** 2026-11-03: opens the thread a teammate works in (the run handed work
   * to it). Absent (threads hidden, the unified chat): the teammate is
   * named without a link; its outcome reaches this chat as a message. */
  onOpenThread?: (botId: string, threadId: string) => void;
}) {
  const run = useSettledRoutineRun(message.routineRun);
  const briefId = useId();
  const statusId = useId();
  const running = run?.status === "running" && !run.goalStatus;
  // A live run (queued, running, waiting on someone) keeps Stop beside its chip (#2096).
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
  const pendingItems = Boolean(message.attention?.items.length && !message.attention.handledAt);
  // #4161: a finished result whose items wait on the person is not "Done":
  // its glyph is named for what it waits for
  const statusLabel = t(copy === DONE && pendingItems ? "routines.goal.needs-input" : copy.label);
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

  const stop = live && onStop && (
    <button key="stop" type="button" data-run-stop onClick={onStop} aria-label={t("routines.post.stopRunFor", { name: run.routineName })} className={RUN_CHIP_ACTION}>
      {t("routineRun.stop")}
    </button>
  );
  const resume = pausedAfter && onResume && (
    <button key="resume" type="button" data-routine-resume onClick={onResume} aria-label={t("routines.autoPause.resumeLabel", { name: run.routineName })} className={RUN_CHIP_ACTION}>
      <Play aria-hidden="true" size={12} />
      {t("routines.autoPause.resume")}
    </button>
  );
  const handedTo = run.handedTo ?? [];
  const asked = handedTo.length > 0 && <DelegationLine entries={handedTo} owner={bot} botOf={botOf} modelOf={modelOf} onOpen={onOpenThread} />;

  // #3479: a lasting problem is said once; its row counts the runs since.
  // #3695: a repeating routine's one summary counts its runs with problems,
  // whatever they said, a failure or a block included.
  const lasting = run.repeat && run.repeat.count > 1 && (withProblems || run.repeat.streak) ? run.repeat : undefined;

  const warn = withProblems || streakFailed || run.status === "blocked" || run.status === "failed" || run.status === "missed" || (run.goalStatus && run.goalStatus !== "completed") || pendingItems;
  // #4161: the routine rows' own state tokens, red for a failure, orange for
  // problems and for what waits on the person
  const tone = routineRunTone(run) === "text-danger" ? "text-danger" : "text-warning";
  // #4234, the reference's routine glyph (a clock), its state when it has one
  const glyph = run.status === "waiting"
    ? <TriangleAlert size={12} className="text-warning" />
    : live
      ? <DottedSpinner size={12} />
      : run.status === "cancelled"
        ? <CircleSlash size={12} className="text-ink-tertiary" />
        : warn
          ? <TriangleAlert size={12} className={tone} />
          : <Clock size={12} />;

  // What the line says after the routine's name: the row's state words, or
  // nothing for a result whose words are under it.
  const said = form !== "row" ? "" : (() => {
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

  const pausedWords = pausedAfter ? routineAutoPausedText(pausedAfter) : "";
  // #4234 review, #4204: an unanswered question is drawn once, in the pinned
  // zone, with its options; the run says it in one quiet line. Answered, its
  // items stay under the run as the record of what was asked.
  const items = form !== "row" && message.attention?.items.length ? (
    <div data-routine-run-attention={pendingItems ? "pinned" : "answered"} className="w-full">
      <div className={cn("text-[12px] font-medium text-ink-secondary", !pendingItems && "mb-1.5")}>{t("needsYou.title", { bot: message.attention.botName })}</div>
      {!pendingItems && <AttentionItems items={message.attention.items} />}
    </div>
  ) : null;

  if (form === "problem") {
    // #4161 (the owner, 2026-11-13, on the wide block with "Failed" alone on
    // a line and "Details" apart: "It looks very bad"): one compact row in
    // the reference's system event look (docs/design 2.7): the state glyph in
    // the state's colour, named for the state, the routine's name, the time
    // and a chevron on the line; the sentence under the name in a line or
    // two; the count of a lasting problem and the pause under it, quiet. The
    // state is said once, by the glyph; the whole row opens the run.
    const sentence = streakFailed
      ? brief
      : run.status === "blocked" && !run.goalStatus
        ? routineRunBlockedLine(run)
        : !run.goalStatus && (run.status === "failed" || run.status === "missed")
          ? compactDetail(routineResultText(routineRunError(run.error) ?? run.summary).text)
          : brief;
    const content = (
      <>
        <span data-routine-run-first-line className={RUN_FIRST_LINE}>
          <span role="img" aria-label={statusLabel} title={statusLabel} data-routine-run-status={run.goalStatus ?? run.status} className={cn("flex shrink-0", tone)}>
            {tone === "text-danger" ? <CircleAlert aria-hidden="true" size={12} /> : <TriangleAlert aria-hidden="true" size={12} />}
          </span>
          {name && <span data-routine-run-name className="min-w-0 truncate" title={name}>{name}</span>}
          <Separator shown={Boolean(name)} />
          <span className="shrink-0 text-ink-tertiary">{time}</span>
          {onOpen && <OpenChevron />}
        </span>
        {sentence && (
          <span id={briefId} data-routine-run-brief dir="auto" title={sentence} className="mt-0.5 line-clamp-2 ps-[14px] text-[13px] leading-[18px] text-ink">{sentence}</span>
        )}
        {(lasting || pausedWords) && (
          <span className="ps-[14px] text-ink-tertiary">
            {lasting && <span data-routine-run-repeat title={routineDateTime(lasting.lastAt)}>{routineRepeatText(lasting)}</span>}
            {lasting && pausedWords && <span aria-hidden="true">{" · "}</span>}
            {pausedWords && <span data-routine-auto-paused={pausedAfter ?? undefined}>{pausedWords}</span>}
          </span>
        )}
      </>
    );
    return (
      <section
        data-routine-run-card
        data-routine-run={run.runId}
        data-routine-run-state={run.goalStatus ?? run.status}
        data-routine-run-form={form}
        aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
        className="flex w-full min-w-0 max-w-[600px] flex-col items-start text-start"
      >
        {onOpen ? (
          <button
            type="button"
            data-routine-run-open
            data-routine-problem-row
            onClick={onOpen}
            title={t("routineRun.details")}
            aria-label={t("routineRun.stateLine", { status: statusLabel, reason: openLabel })}
            aria-describedby={sentence ? briefId : undefined}
            className={cn(RUN_OPEN, RUN_CHIP_INTERACTIVE)}
          >
            {content}
          </button>
        ) : (
          <div data-routine-problem-row className={RUN_OPEN}>{content}</div>
        )}
        {/* Resume and Stop: their own buttons under the row, where its words
            start, so the row keeps the width of its words at any width */}
        {(resume || stop) && <div className={cn(RUN_INDENT, "-ms-1.5 flex items-center gap-0.5 text-[12px] leading-4")}>{resume}{stop}</div>}
        {items && <div className={cn(RUN_INDENT, "mt-1 w-full")}>{items}</div>}
        {asked && <div className={cn(RUN_INDENT, "mt-1 w-full")}>{asked}</div>}
        {widget && <div data-routine-run-widget className="mt-2 w-full">{widget}</div>}
      </section>
    );
  }

  // #4234 (the reference's system event), #4275: the routine's glyph, its
  // name, what the row says and its time are one chip, the same as the
  // problem row's, and the chip is the run's one way to its Details: it
  // opens the run's window, its chevron ending its first line (after the
  // time; a live run has no time, its words keep that room, a running run
  // shows how long instead). The chip keeps its name ("View run for ..."),
  // and its description for the ear is the glyph's state word.
  // #4275: the state word of a run the spinner draws ("Running", "Queued")
  // is whole or absent, never a stub ("En ..."): whole on a line with room
  // for it and the name (30rem), the name then keeping the rest; absent on
  // a narrower line, where the spinner says it (its tooltip, and the chip's
  // name for the ear), how long and Stop staying. A sentence (a state and
  // its reason) is cut with an ellipsis, its whole in the line's tooltip.
  const spinnerWord = Boolean(said) && said === statusLabel && live && run.status !== "waiting";
  const when = elapsed
    ? <span key="elapsed" data-routine-run-elapsed className="tabular-nums">{elapsed}</span>
    : live ? null : time;
  const nameRoom = resume || stop ? RUN_NAME_ROOM_ACTIONS : RUN_NAME_ROOM;
  const firstLine = (
    <span data-routine-run-first-line className={RUN_FIRST_LINE}>
      <span id={statusId} role="img" aria-label={statusLabel} title={statusLabel} className="flex shrink-0">{glyph}</span>
      <span data-routine-run-name className={cn("min-w-0 shrink-0 truncate", nameRoom, spinnerWord && RUN_NAME_ROOM_WORD)} title={name}>{name}</span>
      {/* one tree whatever the line says (the flash rule, 2026-11-03): a
          part with nothing to say is hidden, never taken out */}
      <span data-routine-run-word className={spinnerWord ? "hidden shrink-0 items-center whitespace-nowrap @min-[30rem]/run-line:flex" : "contents"}>
        <Separator shown={Boolean(said && name)} />
        <span data-routine-run-status={said ? true : undefined} dir="auto" aria-live="polite" className={cn(spinnerWord ? "shrink-0 whitespace-nowrap" : "min-w-8 truncate", !said && "hidden", running && "thinking-shimmer animate-shimmer motion-reduce:animate-none")}>{said}</span>
      </span>
      <Separator shown={Boolean(pausedWords && (name || said))} />
      <span data-routine-auto-paused={pausedAfter ?? undefined} className={cn("min-w-8 truncate", !pausedWords && "hidden")}>{pausedWords}</span>
      <Separator shown={Boolean(when && (name || said || pausedWords))} />
      <span className={cn("shrink-0 text-ink-tertiary", !when && "hidden")}>{when}</span>
      {onOpen && <OpenChevron />}
    </span>
  );
  const entry = onOpen ? (
    <button type="button" data-routine-run-open onClick={onOpen} title={t("routineRun.details")} aria-label={openLabel} aria-describedby={statusId} className={cn(RUN_OPEN, RUN_CHIP_INTERACTIVE)}>
      {firstLine}
    </button>
  ) : (
    <span className={RUN_OPEN}>{firstLine}</span>
  );
  const line = (
    <div
      data-routine-run-line
      // the whole line in its tooltip: it is cut with an ellipsis
      title={[name, said, pausedWords, elapsed ?? (live ? "" : routineDateTime(at))].filter(Boolean).join(" · ")}
      className="@container/run-line flex min-h-6 w-full min-w-0 items-center gap-0.5 text-[12px] leading-4 text-ink-secondary"
    >
      {entry}
      {(resume || stop) && <span className="ms-auto flex shrink-0 items-center gap-0.5 ps-1">{resume}{stop}</span>}
    </div>
  );

  // #4161: every problem and everything that waits on the person is the
  // problem row above; a card's one state line is the first success after a
  // lasting problem (#3479), said once
  const state = form === "card" && run.recovered
    ? <span data-routine-run-recovered className="text-success">{t("routineRun.worksAgain", { since: routineDateTime(run.recovered.since) })}</span>
    : null;

  return (
    <section
      data-routine-run-card
      data-routine-run={run.runId}
      data-routine-run-state={run.goalStatus ?? run.status}
      data-routine-run-form={form}
      aria-label={t("routineRun.ariaLabel", { name: run.routineName, status: statusLabel })}
      className="flex w-full min-w-0 max-w-[600px] flex-col items-start text-start"
    >
      {line}
      {/* #4234: the result in a line or two that stands alone, under the
          name, where the bot's words start; no surface and no band below */}
      {form === "card" && brief && (
        <p data-routine-run-brief dir="auto" title={brief} className={cn(RUN_INDENT, "line-clamp-2 text-[13px] leading-[18px] text-ink")}>{brief}</p>
      )}
      {(state || items) && (
        <div className={cn(RUN_INDENT, "mt-1 flex w-full flex-col gap-2")}>
          {state && <div className="text-[12px] leading-4">{state}</div>}
          {items}
        </div>
      )}
      {asked && <div className={cn(RUN_INDENT, "mt-1 w-full")}>{asked}</div>}
      {widget && <div data-routine-run-widget className="mt-2 w-full">{widget}</div>}
    </section>
  );
}
