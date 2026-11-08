// #2698: the Proactivity group of the bot's Analytics tab, under Usage and in
// the same range (7 / 30 / 90 days): wakes, proposals accepted / declined /
// unanswered, writes, cost of the wakes, estimated time saved and precision.
// From GET /api/bots/:id/proactive-metrics (shared/proactive-metrics.ts).
//
// Left out entirely (never greyed) when the caller may not read the bot-wide
// figures (the route answers 404) or when the bot is not proactive and has
// nothing recorded in the range.
import { useEffect, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import { formatUsd } from "@/lib/usage";
import { api, type Bot } from "@/state/store";
import type { BotAnalyticsDays } from "../../../shared/bot-analytics";
import { proactiveModeFor } from "../../../shared/proactive-mode";
import type { ProactiveMetrics } from "../../../shared/proactive-metrics";
import { CompactRow, DescribedRow, HelpTip, SettingsGroup } from "../SettingsPrimitives";

const FIGURE = "tabular-nums text-[13px] leading-[18px] text-ink-secondary";
const STRONG = "tabular-nums text-[13px] leading-[18px] text-ink";

function count(value: number): string {
  return new Intl.NumberFormat(activeLocale()).format(value);
}

function percent(value: number): string {
  return new Intl.NumberFormat(activeLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function hours(minutes: number): string {
  return `${new Intl.NumberFormat(activeLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(minutes / 60)} h`;
}

export function BotProactiveMetricsView({ data, proactive }: { data: ProactiveMetrics | null; proactive: boolean }) {
  if (!data) return null;
  const totals = data.totals;
  const recorded = totals.wakes + totals.proposed + totals.writes > 0;
  if (!proactive && !recorded) return null;
  const help = (
    <HelpTip label={t("settings.moreAbout", { title: t("botProfile.proactive.saved") })}>
      {t("botProfile.proactive.savedHelp", { report: data.minutesPerReport, write: data.minutesPerWrite, accepted: data.minutesPerAccepted })}
    </HelpTip>
  );
  return (
    <SettingsGroup title={t("botProfile.proactive.title")} groupId="botProactiveMetrics">
      {!recorded ? (
        <div data-bot-proactive-empty="" className="flex min-h-[44px] items-center px-4 py-2 text-[13px] leading-[18px] text-ink-secondary">{t("botProfile.proactive.empty")}</div>
      ) : (
        <>
          <DescribedRow
            label={t("botProfile.proactive.wakes")}
            description={t("botProfile.proactive.wakesDetail", { reported: count(totals.reported), quiet: count(totals.quiet), failed: count(totals.failed) })}
          >
            <span className={STRONG}>{count(totals.wakes)}</span>
          </DescribedRow>
          <DescribedRow
            label={t("botProfile.proactive.proposals")}
            description={t("botProfile.proactive.proposalsDetail", { accepted: count(totals.accepted), declined: count(totals.declined), expired: count(totals.expired) })}
          >
            <span className={STRONG}>{count(totals.proposed)}</span>
          </DescribedRow>
          <DescribedRow label={t("botProfile.proactive.precision")} description={t("botProfile.proactive.precisionDetail")}>
            <span className={STRONG}>{totals.precision === null ? "..." : percent(totals.precision)}</span>
          </DescribedRow>
          <CompactRow label={t("botProfile.proactive.writes")}>
            <span className={FIGURE}>{count(totals.writes)}</span>
          </CompactRow>
          <CompactRow label={t("botProfile.proactive.cost")}>
            <span className={FIGURE}>{totals.costRuns > 0 ? formatUsd(totals.cost) : "..."}</span>
          </CompactRow>
          <CompactRow label={t("botProfile.proactive.saved")}>
            <span className="flex items-center gap-1.5">
              <span className={FIGURE}>{hours(totals.minutesSaved)}</span>
              {help}
            </span>
          </CompactRow>
        </>
      )}
    </SettingsGroup>
  );
}

export function BotProactiveMetricsGroup({ bot, days }: { bot: Bot; days: BotAnalyticsDays }) {
  const [answers, setAnswers] = useState<Record<string, ProactiveMetrics | null>>({});
  const key = `${bot.id}:${days}`;
  useEffect(() => {
    let live = true;
    api<ProactiveMetrics>(`/api/bots/${encodeURIComponent(bot.id)}/proactive-metrics?days=${days}`).then(
      (data) => { if (live) setAnswers((all) => ({ ...all, [`${bot.id}:${days}`]: data })); },
      () => { if (live) setAnswers((all) => ({ ...all, [`${bot.id}:${days}`]: null })); },
    );
    return () => { live = false; };
  }, [bot.id, days]);
  return <BotProactiveMetricsView data={answers[key] ?? null} proactive={proactiveModeFor(bot) !== "off"} />;
}
