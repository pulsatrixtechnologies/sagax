// The bot page's Outcomes tab (#4098, first lot): each result the person
// wants kept true, read from the routines that exist today
// (shared/outcomes.ts). A routine is an outcome of its own, named by its
// goal when it has one. A row opens in place: what needs the person (a
// pointer to the chat, where the answer is given; nothing is answered
// here), then Results, Routines and Recent runs. No new state: the chat's
// card says the question, the routine's page its settings, the run window
// its run; this tab only reads them and points there.
// "New outcome" (#4098): a field under the label; Enter sends the result the
// person wants as their own message in the bot's one conversation, marked as
// an outcome ask (shared/data-context.ts OUTCOME_REQUEST_HINT), and the page
// moves to the chat, where the routine proposal card arrives as any other.
// Look: docs/design/ux-reference-grokbot-cursor.md, 2.4 ter.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Ban, Check, CheckCircle2, ChevronDown, ChevronRight, Flag, Minus, Plus, TriangleAlert } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Routine, RoutineRun } from "@/lib/routines";
import { scheduleLabelCompact, shortDate } from "@/lib/schedule-label";
import { needSentence, routineDateTime, routineRunAgo, routineRunDuration, routineRunLabel } from "@/lib/routine-display";
import { splitLinks } from "@/lib/short-links";
import { trendKind, type TrendRunKind } from "@/lib/routine-trend";
import { outcomesOf, type Outcome, type OutcomeNeed, type OutcomeRunLine } from "../../../../shared/outcomes";
import { ASK_CHIP, ASK_CHIP_IDLE } from "../../AskCard";
import { ShowMoreFold } from "../../ShowMoreFold";
import { ActivityStatusIcon } from "../../bot-settings/ActivityCard";
import { routineRunInFlight } from "../../routines/RunNowButton";
import { RoutinesAskHint } from "../../bot-settings/RoutinesSection";
import { PANEL_LABEL, onOff } from "../../routines/PanelRows";
import { FactRow, FactRows } from "../../plugins/DetailParts";
import { PILL as ACTION_PILL, PLAIN_FIELD } from "../../SettingsPrimitives";
import { runActivityStatus } from "../../routines/RoutineRunDetail";
import { ProfileCard } from "./cards";

/** Outcomes, then runs, shown before the fold (the reference: five). */
export const OUTCOMES_SHOWN = 5;

/** The bot's outcomes from the routines and runs this viewer has. */
export function useOutcomes(routines: readonly Routine[], runs: readonly RoutineRun[]): Outcome[] {
  return useMemo(() => outcomesOf(routines, runs), [routines, runs]);
}

const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium leading-4 [&>svg]:size-3";

function StatusPill({ outcome }: { outcome: Outcome }) {
  if (outcome.status === "needs-you") {
    return <span data-outcome-pill="needs-you" className={cn(PILL, "bg-warning/15 text-warning")}><Flag aria-hidden="true" strokeWidth={2} />{t("botTasks.waiting")}</span>;
  }
  if (outcome.status === "on-track") {
    return <span data-outcome-pill="on-track" className={cn(PILL, "bg-success/15 text-success")}><Check aria-hidden="true" strokeWidth={2.25} />{t("outcomes.onTrack")}</span>;
  }
  return null;
}

/** The grey line: the note, its schedule (several routines: the count),
 * then Paused, finished or Reached on a date (no pill for those). */
function greyLine(outcome: Outcome, routines: readonly Routine[]): string {
  const own = routines.filter((routine) => outcome.routineIds.includes(routine.id));
  const when = own.length === 1 ? scheduleLabelCompact(own[0]!.schedule) : t("outcomes.routineCount", { count: own.length });
  const state = outcome.status === "paused" ? t("routines.pausedSchedule")
    : outcome.status === "finished" ? t("routines.finishedSchedule")
      : outcome.status === "reached" && outcome.reachedAt ? t("outcomes.reachedOn", { date: shortDate(outcome.reachedAt) })
        : null;
  return [outcome.note, when, state].filter(Boolean).join(" · ");
}

