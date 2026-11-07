// Analytics: the bot profile page's Analytics tab, drawn like Grok Bot's:
// the range at the left and a 7 / 30 / 90 days switch at the right, two
// cards side by side (Messages, Hours saved) with a per-day area chart, the
// usage figures of the range (turns, tokens, cost, conversations, routines),
// then the people who use the bot most. Everything comes from
// GET /api/bots/:id/analytics (shared/bot-analytics.ts): nothing is
// estimated here, a value the ledger does not carry stays "...".
//
// It replaces the old Usage section of the profile page; its "All bots"
// pill still opens the app-wide Usage settings.
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { botUsage, costCaption, formatTokens, formatUsd, hasFiniteCost } from "@/lib/usage";
import type { LocaleKey } from "@/locales";
import { api, useStore, type Bot } from "@/state/store";
import { analyticsRange, BOT_ANALYTICS_DAYS, type BotAnalytics, type BotAnalyticsDays, type BotAnalyticsUser } from "../../../shared/bot-analytics";
import { CompactRow, DescribedRow, HelpTip, PILL, SettingsGroup } from "../SettingsPrimitives";

export type BotAnalyticsSort = "messages" | "hoursSaved";
type Billing = "metered" | "subscription" | undefined;

const RANGE_LABEL: Record<BotAnalyticsDays, LocaleKey> = {
  7: "botProfile.analytics.range7",
  30: "botProfile.analytics.range30",
  90: "botProfile.analytics.range90",
};
const SORT_LABEL: Record<BotAnalyticsSort, LocaleKey> = {
  messages: "botProfile.analytics.messages",
  hoursSaved: "botProfile.analytics.hoursSaved",
};
const TOP_USERS_SHOWN = 10;
const PENDING = "...";

const SEGMENTS = "inline-flex shrink-0 rounded-full bg-control p-0.5";
const segment = (selected: boolean) => cn(
  "rounded-full px-3 py-1 text-[13px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none",
  selected ? "bg-hover text-ink" : "text-ink-secondary hover:text-ink",
);
const STAT_CARD = "flex min-w-0 flex-col rounded-2xl bg-card px-4 py-3";
const FIGURE = "tabular-nums text-[13px] leading-[18px] text-ink-secondary";

// ---------------------------------------------------------------- formatting

function locale(): string {
  return activeLocale();
}

/** A YYYY-MM-DD day key as the reader's short date ("Nov 6", "6 nov."). The
 * key is already the server's calendar day, so it is drawn in UTC. */
