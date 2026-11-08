// Settings > Usage (#2080, 2026-11-05): read in three seconds. One headline
// card (this month's cost, its renewal, one thin bar for the spending limit
// or the plan's tightest window, the spending limit row), then
// a Detail group whose rows fold: the breakdown by bot and by model with the
// cycle and the 30-day line, the full plan windows, and the per-job traces
// on a sub-page. With nothing to show it says so once, with Try again.
// Every figure comes from GET /api/me/usage (or, on a 0.5.3 server,
// GET /api/usage?mine=1), which keeps only the requester's turns
// (server/routes/usage.ts) and is open to every member (2026-10-15).
// Per-person tables, organization totals, budgets and sell prices belong to
// the organization's console; no shortcut to it here (2026-11-05).
import { useEffect, useState } from "react";
import { api, ApiError, useStore } from "@/state/store";
import { t, activeLocale } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { canViewUsage } from "@/lib/viewer";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { formatResetDistance, planRows } from "@/lib/plan-usage";
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
import { headlineMeter, PlanUsageView, usePlanUsage, type PlanMeter } from "./PlanUsage";
import { PlanUsageHistoryView, usePlanHistory } from "./PlanUsageHistory";
import { SettingsSubPageRow } from "./SettingsSubPage";
import { ConfirmPill, DescribedRow, FIELD, FoldRow, PILL, PillSelect, PRIMARY_PILL, SettingsGroup } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";
import type { PlanRow } from "@/lib/plan-usage";

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

const readSpendCap = () => api<PersonalSpendCap>("/api/me/spend-cap");
const writeSpendCap = (monthlyUsd: number | null) => api<PersonalSpendCap>("/api/me/spend-cap", { method: "PUT", body: JSON.stringify({ monthlyUsd }) });

/** Every member sees this page (2026-10-15): it shows their own usage only. */
export function UsageSection() {
  const { state, dispatch } = useStore();
  const org = usePerspicaxOrg();
  const [reload, setReload] = useState(0);
  const [usage, setUsage] = useState<PersonalUsage | null>(null);
  const [error, setError] = useState<PersonalUsageError | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    loadPersonalUsage().then(
      (next) => { if (alive) setUsage(next); },
      (failure) => { if (alive) setError(failure instanceof PersonalUsageUnavailable ? "unavailable" : "failed"); },
    );
    return () => { alive = false; };
  }, [reload]);
  const [cap, setCap] = useState<PersonalSpendCap | null>(null);
  useEffect(() => {
    let alive = true;
    readSpendCap().then((next) => { if (alive) setCap(next); }, () => { /* an older server: no limit row */ });
    return () => { alive = false; };
  }, [reload]);
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
  const planShown = planUsageShown({ organization: org !== null, viewUsage: canViewUsage(state.config) });
  const plan = usePlanUsage(planShown);
  // #2757: the history follows each reading of the windows above.
  const planHistory = usePlanHistory(planShown, plan.report?.fetchedAt ? Date.parse(plan.report.fetchedAt) || 0 : 0);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <UsageHeadline
        usage={usage}
        error={error}
        plan={headlineMeter(plan.report, plan.favorite?.id ?? null)}
        planLoading={plan.loading}
        now={plan.now}
        cap={cap}
        onCapChange={setCap}
        onRetry={() => { setReload((count) => count + 1); plan.onRefresh(); }}
      />
      <UsageDetail
        usage={usage}
        cycle={cycle}
        onCycle={setCycle}
        detail={detail?.cycle === cycle ? detail.data : null}
        planCount={plan.unavailable ? 0 : planRows(plan.report).length}
        plan={<PlanUsageView {...plan} bare />}
        planHistory={planShown && !plan.unavailable ? <PlanUsageHistoryView history={planHistory.history} failed={planHistory.failed} now={plan.now} /> : null}
        onOpenTraces={() => dispatch({ type: "toggleAppSettings", open: true, section: "usage", subPage: "usage.traces" })}
      />
    </div>
  );
}

