// The shared usage chart card (usage charts v2): the one look Sagax uses
// wherever it shows usage (by model, account, source, person, cost, tokens,
// messages, tools). A small control row (period toggle in plain text, a
// grouping menu), then a rounded card: the period with arrows, the total in
// a big figure, a stacked daily histogram (wide bars, rounded tops, a faint
// grid, three x labels) and a legend of tiles (a color bar, a name, a big
// share) or of dots. Theme tokens only; the series colors are the validated
// categorical steps (`.usage-chart` in styles.css). It draws what it is
// given: the caller groups, folds the rest into "Others" and formats.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, documentLanguage, t } from "@/lib/i18n";

/** Series slots, in fixed order: never cycled, the rest is "Others". */
export const SERIES_SLOTS = 6;
const SLOT_COLOR = (index: number) => `var(--usage-s${index + 1})`;
export const OTHER_COLOR = "var(--usage-other)";

/** The color of the series at `index` (0 based), or the neutral grey. */
export function seriesColor(index: number, other = false): string {
  return other || index >= SERIES_SLOTS ? OTHER_COLOR : SLOT_COLOR(index);
}

export interface ChartSeries {
  id: string;
  label: string;
  /** A second, grey line under the name (how an account is paid). */
  sub?: string | null;
  /** Share of the whole, 0 to 1. */
  share: number;
  /** One value per day of the card, same order as `days`. */
  values: readonly number[];
  color: string;
}

export interface ChartDay { key: string; label: string }

/** A tile's share: "44%", "5.2%" under one percent a decimal, "<0.1%" for a sliver. */
export function formatTileShare(share: number, locale = documentLanguage(activeLocale())): string {
  if (share > 0 && share < 0.001) return `<${new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(0.001)}`;
  const digits = share >= 0.01 ? 0 : 1;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(share);
}

/** An axis figure, short ("1.5B", "500M", "12K"). */
export function abbreviate(value: number, locale = documentLanguage(activeLocale())): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** The top of the y axis: the max rounded up to 1, 2, 4 or 8 times a power of ten. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 4, 8, 10]) if (max <= step * power) return step * power;
  return 10 * power;
}

/** The x labels: first, middle, last (a single one when there is one day). */
export function axisLabels(days: readonly ChartDay[]): string[] {
  if (days.length === 0) return [];
  if (days.length === 1) return [days[0]!.label];
  if (days.length === 2) return days.map((day) => day.label);
  return [days[0]!.label, days[Math.floor((days.length - 1) / 2)]!.label, days[days.length - 1]!.label];
}

export interface UsageChartControlsProps {
  periods: readonly { id: string; label: string }[];
  period: string;
  onPeriod: (id: string) => void;
  periodAria: string;
  /** More plain-text toggles after the period (the unit), same look. */
  extra?: ReactNode;
  groups?: readonly { id: string; label: string }[];
  group?: string;
  onGroup?: (id: string) => void;
  groupAria?: string;
  /** Inside a card's header row (#3401): no side inset of its own. */
  inCard?: boolean;
}

