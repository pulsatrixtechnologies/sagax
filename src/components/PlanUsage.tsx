// Settings → Usage: remaining subscription allowance. This is not the token
// ledger below it — each provider reports its own 5-hour and weekly windows.
//
// One row per provider (server/usage/plan-usage.ts): its windows, "No plan
// windows", "Not signed in" with Connect, or the real error with Try again
// (#1774: an expired token stays listed; it must not vanish so only the
// last used engine shows). Since 2026-10-16 the card is always drawn: with
// no provider, a failed read or no access, it says so in one line instead
// of vanishing. On an organization server the card ends with the link to
// the person's keys in Perspicax.
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { openSettings } from "@/lib/settings-link";
import { perspicaxKeysUrl, reloadMyEngines, useMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";
import { formatResetDistance, planRows, type PlanRow, type PlanUsageReport, type PlanWindow } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { CompactRow, PILL, SettingsGroup } from "./SettingsPrimitives";
import { EngineConnect } from "./EngineConnect";

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

/** One window: a 4 px gauge, a short line of figures (used on the left, left
 * on the right), then a grey line naming the window and its renewal (#556). */
function Meter({ provider, meter }: { provider: PlanRow; meter: PlanMeter }) {
  const used = Math.round(Math.min(100, Math.max(0, meter.usedPercent)));
  const renews = renewalDate(meter.resetsAt);
  return (
    <div className="flex flex-col gap-1.5" data-plan-window-kind={meter.kind}>
      <div
        className="h-1 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={`${t("usage.plan.meter", { name: provider.name })} · ${meter.label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full", usageTone(used))} style={{ width: `${used}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[13px] tabular-nums" data-plan-figures>
        <span className="text-ink">{t("planUsage.used", { used })}</span>
        <span className="text-ink-secondary">{t("planUsage.left", { remaining: 100 - used })}</span>
      </div>
      <p className="text-[12px] text-ink-secondary" data-plan-window>
        {meter.label}
        {renews && <> · {t("usage.plan.renewsShort", { date: renews })}</>}
      </p>
    </div>
  );
}

/** Since 2026-10-16 every window shows at once: the 5-hour session and the
 * week each get their gauge ("on doit aussi voir les limites de 5 h et
 * par semaine"). Only the per-model detail folds under Details. */
function PlanSummary({ provider, now }: { provider: PlanRow; now: number }) {
  const meters = planMeters(provider);
  return (
    <div className="flex flex-col gap-3">
      {meters.length === 0 && <p className="text-[12px] text-ink-secondary">{t("planUsage.notReported")}</p>}
      {meters.map((meter, index) => <Meter key={`${meter.kind}-${meter.label}-${index}`} provider={provider} meter={meter} />)}
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

/** The card's body, without fetching: every state is drawn from props.
 * 2026-10-14: "Plan" on Settings > Usage, the person's own subscriptions.
 * 2026-10-16: the card is always drawn under Cost; with no row to show it
 * says why in one line (loading, unavailable, or connect a subscription).
 * 2026-10-30 (#1774): signed-out and error rows stay listed with Connect
 * or Try again (an expired token must not vanish). */
export function PlanUsageView({ report, loading, now, onRefresh, myEngines, issuer, onOpenEngines, failed = false, unavailable = false }: PlanUsageViewProps) {
  const rows = unavailable ? [] : planRows(report);
  const status = rows.length === 0 ? planStatus({ report, loading, failed, unavailable }) : null;
  // 0.5.6: the reference design's usage meters, a grey heading outside one rounded card,
  // one block per plan (name, a 4 px gauge per window, its two lines).
  return (
    <div data-settings-card="usage.plan">
      <SettingsGroup
        title={t("usage.plan.title")}
        groupId="plan"
        accessory={unavailable ? undefined : (
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
        )}
      >
        {status && (
          <div className="px-3.5 py-2.5" data-plan-status={status.kind} role="status">
            <p className="text-[13px] text-ink-secondary">{status.text}</p>
          </div>
        )}
        {rows.map((provider) => (
          <div key={provider.id} data-plan-row={provider.id} className="px-3.5 py-2.5">
            <div className="mb-2 flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] leading-[18px] text-ink">{provider.name}</span>
              {provider.plan && <span className="truncate text-[12px] text-ink-secondary">{provider.plan}</span>}
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
              <div data-plan-state="error" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-[12px] text-danger">{provider.message}</p>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={loading}
                  className="rounded-md px-2 py-0.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
                >
                  {t("planUsage.tryAgain")}
                </button>
              </div>
            )}
          </div>
        ))}
        {issuer && (
          <CompactRow label={t("modelsVoice.keys.title")} rowId="keys">
            <a
              href={perspicaxKeysUrl(issuer)}
              target="_blank"
              rel="noreferrer noopener"
              data-plan-keys-link
              className={PILL}
            >
              {t("myEngines.manageKeys")} <ExternalLink size={12} aria-hidden="true" />
            </a>
          </CompactRow>
        )}
      </SettingsGroup>
    </div>
  );
}

/** `enabled` false: this account cannot read plan windows here, so the card
 * says so without asking the server. */
export function PlanUsage({ enabled = true }: { enabled?: boolean }) {
  const { dispatch } = useStore();
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshedDeadlines = useRef(new Set<string>());

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

  return (
    <PlanUsageView
      report={report}
      loading={loading}
      now={now}
      onRefresh={() => void load(true)}
      myEngines={org ? myEngines : null}
      issuer={org?.org.identity.issuer ?? ""}
      onOpenEngines={() => openSettings(dispatch, "providers")}
      failed={failed}
      unavailable={!enabled}
    />
  );
}
