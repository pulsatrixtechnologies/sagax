/** Claude running-cost booking and resume cost history (#1383). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../config.ts";
import { writeFileAtomic } from "../../atomic.ts";

export function turnCostFromRunningTotal(total: number | null, previous: number | null): number | null {
  if (total === null) return null;
  if (previous === null || total < previous) return total;
  return Number((total - previous).toFixed(10));
}

/** One running cost state, read from a `result`: total_cost_usd and, per
 * model, the [input, cache read, cache write, output] tokens of modelUsage.
 * Both count the whole session so far, including anything --resume restored. */
export interface ClaudeCostSnapshot {
  total: number;
  models: Record<string, [number, number, number, number]>;
}

export function claudeCostSnapshot(total: unknown, modelUsage: unknown): ClaudeCostSnapshot | null {
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const models: ClaudeCostSnapshot["models"] = {};
  if (modelUsage && typeof modelUsage === "object" && !Array.isArray(modelUsage)) {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const u = raw as Record<string, unknown>;
      models[model] = [count(u.inputTokens), count(u.cacheReadInputTokens), count(u.cacheCreationInputTokens), count(u.outputTokens)];
    }
  }
  return { total, models };
}

/** The running total a resumed session already carried before this
 * process's first turn. On --resume the CLI (2.1.282) restores the session's
 * cost from an earlier state — not always the latest one this driver saw —
 * so that turn's total_cost_usd and modelUsage include the earlier turns.
 * The restored state is the earlier state that sits inside the new counts
 * and leaves exactly this turn's own usage: in one model (usage leaves out
 * side calls such as a Haiku title) or summed over all models (a turn split
 * between two); nothing restored is 0. When no state fits exactly — the CLI
 * saved work that never reported a result, like an interrupted turn — the
 * latest state inside the new counts stands, so that work is booked once,
 * with this turn. Either way the latest state wins, not the highest total:
 * a resume that went back to an older state leaves later, lower totals. */
export function restoredCostBase(
  earlier: readonly ClaudeCostSnapshot[],
  current: ClaudeCostSnapshot,
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number },
): number {
  const turn = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output];
  const nothing: ClaudeCostSnapshot = { total: 0, models: {} };
  let exact: number | null = null;
  let inside = 0;
  // oldest first: the session's states in the order they were recorded
  for (const state of [nothing, ...earlier]) {
    const within = Object.entries(state.models).every(([model, counts]) =>
      counts.every((n, i) => n <= (current.models[model]?.[i] ?? 0)));
    if (!within) continue;
    inside = state.total;
    const growth = Object.entries(current.models).map(([model, counts]) =>
      counts.map((n, i) => n - (state.models[model]?.[i] ?? 0)));
    const isTurn = (counts: number[]) => counts.every((n, i) => n === turn[i]);
    const summed = turn.map((_, i) => growth.reduce((sum, counts) => sum + counts[i]!, 0));
    if (growth.some(isTurn) || isTurn(summed)) exact = state.total;
  }
  return exact ?? inside;
}

/** Each Claude session's latest cost states, so the first turn after a
 * --resume can tell what the CLI restored — after an app restart too. Small
 * by design: a few states for the most recent sessions. */
const COST_HISTORY_FILE = join(DATA_DIR, "claude-cost-history.json");
const COST_HISTORY_SESSIONS = 100;
const COST_HISTORY_STATES = 8;

function isCostSnapshot(value: unknown): value is ClaudeCostSnapshot {
  if (!value || typeof value !== "object") return false;
  const { total, models } = value as { total?: unknown; models?: unknown };
  return typeof total === "number" && !!models && typeof models === "object" &&
    Object.values(models).every((counts) => Array.isArray(counts) && counts.length === 4 && counts.every((n) => typeof n === "number"));
}

export function readCostHistory(): Record<string, ClaudeCostSnapshot[]> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(COST_HISTORY_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, states]) => [id, Array.isArray(states) ? states.filter(isCostSnapshot) : []]));
  } catch {
    return {};
  }
}

export function recordCostState(sessionId: string, state: ClaudeCostSnapshot): void {
  const history = readCostHistory();
  const states = [...(history[sessionId] ?? []), state].slice(-COST_HISTORY_STATES);
  // most recent session last, so the oldest ones are dropped first
  delete history[sessionId];
  history[sessionId] = states;
  const ids = Object.keys(history);
  for (const id of ids.slice(0, Math.max(0, ids.length - COST_HISTORY_SESSIONS))) delete history[id];
  // Written after every turn, so not fsynced: what a power cut could lose is
  // the same thing a failed write already gives up (below).
  try {
    writeFileAtomic(COST_HISTORY_FILE, JSON.stringify(history), { mode: 0o600, durable: false });
  } catch {
    // a lost state only means a later resume keeps its whole figure
  }
}
