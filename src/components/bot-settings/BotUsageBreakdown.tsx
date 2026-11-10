// The V6 "Statistiques d'usage" (#2612): who uses what on this bot, split by
// account, model, source and person, in $ or in tokens, over 7 days, 30 days
// or the current month. Each row opens its detail (calls, tokens, tools).
// On the Analytics tab it comes after the reference block (#3401): a grey
// group label with its intro behind a help tip, its own period, unit and
// group-by controls in the header row of the chart card, money written as
// the reader writes it.
// Each section is a ranked list with one bar per row in a single hue (the
// rows are their own legend): the top rows, then the rest and the rows at
// zero folded into one "Others (N)" row that opens them (#2671).
// Read from GET /api/bots/:id/analytics?view=breakdown&period=…
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { engineLabel, personLabel } from "@/lib/human-label";
import { activeLocale, documentLanguage, t } from "@/lib/i18n";
import { formatMoney, formatMoneyCompact, formatTokens, hasFiniteCost } from "@/lib/usage";
import type { LocaleKey } from "@/locales";
import { api, useStore, type Bot } from "@/state/store";
import { BOT_USAGE_PERIODS, type BotUsagePeriod } from "../../../shared/bot-analytics";
import type { BotUsageBreakdown, UsageStatsGroup, UsageToolStat } from "../../../shared/telemetry";
import { HelpTip, PILL, SettingsGroup } from "../SettingsPrimitives";
import { OTHER_COLOR, SERIES_SLOTS, TextToggle, UsageChartCard, UsageChartControls, formatTileShare, seriesColor, type ChartSeries } from "../usage-chart/UsageChartCard";

export type BotUsageUnit = "usd" | "tokens";
type Dimension = "account" | "model" | "source" | "person";

const PERIOD_LABEL: Record<string, LocaleKey> = {
  "7": "botProfile.usage.period7",
  "30": "botProfile.usage.period30",
  month: "botProfile.usage.periodMonth",
};
const UNIT_LABEL: Record<BotUsageUnit, LocaleKey> = { usd: "botProfile.usage.unitUsd", tokens: "botProfile.usage.unitTokens" };
const DIMENSION_LABEL: Record<Dimension, LocaleKey> = {
  account: "botProfile.usage.byAccount",
  model: "botProfile.usage.byModel",
  source: "botProfile.usage.bySource",
  person: "botProfile.usage.byPerson",
};
const SOURCE_LABEL: Record<string, LocaleKey> = {
  user: "botProfile.usage.source.user",
  owner: "botProfile.usage.source.owner",
  routine: "botProfile.usage.source.routine",
  bot: "botProfile.usage.source.bot",
  helper: "botProfile.usage.source.helper",
};
/** How the turns were paid, in words; a value not listed here shows no
 * raw word, the provider names the row instead. */
const ACCESS_LABEL: Record<string, LocaleKey> = {
  api: "botProfile.usage.access.api",
  "api-key": "botProfile.usage.access.api",
  subscription: "botProfile.usage.access.subscription",
  "owner-key": "botProfile.usage.access.ownerKey",
  "speaker-key": "botProfile.usage.access.speakerKey",
  "org-key": "botProfile.usage.access.orgKey",
  server: "botProfile.usage.access.server",
};
/** Engine kinds by their product name (brand names stay as they are). */
const PROVIDER: Record<string, string> = {
  claude: "Claude", "claude-code": "Claude Code", codex: "OpenAI", openai: "OpenAI", "openai-chat": "OpenAI",
  grok: "Grok", xai: "xAI", "xai-voice": "xAI", xaiVoice: "xAI", gemini: "Gemini", minimax: "MiniMax", cursor: "Cursor",
};
/** Server engines with a fixed id and no display name. */
const KNOWN_ACCOUNT: Record<string, string> = { xaiVoice: "xAI Voice" };

/** The instance id behind an account row: the server keys it `${instanceId}:${access}` and may hide a raw id from the label (#2679). */
export function instanceOf(group: { key: string; access?: string | null }): string {
  const suffix = group.access ? `:${group.access}` : "";
  return suffix && group.key.endsWith(suffix) ? group.key.slice(0, -suffix.length) : group.key;
}
const PENDING = "...";
/** The rows shown before the rest folds into "Others (N)". */
export const TOP_ROWS = 6;
/** Below this share of the longest bar, a row shows a dot, not a sliver. */
const DOT_BELOW = 0.02;

