// #5014 (M-20261119-016): the planner's forecast of usage, per bot and per
// hour of the day, an exponentially weighted moving average of what each
// hour cost on the days before. Fed by the usage ledger's rows (the cost a
// settled turn booked, its equivalent on a subscription), so it counts the
// same demand Sagax already books, never a figure of its own. One file under
// <data>/usage/, written atomically and at most once a minute.
//
// An hour with no turn counts as zero once it has passed, so a bot that
// stopped working fades out of the forecast. The hour of the day is the UTC
// hour: a day's rhythm repeats every 24 hours in any zone.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { reportBackgroundError } from "../background-error.ts";

export const FORECAST_ALPHA = 0.3;
export const HOUR_MS = 3_600_000;
/** The planner waits for this much history before it plans (#5014). */
export const FORECAST_HISTORY_MS = 7 * 24 * HOUR_MS;
/** At most this many hours are folded at once after a long gap. */
const MAX_FOLD_HOURS = 24 * 8;
const MAX_BOTS = 500;
const SAVE_EVERY_MS = 60_000;

interface BotSeries {
  payer: string;
  /** When this bot's first turn was booked. */
  firstAt: number;
  /** The EWMA per UTC hour of the day (24). */
  hours: number[];
  /** The hour (epoch hours) `pending` belongs to. */
  hour: number;
  pending: number;
}

interface Saved { version: 1; bots: Record<string, BotSeries>; scales?: Record<string, number> }

export interface UsageForecast {
  /** A settled turn's cost, for its payer and bot, at `at`. */
  record(payer: string, botId: string, units: number, at?: number): void;
  /** The forecast demand of this payer's bots, per hour from now (`hours` steps). */
  demand(payer: string, hours: number): number[];
  /** How long this payer's oldest bot has been booking turns, in ms. */
  history(payer: string): number;
  /** The planner's scales (account meter), kept with the forecast. */
  scales: Map<string, number>;
  flush(): void;
}

const epochHour = (at: number) => Math.floor(at / HOUR_MS);
const hourOfDay = (hour: number) => ((hour % 24) + 24) % 24;

export function createUsageForecast(options: { dataDir?: string; now?: () => number } = {}): UsageForecast {
  const now = options.now ?? (() => Date.now());
  const file = options.dataDir ? join(options.dataDir, "usage", "account-forecast.json") : null;
  const bots = new Map<string, BotSeries>();
  const scales = new Map<string, number>();
  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Saved;
      for (const [botId, series] of Object.entries(raw?.bots ?? {})) {
        if (series && Array.isArray(series.hours) && series.hours.length === 24 && typeof series.payer === "string") bots.set(botId, series);
      }
      for (const [id, value] of Object.entries(raw?.scales ?? {})) if (typeof value === "number" && value > 0) scales.set(id, value);
    } catch {
      // no forecast yet
    }
  }
  let dirty = false;
  let savedAt = 0;
  const save = (force = false) => {
    // the scales (account meter) change in place: a forced save writes them too
    if (!file || (!force && (!dirty || now() - savedAt < SAVE_EVERY_MS))) return;
    try {
      const saved: Saved = { version: 1, bots: Object.fromEntries(bots), scales: Object.fromEntries(scales) };
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileAtomic(file, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
      savedAt = now();
      dirty = false;
    } catch (error) {
      reportBackgroundError(error);
    }
  };
  /** Folds every hour that passed into the averages, zero for an hour with no turn. */
  const roll = (series: BotSeries, to: number) => {
    if (series.hour >= to) return;
    const fold = (hour: number, value: number) => {
      const slot = hourOfDay(hour);
      series.hours[slot] = FORECAST_ALPHA * value + (1 - FORECAST_ALPHA) * series.hours[slot]!;
    };
    fold(series.hour, series.pending);
    const from = Math.max(series.hour + 1, to - MAX_FOLD_HOURS);
    for (let hour = from; hour < to; hour++) fold(hour, 0);
    series.hour = to;
    series.pending = 0;
    dirty = true;
  };

  return {
    scales,
    record(payer, botId, units, at = now()) {
      if (!(units > 0) || !Number.isFinite(units)) return;
      const hour = epochHour(at);
      let series = bots.get(botId);
      if (!series) {
        series = { payer: payer.trim().toLowerCase(), firstAt: at, hours: Array.from({ length: 24 }, () => 0), hour, pending: 0 };
        bots.set(botId, series);
        while (bots.size > MAX_BOTS) bots.delete(bots.keys().next().value as string);
      }
      series.payer = payer.trim().toLowerCase();
      roll(series, hour);
      series.pending += units;
      dirty = true;
      save();
    },
    demand(payer, hours) {
      const who = payer.trim().toLowerCase();
      const at = epochHour(now());
      const out = Array.from({ length: Math.max(0, hours) }, () => 0);
      for (const series of bots.values()) {
        if (series.payer !== who) continue;
        roll(series, at);
        for (let step = 0; step < out.length; step++) out[step]! += series.hours[hourOfDay(at + step)]!;
      }
      save();
      return out;
    },
    history(payer) {
      const who = payer.trim().toLowerCase();
      let first = Infinity;
      for (const series of bots.values()) if (series.payer === who) first = Math.min(first, series.firstAt);
      return Number.isFinite(first) ? Math.max(0, now() - first) : 0;
    },
    flush() {
      save(true);
    },
  };
}
