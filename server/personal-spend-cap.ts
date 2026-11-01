// A person's own monthly spend limit (Settings > Usage > "Limite de
// dépenses"). Stored beside the ledger, not in config, so it needs no
// entitlement and an admin-only config write is not in its way. It counts
// the same month-to-date figure as the workspace cap (server/spend.ts) and
// stops a new turn the same way (409 `spend_cap`) once reached; the owner
// raises or removes it from the same page. Solo servers only: on an
// organization server the person has no cap of their own here (the route
// refuses), the organization's limit governs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monthToDateSpend } from "./spend-month.ts";

export const MIN_PERSONAL_CAP_USD = 1;
const WARN_AT_PERCENT = 80;
const FILE = "personal-cap.json";
const MARKS_FILE = "personal-cap-alerts.json";

export interface PersonalCapState {
  month: string;
  monthlyUsd: number;
  spentUsd: number;
  percent: number;
  warn: boolean;
  exceeded: boolean;
}

const path = (dataDir: string, file = FILE) => join(dataDir, "usage", file);

let organizationServer = false;
/** An organization server has no personal limit yet: a leftover file (the
 * server was solo once) is ignored there. Set once at boot. */
export function setPersonalCapOrganization(organization: boolean): void {
  organizationServer = organization;
}

export function readPersonalCap(dataDir: string): number | null {
  if (organizationServer) return null;
  try {
    const value = (JSON.parse(readFileSync(path(dataDir), "utf8")) as { monthlyUsd?: unknown }).monthlyUsd;
    return typeof value === "number" && Number.isFinite(value) && value >= MIN_PERSONAL_CAP_USD ? value : null;
  } catch {
    return null;
  }
}

export function writePersonalCap(dataDir: string, monthlyUsd: number): void {
  if (typeof monthlyUsd !== "number" || !Number.isFinite(monthlyUsd)) throw new Error("the limit must be a number of dollars");
  if (monthlyUsd < MIN_PERSONAL_CAP_USD) throw new Error(`the limit must be at least $${MIN_PERSONAL_CAP_USD}`);
  mkdirSync(join(dataDir, "usage"), { recursive: true, mode: 0o700 });
  writeFileSync(path(dataDir), JSON.stringify({ monthlyUsd: Math.round(monthlyUsd * 100) / 100 }), { mode: 0o600 });
}

export function clearPersonalCap(dataDir: string): void {
  rmSync(path(dataDir), { force: true });
}

export function personalCapState(dataDir: string, now = new Date()): PersonalCapState | null {
  const monthlyUsd = readPersonalCap(dataDir);
  if (monthlyUsd === null) return null;
  const spentUsd = monthToDateSpend(dataDir, now);
  const percent = Math.min(999, Math.round((spentUsd / monthlyUsd) * 100));
  return { month: now.toISOString().slice(0, 7), monthlyUsd, spentUsd, percent, warn: percent >= WARN_AT_PERCENT, exceeded: spentUsd >= monthlyUsd };
}

/** Throws the HTTP-shaped refusal a turn start gets once the personal cap is reached. */
export function assertWithinPersonalCap(dataDir: string, now = new Date()): void {
  const state = personalCapState(dataDir, now);
  if (!state?.exceeded) return;
  throw Object.assign(
    new Error(`you reached your personal monthly spend limit of $${state.monthlyUsd.toFixed(2)} — raise it under Settings → Usage to keep going`),
    { status: 409, code: "spend_cap" },
  );
}

interface Marks { month: string; monthlyUsd: number; warn?: true; cap?: true }
const memoryMarks = new Map<string, Marks>();

function readMarks(dataDir: string): Marks | null {
  try {
    const value = JSON.parse(readFileSync(path(dataDir, MARKS_FILE), "utf8")) as Marks;
    return typeof value.month === "string" && typeof value.monthlyUsd === "number" ? value : null;
  } catch {
    return null;
  }
}

/** The notice a booking should raise: "cap" the first time the month reaches
 * the cap, "warn" the first time it crosses 80%, nothing again that month.
 * A new month or a raised cap starts over. */
export function personalCapAlert(dataDir: string, now = new Date()): "warn" | "cap" | null {
  const state = personalCapState(dataDir, now);
  if (!state || (!state.warn && !state.exceeded)) return null;
  const saved = readMarks(dataDir) ?? memoryMarks.get(dataDir) ?? null;
  const marks: Marks = saved && saved.month === state.month && saved.monthlyUsd === state.monthlyUsd ? saved : { month: state.month, monthlyUsd: state.monthlyUsd };
  const alert = state.exceeded && !marks.cap ? "cap" : state.warn && !marks.warn && !marks.cap ? "warn" : null;
  if (!alert) return null;
  const next: Marks = { ...marks, warn: true, ...(alert === "cap" ? { cap: true as const } : {}) };
  memoryMarks.set(dataDir, next);
  try {
    mkdirSync(join(dataDir, "usage"), { recursive: true, mode: 0o700 });
    writeFileSync(path(dataDir, MARKS_FILE), JSON.stringify(next), { mode: 0o600 });
  } catch {
    /* bookkeeping must never take down the turn */
  }
  return alert;
}

export function personalCapAlertText(alert: "warn" | "cap", state: PersonalCapState): { title: string; body: string } {
  const spent = `$${state.spentUsd.toFixed(2)} of $${state.monthlyUsd.toFixed(2)} spent this month (${state.month})`;
  return alert === "cap"
    ? { title: "Personal spend limit reached", body: `${spent}. New turns are refused until you raise the limit under Settings → Usage.` }
    : { title: `Spend is at ${state.percent}% of your personal limit`, body: `${spent}. New turns stop when the limit is reached.` };
}

/** The notice to raise after a booking, or null (nothing new this month). */
export function personalCapNotice(dataDir: string, now = new Date()): { title: string; body: string } | null {
  const alert = personalCapAlert(dataDir, now);
  const state = alert ? personalCapState(dataDir, now) : null;
  return alert && state ? personalCapAlertText(alert, state) : null;
}
