import { RoutineCheckButton, RoutineReadinessList, useRoutineReadiness, type RoutineReadinessControl } from "./RoutineReadiness";
// A routine's page (2026-10-29), the way the Automations page and the bot
// panel open it: who runs it and what state it is in (active, paused, paused
// by itself after failures, suspended, finished, running right now), when it
// runs next and how its week went; then its runs, newest first, each one
// click away. Its configuration lives in one place, the "Edit routine"
// modal (2026-10-29): the summary up top opens it, read-only for a routine
// the person cannot change; the page keeps no second copy.
// 2026-11-03 (JC, Grok Bot): no bot chip and no state badge; the rows are
// Trigger (its value opens the trigger popover, saved on Apply), Runs as and
// Active (changed in place), then Next run and This week. "Runs (n)" has
// Clear run logs at its right. The bar is [Run now] [Edit] [Disable or
// Enable] [Delete]; Duplicate moved to Edit > Advanced, the logs are the
// Automations page's Logs.
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, CirclePlay, Eraser, ExternalLink, Loader2, Pause, Pencil, Play, Trash2, UsersRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { isRoutineProblemRun } from "@/lib/routines";
import { routineDateTime, routineNextText, routineRunAgo, routineRunDuration, routineRunLabel, routineRunPreview, routineRunTime, routineRunTone, routineState, routineWeekRunsText, type RoutineStateTone } from "@/lib/routine-display";
import { scheduleLabel } from "@/lib/schedule-label";
import { formatUsd } from "@/lib/usage";
import type { Bot, Group } from "@/state/store";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { runActivityStatus } from "./RoutineRunDetail";
import { PANEL_TEXT_ACTION, PanelRow, PanelRows, PanelToggle, PanelValue } from "./PanelRows";
import { RunAsField, useRunAsOptions } from "./RunAsField";
import { RoutineActAsField, useRoutineRoleCoverage } from "./RoutineActAsField";
import { TriggerPopover } from "./TriggerPopover";
import type { RoutineScheduleInput } from "@/lib/routines";
import { api } from "@/state/store";
import { routineScopeSearch } from "../../../shared/routine-scope";

export const STATE_TONES: Record<RoutineStateTone, string> = {
  active: "bg-success/15 text-success",
  paused: "bg-inset text-ink-secondary",
  warning: "bg-warning/15 text-warning",
  info: "bg-accent/12 text-accent-text",
  neutral: "bg-inset text-ink-secondary",
};

/** One run of the routine's history: its state, when, how long, what it
 * cost and its first line. */
export function RunHistoryRow({ run, now, onOpen }: { run: RoutineRun; now: number; onOpen: (run: RoutineRun) => void }) {
  const duration = routineRunDuration(run, now);
  const cost = run.cost != null && run.cost > 0 ? formatUsd(run.cost) : null;
  const preview = routineRunPreview(run);
  const unread = isRoutineProblemRun(run) && !run.seenAt && !run.redacted;
  return (
    <li>
      <button type="button" data-run-row={run.id} onClick={() => onOpen(run)} aria-label={t("routines.openRun", { name: run.routineName, status: routineRunLabel(run) }) + (unread ? ` · ${t("routines.unread")}` : "")} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="mt-0.5"><ActivityStatusIcon status={runActivityStatus(run)} size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
            <span data-run-row-label className={cn("font-medium", routineRunTone(run))}>{routineRunLabel(run)}</span>
            <time dateTime={new Date(run.scheduledFor).toISOString()} title={routineDateTime(run.scheduledFor)} className="text-ink-secondary">{routineRunAgo(routineRunTime(run), now)}</time>
            {duration && <span className="text-ink-secondary">· {duration}</span>}
            {cost && <span className="text-ink-secondary">· {cost}</span>}
            {run.manual && <span className="text-ink-secondary">· {t("routines.trigger.manual")}</span>}
            {unread && <span className="size-1.5 self-center rounded-full bg-danger" title={t("routines.unread")} />}
          </span>
          {preview && <span className={cn("mt-0.5 block truncate text-[12px]", run.error && run.status !== "waiting" ? "text-danger" : "text-ink-secondary")}>{preview}</span>}
        </span>
      </button>
    </li>
  );
}

