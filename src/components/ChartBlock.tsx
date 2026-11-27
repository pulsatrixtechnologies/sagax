// Script-free charts from a ```chart fence (JSON spec or CSV). The chart is
// our own SVG built from parsed numbers, so model output never becomes
// markup. Bar, line, area and donut; categorical colors in a fixed order,
// validated for color-vision deficiency in both schemes; a legend for two or
// more series; a hover and keyboard tooltip; and a table view of the same
// numbers for screen readers and copying.
import { memo, useMemo, useRef, useState } from "react";
import { ChartColumn, Code, Table2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { formatTick, niceTicks, parseChartSpec, type ChartSpec } from "@/lib/rich-blocks";
import { BlockFrame, BlockHeader, ToolButton, useSkinScheme } from "./rich-ui";
import { RichTable, type TableModel } from "./RichTable";
import { CHART_PALETTE } from "@/lib/chart-palette";

// Categorical slots, light and dark steps of the same eight hues.
export { CHART_PALETTE };

const W = 640;
const H = 280;
const M = { top: 14, right: 16, bottom: 44, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

export function chartTableModel(spec: ChartSpec): TableModel {
  const header = [spec.xLabel ?? "", ...spec.series.map((series) => series.name)];
  return {
    header: header.map((text) => ({ content: text, text })),
    rows: spec.labels.map((label, index) => {
      const text = [label, ...spec.series.map((series) => (series.values[index] === null ? "" : String(series.values[index])))];
      return { cells: text, text };
    }),
    align: header.map((_unused, index) => (index === 0 ? null : "right")),
  };
}

function formatValue(value: number | null): string {
  if (value === null) return "";
  return Math.abs(value) >= 1e4 ? value.toLocaleString() : String(Number(value.toPrecision(8)));
}

function CartesianChart({ spec, colors, active, setActive }: {
  spec: ChartSpec;
  colors: readonly string[];
  active: number | null;
  setActive: (index: number | null) => void;
}) {
  const values = spec.series.flatMap((series) => series.values.filter((value): value is number => value !== null));
  const bars = spec.type === "bar";
  const ticks = niceTicks(Math.min(bars || spec.type === "area" ? 0 : Infinity, ...values), Math.max(bars || spec.type === "area" ? 0 : -Infinity, ...values));
  const low = ticks[0]!;
  const high = ticks[ticks.length - 1]!;
  const y = (value: number) => M.top + PLOT_H - ((value - low) / (high - low || 1)) * PLOT_H;
  const count = spec.labels.length;
  const band = PLOT_W / count;
  const x = (index: number) => M.left + band * index + band / 2;
  const labelEvery = Math.max(1, Math.ceil(count / Math.floor(PLOT_W / 56)));
  const zero = y(Math.max(low, Math.min(0, high)));
  const groupWidth = Math.min(band * 0.78, 18 * spec.series.length + 24);
  const barWidth = Math.max(1, (groupWidth - (spec.series.length - 1) * 2) / spec.series.length);

  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={tick === 0 ? 0.35 : 0.12} strokeWidth={1} />
          <text x={M.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.7}>{formatTick(tick)}</text>
        </g>
      ))}
      {spec.labels.map((label, index) => index % labelEvery === 0 && (
        <text key={index} x={x(index)} y={H - M.bottom + 16} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>
          {label.length > 14 ? `${label.slice(0, 13)}…` : label}
        </text>
      ))}
      {spec.xLabel && <text x={M.left + PLOT_W / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>{spec.xLabel}</text>}
      {spec.yLabel && <text transform={`translate(12 ${M.top + PLOT_H / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>{spec.yLabel}</text>}
      {active !== null && !bars && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + PLOT_H} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />}
      {spec.series.map((series, seriesIndex) => {
        const color = colors[seriesIndex % colors.length]!;
        if (bars) {
          return (
            <g key={series.name + seriesIndex}>
              {series.values.map((value, index) => {
                if (value === null) return null;
                const left = x(index) - groupWidth / 2 + seriesIndex * (barWidth + 2);
                const top = Math.min(y(value), zero);
                return (
                  <rect key={index} x={left} y={top} width={barWidth} height={Math.max(1, Math.abs(zero - y(value)))} rx={Math.min(3, barWidth / 3)} fill={color} fillOpacity={active === null || active === index ? 1 : 0.45} />
                );
              })}
            </g>
          );
        }
        const points = series.values.map((value, index) => (value === null ? null : `${x(index)},${y(value)}`));
        const segments: string[][] = [[]];
        for (const point of points) {
          if (point) segments[segments.length - 1]!.push(point);
          else if (segments[segments.length - 1]!.length) segments.push([]);
        }
        return (
          <g key={series.name + seriesIndex}>
            {spec.type === "area" && segments.filter((segment) => segment.length > 1).map((segment, index) => {
              const first = segment[0]!.split(",")[0];
              const last = segment[segment.length - 1]!.split(",")[0];
              return <polygon key={index} points={`${first},${zero} ${segment.join(" ")} ${last},${zero}`} fill={color} fillOpacity={0.16} />;
            })}
            {segments.map((segment, index) => <polyline key={index} points={segment.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {series.values.map((value, index) => value !== null && (count <= 40 || active === index) && (
              <circle key={index} cx={x(index)} cy={y(value)} r={active === index ? 4.5 : 3} fill={color} stroke="var(--color-inset)" strokeWidth={1.5} />
            ))}
          </g>
        );
      })}
      {spec.labels.map((_label, index) => (
        <rect key={`hit-${index}`} x={M.left + band * index} y={M.top} width={band} height={PLOT_H} fill="transparent" onMouseEnter={() => setActive(index)} />
      ))}
    </g>
  );
}

function DonutChart({ spec, colors, active, setActive }: {
  spec: ChartSpec;
  colors: readonly string[];
  active: number | null;
  setActive: (index: number | null) => void;
}) {
  const values = spec.series[0]!.values.map((value) => Math.max(0, value ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const cx = W / 2;
  const cy = H / 2;
  const outer = Math.min(W, H) / 2 - 16;
  const inner = outer * 0.58;
  let angle = -Math.PI / 2;
  return (
    <g>
      {values.map((value, index) => {
        if (value <= 0) return null;
        const sweep = (value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + Math.min(sweep, Math.PI * 2 - 0.0001);
        angle += sweep;
        const large = end - start > Math.PI ? 1 : 0;
        const point = (radius: number, theta: number) => `${cx + radius * Math.cos(theta)} ${cy + radius * Math.sin(theta)}`;
        const d = `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
        return (
          <path key={index} d={d} fill={colors[index % colors.length]} stroke="var(--color-inset)" strokeWidth={2} fillOpacity={active === null || active === index ? 1 : 0.45} onMouseEnter={() => setActive(index)} />
        );
      })}
      <text x={cx} y={cy} dy="0.32em" textAnchor="middle" fontSize={14} fontWeight={600} fill="currentColor">{formatTick(total)}</text>
    </g>
  );
}

