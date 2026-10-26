// Settings > Usage (2026-10-14, redrawn): the signed-in person's own usage.
// Two simple cards on top, Cost first (this month, its trend against the
// same days of last month, a 30-day sparkline; on top since 2026-10-15),
// then Plan (their connected subscriptions' 5-hour and weekly windows; always
// drawn since 2026-10-16, with one line when there is nothing to show),
// then one folded breakdown by bot and by model. Every figure
// comes from GET /api/me/usage (or, on a 0.5.3 server, GET /api/usage?mine=1), which keeps only the requester's turns
// (server/routes/usage.ts) and is open to every member (2026-10-15). Per-person tables, organization totals, budgets
// and sell prices belong to the organization's admin console, which an
// organization admin reaches from the link at the bottom.
import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { api, ApiError, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { canViewUsage } from "@/lib/viewer";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  costOf,
  costTrend,
  dailyCosts,
  formatCost,
  parseCapInput,
  personalUsagePeriods,
  previousCyclePeriod,
  rankedGroups,
  usageLocale,
  usageQuery,
  type PersonalSpendCap,
  type PersonalUsageGroup,
  type PersonalUsageSummary,
} from "@/lib/usage-personal";
import { fetchMyTraces } from "@/lib/usage-trace";
import { PlanUsage } from "./PlanUsage";
import { UsageTraces } from "./usage/UsageTraces";
import { perspicaxConsoleUrl } from "./PerspicaxOrgSettings";
import { CompactRow, ConfirmPill, DescribedRow, FIELD, FoldRow, PILL, PillSelect, PRIMARY_PILL, SettingsGroup } from "./SettingsPrimitives";

export interface PersonalUsage {
  month: PersonalUsageSummary;
  previous: PersonalUsageSummary;
  days30: PersonalUsageSummary;
  byBot: PersonalUsageSummary;
  byModel: PersonalUsageSummary;
}

/** One billing cycle's totals and breakdowns: the current month (already
 * loaded, plus the by-source list) or the whole previous month. */
export interface CycleDetail {
  total: PersonalUsageSummary;
  byBot: PersonalUsageSummary;
  byModel: PersonalUsageSummary;
  /** null where the server does not group by engine (an older one). */
  byEngine: PersonalUsageSummary | null;
}

export type UsageCycle = "current" | "previous";

const optional = async <T,>(read: Promise<T>): Promise<T | null> => read.catch(() => null);

/** "Cycle précédent": last month in full, by bot, by model and by source.
 * The current cycle's own by-source list rides along on the same call shape. */
export async function loadCycleDetail(cycle: UsageCycle, usage: PersonalUsage, now = new Date(), get: <T>(path: string) => Promise<T> = api): Promise<CycleDetail> {
  if (cycle === "current") {
    const range = personalUsagePeriods(now).month;
    return { total: usage.month, byBot: usage.byBot, byModel: usage.byModel, byEngine: await optional(get<PersonalUsageSummary>(usageQuery(range, "engine"))) };
  }
  const range = previousCyclePeriod(now);
  const [total, byBot, byModel, byEngine] = await Promise.all([
    get<PersonalUsageSummary>(usageQuery(range, "day")),
    get<PersonalUsageSummary>(usageQuery(range, "bot")),
    get<PersonalUsageSummary>(usageQuery(range, "model")),
    optional(get<PersonalUsageSummary>(usageQuery(range, "engine"))),
  ]);
  return { total, byBot, byModel, byEngine };
}

/** The Cost card's error: "failed" for a read that failed, "unavailable"
 * when the server answers neither route (older than per-person cost). */
export type PersonalUsageError = "failed" | "unavailable";

/** No per-person cost on this server: it knows neither GET /api/me/usage nor
 * lets this person read GET /api/usage?mine=1. */
export class PersonalUsageUnavailable extends Error {
  constructor() {
    super("personal usage unavailable");
    this.name = "PersonalUsageUnavailable";
  }
}

/** A server older than 0.5.4 does not know GET /api/me/usage: an admin
 * session meets a 404, a member's session the admin scope every unknown
 * route requires (403). 0.5.4 opens the route to every member, so that
 * refusal never comes from a server that has it. */
function olderServer(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 403 && typeof error.body?.error === "string" && /lacks the admin scope/.test(error.body.error);
}