/** "2026-11-02" as a date that prints the same day in any zone. */
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);
const dayText = (key: string, locale: string, withYear = false) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(dayDate(key));
/** Most weeks back the server answers (shared/bot-analytics parseUsageOffset). */
const MAX_OFFSET = 52;

/** A plain card, as SettingsCard plain: filled, no outline (bot page column rule). */
const STAT_CARD = "flex min-w-0 flex-col rounded-2xl bg-card px-4 py-3";

const tokensOf = (group: Pick<UsageStatsGroup, "inputTokens" | "outputTokens">) => group.inputTokens + group.outputTokens;

/** A group's figure in the shown unit: dollars (0 when unpriced) or tokens. */
export function groupValue(group: UsageStatsGroup, unit: BotUsageUnit): number {
  if (unit === "tokens") return tokensOf(group);
  return hasFiniteCost(group.costUsd) ? group.costUsd : 0;
}

export interface UsageShare { group: UsageStatsGroup; value: number; share: number; percent: number }

/** Each group's share of its section (`share` from 0 to 1, `percent` in
 * whole percents); the groups come back largest first. */
export function shares(groups: readonly UsageStatsGroup[], unit: BotUsageUnit): UsageShare[] {
  const total = groups.reduce((sum, group) => sum + groupValue(group, unit), 0);
  return groups
    .map((group) => {
      const value = groupValue(group, unit);
      const share = total > 0 ? value / total : 0;
      return { group, value, share, percent: Math.round(share * 100) };
    })
    .sort((a, b) => b.value - a.value || b.group.turns - a.group.turns);
}

/** A share in the active locale ("31%", "5.2%"); a sliver reads "<0.1%", never "0%". */
export function formatShare(share: number, locale = documentLanguage(activeLocale())): string {
  return formatTileShare(share, locale);
}

const sumOptional = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));

/** Groups that read the same on screen (same name, same grey line) are one
 * row: the same person under two keys, the same account seen twice. */
export function mergeAlike(groups: readonly UsageStatsGroup[], nameOf: (group: UsageStatsGroup) => string): UsageStatsGroup[] {
  const merged = new Map<string, UsageStatsGroup>();
  for (const group of groups) {
    const id = nameOf(group);
    const seen = merged.get(id);
    if (!seen) {
      merged.set(id, { ...group });
      continue;
    }
    merged.set(id, {
      ...seen,
      turns: seen.turns + group.turns,
      inputTokens: seen.inputTokens + group.inputTokens,
      outputTokens: seen.outputTokens + group.outputTokens,
      cachedInputTokens: seen.cachedInputTokens + group.cachedInputTokens,
      costUsd: hasFiniteCost(seen.costUsd) || hasFiniteCost(group.costUsd) ? (hasFiniteCost(seen.costUsd) ? seen.costUsd : 0) + (hasFiniteCost(group.costUsd) ? group.costUsd : 0) : null,
      toolCalls: sumOptional(seen.toolCalls, group.toolCalls),
      mcpCalls: sumOptional(seen.mcpCalls, group.mcpCalls),
      subagentCalls: sumOptional(seen.subagentCalls, group.subagentCalls),
    });
  }
  return [...merged.values()];
}

/** The rows shown (the top `TOP_ROWS` with a share of at least 1%) and the
 * rest, folded into "Others" (a single leftover row with a share stays shown). */
export function foldRows(rows: readonly UsageShare[], top = TOP_ROWS): { shown: UsageShare[]; others: UsageShare[] } {
  const visible = (row: UsageShare) => row.value > 0 && row.share >= 0.01;
  const shown = rows.filter(visible).slice(0, top);
  const others = rows.filter((row) => !shown.includes(row));
  if (others.length === 1 && others[0]!.value > 0) return { shown: [...shown, others[0]!], others: [] };
  return { shown, others };
}

