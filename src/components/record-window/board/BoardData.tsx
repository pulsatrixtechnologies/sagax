// A board's Data tab (M-20261127-140, D-20261127-010): the active tickets
// by owner, the tickets entered and closed by week, the age of the active
// tickets and the first response time. Counts of the board's own rows are
// counted here (by owner, by age); what only the product knows (the closed
// tickets of each week, the first response time) is the console's `stats`
// section, and a block it does not send is not shown (M-20261127-143). The
// weeks are the app's one chart (ChartPlot); the others are bars of the
// skin's tokens.
import { useRef } from "react";
import { ChartPlot, CHART_PALETTE } from "@/components/ChartBlock";
import { RecordAvatar, RecordPod } from "@/components/record-window/RecordBlocks";
import { useSkinScheme } from "@/components/rich-ui";
import { cn } from "@/lib/cn";
import { activeLocale, formatNumber, t } from "@/lib/i18n";
import type { BoardStats, TicketRow, WeekRow } from "@/lib/record-detail";
import type { ChartSpec } from "@/lib/rich-blocks";
import type { boardOwners } from "./BoardWindow";

const DAY = 86_400_000;
export const AGE_BUCKETS = ["fresh", "week", "old"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
const AGE_FILL: Record<AgeBucket, string> = { fresh: "bg-success", week: "bg-warning", old: "bg-danger" };

/** The active tickets by age: under 2 days, 2 to 7 days, over 7 days (the mockup's). A row with no entry time is not counted. */
export function ageBuckets(rows: readonly TicketRow[], now: number): Record<AgeBucket, number> {
  const out: Record<AgeBucket, number> = { fresh: 0, week: 0, old: 0 };
  for (const row of rows) {
    const at = row.opened ? Date.parse(row.opened) : NaN;
    if (!Number.isFinite(at)) continue;
    const age = now - at;
    out[age < 2 * DAY ? "fresh" : age <= 7 * DAY ? "week" : "old"] += 1;
  }
  return out;
}

/** A week's first day as a short date ("19 oct."), never shifted by a zone. */
function weekLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, date!, 12)));
}

/** The weeks as the app's chart: entered and closed side by side. */
export function weeksChart(weeks: readonly WeekRow[]): ChartSpec | null {
  const opened = weeks.some((week) => week.opened !== undefined), closed = weeks.some((week) => week.closed !== undefined);
  if (!weeks.length || (!opened && !closed)) return null;
  return {
    type: "bar",
    labels: weeks.map((week) => weekLabel(week.week)),
    series: [
      ...(opened ? [{ name: t("recordWindow.board.data.opened"), values: weeks.map((week) => week.opened ?? null) }] : []),
      ...(closed ? [{ name: t("recordWindow.board.data.closed"), values: weeks.map((week) => week.closed ?? null) }] : []),
    ],
    truncatedSeries: 0,
  };
}

function WeeksPod({ weeks }: { weeks: readonly WeekRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useSkinScheme(ref);
  const spec = weeksChart(weeks);
  if (!spec) return null;
  const title = t("recordWindow.board.data.weeks");
  return (
    <RecordPod title={title} data-board-data="weeks">
      <div ref={ref} className="-mx-2"><ChartPlot spec={spec} colors={CHART_PALETTE[scheme]} title={title} /></div>
    </RecordPod>
  );
}

export function BoardData({ rows, weeks, stats, owners, now }: {
  rows: readonly TicketRow[];
  weeks: readonly WeekRow[];
  stats?: BoardStats;
  owners: ReturnType<typeof boardOwners>;
  now: number;
  tz?: string;
}) {
  const most = Math.max(1, ...owners.map((one) => one.count));
  const ages = ageBuckets(rows, now);
  const aged = AGE_BUCKETS.filter((bucket) => ages[bucket] > 0);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 @min-[48rem]:grid-cols-2" data-board-data="">
      {owners.length > 0 && (
        <RecordPod title={t("recordWindow.board.data.byOwner")} data-board-data="owners">
          <ul className="flex flex-col gap-2.5">
            {owners.map((owner) => (
              <li key={owner.key} className="flex min-w-0 items-center gap-2.5" data-board-owner-row={owner.key}>
                {owner.row.owner ? <RecordAvatar name={owner.name} /> : <span aria-hidden="true" className="inline-block size-7 shrink-0 rounded-full border border-dashed border-popover-ink-secondary" />}
                <span className="w-40 min-w-0 shrink-0 truncate text-[13px] text-popover-ink-secondary" title={owner.name}>{owner.name}</span>
                <span role="img" aria-label={`${owner.name}: ${formatNumber(owner.count)}`} className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-popover-hover">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(owner.count / most) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-end text-[13px] tabular-nums text-popover-ink-secondary">{formatNumber(owner.count)}</span>
              </li>
            ))}
          </ul>
        </RecordPod>
      )}
      <WeeksPod weeks={weeks} />
      {aged.length > 0 && (
        <RecordPod title={t("recordWindow.board.data.age")} data-board-data="age">
          <div className="flex flex-col gap-2">
            <div className="flex h-2.5 min-w-0 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={aged.map((bucket) => `${t(`recordWindow.board.data.age.${bucket}` as "recordWindow.board.data.age.fresh")} ${formatNumber(ages[bucket])}`).join(", ")}>
              {aged.map((bucket) => <span key={bucket} className={cn("h-full rounded-full", AGE_FILL[bucket])} style={{ flexGrow: ages[bucket] }} />)}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-[18px] text-popover-ink-secondary">
              {aged.map((bucket) => <li key={bucket} className="flex items-center gap-1.5" data-board-age={bucket}><span aria-hidden="true" className={cn("size-2 rounded-sm", AGE_FILL[bucket])} />{t(`recordWindow.board.data.age.${bucket}` as "recordWindow.board.data.age.fresh")} · {formatNumber(ages[bucket])}</li>)}
            </ul>
          </div>
        </RecordPod>
      )}
      {stats?.firstResponse && (
        <RecordPod title={t("recordWindow.board.data.firstResponse")} data-board-data="first-response">
          <span className="text-[22px] font-semibold leading-7 tabular-nums">{stats.firstResponse.text}</span>
          {stats.firstResponse.detail && <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{stats.firstResponse.detail}</span>}
        </RecordPod>
      )}
    </div>
  );
}