async function readPersonalUsage(now: Date, get: <T>(path: string) => Promise<T>, legacy: boolean): Promise<PersonalUsage> {
  const periods = personalUsagePeriods(now);
  // the month first: an older server answers it with a refusal before any other read
  const month = await get<PersonalUsageSummary>(usageQuery(periods.month, "day", legacy));
  const [previous, days30, byBot, byModel] = await Promise.all([
    get<PersonalUsageSummary>(usageQuery(periods.previous, "day", legacy)),
    get<PersonalUsageSummary>(usageQuery(periods.days30, "day", legacy)),
    get<PersonalUsageSummary>(usageQuery(periods.month, "bot", legacy)),
    get<PersonalUsageSummary>(usageQuery(periods.month, "model", legacy)),
  ]);
  return { month, previous, days30, byBot, byModel };
}

/** GET /api/me/usage once; on a server older than 0.5.4, the same person's
 * turns from GET /api/usage?mine=1 (as iOS, #535). When that is refused too,
 * PersonalUsageUnavailable. */
export async function loadPersonalUsage(now = new Date(), get: <T>(path: string) => Promise<T> = api): Promise<PersonalUsage> {
  try {
    return await readPersonalUsage(now, get, false);
  } catch (error) {
    if (!olderServer(error)) throw error;
  }
  try {
    return await readPersonalUsage(now, get, true);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) throw new PersonalUsageUnavailable();
    throw error;
  }
}

/** Plan windows come from GET /api/plan-usage: a person's own on an
 * organization server, an admin read on a solo server (a paired device
 * without the admin scope would only meet a 403 there). The Plan card is
 * drawn either way (2026-10-16); false only spares the request and says the
 * plan is unavailable for this account. */
export function planUsageShown(input: { organization: boolean; viewUsage: boolean }): boolean {
  return input.organization || input.viewUsage;
}

/** The page's order (2026-10-15): Cost on top, then Plan, then the rest. */
export function UsageLayout({ cost, plan, rest }: { cost: ReactNode; plan: ReactNode; rest: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-6">{cost}{plan}{rest}</div>;
}

/** Every member sees this page (2026-10-15): it shows their own usage only.
 * 0.5.6: laid out as Grok Bot's Usage & Billing, grey headings outside
 * rounded cards, compact rows; the breakdown folds under a count pill. */
export function UsageSection() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const [usage, setUsage] = useState<PersonalUsage | null>(null);
  const [error, setError] = useState<PersonalUsageError | null>(null);
  useEffect(() => {
    let alive = true;
    loadPersonalUsage().then(
      (next) => { if (alive) setUsage(next); },
      (failure) => { if (alive) setError(failure instanceof PersonalUsageUnavailable ? "unavailable" : "failed"); },
    );
    return () => { alive = false; };
  }, []);
  const [cycle, setCycle] = useState<UsageCycle>("current");
  const [detail, setDetail] = useState<{ cycle: UsageCycle; data: CycleDetail } | null>(null);
  useEffect(() => {
    if (!usage) return;
    let alive = true;
    loadCycleDetail(cycle, usage).then(
      (data) => { if (alive) setDetail({ cycle, data }); },
      () => { if (alive) setDetail(null); },
    );
    return () => { alive = false; };
  }, [cycle, usage]);
  const consoleUrl = org && viewerIsOrgAdmin(state.config) ? perspicaxConsoleUrl(org.org.identity.issuer) : null;
  return (
    <UsageLayout
      cost={(
        <div className="flex min-w-0 flex-col gap-6">
          <CostCard usage={usage} error={error} consoleUrl={consoleUrl} cycle={cycle} onCycle={setCycle} detail={detail?.cycle === cycle ? detail.data : null} />
          {usage && <SpendCapCard />}
        </div>
      )}
      plan={<PlanUsage enabled={planUsageShown({ organization: org !== null, viewUsage: canViewUsage(state.config) })} />}
      rest={<UsageTraces load={fetchMyTraces} />}
    />
  );
}

/** A tiny line of the last 30 days' cost, oldest at the left. */
export function Sparkline({ values }: { values: number[] }) {
  const width = 120;
  const height = 28;
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) return <span aria-hidden="true" className="block h-7 w-[120px] border-b border-hairline/50" />;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-usage-sparkline className="text-accent">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Cost (2026-10-15: on top): this month with its trend, the last 30 days,
 * then the breakdown by bot and by model, folded with its count; for an
 * organization admin, the organization's own usage in its console. */
