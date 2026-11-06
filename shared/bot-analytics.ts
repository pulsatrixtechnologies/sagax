// Per-bot analytics (GET /api/bots/:id/analytics, server/routes/bot-analytics.ts).
// The usage ledger (server/usage/usage-ledger.ts) is the only source: one
// ledger row is one turn, so messages and turns are the same count. Nothing
// here is estimated; a value the ledger does not carry comes back null.
//
// Day keys are YYYY-MM-DD in the server's time zone (the route passes it;
// the pure aggregate defaults to UTC). `series` holds one element per day of
// the range, empty days included, oldest first.
//
// Per day:
// - tokens: input + output of the day's turns (the same input-plus-output
//   meaning as the headline counters in src/lib/usage.ts; cached input is
//   not subtracted here).
// - costUsd: sum of the finite costs of the day's turns; null when the day
//   has turns and none carries a cost; 0 on a day without turns.
// - conversations: distinct threadIds of the day's turns.
// - routinesRun: turns whose trigger is a routine.
// - routinesFailed: routine runs of the bot that failed that day (bucketed
//   by finishedAt, else startedAt, else scheduledFor); 0 when the caller
//   has no run store.
// - hoursSaved: sum of the turns' durationMs in hours (the time the bot
//   worked for the person); null when the day has turns and none carries
//   a duration; 0 on a day without turns.
// Totals follow the same rules over the whole range: costUsd and hoursSaved
// are null when no row of the range carries the value.
// hoursSavedBasis is "turnDuration" when at least one row carries durationMs,
// else null (the client hides the metric).
//
// Top users group the turns by the person who spoke: trigger.principalId of
// a user turn (its lowercased email when the ledger stored no id), the
// runAsPrincipalId of a routine turn, else the thread owner
// (ownerPrincipalId), else, for an owner turn, the local operator the route
// names. A turn with no identifiable person is left out of topUsers (it still
// counts in the series). Names come from the directory the route provides;
// an unknown id is shown as the id itself, never as an invented label.

import { zonedParts, zonedTimeToUtc } from "./zoned-time.ts";

export type BotAnalyticsDays = 7 | 30 | 90;
export const BOT_ANALYTICS_DAYS: readonly BotAnalyticsDays[] = [7, 30, 90];

export interface BotAnalyticsDay {
  /** YYYY-MM-DD in the server's time zone. */
  day: string;
  messages: number;
  turns: number;
  tokens: number;
  costUsd: number | null;
  conversations: number;
  routinesRun: number;
  routinesFailed: number;
  hoursSaved: number | null;
}

export interface BotAnalyticsUser {
  principalId: string;
  name: string;
  messages: number;
  hoursSaved: number | null;
}

export interface BotAnalytics {
  from: string;
  to: string;
  days: BotAnalyticsDays;
  /** One element per day of the range, empty days included, oldest first. */
  series: BotAnalyticsDay[];
  totals: Omit<BotAnalyticsDay, "day">;
  /** Sorted by messages, descending; at most 20. */
  topUsers: BotAnalyticsUser[];
  hoursSavedBasis: "turnDuration" | null;
  currency: string | null;
}

/** The ledger fields the aggregate reads: a structural subset of the
 * server's UsageRow, so this module stays free of server imports. */
export interface BotAnalyticsRow {
  /** ISO text as the ledger stores it, or an epoch ms. */
  at: string | number;
  threadId: string;
  input: number;
  output: number;
  costUsd: number | null;
  durationMs?: number;
  trigger: {
    kind: "user" | "owner" | "routine" | "bot" | "helper";
    principalId?: string;
    runAsPrincipalId?: string;
    email?: string;
    label?: string;
  };
  ownerPrincipalId?: string;
}

/** A routine run as the aggregate reads it (server RoutineRun fits). */
export interface BotAnalyticsRun {
  status: string;
  scheduledFor: number;
  startedAt?: number;
  finishedAt?: number;
  runAs?: string;
}

