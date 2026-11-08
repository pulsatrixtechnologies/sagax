// Plan usage history (#2757): what share of each subscription window was
// used, period by period, so the Usage page can show past weeks and 5-hour
// sessions and not only the windows open now.
//
// Every plan-usage report the server reads (server/routes/plan-usage.ts) is
// a snapshot. A period is one window of one account, named by the time it
// resets; its row keeps the highest share seen (the period's "% of limit
// used") and the last one. One file per scope (the server, or one person
// on an organization server) under <data>/usage/plan-history/, 0600,
// written whole through a temporary file. Bookkeeping never fails the
// request that carried the report.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanProviderRow, PlanUsageReport, PlanWindow } from "./plan-usage.ts";

export type PlanPeriodWindow = "5-hour" | "weekly";

export interface PlanPeriod {
  /** The plan-usage row (engine instance or account). */
  account: string;
  name: string;
  driver: string;
  window: PlanPeriodWindow;
  /** When the window opened: its reset minus its length. */
  startsAt: string;
  /** When the window resets: the period's name. */
  resetsAt: string;
  /** Highest share of the limit seen in this period, 0 to 100. */
  peakPercent: number;
  /** Share seen by the last snapshot. */
  lastPercent: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Snapshots that saw this period. */
  samples: number;
}

export interface PlanHistoryAccount {
  id: string;
  name: string;
  driver: string;
  plan: string | null;
}

export interface PlanHistory {
  /** Last snapshot taken, ISO; null before the first. */
  updatedAt: string | null;
  accounts: PlanHistoryAccount[];
  /** Newest first. */
  periods: PlanPeriod[];
}

const WINDOW_MS: Record<PlanPeriodWindow, number> = { "5-hour": 5 * 3_600_000, weekly: 7 * 86_400_000 };
/** Providers compute a reset from "seconds left", so one window's reset moves by a few seconds between reads. */
const SAME_PERIOD_MS = 15 * 60_000;
/** Kept this long after the period ended. */
export const PLAN_HISTORY_KEEP_DAYS = 400;
const MAX_PERIODS = 4_000;

interface StoredHistory {
  version: 1;
  updatedAt: string | null;
  accounts: PlanHistoryAccount[];
  periods: PlanPeriod[];
}

function empty(): StoredHistory {
  return { version: 1, updatedAt: null, accounts: [], periods: [] };
}

function clamp(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** The file of one scope; a person's id never becomes a path as is. */
export function planHistoryFile(dataDir: string, scope: string): string {
  const name = scope === "server" ? "server" : createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return join(dataDir, "usage", "plan-history", `${name}.json`);
}

function isPeriod(value: unknown): value is PlanPeriod {
  const row = value as Partial<PlanPeriod> | null;
  return Boolean(row) && typeof row?.account === "string" && (row?.window === "5-hour" || row?.window === "weekly")
    && typeof row?.resetsAt === "string" && typeof row?.peakPercent === "number";
}

function readStored(file: string): StoredHistory {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredHistory>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts.filter((row) => typeof row?.id === "string") : [],
      periods: Array.isArray(parsed.periods) ? parsed.periods.filter(isPeriod) : [],
    };
  } catch {
    return empty();
  }
}

function windowPercent(window: PlanWindow): number | null {
  if (!window.available || window.usedPercent === null || !Number.isFinite(window.usedPercent)) return null;
  return window.usedPercent;
}

/** Merge one report into a history. Pure: the caller stores the result. */
export function mergePlanSnapshot(history: StoredHistory, report: PlanUsageReport, now = Date.parse(report.fetchedAt) || Date.now()): StoredHistory {
  const at = new Date(now).toISOString();
  const periods = [...history.periods];
  const accounts = new Map(history.accounts.map((row) => [row.id, row]));
  let changed = false;
  for (const row of report.providers as PlanProviderRow[]) {
    if (row.state !== "windows") continue;
    for (const [window, data] of [["5-hour", row.fiveHour], ["weekly", row.weekly]] as const) {
      const percent = data ? windowPercent(data) : null;
      const resets = data?.resetsAt ? Date.parse(data.resetsAt) : NaN;
      if (percent === null || !Number.isFinite(resets)) continue;
      const used = clamp(percent);
      const index = periods.findIndex((period) => period.account === row.id && period.window === window && Math.abs(Date.parse(period.resetsAt) - resets) <= SAME_PERIOD_MS);
      if (index >= 0) {
        const period = periods[index]!;
        periods[index] = { ...period, name: row.name, peakPercent: Math.max(period.peakPercent, used), lastPercent: used, lastSeenAt: at, samples: period.samples + 1 };
      } else {
        periods.push({
          account: row.id, name: row.name, driver: row.driver, window,
          startsAt: new Date(resets - WINDOW_MS[window]).toISOString(),
          resetsAt: new Date(resets).toISOString(),
          peakPercent: used, lastPercent: used, firstSeenAt: at, lastSeenAt: at, samples: 1,
        });
      }
      accounts.set(row.id, { id: row.id, name: row.name, driver: row.driver, plan: row.plan ?? null });
      changed = true;
    }
  }
  if (!changed) return history;
  const oldest = now - PLAN_HISTORY_KEEP_DAYS * 86_400_000;
  const kept = periods
    .filter((period) => Date.parse(period.resetsAt) >= oldest)
    .sort((left, right) => Date.parse(right.resetsAt) - Date.parse(left.resetsAt))
    .slice(0, MAX_PERIODS);
  return { version: 1, updatedAt: at, accounts: [...accounts.values()], periods: kept };
}

export interface PlanHistoryStore {
  /** Record a report for a scope ("server" or a person's id). Never throws. */
  record(report: PlanUsageReport, scope: string): void;
  /** Periods that reset within the last `days` days (and the open ones). */
  read(scope: string, days?: number, now?: number): PlanHistory;
}

export const PLAN_HISTORY_DEFAULT_DAYS = 90;

export function createPlanHistoryStore(dataDir: string, onError: (failure: unknown) => void = () => {}): PlanHistoryStore {
  const cache = new Map<string, StoredHistory>();
  const lastReport = new Map<string, string>();
  const load = (scope: string): StoredHistory => {
    let held = cache.get(scope);
    if (!held) {
      held = readStored(planHistoryFile(dataDir, scope));
      cache.set(scope, held);
      while (cache.size > 256) cache.delete(cache.keys().next().value as string);
    }
    return held;
  };
  return {
    record(report, scope) {
      try {
        // A cached report is announced again on each read: one snapshot only.
        if (lastReport.get(scope) === report.fetchedAt) return;
        lastReport.set(scope, report.fetchedAt);
        while (lastReport.size > 256) lastReport.delete(lastReport.keys().next().value as string);
        const before = load(scope);
        const after = mergePlanSnapshot(before, report);
        if (after === before) return;
        cache.set(scope, after);
        const file = planHistoryFile(dataDir, scope);
        mkdirSync(join(dataDir, "usage", "plan-history"), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(after), { mode: 0o600 });
        renameSync(temporary, file);
      } catch (failure) {
        onError(failure);
      }
    },
    read(scope, days = PLAN_HISTORY_DEFAULT_DAYS, now = Date.now()) {
      const held = load(scope);
      const since = now - Math.max(1, Math.min(PLAN_HISTORY_KEEP_DAYS, days)) * 86_400_000;
      return {
        updatedAt: held.updatedAt,
        accounts: held.accounts,
        periods: held.periods.filter((period) => Date.parse(period.resetsAt) >= since),
      };
    },
  };
}
