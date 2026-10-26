// The live usage card (CPU, memory, disks, network) a bot shows when the
// person asks (#876). Four tiles of one-minute charts, the volumes as
// meters, a table view of the same numbers, and a header that names the
// computer by its name: never an id, an address or a key. Values are text
// in ink colors beside colored marks; a full volume carries an icon and a
// word, not only a color. Live while on screen; Pause and Reprendre.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChartArea, Cpu, Gauge, HardDrive, Info, MemoryStick, Network, Pause, Play, Table2 } from "lucide-react";

import {
  formatBytes,
  formatPercent,
  formatRate,
  formatUptime,
  type ResourceUsageSnapshot,
  type ResourceUsageView,
} from "../../../shared/resource-usage";
import { publicText } from "../../../shared/remote-session";
import { cn } from "@/lib/cn";
import { useColorScheme, type ColorScheme } from "@/lib/color-scheme";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { CHART_PALETTE } from "../ChartBlock";
import { MessageBoundary } from "../MessageBoundary";
import { SURFACE } from "../widget/WidgetMessage";
import { ResourceSpark, type SparkSeries } from "./ResourceSpark";
import { CORE_BARS_MAX, fullness, latest, niceRateMax, percentRange, seriesOf, stats } from "./resource-usage-model";
import { useOnScreen, useResourceUsage } from "./use-resource-usage";

/** Status ink (fixed in every skin), always beside an icon and a word. */
const GOOD = "#0ca30c";

const TARGET_LABEL: Record<ResourceUsageView["target"], LocaleKey> = {
  "this-computer": "resourceUsage.target.this-computer",
  server: "resourceUsage.target.server",
  host: "resourceUsage.target.host",
  "remote-session": "resourceUsage.target.remote-session",
  "bot-computer": "resourceUsage.target.bot-computer",
};

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Tile({ icon, title, value, detail, children, legend, className }: {
  icon: ReactNode;
  title: string;
  value: string;
  detail?: string;
  legend?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section data-resource-tile="" className={cn("min-w-0 rounded-2xl bg-ink/[0.035] px-3 pb-2.5 pt-2.5", className)}>
      <div className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
        <span aria-hidden="true" className="text-ink-tertiary">{icon}</span>
        <h3 className="min-w-0 flex-1 truncate font-normal">{title}</h3>
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-2">
        <span data-resource-value="" className="whitespace-nowrap text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink tabular-nums">{value}</span>
        {detail && <span className="min-w-0 truncate text-[12px] text-ink-secondary" title={detail}>{detail}</span>}
      </div>
      {legend}
      {children && <div className="mt-1.5">{children}</div>}
    </section>
  );
}

function Legend({ items }: { items: Array<{ key: string; label: string; color: string; value: string }> }) {
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] leading-4">
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className="h-[2px] w-3 rounded-full" style={{ background: item.color }} />
          <span className="text-ink-secondary">{item.label}</span>
          <span className="font-medium text-ink tabular-nums">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

function CoreBars({ cores, color }: { cores: number[]; color: string }) {
  const locale = activeLocale();
  if (!cores.length) return null;
  if (cores.length > CORE_BARS_MAX) {
    return <p className="mt-1 text-[11px] text-ink-tertiary">{t("resourceUsage.coresSummary", { count: cores.length, max: formatPercent(Math.max(...cores), locale) })}</p>;
  }
  return (
    <div role="img" aria-label={t("resourceUsage.coresAria", { values: cores.map((value, index) => t("resourceUsage.core", { index: index + 1, value: formatPercent(value, locale) })).join(", ") })} className="mt-2 flex h-5 items-end justify-between gap-[3px]">
      {cores.map((value, index) => (
        <span key={index} title={t("resourceUsage.core", { index: index + 1, value: formatPercent(value, locale) })} className="relative h-full min-w-[3px] max-w-[18px] flex-1 overflow-hidden rounded-[2px] bg-ink/[0.08]">
          <span className="absolute inset-x-0 bottom-0 rounded-[2px]" style={{ height: `${Math.max(4, value)}%`, background: color }} />
        </span>
      ))}
    </div>
  );
}

