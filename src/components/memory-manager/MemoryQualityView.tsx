// Tools > Memory > Quality, the Perspicax console's (quality.tsx and
// quality-health.tsx, 2026-11-02). Health: the tiles (Active notes, In
// review, Aging, Duplicates, Orphans), the active notes per tier over 26
// weeks and the writes per week. Journal: every change the bots' memory
// journals hold. Counted from what Sagax holds only: Contested, Measures
// and People have no Sagax source (People would read other persons'
// memory), so they are not drawn; a chart without data says so.
import { useMemo, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import type { MemoryJournalRow } from "@/lib/memory";
import { STALE_DAYS, type PageTier, type QualityStats, type WeekPoint } from "@/lib/memory-page";
import { fullDate, MemoryCard, MiniSegment, relLabel, StatStrip, Swatch, type StatTile } from "./memory-ui";

type Tab = "health" | "journal";

function weekLabel(start: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short" }).format(new Date(start));
}

function Legend({ series }: { series: Array<{ key: string; label: string; color: string }> }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-3 text-[12px] text-ink-secondary">
      {series.map((entry) => <li key={entry.key} className="inline-flex items-center gap-1.5"><Swatch color={entry.color} />{entry.label}</li>)}
    </ul>
  );
}

const W = 520;
const H = 180;
const PAD = { left: 28, right: 8, top: 8, bottom: 20 };

