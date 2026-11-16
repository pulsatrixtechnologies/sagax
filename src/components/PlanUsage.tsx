// Settings > Usage: each signed-in account's subscription limits. This is not
// the token ledger below it: each provider reports its own short (rolling
// hours) and weekly windows.
//
// #4418 (owner, 2026-11-15): "la seule autre chose de pertinent est un
// simple façon de voir le % used x h et weekly de chaque compte". One line
// per account the person is signed in to, under the name they gave it: the
// short window's percent used (with the vendor's hours) and the week's, each
// with its renewal. Nothing else: connecting, keys and providers with no
// signed-in account live in Providers. A window the vendor does not report is
// absent. An account whose read failed stays with its reason and Try again
// (#1774). The group is always drawn (2026-10-16): with no account it says so
// in one line. It is the page's "Usage limits" group (#4095), each window in
// the reference's large-percent form (LimitMeter).
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Star } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { accountLimitRows, planRows, type PlanRow, type PlanUsageReport } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { toggleUsageFavorite, useUsageFavorite } from "@/lib/usage-favorite";
import { PILL, SettingsGroup } from "./SettingsPrimitives";

function dueResetDeadlines(report: PlanUsageReport, now: number, seen: Set<string>): string[] {
  const due: string[] = [];
  for (const provider of planRows(report)) {
    if (provider.state !== "windows") continue;
    const stamps = [
      provider.fiveHour.available ? provider.fiveHour.resetsAt : null,
      provider.weekly.available ? provider.weekly.resetsAt : null,
      ...provider.extra.map((extra) => extra.resetsAt),
      ...provider.models.flatMap((model) => model.windows.map((entry) => entry.resetsAt)),
    ];
    for (const resetsAt of stamps) {
      if (!resetsAt || seen.has(resetsAt) || due.includes(resetsAt)) continue;
      const at = Date.parse(resetsAt);
      if (Number.isFinite(at) && at <= now) due.push(resetsAt);
    }
  }
  return due;
}

function usageTone(used: number): string {
  if (used >= 90) return "bg-danger";
  if (used >= 70) return "bg-warning";
  return "bg-accent";
}

export interface PlanUsageViewProps {
  report: PlanUsageReport | null;
  loading: boolean;
  now: number;
  onRefresh: () => void;
  /** The last read failed and no earlier report is kept. */
  failed?: boolean;
  /** This account cannot read plan windows here (a solo server's windows
   * are an admin read): the card says so instead of asking. */
  unavailable?: boolean;
  /** The starred plan (its percent is the one the account menu's Usage row
   * shows) and how a star is toggled; absent: no stars. */
  favorite?: { id: string | null; onToggle: (planId: string) => void };
  /** What opens the card before the accounts (#4095: the spending limit). */
  leading?: React.ReactNode;
}

/** A plan's star: on hover or focus, and always while it is on. Offered on
 * a plan that reports windows (the ones the menu can show), and on the
 * starred one whatever its state, so it can be cleared. */
