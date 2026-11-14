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
//
// #4250 (S9) usefulness, read from the signal ledger and the routine runs
// (server/proactive/proactive-metrics.ts usefulnessSources), for the bot and
// per routine, over the same range:
// - told: items told to the person (a ledger entry with a toldAt), by the
//   start of their spell (firstAt);
// - answered, ignored: only of the items that wait on the person's answer
//   (`awaits`: a card, a question, a proposal, a keyed or fix card); a
//   notice told for information (a run's failure, a reach notice, a paused
//   routine) counts as told, never as answered or ignored. Answered: the
//   person answered it; ignored: expired, or still unanswered
//   IGNORED_AFTER_HOURS after it was raised (firstAt); an item whose cause
//   went away, or that the server closed (retired), is neither;
// - medianAnswerMs: the median time from raised (firstAt) to answered, null with none;
// - turnsAvoided: runs a pre-check ended with nothing to do (no model turn);
// - tokens: input plus output of the routine turns; tokensPerAnswered:
//   tokens / answered, null with no answer.

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
  /** #4250 (S9): absent from a server before it. */
  usefulness?: SignalUsefulness;
  /** #4250 (S9): per routine, the busiest first. */
  routines?: RoutineUsefulness[];
  ignoredAfterHours?: number;
}

export interface SignalUsefulness {
  told: number;
  answered: number;
  ignored: number;
  medianAnswerMs: number | null;
  turnsAvoided: number;
  tokens: number;
  tokensPerAnswered: number | null;
}

export interface RoutineUsefulness extends SignalUsefulness {
  routineId: string;
  name: string;
}

/** An item told to the person, as the aggregate reads it (a ledger entry
 * with the routine it belongs to, when it has one). */
export interface UsefulnessSignal {
  state: string;
  firstAt: number;
  toldAt?: number;
  answeredAt?: number;
  routineId?: string;
  /** It waits on the person's answer; absent, it only told them. */
  awaits?: boolean;
}

/** A routine run as the aggregate reads it (server RoutineRun fits). */
export interface UsefulnessRun {
  routineId: string;
  routineName?: string;
  status: string;
  scheduledFor: number;
  startedAt?: number;
  finishedAt?: number;
}

/** A routine turn of the usage ledger. */
export interface UsefulnessTurn {
  at: number;
  tokens: number;
  routineId: string;
}

export interface UsefulnessSources {
  signals: readonly UsefulnessSignal[];
  runs: readonly UsefulnessRun[];
  turns: readonly UsefulnessTurn[];
  /** A routine's current name (the routine store), before any run's. */
  routineName?: (routineId: string) => string | undefined;
}

export const IGNORED_AFTER_HOURS = 24;
export const USEFULNESS_ROUTINES_SHOWN = 20;

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

function emptyUsefulness(): SignalUsefulness {
  return { told: 0, answered: 0, ignored: 0, medianAnswerMs: null, turnsAvoided: 0, tokens: 0, tokensPerAnswered: null };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** #4250 (S9): the bot's usefulness and each routine's over [from, to]. */
export function aggregateUsefulness(
  sources: UsefulnessSources,
  range: { from: number; to: number; now: number },
): { usefulness: SignalUsefulness; routines: RoutineUsefulness[] } {
  const inRange = (at: number) => Number.isFinite(at) && at >= range.from && at <= range.to;
  const ignoredAfter = IGNORED_AFTER_HOURS * 3_600_000;
  const bot = emptyUsefulness();
  const botWaits: number[] = [];
  const perRoutine = new Map<string, { figures: SignalUsefulness; waits: number[]; name: string }>();
  const routine = (routineId: string) => {
    let found = perRoutine.get(routineId);
    if (!found) {
      found = { figures: emptyUsefulness(), waits: [], name: sources.routineName?.(routineId) ?? "" };
      perRoutine.set(routineId, found);
    }
    return found;
  };
  for (const signal of sources.signals) {
    if (!Number.isFinite(signal.toldAt) || !inRange(signal.firstAt)) continue;
    const targets = [bot];
    const waits = [botWaits];
    if (signal.routineId) {
      const own = routine(signal.routineId);
      targets.push(own.figures);
      waits.push(own.waits);
    }
    const awaits = signal.awaits === true;
    const answered = awaits && signal.state === "answered";
    const ignored = awaits && (signal.state === "expired" || ((signal.state === "told" || signal.state === "open") && range.now - signal.firstAt >= ignoredAfter));
    const wait = answered && Number.isFinite(signal.answeredAt) ? Math.max(0, signal.answeredAt! - signal.firstAt) : null;
    for (const figures of targets) {
      figures.told += 1;
      if (answered) figures.answered += 1;
      if (ignored) figures.ignored += 1;
    }
    if (wait !== null) for (const list of waits) list.push(wait);
  }
  for (const run of sources.runs) {
    if (!run.routineId) continue;
    const own = routine(run.routineId);
    if (run.routineName && !own.name) own.name = run.routineName;
    if (run.status !== "nothing_to_report") continue;
    if (!inRange(run.finishedAt ?? run.startedAt ?? run.scheduledFor)) continue;
    bot.turnsAvoided += 1;
    own.figures.turnsAvoided += 1;
  }
  for (const turn of sources.turns) {
    if (!inRange(turn.at) || !(turn.tokens > 0)) continue;
    bot.tokens += turn.tokens;
    if (turn.routineId) routine(turn.routineId).figures.tokens += turn.tokens;
  }
  const finish = (figures: SignalUsefulness, waits: number[]) => {
    figures.medianAnswerMs = median(waits);
    figures.tokensPerAnswered = figures.answered > 0 ? Math.round(figures.tokens / figures.answered) : null;
    return figures;
  };
  const routines = [...perRoutine]
    .map(([routineId, { figures, waits, name }]) => ({ routineId, name, ...finish(figures, waits) }))
    .filter((row) => row.told + row.turnsAvoided + row.tokens > 0)
    .sort((left, right) => right.told - left.told || right.turnsAvoided - left.turnsAvoided || right.tokens - left.tokens || left.routineId.localeCompare(right.routineId))
    .slice(0, USEFULNESS_ROUTINES_SHOWN);
  return { usefulness: finish(bot, botWaits), routines };
}
