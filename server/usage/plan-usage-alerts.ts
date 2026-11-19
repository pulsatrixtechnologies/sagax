// Plan-usage alerts and the spent-plan readers, over the rows plan-usage.ts builds.
import type { PlanProviderRow, PlanUsageReport } from "./plan-usage.ts";


/** J4: a plan window that has crossed the warning line (default 80 %) or
 * is spent (100 %). */
export interface PlanUsageAlert {
  providerId: string;
  provider: string;
  window: "fiveHour" | "weekly";
  level: "warn" | "limit";
  usedPercent: number;
  resetsAt: string | null;
}

export const PLAN_ALERT_DEFAULT_PERCENT = 80;
/** Windows already announced, per audience: a window warns once (and once
 * more when it is spent) until its reset moves it to a new key. */
const announcedWindows = new Map<string, true>();
const ANNOUNCED_MAX = 512;

export function clearPlanUsageAlerts(): void {
  announcedWindows.clear();
}

/** The windows of `report` that newly crossed `threshold` for `scope` (a
 * person, or "server" solo). Each (window, reset, level) is returned once. */
export function newPlanUsageAlerts(report: PlanUsageReport, scope: string, threshold = PLAN_ALERT_DEFAULT_PERCENT): PlanUsageAlert[] {
  const line = Math.min(99, Math.max(1, Number.isFinite(threshold) ? Math.round(threshold) : PLAN_ALERT_DEFAULT_PERCENT));
  const out: PlanUsageAlert[] = [];
  for (const row of report.providers) {
    if (row.state !== "windows") continue;
    for (const window of ["fiveHour", "weekly"] as const) {
      const value = row[window];
      if (!value.available || value.usedPercent === null) continue;
      const level = value.usedPercent >= 100 ? "limit" : value.usedPercent >= line ? "warn" : null;
      if (!level) continue;
      const key = `${scope}\u0000${row.id}\u0000${window}\u0000${(value.resetsAt ?? "").slice(0, 16)}\u0000${level}`;
      if (announcedWindows.has(key)) continue;
      announcedWindows.set(key, true);
      if (announcedWindows.size > ANNOUNCED_MAX) announcedWindows.delete(announcedWindows.keys().next().value as string);
      out.push({ providerId: row.id, provider: row.name, window, level, usedPercent: value.usedPercent, resetsAt: value.resetsAt });
    }
  }
  return out;
}

/** An allowance a row shows past its windows: Claude's extra usage (paid
 * past the plan), a credit balance. */
const EXTRA_ALLOWANCE = /^(?:extra usage|credits?)$/i;

/** Whether Claude's paid extra usage is on and not used up, on a plan with rolling windows: sends then go on past a
 * full window and are paid from it. */
export function claudeHasExtraUsageRoom(row: Pick<PlanProviderRow, "driver" | "fiveHour" | "weekly" | "extra">): boolean {
  if (row.driver !== "claude" || !(row.fiveHour.available || row.weekly.available)) return false;
  return !!row.extra?.some((line) => EXTRA_ALLOWANCE.test(line.label.trim()) && line.usedPercent < 100);
}

/** 2026-11-02: until when this row's plan is spent, as its provider said:
 * the latest reset among its windows used at 100 % (each must reset before
 * a turn runs on it again). Null when none is spent, when a spent one gave
 * no reset (Sagax cannot say until when), or while the row still shows extra
 * usage or credit left: the engine answers on it (review, 2026-11-02). */
export function spentPlanUntil(row: PlanProviderRow): number | null {
  if (row.state !== "windows") return null;
  if (row.extra?.some((line) => EXTRA_ALLOWANCE.test(line.label.trim()) && line.remainingPercent > 0)) return null;
  let until: number | null = null;
  for (const window of [row.fiveHour, row.weekly]) {
    if (!window.available || window.usedPercent === null || window.usedPercent < 100) continue;
    const at = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    if (!Number.isFinite(at)) return null;
    until = until === null ? at : Math.max(until, at);
  }
  return until;
}

/** #2192: the fullest window used-percent on this plan row (0–100), or null
 * when the row has no windows. Used to rotate accounts before the limit. */
export function planUsedPercent(row: PlanProviderRow): number | null {
  if (row.state !== "windows") return null;
  let used: number | null = null;
  for (const window of [row.fiveHour, row.weekly]) {
    if (!window.available || window.usedPercent === null) continue;
    used = used === null ? window.usedPercent : Math.max(used, window.usedPercent);
  }
  return used;
}

/** The notice's words, English like the server's other notification titles. */
export function planUsageAlertText(alert: PlanUsageAlert): { title: string; body: string } {
  const span = alert.window === "weekly" ? "weekly" : "5-hour";
  return alert.level === "limit"
    ? { title: `${alert.provider}: ${span} usage limit reached`, body: `Your ${span} limit on ${alert.provider} is used up. Turns on it wait for the reset or continue on another engine.` }
    : { title: `${alert.provider}: ${Math.round(alert.usedPercent)}% of your ${span} limit used`, body: `You have used ${Math.round(alert.usedPercent)}% of your ${span} limit on ${alert.provider}.` };
}
