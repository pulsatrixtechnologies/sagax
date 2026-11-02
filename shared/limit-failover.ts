// The one status line a conversation keeps when its engine's usage limit
// sends a turn to another engine, and when it comes back (port of
// OpenMausBot #3074, "continue on the backup engine", adapted:
// server/limit-failover.ts). The row is a `recovery:` activity whose
// English words every client can show; the app draws `tool.limitFailover`
// in the reader's language instead (src/lib/activity-runs.ts).

/** What happened, with the engines' display names and when the limit
 * resets (epoch ms; the engine's own time, else a prudent estimate).
 * `estimated`: the engine named no reset, so `resetsAt` is only when Sagax
 * tries it again; the line says the engine gave no time (2026-11-02). */
export type LimitFailoverLine =
  /** The turn continues on `to` until `from` resets. `reason: "model"`: the
   * engine had no conversation model left (#1696), so the thread stays on
   * `to` (no return after a reset). `detour`: `from` is a quick model Sagax
   * picked for this turn (a call's, a proactive wake's, #1694), not the
   * conversation's own: the turn continues on another model, the
   * conversation never goes back to `from`, and Sagax skips it for quick
   * turns until it resets (2026-11-02). */
  | { kind: "switched"; from: string; to: string; resetsAt: number; owner?: true; reason?: "model"; estimated?: true; detour?: true }
  /** `engine`'s limit has reset: the conversation is back on it. */
  | { kind: "back"; engine: string }
  /** No other engine this turn may use: the message is sent again on `from`
   * once it resets. */
  | { kind: "waiting"; from: string; resetsAt: number; owner?: true; estimated?: true }
  /** Same, for a routine run: the routine runs again at the reset. */
  | { kind: "waitingRoutine"; from: string; resetsAt: number; estimated?: true };

/** How long after a reset the conversation goes back, so the provider has
 * rolled its window over (upstream AFTER_RESET_MS). */
export const AFTER_RESET_MS = 60_000;

/** "2:05 PM", or "Mon 2:05 PM" when the reset is not today, in `timeZone`. */
export function resetClockText(at: number, locale: string, timeZone?: string, now = Date.now()): string {
  try {
    const zone = timeZone ? { timeZone } : {};
    const day = (value: number) => new Date(value).toLocaleDateString("en-CA", zone);
    const sameDay = day(at) === day(now);
    return new Date(at).toLocaleTimeString(locale, { ...(sameDay ? {} : { weekday: "short" }), hour: "numeric", minute: "2-digit", ...zone });
  } catch {
    return `${new Date(at).toISOString().slice(11, 16)} UTC`;
  }
}

/** `owner`: the limit is the bot owner's (a member talks to a bot the
 * owner's plan pays for), so the line says whose limit it is (J4). */

/** The English line, for clients that do not draw `tool.limitFailover`. */
export function limitFailoverText(line: LimitFailoverLine, clock: (at: number) => string): string {
  switch (line.kind) {
    case "switched":
      if (line.reason === "model") {
        if (line.to === "Auto") return `${line.from} had no model left for this conversation: Auto continued the same turn on another engine.`;
        return `${line.from} had no model left for this conversation: continuing on ${line.to}.`;
      }
      if (line.detour) {
        if (line.estimated) return `Limit reached on ${line.from}, a quick model Sagax picked for this turn: continuing on another model. ${line.from} gave no reset time: Sagax skips it for quick turns until around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, a quick model Sagax picked for this turn: continuing on another model. Sagax skips ${line.from} for quick turns until it resets (around ${clock(line.resetsAt)}).`;
      }
      if (line.estimated) {
        if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}, which gave no reset time: continuing on ${line.to}; ${line.from} is tried again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which gave no reset time: continuing on ${line.to}; ${line.from} is tried again around ${clock(line.resetsAt)}.`;
      }
      if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}: continuing on ${line.to} until it resets (around ${clock(line.resetsAt)}).`;
      return `Limit reached on ${line.from}: continuing on ${line.to} until it resets (around ${clock(line.resetsAt)}).`;
    case "back":
      return `${line.engine}'s limit has reset: back on ${line.engine}.`;
    case "waiting":
      if (line.estimated) {
        if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}, which gave no reset time, and no other engine is available: your message will be sent again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which gave no reset time, and no other engine is available: your message will be sent again around ${clock(line.resetsAt)}.`;
      }
      if (line.owner) return `This bot's owner has reached their usage limit on ${line.from} and no other engine is available: your message will be sent again when it resets (around ${clock(line.resetsAt)}).`;
      return `Limit reached on ${line.from} and no other engine is available: your message will be sent again when it resets (around ${clock(line.resetsAt)}).`;
    case "waitingRoutine":
      if (line.estimated) return `Limit reached on ${line.from}, which gave no reset time, and no other engine is available: this routine runs again around ${clock(line.resetsAt)}.`;
      return `Limit reached on ${line.from} and no other engine is available: this routine runs again when it resets (around ${clock(line.resetsAt)}).`;
  }
}