export function CostCard({ usage, error, consoleUrl = null, cycle = "current", onCycle, detail = null }: {
  usage: PersonalUsage | null;
  error: PersonalUsageError | null;
  consoleUrl?: string | null;
  cycle?: UsageCycle;
  onCycle?: (next: UsageCycle) => void;
  /** The shown cycle's breakdowns once loaded; the previous cycle's totals come from here. */
  detail?: CycleDetail | null;
}) {
  const periods = personalUsagePeriods();
  const previousCycle = cycle === "previous";
  const shownTotal = previousCycle ? detail?.total : usage?.month;
  const current = costOf(shownTotal);
  const trend = usage && !previousCycle ? costTrend(current, costOf(usage.previous)) : null;
  const estimated = (shownTotal?.total.estimatedUsd ?? 0) > 0;
  const status = error === "unavailable" ? (
    <p role="status" className="px-3.5 py-2.5 text-[13px] text-ink-secondary" data-usage-unavailable>{t("usage.personal.unavailable")}</p>
  ) : error ? (
    <p role="alert" className="px-3.5 py-2.5 text-[13px] text-danger">{t("usage.personal.error")}</p>
  ) : !usage ? (
    <p role="status" className="px-3.5 py-2.5 text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>
  ) : usage.month.total.turns === 0 && usage.days30.total.turns === 0 ? (
    <p className="px-3.5 py-2.5 text-[13px] text-ink-secondary" data-usage-empty>{t("usage.personal.empty")}</p>
  ) : null;
  return (
    <div data-settings-card="usage.cost">
      <SettingsGroup title={t("usage.personal.costTitle")} groupId="cost">
        {status}
        {usage && !status && (
          <>
            <DescribedRow
              label={previousCycle ? previousCycleLabel() : t("usage.personal.breakdownSummary")}
              rowId="month"
              description={(
                <>
                  {shownTotal ? t("usage.personal.turns", { turns: shownTotal.total.turns }) : t("planUsage.loading")}
                  {trend !== null && (
                    <> · <span data-usage-trend={trend} className={cn(trend > 0 ? "text-warning" : "text-success")}>
                      {t(trend > 0 ? "usage.personal.trendUp" : trend < 0 ? "usage.personal.trendDown" : "usage.personal.trendSame", { percent: Math.abs(trend) })}
                    </span></>
                  )}
                  {estimated && <span className="block">{t("usage.personal.estimated")}</span>}
                </>
              )}
            >
              {onCycle && (
                <PillSelect<UsageCycle>
                  value={cycle}
                  ariaLabel={t("usage.personal.cycle")}
                  onChange={onCycle}
                  options={[
                    { value: "current", label: t("usage.personal.cycleCurrent") },
                    { value: "previous", label: t("usage.personal.cyclePrevious") },
                  ]}
                />
              )}
              <span className="text-[17px] font-semibold tabular-nums leading-6 text-ink" data-usage-cost>{formatCost(current)}</span>
            </DescribedRow>
            {!previousCycle && (
              <CompactRow label={t("usage.personal.last30")} rowId="days30">
                <Sparkline values={dailyCosts(usage.days30, periods.days30)} />
              </CompactRow>
            )}
            <BreakdownRow
              bots={rankedGroups(previousCycle ? detail?.byBot : usage.byBot)}
              models={rankedGroups(previousCycle ? detail?.byModel : usage.byModel)}
              sources={detail?.byEngine ? rankedGroups(detail.byEngine) : null}
              loading={previousCycle && !detail}
            />
          </>
        )}
        {consoleUrl && (
          <CompactRow label={t("usage.personal.organization")} rowId="organization">
            <a
              href={consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-usage-org-link
              className={PILL}
            >
              {t("usage.personal.openConsole")}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </CompactRow>
        )}
      </SettingsGroup>
    </div>
  );
}

const TOP = 5;

function GroupList({ title, groups, kind }: { title: string; groups: PersonalUsageGroup[]; kind: "bot" | "model" | "source" }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, TOP);
  return (
    <div data-usage-list={kind}>
      <div className="text-[12px] text-ink-secondary">{title}</div>
      {groups.length === 0 ? (
        <p className="mt-1 text-[13px] text-ink-secondary">{t("usage.personal.none")}</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {shown.map((group) => (
            <li key={group.key} className="flex min-h-[30px] items-center gap-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink" title={group.label}>{group.label}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-ink-secondary">{t("usage.personal.turns", { turns: group.turns })}</span>
              <span className="w-20 shrink-0 text-right tabular-nums text-ink">{typeof group.costUsd === "number" ? formatCost(group.costUsd) : "·"}</span>
            </li>
          ))}
        </ul>
      )}
      {groups.length > TOP && (
        <button type="button" onClick={() => setAll((open) => !open)} aria-expanded={all} className="mt-1 min-h-[44px] rounded-md text-[12.5px] text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 md:min-h-0">
          {all ? t("usage.personal.showLess") : t("usage.personal.showAll", { count: groups.length })}
        </button>
      )}
    </div>
  );
}

/** By bot and by model, this month: folded under a count pill (the number
 * of bots). */
