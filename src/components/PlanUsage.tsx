// Settings → Usage: remaining subscription allowance. This is not the token
// ledger below it — each provider reports its own 5-hour and weekly windows.
//
// One row per provider (server/usage/plan-usage.ts): its windows, "No plan
// windows", "Not signed in" with Connect, or the real error with Try again
// (#1774: an expired token stays listed; it must not vanish so only the
// last used engine shows). Since 2026-10-16 the card is always drawn: with
// no provider, a failed read or no access, it says so in one line instead
// of vanishing. On an organization server the card ends with the link to
// the person's keys in Perspicax. #4095: it is the page's "Usage limits"
// group, each window in the reference's large-percent form (LimitMeter).
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Star } from "lucide-react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { openSettings } from "@/lib/settings-link";
import { perspicaxKeysUrl, reloadMyEngines, useMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";
import { formatResetDistance, planRows, type PlanRow, type PlanUsageReport, type PlanWindow } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { toggleUsageFavorite, useUsageFavorite } from "@/lib/usage-favorite";
import { CompactRow, PILL, SettingsGroup } from "./SettingsPrimitives";
import { EngineConnect } from "./EngineConnect";
import { ExternalLinkPill } from "./settings/SettingsPatterns";

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

function windowLabel(label: string): string {
  if (label === "5-hour") return t("planUsage.fiveHour");
  if (label === "Weekly") return t("planUsage.weekly");
  return label;
}

function WindowRow({
  label,
  window,
  now,
  usedHeadline = false,
}: {
  label: string;
  window: PlanWindow;
  now: number;
  usedHeadline?: boolean;
}) {
  const when = window.available ? formatResetDistance(window.resetsAt, now) : null;
  const used = window.usedPercent ?? 0;
  const headline = usedHeadline
    ? window.usedPercent == null ? null : t("planUsage.used", { used: Math.round(window.usedPercent) })
    : window.remainingPercent == null ? null : t("planUsage.left", { remaining: Math.round(window.remainingPercent) });
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <div className="text-[12px] text-ink-secondary">{label}</div>
      {window.available && headline ? (
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
            <span className="tabular-nums">{headline}</span>
            {when && <span className="text-[12px] text-ink-secondary">{t("planUsage.resetsIn", { when })}</span>}
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset"
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, Math.max(0, used)))}
          >
            <div className={cn("h-full rounded-full", usageTone(used))} style={{ width: `${Math.min(100, Math.max(0, used))}%` }} />
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-ink-secondary">{t("planUsage.notReported")}</div>
      )}
    </div>
  );
}