export interface BotAnalyticsOptions {
  from: Date;
  to: Date;
  days: BotAnalyticsDays;
  /** Failed-run source; absent means routinesFailed stays 0. */
  runs?: BotAnalyticsRun[];
  /** Human label of a principal; "" or undefined falls back to the id. */
  names?: (principalId: string) => string | undefined;
  /** IANA zone the days are cut in; UTC when absent. */
  timeZone?: string;
  /** The person an owner turn belongs to when the row names nobody. */
  localPrincipalId?: string;
}

export const BOT_ANALYTICS_TOP_USERS = 20;
const HOUR_MS = 3_600_000;

/** `?days=` parsing: absent is 7; 7, 30 or 90 pass; anything else is null. */
export function parseAnalyticsDays(raw: string | null | undefined): BotAnalyticsDays | null {
  if (raw === null || raw === undefined || raw === "") return 7;
  const value = Number(raw);
  return (BOT_ANALYTICS_DAYS as readonly number[]).includes(value) ? (value as BotAnalyticsDays) : null;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

interface DayParts { year: number; month: number; day: number }

function keyOfParts(parts: DayParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The YYYY-MM-DD an instant falls on in a time zone. */
export function analyticsDayKey(at: number, timeZone = "UTC"): string {
  return keyOfParts(zonedParts(at, timeZone));
}

/** The calendar day `offset` days before a day (UTC arithmetic on the
 * calendar itself, so it never depends on the zone's offset). */
function dayBefore(parts: DayParts, offset: number): DayParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - offset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The range the route reads: from local midnight (days - 1) days ago up
 * to now, with the day keys the series must carry, oldest first. */
export function analyticsRange(days: BotAnalyticsDays, now: number, timeZone = "UTC"): { from: Date; to: Date; dayKeys: string[] } {
  const today = zonedParts(now, timeZone);
  const dayKeys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) dayKeys.push(keyOfParts(dayBefore(today, offset)));
  const first = dayBefore(today, days - 1);
  const from = zonedTimeToUtc(first.year, first.month, first.day, 0, 0, timeZone);
  return { from: new Date(from), to: new Date(now), dayKeys };
}

interface Speaker { id: string; name?: string }

function speakerOf(row: BotAnalyticsRow, localPrincipalId: string | undefined): Speaker | null {
  const trigger = row.trigger;
  if (trigger.kind === "user") {
    if (trigger.principalId) return { id: trigger.principalId };
    if (trigger.email) return { id: trigger.email.toLowerCase(), name: trigger.label || trigger.email };
  }
  if (trigger.kind === "routine" && trigger.runAsPrincipalId) return { id: trigger.runAsPrincipalId };
  if (row.ownerPrincipalId) return { id: row.ownerPrincipalId };
  if (trigger.kind === "owner" && localPrincipalId) return { id: localPrincipalId };
  return null;
}

interface DayBucket {
  turns: number;
  tokens: number;
  cost: number;
  costKnown: boolean;
  threads: Set<string>;
  routinesRun: number;
  routinesFailed: number;
  durationMs: number;
  durationKnown: boolean;
}

function emptyBucket(): DayBucket {
  return { turns: 0, tokens: 0, cost: 0, costKnown: false, threads: new Set(), routinesRun: 0, routinesFailed: 0, durationMs: 0, durationKnown: false };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function aggregateBotAnalytics(rows: BotAnalyticsRow[], options: BotAnalyticsOptions): BotAnalytics {
  const timeZone = options.timeZone ?? "UTC";
  // The series always carries `days` entries ending on the day `to` falls in.
  const { dayKeys } = analyticsRange(options.days, options.to.getTime(), timeZone);
  const buckets = new Map<string, DayBucket>(dayKeys.map((key) => [key, emptyBucket()]));
  const fromMs = options.from.getTime();
  const toMs = options.to.getTime();

  interface UserBucket { id: string; name?: string; messages: number; durationMs: number; durationKnown: boolean }
  const users = new Map<string, UserBucket>();
  let anyDuration = false;
  let anyCost = false;

  for (const row of rows) {
    const at = typeof row.at === "number" ? row.at : Date.parse(row.at);
    if (!Number.isFinite(at) || at < fromMs || at > toMs) continue;
    const bucket = buckets.get(analyticsDayKey(at, timeZone));
    if (!bucket) continue;
    bucket.turns += 1;
    bucket.tokens += (Number.isFinite(row.input) ? row.input : 0) + (Number.isFinite(row.output) ? row.output : 0);
    if (typeof row.costUsd === "number" && Number.isFinite(row.costUsd)) {
      bucket.cost += row.costUsd;
      bucket.costKnown = true;
      anyCost = true;
    }
    bucket.threads.add(row.threadId);
    if (row.trigger.kind === "routine") bucket.routinesRun += 1;
    const duration = typeof row.durationMs === "number" && Number.isFinite(row.durationMs) ? row.durationMs : null;
    if (duration !== null) {
      bucket.durationMs += duration;
      bucket.durationKnown = true;
      anyDuration = true;
    }
    const speaker = speakerOf(row, options.localPrincipalId);
    if (speaker) {
      let user = users.get(speaker.id);
      if (!user) {
        user = { id: speaker.id, name: speaker.name, messages: 0, durationMs: 0, durationKnown: false };
        users.set(speaker.id, user);
      }
      user.messages += 1;
      if (duration !== null) {
        user.durationMs += duration;
        user.durationKnown = true;
      }
    }
  }

  for (const run of options.runs ?? []) {
    if (run.status !== "failed") continue;
    const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    if (at < fromMs || at > toMs) continue;
    const bucket = buckets.get(analyticsDayKey(at, timeZone));
    if (bucket) bucket.routinesFailed += 1;
  }

  const series: BotAnalyticsDay[] = dayKeys.map((day) => {
    const bucket = buckets.get(day)!;
    return {
      day,
      messages: bucket.turns,
      turns: bucket.turns,
      tokens: bucket.tokens,
      costUsd: bucket.turns === 0 ? 0 : bucket.costKnown ? round(bucket.cost, 6) : null,
      conversations: bucket.threads.size,
      routinesRun: bucket.routinesRun,
      routinesFailed: bucket.routinesFailed,
      hoursSaved: bucket.turns === 0 ? 0 : bucket.durationKnown ? round(bucket.durationMs / HOUR_MS, 4) : null,
    };
  });

  const allThreads = new Set<string>();
  let totalTurns = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalRoutinesRun = 0;
  let totalRoutinesFailed = 0;
  let totalDurationMs = 0;
  for (const bucket of buckets.values()) {
    totalTurns += bucket.turns;
    totalTokens += bucket.tokens;
    totalCost += bucket.cost;
    totalRoutinesRun += bucket.routinesRun;
    totalRoutinesFailed += bucket.routinesFailed;
    totalDurationMs += bucket.durationMs;
    for (const thread of bucket.threads) allThreads.add(thread);
  }

  const topUsers: BotAnalyticsUser[] = [...users.values()]
    .map((user) => {
      const named = options.names?.(user.id);
      return {
        principalId: user.id,
        name: (named && named.trim()) || user.name || user.id,
        messages: user.messages,
        hoursSaved: user.durationKnown ? round(user.durationMs / HOUR_MS, 4) : null,
      };
    })
    .sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name) || a.principalId.localeCompare(b.principalId))
    .slice(0, BOT_ANALYTICS_TOP_USERS);

  return {
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    days: options.days,
    series,
    totals: {
      messages: totalTurns,
      turns: totalTurns,
      tokens: totalTokens,
      costUsd: anyCost ? round(totalCost, 6) : null,
      conversations: allThreads.size,
      routinesRun: totalRoutinesRun,
      routinesFailed: totalRoutinesFailed,
      hoursSaved: anyDuration ? round(totalDurationMs / HOUR_MS, 4) : null,
    },
    topUsers,
    hoursSavedBasis: anyDuration ? "turnDuration" : null,
    currency: null,
  };
}
