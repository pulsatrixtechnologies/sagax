// #5014: what Sagax knows of each account's 5-hour and weekly windows, per
// payer, for the account strategy (server/usage/account-strategy.ts) and the
// planner (server/usage/account-planner.ts). Never a second source of quota:
// it keeps only what Sagax already reads,
//   - the plan usage report (GET /api/plan-usage, notePlanLimits): each
//     window's used percent and its reset;
//   - the provider's limit headers, as Claude Code reports them on every
//     response (`rate_limit_event`: the window, its utilization, its reset);
//   - a turn that worked after a report said the plan was spent (planWorked).
// It never sends anything to an account: a window opens only when a real
// turn uses it. In memory: the next report fills it again after a restart.
//
// It also learns, per payer and account, how many percent points of the
// 5-hour window one unit of demand costs (the ledger's cost of the turns run
// on it between two readings of the same window): the planner's scale.

import type { PlanWindow } from "./plan-usage.ts";

export interface WindowReading {
  /** 0-100, or null when the reading named none. */
  usedPercent: number | null;
  /** Epoch ms of the window's reset, or null when no window is open. */
  resetsAt: number | null;
  /** When Sagax read it. */
  at: number;
}

export interface AccountWindows {
  fiveHour: { usedPercent: number | null; resetsAt: number | null };
  weekly: { usedPercent: number | null; resetsAt: number | null };
}

interface Entry {
  fiveHour?: WindowReading;
  weekly?: WindowReading;
  /** Demand units booked on this account since the last 5-hour reading. */
  spent: number;
  /** The same, since the last weekly reading. */
  weekSpent: number;
}

export interface AccountMeter {
  /** One plan usage report row, for every instance folded on its login. */
  notePlan(payer: string, instanceIds: readonly string[], row: { fiveHour?: PlanWindow; weekly?: PlanWindow }): void;
  /** One limit header reading (Claude's rate_limit_info). */
  noteHeader(payer: string, instanceId: string, info: unknown): void;
  /** A turn worked: a reading at 100 % was wrong (extra usage, an early reset). */
  worked(payer: string, instanceIds: readonly string[]): void;
  /** Demand units a turn on this account cost (the ledger's equivalent cost). */
  noteSpend(payer: string, instanceId: string, units: number): void;
  /** The windows as of now: a window whose reset passed reads empty. */
  windows(payer: string, instanceId: string): AccountWindows;
  /** The fullest window's used percent, or null (the failover's hint, #2192). */
  fullest(payer: string, instanceId: string): number | null;
  /** Percent points of the 5-hour window per demand unit, when learned. */
  scale(payer: string, instanceId: string): number | null;
  /** Percent points of the week per demand unit, when learned. */
  weekScale(payer: string, instanceId: string): number | null;
}

const SCALE_ALPHA = 0.3;
const MAX_ENTRIES = 2_000;
/** A reading older than this says nothing of now (a week and a day). */
const STALE_MS = 8 * 24 * 3_600_000;

const key = (payer: string, instanceId: string) => `${payer.trim().toLowerCase()}\u0000${instanceId}`;
const percent = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
const epoch = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
};

