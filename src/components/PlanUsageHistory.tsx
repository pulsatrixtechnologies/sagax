// Plan usage history (#2757): past plan windows as rows that fold, the way
// the usage pages of Claude and ChatGPT list them: one row per week with
// its "% of limit used", its 5-hour sessions inside. One series (the share
// of the limit), so one hue on a track and no legend; the figure beside
// each bar is the label (dataviz: text in ink, never the series color).
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { humanPlanName } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { formatLimitShare as formatShare, planHistoryAccounts, planHistoryGroups, type PlanHistory, type PlanHistoryGroup, type PlanPeriod } from "@/lib/plan-history";
import { PillSelect } from "./SettingsPrimitives";

/** Weeks shown before "Show N more". */
const SHOWN_ROWS = 6;

/** "47%", "47 %" in French, like the Plan rows above. */
function formatLimitShare(percent: number): string {
  return formatShare(percent, (value) => t("planHistory.percent", { value }));
}

export async function loadPlanHistory(days = 90): Promise<PlanHistory> {
  const body = await api<Partial<PlanHistory> | null>(`/api/plan-usage/history?days=${days}`);
  // An older server answers another shape: read it as no history, never crash the page.
  return {
    updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : null,
    accounts: Array.isArray(body?.accounts) ? body.accounts : [],
    periods: Array.isArray(body?.periods) ? body.periods : [],
  };
}

export function usePlanHistory(enabled = true, reload = 0): { history: PlanHistory | null; failed: boolean } {
  const [history, setHistory] = useState<PlanHistory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadPlanHistory().then(
      (next) => { if (alive) { setHistory(next); setFailed(false); } },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [enabled, reload]);
  return { history, failed };
}

function dayLabel(at: number): string {
  try { return new Intl.DateTimeFormat(usageLocale(), { month: "short", day: "numeric" }).format(at); }
  catch { return new Date(at).toISOString().slice(0, 10); }
}

function timeLabel(at: number): string {
  try { return new Intl.DateTimeFormat(usageLocale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at); }
  catch { return new Date(at).toISOString().slice(0, 16).replace("T", " "); }
}

function hourLabel(at: number): string {
  try { return new Intl.DateTimeFormat(usageLocale(), { hour: "numeric", minute: "2-digit" }).format(at); }
  catch { return new Date(at).toISOString().slice(11, 16); }
}

function groupLabel(group: PlanHistoryGroup): string {
  if (group.kind === "day") return dayLabel(group.startsAt);
  // The window ends at its reset; the last day it covers is the one before.
  return t("planHistory.range", { from: dayLabel(group.startsAt), to: dayLabel(group.endsAt - 1) });
}

function fillTone(percent: number): string {
  if (percent >= 100) return "bg-danger";
  if (percent >= 80) return "bg-warning";
  return "bg-accent";
}

function Meter({ percent, nested = false }: { percent: number; nested?: boolean }) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <span aria-hidden="true" data-plan-history-bar="" className={cn("hidden h-1.5 shrink-0 overflow-hidden rounded-full bg-inset sm:block", nested ? "w-[28%]" : "w-[34%]")}>
      {width > 0 && <span className={cn("block h-full rounded-full", nested ? "bg-ink-tertiary" : fillTone(width))} style={{ width: `${Math.max(width, 1.5)}%` }} />}
    </span>
  );
}

function Figure({ percent, muted = false }: { percent: number; muted?: boolean }) {
  return (
    <span className="flex w-28 shrink-0 flex-col items-end">
      <span data-plan-history-percent="" className={cn("tabular-nums text-[14px] leading-5", muted ? "text-ink-secondary" : "text-ink")}>{formatLimitShare(percent)}</span>
      <span className="text-[12px] leading-4 text-ink-secondary">{t("planHistory.ofLimit")}</span>
    </span>
  );
}

function SessionRow({ session }: { session: PlanPeriod }) {
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.resetsAt);
  const detail = t("planHistory.sessionTitle", { peak: formatLimitShare(session.peakPercent), samples: String(session.samples) });
  return (
    <div data-plan-history-session="" title={detail} className="flex min-h-[40px] min-w-0 items-center gap-3 py-1.5 pl-10 pr-10">
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">
        {t("planHistory.session", { from: timeLabel(start), to: hourLabel(end) })}
      </span>
      <Meter percent={session.peakPercent} nested />
      <span data-plan-history-percent="" className="w-28 shrink-0 text-right tabular-nums text-[13px] leading-5 text-ink-secondary">{formatLimitShare(session.peakPercent)}</span>
    </div>
  );
}

