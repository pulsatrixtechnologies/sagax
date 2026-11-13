// Settings > Usage (#2080, 2026-11-05; the reference's layout since #4095):
// group titles over one card each. My plan: this month's cost and its
// renewal. Usage limits (refresh in its title row): the spending limit and
// each engine's windows, a large percent with its bar and renewal line each.
// The bots' usage: the cycle's cost, a segmented control (by source, by bot,
// by model), the coloured share bar with its legend, the daily cost chart.
// Detail: the plan history and the per-job traces on a sub-page. With
// nothing to show it says so once, with Try again.
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
import { planRows } from "@/lib/plan-usage";
import { formatMoneyCompact } from "@/lib/usage";
import type { LocaleKey } from "@/locales";
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
import { LimitMeter, PlanUsageView, usePlanUsage } from "./PlanUsage";
import { PlanUsageHistoryView, usePlanHistory } from "./PlanUsageHistory";
import { SettingsSubPageRow } from "./SettingsSubPage";
import { ConfirmPill, DescribedRow, FIELD, FoldRow, PILL, PRIMARY_PILL, SettingsGroup } from "./SettingsPrimitives";
import { PageSegment } from "./content-page";
import { formatTileShare, seriesColor, UsageChartCard } from "./usage-chart/UsageChartCard";
import { readableError } from "@/lib/plain-error";

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
  const hasPlan = !plan.unavailable && planRows(plan.report).length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <UsagePlan
        usage={usage}
        error={error}
        hasPlan={hasPlan}
        planLoading={plan.loading}
        now={plan.now}
        onRetry={() => { setReload((count) => count + 1); plan.onRefresh(); }}
      />
      <PlanUsageView {...plan} leading={cap?.supported ? <SpendCapRow data={cap} onChange={setCap} /> : null} />
      {usage && <UsageBreakdown usage={usage} cycle={cycle} onCycle={setCycle} detail={detail?.cycle === cycle ? detail.data : null} />}
      <UsageDetail
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
    return parts.map((part) => (french && part.type === "day" && part.value === "1" ? "1er" : part.value)).join("").replace(/ /g, " ");
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function barTone(percent: number, warn: boolean, exceeded: boolean): string {
  if (exceeded || percent >= 100) return "bg-danger";
  if (warn || percent >= 80) return "bg-warning";
  return "bg-accent";
}

/** My plan (#4095, the reference's first group): the day the month renews,
 * as a row of one card. The month's cost is said once, as the large figure
 * of the bots' usage group, and the renewal once, here (not again under the
 * spending limit). With neither a cost nor a plan
 * window, one quiet line with Try again instead of a card per missing
 * figure; while the first answer is on its way, one loading line. */
/** The page's headline (the renewal row of My plan) keeps the Settings type
 * scale, 13/18 regular with tabular figures (owner rule 2026-11-08); only the
 * large percent and cost figures use 22/28, as figures (#4113, #4123). */
export const USAGE_HEADLINE_TYPE = "text-[13px] font-normal leading-[18px] tabular-nums text-ink";

export function UsagePlan({ usage, error, hasPlan = false, planLoading = false, now = Date.now(), onRetry }: {
  usage: PersonalUsage | null;
  error: PersonalUsageError | null;
  /** An engine reports its plan windows (the limits group then speaks for the page). */
  hasPlan?: boolean;
  planLoading?: boolean;
  now?: number;
  onRetry?: () => void;
}) {
  const nothing = error !== null && !hasPlan && !planLoading;
  const loading = !nothing && !usage && error === null;
  return (
    <div data-settings-card="usage.headline" className="contents">
      <SettingsGroup title={t("usage.group.plan")} groupId="usage-plan">
        {nothing ? (
          <div role="status" className="flex flex-wrap items-center gap-3 px-3.5 py-2.5" data-usage-unavailable={error ?? ""}>
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">{t("usage.headline.unavailable")}</p>
            {onRetry && <button type="button" className={PILL} onClick={onRetry} data-usage-retry>{t("planUsage.tryAgain")}</button>}
          </div>
        ) : loading ? (
          <p role="status" className="px-3.5 py-2.5 text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>
        ) : usage ? (
          <DescribedRow label={t("usage.headline.renews", { date: renewalDay(new Date(now)) })} rowId="renewal" labelClassName={USAGE_HEADLINE_TYPE} />
        ) : null}
      </SettingsGroup>
    </div>
  );
}