/** A plain-text toggle: the active choice in the ink color, the others quiet. */
export function TextToggle({ options, value, onChange, ariaLabel, dataKey }: { options: readonly { id: string; label: string }[]; value: string; onChange: (id: string) => void; ariaLabel: string; dataKey?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center gap-3">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          {...(dataKey ? { [dataKey]: option.id } : {})}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn("h-8 text-[14px] leading-5 transition-colors", option.id === value ? "font-medium text-ink" : "text-ink-secondary hover:text-ink")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function UsageChartControls({ periods, period, onPeriod, periodAria, extra, groups, group, onGroup, groupAria, inCard = false }: UsageChartControlsProps) {
  return (
    <div data-usage-chart-controls="" className={cn("flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2", !inCard && "px-1")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-6">
        <TextToggle options={periods} value={period} onChange={onPeriod} ariaLabel={periodAria} dataKey="data-bot-usage-period" />
        {extra}
      </div>
      {groups && group !== undefined && onGroup && (
        <label className="relative inline-flex items-center">
          <span className="sr-only">{groupAria}</span>
          <select
            data-usage-chart-group=""
            value={group}
            onChange={(event) => onGroup(event.target.value)}
            className="ui-button cursor-pointer appearance-none pl-3 pr-8 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {groups.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3 text-ink-secondary" />
        </label>
      )}
    </div>
  );
}

export interface UsageChartCardProps {
  rangeLabel: string;
  /** Absent hides nothing: the arrow stays, disabled. */
  onPrev?: () => void;
  onNext?: () => void;
  /** The figure above the chart; both absent where the card's own header says it (Settings > Usage, #4095). */
  totalLabel?: string;
  total?: string;
  days: readonly ChartDay[];
  series: readonly ChartSeries[];
  /** A figure of the chart in the shown unit ("$1.20", "3.4M"). */
  formatValue: (value: number) => string;
  /** The axis figure; defaults to a short number. */
  formatAxis?: (value: number) => string;
  /** "none": the caller draws its own legend (Settings > Usage, #4095). */
  legend?: "tiles" | "dots" | "none";
  chartLabel: string;
  /** One color for every bar (a single series, no legend). */
  empty?: ReactNode;
  className?: string;
  /** The card's header row (#3401): the period, unit and group-by controls,
   * above the range and its arrows. */
  controls?: ReactNode;
  children?: ReactNode;
}

const GRID_LINES = 5;

export function UsageChartCard({ rangeLabel, onPrev, onNext, totalLabel, total, days, series, formatValue, formatAxis, legend = "tiles", chartLabel, empty, className, controls, children }: UsageChartCardProps) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((_, index) => series.reduce((sum, one) => sum + (one.values[index] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const axis = formatAxis ?? ((value: number) => abbreviate(value));
  const ticks = Array.from({ length: GRID_LINES }, (_, index) => (max * (GRID_LINES - 1 - index)) / (GRID_LINES - 1));
  const nothing = totals.every((value) => value <= 0);
  const labels = axisLabels(days);

  const tooltip = hover === null ? null : (
    <div
      data-usage-chart-tooltip=""
      role="status"
      className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] -translate-y-full rounded-lg border border-hairline bg-popover px-3 py-2 text-[12px] leading-4 text-ink shadow-lg"
      style={{ left: `${((hover + 0.5) / Math.max(1, days.length)) * 100}%`, transform: `translate(${hover > days.length / 2 ? "-100%" : "0"}, -100%)` }}
    >
      <div className="mb-1 font-medium">{days[hover]!.label}</div>
      {series.filter((one) => (one.values[hover] ?? 0) > 0).map((one) => (
        <div key={one.id} className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: one.color }} />
          <span className="min-w-0 flex-1 truncate text-ink-secondary">{one.label}</span>
          <span className="tabular-nums">{formatValue(one.values[hover] ?? 0)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-3 border-t border-hairline pt-1">
        <span className="text-ink-secondary">{t("botProfile.usage.chart.total")}</span>
        <span className="tabular-nums">{formatValue(totals[hover] ?? 0)}</span>
      </div>
    </div>
  );

  return (
    <div data-usage-chart-card="" className={cn("usage-chart flex min-w-0 flex-col rounded-2xl bg-card px-4 pb-4 pt-3", className)}>
      {controls ? <div data-usage-chart-header="" className="mb-2 min-w-0">{controls}</div> : null}
      <div className="flex items-center justify-between gap-3">
        <span data-usage-chart-range="" className="min-w-0 truncate text-[14px] leading-5 text-ink-secondary">{rangeLabel}</span>
        <span className="flex shrink-0 items-center">
          <button type="button" aria-label={t("botProfile.usage.chart.prev")} disabled={!onPrev} onClick={onPrev} data-usage-chart-prev="" className="grid size-8 place-items-center rounded-full text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label={t("botProfile.usage.chart.next")} disabled={!onNext} onClick={onNext} data-usage-chart-next="" className="grid size-8 place-items-center rounded-full text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </span>
      </div>
      {totalLabel !== undefined && <div className="mt-2 text-[13px] leading-[18px] text-ink-secondary">{totalLabel}</div>}
      {total !== undefined && <div data-usage-chart-total="" className="tabular-nums text-[28px] leading-8 text-ink">{total}</div>}

      {nothing && empty ? (
        <div data-usage-chart-empty="" className="flex min-h-[120px] items-center text-[13px] leading-[18px] text-ink-secondary">{empty}</div>
      ) : (
        <div className="mt-4 flex min-w-0 gap-2">
          <div aria-hidden="true" className="flex h-[176px] w-10 shrink-0 flex-col justify-between text-right text-[11px] leading-3 tabular-nums text-ink-tertiary">
            {ticks.map((tick, index) => <span key={index} className={index === 0 ? "-mt-1" : index === GRID_LINES - 1 ? "-mb-1" : ""}>{tick === 0 ? "0" : axis(tick)}</span>)}
          </div>
          <div className="relative min-w-0 flex-1">
            {tooltip}
            <div role="img" aria-label={chartLabel} data-usage-chart-plot="" className="relative h-[176px]" onMouseLeave={() => setHover(null)}>
              <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
                {ticks.map((_, index) => <span key={index} className="block h-px w-full bg-hairline opacity-60" />)}
              </div>
              <div className="absolute inset-0 flex items-end gap-[3px]">
                {days.map((day, index) => {
                  const parts = series.map((one) => ({ one, value: one.values[index] ?? 0 })).filter((part) => part.value > 0);
                  const top = parts.length - 1;
                  return (
                    <div
                      key={day.key}
                      data-usage-chart-day={day.key}
                      tabIndex={0}
                      aria-label={`${day.label}, ${formatValue(totals[index] ?? 0)}`}
                      onMouseEnter={() => setHover(index)}
                      onFocus={() => setHover(index)}
                      onBlur={() => setHover(null)}
                      className="flex h-full min-w-0 flex-1 items-end justify-center outline-none focus-visible:bg-hover"
                    >
                      <div className="flex w-full max-w-[56px] flex-col-reverse gap-[2px]" style={{ height: `${((totals[index] ?? 0) / max) * 100}%` }}>
                        {parts.map((part, position) => (
                          <span
                            key={part.one.id}
                            data-usage-chart-segment={part.one.id}
                            className={cn("block min-h-[2px] w-full", position === top && "rounded-t-[4px]")}
                            style={{ flexGrow: part.value / (totals[index] || 1), flexBasis: 0, backgroundColor: part.one.color }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div aria-hidden="true" className="mt-2 flex justify-between text-[11px] leading-3 text-ink-tertiary">
              {labels.map((label, index) => <span key={index}>{label}</span>)}
            </div>
          </div>
        </div>
      )}

      {series.length > 0 && legend === "tiles" && (
        <div data-usage-chart-legend="tiles" className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          {series.map((one) => (
            <div key={one.id} data-usage-chart-tile={one.id} className="flex min-w-0 gap-3">
              <span aria-hidden="true" className="w-[3px] shrink-0 self-stretch rounded-full" style={{ backgroundColor: one.color }} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{one.label}</span>
                {one.sub ? <span className="truncate text-[11px] leading-4 text-ink-tertiary">{one.sub}</span> : null}
                <span data-usage-chart-share="" className="tabular-nums text-[20px] leading-7 text-ink">{formatTileShare(one.share)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {series.length > 0 && legend === "dots" && (
        <div data-usage-chart-legend="dots" className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
          {series.map((one) => (
            <span key={one.id} data-usage-chart-dot={one.id} className="inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: one.color }} />
              <span className="truncate">{one.label}</span>
            </span>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