export function PlanUsageHistoryView({ history, failed = false, now = Date.now(), initialAccount, initialOpen = [], initialAll = false }: {
  history: PlanHistory | null;
  failed?: boolean;
  now?: number;
  initialAccount?: string;
  /** Rows open at first (gallery, tests). */
  initialOpen?: readonly string[];
  initialAll?: boolean;
}) {
  const accounts = useMemo(() => planHistoryAccounts(history), [history]);
  const [picked, setPicked] = useState<string | undefined>(initialAccount);
  const account = accounts.find((row) => row.id === picked)?.id ?? accounts[0]?.id ?? "";
  const groups = useMemo(() => planHistoryGroups(history, account, now), [history, account, now]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const [all, setAll] = useState(initialAll);
  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  // Two logins of one product read "Claude · Max", "Claude · Pro", never "Claude" twice.
  const names = accounts.map((row) => row.name);
  const accountLabel = (row: (typeof accounts)[number]) => names.filter((name) => name === row.name).length > 1
    ? `${row.name} · ${humanPlanName(row.plan) ?? row.id}`
    : row.name;

  if (!history) {
    return <p role="status" data-plan-history-empty="" className="text-[13px] leading-5 text-ink-secondary">{failed ? t("planHistory.failed") : t("planUsage.loading")}</p>;
  }
  if (groups.length === 0) {
    return <p data-plan-history-empty="" className="text-[13px] leading-5 text-ink-secondary">{t("planHistory.empty")}</p>;
  }
  const shown = all ? groups : groups.slice(0, SHOWN_ROWS);
  const hidden = groups.length - shown.length;
  return (
    <div data-plan-history="" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] leading-4 text-ink-secondary">{t(groups[0]?.kind === "day" ? "planHistory.byDay" : "planHistory.byWeek")}</span>
        {accounts.length > 1 && (
          <PillSelect
            value={account}
            ariaLabel={t("planHistory.account")}
            onChange={setPicked}
            options={accounts.map((row) => ({ value: row.id, label: accountLabel(row) }))}
          />
        )}
      </div>
      <div role="list" aria-label={t("planHistory.title")} className="min-w-0 overflow-hidden rounded-xl border border-hairline">
        {shown.map((group, index) => {
          const expanded = open.has(group.key);
          const bodyId = `plan-history-${group.key}`;
          return (
            <div key={group.key} role="listitem" data-plan-history-row={group.kind} className={cn("min-w-0", index > 0 && "border-t border-hairline")}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={() => toggle(group.key)}
                title={t("planHistory.rowTitle", { peak: formatLimitShare(group.percent), sessions: String(group.sessions.length) })}
                className="flex min-h-[48px] w-full min-w-0 items-center gap-3 py-2 pl-4 pr-3 text-left transition-colors hover:bg-hover"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] leading-5 text-ink">{groupLabel(group)}</span>
                    {group.current && <span data-plan-history-current="" className="shrink-0 rounded-full bg-inset px-2 text-[11px] leading-[18px] text-ink-secondary">{t("planHistory.current")}</span>}
                  </span>
                  <span className="truncate text-[12px] leading-4 text-ink-secondary">{t("planHistory.sessions", { count: String(group.sessions.length) })}</span>
                </span>
                <Meter percent={group.percent} />
                <Figure percent={group.percent} />
                <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
              </button>
              <div id={bodyId} hidden={!expanded} className="pb-1.5">
                {group.sessions.length === 0
                  ? <p className="py-1.5 pl-10 pr-10 text-[13px] leading-5 text-ink-secondary">{t("planHistory.noSessions")}</p>
                  : group.sessions.map((session) => <SessionRow key={session.resetsAt} session={session} />)}
              </div>
            </div>
          );
        })}
        {hidden > 0 && (
          <button
            type="button"
            data-plan-history-more=""
            onClick={() => setAll(true)}
            className="flex min-h-[44px] w-full items-center border-t border-hairline px-4 text-left text-[13px] leading-5 text-ink-secondary transition-colors hover:bg-hover"
          >
            {t("planHistory.more", { count: String(hidden) })}
          </button>
        )}
      </div>
    </div>
  );
}
