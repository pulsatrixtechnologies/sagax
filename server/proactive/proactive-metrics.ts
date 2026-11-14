// #2698: the per-bot proactivity ledger. One bucket per bot and day (the
// server's routine time zone), on disk at 0600 next to the proposals, kept
// DAYS_KEPT days. The counts and derived figures are described in
// shared/proactive-metrics.ts.
//
// Fed from four places in server/index.ts:
// - a proactive wake run that settles (RoutineManager onRunChanged): wakes,
//   reported / quiet / failed, cost; each run id counts once;
// - ProactiveProposals events: proposed, accepted, declined, expired;
// - a write step on a wake (noteWakeDryRun): writes.
//
// #4250 (S9): the usefulness figures (told, answered, ignored, time to
// answer, turns avoided by pre-checks, tokens per answered signal) are not
// counted here: `read` takes them from the signal ledger, the routine runs
// and the usage ledger at the time it is asked (usefulnessSources), so
// nothing is kept twice.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { analyticsDayKey, analyticsRange, type BotAnalyticsDays } from "../../shared/bot-analytics.ts";
import {
  aggregateProactiveMetrics,
  aggregateUsefulness,
  IGNORED_AFTER_HOURS,
  type UsefulnessRun,
  type UsefulnessSignal,
  type UsefulnessSources,
  type UsefulnessTurn,
  emptyProactiveBucket,
  normalizeProactiveBucket,
  type ProactiveMetrics,
  type ProactiveMetricsBucket,
  type ProactiveMetricsCount,
} from "../../shared/proactive-metrics.ts";
import type { RoutineRun } from "../../shared/routines.ts";
import { PRODUCT_FIX_KIND } from "../perspicax/product-fix-cards.ts";
import { REACH_CARD_KIND } from "../reach-me/service.ts";
import { ROUTINE_PROBLEM_KIND } from "../routines/routine-problem-card.ts";
import { CARD_ANSWER_KIND } from "./answer-learning.ts";
import type { SignalEntry } from "./signal-ledger.ts";

export const PROACTIVE_METRICS_DAYS_KEPT = 400;
const SETTLED_KEPT = 2000;
const SAVE_DELAY_MS = 2000;

const SETTLED_STATUSES = new Set(["completed", "failed", "blocked", "cancelled", "missed", "nothing_to_report"]);
const FAILED_STATUSES = new Set(["failed", "blocked", "missed"]);

export interface ProactiveMetricsOptions {
  /** null keeps everything in memory (tests). */
  file: string | null;
  now?: () => number;
  /** IANA zone the days are cut in; UTC when absent. */
  timeZone?: () => string;
  /** Save right away instead of batching (tests). */
  saveNow?: boolean;
  /** #4250 (S9): what the usefulness figures read for one bot. */
  usefulness?: (botId: string, range: { from: Date; to: Date }) => UsefulnessSources;
}

type Ledger = Record<string, Record<string, ProactiveMetricsBucket>>;

