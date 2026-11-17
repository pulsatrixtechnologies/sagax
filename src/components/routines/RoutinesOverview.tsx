// The Routines page's Overview tab (2026-11-17), as the reference's Cloud
// Agents page: a Runs section (period, three figure cards) and a Routines
// section (search, filters and New on the heading row, a plain table). The
// figures come from runFigures (src/lib/routine-figures.ts) over the runs the
// app already holds; the rows from routineTableRows (src/lib/routine-table.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Repeat2, Rows3 } from "lucide-react";
import { StatCard } from "@/components/code/StatCard";
import { PAGE_HEADER_BUTTON, PAGE_POPOVER, PageHeading, PageSearch, PageSegment } from "@/components/content-page";
import { PillSelect } from "@/components/SettingsPrimitives";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { RoutineGroupBy } from "@/lib/routine-grouping";
import { RUNS_PERIODS, RUNS_PERIOD_MS, runFigures, runsInPeriod, type RunsPeriod } from "@/lib/routine-figures";
import { routineTableRows } from "@/lib/routine-table";
import { TREND_SLOTS } from "@/lib/routine-trend";
import { useRoutineRunsCover, useRoutineRunsFrom, useRoutineTrendRuns } from "@/state/older-routine-runs";
import type { Bot } from "@/state/store";
import { RoutineGroupedTable } from "./RoutineGroupedTable";
import { RoutineTableHead, RoutineTableRowView, type RowMenu } from "./RoutineTable";

// Each routine's last 7 runs: the app holds two weeks, a weekly routine needs about seven weeks.
const TREND_LOOKBACK_MS = 56 * 86_400_000;
const DAY_MS = 86_400_000;
/** A range start rounded down to the day, so the read it names does not change on every render or every minute. */
const dayStart = (at: number) => Math.floor(at / DAY_MS) * DAY_MS;

/** The page's clock: the time it was given (a test, a fixed view), else the real one, moved on every minute, so
 * nothing that reads it changes on every render. */
function useClock(given: number | undefined): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (given !== undefined) return;
    const timer = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [given]);
  return given ?? tick;
}

/** Group by on a narrow page: one icon button, its three choices in a menu. Escape closes it and gives the button the
 * focus back; Up and Down (Home, End) move between the choices. */