function Volumes({ snapshot, color }: { snapshot: ResourceUsageSnapshot; color: string }) {
  const locale = activeLocale();
  const volumes = snapshot.frames[snapshot.frames.length - 1]?.volumes ?? [];
  if (!volumes.length) return null;
  return (
    <section data-resource-volumes="" className="rounded-2xl bg-ink/[0.035] px-3 pb-3 pt-2.5 @[420px]:col-span-2">
      <div className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
        <HardDrive size={13} aria-hidden="true" className="text-ink-tertiary" />
        <h3 className="font-normal">{t("resourceUsage.volumes")}</h3>
      </div>
      <ul className="mt-2 flex flex-col gap-2.5">
        {volumes.map((volume) => {
          const ratio = volume.total > 0 ? volume.used / volume.total : 0;
          const level = fullness(volume.used, volume.total);
          const fill = level === "critical" ? "var(--color-danger)" : level === "high" ? "var(--color-warning)" : color;
          const name = publicText(volume.name, 60) ?? "—";
          return (
            <li key={volume.name} data-resource-volume={level} className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2 text-[12px] leading-4">
                <span className="min-w-0 flex-1 truncate font-medium text-ink" title={name}>{name}</span>
                {level !== "ok" && (
                  <span className={cn("inline-flex shrink-0 items-center gap-1", level === "critical" ? "text-danger" : "text-warning")}>
                    <AlertTriangle size={12} aria-hidden="true" />
                    {t(level === "critical" ? "resourceUsage.full" : "resourceUsage.nearlyFull")}
                  </span>
                )}
                <span className="shrink-0 font-semibold text-ink tabular-nums">{formatPercent(ratio * 100, locale)}</span>
                <span className="hidden shrink-0 text-ink-secondary tabular-nums @[360px]:inline">{t("resourceUsage.of", { used: formatBytes(volume.used, locale), total: formatBytes(volume.total, locale) })}</span>
              </div>
              <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio * 100)}
                aria-label={t("resourceUsage.volumeAria", { name, value: formatPercent(ratio * 100, locale), used: formatBytes(volume.used, locale), total: formatBytes(volume.total, locale) })}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]"
              >
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(1.5, ratio * 100))}%`, background: fill }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ValuesTable({ snapshot }: { snapshot: ResourceUsageSnapshot }) {
  const locale = activeLocale();
  const frames = snapshot.frames;
  const percent = (value: number | null) => (value === null ? "—" : formatPercent(value, locale));
  const bytes = (value: number | null) => (value === null ? "—" : formatBytes(value, locale));
  const rate = (value: number | null) => (value === null ? "—" : formatRate(value, locale));
  const rows: Array<{ key: string; label: string; format: (value: number | null) => string; points: ReturnType<typeof seriesOf> }> = [
    { key: "cpu", label: t("resourceUsage.cpu"), format: percent, points: seriesOf(frames, (frame) => frame.cpu?.total) },
    { key: "mem", label: t("resourceUsage.memory"), format: bytes, points: seriesOf(frames, (frame) => frame.mem?.used) },
    { key: "swap", label: t("resourceUsage.swapLabel"), format: bytes, points: seriesOf(frames, (frame) => (frame.mem?.swapTotal ? frame.mem.swapUsed ?? 0 : null)) },
    { key: "read", label: t("resourceUsage.diskRead"), format: rate, points: seriesOf(frames, (frame) => frame.disk?.readBps) },
    { key: "write", label: t("resourceUsage.diskWrite"), format: rate, points: seriesOf(frames, (frame) => frame.disk?.writeBps) },
    { key: "rx", label: t("resourceUsage.netIn"), format: rate, points: seriesOf(frames, (frame) => frame.net?.rxBps) },
    { key: "tx", label: t("resourceUsage.netOut"), format: rate, points: seriesOf(frames, (frame) => frame.net?.txBps) },
  ];
  return (
    <table data-resource-table="" className="w-full border-collapse text-[12px] leading-5">
      <caption className="sr-only">{t("resourceUsage.tableCaption")}</caption>
      <thead>
        <tr className="text-left text-ink-secondary">
          <th scope="col" className="py-1 pr-2 font-normal">{t("resourceUsage.col.metric")}</th>
          <th scope="col" className="py-1 pr-2 text-right font-normal">{t("resourceUsage.col.now")}</th>
          <th scope="col" className="py-1 pr-2 text-right font-normal">{t("resourceUsage.col.avg")}</th>
          <th scope="col" className="py-1 text-right font-normal">{t("resourceUsage.col.max")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.filter((row) => row.points.some((point) => point.value !== null)).map((row) => {
          const values = stats(row.points);
          return (
            <tr key={row.key} className="border-t border-hairline/50">
              <th scope="row" className="py-1 pr-2 text-left font-normal text-ink">{row.label}</th>
              <td className="py-1 pr-2 text-right font-semibold text-ink tabular-nums">{row.format(values.now)}</td>
              <td className="py-1 pr-2 text-right text-ink-secondary tabular-nums">{row.format(values.avg)}</td>
              <td className="py-1 text-right text-ink-secondary tabular-nums">{row.format(values.max)}</td>
            </tr>
          );
        })}
        {(frames[frames.length - 1]?.volumes ?? []).map((volume) => (
          <tr key={`volume-${volume.name}`} className="border-t border-hairline/50">
            <th scope="row" className="py-1 pr-2 text-left font-normal text-ink">{publicText(volume.name, 60) ?? "—"}</th>
            <td className="py-1 pr-2 text-right font-semibold text-ink tabular-nums">{formatPercent((volume.used / (volume.total || 1)) * 100, locale)}</td>
            <td colSpan={2} className="py-1 text-right text-ink-secondary tabular-nums">{t("resourceUsage.of", { used: formatBytes(volume.used, locale), total: formatBytes(volume.total, locale) })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Charts({ snapshot, scheme }: { snapshot: ResourceUsageSnapshot; scheme: ColorScheme }) {
  const locale = activeLocale();
  const palette = CHART_PALETTE[scheme];
  const first = palette[0];
  const second = palette[1];
  const frames = snapshot.frames;
  const last = frames[frames.length - 1];
  const dash = "—";

  const cpu = seriesOf(frames, (frame) => frame.cpu?.total);
  const cpuNow = latest(cpu);
  const cores = last?.cpu?.cores ?? [];
  const coresCount = cores.length || snapshot.host.cores || 0;

  const memPct = seriesOf(frames, (frame) => (frame.mem && frame.mem.total > 0 ? (frame.mem.used / frame.mem.total) * 100 : null));
  const mem = last?.mem ?? null;
  // memory moves little: the chart zooms on its range and says so
  const memRange = percentRange(memPct.map((point) => point.value).filter((value): value is number => value !== null));

  const read = seriesOf(frames, (frame) => frame.disk?.readBps);
  const write = seriesOf(frames, (frame) => frame.disk?.writeBps);
  const rx = seriesOf(frames, (frame) => frame.net?.rxBps);
  const tx = seriesOf(frames, (frame) => frame.net?.txBps);
  const diskMax = niceRateMax(Math.max(0, ...[...read, ...write].map((point) => point.value ?? 0)));
  const netMax = niceRateMax(Math.max(0, ...[...rx, ...tx].map((point) => point.value ?? 0)));
  const rate = (value: number) => formatRate(value, locale);
  const pct = (value: number) => formatPercent(value, locale);
  const aria = (metric: string, points: typeof cpu, format: (value: number) => string) => {
    const values = stats(points);
    return t("resourceUsage.chartAria", { metric, now: values.now === null ? dash : format(values.now), max: values.max === null ? dash : format(values.max) });
  };

  const diskSeries: SparkSeries[] = [
    { key: "read", label: t("resourceUsage.read"), color: first, points: read },
    { key: "write", label: t("resourceUsage.write"), color: second, points: write },
  ];
  const netSeries: SparkSeries[] = [
    { key: "rx", label: t("resourceUsage.rx"), color: first, points: rx },
    { key: "tx", label: t("resourceUsage.tx"), color: second, points: tx },
  ];
  const readNow = latest(read);
  const writeNow = latest(write);
  const rxNow = latest(rx);
  const txNow = latest(tx);

  return (
    <div className="grid grid-cols-1 gap-2 @[420px]:grid-cols-2">
      <Tile
        icon={<Cpu size={13} />}
        title={t("resourceUsage.cpu")}
        value={cpuNow === null ? dash : pct(cpuNow)}
        {...(coresCount ? { detail: cores.length ? t("resourceUsage.coresBusiest", { count: coresCount, max: pct(Math.max(...cores)) }) : t("resourceUsage.cores", { count: coresCount }) } : {})}
      >
        <ResourceSpark series={[{ key: "cpu", label: t("resourceUsage.cpu"), color: first, points: cpu }]} max={100} format={pct} topLabel={pct(100)} label={aria(t("resourceUsage.cpu"), cpu, pct)} />
        <CoreBars cores={cores} color={first} />
      </Tile>
      <Tile
        icon={<MemoryStick size={13} />}
        title={t("resourceUsage.memory")}
        value={mem ? formatBytes(mem.used, locale) : dash}
        {...(mem ? { detail: t("resourceUsage.ofTotal", { total: formatBytes(mem.total, locale) }) } : {})}
      >
        <ResourceSpark series={[{ key: "mem", label: t("resourceUsage.memory"), color: first, points: memPct }]} min={memRange.low} max={memRange.high} area={false} format={pct} topLabel={t("resourceUsage.range", { low: pct(memRange.low), high: pct(memRange.high) })} label={aria(t("resourceUsage.memory"), memPct, pct)} />
        {mem?.swapTotal ? (
          <div className="mt-2 flex items-center gap-2 text-[11px] leading-4 text-ink-secondary">
            <span className="shrink-0">{t("resourceUsage.swapLabel")}</span>
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[0.08]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((mem.swapUsed ?? 0) / mem.swapTotal) * 100)} aria-label={t("resourceUsage.swap", { used: formatBytes(mem.swapUsed ?? 0, locale), total: formatBytes(mem.swapTotal, locale) })}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, ((mem.swapUsed ?? 0) / mem.swapTotal) * 100)}%`, background: first }} />
            </div>
            <span className="shrink-0 text-ink tabular-nums">{t("resourceUsage.of", { used: formatBytes(mem.swapUsed ?? 0, locale), total: formatBytes(mem.swapTotal, locale) })}</span>
          </div>
        ) : null}
      </Tile>
      <Tile
        icon={<Gauge size={13} />}
        title={t("resourceUsage.disk")}
        value={readNow === null && writeNow === null ? dash : rate((readNow ?? 0) + (writeNow ?? 0))}
        legend={<Legend items={diskSeries.map((one, index) => ({ key: one.key, label: one.label, color: one.color, value: [readNow, writeNow][index] === null ? dash : rate([readNow, writeNow][index]!) }))} />}
      >
        <ResourceSpark series={diskSeries} max={diskMax} format={rate} topLabel={rate(diskMax)} area={false} label={`${aria(t("resourceUsage.diskRead"), read, rate)} ${aria(t("resourceUsage.diskWrite"), write, rate)}`} />
      </Tile>
      <Tile
        icon={<Network size={13} />}
        title={t("resourceUsage.network")}
        value={rxNow === null && txNow === null ? dash : rate((rxNow ?? 0) + (txNow ?? 0))}
        legend={<Legend items={netSeries.map((one, index) => ({ key: one.key, label: one.label, color: one.color, value: [rxNow, txNow][index] === null ? dash : rate([rxNow, txNow][index]!) }))} />}
      >
        <ResourceSpark series={netSeries} max={netMax} format={rate} topLabel={rate(netMax)} area={false} label={`${aria(t("resourceUsage.netIn"), rx, rate)} ${aria(t("resourceUsage.netOut"), tx, rate)}`} />
      </Tile>
      <Volumes snapshot={snapshot} color={first} />
    </div>
  );
}

