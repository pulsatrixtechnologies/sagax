// Usage traces: where each job spent its time and its money, read back from
// the durable USAGE ledger (server/usage-ledger.ts). A job is the finest unit
// the ledger can name on its own: the turns of one thread under one trigger,
// so a routine run, a person's conversation and a bot-to-bot exchange are
// separate jobs even when they share a thread. The per-turn breakdown is the
// trace itself; the job totals are time and cost rolled up.
//
// Adapted from OpenMausBot #3316 (usage as traces) but rebuilt on OUR ledger:
// no Cloud, no team, no credit or lending plumbing. Everything here is pure
// and offline, reads what the ledger already settled (counters, time, cost
// from server/model-prices.ts), and never any message text or secret.
//
// Who reads it: the owner or an organization member with usage.view
// (server/routes/usage.ts, shared/permissions.ts). Ids ride the wire for a
// copy affordance only; the app shows the human label, never a raw UUID.
import type { CostSource } from "./model-prices.ts";
import { costSourceOf, triggerKey, triggerLabel, type UsageRow, type UsageTrigger } from "./usage-ledger.ts";

const clean = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const durationOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
const costOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** One settled turn of a job: time, token counts and cost as the ledger
 * recorded them. No prompt, no message, no secret: the ledger stores none. */
export interface UsageTraceTurn {
  at: string;
  model: string;
  /** The driver kind the turn ran on (the ledger's driverKind). */
  engine: string;
  input: number;
  output: number;
  cachedInput: number;
  /** Null for an unpriced model; no price is ever invented. */
  costUsd: number | null;
  /** Where costUsd came from, or null when the turn has none. */
  costSource: CostSource | null;
  /** How long the turn ran (ms), or null on a row the ledger did not time. */
  durationMs: number | null;
}

/** One job's trace: human labels for display, raw ids for a copy affordance
 * only, and the time and cost rolled up from its turns. */
export interface UsageJobTrace {
  /** Stable key, for React and the detail link; never shown as-is. */
  jobId: string;
  /** Raw ids, for a tooltip or Copy button only, never shown as the label. */
  threadId: string;
  botId: string;
  /** The human label for the bot and for who triggered the job. The app
   * localizes the non-person trigger labels by triggerKind. */
  botName: string;
  triggerKey: string;
  triggerLabel: string;
  triggerKind: UsageTrigger["kind"];
  /** Present when a routine triggered the job. */
  routineId?: string;
  firstAt: string;
  lastAt: string;
  turns: number;
  /** Turns that carried a duration; time is summed from these only. */
  timedTurns: number;
  durationMs: number;
  input: number;
  output: number;
  cachedInput: number;
  /** Sum of priced turns; null when none in the job were priced. */
  costUsd: number | null;
  /** The estimated part of costUsd; null when none of it is an estimate. */
  estimatedUsd: number | null;
  /** Turns with no price at all (an unpriced model). */
  unpriced: number;
  /** Distinct models the job ran on, for display. */
  models: string[];
  /** The per-turn breakdown, oldest first: the trace itself. */
  steps: UsageTraceTurn[];
}

export interface UsageTraceTotal {
  jobs: number;
  turns: number;
  durationMs: number;
  costUsd: number | null;
  estimatedUsd: number | null;
  unpriced: number;
  input: number;
  output: number;
}

export interface UsageTraceList {
  jobs: UsageJobTrace[];
  total: UsageTraceTotal;
  truncated: boolean;
}

/** The most jobs one trace list answers; older jobs are dropped and the
 * list is flagged truncated. */
export const USAGE_TRACE_MAX_JOBS = 500;

const routineIdOf = (trigger: UsageTrigger): string | undefined =>
  trigger.kind === "routine" ? trigger.routineId ?? trigger.label : undefined;

/** Group settled ledger rows into per-job traces, newest job first, capped
 * at `max`. A job is one thread under one trigger; its turns are the trace.
 * Pure and offline: it reads what the ledger settled and invents nothing. */
export function buildUsageTraces(
  rows: readonly UsageRow[],
  opts: { max?: number } = {},
): UsageTraceList {
  const max = opts.max ?? USAGE_TRACE_MAX_JOBS;
  const byJob = new Map<string, UsageJobTrace>();
  for (const row of rows) {
    const key = `${row.threadId}|${triggerKey(row.trigger)}`;
    let job = byJob.get(key);
    if (!job) {
      job = {
        jobId: key,
        threadId: row.threadId,
        botId: row.botId,
        botName: row.botName || row.botId,
        triggerKey: triggerKey(row.trigger),
        triggerLabel: triggerLabel(row.trigger),
        triggerKind: row.trigger.kind,
        ...(routineIdOf(row.trigger) ? { routineId: routineIdOf(row.trigger) } : {}),
        firstAt: row.at,
        lastAt: row.at,
        turns: 0,
        timedTurns: 0,
        durationMs: 0,
        input: 0,
        output: 0,
        cachedInput: 0,
        costUsd: null,
        estimatedUsd: null,
        unpriced: 0,
        models: [],
        steps: [],
      };
      byJob.set(key, job);
    }
    // The newest row wins the display name (a bot can be renamed).
    if (row.botName) job.botName = row.botName;
    if (row.at < job.firstAt) job.firstAt = row.at;
    if (row.at > job.lastAt) job.lastAt = row.at;
    job.turns += 1;
    const duration = durationOf(row.durationMs);
    if (duration !== null) {
      job.timedTurns += 1;
      job.durationMs += duration;
    }
    const input = clean(row.input);
    const output = clean(row.output);
    const cachedInput = Math.min(clean(row.cachedInput), input);
    job.input += input;
    job.output += output;
    job.cachedInput += cachedInput;
    const cost = costOf(row.costUsd);
    const source = costSourceOf(row);
    if (cost === null) job.unpriced += 1;
    else {
      job.costUsd = (job.costUsd ?? 0) + cost;
      if (source === "estimated") job.estimatedUsd = (job.estimatedUsd ?? 0) + cost;
    }
    if (row.model && !job.models.includes(row.model)) job.models.push(row.model);
    job.steps.push({
      at: row.at,
      model: row.model,
      engine: row.driverKind,
      input,
      output,
      cachedInput,
      costUsd: cost,
      costSource: source,
      durationMs: duration,
    });
  }

  for (const job of byJob.values()) {
    job.steps.sort((a, b) => a.at.localeCompare(b.at));
  }
  const ordered = [...byJob.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.firstAt.localeCompare(a.firstAt));
  const truncated = ordered.length > max;
  const jobs = truncated ? ordered.slice(0, max) : ordered;

  const total: UsageTraceTotal = {
    jobs: jobs.length,
    turns: 0,
    durationMs: 0,
    costUsd: null,
    estimatedUsd: null,
    unpriced: 0,
    input: 0,
    output: 0,
  };
  for (const job of jobs) {
    total.turns += job.turns;
    total.durationMs += job.durationMs;
    total.input += job.input;
    total.output += job.output;
    total.unpriced += job.unpriced;
    if (job.costUsd !== null) total.costUsd = (total.costUsd ?? 0) + job.costUsd;
    if (job.estimatedUsd !== null) total.estimatedUsd = (total.estimatedUsd ?? 0) + job.estimatedUsd;
  }
  return { jobs, total, truncated };
}
