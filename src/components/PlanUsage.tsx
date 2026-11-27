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
// in one line. It is the page's "Usage limits" group (#4095). #4445: one
// slim row per account (LimitRow, about 56 px), its two windows side by side
// as slim meters (LimitMeter), the favourite first then the account closest
// to a limit.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, RotateCw, Star } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { accountLimitRows, accountRowName, planRows, type PlanProvider, type PlanRow, type PlanUsageReport } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { toggleUsageFavorite, useUsageFavorite } from "@/lib/usage-favorite";
import { SettingsGroup } from "./SettingsPrimitives";

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

const RETRY_FLOOR_MS = 60_000;

/** Milliseconds until the next automatic read, when a row is rate limited. */
export function rateLimitDelay(report: PlanUsageReport): number | null {
  let wait: number | null = null;
  for (const provider of report.providers) {
    const failure = provider.failure;
    if (!failure || failure.kind !== "http" || failure.status !== 429) continue;
    if (provider.state === "windows" && !provider.staleSince) continue;
    const asked = (failure.retryAfterSeconds ?? 0) * 1000;
    wait = Math.max(wait ?? 0, asked, RETRY_FLOOR_MS);
  }
  return wait;
}

/** The last good read of a row: its figures and when they were read. */
export type KnownRow = { provider: PlanProvider; at: string };

/** A row whose read failed after one that worked keeps the last figures, marked
 * with the time they were read; `known` holds the last good row of each id. */
