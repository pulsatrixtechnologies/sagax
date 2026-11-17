// The Routines page's Overview tab (2026-11-17), as the reference's Cloud
// Agents page: a Runs section (period, three figure cards) and a Routines
// section (search, filters and New on the heading row, a plain table). The
// figures come from runFigures (src/lib/routine-figures.ts) over the runs the
// app already holds; the rows from routineTableRows (src/lib/routine-table.ts).
import { useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal, Repeat2 } from "lucide-react";
import { StatCard } from "@/components/code/StatCard";
import { PageHeading, PageSearch } from "@/components/content-page";
import { PillSelect } from "@/components/SettingsPrimitives";
import { ActivityStatusIcon } from "@/components/bot-settings/ActivityCard";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineNextText, routineRunAgo, routineRunDuration, routineRunLabel, routineRunTime, routineRunTone, routineState } from "@/lib/routine-display";
import { RUNS_PERIODS, RUNS_PERIOD_MS, runFigures, runsInPeriod, type RunsPeriod } from "@/lib/routine-figures";
import { routineTableRows, type RoutineTableRow } from "@/lib/routine-table";
import { useRoutineRunsFrom } from "@/state/older-routine-runs";
import type { Bot } from "@/state/store";
import { RoutineNameInput } from "./RoutineRowMenu";
import { RoutineOwnerBadge } from "./RoutineScopeBar";

type RowMenu = (routine: Routine, at: { x: number; y: number }, trigger: HTMLElement) => void;

const COLUMNS = "grid-cols-[minmax(0,1fr)_auto_28px] gap-x-3 @[46rem]/routines:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,2fr)_minmax(0,1.4fr)_28px]";
const HEAD_CELL = "text-[12px] leading-4 text-ink-secondary";

