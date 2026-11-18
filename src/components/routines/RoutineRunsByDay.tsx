import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Circle, Eraser, Loader2, X } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { historySteps, historySummary, runOutcome } from "@/lib/routine-history";
import { routineRunDuration, routineRunLabel, routineRunTime, routineRunTone } from "@/lib/routine-display";
import { isRoutineProblemRun, type Routine, type RoutineRun } from "@/lib/routines";
import { dayLabel, localDay } from "@/lib/transcript-derivations";
import { useRunActivity } from "./RunActivityState";
import { PANEL_TEXT_ACTION } from "./PanelRows";

const live = (run: RoutineRun) => ["running", "waiting", "queued"].includes(run.status);
const tone = (run: RoutineRun) => run.completionNotes ? "text-warning" : live(run) ? "text-accent-text" : routineRunTone(run);
const heading = "text-[13px] font-semibold leading-[18px] text-ink";
const focus = "focus-visible:outline-2 focus-visible:outline-accent";

let clockFormat: { locale: string; format: Intl.DateTimeFormat } | undefined;
function clock(at: number) {
  const locale = activeLocale();
  if (clockFormat?.locale !== locale) clockFormat = { locale, format: new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : locale, { hour: "numeric", minute: "2-digit" }) };
  return clockFormat.format.format(at);
}

function ActiveRun({ run, now, open }: { run: RoutineRun; now: number; open: () => void }) {
  const { detail } = useRunActivity(run);
  const steps = historySteps(detail?.steps ?? []);
  return <section className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5">
    <header className="flex items-center justify-between text-[11px] font-medium text-accent-text">
      <h4 className="uppercase tracking-wide">{routineRunLabel(run)}</h4>
      <span>{routineRunDuration(run, now)}</span>
    </header>
    <button type="button" onClick={open} className={`flex items-center gap-2 rounded text-[13px] font-medium ${focus}`}>
      <Loader2 size={14} className="animate-spin text-accent-text motion-reduce:animate-none" />
      {t("runHistory.runAt", { time: clock(routineRunTime(run)) })}
    </button>
    {steps.length > 0 && <ul aria-label={t("botPanel.activity.steps")} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-3 gap-y-1.5 text-xs text-ink-secondary">
      {steps.map(step => {
        const Icon = step.phase === "done" ? Check : step.phase === "failed" ? X : step.phase === "pending" ? Circle : Loader2;
        return <li key={step.id} className="flex items-start gap-1.5"><Icon size={13} aria-label={t(step.phase === "done" ? "routines.status.completed" : step.phase === "failed" ? "routines.status.failed" : step.phase === "pending" ? "routines.status.queued" : "routines.status.running")} className={`mt-px shrink-0 ${step.phase === "done" ? "text-success" : step.phase === "failed" ? "text-danger" : step.phase === "pending" ? "text-ink-tertiary" : "animate-spin text-accent-text motion-reduce:animate-none"}`} />{step.label}{step.count > 1 && ` ×${step.count}`}</li>;
      })}
    </ul>}
  </section>;
}

function RunStrip({ runs, now, onOpenRun }: { runs: RoutineRun[]; now: number; onOpenRun: (run: RoutineRun) => void }) {
  const [focused, setFocused] = useState(0);
  const chronological = runs.slice().reverse();
  const durations = chronological.map(run => Math.max(0, (run.finishedAt ?? (live(run) ? now : routineRunTime(run))) - (run.startedAt ?? routineRunTime(run))));
  // Sub-minute checks stay small even on a day made entirely of checks.
  const max = durations.reduce((a, b) => Math.max(a, b), 60_000);
  const ticks = Math.min(5, runs.length);
  return <div className="overflow-x-auto">
    <div style={{ minWidth: runs.length * 3 }}>
      <div className="flex h-10 items-end border-b border-hairline/50">
        {chronological.map((run, i) => {
          const summary = historySummary(run);
          const label = [clock(routineRunTime(run)), routineRunLabel(run), summary, routineRunDuration(run, now)].filter((v, j, all) => v && all.indexOf(v) === j).join(" · ");
          return <button key={run.id} type="button" data-run-tick={run.id} title={label} aria-label={label} tabIndex={i === Math.min(focused, runs.length - 1) ? 0 : -1}
            onFocus={() => setFocused(i)} onKeyDown={event => {
              const positions = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: runs.length - 1 };
              if (!Object.hasOwn(positions, event.key)) return;
              event.preventDefault();
              const next = Math.max(0, Math.min(runs.length - 1, positions[event.key as keyof typeof positions]));
              const target = event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined;
              target?.focus();
            }} onClick={() => onOpenRun(run)} className={`flex h-full min-w-0 flex-1 items-end justify-center rounded-sm hover:bg-hover focus-visible:bg-hover ${focus} ${tone(run)}`}>
            <span className="w-[65%] max-w-2 rounded-t-sm bg-current" style={{ height: 3 + 32 * durations[i]! / max }} />
          </button>;
        })}
      </div>
      <div aria-hidden="true" className="flex justify-between pt-1 text-[10px] tabular-nums text-ink-tertiary">
        {Array.from({ length: ticks }, (_, i) => <span key={i}>{clock(routineRunTime(chronological[Math.round(i * (runs.length - 1) / Math.max(1, ticks - 1))]!))}</span>)}
      </div>
    </div>
  </div>;
}