function FavoriteStar({ provider, favorite }: { provider: PlanRow; favorite: NonNullable<PlanUsageViewProps["favorite"]> }) {
  const on = favorite.id === provider.id;
  if (!on && provider.state !== "windows") return null;
  const name = provider.plan ? `${provider.name} ${provider.plan}` : provider.name;
  const label = t(on ? "usage.favorite.remove" : "usage.favorite.add", { name });
  return (
    <button
      type="button"
      data-usage-favorite={on ? "on" : "off"}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => favorite.onToggle(provider.id)}
      className={cn(
        "ml-auto flex size-6 shrink-0 items-center justify-center self-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        on ? "text-accent" : "text-ink-tertiary opacity-0 hover:text-ink group-hover/plan:opacity-100 focus-visible:opacity-100 touch:opacity-100",
      )}
    >
      <Star size={13} aria-hidden="true" fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** One window of an account, as the card draws it. */
export interface PlanMeter {
  kind: "fiveHour" | "weekly";
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

/** The two windows an account's line shows (#4418): the short window, named
 * with the vendor's own hours ("5-hour session", "Session de 5 h"), then the
 * week. A window the vendor does not report is left out, never a zero. */
export function planMeters(provider: PlanRow): PlanMeter[] {
  const meters: PlanMeter[] = [];
  if (provider.fiveHour.available && provider.fiveHour.usedPercent != null) {
    meters.push({ kind: "fiveHour", label: t("usage.limits.session", { hours: provider.fiveHour.hours ?? 5 }), usedPercent: provider.fiveHour.usedPercent, resetsAt: provider.fiveHour.resetsAt });
  }
  if (provider.weekly.available && provider.weekly.usedPercent != null) {
    meters.push({ kind: "weekly", label: t("usage.plan.windowWeek"), usedPercent: provider.weekly.usedPercent, resetsAt: provider.weekly.resetsAt });
  }
  return meters;
}

const NBSP = "\u00a0";

/** The renewal as a short date and time ("mer. 21 oct., 19 h 59", "Wed, Oct
 * 21, 7:59 PM"). Every space but the one after a comma is non-breaking, so
 * a narrow card never parts the day from its month or "19 h" from "59". */
export function renewalDate(resetsAt: string | null, locale = usageLocale(), timeZone?: string): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).formatToParts(at);
    return parts.map((part) => part.type === "literal" && part.value.includes(",") ? part.value : part.value.replace(/ /g, NBSP)).join("");
  } catch {
    return null;
  }
}

/** "34%", "34 %": a limit's share in the reader's way of writing it. */
export function limitFigure(percent: number): string {
  return t("usage.limits.figure", { percent: Math.round(Math.min(100, Math.max(0, percent))) });
}

/** One limit as the reference's usage page draws it (#4095): its name, a
 * large percent with "used" beside it, a 4 px bar, then the renewal at the
 * left and a second figure at the right. Every limit of Settings > Usage
 * goes through it: each engine's windows and the spending limit. */
