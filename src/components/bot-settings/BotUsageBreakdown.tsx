// The V6 "Statistiques d'usage" (#2612): who uses what on this bot, split by
// account, model, source and person, in $ or in tokens, over 7 days, 30 days
// or the current month. Each row opens its detail (calls, tokens, tools).
// Read from GET /api/bots/:id/analytics?view=breakdown&period=…
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { CHART_PALETTE } from "@/lib/chart-palette";
import { cn } from "@/lib/cn";
import { engineLabel, personLabel } from "@/lib/human-label";
import { t } from "@/lib/i18n";
import { formatTokens, formatUsd, hasFiniteCost } from "@/lib/usage";
import type { LocaleKey } from "@/locales";
import { api, useStore, type Bot } from "@/state/store";
import { BOT_USAGE_PERIODS, type BotUsagePeriod } from "../../../shared/bot-analytics";
import type { BotUsageBreakdown, UsageStatsGroup, UsageToolStat } from "../../../shared/telemetry";
import { useSkinScheme } from "../rich-ui";
import { PILL } from "../SettingsPrimitives";
import { SEGMENTS, segment } from "./BotAnalyticsSection";

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
const ACCESS_LABEL: Record<string, LocaleKey> = {
  api: "botProfile.usage.access.api",
  subscription: "botProfile.usage.access.subscription",
};
const PENDING = "...";

const STAT_CARD = "flex min-w-0 flex-col rounded-2xl border border-hairline bg-card px-4 py-3";

const tokensOf = (group: Pick<UsageStatsGroup, "inputTokens" | "outputTokens">) => group.inputTokens + group.outputTokens;

/** A group's figure in the shown unit: dollars (0 when unpriced) or tokens. */
export function groupValue(group: UsageStatsGroup, unit: BotUsageUnit): number {
  if (unit === "tokens") return tokensOf(group);
  return hasFiniteCost(group.costUsd) ? group.costUsd : 0;
}

/** Each group's share of its section, in whole percents; the groups come
 * back largest first. */
export function shares(groups: readonly UsageStatsGroup[], unit: BotUsageUnit): Array<{ group: UsageStatsGroup; value: number; percent: number }> {
  const total = groups.reduce((sum, group) => sum + groupValue(group, unit), 0);
  return groups
    .map((group) => {
      const value = groupValue(group, unit);
      return { group, value, percent: total > 0 ? Math.round((value / total) * 100) : 0 };
    })
    .sort((a, b) => b.value - a.value || b.group.turns - a.group.turns);
}

const usd = (value: number | null) => (hasFiniteCost(value) ? formatUsd(value) : "-");

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
}