/** Clear run logs of one routine (2026-11-03): asks first, then the person's
 * own saved runs of it go (DELETE /api/routine-runs?routineId=, scope mine;
 * runs in progress stay). */
export async function clearRoutineRuns(
  routine: Pick<Routine, "id" | "name">,
  confirm: (request: { title: string; body?: string; confirmLabel: string; tone: "danger" }) => Promise<boolean>,
  dispatch: (action: { type: "routineRunsRemoved"; ids: string[] }) => void,
): Promise<void> {
  if (!(await confirm({ title: t("routineDetail.clearRunsConfirm", { name: routine.name }), body: t("routineDetail.clearRunsBody"), confirmLabel: t("routines.clearLogsConfirm"), tone: "danger" }))) return;
  const { removed } = await api<{ removed?: string[] }>(`/api/routine-runs?${routineScopeSearch({ scope: "mine", routineId: routine.id })}`, { method: "DELETE" });
  dispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] });
}

export type RoutinePatch = { schedule?: RoutineScheduleInput; precheck?: Routine["precheck"] | null; runAs?: string; actAs?: string | null };

/** Who the routine runs as, changed in place (its own row since 2026-11-03;
 * the side panel's page sets it in Advanced since 2026-11-06). */
export function RoutineRunAsRow({ routine, editable, onPatch }: { routine: Routine; editable: boolean; onPatch?: (patch: RoutinePatch) => Promise<void> }) {
  const options = useRunAsOptions({ botId: routine.botId, routineId: routine.id, target: routine.target, ...(routine.target === "room-goal" && routine.groupId ? { groupId: routine.groupId } : {}) });
  const [value, setValue] = useState<string | undefined>(undefined);
  if (!options || (!options.canChoose && !options.current)) return null;
  return <RunAsField compact viewing={!editable || !onPatch} options={options} value={value} onChange={(principalId) => { setValue(principalId); void onPatch?.({ runAs: principalId }); }} />;
}

/** "Au nom de" (2026-11-05): the role its runs act as, changed in place,
 * with its coverage preview and "Tester la couverture". */
function ActAsRow({ routine, editable, onPatch, readiness }: { routine: Routine; editable: boolean; onPatch?: (patch: RoutinePatch) => Promise<void>; readiness?: RoutineReadinessControl }) {
  const coverage = useRoutineRoleCoverage({ botId: routine.botId, routineId: routine.id, enabled: routine.target !== "room-goal" && !routine.redacted });
  const [value, setValue] = useState<string | undefined>(undefined);
  if (routine.target === "room-goal") return null;
  const change = editable && onPatch ? (slug: string) => { setValue(slug); void onPatch({ actAs: slug }); } : undefined;
  return <RoutineActAsField coverage={coverage} value={value ?? routine.actAs} onChange={change} viewing={!change} savedOnly={routine.actAs} readiness={readiness} testResult={false} />;
}

/** The Trigger row: its sentence, a button that opens the trigger popover. */
function TriggerRow({ routine, bot, editable, onPatch }: { routine: Routine; bot?: Bot; editable: boolean; onPatch?: (patch: RoutinePatch) => Promise<void> }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const watch = routine.precheck?.kind === "watch" && <span className="shrink-0 rounded-md bg-inset px-1.5 text-[11px] leading-[18px] text-ink-secondary">{t("routineWatch.badge")}</span>;
  return <PanelRow data-routine-trigger-row="" label={t("routineDetail.trigger")}>
    {editable && onPatch
      ? <button ref={anchor} type="button" data-routine-trigger aria-haspopup="dialog" aria-expanded={open} title={t("routineTrigger.change")} onClick={() => setOpen((value) => !value)}
        className="-mr-1.5 inline-flex min-w-0 items-center gap-1 rounded-xl px-1.5 py-0.5 text-right text-[13px] leading-5 text-ink hover:bg-hover aria-expanded:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span data-routine-trigger-value title={scheduleLabel(routine.schedule)} className="min-w-0 whitespace-normal text-right [overflow-wrap:anywhere]">{scheduleLabel(routine.schedule)}</span>{watch}<ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
      </button>
      : <span data-routine-trigger className="flex min-w-0 items-center gap-1.5"><span data-routine-trigger-value title={scheduleLabel(routine.schedule)} className="min-w-0 text-right text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">{scheduleLabel(routine.schedule)}</span>{watch}</span>}
    {open && onPatch && <TriggerPopover routine={routine} bot={bot} anchorRef={anchor} onApply={onPatch} onClose={() => setOpen(false)} />}
  </PanelRow>;
}