export class ProactiveMetricsLedger {
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly timeZone: () => string;
  private readonly saveNow: boolean;
  private readonly usefulness: ProactiveMetricsOptions["usefulness"];
  private bots: Ledger = {};
  private settled: string[] = [];
  private settledSet = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ProactiveMetricsOptions) {
    this.file = options.file;
    this.now = options.now ?? (() => Date.now());
    this.timeZone = options.timeZone ?? (() => "UTC");
    this.saveNow = options.saveNow ?? false;
    this.usefulness = options.usefulness;
    if (!this.file) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { bots?: unknown; settled?: unknown };
      if (parsed.bots && typeof parsed.bots === "object") {
        for (const [botId, days] of Object.entries(parsed.bots as Record<string, unknown>)) {
          if (!days || typeof days !== "object") continue;
          const kept: Record<string, ProactiveMetricsBucket> = {};
          for (const [day, bucket] of Object.entries(days as Record<string, unknown>)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(day)) kept[day] = normalizeProactiveBucket(bucket);
          }
          this.bots[botId] = kept;
        }
      }
      if (Array.isArray(parsed.settled)) {
        this.settled = parsed.settled.filter((id): id is string => typeof id === "string").slice(-SETTLED_KEPT);
        this.settledSet = new Set(this.settled);
      }
    } catch {
      this.bots = {};
    }
  }

  private zone(): string {
    try {
      return this.timeZone() || "UTC";
    } catch {
      return "UTC";
    }
  }

  private bucket(botId: string, at = this.now()): ProactiveMetricsBucket {
    const day = analyticsDayKey(at, this.zone());
    const days = (this.bots[botId] ??= {});
    return (days[day] ??= emptyProactiveBucket());
  }

  private prune(): void {
    const cutoff = analyticsDayKey(this.now() - PROACTIVE_METRICS_DAYS_KEPT * 86_400_000, this.zone());
    for (const days of Object.values(this.bots)) {
      for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
    }
  }

  private changed(): void {
    if (!this.file) return;
    if (this.saveNow) {
      this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  /** Write the ledger now (also called on shutdown). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.file) return;
    this.prune();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileAtomic(this.file, JSON.stringify({ version: 1, bots: this.bots, settled: this.settled }), { mode: 0o600 });
    } catch {
      /* kept in memory until the next change */
    }
  }

  count(botId: string, key: ProactiveMetricsCount, by = 1): void {
    if (!botId || !(by > 0)) return;
    this.bucket(botId)[key] += by;
    this.changed();
  }

  /** A proactive wake run changed: counted once, when it settles. */
  noteRun(run: Pick<RoutineRun, "id" | "botId" | "status" | "quiet" | "cost" | "finishedAt"> & { proactive?: unknown }): boolean {
    if (!run.proactive || !run.botId || !SETTLED_STATUSES.has(run.status)) return false;
    if (this.settledSet.has(run.id)) return false;
    this.settledSet.add(run.id);
    this.settled.push(run.id);
    if (this.settled.length > SETTLED_KEPT) {
      for (const id of this.settled.splice(0, this.settled.length - SETTLED_KEPT)) this.settledSet.delete(id);
    }
    const bucket = this.bucket(run.botId, typeof run.finishedAt === "number" ? run.finishedAt : this.now());
    bucket.wakes += 1;
    if (run.status === "nothing_to_report" || (run.status === "completed" && run.quiet)) bucket.quiet += 1;
    else if (run.status === "completed") bucket.reported += 1;
    else if (FAILED_STATUSES.has(run.status)) bucket.failed += 1;
    if (typeof run.cost === "number" && Number.isFinite(run.cost) && run.cost > 0) {
      bucket.cost += run.cost;
      bucket.costRuns += 1;
    }
    this.changed();
    return true;
  }

  /** The bot's figures over the last `days` days, today included. */
  read(botId: string, days: BotAnalyticsDays): ProactiveMetrics {
    const now = this.now();
    const { dayKeys, from, to } = analyticsRange(days, now, this.zone());
    const metrics = aggregateProactiveMetrics(botId, this.bots[botId] ?? {}, dayKeys);
    if (!this.usefulness) return metrics;
    let sources: UsefulnessSources;
    try {
      sources = this.usefulness(botId, { from, to });
    } catch (error) {
      console.warn(`proactive metrics: the usefulness sources could not be read (${error instanceof Error ? error.message : "error"})`);
      return metrics;
    }
    const { usefulness, routines } = aggregateUsefulness(sources, { from: from.getTime(), to: to.getTime(), now });
    return { ...metrics, usefulness, routines, ignoredAfterHours: IGNORED_AFTER_HOURS };
  }

  forgetBot(botId: string): void {
    if (!this.bots[botId]) return;
    delete this.bots[botId];
    this.changed();
  }
}

/** #4250 (S9): what the usefulness figures read, for one bot. */
export interface UsefulnessSourceDeps {
  /** The bot's entries in every person's signal ledger. */
  signals(botId: string): readonly SignalEntry[];
  /** The bot's routine runs (the routine store's log). */
  runs(botId: string): readonly RoutineRun[];
  /** The bot's routine turns of the usage ledger over the range. */
  turns(botId: string, range: { from: Date; to: Date }): ReadonlyArray<{ at: string | number; input: number; output: number; routineId?: string }>;
  /** A routine's current name in the routine store (a routine whose runs
   * fell out of the kept log still has one). */
  routineName?(routineId: string): string | undefined;
}

/** The kinds that wait on the person's answer: a card, a question, a
 * proposal, a keyed or fix card ("engine-fallback": index.ts
 * ENGINE_FALLBACK_KIND). A notice told only for information (a run's
 * problem, a reach notice, a paused routine) is not one. */