function GroupByMenu({ value, onChange }: { value: RoutineGroupBy; onChange: (value: RoutineGroupBy) => void }) {
  const label = `${t("routines.group.label")} : ${t(`routines.group.${value}`)}`;
  const details = useRef<HTMLDetailsElement>(null);
  const items = () => [...(details.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const close = (focus: boolean) => { details.current?.removeAttribute("open"); if (focus) details.current?.querySelector<HTMLElement>("summary")?.focus(); };
  return <details ref={details} data-routines-group-menu="" className="relative @[40rem]/routines:hidden"
    onToggle={(event) => { if (event.currentTarget.open) (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus(); }}>
    <summary role="button" aria-haspopup="menu" aria-label={label} title={label} className={PAGE_HEADER_BUTTON}><Rows3 size={15} aria-hidden="true" /></summary>
    <div role="menu" aria-label={t("routines.group.label")} className={`${PAGE_POPOVER} w-[180px] gap-0.5 p-1.5`}
      onKeyDown={(event) => {
        const all = items();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === "ArrowDown") { event.preventDefault(); all[(at + 1) % all.length]?.focus(); }
        else if (event.key === "ArrowUp") { event.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
        else if (event.key === "Home") { event.preventDefault(); all[0]?.focus(); }
        else if (event.key === "End") { event.preventDefault(); all.at(-1)?.focus(); }
      }}>
      {(["none", "bot", "folder"] as const).map((option) => <button key={option} type="button" role="menuitemradio" aria-checked={value === option} tabIndex={-1}
        onClick={() => { close(true); onChange(option); }}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">{t(`routines.group.${option}`)}{value === option && <Check size={14} aria-hidden="true" className="ml-auto text-ink-secondary" />}</button>)}
    </div>
  </details>;
}

/** Runs: the period, then total, success rate and the succeeded-of-total bar. */
function RunsSection({ runs, now, period, onPeriod, loadingFigures, onFailedRuns }: { runs: readonly RoutineRun[]; now: number; period: RunsPeriod; onPeriod: (period: RunsPeriod) => void; loadingFigures: boolean; onFailedRuns: (period: RunsPeriod) => void }) {
  const figures = useMemo(() => runFigures(runsInPeriod(runs, period, now)), [runs, period, now]);
  const failedShare = figures.total ? (figures.failed / figures.total) * 100 : 0;
  return <section aria-label={t("routinesOverview.runs")} data-routines-runs="" className="space-y-3">
    <PageHeading title={t("routinesOverview.runs")}>
      <PillSelect<RunsPeriod> ariaLabel={t("routinesOverview.period")} value={period} onChange={onPeriod} bordered
        options={RUNS_PERIODS.map((value) => ({ value, label: t(`routinesOverview.period.${value}`) }))} />
    </PageHeading>
    {/* The older runs of a longer period are on their way: say so, never figures of the days already held. */}
    <div aria-busy={loadingFigures || undefined} className="grid grid-cols-2 gap-3 @[46rem]/routines:grid-cols-[1fr_1fr_1.7fr]">
      <StatCard testId="routines-total" label={t("routinesOverview.total")} value={loadingFigures ? "…" : figures.total} />
      <StatCard testId="routines-rate" label={t("routinesOverview.rate")} value={loadingFigures || figures.rate === null ? (loadingFigures ? "…" : "-") : `${figures.rate}%`} {...(loadingFigures || figures.rate === null ? {} : { ring: figures.rate / 100 })} />
      <div data-testid="routines-outcome" className="flex min-w-0 flex-col gap-1 rounded-xl border border-hairline bg-card px-3.5 py-3 col-span-2 @[46rem]/routines:col-span-1">
        <span className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
          <span className="truncate">{t("routinesOverview.recent")}</span>
          {!loadingFigures && figures.failed > 0 && <button type="button" data-routines-failed-runs title={t("routineCalendar.openProblemLogs")} onClick={() => onFailedRuns(period)} className="-my-1 shrink-0 rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-ink/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("routinesOverview.viewFailed")}</button>}
        </span>
        <span className="flex items-baseline gap-1.5 text-ink">
          <span className="text-[20px] font-semibold leading-7 tabular-nums">{loadingFigures ? <span role="status" data-routines-figures-loading="">{t("routines.loading")}</span> : figures.total ? (figures.succeeded === 1 ? t("routinesOverview.succeededOne") : t("routinesOverview.succeeded", { count: figures.succeeded })) : t("routinesOverview.noRuns")}</span>
          {!loadingFigures && figures.total > 0 && <span className="text-[11.5px] text-ink-tertiary">{figures.total === 1 ? t("routinesOverview.ofRun") : t("routinesOverview.ofRuns", { count: figures.total })}</span>}
        </span>
        <span role="img" aria-label={t("routinesOverview.barLabel", { succeeded: figures.succeeded, failed: figures.failed })} data-routines-bar className="mt-2 flex h-1 w-full gap-0.5 overflow-hidden rounded-full bg-control">
          {!loadingFigures && figures.total > 0 && <span className="h-full bg-trend-success" style={{ width: `${100 - failedShare}%` }} />}
          {figures.failed > 0 && <span className="h-full bg-trend-failed" style={{ width: `${failedShare}%` }} />}
        </span>
      </div>
    </div>
  </section>;
}

export function RoutinesOverview({ routines, runs, bots, viewerPrincipalId, loading, error, filtersMenu, groupBy = "none", onGroupBy, allRoutines, onCreate, onDuplicate, onViewRuns, openRoomOf, trendRuns, now: nowGiven, onOpen, onOpenRun, onRowMenu, renamingId, onRenameStart, onRenameSave, onRenameCancel, onFailedRuns }: {
  /** The routines in the page's scope and bot filter. */
  routines: readonly Routine[];
  /** The runs in the same scope: the figures read them. */
  runs: readonly RoutineRun[];
  bots: readonly Bot[];
  viewerPrincipalId?: string | null;
  loading?: boolean;
  error?: boolean;
  /** The page's Filters button, drawn on the heading row (New routine is the page header's, as Memory's New note). */
  filtersMenu: ReactNode;
  /** Group by Bot or Folder adds heading rows to the same table (None: no heading). */
  groupBy?: RoutineGroupBy;
  /** Changes the grouping (None, Bot, Folder): one control on the Routines heading row. */
  onGroupBy?: (groupBy: RoutineGroupBy) => void;
  /** Every routine of the person, before any scope, status filter or search: a folder action reaches all of a bot's routines. */
  allRoutines?: readonly Routine[];
  onCreate?: (botId: string, folder?: string) => void;
  onDuplicate?: (routine: Routine) => void;
  /** Older runs only the trend asked for (each routine's newest few): they draw the bars, never the figures. */
  trendRuns?: readonly RoutineRun[];
  /** Row menu "View runs": the run log filtered to that routine. */
  onViewRuns?: (routine: Routine) => void;
  /** Row menu "Open team room": the way to open a team goal's room, when the routine has one. */
  openRoomOf?: (routine: Routine) => (() => void) | undefined;
  /** Given by a test or a fixed view; the page otherwise keeps its own clock, moved on every minute. */
  now?: number;
  onOpen: (routine: Routine) => void;
  /** A trend mark opens that run. */
  onOpenRun: (run: RoutineRun) => void;
  onRowMenu?: RowMenu;
  renamingId?: string | null;
  onRenameStart?: (routine: Routine) => void;
  onRenameSave?: (routine: Routine, name: string) => void;
  onRenameCancel?: () => void;
  /** Opens the Run logs on the problems filter, for the period the cards show. */
  onFailedRuns: (period: RunsPeriod) => void;
}) {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<RunsPeriod>("week");
  const now = useClock(nowGiven);
  // Each routine's last 7 runs: the app holds two weeks, a weekly routine needs about seven weeks. Only the newest 7 of
  // each routine are asked for (not every run of eight weeks), once for the day.
  useRoutineTrendRuns(dayStart(now - TREND_LOOKBACK_MS), TREND_SLOTS);
  // "Last 30 days" needs every run of those days, so only while it is chosen are they loaded; until they are
  // here its figures say loading rather than show the 14 days the app already holds.
  const monthStart = dayStart(now - RUNS_PERIOD_MS.month);
  useRoutineRunsFrom(period === "month" ? monthStart : Infinity);
  const covered = useRoutineRunsCover(period === "month" ? monthStart : Infinity);
  const loadingFigures = period === "month" && !covered;
  // The bars read the runs the app holds and the older ones the trend asked for; the figures read only the former.
  const barRuns = useMemo(() => {
    if (!trendRuns?.length) return runs;
    const held = new Set(runs.map((run) => run.id));
    return [...runs, ...trendRuns.filter((run) => !held.has(run.id))];
  }, [runs, trendRuns]);
  const rows = useMemo(() => routineTableRows(routines, barRuns, {
    botName: (routine) => bots.find((bot) => bot.id === routine.botId)?.name ?? routine.bot?.name ?? t("routines.unavailableBot"),
    query,
  }), [routines, barRuns, bots, query]);
  // Row handlers that keep their identity, so a run event redraws only the rows whose data changed.
  const latest = useRef({ onOpen, onOpenRun, onRowMenu, onRenameStart, onRenameSave, onRenameCancel });
  latest.current = { onOpen, onOpenRun, onRowMenu, onRenameStart, onRenameSave, onRenameCancel };
  const stable = useMemo(() => ({
    onOpen: (routine: Routine) => latest.current.onOpen(routine),
    onOpenRun: (run: RoutineRun) => latest.current.onOpenRun(run),
    onRenameStart: (routine: Routine) => latest.current.onRenameStart?.(routine),
    onRenameSave: (routine: Routine, name: string) => latest.current.onRenameSave?.(routine, name),
    onRenameCancel: () => latest.current.onRenameCancel?.(),
  }), []);
  const onRowMenuStable = useCallback<NonNullable<RowMenu>>((routine, at, trigger) => latest.current.onRowMenu?.(routine, at, trigger), []);
  return <div className="@container/routines space-y-8" data-routines-overview="">
    <RunsSection runs={runs} now={now} period={period} onPeriod={setPeriod} loadingFigures={loadingFigures} onFailedRuns={onFailedRuns} />
    <section aria-label={t("routineCalendar.scheduledRoutines")} data-routines-table="" className="space-y-3">
      <PageHeading title={t("routines.title")} subtitle={t("routineCalendar.allSchedules")}>
        {/* One row at every width: the search takes what is left, the others are icon buttons on a narrow page. */}
        <div className="flex w-full min-w-0 items-center gap-2 @[40rem]/routines:w-auto">
          <div className="min-w-0 flex-1 @[40rem]/routines:flex-none [&>label]:w-full [&>label]:basis-auto @[40rem]/routines:[&>label]:basis-[220px]"><PageSearch compact value={query} onChange={setQuery} placeholder={t("routinesOverview.search")} label={t("routinesOverview.search")} data-routines-search="" /></div>
          {filtersMenu}
          {onGroupBy && <>
            <div className="hidden items-center gap-2 @[40rem]/routines:flex"><span className="text-[12px] text-ink-secondary">{t("routines.group.label")}</span>
              <PageSegment label={t("routines.group.label")} value={groupBy} onChange={onGroupBy} data-routines-group-by="" options={(["none", "bot", "folder"] as const).map((value) => ({ value, label: t(`routines.group.${value}`) }))} /></div>
            <GroupByMenu value={groupBy} onChange={onGroupBy} />
          </>}
        </div>
      </PageHeading>
      {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
      {loading && rows.length === 0 && <p role="status" className="p-3 text-[12px] text-ink-secondary">{t("routines.loading")}</p>}
      {rows.length > 0
        ? groupBy !== "none" && onCreate && onDuplicate && onViewRuns && onRenameStart && onRenameSave && onRenameCancel
          ? <RoutineGroupedTable groupBy={groupBy} rows={rows} allRoutines={allRoutines ?? routines} runs={runs} bots={bots} now={now} viewerPrincipalId={viewerPrincipalId ?? null}
            onOpen={stable.onOpen} onOpenRun={stable.onOpenRun} onCreate={onCreate} onDuplicate={onDuplicate} onViewRuns={onViewRuns} openRoomOf={openRoomOf}
            renamingId={renamingId ?? null} onRenameStart={stable.onRenameStart} onRenameSave={stable.onRenameSave} onRenameCancel={stable.onRenameCancel} />
          : <div role="table" aria-label={t("routines.list")}>
            <RoutineTableHead />
            {rows.map((row) => <RoutineTableRowView key={row.routine.id} row={row} now={now} viewerPrincipalId={viewerPrincipalId} onOpen={stable.onOpen} onOpenRun={stable.onOpenRun} onRowMenu={onRowMenu ? onRowMenuStable : undefined}
              renaming={renamingId === row.routine.id} onRenameStart={onRenameStart ? stable.onRenameStart : undefined} onRenameSave={onRenameSave ? stable.onRenameSave : undefined} onRenameCancel={onRenameCancel ? stable.onRenameCancel : undefined} />)}
          </div>
        : !loading && !error && <div className="rounded-xl border border-dashed border-hairline/50 p-6 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" aria-hidden="true" />{routines.length === 0 ? t("routines.empty") : t("routinesOverview.noMatch")}</div>}
    </section>
  </div>;
}