const ERROR_KEY: Record<string, LocaleKey> = {
  unreachable: "resourceUsage.error.unreachable",
  forbidden: "resourceUsage.error.forbidden",
  dropped: "resourceUsage.error.dropped",
  "no-data": "resourceUsage.error.no-data",
};

const REASON_KEY: Record<string, LocaleKey> = {
  time: "resourceUsage.reason.time",
  idle: "resourceUsage.reason.idle",
  replaced: "resourceUsage.reason.replaced",
  person: "resourceUsage.reason.person",
};

/** The card's drawing for one state: pure, so tests and the gallery render it directly. */
export function ResourceUsageBody({ view, snapshot, gone = false, busy = false, scheme, now = Date.now(), initialMode = "charts", onPause, onResume }: {
  view: ResourceUsageView;
  snapshot: ResourceUsageSnapshot | null;
  gone?: boolean;
  busy?: boolean;
  scheme: ColorScheme;
  now?: number;
  /** The table view first (gallery, tests); the person toggles it with Valeurs. */
  initialMode?: "charts" | "table";
  onPause?: () => void;
  onResume?: () => void;
}) {
  const [mode, setMode] = useState<"charts" | "table">(initialMode);
  const locale = activeLocale();
  const state = gone ? "stopped" : snapshot?.state ?? "starting";
  const live = state === "live" || state === "starting";
  const host = snapshot?.host ?? {};
  const name = publicText(host.hostname, 80) || publicText(view.hostLabel, 80) || t(TARGET_LABEL[view.target]);
  const kind = view.target === "host" ? (publicText(view.label, 60) ?? t(TARGET_LABEL.host)) : t(TARGET_LABEL[view.target]);
  const about = [kind, publicText(host.os, 60), host.uptimeSec !== undefined ? t("resourceUsage.uptime", { value: formatUptime(host.uptimeSec, locale) }) : null].filter(Boolean).join(" · ");
  const problem = gone ? t("resourceUsage.error.gone") : state === "error" ? t(ERROR_KEY[snapshot?.error ?? ""] ?? "resourceUsage.error.unreachable") : null;
  const status = gone
    ? t("resourceUsage.ended")
    : state === "live" ? t("resourceUsage.live") : state === "starting" ? t("resourceUsage.starting") : state === "error" ? t("resourceUsage.stopped") : t("resourceUsage.paused");
  // tiles only with numbers to show, or while the first sample is on its way
  const drawn = Boolean(snapshot && !gone && (snapshot.frames.length > 0 || live));
  const footer = gone
    ? null
    : live
      ? (snapshot?.endsAt ? t("resourceUsage.endsIn", { time: clock(snapshot.endsAt - now) }) : t("resourceUsage.cadence"))
      : state === "paused" ? t(REASON_KEY[snapshot?.reason ?? "person"] ?? "resourceUsage.reason.person") : null;

  return (
    <div role="group" aria-label={t("resourceUsage.label", { host: name })} data-resource-card={state} className="w-full max-w-[600px] text-start">
      <div className={cn(SURFACE, "@container")}>
        <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary">
            <Gauge size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-6 text-ink" title={name}><bdi dir="auto">{name}</bdi></div>
            {about && <div className="line-clamp-2 text-[12.5px] leading-[18px] text-ink-secondary" title={about}>{about}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span data-resource-status={state} title={status} className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[12px] leading-5 text-ink-secondary @[420px]:px-2">
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", state === "live" && "motion-safe:animate-pulse")} style={{ background: state === "live" ? GOOD : state === "error" ? "var(--color-danger)" : "currentColor", opacity: state === "live" || state === "error" ? 1 : 0.45 }} />
              {status}
            </span>
            {!gone && (live
              ? <button type="button" className="ui-icon-button" aria-label={t("resourceUsage.pause")} title={t("resourceUsage.pause")} disabled={busy} onClick={onPause}><Pause size={14} /></button>
              : <button type="button" data-resource-resume="" className="inline-flex h-7 items-center gap-1 rounded-full bg-ink px-3 text-[12px] font-medium text-app disabled:opacity-50" disabled={busy} onClick={onResume}><Play size={12} aria-hidden="true" />{t("resourceUsage.resume")}</button>)}
          </div>
        </header>
        {drawn && snapshot && (
          <div className="px-3 pb-2">
            {mode === "charts" ? <Charts snapshot={snapshot} scheme={scheme} /> : <div className="px-1"><ValuesTable snapshot={snapshot} /></div>}
          </div>
        )}
        {problem && (
          <div role={gone ? "status" : "alert"} className={cn("mx-4 mb-3 flex items-start gap-2 text-[13px] leading-[18px]", gone ? "text-ink-secondary" : "text-danger")}>
            {gone ? <Info aria-hidden="true" size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle aria-hidden="true" size={14} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 break-words">{problem}</span>
          </div>
        )}
        {(footer || drawn) && (
          <footer className="flex items-center gap-2 px-4 pb-3 pt-0.5 text-[12px] leading-4 text-ink-tertiary">
            <span className="min-w-0 flex-1 tabular-nums">{footer}</span>
            {drawn && (
              <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-ink-secondary hover:bg-raised" aria-pressed={mode === "table"} onClick={() => setMode(mode === "table" ? "charts" : "table")}>
                {mode === "table" ? <ChartArea size={12} aria-hidden="true" /> : <Table2 size={12} aria-hidden="true" />}
                {t(mode === "table" ? "resourceUsage.charts" : "resourceUsage.values")}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

/** The chat card: live while on screen, paused by the server when it is not. */
export function ResourceUsageCard({ view }: { view: ResourceUsageView }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(ref);
  const scheme = useColorScheme();
  const usage = useResourceUsage(view.samplerId, visible);
  const [now, setNow] = useState(() => Date.now());
  const live = usage.snapshot?.state === "live" || usage.snapshot?.state === "starting";
  useEffect(() => {
    if (!live || !visible) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, visible]);
  return (
    <MessageBoundary fallbackText={t("resourceUsage.label", { host: publicText(view.hostLabel, 80) ?? "" })}>
      <div ref={ref} data-resource-usage="">
        <ResourceUsageBody
          view={view}
          snapshot={usage.snapshot}
          gone={usage.gone}
          busy={usage.busy}
          scheme={scheme}
          now={now}
          onPause={() => void usage.pause()}
          onResume={() => void usage.resume()}
        />
      </div>
    </MessageBoundary>
  );
}
