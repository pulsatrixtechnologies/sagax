// The bot page's Outcomes tab (#4098, first lot): each result the person
// wants kept true, read from the routines that exist today
// (shared/outcomes.ts). A routine is an outcome of its own, named by its
// goal when it has one. A row opens in place: what needs the person (a
// pointer to the chat, where the answer is given; nothing is answered
// here), then Results, Routines and Recent runs. No new state: the chat's
// card says the question, the routine's page its settings, the run window
// its run; this tab only reads them and points there.
// Look: docs/design/ux-reference-grokbot-cursor.md, 2.4 ter.
import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Flag, Minus } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Routine, RoutineRun } from "@/lib/routines";
import { scheduleLabelCompact, shortDate } from "@/lib/schedule-label";
import { routineAutoPausedText, routineRunAgo, routineRunLabel } from "@/lib/routine-display";
import { outcomesOf, type Outcome, type OutcomeNeed, type OutcomeRunLine } from "../../../../shared/outcomes";
import { ASK_CHIP, ASK_CHIP_IDLE, AskCard } from "../../AskCard";
import { ShowMoreFold } from "../../ShowMoreFold";
import { ActivityStatusIcon } from "../../bot-settings/ActivityCard";
import { RoutinesAskHint } from "../../bot-settings/RoutinesSection";
import { PanelRow, PanelRows, onOff } from "../../routines/PanelRows";
import { runActivityStatus } from "../../routines/RoutineRunDetail";
import { ProfileCard } from "./cards";

/** Outcomes, then runs, shown before the fold (the reference: five). */
export const OUTCOMES_SHOWN = 5;

/** The bot's outcomes from the routines and runs this viewer has. */
export function useOutcomes(routines: readonly Routine[], runs: readonly RoutineRun[]): Outcome[] {
  return useMemo(() => outcomesOf(routines, runs), [routines, runs]);
}

/** The sentence that needs the person: the bot's own words, else the
 * app's words for that kind. */
export function needSentence(need: OutcomeNeed): string {
  if (need.text.trim()) return need.text.trim();
  switch (need.kind) {
    case "paused": return routineAutoPausedText(need.failures ?? 1);
    case "problem": return t("outcomes.needs.problem");
    case "goal": return need.goal === "stalled" ? t("outcomes.needs.goalStalled", { count: need.checks ?? 3 }) : t("outcomes.needs.goalExpired");
    default: return t("outcomes.needs.question");
  }
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

function RunLine({ line, run, onOpen }: { line: OutcomeRunLine; run: RoutineRun | undefined; onOpen: () => void }) {
  const word = line.word === "done" ? t("routineRun.card.done")
    : line.word === "nothing" ? t("routines.status.nothing_to_report")
      : run ? routineRunLabel(run) : t(`routines.status.${line.status}`);
  return (
    <button type="button" data-outcome-run={line.runId} data-outcome-run-word={line.word} onClick={onOpen}
      className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] leading-[18px] hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      {line.word === "nothing"
        ? <Minus size={14} strokeWidth={1.9} aria-hidden="true" data-activity-icon="nothing" className="shrink-0 text-ink-tertiary" />
        : <ActivityStatusIcon status={runActivityStatus({ status: line.status })} size={14} />}
      <span className="min-w-0 flex-1 truncate text-ink">{line.name}</span>
      <span className="shrink-0 text-ink-secondary">{word}</span>
      <span className="shrink-0 tabular-nums text-ink-tertiary">{routineRunAgo(line.at)}</span>
    </button>
  );
}

export type OutcomesActions = {
  /** "Reply in chat": the bot's conversation at that run (or the bot's chat). */
  onReply: (need: OutcomeNeed) => void;
  /** A routine line: the routine's page, its runs first. */
  onOpenRoutine: (routine: Routine) => void;
  /** A run line: the run in the main chat area. */
  onOpenRun: (runId: string) => void;
  /** No routine yet: asking the bot in chat is the way in. */
  onAsk: () => void;
};

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
        <div id={panelId} data-outcome-open="" className="flex min-w-0 flex-col gap-2 px-2 pb-2 pt-1">
          {need && (
            <AskCard plain title={needSentence(need)} ariaLabel={t("botTasks.waiting")}>
              <div className="flex min-w-0 items-center gap-2">
                <span data-outcome-needs="" className="inline-flex min-w-0 flex-1 items-center gap-1 text-[12px] leading-4 text-warning"><Flag size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />{t("botTasks.waiting")}</span>
                <button type="button" data-outcome-reply="" onClick={() => actions.onReply(need)} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>{t("outcomes.replyInChat")}</button>
              </div>
            </AskCard>
          )}
          <PanelRows data-outcome-lines="">
            <PanelRow label={t("outcomes.results")} data-outcome-results="">
              <span className={cn("min-w-0 text-right", outcome.result ? "text-ink" : "text-ink-tertiary")}>{outcome.result?.text ?? t("outcomes.noResult")}</span>
            </PanelRow>
            <PanelRow label={t("computer.tab.routines")} data-outcome-routines="">
              <span className="flex min-w-0 flex-col items-end">
                {own.map((routine) => (
                  <button key={routine.id} type="button" data-outcome-routine={routine.id} onClick={() => actions.onOpenRoutine(routine)}
                    className="max-w-full rounded-md px-1 text-right text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                    {[routine.name, scheduleLabelCompact(routine.schedule), onOff(routine.enabled)].join(" · ")}
                  </button>
                ))}
              </span>
            </PanelRow>
            {outcome.recentRuns.length > 0 && (
              <PanelRow label={t("outcomes.recentRuns")} data-outcome-runs=""
                below={
                  <div className="flex min-w-0 flex-col">
                    <ShowMoreFold items={outcome.recentRuns} shown={OUTCOMES_SHOWN} toggleAttr="data-outcome-runs-fold"
                      render={(line) => <RunLine key={line.runId} line={line} run={runs.find((run) => run.id === line.runId)} onOpen={() => actions.onOpenRun(line.runId)} />} />
                  </div>
                } />
            )}
          </PanelRows>
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
      <div data-outcomes-list="" className="flex min-w-0 flex-col">
        <ShowMoreFold items={outcomes} shown={OUTCOMES_SHOWN} keep={(outcome) => Boolean(outcome.needsPerson)} toggleAttr="data-outcomes-fold"
          render={(outcome) => <OutcomeRow key={outcome.id} outcome={outcome} routines={routines} runs={runs} open={opened.has(outcome.id)} onToggle={() => toggle(outcome.id)} actions={actions} />} />
      </div>
    );
  }
  return (
    <ProfileCard title={t("botProfile.tab.outcomes")} groupId="bot-profile-outcomes">
      <div data-outcomes-card="" className="flex min-w-0 flex-col px-1">{body}</div>
    </ProfileCard>
  );
}