/** The run's state icon, in the trend's own colours (success, problems, failed, blocked). */
function RunStateIcon({ line, run }: { line: OutcomeRunLine; run: RoutineRun | undefined }) {
  if (line.word === "nothing") return <Minus size={14} strokeWidth={1.9} aria-hidden="true" data-activity-icon="nothing" className="shrink-0 text-ink-tertiary" />;
  const kind: TrendRunKind | null = trendKind({ status: line.status, problems: run?.problems });
  const common = { size: 14, strokeWidth: 1.9, "aria-hidden": true as const, "data-run-state": kind ?? "other" };
  switch (kind) {
    case "success": return <CheckCircle2 {...common} data-activity-icon="finished" className="shrink-0 text-trend-success" />;
    case "problems": return <TriangleAlert {...common} data-activity-icon="problems" className="shrink-0 text-trend-problems" />;
    case "failed": return <AlertCircle {...common} data-activity-icon="failed" className="shrink-0 text-trend-failed" />;
    case "blocked": return <Ban {...common} data-activity-icon="blocked" className="shrink-0 text-trend-failed" />;
    default: return <ActivityStatusIcon status={runActivityStatus({ status: line.status })} size={14} />;
  }
}

/** One compact row per run: state icon, the run's date and time (the routine's name only when the outcome
 * has several), the status and how long it took. It opens the run's log. */
function RunLine({ line, run, withName, onOpen }: { line: OutcomeRunLine; run: RoutineRun | undefined; withName: boolean; onOpen: () => void }) {
  const word = line.word === "done" ? t("routineRun.card.done")
    : line.word === "nothing" ? t("routines.status.nothing_to_report")
      : run ? routineRunLabel(run) : t(`routines.status.${line.status}`);
  const took = run ? routineRunDuration(run) : undefined;
  return (
    <button type="button" data-outcome-run={line.runId} data-outcome-run-word={line.word} title={routineRunAgo(line.at)} onClick={onOpen}
      className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] leading-[18px] hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <RunStateIcon line={line} run={run} />
      <span data-outcome-run-when="" className="shrink-0 tabular-nums text-ink">{routineDateTime(line.at)}</span>
      <span className="min-w-0 flex-1 truncate text-ink-tertiary">{withName ? line.name : ""}</span>
      <span className="min-w-0 truncate text-ink-secondary" title={word}>{word}</span>
      {took && <span className="shrink-0 tabular-nums text-ink-tertiary">{took}</span>}
    </button>
  );
}

/** A text with its web addresses as links worded host and path. */
function LinkedText({ text }: { text: string }) {
  return <>{splitLinks(text).map((part, index) => part.href
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href} className="text-accent-text underline-offset-2 hover:underline">{part.text}</a>
    : <span key={index}>{part.text}</span>)}</>;
}

/** What needs the person, as the problem line reads everywhere else: the plain sentence in normal weight,
 * the provider's own words under Details, then the card's actions. "Needs you" is the row's badge only. */
