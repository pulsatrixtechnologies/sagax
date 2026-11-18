import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, FileText, Loader2, CirclePause, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAGE_FIELD_LABEL, PageFilters } from "@/components/content-page";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isRoutineProblemRun, routineRunMatchesStatus, type RoutineRun, type RoutineRunStatusFilter } from "@/lib/routines";
import { routineAutoPausedText, routineDateTime, routineRunDuration, routineRunLabel, routineRunPreview, routineRunTime, routineRunTone } from "@/lib/routine-display";
import { formatUsd } from "@/lib/usage";
import { RUNS_PERIOD_MS } from "@/lib/routine-figures";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { runActivityStatus } from "./RoutineRunDetail";

/** 2026-10-29: the period a person narrows the logs to. */
export type RoutineLogPeriod = "all" | "day" | "week" | "month";
/** Every control of the filter row is 36px tall, the height of the header's buttons; focus shows on the keyboard only. */
const SELECT = "h-9 min-w-0 max-w-[200px] truncate rounded-lg border border-hairline/50 bg-panel px-3 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
/** Mark all as read and Clear logs: quiet buttons at the row's right end. */
const QUIET = "h-9 shrink-0 rounded-lg px-3 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 disabled:hover:bg-transparent";
/** Under this width of the page the selects fold into one Filters popover (a ResizeObserver; the width is unknown, 0, in a test, so wide). */
const NARROW_PX = 720;
import type { Bot } from "@/state/store";
import { RoutineOwnerBadge } from "./RoutineScopeBar";

