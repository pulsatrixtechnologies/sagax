// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372): what its two
// halves read. Pure rules; the component is src/components/ComposerMeter.tsx.
// The readings are the ones the app already has: a thread's last measured
// prompt against its model's window (task usage, lib/usage.ts), and the plan
// rows of the account that serves the bot (GET /api/plan-usage). A half with
// no data is absent, never greyed and never at zero.
import type { Message, TaskUsage } from "@/state/store";
import { nearLimit, type EngineLimit } from "../../shared/limit-reset";
import { compactedSinceReading } from "./context-warning";
import type { PlanRow } from "./plan-usage";
import { contextShare } from "./usage";

export interface ContextHalf {
  /** The share of the model's window this conversation uses, 0 to 999. */
  percent: number;
  tokens: number;
  window: number;
}

/** Null when the engine gives no window, when nothing was measured yet, and
 * once the thread was compacted after its last reading (the old figure then
 * describes the context before the summary). */
export function contextHalf(usage: TaskUsage | undefined, messages: readonly Pick<Message, "role" | "kind">[]): ContextHalf | null {
  const share = usage ? contextShare(usage) : null;
  if (!share || share.window === undefined || share.percent === undefined) return null;
  if (compactedSinceReading(messages)) return null;
  return { percent: share.percent, tokens: share.tokens, window: share.window };
}

export interface UsageHalf {
  /** The most advanced window's share used, 0 to 100. */
  percent: number;
  window: "five-hour" | "weekly";
  /** The account that window belongs to. */
  row: PlanRow;
}

/** The most advanced limit (the short session or the week) among the rows
 * that answer for the bot's engine. Null with no readable window: an API key
 * account, a signed-out one, a failed read with nothing kept. */
export function usageHalf(rows: readonly PlanRow[]): UsageHalf | null {
  let best: UsageHalf | null = null;
  for (const row of rows) {
    if (row.state !== "windows") continue;
    for (const [name, window] of [["weekly", row.weekly], ["five-hour", row.fiveHour]] as const) {
      if (!window.available || window.usedPercent === null || !Number.isFinite(window.usedPercent)) continue;
      const percent = Math.min(100, Math.max(0, Math.round(window.usedPercent)));
      if (!best || percent > best.percent) best = { percent, window: name, row };
    }
  }
  return best;
}

export interface LimitHalf {
  /** The engine's own share used, 0 to 100; null when it is refusing work
   * and reported no window (the ring is then full, with no figure). */
  percent: number | null;
}

/** The usage half when the plan report has no window for the engine (an API
 * key account, a plan read that failed) but the engine's own limit report
 * says near or reached: the limit dot showed then, so the half does (#5372
 * review). Null under the dot's threshold: no data, no half. */
export function limitHalf(limit: Pick<EngineLimit, "usedPercent" | "blocked"> | undefined): LimitHalf | null {
  if (!limit || !nearLimit(limit)) return null;
  const used = limit.usedPercent;
  if (used === null || !Number.isFinite(used)) return { percent: null };
  return { percent: Math.min(100, Math.max(0, Math.round(used))) };
}

export type UsageTone = "quiet" | "warning" | "danger";

/** The usage half's colour, by the limit dot's own rules (it replaces the
 * dot): warning near the limit (the engine's fullest window at 90% or more,
 * or the week at 80% or more), danger at the limit. */
export function usageTone(state: { near: boolean; weeklyNotice: boolean; hard: boolean }): UsageTone {
  if (state.hard) return "danger";
  return state.near || state.weeklyNotice ? "warning" : "quiet";
}