function BreakdownRow({ bots, models, sources, loading }: { bots: PersonalUsageGroup[]; models: PersonalUsageGroup[]; sources: PersonalUsageGroup[] | null; loading: boolean }) {
  return (
    <FoldRow
      cardId="usage.breakdown"
      label={t("usage.personal.breakdown")}
      count={bots.length}
      toggleLabel={t("usage.personal.breakdown")}
    >
      <div className="flex flex-col gap-3">
        {loading ? <p role="status" className="text-[13px] text-ink-secondary">{t("planUsage.loading")}</p> : (
          <>
            <GroupList kind="bot" title={t("usage.personal.byBot")} groups={bots} />
            <GroupList kind="model" title={t("usage.personal.byModel")} groups={models} />
            {sources && <GroupList kind="source" title={t("usage.personal.bySource")} groups={sources} />}
          </>
        )}
      </div>
    </FoldRow>
  );
}

/** "septembre 2026": the month a previous-cycle figure is for. */
function previousCycleLabel(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  try {
    return new Intl.DateTimeFormat(usageLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(at);
  } catch {
    return at.toISOString().slice(0, 7);
  }
}

/** Limite de dépenses: the person's own monthly limit. A reached limit stops
 * new turns (the server answers 409 spend_cap) until it is raised here; the
 * owner is the one who can (admin scope). Hidden where the server does not
 * know the route or an organization sets limits in its console. */
const readSpendCap = () => api<PersonalSpendCap>("/api/me/spend-cap");
const writeSpendCap = (monthlyUsd: number | null) => api<PersonalSpendCap>("/api/me/spend-cap", { method: "PUT", body: JSON.stringify({ monthlyUsd }) });

export function SpendCapCard({ read = readSpendCap, write = writeSpendCap, initial = null }: {
  read?: () => Promise<PersonalSpendCap>;
  write?: (monthlyUsd: number | null) => Promise<PersonalSpendCap>;
  initial?: PersonalSpendCap | null;
}) {
  const [data, setData] = useState<PersonalSpendCap | null>(initial);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    read().then((next) => { if (alive) setData(next); }, () => { /* an older server: no card */ });
    return () => { alive = false; };
  }, [read]);
  if (!data || !data.supported) return null;
  const parsed = parseCapInput(text, data.minUsd);
  const save = async (value: number | null) => {
    setBusy(true);
    setFailed(null);
    try {
      setData(await write(value));
      setText("");
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const cap = data.cap;
  return (
    <div data-settings-card="usage.spendCap">
      <SettingsGroup title={t("usage.cap.title")} groupId="spendCap">
        <DescribedRow
          label={t("usage.cap.monthly")}
          rowId="cap-state"
          description={cap
            ? (
              <>
                {t("usage.cap.spent", { spent: formatCost(cap.spentUsd), cap: formatCost(cap.monthlyUsd), percent: cap.percent })}
                <span className={cn("block", cap.exceeded ? "text-danger" : cap.warn ? "text-warning" : undefined)} data-cap-status={cap.exceeded ? "reached" : cap.warn ? "near" : "within"}>
                  {cap.exceeded ? t("usage.cap.reached") : cap.warn ? t("usage.cap.nearing") : t("usage.cap.within")}
                </span>
              </>
            )
            : t("usage.cap.none")}
        >
          {cap && <ConfirmPill label={t("usage.cap.remove")} confirmLabel={t("usage.cap.removeConfirm")} onConfirm={() => void save(null)} disabled={busy} />}
        </DescribedRow>
        <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2.5" data-settings-row="cap-edit">
          <input
            type="text"
            inputMode="decimal"
            className={cn(FIELD, "w-40")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={cap ? t("usage.cap.raisePlaceholder") : t("usage.cap.placeholder")}
            aria-label={t("usage.cap.monthly")}
            aria-invalid={text !== "" && parsed === null}
            data-cap-input
          />
          <button type="button" className={PRIMARY_PILL} disabled={busy || parsed === null} onClick={() => parsed !== null && void save(parsed)} data-cap-save>
            {cap ? t("usage.cap.raise") : t("usage.cap.set")}
          </button>
        </div>
        {text !== "" && parsed === null && <p role="alert" className="px-3.5 pb-2.5 text-[12px] text-danger">{t("usage.cap.invalid", { min: formatCost(data.minUsd) })}</p>}
        {failed && <p role="alert" className="px-3.5 pb-2.5 text-[12px] text-danger">{failed}</p>}
        <p className="px-3.5 pb-2.5 text-[12px] leading-4 text-ink-secondary">{t("usage.cap.hint")}</p>
      </SettingsGroup>
    </div>
  );
}