export function RoutineRunsByDay({ routine, runs, now: fixedNow, onOpenRun, onClearRuns, retry }: {
  routine: Routine; runs: RoutineRun[]; now?: number; onOpenRun: (run: RoutineRun, group?: RoutineRun[]) => void;
  onClearRuns?: () => void; retry?: ReactNode;
}) {
  const [time, setTime] = useState(Date.now);
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const id = window.setInterval(() => setTime(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [fixedNow]);
  const now = fixedNow ?? time;
  const days = new Map<number, RoutineRun[]>();
  for (const run of runs.filter(run => run.routineId === routine.id).sort((a, b) => routineRunTime(b) - routineRunTime(a))) {
    const day = localDay(routineRunTime(run));
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(run);
  }
  if (!days.size) return <p data-routine-runs="" className="py-5 text-center text-[13px] text-ink-secondary">{t("routines.drawer.noRuns")}</p>;
  return <section data-routine-runs="" aria-label={t("routineDetail.runs")} className="min-w-0 space-y-6">
    {Array.from(days, ([day, history], index) => {
      const finished = history.filter(run => !live(run));
      const ok = finished.filter(run => ["completed", "nothing_to_report"].includes(run.status) && !isRoutineProblemRun(run) && !run.completionNotes);
      const rate = new Intl.NumberFormat(activeLocale(), { style: "percent" }).format(ok.length / (finished.length || 1));
      const review = new Map<string, RoutineRun[]>();
      for (const run of history) {
        if (run.seenAt || run.redacted || !(isRoutineProblemRun(run) || run.completionNotes)) continue;
        const cause = [run.status, run.completionNotes ?? run.problems ?? run.error ?? run.attention ?? run.id].join(" ");
        if (!review.has(cause)) review.set(cause, []);
        review.get(cause)!.push(run);
      }
      const results = history.map(run => ({ run, chips: runOutcome(run) })).filter(row => row.chips.length);
      return <section key={day} data-routine-runs-day={day} className="space-y-4 border-t border-hairline/40 pt-4 first:border-0 first:pt-0">
        <div><header className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <h3 className={heading}>{dayLabel(routineRunTime(history[0]!), localDay(now))}</h3>
          <span>· {t(history.length === 1 ? "runHistory.countOne" : "runHistory.count", { count: history.length })}</span>
          {finished.length > 0 && <span>· {t("runHistory.rate", { rate })}</span>}
          {index === 0 && onClearRuns && <button type="button" data-routine-clear-runs="" onClick={onClearRuns} title={t("routineDetail.clearRuns")} aria-label={t("routineDetail.clearRuns")} className={`ml-auto rounded p-1 text-ink-tertiary hover:bg-hover ${focus}`}><Eraser size={14} /></button>}
        </header><RunStrip runs={history} now={now} onOpenRun={onOpenRun} /></div>
        {history.filter(live).map(run => <ActiveRun key={run.id} run={run} now={now} open={() => onOpenRun(run)} />)}
        {review.size > 0 && <section><h4 className={heading}>{t("runHistory.review", { count: review.size })}</h4>
          <ul className="divide-y divide-hairline/30">{Array.from(review, ([cause, group]) => {
            const run = group[0]!;
            const failed = run.status === "failed" || run.status === "missed";
            const Icon = failed ? X : AlertTriangle;
            return <li key={cause} className="flex items-start gap-2 py-2">
              <Icon size={14} className={`mt-0.5 shrink-0 ${tone(run)}`} aria-label={routineRunLabel(run)} />
              <div className="min-w-0 flex-1 text-[13px] leading-[18px]"><time className="mr-2 text-xs tabular-nums text-ink-secondary">{clock(routineRunTime(run))}</time>{historySummary(run)}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                  {group.length > 1 && <span className="text-ink-secondary">{day === localDay(now) ? t("runHistory.repeat", { count: group.length }) : `×${group.length}`}</span>}
                  <button type="button" className={PANEL_TEXT_ACTION} onClick={() => onOpenRun(run, group)}>{t("runHistory.view")}</button>
                  {failed && retry}
                </div>
              </div>
            </li>;
          })}</ul></section>}
        {results.length > 0 && <section><h4 className={heading}>{t("routinePage.group.results")}</h4>
          <ul className="divide-y divide-hairline/30">{results.map(({ run, chips }) => <li key={run.id}>
            <button type="button" data-run-result={run.id} onClick={() => onOpenRun(run)} className={`flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded py-2 text-left text-[13px] leading-[18px] hover:bg-hover ${focus}`}>
              <span className="text-xs tabular-nums text-ink-secondary">{[clock(routineRunTime(run)), routineRunDuration(run, now)].filter(Boolean).join(" · ")}</span>
              {chips.map((chip, i) => <span key={i} className={chips.length > 1 ? "rounded-md bg-inset px-1.5 text-xs leading-5" : "min-w-0"}>{chip}</span>)}
            </button>
          </li>)}</ul></section>}
      </section>;
    })}
  </section>;
}
