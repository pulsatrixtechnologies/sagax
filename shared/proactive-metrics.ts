// #2698: the proactivity metrics of one bot, per day. The ledger
// (server/proactive/proactive-metrics.ts) counts what the proactive layer did;
// this file holds the shape, the per-day sums and the derived figures the
// bot's Analytics tab and GET /api/bots/:id/proactive-metrics show.
//
// What each count means:
// - wakes: proactive wakes that settled (completed, failed, blocked, ...);
//   reported: completed wakes that spoke (not quiet); quiet: completed and
//   silent; failed: any other end;
// - proposed / accepted / declined / expired: the proposal cards of the
//   propose mode (expired = no answer within PROPOSAL_TTL_MS);
// - writes: write steps a wake took (each one recorded as a dry run first,
//   then sent through the ordinary approval path);
// - cost: the summed run cost of the wakes that carried one (costRuns).
//
// Derived:
// - precision: accepted / (accepted + declined + expired), null with no
//   answered or expired proposal;
// - minutesSaved: an estimate, stated as such in the UI:
//   MINUTES_PER_REPORT per wake that reported, MINUTES_PER_WRITE per write,
//   MINUTES_PER_ACCEPTED per accepted proposal.

export interface ProactiveMetricsBucket {
  wakes: number;
  reported: number;
  quiet: number;
  failed: number;
  proposed: number;
  accepted: number;
  declined: number;
  expired: number;
  writes: number;
  cost: number;
  costRuns: number;
}

export type ProactiveMetricsCount = Exclude<keyof ProactiveMetricsBucket, "cost">;

export interface ProactiveMetricsTotals extends ProactiveMetricsBucket {
  precision: number | null;
  minutesSaved: number;
}

export interface ProactiveMetricsDay extends ProactiveMetricsBucket {
  day: string;
}

export interface ProactiveMetrics {
  botId: string;
  days: number;
  from: string;
  to: string;
  totals: ProactiveMetricsTotals;
  series: ProactiveMetricsDay[];
  /** Wording of the time estimate, so the client labels it honestly. */
  minutesPerReport: number;
  minutesPerWrite: number;
  minutesPerAccepted: number;
}

export const MINUTES_PER_REPORT = 10;
export const MINUTES_PER_WRITE = 2;
export const MINUTES_PER_ACCEPTED = 5;

export function emptyProactiveBucket(): ProactiveMetricsBucket {
  return { wakes: 0, reported: 0, quiet: 0, failed: 0, proposed: 0, accepted: 0, declined: 0, expired: 0, writes: 0, cost: 0, costRuns: 0 };
}

const KEYS = Object.keys(emptyProactiveBucket()) as (keyof ProactiveMetricsBucket)[];

/** A stored bucket read defensively: a missing or bad field is 0. */
export function normalizeProactiveBucket(raw: unknown): ProactiveMetricsBucket {
  const out = emptyProactiveBucket();
  if (!raw || typeof raw !== "object") return out;
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

export function addProactiveBuckets(into: ProactiveMetricsBucket, add: ProactiveMetricsBucket): ProactiveMetricsBucket {
  for (const key of KEYS) into[key] += add[key];
  return into;
}

export function proactivePrecision(bucket: Pick<ProactiveMetricsBucket, "accepted" | "declined" | "expired">): number | null {
  const judged = bucket.accepted + bucket.declined + bucket.expired;
  return judged > 0 ? bucket.accepted / judged : null;
}

export function proactiveMinutesSaved(bucket: Pick<ProactiveMetricsBucket, "reported" | "writes" | "accepted">): number {
  return bucket.reported * MINUTES_PER_REPORT + bucket.writes * MINUTES_PER_WRITE + bucket.accepted * MINUTES_PER_ACCEPTED;
}

/** Sum the stored days over the range's day keys (oldest first). */
export function aggregateProactiveMetrics(
  botId: string,
  stored: Readonly<Record<string, unknown>>,
  dayKeys: readonly string[],
): ProactiveMetrics {
  const series = dayKeys.map((day) => ({ day, ...normalizeProactiveBucket(stored[day]) }));
  const sum = emptyProactiveBucket();
  for (const day of series) addProactiveBuckets(sum, day);
  sum.cost = Math.round(sum.cost * 1e6) / 1e6;
  return {
    botId,
    days: dayKeys.length,
    from: dayKeys[0] ?? "",
    to: dayKeys[dayKeys.length - 1] ?? "",
    totals: { ...sum, precision: proactivePrecision(sum), minutesSaved: proactiveMinutesSaved(sum) },
    series,
    minutesPerReport: MINUTES_PER_REPORT,
    minutesPerWrite: MINUTES_PER_WRITE,
    minutesPerAccepted: MINUTES_PER_ACCEPTED,
  };
}