/** "Dec 1", "1er déc.": the day the monthly cost and the limit renew. */
export function renewalDay(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  try {
    const parts = new Intl.DateTimeFormat(usageLocale(), { day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(at);
    const french = activeLocale().startsWith("fr");
    return parts.map((part) => (french && part.type === "day" && part.value === "1" ? "1er" : part.value)).join("").replace(/ /g, "\u00a0");
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function barTone(percent: number, warn: boolean, exceeded: boolean): string {
  if (exceeded || percent >= 100) return "bg-danger";
  if (warn || percent >= 80) return "bg-warning";
  return "bg-accent";
}

function Bar({ kind, percent, tone, label, caption }: { kind: "cap" | "plan"; percent: number; tone: string; label: string; caption: React.ReactNode }) {
  const shown = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <div className="flex flex-col gap-1.5" data-usage-bar={kind}>
      <div className="h-1 overflow-hidden rounded-full bg-inset" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${shown}%` }} />
      </div>
      <p className="text-[12px] tabular-nums text-ink-secondary">{caption}</p>
    </div>
  );
}

/** The headline card: one figure, one date, one bar, then the spending
 * limit. With neither a cost nor a plan window, one grey
 * line with Try again instead of a card per missing figure. */
export function UsageHeadline({ usage, error, plan = null, planLoading = false, now = Date.now(), cap = null, onCapChange, writeCap = writeSpendCap, onRetry }: {
  usage: PersonalUsage | null;
  error: PersonalUsageError | null;
  plan?: { provider: PlanRow; meter: PlanMeter } | null;
  planLoading?: boolean;
  now?: number;
  cap?: PersonalSpendCap | null;
  onCapChange?: (next: PersonalSpendCap) => void;
  writeCap?: (monthlyUsd: number | null) => Promise<PersonalSpendCap>;
  onRetry?: () => void;
}) {
  const nothing = error !== null && !plan && !planLoading;
  const loading = !nothing && !usage && !plan;
  const limit = cap?.supported ? cap.cap : null;
  const resets = plan ? formatResetDistance(plan.meter.resetsAt, now) : null;
  const planCaption = plan && (
    <>
      {t("planUsage.used", { used: Math.round(plan.meter.usedPercent) })} · {plan.provider.name} · {plan.meter.label}
      {resets && <> · {t("planUsage.resetsIn", { when: resets })}</>}
    </>
  );
  return (
    <div data-settings-card="usage.headline">
      <SettingsGroup groupId="headline">
        {nothing ? (
          <div role="status" className="flex flex-wrap items-center gap-3 px-3.5 py-2.5" data-usage-unavailable={error ?? ""}>
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">{t("usage.headline.unavailable")}</p>
            {onRetry && <button type="button" className={PILL} onClick={onRetry} data-usage-retry>{t("planUsage.tryAgain")}</button>}
          </div>
        ) : loading ? (
          <p role="status" className="px-3.5 py-2.5 text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>
        ) : (
          <div className="flex flex-col gap-3 px-3.5 pb-3 pt-2" data-usage-headline>
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[22px] font-semibold leading-7 tabular-nums text-ink" data-usage-cost>
                {usage ? t("usage.headline.thisMonth", { cost: formatCost(costOf(usage.month)) }) : plan ? `${plan.provider.name} · ${plan.meter.label}` : null}
              </span>
              <span className="text-[12.5px] text-ink-secondary" data-usage-renews>
                {usage ? t("usage.headline.renews", { date: renewalDay(new Date(now)) }) : resets ? t("planUsage.resetsIn", { when: resets }) : null}
              </span>
            </div>
            {limit ? (
              <Bar
                kind="cap"
                percent={limit.percent}
                tone={barTone(limit.percent, limit.warn, limit.exceeded)}
                label={t("usage.cap.title")}
                caption={t("usage.cap.spent", { spent: formatCost(limit.spentUsd), cap: formatCost(limit.monthlyUsd), percent: limit.percent })}
              />
            ) : plan ? (
              <Bar kind="plan" percent={plan.meter.usedPercent} tone={barTone(plan.meter.usedPercent, false, false)} label={`${plan.provider.name} · ${plan.meter.label}`} caption={planCaption} />
            ) : null}
          </div>
        )}
        {cap?.supported && <SpendCapRow data={cap} write={writeCap} onChange={onCapChange} />}
      </SettingsGroup>
    </div>
  );
}

/** Limite de dépenses: the person's own monthly limit, a row of the
 * headline. A reached limit stops new turns (the server answers 409
 * spend_cap) until it is raised here. Edit opens the field in place. */
export function SpendCapRow({ data, write = writeSpendCap, onChange, defaultEditing = false }: {
  data: PersonalSpendCap;
  write?: (monthlyUsd: number | null) => Promise<PersonalSpendCap>;
  onChange?: (next: PersonalSpendCap) => void;
  defaultEditing?: boolean;
}) {
  const [editing, setEditing] = useState(defaultEditing);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data.supported) return null;
  const parsed = parseCapInput(text, data.minUsd);
  const save = async (value: number | null) => {
    setBusy(true);
    setFailed(null);
    try {
      onChange?.(await write(value));
      setText("");
      setEditing(false);
    } catch (error) {
      setFailed(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  const cap = data.cap;
  const status = cap && (cap.exceeded || cap.warn) ? (
    <span className={cn("block", cap.exceeded ? "text-danger" : "text-warning")} data-cap-status={cap.exceeded ? "reached" : "near"}>
      {cap.exceeded ? t("usage.cap.reached") : t("usage.cap.nearing")}
    </span>
  ) : cap ? <span className="sr-only" data-cap-status="within">{t("usage.cap.within")}</span> : null;
  return (
    <DescribedRow
      label={t("usage.cap.title")}
      rowId="cap-state"
      description={<>{cap ? t("usage.cap.perMonth", { cap: formatCost(cap.monthlyUsd) }) : t("usage.cap.noneShort")}{status}</>}
      below={editing ? (
        <div className="mt-2 flex flex-col gap-2" data-settings-row="cap-edit">
          <div className="flex flex-wrap items-center gap-2">
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
            {cap && <ConfirmPill label={t("usage.cap.remove")} confirmLabel={t("usage.cap.removeConfirm")} onConfirm={() => void save(null)} disabled={busy} />}
            <button type="button" className={PILL} onClick={() => { setEditing(false); setText(""); setFailed(null); }} data-cap-cancel>{t("common.cancel")}</button>
          </div>
          {text !== "" && parsed === null && <p role="alert" className="text-[12px] text-danger">{t("usage.cap.invalid", { min: formatCost(data.minUsd) })}</p>}
          {failed && <p role="alert" className="text-[12px] text-danger">{failed}</p>}
          <p className="text-[12px] leading-4 text-ink-secondary">{t("usage.cap.hint")}</p>
        </div>
      ) : undefined}
    >
      {!editing && <button type="button" className={PILL} onClick={() => setEditing(true)} data-cap-edit>{t("usage.cap.edit")}</button>}
    </DescribedRow>
  );
}

/** Detail: every row folds. The breakdown (cycle, this month's figure and
 * trend, the 30-day line, by bot, by model, by source), the plan's every
 * window, and the per-job traces on their own sub-page. */
export function UsageDetail({ usage, cycle = "current", onCycle, detail = null, plan = null, planCount = 0, planHistory = null, onOpenTraces }: {
  usage: PersonalUsage | null;
  cycle?: UsageCycle;
  onCycle?: (next: UsageCycle) => void;
  /** The shown cycle's breakdowns once loaded; the previous cycle's totals come from here. */
  detail?: CycleDetail | null;
  plan?: React.ReactNode;
  planCount?: number;
  /** #2757: past plan windows, "% of limit used" per period. */
  planHistory?: React.ReactNode;
  onOpenTraces?: () => void;
}) {
  return (
    <div data-settings-card="usage.detail">
      <SettingsGroup title={t("usage.detail.title")} groupId="detail">
        {usage && <Breakdown usage={usage} cycle={cycle} onCycle={onCycle} detail={detail} />}
        {plan && (
          <FoldRow cardId="usage.planDetail" label={t("usage.plan.title")} count={planCount || undefined}>
            {plan}
          </FoldRow>
        )}
        {planHistory && (
          <FoldRow cardId="usage.planHistory" label={t("planHistory.title")} description={t("planHistory.summary")}>
            {planHistory}
          </FoldRow>
        )}
        {onOpenTraces && (
          <SettingsSubPageRow
            bare
            cardId="usage.traces"
            title={t("usage.trace.title")}
            summary={t("usage.traces.summary")}
            actionLabel={t("usage.traces.open")}
            onOpen={onOpenTraces}
          />
        )}
      </SettingsGroup>
    </div>
  );
}

function Breakdown({ usage, cycle, onCycle, detail }: { usage: PersonalUsage; cycle: UsageCycle; onCycle?: (next: UsageCycle) => void; detail: CycleDetail | null }) {
  const periods = personalUsagePeriods();
  const previousCycle = cycle === "previous";
  const shownTotal = previousCycle ? detail?.total : usage.month;
  const current = costOf(shownTotal);
  const trend = !previousCycle ? costTrend(current, costOf(usage.previous)) : null;
  const estimated = (shownTotal?.total.estimatedUsd ?? 0) > 0;
  const bots = rankedGroups(previousCycle ? detail?.byBot : usage.byBot);
  const models = rankedGroups(previousCycle ? detail?.byModel : usage.byModel);
  const sources = detail?.byEngine ? rankedGroups(detail.byEngine) : null;
  return (
    <FoldRow cardId="usage.breakdown" label={t("usage.personal.breakdown")} count={bots.length} toggleLabel={t("usage.personal.breakdown")}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-settings-row="month">
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
          <span className="text-[13px] text-ink">{previousCycle ? previousCycleLabel() : t("usage.personal.breakdownSummary")}</span>
          <span className="text-[13px] font-semibold tabular-nums text-ink" data-usage-cycle-cost>{formatCost(current)}</span>
          <span className="text-[12px] text-ink-secondary">
            {shownTotal ? t("usage.personal.turns", { turns: shownTotal.total.turns }) : t("planUsage.loading")}
            {trend !== null && (
              <> · <span data-usage-trend={trend} className={cn(trend > 0 ? "text-warning" : "text-success")}>
                {t(trend > 0 ? "usage.personal.trendUp" : trend < 0 ? "usage.personal.trendDown" : "usage.personal.trendSame", { percent: Math.abs(trend) })}
              </span></>
            )}
          </span>
          {estimated && <span className="block w-full text-[12px] text-ink-secondary">{t("usage.personal.estimated")}</span>}
        </div>
        {!previousCycle && (
          <div className="flex items-center gap-3" data-settings-row="days30">
            <span className="text-[12px] text-ink-secondary">{t("usage.personal.last30")}</span>
            <Sparkline values={dailyCosts(usage.days30, periods.days30)} />
          </div>
        )}
        {previousCycle && !detail ? <p role="status" className="text-[13px] text-ink-secondary">{t("planUsage.loading")}</p> : (
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

/** "septembre 2026": the month a previous-cycle figure is for. */
function previousCycleLabel(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  try {
    return new Intl.DateTimeFormat(usageLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(at);
  } catch {
    return at.toISOString().slice(0, 7);
  }
}