export function createAccountMeter(options: { now?: () => number; scales?: Map<string, number> } = {}): AccountMeter {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const scales = options.scales ?? new Map<string, number>();
  const entry = (payer: string, instanceId: string): Entry => {
    const id = key(payer, instanceId);
    let found = entries.get(id);
    if (!found) {
      found = { spent: 0, weekSpent: 0 };
      entries.set(id, found);
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
    }
    return found;
  };
  /** Learns the scale from two readings of the same window and the demand
   * booked between them; a new window starts counting again. */
  const learn = (id: string, last: WindowReading | undefined, next: WindowReading, spent: number): boolean => {
    if (!last || last.usedPercent === null || next.usedPercent === null || last.resetsAt === null || last.resetsAt !== next.resetsAt) return true;
    const points = next.usedPercent - last.usedPercent;
    if (!(points > 0) || !(spent > 0)) return false;
    const observed = points / spent;
    const known = scales.get(id);
    scales.set(id, known === undefined ? observed : SCALE_ALPHA * observed + (1 - SCALE_ALPHA) * known);
    return true;
  };
  const setFiveHour = (payer: string, instanceId: string, held: Entry, next: WindowReading) => {
    if (learn(key(payer, instanceId), held.fiveHour, next, held.spent)) held.spent = 0;
    held.fiveHour = next;
  };
  const setWeekly = (payer: string, instanceId: string, held: Entry, next: WindowReading) => {
    if (learn(`${key(payer, instanceId)}\u0000week`, held.weekly, next, held.weekSpent)) held.weekSpent = 0;
    held.weekly = next;
  };
  const fromPlan = (window: PlanWindow | undefined, at: number): WindowReading | undefined => {
    if (!window || !window.available) return undefined;
    return { usedPercent: percent(window.usedPercent), resetsAt: epoch(window.resetsAt), at };
  };
  /** As of now: a reading past its reset is an empty window not yet opened. */
  const current = (reading: WindowReading | undefined): { usedPercent: number | null; resetsAt: number | null } => {
    const at = now();
    if (!reading || at - reading.at > STALE_MS) return { usedPercent: null, resetsAt: null };
    if (reading.resetsAt !== null && reading.resetsAt <= at) return { usedPercent: 0, resetsAt: null };
    return { usedPercent: reading.usedPercent, resetsAt: reading.resetsAt };
  };

  const windows = (payer: string, instanceId: string): AccountWindows => {
    const held = entries.get(key(payer, instanceId));
    return { fiveHour: current(held?.fiveHour), weekly: current(held?.weekly) };
  };

  return {
    notePlan(payer, instanceIds, row) {
      const at = now();
      for (const instanceId of new Set(instanceIds)) {
        const held = entry(payer, instanceId);
        const five = fromPlan(row.fiveHour, at);
        const week = fromPlan(row.weekly, at);
        if (five) setFiveHour(payer, instanceId, held, five);
        if (week) setWeekly(payer, instanceId, held, week);
      }
    },
    noteHeader(payer, instanceId, info) {
      if (!info || typeof info !== "object") return;
      const { status, rateLimitType, resetsAt, utilization } = info as Record<string, unknown>;
      const at = now();
      const reset = typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt * 1_000 : null;
      // utilization is a share (0-1) in the headers; a rejected window is full
      const used = status === "rejected" ? 100
        : typeof utilization === "number" && Number.isFinite(utilization) ? percent(utilization <= 1 ? utilization * 100 : utilization) : null;
      const held = entry(payer, instanceId);
      if (rateLimitType === "five_hour") {
        // a reading without a figure keeps the last figure of the same window
        const same = held.fiveHour && held.fiveHour.resetsAt === reset ? held.fiveHour.usedPercent : null;
        setFiveHour(payer, instanceId, held, { usedPercent: used ?? same, resetsAt: reset, at });
      } else if (rateLimitType === "seven_day") {
        const same = held.weekly && held.weekly.resetsAt === reset ? held.weekly.usedPercent : null;
        setWeekly(payer, instanceId, held, { usedPercent: used ?? same, resetsAt: reset, at });
      }
      // a model's own weekly window (seven_day_opus...) or overage binds one
      // model, never the account: the refusal path holds that model.
    },
    worked(payer, instanceIds) {
      for (const instanceId of new Set(instanceIds)) {
        const held = entries.get(key(payer, instanceId));
        if (!held) continue;
        if ((held.fiveHour?.usedPercent ?? 0) >= 100) held.fiveHour = undefined;
        if ((held.weekly?.usedPercent ?? 0) >= 100) held.weekly = undefined;
      }
    },
    noteSpend(payer, instanceId, units) {
      if (!(units > 0) || !Number.isFinite(units)) return;
      const held = entry(payer, instanceId);
      held.spent += units;
      held.weekSpent += units;
    },
    windows,
    fullest(payer, instanceId) {
      const { fiveHour, weekly } = windows(payer, instanceId);
      const known = [fiveHour.usedPercent, weekly.usedPercent].filter((value): value is number => value !== null);
      return known.length ? Math.max(...known) : null;
    },
    scale(payer, instanceId) {
      const value = scales.get(key(payer, instanceId));
      return value !== undefined && value > 0 && Number.isFinite(value) ? value : null;
    },
    weekScale(payer, instanceId) {
      const value = scales.get(`${key(payer, instanceId)}\u0000week`);
      return value !== undefined && value > 0 && Number.isFinite(value) ? value : null;
    },
  };
}
