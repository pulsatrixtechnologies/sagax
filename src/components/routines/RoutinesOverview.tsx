// The Routines page's Overview tab (2026-11-17), as the reference's Cloud
// Agents page: a Runs section (period, three figure cards) and a Routines
// section (search, filters and New on the heading row, a plain table). The
// figures come from runFigures (src/lib/routine-figures.ts) over the runs the
// app already holds; the rows from routineTableRows (src/lib/routine-table.ts).
import { useMemo, useState, type ReactNode } from "react";
import { Check, Repeat2, Rows3 } from "lucide-react";
import { StatCard } from "@/components/code/StatCard";
import { PAGE_HEADER_BUTTON, PAGE_POPOVER, PageHeading, PageSearch, PageSegment } from "@/components/content-page";
import { PillSelect } from "@/components/SettingsPrimitives";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { RoutineGroupBy } from "@/lib/routine-grouping";
import { RUNS_PERIODS, runFigures, runsInPeriod, type RunsPeriod } from "@/lib/routine-figures";
import { routineTableRows } from "@/lib/routine-table";
import { useRoutineRunsFrom } from "@/state/older-routine-runs";
import type { Bot } from "@/state/store";
import { RoutineGroupedTable } from "./RoutineGroupedTable";
import { RoutineTableHead, RoutineTableRowView, type RowMenu } from "./RoutineTable";

// Each routine's last 7 runs: the app holds two weeks, a weekly routine needs about seven weeks.
const TREND_LOOKBACK_MS = 56 * 86_400_000;

/** Group by on a narrow page: one icon button, its three choices in a menu. */
function GroupByMenu({ value, onChange }: { value: RoutineGroupBy; onChange: (value: RoutineGroupBy) => void }) {
  const label = `${t("routines.group.label")} : ${t(`routines.group.${value}`)}`;
  return <details data-routines-group-menu="" className="relative @[40rem]/routines:hidden">
    <summary role="button" aria-label={label} title={label} className={PAGE_HEADER_BUTTON}><Rows3 size={15} aria-hidden="true" /></summary>
    <div role="menu" aria-label={t("routines.group.label")} className={`${PAGE_POPOVER} w-[180px] gap-0.5 p-1.5`}>
      {(["none", "bot", "folder"] as const).map((option) => <button key={option} type="button" role="menuitemradio" aria-checked={value === option}
        onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onChange(option); }}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink hover:bg-hover">{t(`routines.group.${option}`)}{value === option && <Check size={14} aria-hidden="true" className="ml-auto text-ink-secondary" />}</button>)}
    </div>
  </details>;
}

/** Runs: the period, then total, success rate and the succeeded-of-total bar. */
function RunsSection({ runs, now, onFailedRuns }: { runs: readonly RoutineRun[]; now: number; onFailedRuns: (period: RunsPeriod) => void }) {
  const [period, setPeriod] = useState<RunsPeriod>("week");
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
          {figures.failed > 0 && <button type="button" data-routines-failed-runs title={t("routineCalendar.openProblemLogs")} onClick={() => onFailedRuns(period)} className="-my-1 shrink-0 rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-ink/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("routinesOverview.viewFailed")}</button>}
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

export function RoutinesOverview({ routines, runs, bots, viewerPrincipalId, loading, error, filtersMenu, newMenu, groupBy = "none", onGroupBy, allRoutines, onCreate, onDuplicate, now = Date.now(), onOpen, onOpenRun, onRowMenu, renamingId, onRenameStart, onRenameSave, onRenameCancel, onFailedRuns }: {
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
  /** Group by Bot or Folder adds heading rows to the same table (None: no heading). */
  groupBy?: RoutineGroupBy;
  /** Changes the grouping (None, Bot, Folder): one control on the Routines heading row. */
  onGroupBy?: (groupBy: RoutineGroupBy) => void;
  /** Every routine in scope, unfiltered: a folder action reaches all of a bot's routines. */
  allRoutines?: readonly Routine[];
  onCreate?: (botId: string, folder?: string) => void;
  onDuplicate?: (routine: Routine) => void;
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
  // Each routine's last 7 runs: the app holds two weeks, a weekly routine needs about seven weeks.
  useRoutineRunsFrom(now - TREND_LOOKBACK_MS);
  const rows = useMemo(() => routineTableRows(routines, runs, {
    botName: (routine) => bots.find((bot) => bot.id === routine.botId)?.name ?? routine.bot?.name ?? t("routines.unavailableBot"),
    query,
  }), [routines, runs, bots, query]);
  return <div className="@container/routines space-y-8" data-routines-overview="">
    <RunsSection runs={runs} now={now} onFailedRuns={onFailedRuns} />
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
          {newMenu}
        </div>
      </PageHeading>
      {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
      {loading && rows.length === 0 && <p role="status" className="p-3 text-[12px] text-ink-secondary">{t("routines.loading")}</p>}
      {rows.length > 0
        ? groupBy !== "none" && onCreate && onDuplicate && onRenameStart && onRenameSave && onRenameCancel
          ? <RoutineGroupedTable groupBy={groupBy} rows={rows} allRoutines={allRoutines ?? routines} runs={runs} bots={bots} now={now} viewerPrincipalId={viewerPrincipalId ?? null}
            onOpen={onOpen} onOpenRun={onOpenRun} onCreate={onCreate} onDuplicate={onDuplicate}
            renamingId={renamingId ?? null} onRenameStart={onRenameStart} onRenameSave={onRenameSave} onRenameCancel={onRenameCancel} />
          : <div role="table" aria-label={t("routines.list")}>
            <RoutineTableHead />
            {rows.map((row) => <RoutineTableRowView key={row.routine.id} row={row} now={now} viewerPrincipalId={viewerPrincipalId} onOpen={onOpen} onOpenRun={onOpenRun} onRowMenu={onRowMenu}
              renaming={renamingId === row.routine.id} onRenameStart={onRenameStart} onRenameSave={onRenameSave} onRenameCancel={onRenameCancel} />)}
          </div>
        : !loading && !error && <div className="rounded-xl border border-dashed border-hairline/50 p-6 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" aria-hidden="true" />{routines.length === 0 ? t("routines.empty") : t("routinesOverview.noMatch")}</div>}
    </section>
  </div>;
}
