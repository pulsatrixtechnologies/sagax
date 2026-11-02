// Spend limits over the usage ledger: what this workspace has spent this
// month against its cap, the refusal a turn gets once the cap is reached,
// and the one-per-month notices when the month crosses the warning
// threshold and the cap. The figure is every cost in the ledger: what
// engines reported (on a workspace of personal subscriptions, their
// equivalents too) plus the estimates booked for engines that report tokens
// but no price (server/model-prices.ts). A turn on an unpriced model counts
// nothing. Enforced whenever the `budgets` feature is on, which it always is
// in the open-source edition (server/enterprise.ts); only an enterprise layer
// that withholds it leaves the setting inert.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import { entitled } from "./enterprise.ts";
import { assertWithinPersonalCap } from "./personal-spend-cap.ts";
import { monthToDateSpend, noteSpend, resetSpendCacheForTests } from "./spend-month.ts";

export { monthToDateSpend, noteSpend, resetSpendCacheForTests };

export interface SpendState {
  month: string;
  monthlyUsd: number;
  spentUsd: number;
  percent: number;
  warnAtPercent: number;
  warn: boolean;
  exceeded: boolean;
}

const DEFAULT_WARN_AT_PERCENT = 80;

function monthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The cap and where the month stands against it; null when there is no
 * enforceable cap (none set, or an enterprise layer withholds `budgets`). */
export function spendState(
  cfg: Pick<AppConfig, "budgets">,
  dataDir: string,
  now = new Date(),
  isEntitled: (feature: string) => boolean = entitled,
): SpendState | null {
  const monthlyUsd = cfg.budgets?.monthlyUsd;
  if (!isEntitled("budgets") || typeof monthlyUsd !== "number" || !Number.isFinite(monthlyUsd) || monthlyUsd <= 0) return null;
  const spentUsd = monthToDateSpend(dataDir, now);
  const warnAtPercent = cfg.budgets?.warnAtPercent ?? DEFAULT_WARN_AT_PERCENT;
  const percent = Math.min(999, Math.round((spentUsd / monthlyUsd) * 100));
  return {
    month: monthOf(now),
    monthlyUsd,
    spentUsd,
    percent,
    warnAtPercent,
    warn: percent >= warnAtPercent,
    exceeded: spentUsd >= monthlyUsd,
  };
}

/** Dollars for a message: cents normally, mills for a cap under a cent. */
function usd(value: number): string {
  return Number.isInteger(Math.round(value * 1000) / 10) ? value.toFixed(2) : value.toFixed(3);
}

/** Throws the HTTP-shaped refusal a turn start gets once the cap is reached. */
export function assertWithinBudget(
  cfg: Pick<AppConfig, "budgets">,
  dataDir: string,
  now = new Date(),
  isEntitled: (feature: string) => boolean = entitled,
): void {
  const state = spendState(cfg, dataDir, now, isEntitled);
  // The person's own limit (server/personal-spend-cap.ts) stops a turn the same way.
  if (!state?.exceeded) return assertWithinPersonalCap(dataDir, now);
  throw Object.assign(
    new Error(`this workspace has reached its monthly spend limit of $${usd(state.monthlyUsd)} — an admin can raise it under Settings → Usage`),
    { status: 409, code: "spend_cap" },
  );
}

export type SpendAlert = "warn" | "cap";

interface AlertMarks {
  month: string;
  monthlyUsd: number;
  warn?: true;
  cap?: true;
}

const ALERTS_FILE = "alerts.json";

function readMarks(dataDir: string): AlertMarks | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dataDir, "usage", ALERTS_FILE), "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const marks = value as AlertMarks;
    return typeof marks.month === "string" && typeof marks.monthlyUsd === "number" ? marks : null;
  } catch {
    return null;
  }
}

/** The notice this booking should raise, if any: the cap the first time the
 * month reaches it, the warning the first time it crosses the threshold, and
 * nothing again for either that month. A new month, or a different cap, is a
 * new budget and starts over. Marks live beside the ledger so a restart does
 * not repeat them; if they cannot be written the notice is still sent once
 * for this run. */
export function takeSpendAlert(dataDir: string, state: SpendState | null): SpendAlert | null {
  if (!state || (!state.warn && !state.exceeded)) return null;
  const saved = readMarks(dataDir) ?? memoryMarks.get(dataDir) ?? null;
  const marks: AlertMarks = saved && saved.month === state.month && saved.monthlyUsd === state.monthlyUsd
    ? saved
    : { month: state.month, monthlyUsd: state.monthlyUsd };
  const alert: SpendAlert | null = state.exceeded && !marks.cap ? "cap" : state.warn && !marks.warn && !marks.cap ? "warn" : null;
  if (!alert) return null;
  // Reaching the cap also answers the warning: one notice, the stronger one.
  const next: AlertMarks = { ...marks, warn: true, ...(alert === "cap" ? { cap: true as const } : {}) };
  memoryMarks.set(dataDir, next);
  try {
    mkdirSync(join(dataDir, "usage"), { recursive: true, mode: 0o700 });
    writeFileSync(join(dataDir, "usage", ALERTS_FILE), JSON.stringify(next), { mode: 0o600 });
  } catch {
    /* bookkeeping must never take down the turn */
  }
  return alert;
}
const memoryMarks = new Map<string, AlertMarks>();

export function resetSpendAlertsForTests(): void {
  memoryMarks.clear();
}

/** The notice's words. English like the server's other notification titles. */
export function spendAlertText(alert: SpendAlert, state: SpendState): { title: string; body: string } {
  const spent = `$${state.spentUsd.toFixed(2)} of $${usd(state.monthlyUsd)} spent this month (${state.month})`;
  return alert === "cap"
    ? { title: "Monthly spend limit reached", body: `${spent}. New turns are refused until an admin raises the limit under Settings → Usage.` }
    : { title: `Spend is at ${state.percent}% of the monthly limit`, body: `${spent}. New turns stop when the limit is reached.` };
}