/** The routine's state rows (2026-11-06, one pane): Runs as, Au nom de,
 * Active, Next run, This week, Skipped while busy, the away skips, then the
 * notes under them (auto-paused, deleted when finished, the check's
 * answer). The Automations page puts its Trigger row first (`leading`); the
 * panel's single pane sets the trigger in its own When to run. */
export function RoutineStatusRows({ routine, runs, now = Date.now(), editable = true, working = false, error, canRun = false, readiness, onToggle, onPatch, leading, runAs = true, active = true, week = true }: {
  routine: Routine;
  runs: RoutineRun[];
  now?: number;
  editable?: boolean;
  working?: boolean;
  error?: string;
  canRun?: boolean;
  readiness: RoutineReadinessControl;
  onToggle?: () => void;
  onPatch?: (patch: RoutinePatch) => Promise<void>;
  leading?: ReactNode;
  /** The Runs as row (the side panel's page sets it in Advanced). */
  runAs?: boolean;
  /** The Active toggle (the side panel's page has Pause in its bar and the
   * state as a badge by the title). */
  active?: boolean;
  /** The This week row. */
  week?: boolean;
}) {
  const state = routineState(routine, runs);
  const skips = routine.awaySkips && !routine.awaySkips.reportedAt ? routine.awaySkips.count : 0;
  return <>
    <PanelRows data-routine-summary="">
      {leading}
      {runAs && <RoutineRunAsRow routine={routine} editable={editable} onPatch={onPatch} />}
      <ActAsRow routine={routine} editable={editable} onPatch={onPatch} {...(canRun ? { readiness } : {})} />
      {active && <PanelToggle data-routine-active="" label={t("routineDetail.active")} hint={state.tone === "info" ? state.label : state.tone === "warning" ? state.label : undefined} viewing={!editable || !onToggle} checked={routine.enabled} disabled={working} onChange={() => onToggle?.()} />}
      <PanelRow label={t("routineDetail.nextRun")}><PanelValue><span data-routine-next>{routineNextText(routine, now)}</span></PanelValue></PanelRow>
      {week && routine.weekRuns && <PanelRow label={t("routineDetail.week")}><PanelValue><span data-routine-week-runs>{routineWeekRunsText(routine.weekRuns)}</span></PanelValue></PanelRow>}
      {(routine.skippedRuns ?? 0) > 0 && <PanelRow label={t("routineDetail.skipped")}><PanelValue>{routine.skippedRuns}{routine.lastSkippedAt ? ` · ${t("routines.lastSkipped", { date: routineDateTime(routine.lastSkippedAt) })}` : ""}</PanelValue></PanelRow>}
      {skips > 0 && <PanelRow label={t("routines.away.title")}><PanelValue>{t(skips === 1 ? "routines.away.skippedOne" : "routines.away.skippedMany", { count: skips, name: routine.name })}</PanelValue></PanelRow>}
    </PanelRows>
    {routine.autoPaused && !routine.enabled && <p data-routine-auto-paused={routine.autoPaused.failures} className="text-[11.5px] text-warning">{t("routineDetail.autoPausedAt", { date: routineDateTime(routine.autoPaused.at) })}</p>}
    {routine.deleteWhenFinished && <p data-routine-delete-when-finished="" className="text-[11.5px] text-ink-secondary">{t("routines.deleteWhenFinished.willDelete")}</p>}
    {error && <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] text-danger">{error}</div>}
    {readiness.checking && <p role="status" className="text-[12px] text-ink-secondary">{t("routineReadiness.checking")}</p>}
    {readiness.error && <p role="alert" className="text-[12px] text-danger">{readiness.error}</p>}
    {readiness.answer && <RoutineReadinessList checks={readiness.answer.checks} checkedAt={readiness.answer.checkedAt} />}
  </>;
}

