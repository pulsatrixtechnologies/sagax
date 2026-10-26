// A one-minute area/line chart for the usage card. Our own SVG from numbers
// (no markup from the computer), drawn in pixels after measuring its width so
// the 2px lines and the end dot stay round. Hairline grid, one scale, a
// crosshair and tooltip on hover and on keyboard focus (arrows), values
// first in the tooltip. One series: the tile's title names it; two: the tile
// shows a legend with the values beside the chart.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { t } from "@/lib/i18n";
import type { SeriesPoint } from "./resource-usage-model";

export interface SparkSeries {
  key: string;
  label: string;
  color: string;
  points: SeriesPoint[];
}

const WINDOW_S = 60;
const PAD_TOP = 14;
const PAD_BOTTOM = 2;

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function ResourceSpark({ series, min = 0, max, format, label, area = true, height = 64, topLabel, initialWidth = 240 }: {
  series: SparkSeries[];
  /** The bottom of the one scale (0 unless a steady chart zooms in). */
  min?: number;
  /** The top of the one scale (100 for percents, a clean rate otherwise). */
  max: number;
  format: (value: number) => string;
  /** What a screen reader hears for the chart. */
  label: string;
  /** A 10% wash under a single series. */
  area?: boolean;
  height?: number;
  /** The top gridline's label ("100 %", "2 Mo/s"). */
  topLabel?: string;
  /** Width before the first measure (tests, headless captures). */
  initialWidth?: number;
}) {
  const { ref, width } = useWidth(initialWidth);
  const [active, setActive] = useState<number | null>(null);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const x = (age: number) => Math.max(0, Math.min(width, width - (age / WINDOW_S) * width));
  const y = (value: number) => PAD_TOP + (1 - Math.max(0, Math.min(1, (value - min) / (max - min || 1)))) * plotH;
  const base = series[0]?.points ?? [];

  const paths = series.map((one) => {
    const segments: string[][] = [[]];
    for (const point of one.points) {
      if (point.value === null) {
        if (segments[segments.length - 1]!.length) segments.push([]);
        continue;
      }
      segments[segments.length - 1]!.push(`${x(point.age).toFixed(1)},${y(point.value).toFixed(1)}`);
    }
    return segments.filter((segment) => segment.length > 0);
  });

  const pick = (clientX: number, element: Element) => {
    if (!base.length) return;
    const left = element.getBoundingClientRect().left;
    const age = ((width - (clientX - left)) / width) * WINDOW_S;
    let best = 0;
    for (let index = 1; index < base.length; index += 1) {
      if (Math.abs(base[index]!.age - age) < Math.abs(base[best]!.age - age)) best = index;
    }
    setActive(best);
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!base.length) return;
    if (event.key === "ArrowLeft") setActive((index) => Math.max(0, (index ?? base.length) - 1));
    else if (event.key === "ArrowRight") setActive((index) => Math.min(base.length - 1, (index ?? base.length - 2) + 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(base.length - 1);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };

  const activePoint = active !== null ? base[active] : undefined;
  const tipLeft = activePoint ? x(activePoint.age) : 0;
  const empty = !series.some((one) => one.points.some((point) => point.value !== null));

  return (
    <div ref={ref} className="relative min-w-0" style={{ height }}>
      <svg
        role="img"
        aria-label={label}
        tabIndex={0}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block overflow-visible rounded-md text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus"
        onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {/* hairline grid: the top of the scale and the baseline, both solid */}
        <line x1={0} x2={width} y1={PAD_TOP} y2={PAD_TOP} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} shapeRendering="crispEdges" />
        <line x1={0} x2={width} y1={height - PAD_BOTTOM} y2={height - PAD_BOTTOM} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} shapeRendering="crispEdges" />
        {topLabel && <text x={0} y={PAD_TOP - 4} fontSize={10} fill="currentColor" fillOpacity={0.55} className="tabular-nums">{topLabel}</text>}
        {series.map((one, seriesIndex) => (
          <g key={one.key}>
            {area && series.length === 1 && paths[seriesIndex]!.filter((segment) => segment.length > 1).map((segment, index) => {
              const first = segment[0]!.split(",")[0];
              const last = segment[segment.length - 1]!.split(",")[0];
              return <polygon key={index} points={`${first},${height - PAD_BOTTOM} ${segment.join(" ")} ${last},${height - PAD_BOTTOM}`} fill={one.color} fillOpacity={0.12} />;
            })}
            {paths[seriesIndex]!.map((segment, index) => (
              segment.length > 1
                ? <polyline key={index} points={segment.join(" ")} fill="none" stroke={one.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                : null
            ))}
          </g>
        ))}
        {/* the newest value of each series: an 8px dot with a 2px ring of the card's surface */}
        {!activePoint && series.map((one) => {
          const last = one.points[one.points.length - 1];
          if (!last || last.value === null) return null;
          return <circle key={`end-${one.key}`} cx={x(last.age)} cy={y(last.value)} r={4} fill={one.color} stroke="var(--color-composer)" strokeWidth={2} />;
        })}
        {activePoint && (
          <g pointerEvents="none">
            <line x1={tipLeft} x2={tipLeft} y1={PAD_TOP} y2={height - PAD_BOTTOM} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
            {series.map((one) => {
              const value = one.points[active!]?.value;
              return value === null || value === undefined ? null : <circle key={`hover-${one.key}`} cx={tipLeft} cy={y(value)} r={4} fill={one.color} stroke="var(--color-composer)" strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-ink-tertiary">{t("resourceUsage.waiting")}</div>
      )}
      {activePoint && (
        <div
          role="status"
          className="pointer-events-none absolute -top-2 z-10 min-w-[96px] -translate-y-full rounded-lg bg-popover px-2.5 py-1.5 text-[12px] leading-4 text-ink shadow-lg ring-1 ring-hairline"
          style={tipLeft > width / 2 ? { right: Math.max(0, width - tipLeft - 8) } : { left: Math.max(0, tipLeft - 8) }}
        >
          <div className="mb-1 text-[11px] text-ink-tertiary">{activePoint.age < 1 ? t("resourceUsage.now") : t("resourceUsage.ago", { seconds: Math.round(activePoint.age) })}</div>
          {series.map((one) => {
            const value = one.points[active!]?.value;
            return (
              <div key={one.key} className="flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true" className="h-[2px] w-3 rounded-full" style={{ background: one.color }} />
                <span className="font-semibold tabular-nums">{value === null || value === undefined ? "—" : format(value)}</span>
                {series.length > 1 && <span className="text-ink-secondary">{one.label}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