const titleCase = (word: string) => word.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export interface BotUsageBreakdownViewProps {
  data: BotUsageBreakdown | null;
  period: BotUsagePeriod;
  onPeriod: (period: BotUsagePeriod) => void;
  unit: BotUsageUnit;
  onUnit: (unit: BotUsageUnit) => void;
  /** An account's name from its engine id, never the id itself. */
  accountName?: (instanceId: string) => string;
  /** A model's label from its id, when an engine lists it. */
  modelName?: (modelId: string) => string | undefined;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Row keys shown open (tests and captures); a click toggles. */
  initialOpen?: readonly string[];
  /** How many periods back the answer is (0 is the current one). */
  offset?: number;
  onOffset?: (offset: number) => void;
  /** The chart's first grouping, and the details shown open (captures). */
  initialDimension?: Dimension;
  initialDetails?: boolean;
}

export function BotUsageBreakdownView({ data, period, onPeriod, unit, onUnit, accountName, modelName, loading = false, error = null, onRetry, initialOpen = [], offset = 0, onOffset, initialDimension = "model", initialDetails = false }: BotUsageBreakdownViewProps) {
  const [dimension, setDimension] = useState<Dimension>(initialDimension);
  const [details, setDetails] = useState(initialDetails);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const toggle = (id: string) => setOpen((all) => {
    const next = new Set(all);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const totals = data?.totals ?? null;
  const tokens = totals ? tokensOf(totals) : 0;
  const perMillion = totals && tokens > 0 && hasFiniteCost(totals.costUsd) ? totals.costUsd / (tokens / 1_000_000) : null;
  const currency = data?.currency ?? null;
  /** Money, one way everywhere: an unpriced figure reads "$0" ("0 $"). */
  const usd = (value: number | null) => formatMoney(hasFiniteCost(value) ? value : 0, currency);
  const periodCaption = period === "month" ? t("botProfile.usage.periodMonth") : t("botProfile.usage.lastDays", { days: String(period) });

  const provider = (group: UsageStatsGroup): string | null => {
    const kind = group.engine ?? "";
    if (!kind) return null;
    if (kind === "local") return t("botProfile.usage.provider.local");
    return PROVIDER[kind] ?? titleCase(kind);
  };
  const label = (dimension: Dimension, group: UsageStatsGroup): string => {
    if (dimension === "account") return engineLabel(accountName?.(instanceOf(group)) || KNOWN_ACCOUNT[group.label] || null, group.label);
    if (dimension === "source") return SOURCE_LABEL[group.key] ? t(SOURCE_LABEL[group.key]!) : group.label;
    if (dimension === "person") return group.key === "owner" ? t("botProfile.usage.source.owner") : personLabel(group.label);
    if (dimension === "model") return modelName?.(group.key) ?? group.label;
    return group.label;
  };
  const accessOf = (group: UsageStatsGroup) => (group.access && ACCESS_LABEL[group.access] ? t(ACCESS_LABEL[group.access]!) : null);
  /** The grey line of an account: how it is paid, and its provider when
   * another account of the section has the same name. */
  const subLabels = (dimension: Dimension, groups: readonly UsageStatsGroup[]): Map<UsageStatsGroup, string | null> => {
    const lines = new Map<UsageStatsGroup, string | null>();
    if (dimension !== "account") {
      for (const group of groups) lines.set(group, null);
      return lines;
    }
    const names = new Map<string, number>();
    for (const group of groups) names.set(label(dimension, group), (names.get(label(dimension, group)) ?? 0) + 1);
    const accessCount = new Map<string, number>();
    for (const group of groups) {
      const id = `${label(dimension, group)}\u0000${accessOf(group) ?? ""}`;
      accessCount.set(id, (accessCount.get(id) ?? 0) + 1);
    }
    for (const group of groups) {
      const name = label(dimension, group);
      const access = accessOf(group);
      const clash = (accessCount.get(`${name}\u0000${access ?? ""}`) ?? 0) > 1 || (!access && (names.get(name) ?? 0) > 1);
      const by = provider(group);
      const parts = [access, clash && by && by !== name ? by : null].filter((part): part is string => !!part);
      lines.set(group, parts.length > 0 ? parts.join(" · ") : null);
    }
    return lines;
  };
  const figure = (value: number, group: UsageStatsGroup) => (unit === "usd" ? usd(group.costUsd) : formatTokens(value));

  const controls = (
    <UsageChartControls
      inCard
      periods={BOT_USAGE_PERIODS.map((option) => ({ id: String(option), label: t(PERIOD_LABEL[String(option)]!) }))}
      period={String(period)}
      onPeriod={(id) => onPeriod(id === "month" ? "month" : (Number(id) as BotUsagePeriod))}
      periodAria={t("botProfile.usage.periodAria")}
      extra={<TextToggle options={(["usd", "tokens"] as const).map((option) => ({ id: option, label: t(UNIT_LABEL[option]) }))} value={unit} onChange={(id) => onUnit(id as BotUsageUnit)} ariaLabel={t("botProfile.usage.unitAria")} dataKey="data-bot-usage-unit" />}
      groups={(Object.keys(DIMENSION_LABEL) as Dimension[]).map((id) => ({ id, label: t(DIMENSION_LABEL[id]) }))}
      group={dimension}
      onGroup={(id) => setDimension(id as Dimension)}
      groupAria={t("botProfile.usage.chart.groupAria")}
    />
  );
  const money = (value: number) => (value > 0 && value < 0.01 ? `<${formatMoney(0.01, currency)}` : formatMoney(value, currency));
  const totalLabel = unit === "usd" ? t("botProfile.usage.chart.totalCost") : t("botProfile.usage.chart.totalTokens");
  const chartLabel = t("botProfile.usage.chart.aria", { group: t(DIMENSION_LABEL[dimension]) });

  const chartCard = () => {
    // Loading or failed: the card keeps its header row, so the controls
    // stay in place while an answer is on its way.
    if (!data) {
      return <UsageChartCard controls={controls} rangeLabel={periodCaption} totalLabel={totalLabel} total={PENDING} days={[]} series={[]} formatValue={money} chartLabel={chartLabel} empty={PENDING} />;
    }
    const groups = dimension === "account" ? data.byAccount : dimension === "model" ? data.byModel : dimension === "source" ? data.bySource : data.byPerson;
    const firstLines = subLabels(dimension, groups);
    const idOf = (group: UsageStatsGroup) => `${label(dimension, group)}\u0000${firstLines.get(group) ?? ""}`;
    const merged = mergeAlike(groups, idOf);
    const lines = subLabels(dimension, merged);
    const idOfMerged = (group: UsageStatsGroup) => keyToSeries.get(group.key) ?? idOf(group);
    const all = shares(merged, unit);
    const folded = foldRows(all, SERIES_SLOTS);
    const shown = folded.shown.slice(0, SERIES_SLOTS);
    const rest = all.filter((row) => !shown.includes(row));
    const keyToSeries = new Map<string, string>();
    for (const group of groups) keyToSeries.set(group.key, idOf(group));
    const days = data.days ?? [];
    const valueOf = (day: (typeof days)[number], key: string) => {
      const record = (dimension === "account" ? day.byAccount : dimension === "model" ? day.byModel : dimension === "source" ? day.bySource : day.byPerson)[key];
      return record ? (unit === "usd" ? record.costUsd : record.tokens) : 0;
    };
    const perSeries = new Map<string, number[]>();
    for (const [key, id] of keyToSeries) {
      const values = perSeries.get(id) ?? days.map(() => 0);
      days.forEach((day, index) => { values[index] = (values[index] ?? 0) + valueOf(day, key); });
      perSeries.set(id, values);
    }
    const restIds = new Set(rest.map((row) => idOfMerged(row.group)));
    const otherValues = days.map((_, index) => [...perSeries].filter(([id]) => restIds.has(id)).reduce((sum, [, values]) => sum + (values[index] ?? 0), 0));
    const series: ChartSeries[] = shown.map((row, index) => ({
      id: row.group.key,
      label: label(dimension, row.group),
      sub: lines.get(row.group) ?? null,
      share: row.share,
      values: perSeries.get(idOfMerged(row.group)) ?? days.map(() => 0),
      color: seriesColor(index),
    }));
    if (rest.some((row) => row.value > 0)) {
      series.push({ id: "others", label: t("botProfile.usage.others", { count: String(rest.length) }), share: rest.reduce((sum, row) => sum + row.share, 0), values: otherValues, color: OTHER_COLOR });
    }
    const locale = documentLanguage(activeLocale());
    const first = days[0]?.day;
    const last = days[days.length - 1]?.day;
    const rangeLabel = first && last
      ? first === last ? dayText(first, locale, true) : t("botProfile.usage.chart.rangeTo", { from: dayText(first, locale), to: dayText(last, locale, true) })
      : periodCaption;
    const formatValue = unit === "usd" ? money : (value: number) => formatTokens(value);
    return (
      <UsageChartCard
        controls={controls}
        rangeLabel={rangeLabel}
        onPrev={onOffset && offset < MAX_OFFSET ? () => onOffset(offset + 1) : undefined}
        onNext={onOffset && offset > 0 ? () => onOffset(offset - 1) : undefined}
        totalLabel={totalLabel}
        total={totals ? (unit === "usd" ? usd(totals.turns === 0 ? 0 : totals.costUsd) : formatTokens(tokens)) : PENDING}
        days={days.map((day) => ({ key: day.day, label: dayText(day.day, locale) }))}
        series={series}
        formatValue={formatValue}
        formatAxis={unit === "usd" ? (value) => formatMoneyCompact(value, currency, locale) : undefined}
        chartLabel={chartLabel}
        empty={t("botProfile.usage.empty")}
      />
    );
  };

  const section = (dimension: Dimension, groups: readonly UsageStatsGroup[]) => {
    const firstLines = subLabels(dimension, groups);
    const merged = mergeAlike(groups, (group) => `${label(dimension, group)}\u0000${firstLines.get(group) ?? ""}`);
    const lines = subLabels(dimension, merged);
    const { shown, others } = foldRows(shares(merged, unit));
    const othersValue = others.reduce((sum, row) => sum + row.value, 0);
    const othersShare = others.reduce((sum, row) => sum + row.share, 0);
    const longest = Math.max(0, ...shown.map((row) => row.value), othersValue);
    const othersId = `${dimension}:others`;
    const othersOpen = open.has(othersId);

    const bar = (value: number, muted: boolean) => {
      const width = longest > 0 ? value / longest : 0;
      return (
        <span aria-hidden="true" data-bot-usage-bar="" className="hidden h-1.5 w-[34%] shrink-0 items-center sm:flex">
          {width >= DOT_BELOW
            ? <span className={cn("block h-full rounded-full", muted ? "bg-ink-tertiary" : "bg-accent")} style={{ width: `${width * 100}%` }} />
            : value > 0
              ? <span data-bot-usage-dot="" className={cn("block size-1.5 rounded-full", muted ? "bg-ink-tertiary" : "bg-accent")} />
              : null}
        </span>
      );
    };
    const row = ({ group, value, share }: UsageShare, nested = false) => {
      const id = `${dimension}:${group.key}`;
      const expanded = open.has(id);
      const sub = lines.get(group) ?? null;
      return (
        <div key={group.key} data-bot-usage-row={dimension} className="min-w-0">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => toggle(id)}
            className={cn("flex min-h-[44px] w-full min-w-0 items-center gap-3 py-2 pr-3 text-left transition-colors hover:bg-hover", nested ? "pl-8" : "pl-4")}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] leading-5 text-ink">{label(dimension, group)}</span>
              {sub ? <span className="truncate text-[12px] leading-4 text-ink-secondary">{sub}</span> : null}
            </span>
            {bar(value, nested)}
            <span className="flex w-20 shrink-0 flex-col items-end">
              <span data-bot-usage-value="" className="tabular-nums text-[14px] leading-5 text-ink">{figure(value, group)}</span>
              <span data-bot-usage-percent="" className="tabular-nums text-[12px] leading-4 text-ink-secondary">{formatShare(share)}</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
          </button>
          {expanded && (
            <dl data-bot-usage-detail="" className={cn("mb-2 grid grid-cols-2 gap-x-6 gap-y-1 pr-10 text-[12px] leading-4 sm:grid-cols-3", nested ? "pl-8" : "pl-4")}>
              <Detail label={t("botProfile.usage.calls")} value={String(group.turns)} />
              <Detail label={t("botProfile.usage.cost")} value={usd(group.costUsd)} />
              <Detail label={t("botProfile.usage.input")} value={formatTokens(group.inputTokens)} />
              <Detail label={t("botProfile.usage.output")} value={formatTokens(group.outputTokens)} />
              <Detail label={t("botProfile.usage.cached")} value={formatTokens(group.cachedInputTokens)} />
              {group.toolCalls !== undefined && <Detail label={t("botProfile.usage.toolCalls")} value={formatTokens(group.toolCalls)} />}
              {group.mcpCalls !== undefined && <Detail label={t("botProfile.usage.mcpCalls")} value={formatTokens(group.mcpCalls)} />}
              {group.subagentCalls !== undefined && <Detail label={t("botProfile.usage.subagentCalls")} value={formatTokens(group.subagentCalls)} />}
            </dl>
          )}
        </div>
      );
    };

    return (
      <div key={dimension} data-bot-usage-dimension={dimension} className="min-w-0">
        <SettingsGroup title={t(DIMENSION_LABEL[dimension])} groupId={`bot-usage-${dimension}`}>
          {shown.length === 0 && others.length === 0 ? (
            <div data-bot-usage-empty="" className="flex min-h-[44px] items-center px-4 py-2 text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.empty")}</div>
          ) : (
            <>
              {shown.map((entry) => row(entry))}
              {others.length > 0 && (
                <div data-bot-usage-others-group="" className="min-w-0">
                  <button
                    type="button"
                    data-bot-usage-others=""
                    aria-expanded={othersOpen}
                    onClick={() => toggle(othersId)}
                    className="flex min-h-[44px] w-full min-w-0 items-center gap-3 py-2 pl-4 pr-3 text-left transition-colors hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink-secondary">{t("botProfile.usage.others", { count: String(others.length) })}</span>
                    {bar(othersValue, true)}
                    <span className="flex w-20 shrink-0 flex-col items-end">
                      <span className="tabular-nums text-[14px] leading-5 text-ink-secondary">{unit === "usd" ? formatMoney(othersValue, currency) : formatTokens(othersValue)}</span>
                      <span className="tabular-nums text-[12px] leading-4 text-ink-secondary">{formatShare(othersShare)}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", othersOpen && "rotate-90")} />
                  </button>
                  {othersOpen && others.map((entry) => row(entry, true))}
                </div>
              )}
            </>
          )}
        </SettingsGroup>
      </div>
    );
  };

  const title = t("botProfile.usage.title");
  return (
    <SettingsGroup
      title={title}
      groupId="bot-usage-breakdown"
      plain
      accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botProfile.usage.intro")}</HelpTip>}
    >
    <div data-bot-usage-breakdown="" aria-busy={loading || undefined} className="flex min-w-0 flex-col gap-5">

      {error && (
        <div role="note" data-bot-usage-error="" className="flex min-w-0 flex-wrap items-center gap-3 px-1 text-[13px] leading-[18px] text-ink-secondary">
          <span className="min-w-0 flex-1">{t("botProfile.analytics.error", { message: error })}</span>
          {onRetry && <button type="button" className={PILL} onClick={onRetry}>{t("botProfile.retry")}</button>}
        </div>
      )}

      {chartCard()}

      <div className="grid gap-3 sm:grid-cols-3">
        <div data-bot-usage-card="cost" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.cost")}</div>
          <div className="mt-1 tabular-nums text-[20px] leading-7 text-ink">{totals ? usd(totals.turns === 0 ? 0 : totals.costUsd) : PENDING}</div>
          <div className="text-[12px] leading-4 text-ink-secondary">{periodCaption}</div>
        </div>
        <div data-bot-usage-card="tokens" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.tokens")}</div>
          <div className="mt-1 tabular-nums text-[20px] leading-7 text-ink">{totals ? formatTokens(tokens) : PENDING}</div>
          {totals && (
            <div className="text-[12px] leading-4 text-ink-secondary">
              {t("botProfile.usage.tokensSplit", { input: formatTokens(totals.inputTokens), output: formatTokens(totals.outputTokens), cached: formatTokens(totals.cachedInputTokens) })}
            </div>
          )}
        </div>
        <div data-bot-usage-card="calls" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.calls")}</div>
          <div className="mt-1 tabular-nums text-[20px] leading-7 text-ink">{totals ? formatTokens(totals.turns) : PENDING}</div>
          {perMillion !== null && <div className="text-[12px] leading-4 text-ink-secondary">{t("botProfile.usage.perMillion", { cost: formatMoney(perMillion, currency) })}</div>}
        </div>
      </div>

      {data && (
        <>
          <button type="button" data-bot-usage-details="" aria-expanded={details} onClick={() => setDetails((value) => !value)} className="flex min-h-[44px] items-center gap-1 self-start rounded-full px-1 text-[14px] leading-5 text-ink-secondary transition-colors hover:text-ink">
            <ChevronRight size={16} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", details && "rotate-90")} />
            {t("botProfile.usage.chart.details")}
          </button>
          {details && (
            <>
              {section("account", data.byAccount)}
              {section("model", data.byModel)}
              {section("source", data.bySource)}
              {section("person", data.byPerson)}
              {data.tools.length > 0 && <ToolList tools={data.tools} />}
            </>
          )}
        </>
      )}
    </div>
    </SettingsGroup>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="truncate text-ink-secondary">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}