/** Runs: the period, then total, success rate and the succeeded-of-total bar. */
function RunsSection({ runs, now, onFailedRuns }: { runs: readonly RoutineRun[]; now: number; onFailedRuns: () => void }) {
  const [period, setPeriod] = useState<RunsPeriod>("week");
  // The app holds two weeks; a longer period loads the older runs it shows.
  useRoutineRunsFrom(now - RUNS_PERIOD_MS[period]);
  const figures = useMemo(() => runFigures(runsInPeriod(runs, period, now)), [runs, period, now]);
  const failedShare = figures.total ? (figures.failed / figures.total) * 100 : 0;
  return <section aria-label={t("routinesOverview.runs")} data-routines-runs="" className="space-y-3">
    <PageHeading title={t("routinesOverview.runs")}>
      <PillSelect<RunsPeriod> ariaLabel={t("routinesOverview.period")} value={period} onChange={setPeriod} bordered
        options={RUNS_PERIODS.map((value) => ({ value, label: t(`routinesOverview.period.${value}`) }))} />
    </PageHeading>
    <div className="grid grid-cols-2 gap-3 @[46rem]/routines:grid-cols-[1fr_1fr_1.7fr]">
      <StatCard testId="routines-total" label={t("routinesOverview.total")} value={figures.total} />
      <StatCard testId="routines-rate" label={t("routinesOverview.rate")} value={figures.rate === null ? "-" : `${figures.rate}%`} {...(figures.rate === null ? {} : { ring: figures.rate / 100 })} />
      <div data-testid="routines-outcome" className="flex min-w-0 flex-col gap-1 rounded-xl border border-hairline bg-card px-3.5 py-3 col-span-2 @[46rem]/routines:col-span-1">
        <span className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
          <span className="truncate">{t("routinesOverview.recent")}</span>
          {figures.failed > 0 && <button type="button" data-routines-failed-runs title={t("routineCalendar.openProblemLogs")} onClick={onFailedRuns} className="-my-1 shrink-0 rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-ink/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("routinesOverview.viewFailed")}</button>}
        </span>
        <span className="flex items-baseline gap-1.5 text-ink">
          <span className="text-[20px] font-semibold leading-7 tabular-nums">{figures.total ? (figures.succeeded === 1 ? t("routinesOverview.succeededOne") : t("routinesOverview.succeeded", { count: figures.succeeded })) : t("routinesOverview.noRuns")}</span>
          {figures.total > 0 && <span className="text-[11.5px] text-ink-tertiary">{figures.total === 1 ? t("routinesOverview.ofRun") : t("routinesOverview.ofRuns", { count: figures.total })}</span>}
        </span>
        <span role="img" aria-label={t("routinesOverview.barLabel", { succeeded: figures.succeeded, failed: figures.failed })} data-routines-bar className="mt-2 flex h-1 w-full gap-0.5 overflow-hidden rounded-full bg-control">
          {figures.total > 0 && <span className="h-full bg-success" style={{ width: `${100 - failedShare}%` }} />}
          {figures.failed > 0 && <span className="h-full bg-danger" style={{ width: `${failedShare}%` }} />}
        </span>
      </div>
    </div>
  </section>;
}

function LastRun({ row, now }: { row: RoutineTableRow; now: number }) {
  const { lastRun, liveRun } = row;
  if (liveRun) {
    const since = liveRun.startedAt || routineRunTime(liveRun);
    return <span data-routine-last-run="running" className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
      <ActivityStatusIcon status="running" size={13} /><span className="shrink-0 text-accent">{t("routines.status.running")}</span><span aria-hidden="true">·</span><span className="truncate">{routineRunAgo(since, now)}</span>
    </span>;
  }
  if (!lastRun) return <span data-routine-last-run="none" className="truncate text-[12px] leading-4 text-ink-tertiary">{t("routinesOverview.neverRan")}</span>;
  const duration = routineRunDuration(lastRun, now);
  return <span data-routine-last-run={lastRun.status} className="flex min-w-0 overflow-hidden items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
    <ActivityStatusIcon status={lastRun.status === "failed" || lastRun.status === "missed" ? "failed" : lastRun.status === "blocked" ? "blocked" : lastRun.status === "waiting" ? "waiting" : lastRun.status === "cancelled" ? "stopped" : "finished"} size={13} />
    <span className={cn("min-w-0 truncate", routineRunTone(lastRun))}>{routineRunLabel(lastRun)}</span>
    <span aria-hidden="true" className="shrink-0">·</span><span className="shrink-0">{routineRunAgo(routineRunTime(lastRun), now)}</span>
    {duration && <span className="hidden min-w-0 truncate @[56rem]/routines:inline"><span aria-hidden="true">· </span>{duration}</span>}
  </span>;
}

function NextRun({ routine }: { routine: Routine }) {
  const state = routineState(routine);
  if (!routine.enabled || routine.suspended) {
    return <span data-routine-state={state.tone} title={state.label} className={cn("block w-fit max-w-full truncate rounded-md px-1.5 text-[12px] leading-[18px]", state.tone === "warning" ? "bg-warning/15 text-warning" : "bg-inset text-ink-secondary")}>{state.label}</span>;
  }
  return <span data-routine-next className="block truncate text-[12px] leading-4 text-ink-secondary">{routineNextText(routine)}</span>;
}

function Row({ row, now, viewerPrincipalId, onOpen, onRowMenu, renaming, onRenameSave, onRenameCancel }: {
  row: RoutineTableRow; now: number; viewerPrincipalId?: string | null; onOpen: (routine: Routine) => void; onRowMenu?: RowMenu;
  renaming: boolean; onRenameSave?: (routine: Routine, name: string) => void; onRenameCancel?: () => void;
}) {
  const { routine } = row;
  const readOnly = routine.canEdit === false;
  const otherOwner = routine.owner?.id && routine.owner.id.toLowerCase() !== viewerPrincipalId?.toLowerCase() ? routine.owner : null;
  const openMenu = (trigger: HTMLElement, at?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    onRowMenu?.(routine, at ?? { x: rect.left, y: rect.bottom + 4 }, trigger);
  };
  return <div role="row" data-routine-row data-routine-id={routine.id} data-routine-enabled={routine.enabled ? "" : undefined}
    onContextMenu={onRowMenu && !readOnly ? (event) => { event.preventDefault(); openMenu(event.currentTarget, { x: event.clientX, y: event.clientY }); } : undefined}
    className={cn("relative grid items-center border-b border-hairline/40 py-2.5 last:border-b-0 hover:bg-hover", COLUMNS)}>
    <div role="cell" className="flex min-w-0 flex-col gap-0.5">
      {renaming && onRenameSave ? <RoutineNameInput initial={routine.name} onSave={(name) => onRenameSave(routine, name)} onCancel={() => onRenameCancel?.()} /> : <>
        <span className="flex min-w-0 items-center gap-2">
          <button type="button" data-routine-title onClick={() => onOpen(routine)} className="min-w-0 truncate text-left text-[13px] font-medium leading-[18px] text-ink after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent/60">{routine.name}</button>
          {otherOwner && <RoutineOwnerBadge owner={otherOwner} size={14} className="relative max-w-[40%] shrink-0 rounded-md bg-inset px-1.5 text-[12px] leading-[18px] text-ink-secondary" />}
        </span>
        <span data-routine-folded className="truncate text-[12px] leading-4 text-ink-secondary @[46rem]/routines:hidden">{[row.botName, row.paused ? routineState(routine).label : row.when].filter(Boolean).join(" · ")}</span>
      </>}
    </div>
    <div role="cell" data-routine-bot className="hidden min-w-0 truncate text-[12px] leading-4 text-ink-secondary @[46rem]/routines:block">{row.botName}</div>
    <div role="cell" data-routine-when title={row.when} className="hidden min-w-0 truncate text-[12px] leading-4 text-ink-secondary @[46rem]/routines:block">{row.when}</div>
    <div role="cell" className="min-w-0 justify-self-end @[46rem]/routines:justify-self-stretch @[46rem]/routines:overflow-hidden"><LastRun row={row} now={now} /></div>
    <div role="cell" className="hidden min-w-0 @[46rem]/routines:block"><NextRun routine={routine} /></div>
    <div role="cell" className="flex justify-end">
      {onRowMenu && !readOnly && <button type="button" data-routine-row-menu aria-label={t("routineFolders.rowMenu", { name: routine.name })} title={t("routineFolders.rowMenu", { name: routine.name })}
        onClick={(event) => openMenu(event.currentTarget)}
        className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><MoreHorizontal size={16} aria-hidden="true" /></button>}
    </div>
  </div>;
}

export function RoutinesOverview({ routines, runs, bots, viewerPrincipalId, loading, error, filtersMenu, newMenu, grouped, now = Date.now(), onOpen, onRowMenu, renamingId, onRenameSave, onRenameCancel, onFailedRuns }: {
  /** The routines in the page's scope and bot filter. */
  routines: readonly Routine[];
  /** The runs in the same scope: the figures read them. */
  runs: readonly RoutineRun[];
  bots: readonly Bot[];
  viewerPrincipalId?: string | null;
  loading?: boolean;
  error?: boolean;
  /** The page's Filters button and the New menu, drawn on the heading row. */
  filtersMenu: ReactNode;
  newMenu: ReactNode;
  /** Group by Bot or Folder: the grouped cards in place of the table. */
  grouped?: ReactNode;
  now?: number;
  onOpen: (routine: Routine) => void;
  onRowMenu?: RowMenu;
  renamingId?: string | null;
  onRenameSave?: (routine: Routine, name: string) => void;
  onRenameCancel?: () => void;
  onFailedRuns: () => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => routineTableRows(routines, runs, {
    botName: (routine) => bots.find((bot) => bot.id === routine.botId)?.name ?? routine.bot?.name ?? t("routines.unavailableBot"),
    query,
  }), [routines, runs, bots, query]);
  return <div className="@container/routines space-y-8" data-routines-overview="">
    <RunsSection runs={runs} now={now} onFailedRuns={onFailedRuns} />
    <section aria-label={t("routineCalendar.scheduledRoutines")} data-routines-table="" className="space-y-3">
      <PageHeading title={t("routines.title")} subtitle={t("routineCalendar.allSchedules")}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <PageSearch compact value={query} onChange={setQuery} placeholder={t("routinesOverview.search")} label={t("routinesOverview.search")} data-routines-search="" />
          {filtersMenu}
          {newMenu}
        </div>
      </PageHeading>
      {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
      {loading && rows.length === 0 && <p role="status" className="p-3 text-[12px] text-ink-secondary">{t("routines.loading")}</p>}
      {grouped ?? (rows.length > 0
        ? <div role="table" aria-label={t("routines.list")}>
          <div role="row" className={cn("grid items-center border-b border-hairline/40 pb-2", COLUMNS)}>
            <span role="columnheader" className={HEAD_CELL}>{t("routinesOverview.col.routine")}</span>
            <span role="columnheader" className={cn(HEAD_CELL, "hidden @[46rem]/routines:block")}>{t("routinesOverview.col.bot")}</span>
            <span role="columnheader" className={cn(HEAD_CELL, "hidden @[46rem]/routines:block")}>{t("routinesOverview.col.when")}</span>
            <span role="columnheader" className={cn(HEAD_CELL, "justify-self-end @[46rem]/routines:justify-self-start")}>{t("routinesOverview.col.last")}</span>
            <span role="columnheader" className={cn(HEAD_CELL, "hidden @[46rem]/routines:block")}>{t("routinesOverview.col.next")}</span>
            <span role="columnheader" className="sr-only">{t("routinesOverview.col.actions")}</span>
          </div>
          {rows.map((row) => <Row key={row.routine.id} row={row} now={now} viewerPrincipalId={viewerPrincipalId} onOpen={onOpen} onRowMenu={onRowMenu}
            renaming={renamingId === row.routine.id} onRenameSave={onRenameSave} onRenameCancel={onRenameCancel} />)}
        </div>
        : !loading && !error && <div className="rounded-xl border border-dashed border-hairline/50 p-6 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" aria-hidden="true" />{routines.length === 0 ? t("routines.empty") : t("routinesOverview.noMatch")}</div>)}
    </section>
  </div>;
}
