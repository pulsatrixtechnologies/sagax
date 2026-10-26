// The two dismissible cost notices of a conversation: a group answers with
// several bots (each member reads the whole thread), and a subscription's
// weekly limit that is nearly or fully used. Pure rules plus a guarded
// dismissal store, so the states are tested without a DOM.
import type { PlanRow } from "@/lib/plan-usage";

/** The weekly notice appears from this share used. */
export const WEEKLY_NOTICE_FROM = 80;

export interface WeeklyNotice {
  /** Product name of the provider ("Claude"). */
  name: string;
  percent: number;
  /** 80, 90 or 100: a dismissal holds until the next band or the next reset. */
  band: 80 | 90 | 100;
  key: string;
}

/** The most used subscription weekly window at or above the threshold. Plans
 * paid by an API key have no window to warn about. */
export function weeklyLimitNotice(rows: PlanRow[], from = WEEKLY_NOTICE_FROM): WeeklyNotice | null {
  let worst: { row: PlanRow; used: number } | null = null;
  for (const row of rows) {
    if (row.access !== "subscription" || !row.weekly.available) continue;
    const used = row.weekly.usedPercent ?? (row.weekly.remainingPercent === null ? null : 100 - row.weekly.remainingPercent);
    if (used === null || !Number.isFinite(used) || used < from) continue;
    if (!worst || used > worst.used) worst = { row, used };
  }
  if (!worst) return null;
  const percent = Math.min(100, Math.round(worst.used));
  const band = percent >= 100 ? 100 : percent >= 90 ? 90 : 80;
  return { name: worst.row.name, percent, band, key: `weekly:${worst.row.id}:${(worst.row.weekly.resetsAt ?? "-").slice(0, 10)}:${band}` };
}

/** Group threads: more than one bot answering. A direct bot-to-bot channel
 * and a person-to-person conversation are not billed that way. */
export function showsGroupCostNotice(group: { dm?: boolean; peopleDm?: boolean; memberIds: string[] }): boolean {
  return !group.dm && !group.peopleDm && group.memberIds.length > 1;
}

const PREFIX = "sagax.notice.dismissed.";

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function noticeDismissed(key: string): boolean {
  try { return store()?.getItem(PREFIX + key) === "1"; } catch { return false; }
}

export function dismissNotice(key: string): void {
  try { store()?.setItem(PREFIX + key, "1"); } catch { /* private window: it comes back next time */ }
}
