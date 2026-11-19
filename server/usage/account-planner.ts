// #5014 (M-20261119-016): the rolling horizon planner over a person's
// accounts of one provider, for High-water. At a new conversation and every
// few minutes (the host's cache, server/usage/account-switch-host.ts), a small
// linear program spreads the demand the forecast expects over the next hours
// (server/usage/usage-forecast.ts) among the accounts:
//
//   maximize  sum over accounts a and hours t of  value(a, t) * x[a][t]
//   where     x[a][t] = demand served by account a in hour t
//   subject to
//     sum_a x[a][t]                         <= demand[t]       (each hour)
//     sum_{t in window k} scale_a x[a][t]   <= room in window k (each 5-hour window)
//     sum_{t before the week's reset} weekScale_a x[a][t] <= room in the week
//
// value(a, t) is mostly the worth of serving demand (each unit unserved is
// time blocked), plus the quota a window would lose at its reset when it
// resets within the horizon (used now or lost), minus a penalty for an
// account using its week faster than time passes (the weekly guard), plus
// the conversation's own account in the first hour (its prompt cache), with
// the order of Providers as the last tie-break. Only the first decision is
// applied; the next pass plans again from what is known then.
//
// It falls back on the simple rule (server/usage/account-strategy.ts) with
// under about 7 days of history, when an account's scale is unknown, when
// the forecast expects nothing, or when the solve fails or takes over 50 ms.
import type { AccountPickWhy } from "../../shared/account-switch.ts";
import {
  EXPIRING_UNUSED_PERCENT,
  HOUR_MS,
  expiringUnused,
  hasRoom,
  underThreshold,
  weeklyAhead,
  type StrategyAccount,
  type StrategyPick,
} from "./account-strategy.ts";
import { solveLinearProgram } from "./lp-simplex.ts";

/** The hours the planner looks ahead. */
export const PLAN_HORIZON_HOURS = 8;
/** The longest a solve may take before the simple rule answers instead. */
export const PLAN_BUDGET_MS = 50;
/** History the forecast needs before the planner plans. */
export const PLAN_HISTORY_MS = 7 * 24 * HOUR_MS;
/** A share of the hour's demand below this means the plan moves it elsewhere. */
export const PLAN_KEEP_SHARE = 0.25;

const SERVE_VALUE = 1_000;
const WASTE_VALUE = 10;
const WEEKLY_PENALTY = 50;
const ORDER_PENALTY = 0.01;
/** The conversation's own account in the first hour, for its prompt cache:
 * half the worth of quota a near reset would lose. */
const CACHE_SHARE = 0.5;
const WINDOW_HOURS = 5;

export interface PlannerAccount extends StrategyAccount {
  /** Percent points of the 5-hour window per demand unit (account meter). */
  scale: number | null;
  /** Percent points of the week per demand unit, when learned. */
  weekScale?: number | null;
}

export interface PlannerInput {
  now: number;
  threshold: number;
  /** In the order of the Providers list. */
  accounts: readonly PlannerAccount[];
  /** The forecast demand per hour from now. */
  demand: readonly number[];
  /** How long the payer's forecast has been learning, in ms. */
  history: number;
  current?: string;
  fresh: boolean;
}

export type PlannerResult =
  | { status: "planned"; pick: StrategyPick; shares: Record<string, number>; ms: number }
  | { status: "fallback"; reason: "history" | "accounts" | "scale" | "demand" | "solver" | "time"; ms: number };

/** The program for these accounts and this demand, and where each x sits. */
export function buildAccountProgram(input: PlannerInput, accounts: readonly PlannerAccount[], scales: readonly number[]) {
  const hours = input.demand.length;
  const index = (account: number, hour: number) => account * hours + hour;
  const size = accounts.length * hours;
  const objective = Array.from({ length: size }, () => 0);
  const constraints: Array<{ coefficients: number[]; bound: number }> = [];
  for (let hour = 0; hour < hours; hour++) {
    const coefficients = Array.from({ length: size }, () => 0);
    for (let account = 0; account < accounts.length; account++) coefficients[index(account, hour)] = 1;
    constraints.push({ coefficients, bound: Math.max(0, input.demand[hour] ?? 0) });
  }
  accounts.forEach((account, a) => {
    const scale = scales[a]!;
    const used = account.fiveHour.usedPercent ?? 0;
    // hours until this window resets; an unopened window opens with the next turn
    const reset = account.fiveHour.resetsAt !== null ? Math.max(0, (account.fiveHour.resetsAt - input.now) / HOUR_MS) : 0;
    const open = account.fiveHour.resetsAt !== null;
    const windowOf = (hour: number) => {
      const middle = hour + 0.5;
      if (open && middle < reset) return 0;
      return 1 + Math.floor((middle - reset) / WINDOW_HOURS);
    };
    const windows = new Map<number, number[]>();
    for (let hour = 0; hour < hours; hour++) {
      const k = windowOf(hour);
      windows.set(k, [...(windows.get(k) ?? []), hour]);
    }
    for (const [k, list] of windows) {
      const coefficients = Array.from({ length: size }, () => 0);
      for (const hour of list) coefficients[index(a, hour)] = scale;
      // the open window has what is left; an unopened one starts from what it had
      const room = k === 0 ? 100 - used : k === 1 && !open ? 100 - used : 100;
      constraints.push({ coefficients, bound: Math.max(0, room) });
    }
    const weekScale = account.weekScale ?? null;
    if (weekScale !== null && weekScale > 0 && account.weekly.usedPercent !== null) {
      const weekReset = account.weekly.resetsAt !== null ? (account.weekly.resetsAt - input.now) / HOUR_MS : Infinity;
      const coefficients = Array.from({ length: size }, () => 0);
      for (let hour = 0; hour < hours; hour++) if (hour + 0.5 < weekReset) coefficients[index(a, hour)] = weekScale;
      constraints.push({ coefficients, bound: Math.max(0, 100 - account.weekly.usedPercent) });
    }
    const ahead = weeklyAhead(account, input.now);
    // the open window resets within the horizon: what it does not use is lost
    const losesAtReset = open && reset <= hours;
    for (let hour = 0; hour < hours; hour++) {
      let value = SERVE_VALUE - ORDER_PENALTY * a;
      if (losesAtReset && windowOf(hour) === 0) value += WASTE_VALUE * scale;
      if (ahead) value -= WEEKLY_PENALTY;
      if (hour === 0 && !input.fresh && account.instanceId === input.current) value += CACHE_SHARE * WASTE_VALUE * scale;
      objective[index(a, hour)] = value;
    }
  });
  return { objective, constraints, index };
}