/** The routine's state when it needs a look (2026-11-06, JC: the panel's
 * Active toggle is gone, Pause is in the bar): failing, paused by itself,
 * suspended, running. Nothing when all is well, paused or finished. */
export function RoutineStateBadge({ routine, runs }: { routine: Routine; runs: RoutineRun[] }) {
  const state = routineState(routine, runs);
  if (state.tone !== "warning" && state.tone !== "info") return null;
  return <span data-routine-state-badge={state.tone} title={state.label} className={cn("inline-flex min-w-0 max-w-[45%] shrink items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium", STATE_TONES[state.tone])}>
    <span className="truncate">{state.label}</span>
  </span>;
}

/** "Runs (n)", Clear run logs at its right, then the runs, newest first. */
/** Runs listed before Show more (2026-11-09). */
export const RUNS_SHOWN = 3;

export function RoutineRunsSection({ routine, runs, now = Date.now(), onOpenRun, onClearRuns }: {
  routine: Routine;
  runs: RoutineRun[];
  now?: number;
  onOpenRun: (run: RoutineRun) => void;
  onClearRuns?: () => void;
}) {
  const history = [...runs].filter((run) => run.routineId === routine.id).sort((a, b) => routineRunTime(b) - routineRunTime(a));
  // 2026-11-09 : the last 3 runs, then Show more for the others.
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? history : history.slice(0, RUNS_SHOWN);
  return <section data-routine-runs="" className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-2 px-1">
      <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">{t("routineDetail.runs")}{history.length > 0 && <span className="rounded-full bg-raised px-1.5 text-[10.5px]">{history.length}</span>}</h3>
      {onClearRuns && history.length > 0 && <button type="button" data-routine-clear-runs onClick={onClearRuns} aria-label={t("routineDetail.clearRuns")} title={t("routineDetail.clearRuns")} className="flex size-7 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><Eraser size={14} aria-hidden="true" /></button>}
    </div>
    {history.length === 0
      ? <p className="rounded-xl border border-dashed border-hairline/50 p-5 text-center text-[12.5px] text-ink-secondary">{t("routines.drawer.noRuns")}</p>
      : <ol data-routine-history aria-label={t("routineDetail.runs")} className="flex flex-col gap-0.5">{shown.map((run) => <RunHistoryRow key={run.id} run={run} now={now} onOpen={onOpenRun} />)}</ol>}
    {history.length > RUNS_SHOWN && <button type="button" data-routine-runs-more aria-expanded={showAll} onClick={() => setShowAll((value) => !value)} className={cn(PANEL_TEXT_ACTION, "ml-0.5")}>{showAll ? t("routineEditor.showLess") : t("routineEditor.showMore")}</button>}
  </section>;
}

export function RoutineDetail({ routine, runs, bots, groups = [], now = Date.now(), compact = false, editable = true, canRun = false, inFlight = false, starting = false, working = false, error, onOpenRun, onRunNow, onToggle, onEdit, onDelete, onOpenGroup, onPatch, onClearRuns, actions = true, readiness: externalReadiness }: {
  routine: Routine;
  /** Every run kept for this routine, any order. */
  runs: RoutineRun[];
  bots: Bot[];
  groups?: Group[];
  viewerPrincipalId?: string | null;
  now?: number;
  /** The bot panel: one column, the panel's own action bar. */
  compact?: boolean;
  editable?: boolean;
  canRun?: boolean;
  inFlight?: boolean;
  starting?: boolean;
  working?: boolean;
  error?: string;
  onOpenRun: (run: RoutineRun) => void;
  onRunNow?: () => void;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** A team goal: its group. */
  onOpenGroup?: () => void;
  /** Saves a change made in place (the trigger popover, Runs as). */
  onPatch?: (patch: RoutinePatch) => Promise<void>;
  /** Clear run logs at the right of "Runs (n)" (asks first, the caller's confirm). */
  onClearRuns?: () => void;
  /** Draw the action row (the bot panel draws its own bar). */
  actions?: boolean;
  readiness?: RoutineReadinessControl;
}) {
  const ownReadiness = useRoutineReadiness(routine.id);
  const readiness = externalReadiness ?? ownReadiness;
  const bot = bots.find((candidate) => candidate.id === routine.botId);
  const isRoomGoal = routine.target === "room-goal";
  const group = groups.find((candidate) => candidate.id === routine.groupId);
  return (
    <div data-routine-detail className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <header className={cn("space-y-2.5 px-4 pt-3 sm:px-5", compact && "px-4")}>
          {(isRoomGoal || routine.canEdit === false) && <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-secondary">
            {isRoomGoal && <span className="inline-flex items-center gap-1"><UsersRound size={13} aria-hidden="true" />{group?.name ?? t("routineCalendar.groupUnavailable")}</span>}
            {routine.canEdit === false && <span>{t("routines.scope.readOnly")}</span>}
          </div>}
          <RoutineStatusRows routine={routine} runs={runs} now={now} editable={editable} working={working} error={error} canRun={canRun} readiness={readiness} onToggle={onToggle} onPatch={onPatch}
            leading={<TriggerRow routine={routine} bot={bot} editable={editable} onPatch={onPatch} />} />
        </header>
        <div className={cn("px-3 pb-4 pt-3 sm:px-4", compact && "px-2")}>
          <RoutineRunsSection routine={routine} runs={runs} now={now} onOpenRun={onOpenRun} onClearRuns={onClearRuns} />
        </div>
      </div>
      {actions && (
        <div data-routine-actions className="flex flex-wrap items-center gap-2 border-t border-hairline/40 px-4 py-3">
          {canRun && onRunNow && <button type="button" data-run-now onClick={onRunNow} disabled={working || inFlight} title={inFlight ? t("routines.runNow.inFlight") : t("routines.runNow")} className={cn(PRIMARY_PILL, "gap-1.5")}>{starting ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play size={13} fill="currentColor" aria-hidden="true" />}{starting ? t("routines.runNow.starting") : t("routines.runNow")}</button>}
          {canRun && <RoutineCheckButton control={readiness} disabled={working} />}
          {editable && onEdit && <button type="button" data-routine-edit onClick={onEdit} title={t("routines.edit")} className={cn(PILL, "gap-1.5")}><Pencil size={13} aria-hidden="true" />{t("routines.edit")}</button>}
          {editable && onToggle && <button type="button" data-routine-toggle onClick={onToggle} disabled={working} title={routine.enabled ? t("routines.disable") : t("routines.enable")} className={cn(PILL, "gap-1.5")}>{routine.enabled ? <Pause size={13} aria-hidden="true" /> : <CirclePlay size={13} aria-hidden="true" />}{routine.enabled ? t("routines.disable") : t("routines.enable")}</button>}
          {isRoomGoal && onOpenGroup && <button type="button" onClick={onOpenGroup} title={t("routineCalendar.openGroup")} className={cn(PILL, "gap-1.5")}><ExternalLink size={13} aria-hidden="true" />{t("routineCalendar.openGroup")}</button>}
          {editable && onDelete && <button type="button" data-routine-delete onClick={onDelete} aria-label={t("common.delete")} title={t("common.delete")} className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline/50 text-ink-secondary hover:border-danger/40 hover:bg-danger/10 hover:text-danger"><Trash2 size={15} strokeWidth={1.75} aria-hidden="true" /></button>}
        </div>
      )}
    </div>
  );
}