export function LimitMeter({ title, percent, tone, ariaLabel, start, end, ...data }: {
  /** Absent where the row above names the limit (the spending limit). */
  title?: React.ReactNode;
  percent: number;
  tone: string;
  ariaLabel: string;
  start?: React.ReactNode;
  end?: React.ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  const shown = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <div {...data} data-limit-meter="" className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 flex-col gap-3">
        {title && <div className="truncate text-[13px] leading-[18px] text-ink">{title}</div>}
        <div className="flex min-w-0 items-baseline gap-1.5" data-limit-figure="">
          <span className="text-[22px] leading-7 tabular-nums text-ink">{limitFigure(shown)}</span>
          {" "}
          <span className="text-[13px] leading-[18px] text-ink-tertiary">{t("usage.limits.used")}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="h-1 overflow-hidden rounded-full bg-inset" role="meter" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${shown}%` }} />
        </div>
        {(start || end) && (
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2.5 text-[12px] leading-4 tabular-nums text-ink-secondary" data-limit-footer="">
            <span className="min-w-0">{start}</span>
            <span className="shrink-0">{end}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** One window of an account: the shared limit form with its renewal
 * (#556, #4095). The percent used says it all (#4418): no second figure. */
function Meter({ provider, meter }: { provider: PlanRow; meter: PlanMeter }) {
  const used = Math.round(Math.min(100, Math.max(0, meter.usedPercent)));
  const renews = renewalDate(meter.resetsAt);
  return (
    <LimitMeter
      data-plan-window-kind={meter.kind}
      title={meter.label}
      percent={used}
      tone={usageTone(used)}
      ariaLabel={`${provider.name} · ${meter.label}`}
      start={renews ? <span data-plan-window="">{t("usage.headline.renews", { date: renews })}</span> : null}
    />
  );
}

/** An account's line (#4418): its name (and plan), then the short window and
 * the week side by side. Each window keeps its column, so the weeks of every
 * account line up even where an account reports no short window. */
function AccountLimits({ provider, favorite, loading, onRefresh }: { provider: PlanRow } & Pick<PlanUsageViewProps, "favorite" | "loading" | "onRefresh">) {
  const meters = planMeters(provider);
  return (
    <div data-plan-row={provider.id} className="group/plan flex min-w-0 flex-col gap-3 px-3.5 py-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] leading-[18px] text-ink" data-plan-name="">{provider.name}</span>
        {provider.plan && <span className="truncate text-[12px] text-ink-secondary">{provider.plan}</span>}
        {favorite && <FavoriteStar provider={provider} favorite={favorite} />}
      </div>
      {meters.length > 0 && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {meters.map((meter) => (
            <div key={meter.kind} className={cn("min-w-0", meter.kind === "weekly" && "col-start-2")}>
              <Meter provider={provider} meter={meter} />
            </div>
          ))}
        </div>
      )}
      {provider.state === "error" && (
        <div data-plan-state="error" className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-[12px] leading-4 text-ink-secondary">{provider.message}</p>
          <button type="button" onClick={onRefresh} disabled={loading} className={PILL} data-plan-retry="">
            {t("planUsage.tryAgain")}
          </button>
        </div>
      )}
    </div>
  );
}

/** What the card says when it has no account to draw. */
function planStatus({ report, loading, failed, unavailable }: Pick<PlanUsageViewProps, "report" | "loading" | "failed" | "unavailable">): { kind: string; text: string } {
  if (unavailable) return { kind: "unavailable", text: t("usage.plan.unavailable") };
  if (!report) {
    if (failed && !loading) return { kind: "unavailable", text: t("usage.plan.unavailable") };
    return { kind: "loading", text: t("planUsage.loading") };
  }
  return { kind: "none", text: t("usage.plan.none") };
}

/** The Usage limits group, drawn from props (no fetching).
 * 2026-10-16: always drawn; with no account it says why in one line.
 * #4095: the reference's "Usage limits" group: a grey title with the refresh
 * at the right of its row, one card, `leading` (the spending limit) first.
 * #4418: then one line per signed-in account, its short window and its week. */
export function PlanUsageView({ report, loading, onRefresh, failed = false, unavailable = false, favorite, leading }: PlanUsageViewProps) {
  const rows = unavailable ? [] : accountLimitRows(report);
  const status = rows.length === 0 ? planStatus({ report, loading, failed, unavailable }) : null;
  const refresh = unavailable ? undefined : (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      aria-busy={loading}
      aria-label={t("planUsage.refresh")}
      title={t("planUsage.refresh")}
      data-plan-refresh
      className="ml-auto flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50"
    >
      {loading ? <Loader2 size={13} className="animate-spin" data-plan-spinner /> : <RefreshCw size={13} />}
    </button>
  );
  return (
    <div data-settings-card="usage.plan" className="contents">
      <SettingsGroup title={t("usage.limits.title")} groupId="usage-limits" accessory={refresh}>
        {leading}
        {status && (
          <div className="px-3.5 py-2.5" data-plan-status={status.kind} role="status">
            <p className="text-[13px] text-ink-secondary">{status.text}</p>
          </div>
        )}
        {rows.map((provider) => <AccountLimits key={provider.id} provider={provider} favorite={favorite} loading={loading} onRefresh={onRefresh} />)}
      </SettingsGroup>
    </div>
  );
}

/** The plan windows' state and loader of Settings > Usage. */
export function usePlanUsage(enabled = true): PlanUsageViewProps {
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshedDeadlines = useRef(new Set<string>());
  const favorite = useUsageFavorite();

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const data = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage");
      setReport(data);
      setFailed(false);
      setNow(Date.now());
    } catch {
      // The card keeps the last rows it had; with none it says the plan is
      // unavailable for this account (2026-10-16: it used to vanish).
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load(false);
    else setLoading(false);
  }, [enabled, load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!report) return;
    const due = dueResetDeadlines(report, now, refreshedDeadlines.current);
    if (due.length === 0) return;
    for (const deadline of due) refreshedDeadlines.current.add(deadline);
    void load(true);
  }, [report, now, load]);

  return {
    report,
    loading,
    now,
    onRefresh: () => void load(true),
    failed,
    unavailable: !enabled,
    favorite: { id: favorite, onToggle: toggleUsageFavorite },
  };
}

/** `enabled` false: this account cannot read plan windows here, so the card
 * says so without asking the server. */
export function PlanUsage({ enabled = true }: { enabled?: boolean }) {
  return <PlanUsageView {...usePlanUsage(enabled)} />;
}