export function RoutineLogs({ runs, bots, ownerOf, viewerPrincipalId, loading, error, routineId, status, onStatusChange, onClearRoutine, onRoutineChange, onClearLogs, onMarkAllSeen, botId: botIdGiven, onBotChange, botChoices: botChoicesGiven, scopeControl, scopeActive = 0, initialPeriod = "all", onOpen, now = Date.now() }: {
  runs: RoutineRun[];
  bots: Bot[];
  /** A wider scope (2026-10-09): the owner and bot of a run's routine; the
   * owner is shown when it is not the viewer, the bot when it is not theirs. */
  ownerOf?: (run: RoutineRun) => { owner?: { id: string; name: string; avatarUrl?: string }; bot?: { id: string; name: string } } | undefined;
  viewerPrincipalId?: string | null;
  loading?: boolean;
  error?: boolean;
  routineId?: string;
  status: RoutineRunStatusFilter;
  onStatusChange: (status: RoutineRunStatusFilter) => void;
  onClearRoutine: () => void;
  /** Pick one routine to read (2026-10-29); its runs only. */
  onRoutineChange?: (routineId: string | undefined) => void;
  now?: number;
  /** Deletes every saved run the viewer may see; the button shows only when given. */
  onClearLogs?: () => void;
  /** Marks every problem run read; the button shows while one is unread (2026-11-17: it left the page menu). */
  onMarkAllSeen?: () => void;
  /** The page's bot filter (one state, shared with the other tabs; "" is every bot) and the bots it offers. */
  botId?: string;
  onBotChange?: (botId: string) => void;
  botChoices?: ReadonlyArray<{ id: string; name: string }>;
  /** The page's scope control (Mine, My teams, Everyone, Owner, Team), drawn inline or stacked in the popover; and how many of its filters are on. */
  scopeControl?: (stacked: boolean) => ReactNode;
  scopeActive?: number;
  /** The period the log opens on ("View failed runs" keeps the Overview's). */
  initialPeriod?: RoutineLogPeriod;
  onOpen: (run: RoutineRun) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [confirmClear, setConfirmClear] = useState(false);
  const [botLocal, setBotLocal] = useState("");
  const botId = botIdGiven ?? botLocal;
  const setBot = onBotChange ?? setBotLocal;
  const root = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { const width = entry?.contentRect.width ?? 0; setNarrow(width > 0 && width < NARROW_PX); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [period, setPeriod] = useState<RoutineLogPeriod>(initialPeriod);
  // The routines and bots the logs can narrow to: the ones that ran, a
  // deleted routine included (its runs stay, #1567).
  const routineChoices = [...new Map(runs.map((run) => [run.routineId, run.routineName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const botChoices = botChoicesGiven ?? [...new Set(runs.map((run) => run.botId))].map((id) => ({ id, name: bots.find((bot) => bot.id === id)?.name ?? ownerOf?.(runs.find((run) => run.botId === id)!)?.bot?.name ?? t("routines.unavailableBot") })).sort((a, b) => a.name.localeCompare(b.name));
  const since = period === "all" ? -Infinity : now - RUNS_PERIOD_MS[period];
  const filtered = runs.filter((run) => (!routineId || run.routineId === routineId) && (!botId || run.botId === botId) && routineRunTime(run) >= since && routineRunMatchesStatus(run, status)
    && `${run.routineName} ${bots.find((bot) => bot.id === run.botId)?.name ?? ""} ${run.output ?? ""} ${run.error ?? ""} ${run.attention ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => routineRunTime(b) - routineRunTime(a));
  const statusSelect = (stacked: boolean) => <select aria-label={t("routines.filterStatus")} value={status} onChange={(event) => { onStatusChange(event.target.value as RoutineRunStatusFilter); setLimit(50); }} className={cn(SELECT, stacked && "w-full max-w-none")}><option value="all">{t("routines.allStatuses")}</option><option value="problems">{t("routines.status.problems")}</option>{(["queued", "running", "waiting", "completed", "failed", "blocked", "missed", "nothing_to_report", "cancelled"] as const).map((value) => <option key={value} value={value}>{t(`routines.status.${value}`)}</option>)}</select>;
  const routineSelect = (stacked: boolean) => onRoutineChange && routineChoices.length > 1 ? <select data-logs-routine aria-label={t("routines.logs.filterRoutine")} value={routineId ?? ""} onChange={(event) => { onRoutineChange(event.target.value || undefined); setLimit(50); }} className={cn(SELECT, stacked && "w-full max-w-none")}><option value="">{t("routines.logs.allRoutines")}</option>{routineChoices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select> : null;
  const botSelect = (stacked: boolean) => botChoices.length > 1 ? <select data-logs-bot aria-label={t("routines.logs.filterBot")} value={botId} onChange={(event) => { setBot(event.target.value); setLimit(50); }} className={cn(SELECT, stacked && "w-full max-w-none")}><option value="">{t("approvals.filter.allBots")}</option>{botChoices.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select> : null;
  const periodSelect = (stacked: boolean) => <select data-logs-period aria-label={t("routines.logs.period")} value={period} onChange={(event) => { setPeriod(event.target.value as RoutineLogPeriod); setLimit(50); }} className={cn(SELECT, stacked && "w-full max-w-none")}>{(["all", "day", "week", "month"] as const).map((value) => <option key={value} value={value}>{t(`routines.logs.period.${value}`)}</option>)}</select>;
  const activeCount = scopeActive + (status !== "all" ? 1 : 0) + (routineId ? 1 : 0) + (botId ? 1 : 0) + (period !== "all" ? 1 : 0);
  const field = (label: string, control: ReactNode) => control && <div className="block"><span className={PAGE_FIELD_LABEL}>{label}</span>{control}</div>;
  // The log's one set of filters: inline selects while there is room, the same controls in one Filters popover when narrow.
  return <section ref={root} className="w-full space-y-4 px-6 pb-6 pt-4 max-sm:px-4" aria-label={t("routines.logs")}>
    <div data-logs-toolbar="" className="flex flex-wrap items-center gap-2">
      <label className="flex h-9 min-w-[220px] max-w-[360px] flex-1 items-center gap-2 rounded-lg border border-hairline/50 bg-panel px-3 text-ink-secondary focus-within:ring-2 focus-within:ring-accent/60"><Search size={14} /><input aria-label={t("routines.searchLogs")} placeholder={t("routines.searchLogs")} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none" /></label>
      {narrow
        ? <PageFilters name="logs" labelled activeCount={activeCount}>
            {scopeControl && <div>{scopeControl(true)}</div>}
            {field(t("routines.filterStatus"), statusSelect(true))}
            {field(t("routines.logs.filterRoutine"), routineSelect(true))}
            {field(t("routines.logs.filterBot"), botSelect(true))}
            {field(t("routines.logs.period"), periodSelect(true))}
          </PageFilters>
        : <>{scopeControl?.(false)}{statusSelect(false)}{routineSelect(false)}{botSelect(false)}{periodSelect(false)}</>}
      <div className="ml-auto flex items-center gap-1">
        {onMarkAllSeen && runs.some((run) => isRoutineProblemRun(run) && !run.seenAt) && <button type="button" data-logs-mark-all onClick={onMarkAllSeen} className={QUIET}>{t("routines.markAllSeen")}</button>}
        {onClearLogs && <button type="button" disabled={runs.length === 0} onClick={() => setConfirmClear(true)} className={QUIET}>{t("routines.clearLogs")}</button>}
      </div>
      {onClearLogs && <ConfirmDialog open={confirmClear} title={t("routines.clearLogsTitle")} body={t("routines.clearLogsBody")} confirmLabel={t("routines.clearLogsConfirm")} onCancel={() => setConfirmClear(false)} onConfirm={() => { setConfirmClear(false); onClearLogs(); }} />}
    </div>
    {routineId && <div className="flex items-center gap-2 text-[12px] text-ink-secondary">{t("routines.filteredRoutine")}<button type="button" onClick={onClearRoutine} className="text-accent hover:underline">{t("routines.showAll")}</button></div>}
    {error && <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 p-3 text-[12px] text-danger"><CircleAlert size={14} />{t("routines.loadError")}</p>}
    {loading && <p role="status" className="flex items-center gap-2 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("routines.loading")}</p>}
    {!loading && !error && filtered.length === 0 && <div className="rounded-xl border border-dashed border-hairline/50 p-10 text-center text-[13px] text-ink-secondary"><FileText size={24} className="mx-auto mb-3 opacity-50" />{runs.length ? t("routines.noMatchingRuns") : t("routines.noRuns")}</div>}
    <div className="space-y-2">{filtered.slice(0, limit).map((run) => {
      const bot = bots.find((candidate) => candidate.id === run.botId);
      const about = ownerOf?.(run);
      const owner = about?.owner;
      const otherOwner = owner?.id && owner.id.toLowerCase() !== viewerPrincipalId?.toLowerCase() ? owner : null;
      return <button type="button" key={run.id} onClick={() => onOpen(run)} aria-label={t("routines.openRun", { name: run.routineName, status: routineRunLabel(run) }) + (isRoutineProblemRun(run) && !run.seenAt ? ` · ${t("routines.unread")}` : "")} className="block w-full rounded-xl border border-hairline/40 bg-card p-4 text-left hover:border-accent/40 hover:bg-raised/40">
        <div className="flex items-start justify-between gap-3"><span className="mt-0.5 shrink-0"><ActivityStatusIcon status={runActivityStatus(run)} size={15} /></span><div className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-ink">{run.routineName}</span><span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] text-ink-secondary">{otherOwner && <><RoutineOwnerBadge owner={otherOwner} size={14} /> · </>}{bot?.name ?? (about?.bot?.name || t("routines.unavailableBot"))} · {routineDateTime(run.scheduledFor)} · {t(`routines.trigger.${run.triggerSource ?? (run.manual ? "manual" : "schedule")}`)}{routineRunDuration(run, now) && <> · {routineRunDuration(run, now)}</>}{run.cost != null && run.cost > 0 && <> · {formatUsd(run.cost)}</>}</span></div><div className="flex shrink-0 items-center gap-1.5">{isRoutineProblemRun(run) && !run.seenAt && <span className="size-1.5 shrink-0 rounded-full bg-danger" title={t("routines.unread")} />}<span className={cn("text-[11.5px] font-medium", routineRunTone(run))}>{routineRunLabel(run)}</span></div></div>
        <p data-log-preview className={cn("mt-2 truncate pl-[27px] text-[12px] leading-relaxed", run.error && run.status !== "waiting" ? "text-danger" : "text-ink-secondary")}>{routineRunPreview(run) || t("routines.noOutput")}</p>
        {run.autoPaused && <p data-run-auto-paused className="mt-1.5 flex pl-[27px] items-center gap-1.5 text-[12px] font-medium text-warning"><CirclePause size={13} aria-hidden="true" />{routineAutoPausedText(run.autoPaused.failures)}</p>}
      </button>;
    })}</div>
    {filtered.length > limit && <button type="button" onClick={() => setLimit((current) => current + 50)} className="rounded-lg bg-raised px-4 py-2 text-[12px] text-ink">{t("routines.loadMore")}</button>}
  </section>;
}