/** Limite de dépenses: the person's own monthly limit, the first row of
 * Usage limits. A set limit shows in the shared limit form under its row
 * (#4095). A reached limit stops new turns (the server answers 409
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
  const meter = cap ? (
    <div className="mt-3">
      <LimitMeter
        data-usage-bar="cap"
        percent={cap.percent}
        tone={barTone(cap.percent, cap.warn, cap.exceeded)}
        ariaLabel={t("usage.cap.title")}
        end={t("usage.cap.spent", { spent: formatCost(cap.spentUsd), cap: formatCost(cap.monthlyUsd), percent: cap.percent })}
      />
    </div>
  ) : null;
  return (
    <DescribedRow
      label={t("usage.cap.title")}
      rowId="cap-state"
      description={<>{cap ? t("usage.cap.perMonth", { cap: formatCost(cap.monthlyUsd) }) : t("usage.cap.noneShort")}{status}</>}
      below={meter || editing ? (
        <>
          {meter}
          {editing && (
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
          )}
        </>
      ) : undefined}
    >
      {!editing && <button type="button" className={PILL} onClick={() => setEditing(true)} data-cap-edit>{t("usage.cap.edit")}</button>}
    </DescribedRow>
  );
}

export type UsageSegment = "source" | "bot" | "model";

const SEGMENT_LABEL: Record<UsageSegment, LocaleKey> = {
  source: "usage.personal.bySource",
  bot: "usage.personal.byBot",
  model: "usage.personal.byModel",
};

/** "Nov 12", "12 nov.": a day of the chart, the same in any zone. */
function chartDay(key: string, withYear = false): string {
  try {
    return new Intl.DateTimeFormat(usageLocale(), { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  } catch {
    return key;
  }
}

function rangeDays(range: { from: string; to: string }): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${range.from}T00:00:00Z`); at <= Date.parse(`${range.to}T00:00:00Z`); at += 86_400_000) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/** The reference's "<app> usage" group (#4095): one card. Its head is the
 * shown cycle's cost in large figures with the turns and the trend under it,
 * and the segmented control at the right (by source, by bot, by model); then
 * the coloured share bar, its legend (each group's cost, share and turns),
 * and the daily cost chart, whose arrows step between this cycle and the
 * previous one. Figures and lists are the ones the page always read. */
export function UsageBreakdown({ usage, cycle = "current", onCycle, detail = null, initialSegment = "source" }: {
  usage: PersonalUsage;
  cycle?: UsageCycle;
  onCycle?: (next: UsageCycle) => void;
  /** The shown cycle's breakdowns once loaded; the previous cycle's totals come from here. */
  detail?: CycleDetail | null;
  initialSegment?: UsageSegment;
}) {
  const [segment, setSegment] = useState<UsageSegment>(initialSegment);
  const previousCycle = cycle === "previous";
  const shownTotal = previousCycle ? detail?.total : usage.month;
  const current = costOf(shownTotal);
  const trend = !previousCycle ? costTrend(current, costOf(usage.previous)) : null;
  const estimated = (shownTotal?.total.estimatedUsd ?? 0) > 0;
  const sources = detail?.byEngine ? rankedGroups(detail.byEngine) : null;
  const waiting = previousCycle && !detail;
  const lists: Record<UsageSegment, PersonalUsageGroup[] | null> = {
    source: sources,
    bot: rankedGroups(previousCycle ? detail?.byBot : usage.byBot),
    model: rankedGroups(previousCycle ? detail?.byModel : usage.byModel),
  };
  const offered = (["source", "bot", "model"] as const).filter((id) => lists[id] !== null);
  const active: UsageSegment = lists[segment] ? segment : "bot";
  const groups = lists[active] ?? [];
  const range = previousCycle ? previousCyclePeriod() : personalUsagePeriods().days30;
  const values = dailyCosts(previousCycle ? detail?.total : usage.days30, range);
  const days = rangeDays(range);
  const rangeLabel = days.length > 0 ? t("botProfile.usage.chart.rangeTo", { from: chartDay(days[0]!), to: chartDay(days[days.length - 1]!, true) }) : "";
  const groupCost = (group: PersonalUsageGroup) => (typeof group.costUsd === "number" && Number.isFinite(group.costUsd) ? group.costUsd : 0);
  const sum = groups.reduce((total, group) => total + groupCost(group), 0);
  const color = (index: number) => seriesColor(index);
  return (
    <div data-settings-card="usage.breakdown" className="contents">
      <SettingsGroup title={t("usage.group.breakdown")} groupId="usage-breakdown">
        <div className="usage-chart flex min-w-0 flex-col gap-5 px-3.5 pb-2 pt-2" data-usage-breakdown={active}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3" data-settings-row="month">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[22px] leading-7 tabular-nums text-ink" data-usage-cycle-cost="">{formatCost(current)}</span>
              <span className="text-[12px] leading-4 text-ink-tertiary">
                {previousCycle ? previousCycleLabel() : t("usage.personal.breakdownSummary")}
                {" · "}
                {shownTotal ? t("usage.personal.turns", { turns: shownTotal.total.turns }) : t("planUsage.loading")}
                {trend !== null && (
                  <> · <span data-usage-trend={trend} className={cn(trend > 0 ? "text-warning" : "text-success")}>
                    {t(trend > 0 ? "usage.personal.trendUp" : trend < 0 ? "usage.personal.trendDown" : "usage.personal.trendSame", { percent: Math.abs(trend) })}
                  </span></>
                )}
              </span>
              {estimated && <span className="text-[12px] leading-4 text-ink-tertiary">{t("usage.personal.estimated")}</span>}
            </div>
            <div data-usage-segments={active} className="shrink-0">
              <PageSegment<UsageSegment>
                label={t("usage.breakdown.segmentAria")}
                value={active}
                options={offered.map((id) => ({ value: id, label: t(SEGMENT_LABEL[id]) }))}
                onChange={setSegment}
              />
            </div>
          </div>
          {waiting ? <p role="status" className="text-[13px] text-ink-secondary">{t("planUsage.loading")}</p> : (
            <div className="flex min-w-0 flex-col gap-3">
              <div aria-hidden="true" data-usage-share-bar="" className="flex h-2 min-w-0 gap-0.5 overflow-clip rounded-[4px] bg-inset">
                {groups.map((group, index) => groupCost(group) > 0 && (
                  <span key={group.key} className="block h-full min-w-[2px]" style={{ flexGrow: groupCost(group), flexBasis: 0, backgroundColor: color(index) }} />
                ))}
              </div>
              {groups.length === 0 ? (
                <p className="text-[13px] text-ink-secondary">{t("usage.personal.none")}</p>
              ) : (
                <ul data-usage-list={active} className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(136px,1fr))] gap-x-4 gap-y-3 p-0">
                  {groups.map((group, index) => (
                    <li key={group.key} className="flex min-w-0 flex-col gap-0.5" data-usage-group={group.key}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color(index) }} />
                        <span className="min-w-0 truncate text-[12px] leading-4 text-ink-secondary" title={group.label}>{group.label}</span>
                      </span>
                      <span className="text-[12px] leading-4 tabular-nums text-ink">
                        {typeof group.costUsd === "number" ? formatCost(group.costUsd) : "·"}
                        {sum > 0 && <> · {formatTileShare(groupCost(group) / sum)}</>}
                      </span>
                      <span className="text-[11px] leading-4 tabular-nums text-ink-tertiary">{t("usage.personal.turns", { turns: group.turns })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!waiting && (
            <UsageChartCard
              className="rounded-none bg-transparent px-0 pb-0 pt-0"
              rangeLabel={previousCycle ? previousCycleLabel() : rangeLabel}
              onPrev={onCycle && !previousCycle ? () => onCycle("previous") : undefined}
              onNext={onCycle && previousCycle ? () => onCycle("current") : undefined}
              days={days.map((key) => ({ key, label: chartDay(key) }))}
              series={[{ id: "cost", label: t("botProfile.usage.cost"), share: 1, values, color: color(0) }]}
              formatValue={formatCost}
              formatAxis={(value) => formatMoneyCompact(value, null, usageLocale())}
              legend="none"
              chartLabel={t("usage.breakdown.chartAria")}
              empty={t("usage.personal.none")}
            />
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}

/** Detail: the plan windows' history and the per-job traces on their own sub-page. */
export function UsageDetail({ planHistory = null, onOpenTraces }: {
  /** #2757: past plan windows, "% of limit used" per period. */
  planHistory?: React.ReactNode;
  onOpenTraces?: () => void;
}) {
  return (
    <div data-settings-card="usage.detail" className="contents">
      <SettingsGroup title={t("usage.detail.title")} groupId="detail">
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

/** "septembre 2026": the month a previous-cycle figure is for. */
function previousCycleLabel(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  try {
    return new Intl.DateTimeFormat(usageLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(at);
  } catch {
    return at.toISOString().slice(0, 7);
  }
}