function NeedBlock({ outcome, need, own, runs, actions }: { outcome: Outcome; need: OutcomeNeed; own: readonly Routine[]; runs: readonly RoutineRun[]; actions: OutcomesActions }) {
  const [checked, setChecked] = useState(false);
  const run = need.runId ? runs.find((candidate) => candidate.id === need.runId) : undefined;
  const routine = own.find((candidate) => candidate.id === run?.routineId) ?? own[0];
  const name = routine?.name ?? run?.routineName ?? outcome.name;
  const streak = Math.max(1, routine?.failureStreak ?? 0);
  const detail = need.kind === "problem" ? need.text.trim() : "";
  const sentence = need.kind === "problem"
    ? t(streak > 1 ? "routine.problemCard.problem" : "routine.problemCard.problemOnce", { routine: name, count: streak })
    : needSentence(need);
  const canCheck = Boolean(routine && actions.onCheck && (!actions.canCheck || actions.canCheck(routine)) && (need.kind === "problem" || need.kind === "paused") && !routineRunInFlight(runs, routine.id));
  return (
    <div data-outcome-need={need.kind} role="group" aria-label={t("botTasks.waiting")} className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-inset px-3 py-2">
      <p data-outcome-need-text="" className="min-w-0 break-words text-[13px] font-normal leading-5 text-ink"><bdi>{sentence}</bdi></p>
      {detail && (
        <details data-outcome-need-details="" className="min-w-0 text-[12px] leading-4 text-ink-secondary">
          <summary className="cursor-pointer select-none text-ink-tertiary hover:text-ink">{t("routineRun.details")}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words"><bdi>{detail}</bdi></p>
        </details>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button type="button" data-outcome-reply="" onClick={() => actions.onReply(need)} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>{t("outcomes.replyInChat")}</button>
        {canCheck && routine && (
          <button type="button" data-outcome-check="" disabled={checked} onClick={() => { setChecked(true); actions.onCheck!(routine); }} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>{t("routine.problemCard.check")}</button>
        )}
        {(need.kind === "problem" || need.kind === "paused") && routine && (
          <button type="button" data-outcome-open-routine="" onClick={() => actions.onOpenRoutine(routine)} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>{t("routine.problemCard.open")}</button>
        )}
      </div>
      {checked && <p role="status" className="text-[12px] leading-4 text-ink-tertiary">{t("routine.problemCard.checkStarted")}</p>}
    </div>
  );
}

export type OutcomesActions = {
  /** "Reply in chat": the bot's conversation at that run (or the bot's chat). */
  onReply: (need: OutcomeNeed) => void;
  /** A routine line: the routine's page, its runs first. */
  onOpenRoutine: (routine: Routine) => void;
  /** A run line: the run in the main chat area. */
  onOpenRun: (runId: string) => void;
  /** "Run a check": the routine once now (the chat problem card's action). Absent: not shown. */
  onCheck?: (routine: Routine) => void;
  /** Whether this viewer may run that routine now. */
  canCheck?: (routine: Routine) => boolean;
  /** No routine yet: asking the bot in chat is the way in. */
  onAsk: () => void;
  /** "New outcome": the person's words go to the bot's chat as an outcome
   * ask; the page moves to the chat. */
  onNewOutcome: (text: string) => void;
};

/** The field "New outcome" opens under the label: Enter sends, Escape puts
 * it away. */
function NewOutcomeField({ onSend, onDone }: { onSend: (text: string) => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return (
    <div data-outcomes-new-field="" className="px-2 pb-1 pt-1">
      <input
        ref={input}
        type="text"
        value={text}
        aria-label={t("outcomes.new")}
        placeholder={t("outcomes.newPlaceholder")}
        enterKeyHint="send"
        className={PLAIN_FIELD}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          const words = text.trim();
          if (!words) return;
          onSend(words);
          onDone();
        }}
      />
    </div>
  );
}

function OutcomeRow({ outcome, routines, runs, open, onToggle, actions }: {
  outcome: Outcome;
  routines: readonly Routine[];
  runs: readonly RoutineRun[];
  open: boolean;
  onToggle: () => void;
  actions: OutcomesActions;
}) {
  const own = routines.filter((routine) => outcome.routineIds.includes(routine.id));
  const panelId = `outcome-${outcome.id.replace(/[^\w-]/g, "-")}`;
  const need = outcome.needsPerson;
  return (
    <div data-outcome-row={outcome.id} data-outcome-status={outcome.status} className="flex min-w-0 flex-col">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span data-outcome-name="" className="min-w-0 truncate text-[13px] leading-[18px] text-ink"><bdi>{outcome.name}</bdi></span>
            <StatusPill outcome={outcome} />
          </span>
          <span data-outcome-line="" className="truncate text-[12px] leading-4 text-ink-tertiary">{greyLine(outcome, routines)}</span>
        </span>
        {open
          ? <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
          : <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
      </button>
      {open && (
        <div id={panelId} data-outcome-open="" className="flex min-w-0 flex-col gap-2 px-2 pb-3 pt-1">
          {need && <NeedBlock outcome={outcome} need={need} own={own} runs={runs} actions={actions} />}
          <FactRows attrs={{ "data-outcome-lines": "" }}>
            <FactRow label={t("outcomes.results")} attrs={{ "data-outcome-results": "" }}>
              <span className={cn("block min-w-0 whitespace-pre-wrap break-words", outcome.result ? "text-ink" : "text-ink-tertiary")}>
                {outcome.result ? <LinkedText text={outcome.result.text} /> : t("outcomes.noResult")}
              </span>
            </FactRow>
            <FactRow label={t("computer.tab.routines")} attrs={{ "data-outcome-routines": "" }}>
              <span className="flex min-w-0 flex-col items-start">
                {own.map((routine) => (
                  <button key={routine.id} type="button" data-outcome-routine={routine.id} onClick={() => actions.onOpenRoutine(routine)}
                    className="max-w-full break-words rounded-md text-left text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                    {[routine.name, scheduleLabelCompact(routine.schedule), onOff(routine.enabled)].join(" · ")}
                  </button>
                ))}
              </span>
            </FactRow>
          </FactRows>
          {outcome.recentRuns.length > 0 && (
            <section data-outcome-runs="" aria-label={t("outcomes.recentRuns")} className="flex min-w-0 flex-col gap-1">
              <h4 className={PANEL_LABEL}>{t("outcomes.recentRuns")}</h4>
              <div className="flex min-w-0 flex-col">
                <ShowMoreFold items={outcome.recentRuns} shown={OUTCOMES_SHOWN} toggleAttr="data-outcome-runs-fold"
                  render={(line) => <RunLine key={line.runId} line={line} run={runs.find((run) => run.id === line.runId)} withName={own.length > 1} onOpen={() => actions.onOpenRun(line.runId)} />} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** The Outcomes tab: the grey label over one card of rows. */
export function OutcomesCard({ outcomes, routines, runs, loadState, actions, defaultOpen = [] }: {
  outcomes: readonly Outcome[];
  routines: readonly Routine[];
  runs: readonly RoutineRun[];
  loadState: "loading" | "ready" | "error";
  actions: OutcomesActions;
  /** Outcomes open when the tab first shows (a link to one of them). */
  defaultOpen?: readonly string[];
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(defaultOpen));
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) => setOpened((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  let body: ReactNode;
  if (outcomes.length === 0 && loadState === "error") body = <p role="alert" className="flex min-h-[44px] items-center px-3 py-2 text-[12px] leading-4 text-danger">{t("routines.loadError")}</p>;
  else if (outcomes.length === 0 && loadState !== "ready") body = <p role="status" className="flex min-h-[44px] items-center px-3 py-2 text-[12px] leading-4 text-ink-secondary">{t("routines.loading")}</p>;
  else if (outcomes.length === 0) body = <RoutinesAskHint onAsk={actions.onAsk} />;
  else {
    body = (
      <div data-outcomes-list="" className="flex min-w-0 flex-col divide-y divide-hairline/60">
        <ShowMoreFold items={outcomes} shown={OUTCOMES_SHOWN} keep={(outcome) => Boolean(outcome.needsPerson)} toggleAttr="data-outcomes-fold"
          render={(outcome) => <OutcomeRow key={outcome.id} outcome={outcome} routines={routines} runs={runs} open={opened.has(outcome.id)} onToggle={() => toggle(outcome.id)} actions={actions} />} />
      </div>
    );
  }
  return (
    <ProfileCard title={t("botProfile.tab.outcomes")} groupId="bot-profile-outcomes"
      accessory={
        <button type="button" data-outcomes-new="" aria-expanded={adding} onClick={() => setAdding((open) => !open)} className={cn(ACTION_PILL, "ml-auto shrink-0")}>
          <Plus size={14} aria-hidden="true" />{t("outcomes.new")}
        </button>
      }>
      <div data-outcomes-card="" className="flex min-w-0 flex-col px-1">
        {adding && <NewOutcomeField onSend={actions.onNewOutcome} onDone={() => setAdding(false)} />}
        {body}
      </div>
    </ProfileCard>
  );
}
