// #2698: the Proactivity group of the bot's Analytics tab, under Usage and in
// the same range (7 / 30 / 90 days): wakes, proposals accepted / declined /
// unanswered, writes, cost of the wakes, estimated time saved and precision.
// #4250 (S9): then its usefulness (signals told, answered and ignored, the
// median time to answer, turns avoided by pre-checks, tokens per answered
// signal) and the same figures per routine, in a group of their own.
// From GET /api/bots/:id/proactive-metrics (shared/proactive-metrics.ts).
//
// Left out entirely (never greyed) when the caller may not read the bot-wide
// figures (the route answers 404) or when the bot is not proactive and has
// nothing recorded in the range.
import { useEffect, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import { formatMoney, formatTokens } from "@/lib/usage";
import { formatDuration } from "@/lib/usage-trace";
import { api, type Bot } from "@/state/store";
import type { BotAnalyticsDays } from "../../../shared/bot-analytics";
import { proactiveModeFor } from "../../../shared/proactive-mode";
import type { ProactiveMetrics, RoutineUsefulness, SignalUsefulness } from "../../../shared/proactive-metrics";
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

function usefulnessRecorded(figures: SignalUsefulness | undefined): boolean {
  return Boolean(figures && figures.told + figures.turnsAvoided + figures.tokens > 0);
}

function UsefulnessRows({ figures, ignoredAfterHours }: { figures: SignalUsefulness; ignoredAfterHours: number }) {
  return (
    <>
      <DescribedRow
        label={t("botProfile.proactive.signals")}
        description={t("botProfile.proactive.signalsDetail", { answered: count(figures.answered), ignored: count(figures.ignored) })}
        help={t("botProfile.proactive.signalsHelp", { hours: ignoredAfterHours })}
        rowId="botProactiveSignals"
      >
        <span className={STRONG}>{count(figures.told)}</span>
      </DescribedRow>
      <CompactRow label={t("botProfile.proactive.answerTime")} rowId="botProactiveAnswerTime">
        <span className={FIGURE}>{figures.medianAnswerMs === null ? "..." : formatDuration(figures.medianAnswerMs)}</span>
      </CompactRow>
      <CompactRow label={t("botProfile.proactive.avoided")} rowId="botProactiveAvoided">
        <span className={FIGURE}>{count(figures.turnsAvoided)}</span>
      </CompactRow>
      <DescribedRow
        label={t("botProfile.proactive.tokensPerAnswer")}
        description={t("botProfile.proactive.tokensDetail", { tokens: formatTokens(figures.tokens) })}
        rowId="botProactiveTokens"
      >
        <span className={STRONG}>{figures.tokensPerAnswered === null ? "..." : formatTokens(figures.tokensPerAnswered)}</span>
      </DescribedRow>
    </>
  );
}

function routineLine(row: RoutineUsefulness): string {
  const parts = [t("botProfile.proactive.routineDetail", { told: count(row.told), answered: count(row.answered), ignored: count(row.ignored), avoided: count(row.turnsAvoided) })];
  if (row.medianAnswerMs !== null) parts.push(t("botProfile.proactive.routineMedian", { time: formatDuration(row.medianAnswerMs) }));
  return parts.join(", ");
}

export function RoutineUsefulnessGroup({ routines }: { routines: RoutineUsefulness[] }) {
  if (!routines.length) return null;
  return (
    <SettingsGroup title={t("botProfile.proactive.routines")} groupId="botProactiveRoutines">
      {routines.map((row) => (
        <DescribedRow key={row.routineId} label={row.name || t("botProfile.proactive.unnamedRoutine")} description={routineLine(row)} rowId={`botProactiveRoutine-${row.routineId}`}>
          <span className={FIGURE}>{row.tokensPerAnswered === null ? "..." : t("botProfile.proactive.routineTokens", { tokens: formatTokens(row.tokensPerAnswered) })}</span>
        </DescribedRow>
      ))}
    </SettingsGroup>
  );
}

export function BotProactiveMetricsView({ data, proactive }: { data: ProactiveMetrics | null; proactive: boolean }) {
  if (!data) return null;
  const totals = data.totals;
  const useful = usefulnessRecorded(data.usefulness);
  const recorded = totals.wakes + totals.proposed + totals.writes > 0 || useful;
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
            <span className={FIGURE}>{totals.costRuns > 0 ? formatMoney(totals.cost) : "..."}</span>
          </CompactRow>
          <CompactRow label={t("botProfile.proactive.saved")}>
            <span className="flex items-center gap-1.5">
              <span className={FIGURE}>{hours(totals.minutesSaved)}</span>
              {help}
            </span>
          </CompactRow>
          {data.usefulness && useful ? <UsefulnessRows figures={data.usefulness} ignoredAfterHours={data.ignoredAfterHours ?? 24} /> : null}
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
  const data = answers[key] ?? null;
  return (
    <>
      <BotProactiveMetricsView data={data} proactive={proactiveModeFor(bot) !== "off"} />
      {data?.routines ? <RoutineUsefulnessGroup routines={data.routines} /> : null}
    </>
  );
}
