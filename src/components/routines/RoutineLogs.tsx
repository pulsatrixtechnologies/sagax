import { useState } from "react";
import { CircleAlert, FileText, Loader2, CirclePause, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isRoutineProblemRun, routineRunMatchesStatus, type RoutineRun, type RoutineRunStatusFilter } from "@/lib/routines";
import { routineAutoPausedText, routineDateTime, routineRunDuration, routineRunLabel, routineRunPreview, routineRunTime, routineRunTone } from "@/lib/routine-display";
import { formatUsd } from "@/lib/usage";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { runActivityStatus } from "./RoutineRunDetail";

/** 2026-10-29: the period a person narrows the logs to. */
export type RoutineLogPeriod = "all" | "day" | "week" | "month";
const PERIOD_MS: Record<Exclude<RoutineLogPeriod, "all">, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
const SELECT = "min-w-0 max-w-[200px] truncate rounded-lg border border-hairline/50 bg-panel px-3 py-2 text-[12px] text-ink";
import type { Bot } from "@/state/store";
import { RoutineOwnerBadge } from "./RoutineScopeBar";

export function RoutineLogs({ runs, bots, ownerOf, viewerPrincipalId, loading, error, routineId, status, onStatusChange, onClearRoutine, onRoutineChange, onClearLogs, onOpen, now = Date.now() }: {
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
  onOpen: (run: RoutineRun) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [confirmClear, setConfirmClear] = useState(false);
  const [botId, setBotId] = useState<string>("");
  const [period, setPeriod] = useState<RoutineLogPeriod>("all");
  // The routines and bots the logs can narrow to: the ones that ran, a
  // deleted routine included (its runs stay, #1567).
  const routineChoices = [...new Map(runs.map((run) => [run.routineId, run.routineName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const botChoices = [...new Set(runs.map((run) => run.botId))].map((id) => ({ id, name: bots.find((bot) => bot.id === id)?.name ?? ownerOf?.(runs.find((run) => run.botId === id)!)?.bot?.name ?? t("routines.unavailableBot") })).sort((a, b) => a.name.localeCompare(b.name));
  const since = period === "all" ? -Infinity : now - PERIOD_MS[period];
  const filtered = runs.filter((run) => (!routineId || run.routineId === routineId) && (!botId || run.botId === botId) && routineRunTime(run) >= since && routineRunMatchesStatus(run, status)
    && `${run.routineName} ${bots.find((bot) => bot.id === run.botId)?.name ?? ""} ${run.output ?? ""} ${run.error ?? ""} ${run.attention ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => routineRunTime(b) - routineRunTime(a));
  return <section className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6" aria-label={t("routines.logs")}>
    <div><h2 className="text-[17px] font-semibold text-ink">{t("routines.logs")}</h2><p className="mt-1 text-[12px] text-ink-secondary">{t("routines.logsHint")}</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-hairline/50 bg-panel px-3 py-2 text-ink-secondary focus-within:border-focus"><Search size={14} /><input aria-label={t("routines.searchLogs")} placeholder={t("routines.searchLogs")} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none" /></label>
      <select aria-label={t("routines.filterStatus")} value={status} onChange={(event) => { onStatusChange(event.target.value as RoutineRunStatusFilter); setLimit(50); }} className="rounded-lg border border-hairline/50 bg-panel px-3 py-2 text-[12px] text-ink"><option value="all">{t("routines.allStatuses")}</option><option value="problems">{t("routines.status.problems")}</option>{(["queued", "running", "waiting", "completed", "failed", "blocked", "missed", "nothing_to_report", "cancelled"] as const).map((value) => <option key={value} value={value}>{t(`routines.status.${value}`)}</option>)}</select>
      {onRoutineChange && routineChoices.length > 1 && <select data-logs-routine aria-label={t("routines.logs.filterRoutine")} value={routineId ?? ""} onChange={(event) => { onRoutineChange(event.target.value || undefined); setLimit(50); }} className={SELECT}><option value="">{t("routines.logs.allRoutines")}</option>{routineChoices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
      {botChoices.length > 1 && <select data-logs-bot aria-label={t("routines.logs.filterBot")} value={botId} onChange={(event) => { setBotId(event.target.value); setLimit(50); }} className={SELECT}><option value="">{t("approvals.filter.allBots")}</option>{botChoices.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select>}
      <select data-logs-period aria-label={t("routines.logs.period")} value={period} onChange={(event) => { setPeriod(event.target.value as RoutineLogPeriod); setLimit(50); }} className={SELECT}>{(["all", "day", "week", "month"] as const).map((value) => <option key={value} value={value}>{t(`routines.logs.period.${value}`)}</option>)}</select>
      {onClearLogs && <button type="button" disabled={runs.length === 0} onClick={() => setConfirmClear(true)} className="rounded-lg border border-hairline/50 bg-panel px-3 py-2 text-[12px] text-ink hover:bg-raised disabled:opacity-40">{t("routines.clearLogs")}</button>}
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