function dayLabel(key: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  try {
    return new Intl.DateTimeFormat(locale(), { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  } catch {
    return key;
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(locale()).format(value);
}

function formatHours(value: number): string {
  return `${new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} h`;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The day keys the range covers: the server's when it answered, else the
 * reader's own calendar so the label does not jump while loading. */
function rangeDays(data: BotAnalytics | null, days: BotAnalyticsDays, now: number): string[] {
  if (data && data.series.length > 0) return data.series.map((point) => point.day);
  return analyticsRange(days, now, localTimeZone()).dayKeys;
}

/** "Oct 31 - Nov 6" (a simple hyphen, as Grok Bot writes it). */
export function rangeLabel(dayKeys: string[]): string {
  const first = dayKeys[0];
  const last = dayKeys[dayKeys.length - 1];
  if (!first || !last) return "";
  return first === last ? dayLabel(first) : `${dayLabel(first)} - ${dayLabel(last)}`;
}

const UUID_LIKE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,})$/i;

/** The name to show: an id the directory could not name is never shown as
 * is when it is an opaque GUID (it stays in the tooltip). */
function displayName(user: BotAnalyticsUser): string {
  const name = user.name.trim();
  return !name || UUID_LIKE.test(name) ? t("botProfile.analytics.unknownUser") : name;
}

export function initials(name: string): string {
  const base = name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
  const words = base.split(/[\s._-]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/^[^\p{L}\p{N}]+/u, "")][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/** Top users in the chosen order, at most ten: messages first (then hours),
 * or hours saved first (a person without a duration last, then messages). */
export function sortTopUsers(users: BotAnalyticsUser[], sort: BotAnalyticsSort): BotAnalyticsUser[] {
  const hours = (user: BotAnalyticsUser) => user.hoursSaved ?? -1;
  return [...users]
    .sort((a, b) => sort === "messages"
      ? b.messages - a.messages || hours(b) - hours(a) || a.name.localeCompare(b.name)
      : hours(b) - hours(a) || b.messages - a.messages || a.name.localeCompare(b.name))
    .slice(0, TOP_USERS_SHOWN);
}

// ---------------------------------------------------------------- chart

const CHART_W = 300;
const CHART_H = 96;
const CHART_PAD = 4;

/** A smooth line through the points that never overshoots between two
 * days (Fritsch-Carlson monotone cubic), so a zero day stays on the floor. */
export function chartPaths(values: number[]): { line: string; area: string } {
  const count = values.length;
  if (count === 0) return { line: "", area: "" };
  const max = Math.max(0, ...values);
  const y = (value: number) => {
    const top = CHART_PAD;
    const bottom = CHART_H - CHART_PAD;
    return max > 0 ? bottom - (Math.max(0, value) / max) * (bottom - top) : bottom;
  };
  const round = (value: number) => Math.round(value * 100) / 100;
  if (count === 1) {
    const level = round(y(values[0]!));
    const line = `M0 ${level} L${CHART_W} ${level}`;
    return { line, area: `${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z` };
  }
  const xs = values.map((_, index) => (index / (count - 1)) * CHART_W);
  const ys = values.map(y);
  const slopes = xs.slice(1).map((x, index) => (ys[index + 1]! - ys[index]!) / (x - xs[index]!));
  const tangents = ys.map((_, index) => {
    if (index === 0) return slopes[0]!;
    if (index === count - 1) return slopes[count - 2]!;
    const before = slopes[index - 1]!;
    const after = slopes[index]!;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index]!;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index]! / slope;
    const b = tangents[index + 1]! / slope;
    const length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }
  let line = `M${round(xs[0]!)} ${round(ys[0]!)}`;
  for (let index = 0; index < count - 1; index += 1) {
    const step = (xs[index + 1]! - xs[index]!) / 3;
    line += ` C${round(xs[index]! + step)} ${round(ys[index]! + tangents[index]! * step)} ${round(xs[index + 1]! - step)} ${round(ys[index + 1]! - tangents[index + 1]! * step)} ${round(xs[index + 1]!)} ${round(ys[index + 1]!)}`;
  }
  return { line, area: `${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z` };
}

/** The labels under the chart: every day of a week, else first, middle and
 * last. Inside a week only the day number, plus the month on the 1st. */
function axisLabels(dayKeys: string[]): Array<{ key: string; at: number; label: string }> {
  const count = dayKeys.length;
  if (count === 0) return [];
  const at = (index: number) => (count === 1 ? 0 : index / (count - 1));
  if (count <= 7) {
    return dayKeys.map((key, index) => {
      const edge = index === 0 || index === count - 1 || key.endsWith("-01");
      return { key, at: at(index), label: edge ? dayLabel(key) : dayLabel(key, { day: "numeric" }) };
    });
  }
  const middle = Math.floor((count - 1) / 2);
  return [0, middle, count - 1].map((index) => ({ key: dayKeys[index]!, at: at(index), label: dayLabel(dayKeys[index]!) }));
}

function AreaChart({ metric, dayKeys, values, format }: { metric: string; dayKeys: string[]; values: number[]; format: (value: number) => string }) {
  const { line, area } = chartPaths(values);
  const labels = axisLabels(dayKeys);
  const slot = values.length > 0 ? CHART_W / values.length : CHART_W;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="text-accent">
        <svg
          role="img"
          aria-label={t("botProfile.analytics.perDay", { metric })}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="block h-24 w-full overflow-visible"
          data-bot-analytics-chart=""
        >
          <path d={area} fill="currentColor" fillOpacity={0.12} stroke="none" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {values.map((value, index) => (
            <rect
              key={dayKeys[index] ?? index}
              x={values.length === 1 ? 0 : Math.max(0, (index / (values.length - 1)) * CHART_W - slot / 2)}
              y={0}
              width={slot}
              height={CHART_H}
              fill="none"
              pointerEvents="all"
            >
              <title>{`${dayKeys[index] ? dayLabel(dayKeys[index]) : ""} · ${format(value)}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div aria-hidden="true" className="relative h-4 text-[11px] leading-4 text-ink-tertiary">
        {labels.map(({ key, at, label }, index) => {
          const first = index === 0;
          const last = index === labels.length - 1 && labels.length > 1;
          return (
            <span
              key={key}
              className={cn("absolute top-0 whitespace-nowrap tabular-nums", !first && !last && "-translate-x-1/2")}
              style={last ? { right: 0 } : { left: `${at * 100}%` }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChartPlaceholder() {
  return (
    <div aria-hidden="true" className="mt-3 flex flex-col gap-1.5">
      <div className="h-24" />
      <div className="h-4" />
    </div>
  );
}

// ---------------------------------------------------------------- view

export interface BotAnalyticsViewProps {
  /** The answer of the range on screen; null while it loads or after an error. */
  data: BotAnalytics | null;
  days: BotAnalyticsDays;
  onDays: (days: BotAnalyticsDays) => void;
  sort: BotAnalyticsSort;
  onSort: (sort: BotAnalyticsSort) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onAllBots: () => void;
  /** How the bot's engine bills, for the cost caption. */
  billing?: Billing;
  /** The bot has no usage on record at all (its tasks' counters): an empty
   * range then says so instead of a card of zeros. */
  neverUsed?: boolean;
  /** The clock the loading range label reads (tests pin it). */
  now?: number;
}

export function BotAnalyticsView({ data, days, onDays, sort, onSort, loading = false, error = null, onRetry, onAllBots, billing, neverUsed = false, now = Date.now() }: BotAnalyticsViewProps) {
  const dayKeys = rangeDays(data, days, now);
  const totals = data?.totals ?? null;
  const estimated = data ? data.hoursSavedBasis !== null : false;
  const messagesLabel = t("botProfile.analytics.messages");
  const hoursLabel = t("botProfile.analytics.hoursSaved");
  const hoursHelp = (
    <HelpTip label={t("settings.moreAbout", { title: hoursLabel })}>{t("botProfile.analytics.hoursSavedHelp")}</HelpTip>
  );
  const figure = (value: string | null) => (totals && value !== null ? value : PENDING);
  const cost = totals
    ? totals.turns === 0
      ? { shown: formatUsd(0), caption: t("botPanel.usage.costCaption", { caption: costCaption(billing) }) }
      : hasFiniteCost(totals.costUsd)
        ? { shown: formatUsd(totals.costUsd), caption: t("botPanel.usage.costCaption", { caption: costCaption(billing) }) }
        : { shown: "-", caption: t("botPanel.usage.noPrice") }
    : { shown: PENDING, caption: t("botPanel.usage.costCaption", { caption: costCaption(billing) }) };
  const users = data ? sortTopUsers(data.topUsers, sort) : [];
  const empty = neverUsed && totals !== null && totals.turns === 0;

  return (
    <div className="flex min-w-0 flex-col gap-6" data-bot-analytics="" aria-busy={loading || undefined}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-1">
        <span data-bot-analytics-range-label="" className="tabular-nums text-[13px] leading-[18px] text-ink-secondary">{rangeLabel(dayKeys)}</span>
        <div role="group" aria-label={t("botProfile.analytics.rangeAria")} data-bot-analytics-range="" className={SEGMENTS}>
          {BOT_ANALYTICS_DAYS.map((option) => (
            <button
              key={option}
              type="button"
              data-bot-analytics-days={option}
              aria-pressed={option === days}
              onClick={() => onDays(option)}
              className={segment(option === days)}
            >
              {t(RANGE_LABEL[option])}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="note" data-bot-analytics-error="" className="flex min-w-0 flex-wrap items-center gap-3 px-1 text-[13px] leading-[18px] text-ink-secondary">
          <span className="min-w-0 flex-1">{t("botProfile.analytics.error", { message: error })}</span>
          {onRetry && <button type="button" className={PILL} onClick={onRetry}>{t("botProfile.retry")}</button>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div data-bot-analytics-card="messages" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{messagesLabel}</div>
          <div className="mt-1 tabular-nums text-[28px] leading-8 text-ink">{figure(totals ? formatCount(totals.messages) : null)}</div>
          {data
            ? <AreaChart metric={messagesLabel} dayKeys={dayKeys} values={data.series.map((point) => point.messages)} format={formatCount} />
            : <ChartPlaceholder />}
        </div>
        <div data-bot-analytics-card="hoursSaved" className={STAT_CARD}>
          <div className="flex items-center gap-1.5 text-[13px] leading-[18px] text-ink-secondary">
            <span>{hoursLabel}</span>
            {hoursHelp}
          </div>
          {data && !estimated ? (
            <div data-bot-analytics-estimating="" className="mt-1 text-[13px] leading-8 text-ink-secondary">{t("botProfile.analytics.stillEstimating")}</div>
          ) : (
            <>
              <div className="mt-1 tabular-nums text-[28px] leading-8 text-ink">{figure(totals && hasFiniteCost(totals.hoursSaved) ? formatHours(totals.hoursSaved) : null)}</div>
              {data
                ? <AreaChart metric={hoursLabel} dayKeys={dayKeys} values={data.series.map((point) => point.hoursSaved ?? 0)} format={formatHours} />
                : <ChartPlaceholder />}
            </>
          )}
        </div>
      </div>

      <SettingsGroup
        title={t("botPanel.usage.title")}
        groupId="botUsage"
        accessory={
          <button type="button" data-bot-analytics-all-bots="" className={cn(PILL, "ml-auto shrink-0")} onClick={onAllBots}>
            {t("botPanel.usage.allBots")}
          </button>
        }
      >
        {empty ? (
          <div data-bot-analytics-empty="" className="flex min-h-[44px] items-center px-4 py-2 text-[13px] leading-[18px] text-ink-secondary">{t("botPanel.usage.empty")}</div>
        ) : (
          <>
            <CompactRow label={t("botPanel.usage.turns")}>
              <span className={FIGURE}>{figure(totals ? formatCount(totals.turns) : null)}</span>
            </CompactRow>
            <CompactRow label={t("botPanel.usage.tokens")}>
              <span className={FIGURE} title={totals ? formatCount(totals.tokens) : undefined}>{figure(totals ? formatTokens(totals.tokens) : null)}</span>
            </CompactRow>
            <DescribedRow label={t("botPanel.usage.cost")} description={cost.caption}>
              <span className="tabular-nums text-[13px] leading-[18px] text-ink">{cost.shown}</span>
            </DescribedRow>
            <CompactRow label={t("botProfile.analytics.conversations")}>
              <span className={FIGURE}>{figure(totals ? formatCount(totals.conversations) : null)}</span>
            </CompactRow>
            <CompactRow label={t("botProfile.analytics.routinesRun")}>
              <span className={FIGURE}>{figure(totals ? formatCount(totals.routinesRun) : null)}</span>
            </CompactRow>
            <CompactRow label={t("botProfile.analytics.routinesFailed")}>
              <span className={FIGURE}>{figure(totals ? formatCount(totals.routinesFailed) : null)}</span>
            </CompactRow>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t("botProfile.analytics.topUsers")}
        groupId="botTopUsers"
        accessory={
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <div role="group" aria-label={t("botProfile.analytics.sortBy")} data-bot-analytics-sort="" className={SEGMENTS}>
              {(Object.keys(SORT_LABEL) as BotAnalyticsSort[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  data-bot-analytics-sort-by={option}
                  aria-pressed={option === sort}
                  onClick={() => onSort(option)}
                  className={segment(option === sort)}
                >
                  {t(SORT_LABEL[option])}
                </button>
              ))}
            </div>
            {hoursHelp}
          </div>
        }
      >
        {!data ? (
          <div className="flex min-h-[44px] items-center px-4 py-2 text-[13px] leading-[18px] text-ink-secondary">{PENDING}</div>
        ) : users.length === 0 ? (
          <div data-bot-analytics-no-users="" className="flex min-h-[44px] items-center px-4 py-2 text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.analytics.noUsers")}</div>
        ) : (
          users.map((user) => {
            const name = displayName(user);
            return (
              <div key={user.principalId} data-bot-analytics-user="" className="flex min-h-[44px] min-w-0 items-center gap-3 px-4 py-2">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-control text-[12px] text-ink-secondary">{initials(name)}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink" title={user.principalId === name ? undefined : user.principalId}>{name}</span>
                <span className={cn("w-16 shrink-0 text-right tabular-nums text-[13px] leading-[18px]", sort === "messages" ? "text-ink" : "text-ink-secondary")} title={messagesLabel}>
                  {formatCount(user.messages)}
                </span>
                <span className={cn("w-16 shrink-0 text-right tabular-nums text-[13px] leading-[18px]", sort === "hoursSaved" ? "text-ink" : "text-ink-secondary")} title={hoursLabel}>
                  {estimated && hasFiniteCost(user.hoursSaved) ? formatHours(user.hoursSaved) : PENDING}
                </span>
              </div>
            );
          })
        )}
      </SettingsGroup>
    </div>
  );
}

// ---------------------------------------------------------------- section

interface Loaded { attempt: number; data: BotAnalytics | null; error: string | null }

export function BotAnalyticsSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [days, setDays] = useState<BotAnalyticsDays>(7);
  const [sort, setSort] = useState<BotAnalyticsSort>("messages");
  const [attempt, setAttempt] = useState(0);
  // One answer per bot and range: switching back shows the last one while
  // the new request runs, a first visit shows "..." until it lands.
  const [answers, setAnswers] = useState<Record<string, Loaded>>({});
  const rangeKey = `${bot.id}:${days}`;

  useEffect(() => {
    let live = true;
    api<BotAnalytics>(`/api/bots/${encodeURIComponent(bot.id)}/analytics?days=${days}`).then(
      (data) => {
        if (live) setAnswers((all) => ({ ...all, [`${bot.id}:${days}`]: { attempt, data, error: null } }));
      },
      (failure: unknown) => {
        if (!live) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        setAnswers((all) => {
          const key = `${bot.id}:${days}`;
          return { ...all, [key]: { attempt, data: all[key]?.data ?? null, error: message } };
        });
      },
    );
    return () => {
      live = false;
    };
  }, [bot.id, days, attempt]);

  const answer = answers[rangeKey];
  const retrying = Boolean(answer?.error) && answer!.attempt !== attempt;
  const instance = state.instances.find((entry) => entry.instanceId === bot.modelSelection.instanceId);

  return (
    <BotAnalyticsView
      data={answer?.data ?? null}
      days={days}
      onDays={setDays}
      sort={sort}
      onSort={setSort}
      loading={!answer || retrying}
      error={retrying ? null : answer?.error ?? null}
      onRetry={() => setAttempt((value) => value + 1)}
      onAllBots={() => dispatch({ type: "toggleAppSettings", open: true, section: "usage" })}
      billing={instance?.snapshot.billing}
      neverUsed={botUsage(bot).turns === 0}
    />
  );
}