const TOOLS_SHOWN = 10;

function ToolList({ tools }: { tools: readonly UsageToolStat[] }) {
  return (
    <div data-bot-usage-tools="" className="min-w-0">
      <SettingsGroup title={t("botProfile.usage.tools")} groupId="bot-usage-tools">
        {tools.slice(0, TOOLS_SHOWN).map((tool) => (
          <div key={`${tool.kind}:${tool.mcpServer ?? ""}:${tool.tool}`} data-bot-usage-tool="" className="flex min-h-[44px] min-w-0 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">{tool.mcpServer ? `${tool.mcpServer} · ${tool.tool}` : tool.tool}</span>
            {tool.errors > 0 && <span className="shrink-0 tabular-nums text-[12px] leading-4 text-ink-secondary">{tool.errors === 1 ? t("botProfile.usage.toolErrorOne") : t("botProfile.usage.toolErrors", { count: String(tool.errors) })}</span>}
            <span className="w-24 shrink-0 text-right tabular-nums text-[13px] leading-5 text-ink-secondary">{t("botProfile.usage.toolCallCount", { count: String(tool.calls) })}</span>
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}

interface Loaded { attempt: number; data: BotUsageBreakdown | null; error: string | null }

export function BotUsageBreakdownSection({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [period, setPeriod] = useState<BotUsagePeriod>(30);
  const [unit, setUnit] = useState<BotUsageUnit>("usd");
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Loaded>>({});
  const key = `${bot.id}:${period}:${offset}`;

  useEffect(() => {
    let live = true;
    const slot = `${bot.id}:${period}:${offset}`;
    api<BotUsageBreakdown>(`/api/bots/${encodeURIComponent(bot.id)}/analytics?view=breakdown&period=${period}&offset=${offset}`).then(
      (data) => {
        if (live) setAnswers((all) => ({ ...all, [slot]: { attempt, data, error: null } }));
      },
      (failure: unknown) => {
        if (!live) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        setAnswers((all) => ({ ...all, [slot]: { attempt, data: all[slot]?.data ?? null, error: message } }));
      },
    );
    return () => {
      live = false;
    };
  }, [bot.id, period, offset, attempt]);

  const answer = answers[key];
  const retrying = Boolean(answer?.error) && answer!.attempt !== attempt;
  return (
    <BotUsageBreakdownView
      data={answer?.data ?? null}
      period={period}
      onPeriod={(next) => { setPeriod(next); setOffset(0); }}
      offset={offset}
      onOffset={setOffset}
      unit={unit}
      onUnit={setUnit}
      accountName={(id) => state.instances.find((entry) => entry.instanceId === id)?.displayName ?? ""}
      modelName={(id) => state.instances.flatMap((entry) => entry.models?.options ?? []).find((option) => option.id === id)?.label}
      loading={!answer || retrying}
      error={retrying ? null : answer?.error ?? null}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