/** A stacked area, one band per series, the weeks along the bottom. */
function StackedArea({ points, series, label }: { points: WeekPoint[]; series: Array<{ key: string; color: string }>; label: string }) {
  const totals = points.map((point) => series.reduce((sum, entry) => sum + (point.values[entry.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const x = (index: number) => PAD.left + (index * (W - PAD.left - PAD.right)) / Math.max(1, points.length - 1);
  const y = (value: number) => H - PAD.bottom - (value * (H - PAD.top - PAD.bottom)) / max;
  const base = points.map(() => 0);
  const bands = series.map((entry) => {
    const lower = [...base];
    points.forEach((point, index) => { base[index]! += point.values[entry.key] ?? 0; });
    const upper = [...base];
    const top = upper.map((value, index) => `${x(index)},${y(value)}`).join(" ");
    const bottom = lower.map((value, index) => `${x(index)},${y(value)}`).reverse().join(" ");
    return { key: entry.key, color: entry.color, d: `M${top} L${bottom} Z` };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label} data-memory-quality-area="">
      <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="stroke-hairline" />
      <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end" className="fill-ink-tertiary text-[10px]">{max}</text>
      {bands.map((band) => <path key={band.key} d={band.d} style={{ fill: band.color }} fillOpacity={0.55} stroke={band.color} strokeWidth={1} />)}
      {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) => (
        <text key={index} x={x(index)} y={H - 4} textAnchor="middle" className="fill-ink-tertiary text-[10px]">{weekLabel(points[index]!.start)}</text>
      ))}
    </svg>
  );
}

/** Stacked bars, one per week. */
function StackedBars({ points, series, label }: { points: WeekPoint[]; series: Array<{ key: string; color: string }>; label: string }) {
  const totals = points.map((point) => series.reduce((sum, entry) => sum + (point.values[entry.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = (W - PAD.left - PAD.right) / points.length;
  const h = (value: number) => (value * (H - PAD.top - PAD.bottom)) / max;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label} data-memory-quality-bars="">
      <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="stroke-hairline" />
      <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end" className="fill-ink-tertiary text-[10px]">{max}</text>
      {points.map((point, index) => {
        let top = H - PAD.bottom;
        return (
          <g key={point.start}>
            {series.map((entry) => {
              const height = h(point.values[entry.key] ?? 0);
              top -= height;
              return height > 0 ? <rect key={entry.key} x={PAD.left + index * slot + slot * 0.18} y={top} width={slot * 0.64} height={height} rx={2} style={{ fill: entry.color }} /> : null;
            })}
            {index % 3 === 0 && <text x={PAD.left + index * slot + slot / 2} y={H - 4} textAnchor="middle" className="fill-ink-tertiary text-[10px]">{weekLabel(point.start)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function MemoryQualityView({ stats, tiers, active, writes, journal, botName, onOpenPath }: {
  stats: QualityStats;
  tiers: PageTier[];
  active: WeekPoint[] | null;
  writes: WeekPoint[] | null;
  journal: MemoryJournalRow[];
  botName: (botId: string) => string;
  onOpenPath: (botId: string, path: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("health");
  const tiles: StatTile[] = [
    { id: "active", label: t("memoryManager.quality.active"), value: stats.active, caption: stats.archived != null ? t("memoryManager.quality.activeCaption", { n: stats.archived }) : undefined },
    { id: "review", label: t("memoryManager.quality.review"), value: stats.inReview, caption: t("memoryManager.quality.reviewCaption") },
    { id: "aging", label: t("memoryManager.quality.aging"), value: stats.aging, caption: t("memoryManager.quality.agingCaption", { days: STALE_DAYS }) },
    { id: "duplicates", label: t("memoryManager.quality.duplicates"), value: stats.duplicates, caption: t("memoryManager.quality.duplicatesCaption") },
  ];
  if (stats.orphans != null) tiles.push({ id: "orphans", label: t("memoryManager.quality.orphans"), value: stats.orphans, caption: t("memoryManager.quality.orphansCaption") });
  const tierSeries = tiers.map((tier) => ({ key: tier.key, label: tier.name, color: tier.color }));
  const writeSeries = [
    { key: "bot", label: t("memoryManager.quality.byBot"), color: "var(--color-accent)" },
    { key: "person", label: t("memoryManager.quality.byYou"), color: "var(--color-warning)" },
  ];
  const sortedJournal = useMemo(() => [...journal].sort((a, b) => b.at - a.at).slice(0, 200), [journal]);
  const kindLabel = (kind: MemoryJournalRow["kind"]) => (kind === "created" ? t("memoryManager.journal.created") : kind === "deleted" ? t("memoryManager.journal.deleted") : t("memoryManager.journal.edited"));
  const actorLabel = (row: MemoryJournalRow) => (row.actor === "person" ? t("memoryManager.authorYou") : row.actor === "import" ? t("memoryManager.authorImport") : botName(row.botId));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6" data-memory-quality-view="">
      <div>
        <h2 className="text-[20px] font-semibold text-ink">{t("memoryManager.quality.title")}</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">{t("memoryManager.quality.subtitle")}</p>
      </div>
      <div className="self-start">
        <MiniSegment<Tab>
          label={t("memoryManager.quality.title")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "health", label: t("memoryManager.quality.health") },
            { value: "journal", label: t("memoryManager.quality.journal") },
          ]}
          data-memory-quality-tabs=""
        />
      </div>
      {tab === "health" ? (
        <>
          <StatStrip items={tiles} data-memory-quality-tiles="" />
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
            <MemoryCard title={t("memoryManager.quality.activeChart")} data-memory-quality-chart-active="">
              {active ? (
                <>
                  {tierSeries.length > 1 && <Legend series={tierSeries} />}
                  <StackedArea points={active} series={tierSeries} label={t("memoryManager.quality.activeChart")} />
                  <p className="mt-1 text-[11.5px] text-ink-tertiary">{t("memoryManager.quality.activeChartHint")}</p>
                </>
              ) : <p className="text-[13px] text-ink-secondary">{t("memoryManager.quality.chartEmpty")}</p>}
            </MemoryCard>
            <MemoryCard title={t("memoryManager.quality.writesChart")} data-memory-quality-chart-writes="">
              {writes ? (
                <>
                  <Legend series={writeSeries} />
                  <StackedBars points={writes} series={writeSeries} label={t("memoryManager.quality.writesChart")} />
                </>
              ) : <p className="text-[13px] text-ink-secondary">{t("memoryManager.quality.chartEmpty")}</p>}
            </MemoryCard>
          </div>
        </>
      ) : (
        <MemoryCard data-memory-quality-journal="">
          {sortedJournal.length === 0 ? <p className="text-[13px] text-ink-secondary">{t("memoryManager.journal.empty")}</p> : (
            <div className="flex flex-col">
              {sortedJournal.map((row) => (
                <button key={row.id} type="button" onClick={() => row.kind !== "deleted" && onOpenPath(row.botId, row.path)} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-hairline/40 px-1 py-2 text-left text-[13px] last:border-b-0 hover:bg-hover" data-memory-journal-row="">
                  <span className="text-[12px] text-ink-secondary" title={fullDate(row.at)}>{relLabel(row.at)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-ink"><b className="font-semibold">{row.path.split("/").pop()?.replace(/\.md$/i, "")}</b> · {kindLabel(row.kind)}</span>
                    <span className="block truncate text-[12px] text-ink-secondary">{[botName(row.botId), actorLabel(row), row.threadTitle].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="whitespace-nowrap text-[12px] tabular-nums"><span className="text-success">+{row.added}</span> <span className="text-danger">-{row.removed}</span></span>
                </button>
              ))}
            </div>
          )}
        </MemoryCard>
      )}
    </div>
  );
}
