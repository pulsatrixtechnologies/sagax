// Pure helpers behind the usage card: the series each chart draws, a clean
// top for a throughput axis, the one-minute statistics of the table view and
// how full a volume reads. No React here, so all of it is tested directly.
import {
  RESOURCE_WINDOW_MS,
  type ResourceFrame,
  type ResourceStreamEvent,
  type ResourceUsageSnapshot,
} from "../../../shared/resource-usage";

export interface SeriesPoint {
  /** Seconds before the newest frame (0 = now, 60 = a minute ago). */
  age: number;
  value: number | null;
}

/** One value per frame, aged against the newest frame. */
export function seriesOf(frames: readonly ResourceFrame[], pick: (frame: ResourceFrame) => number | null | undefined): SeriesPoint[] {
  const newest = frames[frames.length - 1]?.t ?? 0;
  return frames
    .filter((frame) => newest - frame.t <= RESOURCE_WINDOW_MS)
    .map((frame) => {
      const value = pick(frame);
      return { age: (newest - frame.t) / 1000, value: typeof value === "number" && Number.isFinite(value) ? value : null };
    });
}

/** The last known value of a series, or null. */
export function latest(points: readonly SeriesPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]!.value;
    if (value !== null) return value;
  }
  return null;
}

export function stats(points: readonly SeriesPoint[]): { now: number | null; avg: number | null; max: number | null } {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null);
  if (!values.length) return { now: null, avg: null, max: null };
  return {
    now: latest(points),
    avg: values.reduce((total, value) => total + value, 0) / values.length,
    max: Math.max(...values),
  };
}

/** A clean top for a bytes-per-second axis: 1, 2 or 5 times a power of 1024-ish
 * steps, never under 64 KB/s so an idle link draws flat rather than noisy. */
export function niceRateMax(max: number): number {
  const floor = 64 * 1024;
  const target = Math.max(floor, Number.isFinite(max) ? max * 1.1 : floor);
  const units = [1, 1024, 1024 ** 2, 1024 ** 3, 1024 ** 4];
  let unit = units[0]!;
  for (const candidate of units) if (target >= candidate) unit = candidate;
  const scaled = target / unit;
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (scaled <= step) return step * unit;
  return 1024 * unit;
}

/** The part of 0-100 % a steady chart zooms on: tens around the values, at
 * least 20 points tall, so a flat memory line still shows its moves. */
export function percentRange(values: readonly number[]): { low: number; high: number } {
  const known = values.filter((value) => Number.isFinite(value));
  if (!known.length) return { low: 0, high: 100 };
  let low = Math.max(0, Math.floor((Math.min(...known) - 5) / 10) * 10);
  let high = Math.min(100, Math.ceil((Math.max(...known) + 5) / 10) * 10);
  if (high - low < 20) high = Math.min(100, low + 20);
  if (high - low < 20) low = Math.max(0, high - 20);
  return { low, high };
}

export type Fullness = "ok" | "high" | "critical";

/** 85% reads high, 95% critical: each with an icon and a word on the card, never color alone. */
export function fullness(used: number, total: number): Fullness {
  const ratio = total > 0 ? used / total : 0;
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.85) return "high";
  return "ok";
}

/** Applies one stream event to the card's state. */
export function applyEvent(snapshot: ResourceUsageSnapshot | null, event: ResourceStreamEvent, keep = 64): ResourceUsageSnapshot | null {
  if (event.kind === "snapshot") return event.snapshot;
  if (!snapshot) return snapshot;
  if (event.kind === "frame") {
    const frames = [...snapshot.frames, event.frame].slice(-keep);
    return { ...snapshot, state: snapshot.state === "starting" ? "live" : snapshot.state, frames, host: event.host ? { ...snapshot.host, ...event.host } : snapshot.host };
  }
  const next: ResourceUsageSnapshot = { ...snapshot, state: event.state };
  if (event.reason) next.reason = event.reason;
  else delete next.reason;
  if (event.endsAt) next.endsAt = event.endsAt;
  else delete next.endsAt;
  if (event.error) next.error = event.error;
  else delete next.error;
  return next;
}

/** Up to this many cores get their own bar; more fold into one summary line. */
export const CORE_BARS_MAX = 32;
