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

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { analyticsDayKey, analyticsRange, type BotAnalyticsDays } from "../../shared/bot-analytics.ts";
import {
  aggregateProactiveMetrics,
  emptyProactiveBucket,
  normalizeProactiveBucket,
  type ProactiveMetrics,
  type ProactiveMetricsBucket,
  type ProactiveMetricsCount,
} from "../../shared/proactive-metrics.ts";
import type { RoutineRun } from "../../shared/routines.ts";

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
}

type Ledger = Record<string, Record<string, ProactiveMetricsBucket>>;

export class ProactiveMetricsLedger {
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly timeZone: () => string;
  private readonly saveNow: boolean;
  private bots: Ledger = {};
  private settled: string[] = [];
  private settledSet = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ProactiveMetricsOptions) {
    this.file = options.file;
    this.now = options.now ?? (() => Date.now());
    this.timeZone = options.timeZone ?? (() => "UTC");
    this.saveNow = options.saveNow ?? false;
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
    const { dayKeys } = analyticsRange(days, this.now(), this.zone());
    return aggregateProactiveMetrics(botId, this.bots[botId] ?? {}, dayKeys);
  }

  forgetBot(botId: string): void {
    if (!this.bots[botId]) return;
    delete this.bots[botId];
    this.changed();
  }
}