function ChartSourceLine({ spec }: { spec: ChartSpec }) {
  const pieces = (spec.sources ?? []).map((source) => source.asOf ? `${source.piece} (${source.asOf})` : source.piece);
  if (!pieces.length && !spec.asOf) return null;
  const text = pieces.length && spec.asOf
    ? t("rich.chart.cited", { pieces: pieces.join(", "), asOf: spec.asOf })
    : spec.asOf ? t("rich.chart.citedDate", { asOf: spec.asOf }) : pieces.join(", ");
  return <p className="px-2 pb-1.5 text-[11.5px] text-ink-tertiary" data-chart-sources="">{text}</p>;
}

/** The chart itself: the plot, its hover and keyboard tooltip, its legend and
 * its sources. The chart block draws it, and a record window's figures too
 * (a board's tickets opened and closed by week, M-20261127-140). */
export function ChartPlot({ spec, colors, title }: { spec: ChartSpec; colors: readonly string[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const pie = spec.type === "pie";
  const legend = pie ? spec.labels : spec.series.map((series) => series.name);
  const count = spec.labels.length;

  const move = (key: string) => {
    if (!count) return false;
    if (key === "ArrowRight" || key === "ArrowDown") setActive((value) => (value === null ? 0 : Math.min(count - 1, value + 1)));
    else if (key === "ArrowLeft" || key === "ArrowUp") setActive((value) => (value === null ? count - 1 : Math.max(0, value - 1)));
    else if (key === "Home") setActive(0);
    else if (key === "End") setActive(count - 1);
    else if (key === "Escape") setActive(null);
    else return false;
    return true;
  };

  return (
    <div className="relative px-2 pt-2 pb-1 text-ink" onMouseLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={t("rich.chart.aria", { title, count })}
        onKeyDown={(event) => { if (move(event.key)) event.preventDefault(); }}
        onBlur={() => setActive(null)}
        className="block h-auto w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {pie
          ? <DonutChart spec={spec} colors={colors} active={active} setActive={setActive} />
          : <CartesianChart spec={spec} colors={colors} active={active} setActive={setActive} />}
      </svg>
      {active !== null && spec.labels[active] !== undefined && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-[2] min-w-32 max-w-60 rounded-lg border border-hairline/50 popover-surface bg-menu px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={pie ? { left: "50%", transform: "translateX(-50%)" } : {
            left: `${Math.min(78, Math.max(4, ((M.left + (PLOT_W / count) * (active + 0.5)) / W) * 100))}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="mb-0.5 font-medium text-ink">{spec.labels[active]}</div>
          {pie ? (
            <div className="flex items-center gap-1.5 text-ink-secondary">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: colors[active % colors.length] }} />
              <span className="ms-auto tabular-nums text-ink">{formatValue(spec.series[0]!.values[active] ?? null)}</span>
            </div>
          ) : spec.series.map((series, index) => (
            <div key={index} className="flex items-center gap-1.5 text-ink-secondary">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: colors[index % colors.length] }} />
              <span className="min-w-0 truncate">{series.name}</span>
              <span className="ms-auto ps-2 tabular-nums text-ink">{formatValue(series.values[active] ?? null)}</span>
            </div>
          ))}
        </div>
      )}
      {(legend.length > 1) && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-1.5 text-[11.5px] text-ink-secondary" aria-label={t("rich.chart.legend")}>
          {legend.slice(0, pie ? 24 : 8).map((name, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: colors[index % colors.length] }} aria-hidden="true" />
              {name}
            </li>
          ))}
        </ul>
      )}
      {spec.truncatedSeries > 0 && <p className="px-2 pb-1.5 text-[11px] text-ink-secondary">{t("rich.chart.truncated", { count: spec.truncatedSeries })}</p>}
      <ChartSourceLine spec={spec} />
    </div>
  );
}

function ChartBlockComponent({ code, pending = false }: { code: string; pending?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const scheme = useSkinScheme(frameRef);
  const parsed = useMemo(() => (pending ? null : parseChartSpec(code)), [code, pending]);
  const [view, setView] = useState<"chart" | "table" | "source">("chart");
  const colors = CHART_PALETTE[scheme];
  const spec = parsed && !("error" in parsed) ? parsed : null;
  const title = spec?.title ?? t("rich.chart.title");

  return (
    <BlockFrame frameRef={frameRef} label={title}>
      <BlockHeader icon={<ChartColumn size={13} aria-hidden="true" className="text-ink-secondary" />} title={title}>
        <ToolButton onClick={() => setView(view === "table" ? "chart" : "table")} pressed={view === "table"} label={t("rich.chart.table")} disabled={!spec}>
          <Table2 size={12} aria-hidden="true" />
          <span className="hidden sm:inline">{t("rich.chart.table")}</span>
        </ToolButton>
        <ToolButton onClick={() => setView(view === "source" ? "chart" : "source")} pressed={view === "source"} label={view === "source" ? t("rich.hideSource") : t("rich.viewSource")}>
          <Code size={12} aria-hidden="true" />
        </ToolButton>
      </BlockHeader>
      {pending ? (
        <p role="status" className="px-3 py-6 text-center text-[12px] text-ink-secondary">{t("rich.chart.pending")}</p>
      ) : !spec ? (
        <p role="alert" className="px-3 pt-2 text-[12px] text-danger">{t("rich.chart.invalid", { reason: parsed && "error" in parsed ? parsed.error : "" })}</p>
      ) : view === "table" ? (
        <div className="p-2"><RichTable model={chartTableModel(spec)} caption={title} /><ChartSourceLine spec={spec} /></div>
      ) : view === "chart" ? (
        <ChartPlot spec={spec} colors={colors} title={title} />
      ) : null}
      {(view === "source" || (!spec && !pending)) && (
        <pre className="max-h-80 overflow-auto border-t border-hairline/30 p-3 text-[12px] leading-[18px] text-ink">{code}</pre>
      )}
    </BlockFrame>
  );
}

export const ChartBlock = memo(ChartBlockComponent);