/** The per-model detail some providers give, folded under Details. */
function ModelWindows({ provider, now }: { provider: PlanRow; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("planUsage.byModel")}</div>
      {provider.models.map((model) => (
        <div key={model.name} className="flex flex-col gap-1">
          <div className="truncate text-[13px] font-medium text-ink">{model.name}</div>
          {model.windows.map((entry, index) => (
            <WindowRow
              key={`${model.name}-${entry.label}-${index}`}
              label={windowLabel(entry.label)}
              now={now}
              usedHeadline
              window={{ available: true, remainingPercent: entry.remainingPercent, usedPercent: entry.usedPercent, resetsAt: entry.resetsAt }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface PlanUsageViewProps {
  report: PlanUsageReport | null;
  loading: boolean;
  now: number;
  onRefresh: () => void;
  /** Organization server: the person's own engines (GET /api/me/engines),
   * whose card carries Connect. null in solo. */
  myEngines: MyEngine[] | null;
  /** Organization server: the Perspicax issuer, for EngineConnect and
   * "Manage my keys in Perspicax". Empty in solo. */
  issuer: string;
  /** Solo: open Settings > Providers to sign in. */
  onOpenEngines: () => void;
  /** The last read failed and no earlier report is kept. */
  failed?: boolean;
  /** This account cannot read plan windows here (a solo server's windows
   * are an admin read): the card says so instead of asking. */
  unavailable?: boolean;
  /** The starred plan (its percent is the one the account menu's Usage row
   * shows) and how a star is toggled; absent: no stars. */
  favorite?: { id: string | null; onToggle: (planId: string) => void };
  /** What opens the card before the engines (#4095: the spending limit). */
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

function SignedOut({ provider, myEngines, issuer, onOpenEngines, onRefresh }: { provider: PlanRow } & Pick<PlanUsageViewProps, "myEngines" | "issuer" | "onOpenEngines" | "onRefresh">) {
  const mine = myEngines?.find((engine) => engine.instanceId === provider.instanceId);
  return (
    <div data-plan-state="signed-out" className="flex flex-col gap-2">
      <p className="text-[12px] text-ink-secondary">{t("planUsage.notSignedIn")}</p>
      {mine ? (
        <EngineConnect engine={mine} issuer={issuer} onChanged={async () => { await reloadMyEngines(); onRefresh(); }} statusLine={false} disconnect={false} />
      ) : (
        <button
          type="button"
          data-plan-connect={provider.instanceId ?? provider.id}
          onClick={onOpenEngines}
          className={cn(PILL, "w-fit")}
        >
          {t("planUsage.connect", { name: provider.name })}
        </button>
      )}
    </div>
  );
}

/** One window of a plan, as the card draws it. */
export interface PlanMeter {
  kind: "fiveHour" | "weekly" | "extra";
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

/** Every window a plan reports (2026-10-16): the 5-hour session, the week,
 * then any other window the provider gives (Opus week, monthly...). A
 * window the provider does not report is left out. */
export function planMeters(provider: PlanRow): PlanMeter[] {
  const meters: PlanMeter[] = [];
  if (provider.fiveHour.available && provider.fiveHour.usedPercent != null) {
    meters.push({ kind: "fiveHour", label: t("usage.plan.windowFiveHour"), usedPercent: provider.fiveHour.usedPercent, resetsAt: provider.fiveHour.resetsAt });
  }
  if (provider.weekly.available && provider.weekly.usedPercent != null) {
    meters.push({ kind: "weekly", label: t("usage.plan.windowWeek"), usedPercent: provider.weekly.usedPercent, resetsAt: provider.weekly.resetsAt });
  }
  for (const extra of provider.extra) {
    const label = extra.label === "5-hour" ? t("usage.plan.windowFiveHour") : extra.label === "Weekly" ? t("usage.plan.windowWeek") : extra.label;
    meters.push({ kind: "extra", label, usedPercent: extra.usedPercent, resetsAt: extra.resetsAt });
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

/** One window of a plan: the shared limit form, its renewal date at the
 * left and what is left at the right (#556, #4095). */
function Meter({ provider, meter }: { provider: PlanRow; meter: PlanMeter }) {
  const used = Math.round(Math.min(100, Math.max(0, meter.usedPercent)));
  const renews = renewalDate(meter.resetsAt);
  return (
    <LimitMeter
      data-plan-window-kind={meter.kind}
      title={meter.label}
      percent={used}
      tone={usageTone(used)}
      ariaLabel={`${t("usage.plan.meter", { name: provider.name })} · ${meter.label}`}
      start={renews ? <span data-plan-window="">{t("usage.headline.renews", { date: renews })}</span> : null}
      end={<span data-plan-left="">{t("planUsage.left", { remaining: 100 - used })}</span>}
    />
  );
}

/** Since 2026-10-16 every window shows at once: the 5-hour session and the
 * week each get their meter ("on doit aussi voir les limites de 5 h et
 * par semaine"), side by side where the card is wide (#4095). Only the
 * per-model detail folds under Details. */
function PlanSummary({ provider, now }: { provider: PlanRow; now: number }) {
  const meters = planMeters(provider);
  return (
    <div className="flex flex-col gap-4">
      {meters.length === 0 && <p className="text-[12px] text-ink-secondary">{t("planUsage.notReported")}</p>}
      {meters.length > 0 && (
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {meters.map((meter, index) => <Meter key={`${meter.kind}-${meter.label}-${index}`} provider={provider} meter={meter} />)}
        </div>
      )}
      {provider.models.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="w-fit cursor-pointer rounded-md text-[12px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">{t("usage.plan.details")}</summary>
          <div className="mt-2"><ModelWindows provider={provider} now={now} /></div>
        </details>
      )}
    </div>
  );
}

/** What the card says when it has no row to draw. Error and signed-out
 * providers are rows (#1774), so they never collapse into this line. */
function planStatus({ report, loading, failed, unavailable }: Pick<PlanUsageViewProps, "report" | "loading" | "failed" | "unavailable">): { kind: string; text: string } {
  if (unavailable) return { kind: "unavailable", text: t("usage.plan.unavailable") };
  if (!report) {
    if (failed && !loading) return { kind: "unavailable", text: t("usage.plan.unavailable") };
    return { kind: "loading", text: t("planUsage.loading") };
  }
  return { kind: "none", text: t("usage.plan.none") };
}

/** The Usage limits group, drawn from props (no fetching).
 * 2026-10-14: the person's own subscriptions on Settings > Usage.
 * 2026-10-16: always drawn; with no row to show it says why in one line
 * (loading, unavailable, or connect a subscription).
 * 2026-10-30 (#1774): signed-out and error rows stay listed with Connect
 * or Try again (an expired token must not vanish).
 * #4095: the reference's "Usage limits" group: a grey title with the refresh
 * at the right of its row, one card, a block per engine whose windows take
 * the large-percent form; an engine that could not be read is a quiet line
 * with Try again. `leading` (the spending limit) opens the card. */
export function PlanUsageView({ report, loading, now, onRefresh, myEngines, issuer, onOpenEngines, failed = false, unavailable = false, favorite, leading }: PlanUsageViewProps) {
  const rows = unavailable ? [] : planRows(report);
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
        {rows.map((provider) => (
          <div key={provider.id} data-plan-row={provider.id} className="group/plan flex min-w-0 flex-col gap-3 px-3.5 py-4">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] leading-[18px] text-ink">{provider.name}</span>
              {provider.plan && <span className="truncate text-[12px] text-ink-secondary">{provider.plan}</span>}
              {favorite && <FavoriteStar provider={provider} favorite={favorite} />}
            </div>
            {provider.state === "windows" && <PlanSummary provider={provider} now={now} />}
            {provider.state === "no-windows" && (
              <p data-plan-state="no-windows" className="text-[12px] text-ink-secondary">
                {provider.access === "api-key" ? t("planUsage.apiKeyNoWindows") : t("planUsage.noWindows")}
              </p>
            )}
            {provider.state === "signed-out" && (
              <SignedOut provider={provider} myEngines={myEngines} issuer={issuer} onOpenEngines={onOpenEngines} onRefresh={onRefresh} />
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
        ))}
        {issuer && (
          <CompactRow label={t("modelsVoice.keys.title")} rowId="keys">
            <ExternalLinkPill href={perspicaxKeysUrl(issuer)}>
              <span data-plan-keys-link>{t("myEngines.manageKeys")}</span>
            </ExternalLinkPill>
          </CompactRow>
        )}
      </SettingsGroup>
    </div>
  );
}

/** The plan windows' state and loader of Settings > Usage. */
export function usePlanUsage(enabled = true): PlanUsageViewProps {
  const { dispatch } = useStore();
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
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
    myEngines: org ? myEngines : null,
    issuer: org?.org.identity.issuer ?? "",
    onOpenEngines: () => openSettings(dispatch, "providers"),
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