export function BotUsageBreakdownView({ data, period, onPeriod, unit, onUnit, accountName, modelName, loading = false, error = null, onRetry, initialOpen = [] }: BotUsageBreakdownViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const colors = CHART_PALETTE[useSkinScheme(frameRef)];
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const toggle = (id: string) => setOpen((all) => {
    const next = new Set(all);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const totals = data?.totals ?? null;
  const tokens = totals ? tokensOf(totals) : 0;
  const perMillion = totals && tokens > 0 && hasFiniteCost(totals.costUsd) ? totals.costUsd / (tokens / 1_000_000) : null;
  const periodCaption = period === "month" ? t("botProfile.usage.periodMonth") : t("botProfile.usage.lastDays", { days: String(period) });

  const label = (dimension: Dimension, group: UsageStatsGroup): string => {
    if (dimension === "account") return engineLabel(accountName?.(group.label) ?? null, group.label);
    if (dimension === "source") return SOURCE_LABEL[group.key] ? t(SOURCE_LABEL[group.key]!) : group.label;
    if (dimension === "person") return group.key === "owner" ? t("botProfile.usage.source.owner") : personLabel(group.label);
    if (dimension === "model") return modelName?.(group.key) ?? group.label;
    return group.label;
  };
  const subLabel = (dimension: Dimension, group: UsageStatsGroup): string | null => {
    if (dimension !== "account") return null;
    if (!group.access) return null;
    return ACCESS_LABEL[group.access] ? t(ACCESS_LABEL[group.access]!) : group.access;
  };
  const figure = (value: number, group: UsageStatsGroup) => (unit === "usd" ? usd(group.costUsd) : formatTokens(value));

  const section = (dimension: Dimension, groups: readonly UsageStatsGroup[]) => {
    const rows = shares(groups, unit);
    const top = Math.max(0, ...rows.map((row) => row.value));
    return (
      <section key={dimension} data-bot-usage-dimension={dimension} className="flex min-w-0 flex-col gap-2">
        <h3 className="px-1 text-[13px] leading-[18px] text-ink-secondary">{t(DIMENSION_LABEL[dimension])}</h3>
        <div className="flex min-w-0 flex-col rounded-2xl border border-hairline bg-card px-3 py-3">
          {rows.length === 0 ? (
            <div data-bot-usage-empty="" className="px-1 py-1 text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.empty")}</div>
          ) : (
            <>
              <div aria-hidden="true" className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-control">
                {rows.map(({ group, percent }, index) => percent > 0
                  ? <span key={group.key} style={{ width: `${percent}%`, background: colors[index % colors.length] }} />
                  : null)}
              </div>
              <ul className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 px-1 text-[12px] leading-4 text-ink-secondary">
                {rows.map(({ group, percent }, index) => (
                  <li key={group.key} className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: colors[index % colors.length] }} />
                    <span className="truncate">{label(dimension, group)}</span>
                    <span className="tabular-nums">{percent} %</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex min-w-0 flex-col divide-y divide-hairline">
                {rows.map(({ group, value, percent }, index) => {
                  const id = `${dimension}:${group.key}`;
                  const expanded = open.has(id);
                  const sub = subLabel(dimension, group);
                  const name = label(dimension, group);
                  return (
                    <div key={group.key} data-bot-usage-row={dimension} className="min-w-0">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggle(id)}
                        className="flex min-h-[48px] w-full min-w-0 items-center gap-3 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-hover"
                      >
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: colors[index % colors.length] }} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[14px] leading-5 text-ink">{name}</span>
                          {sub ? <span className="truncate text-[12px] leading-4 text-ink-secondary">{sub}</span> : null}
                        </span>
                        <span aria-hidden="true" className="hidden h-1.5 w-[34%] shrink-0 overflow-hidden rounded-full bg-control sm:block">
                          <span className="block h-full rounded-full" style={{ width: `${top > 0 ? (value / top) * 100 : 0}%`, background: colors[index % colors.length] }} />
                        </span>
                        <span className="flex w-20 shrink-0 flex-col items-end">
                          <span data-bot-usage-value="" className="tabular-nums text-[14px] leading-5 text-ink">{figure(value, group)}</span>
                          <span data-bot-usage-percent="" className="tabular-nums text-[12px] leading-4 text-ink-secondary">{percent} %</span>
                        </span>
                        <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
                      </button>
                      {expanded && (
                        <dl data-bot-usage-detail="" className="mb-2 ml-6 grid grid-cols-2 gap-x-6 gap-y-1 px-1 text-[12px] leading-4 sm:grid-cols-3">
                          <Detail label={t("botProfile.usage.calls")} value={formatTokens(group.turns)} />
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
                })}
              </div>
            </>
          )}
        </div>
      </section>
    );
  };

  return (
    <div ref={frameRef} data-bot-usage-breakdown="" aria-busy={loading || undefined} className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-1 px-1">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">{t("botProfile.usage.title")}</h2>
        <p className="text-[13px] leading-5 text-ink-secondary">{t("botProfile.usage.intro")}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("botProfile.usage.periodAria")} className={SEGMENTS}>
          {BOT_USAGE_PERIODS.map((option) => (
            <button key={option} type="button" data-bot-usage-period={option} aria-pressed={option === period} onClick={() => onPeriod(option)} className={segment(option === period)}>
              {t(PERIOD_LABEL[String(option)]!)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("botProfile.usage.unitAria")} className={SEGMENTS}>
          {(["usd", "tokens"] as const).map((option) => (
            <button key={option} type="button" data-bot-usage-unit={option} aria-pressed={option === unit} onClick={() => onUnit(option)} className={segment(option === unit)}>
              {t(UNIT_LABEL[option])}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="note" data-bot-usage-error="" className="flex min-w-0 flex-wrap items-center gap-3 px-1 text-[13px] leading-[18px] text-ink-secondary">
          <span className="min-w-0 flex-1">{t("botProfile.analytics.error", { message: error })}</span>
          {onRetry && <button type="button" className={PILL} onClick={onRetry}>{t("botProfile.retry")}</button>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div data-bot-usage-card="cost" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.cost")}</div>
          <div className="mt-1 tabular-nums text-[26px] leading-8 text-ink">{totals ? usd(totals.turns === 0 ? 0 : totals.costUsd) : PENDING}</div>
          <div className="text-[12px] leading-4 text-ink-secondary">{periodCaption}</div>
        </div>
        <div data-bot-usage-card="tokens" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.tokens")}</div>
          <div className="mt-1 tabular-nums text-[26px] leading-8 text-ink">{totals ? formatTokens(tokens) : PENDING}</div>
          {totals && (
            <div className="text-[12px] leading-4 text-ink-secondary">
              {t("botProfile.usage.tokensSplit", { input: formatTokens(totals.inputTokens), output: formatTokens(totals.outputTokens), cached: formatTokens(totals.cachedInputTokens) })}
            </div>
          )}
        </div>
        <div data-bot-usage-card="calls" className={STAT_CARD}>
          <div className="text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.calls")}</div>
          <div className="mt-1 tabular-nums text-[26px] leading-8 text-ink">{totals ? formatTokens(totals.turns) : PENDING}</div>
          {perMillion !== null && <div className="text-[12px] leading-4 text-ink-secondary">{t("botProfile.usage.perMillion", { cost: formatUsd(perMillion) })}</div>}
        </div>
      </div>

      {data && (
        <>
          {section("account", data.byAccount)}
          {section("model", data.byModel)}
          {section("source", data.bySource)}
          {section("person", data.byPerson)}
          {data.tools.length > 0 && <ToolList tools={data.tools} />}
        </>
      )}
    </div>
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
    <section data-bot-usage-tools="" className="flex min-w-0 flex-col gap-2">
      <h3 className="px-1 text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.usage.tools")}</h3>
      <div className="flex min-w-0 flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-card px-4 py-1">
        {tools.slice(0, TOOLS_SHOWN).map((tool) => (
          <div key={`${tool.kind}:${tool.mcpServer ?? ""}:${tool.tool}`} data-bot-usage-tool="" className="flex min-h-[40px] min-w-0 items-center gap-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">{tool.mcpServer ? `${tool.mcpServer} · ${tool.tool}` : tool.tool}</span>
            {tool.errors > 0 && <span className="shrink-0 tabular-nums text-[12px] leading-4 text-ink-secondary">{tool.errors === 1 ? t("botProfile.usage.toolErrorOne") : t("botProfile.usage.toolErrors", { count: String(tool.errors) })}</span>}
            <span className="w-24 shrink-0 text-right tabular-nums text-[13px] leading-5 text-ink-secondary">{t("botProfile.usage.toolCallCount", { count: String(tool.calls) })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Loaded { attempt: number; data: BotUsageBreakdown | null; error: string | null }

export function BotUsageBreakdownSection({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [period, setPeriod] = useState<BotUsagePeriod>(30);
  const [unit, setUnit] = useState<BotUsageUnit>("usd");
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Loaded>>({});
  const key = `${bot.id}:${period}`;

  useEffect(() => {
    let live = true;
    const slot = `${bot.id}:${period}`;
    api<BotUsageBreakdown>(`/api/bots/${encodeURIComponent(bot.id)}/analytics?view=breakdown&period=${period}`).then(
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
  }, [bot.id, period, attempt]);

  const answer = answers[key];
  const retrying = Boolean(answer?.error) && answer!.attempt !== attempt;
  return (
    <BotUsageBreakdownView
      data={answer?.data ?? null}
      period={period}
      onPeriod={setPeriod}
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