export function planAccounts(input: PlannerInput, options: { budgetMs?: number; clock?: () => number } = {}): PlannerResult {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const elapsed = () => clock() - started;
  if (input.history < PLAN_HISTORY_MS) return { status: "fallback", reason: "history", ms: elapsed() };
  const accounts = input.accounts.filter(hasRoom);
  if (accounts.length < 2) return { status: "fallback", reason: "accounts", ms: elapsed() };
  const known = accounts.map((account) => account.scale).filter((scale): scale is number => scale !== null && scale > 0);
  if (!known.length) return { status: "fallback", reason: "scale", ms: elapsed() };
  const mean = known.reduce((sum, scale) => sum + scale, 0) / known.length;
  const scales = accounts.map((account) => account.scale !== null && account.scale > 0 ? account.scale : mean);
  if (!input.demand.some((value) => value > 0)) return { status: "fallback", reason: "demand", ms: elapsed() };
  try {
    const { objective, constraints, index } = buildAccountProgram(input, accounts, scales);
    const solution = solveLinearProgram({ objective, constraints });
    if (elapsed() > (options.budgetMs ?? PLAN_BUDGET_MS)) return { status: "fallback", reason: "time", ms: elapsed() };
    if (solution.status !== "optimal") return { status: "fallback", reason: "solver", ms: elapsed() };
    // the first hour the plan serves anything: its decision is the one applied
    const hours = input.demand.length;
    let first = -1;
    for (let hour = 0; hour < hours && first < 0; hour++) {
      const served = accounts.reduce((sum, _, a) => sum + solution.values[index(a, hour)]!, 0);
      if (served > 1e-9) first = hour;
    }
    if (first < 0) return { status: "fallback", reason: "demand", ms: elapsed() };
    const shares: Record<string, number> = {};
    accounts.forEach((account, a) => { shares[account.instanceId] = solution.values[index(a, first)]!; });
    const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
    const best = accounts.reduce((top, account) => shares[account.instanceId]! > shares[top.instanceId]! + 1e-9 ? account : top, accounts[0]!);
    const current = input.current ? accounts.find((account) => account.instanceId === input.current) : undefined;
    const pick = decide(input, best, current, shares, total);
    return { status: "planned", pick, shares, ms: elapsed() };
  } catch {
    return { status: "fallback", reason: "solver", ms: elapsed() };
  }
}

/** High-water over the plan: a conversation keeps its account while it is
 * under the threshold and the plan still serves this hour there. */
function decide(input: PlannerInput, best: PlannerAccount, current: PlannerAccount | undefined,
  shares: Record<string, number>, total: number): StrategyPick {
  const planned = (account: PlannerAccount): AccountPickWhy => {
    const unused = expiringUnused(account, input.now);
    return unused !== null && unused >= EXPIRING_UNUSED_PERCENT && account.fiveHour.resetsAt !== null
      ? { kind: "planned", resetsAt: account.fiveHour.resetsAt, unused }
      : { kind: "planned" };
  };
  if (current && !input.fresh) {
    const under = underThreshold(current, input.threshold);
    if (under && (shares[current.instanceId] ?? 0) >= PLAN_KEEP_SHARE * total) {
      const used = current.fiveHour.usedPercent;
      return { instanceId: current.instanceId, why: { kind: "keeps", ...(used !== null ? { used: Math.round(used) } : {}), threshold: input.threshold } };
    }
    if (!under && best.instanceId !== current.instanceId) {
      return { instanceId: best.instanceId, why: { kind: "threshold", from: current.label, used: Math.round(current.fiveHour.usedPercent ?? 0), threshold: input.threshold } };
    }
  }
  return { instanceId: best.instanceId, why: planned(best) };
}