const AWAITING_KINDS: ReadonlySet<string> = new Set(["proposal", "needs-you", ROUTINE_PROBLEM_KIND, PRODUCT_FIX_KIND, "engine-fallback"]);

/** #4250 (S9): whether a ledger entry waits on the person's answer (so it
 * can count as answered or ignored): its kind is one, or it points at a
 * card's request. */
export function signalAwaitsAnswer(entry: Pick<SignalEntry, "kind" | "ref">): boolean {
  return AWAITING_KINDS.has(entry.kind) || Boolean(entry.ref?.requestId);
}

/** The routine a run's key names (`run-problem:<run>:...`, `run-access:<run>`,
 * `run-deferred:<run>:...`, `needs-you:run:<run>:<card>`). */
const RUN_KEY = /^(?:run-problem|run-access|run-deferred|needs-you:run):([^:@]+)/;
/** The routine a routine's key names (`routine-problem:<routine>`,
 * `away-skips:<routine>:...`, `routine-suspended:<routine>:...`). */
const ROUTINE_KEY = /^(?:routine-problem|away-skips|routine-suspended):([^:@]+)/;

/** #4250 (S9): the routine a ledger entry belongs to: the one its key names,
 * else the run whose conversation it points at; "" when none. */
export function signalRoutineId(entry: Pick<SignalEntry, "key" | "ref">, runs: { byId: ReadonlyMap<string, RoutineRun>; byThread: ReadonlyMap<string, RoutineRun> }): string {
  const routine = ROUTINE_KEY.exec(entry.key);
  if (routine) return routine[1]!;
  const run = RUN_KEY.exec(entry.key);
  if (run) return runs.byId.get(run[1]!)?.routineId ?? "";
  const thread = entry.ref?.threadId;
  return (thread && runs.byThread.get(thread)?.routineId) || "";
}

/** #4250 (S9): the ledger's items told to the person (an answer record of
 * answer learning is not one), each with its routine; the runs; the routine
 * turns. */
export function usefulnessSources(deps: UsefulnessSourceDeps): (botId: string, range: { from: Date; to: Date }) => UsefulnessSources {
  return (botId, range) => {
    const runList = deps.runs(botId);
    const byId = new Map<string, RoutineRun>();
    const byThread = new Map<string, RoutineRun>();
    for (const run of runList) {
      byId.set(run.id, run);
      for (const thread of [run.threadId, run.executionThreadId, run.sourceThreadId]) if (thread && !byThread.has(thread)) byThread.set(thread, run);
    }
    const signals: UsefulnessSignal[] = [];
    for (const entry of deps.signals(botId)) {
      // an answer record of answer learning is not a signal; an approval's
      // reach entry is the reminder ladder of a card whose own entry
      // (needs-you, keyed card) already speaks for it, and an approval of a
      // live chat is not a proactive signal
      if (entry.kind === CARD_ANSWER_KIND || entry.kind === REACH_CARD_KIND || !Number.isFinite(entry.toldAt)) continue;
      const routineId = signalRoutineId(entry, { byId, byThread });
      signals.push({
        state: entry.state, firstAt: entry.firstAt, toldAt: entry.toldAt, awaits: signalAwaitsAnswer(entry),
        ...(Number.isFinite(entry.answeredAt) ? { answeredAt: entry.answeredAt } : {}),
        ...(routineId ? { routineId } : {}),
      });
    }
    const runs: UsefulnessRun[] = runList.filter((run) => Boolean(run.routineId)).map((run) => ({
      routineId: run.routineId, routineName: run.routineName, status: run.status, scheduledFor: run.scheduledFor,
      ...(typeof run.startedAt === "number" ? { startedAt: run.startedAt } : {}),
      ...(typeof run.finishedAt === "number" ? { finishedAt: run.finishedAt } : {}),
    }));
    const turns: UsefulnessTurn[] = [];
    for (const row of deps.turns(botId, range)) {
      if (!row.routineId) continue;
      const at = typeof row.at === "number" ? row.at : Date.parse(row.at);
      const tokens = (Number.isFinite(row.input) ? row.input : 0) + (Number.isFinite(row.output) ? row.output : 0);
      turns.push({ at, tokens, routineId: row.routineId });
    }
    return { signals, runs, turns, ...(deps.routineName ? { routineName: (routineId: string) => deps.routineName!(routineId) } : {}) };
  };
}