export function keepLastFigures(report: PlanUsageReport, known: Map<string, KnownRow>, at = report.fetchedAt ?? new Date().toISOString()): PlanUsageReport {
  if (!Array.isArray(report.providers)) return report;
  const providers = report.providers.map((provider) => {
    if (provider.state === "windows" || (provider.state === undefined && provider.ok)) {
      known.set(provider.id, { provider, at });
      return provider;
    }
    const before = provider.state === "error" ? known.get(provider.id) : undefined;
    if (!before) return provider;
    return { ...before.provider, ok: true, error: provider.error, failure: provider.failure ?? null, staleSince: before.at };
  });
  return { ...report, providers };
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
  const on = favorite.id !== null && (provider.aliasIds ?? [provider.id]).includes(favorite.id);
  if (!on && provider.state !== "windows") return null;
  const account = accountRowName(provider);
  const name = provider.plan ? `${account} ${provider.plan}` : account;
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
        "flex size-5 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
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

/** One row of Usage limits (#4445): the name (and its grey line) at the
 * left, then a two-column grid of slim meters, about 56 px in all. Every row
 * of the group goes through it: each account and the spending limit, so the
 * meters of every row line up. At phone width the grid moves under the name
 * and the two meters stay on one line. */
export function LimitRow({ name, detail, accessory, children, ...data }: {
  name: React.ReactNode;
  detail?: React.ReactNode;
  /** After the name (an account's star). */
  accessory?: React.ReactNode;
  /** The grid's cells (LimitCell). */
  children?: React.ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  return (
    <div {...data} data-plan-line="" className="group/plan flex min-h-[44px] min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5 px-3.5 py-1.5">
      <div className="flex min-w-0 flex-1 basis-[140px] flex-col">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[13px] leading-[18px] text-ink" data-plan-name="">{name}</span>
          {accessory}
        </div>
        {detail && <div className="min-w-0 truncate text-[12px] leading-4 text-ink-secondary">{detail}</div>}
      </div>
      <div data-plan-meters="" className="grid min-w-0 max-w-full shrink basis-[356px] grid-cols-2 items-center gap-x-5">{children}</div>
    </div>
  );
}

/** A cell of a LimitRow's grid: column 1 the short window, column 2 the
 * week (a missing short window leaves its cell empty, the week keeps its
 * column). `span` takes both columns (a failed read's reason). */
export function LimitCell({ col, span, className, children }: { col: 1 | 2; span?: boolean; className?: string; children: React.ReactNode }) {
  return <div data-plan-col={String(col)} className={cn("min-w-0", span ? "col-span-2" : col === 2 ? "col-start-2" : "col-start-1", className)}>{children}</div>;
}

/** One limit as a slim meter (#4445; the reference's meter, its label and
 * percent on one line): the label at the left, "34% used" at the right, a
 * 4 px bar, then one short grey line (the renewal or the amount). */
export function LimitMeter({ label, percent, tone, ariaLabel, foot, footTitle, ...data }: {
  label?: React.ReactNode;
  percent: number;
  tone: string;
  ariaLabel: string;
  foot?: React.ReactNode;
  /** The whole foot on hover, when the line shows it short. */
  footTitle?: string;
} & { [key: `data-${string}`]: string | undefined }) {
  const shown = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <div {...data} data-limit-meter="" className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-2 text-[12px] leading-4" data-limit-figure="">
        <span className="min-w-0 truncate text-ink-secondary">{label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          <span className="text-ink">{limitFigure(shown)}</span>{" "}<span className="text-ink-tertiary">{t("usage.limits.used")}</span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-inset" role="meter" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${shown}%` }} />
      </div>
      {foot && <div className="min-w-0 truncate text-[12px] leading-4 tabular-nums text-ink-tertiary" title={footTitle} data-limit-footer="">{foot}</div>}
    </div>
  );
}

/** A renewal as a meter's foot: the date with a small renew mark, the
 * whole sentence ("Renews Wed, Oct 21, 7:59 PM") read aloud and on hover. */
export function RenewalFoot({ date }: { date: string }) {
  const sentence = t("usage.headline.renews", { date });
  return (
    <span data-plan-window="" title={sentence} className="inline-flex min-w-0 max-w-full items-center gap-1">
      <RotateCw size={10} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">{sentence}</span>
      <span aria-hidden="true" className="truncate">{date}</span>
    </span>
  );
}

/** One window of an account in the slim meter form, with its renewal. */
function Meter({ provider, meter }: { provider: PlanRow; meter: PlanMeter }) {
  const used = Math.round(Math.min(100, Math.max(0, meter.usedPercent)));
  const renews = renewalDate(meter.resetsAt);
  return (
    <LimitMeter
      data-plan-window-kind={meter.kind}
      label={meter.label}
      percent={used}
      tone={usageTone(used)}
      ariaLabel={`${accountRowName(provider)} · ${meter.label}`}
      foot={renews ? <RenewalFoot date={renews} /> : null}
    />
  );
}

/** The highest percent an account reports (null: none). */
function closestToLimit(provider: PlanRow): number | null {
  const meters = provider.state === "error" ? [] : planMeters(provider);
  return meters.length ? Math.max(...meters.map((meter) => meter.usedPercent)) : null;
}

/** The accounts' order (#4445): the favourite first, then the account
 * closest to a limit; an account with no figure (a failed read, no window)
 * after them, each group in the report's order. */
export function orderAccountRows(rows: PlanRow[], favoriteId: string | null = null): PlanRow[] {
  return rows
    .map((row, index) => ({ row, index, top: closestToLimit(row) }))
    .sort((a, b) => {
      const fa = a.row.id === favoriteId ? 1 : 0;
      const fb = b.row.id === favoriteId ? 1 : 0;
      if (fa !== fb) return fb - fa;
      if (a.top === null || b.top === null) return a.top === b.top ? a.index - b.index : a.top === null ? 1 : -1;
      return b.top - a.top || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** "as of 3:42 PM": when the shown figures were read. */
function asOfText(asOf: string | null): string | null {
  if (!asOf) return null;
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) return null;
  try {
    return t("planUsage.asOf", { time: new Intl.DateTimeFormat(usageLocale(), { hour: "numeric", minute: "2-digit" }).format(at) });
  } catch {
    return null;
  }
}

/** An account's row (#4418, #4445): its name and plan at the left, then the
 * short window and the week on the grid every row shares. A failed read
 * stays inside this row: one short muted line under the bars (or in their
 * place when no figure was ever read) with a small retry button; the last
 * figures stay, with "as of <time>". The account menu's Usage and the chat
 * bar's usage detail draw the same row (M-20261125-084): one row per
 * account, never one per window. */
export function AccountLimits({ provider, name, favorite, loading, onRefresh }: {
  provider: PlanRow;
  /** The row's name where the provider is not said around it (the account
   * menu's Usage, the chat bar's usage detail: "Claude · ada@acme.example"). */
  name?: string;
} & Partial<Pick<PlanUsageViewProps, "favorite" | "loading" | "onRefresh">>) {
  const meters = provider.state === "error" ? [] : planMeters(provider);
  const line = provider.state === "error" ? provider.message : provider.note;
  const asOf = asOfText(provider.asOf ?? null);
  return (
    <LimitRow
      data-plan-row={provider.id}
      name={name ?? accountRowName(provider)}
      detail={provider.plan}
      accessory={favorite ? <FavoriteStar provider={provider} favorite={favorite} /> : null}
    >
      {meters.map((meter) => (
        <LimitCell key={meter.kind} col={meter.kind === "weekly" ? 2 : 1}>
          <Meter provider={provider} meter={meter} />
        </LimitCell>
      ))}
      {line && (
        <LimitCell col={1} span className={meters.length ? "pt-1" : undefined}>
          <div data-plan-state={provider.state === "error" ? "error" : "stale"} className="flex min-w-0 items-center gap-1.5">
            <p data-plan-reason="" title={[line, asOf].filter(Boolean).join(" · ")} className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-tertiary">
              {line}{asOf ? ` · ${asOf}` : ""}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label={t("planUsage.tryAgain")}
              title={t("planUsage.tryAgain")}
              data-plan-retry=""
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50"
            >
              <RotateCw size={11} aria-hidden="true" className={loading ? "animate-spin" : undefined} />
            </button>
          </div>
        </LimitCell>
      )}
    </LimitRow>
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
 * #4418: then one line per signed-in account, its short window and its week.
 * #4445: one slim row each, the favourite first, then the closest to a limit. */
export function PlanUsageView({ report, loading, onRefresh, failed = false, unavailable = false, favorite, leading }: PlanUsageViewProps) {
  const rows = unavailable ? [] : orderAccountRows(accountLimitRows(report), favorite?.id ?? null);
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
  const lastGood = useRef(new Map<string, KnownRow>());
  const favorite = useUsageFavorite();

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const data = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage");
      setReport(keepLastFigures(data, lastGood.current));
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

  // A rate limit retries by itself: after the delay the provider gives, never
  // sooner than a minute.
  const waitMs = report ? rateLimitDelay(report) : null;
  useEffect(() => {
    if (waitMs === null) return;
    const timer = window.setTimeout(() => void load(true), waitMs);
    return () => window.clearTimeout(timer);
  }, [report, waitMs, load]);

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
