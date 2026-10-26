// The one status line a conversation keeps when its engine's usage limit
// sends a turn to another engine, and when it comes back (port of
// OpenMausBot #3074, "continue on the backup engine", adapted:
// server/limit-failover.ts). The row is a `recovery:` activity whose
// English words every client can show; the app draws `tool.limitFailover`
// in the reader's language instead (src/lib/activity-runs.ts).

/** What happened, with the engines' display names and when the limit
 * resets (epoch ms; the engine's own time, else a prudent estimate). */
export type LimitFailoverLine =
  /** The turn continues on `to` until `from` resets. */
  | { kind: "switched"; from: string; to: string; resetsAt: number; owner?: true }
  /** `engine`'s limit has reset: the conversation is back on it. */
  | { kind: "back"; engine: string }
  /** No other engine this turn may use: the message is sent again on `from`
   * once it resets. */
  | { kind: "waiting"; from: string; resetsAt: number; owner?: true }
  /** Same, for a routine run: the routine runs again at the reset. */
  | { kind: "waitingRoutine"; from: string; resetsAt: number };

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
      if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}: continuing on ${line.to} until it resets (around ${clock(line.resetsAt)}).`;
      return `Limit reached on ${line.from}: continuing on ${line.to} until it resets (around ${clock(line.resetsAt)}).`;
    case "back":
      return `${line.engine}'s limit has reset: back on ${line.engine}.`;
    case "waiting":
      if (line.owner) return `This bot's owner has reached their usage limit on ${line.from} and no other engine is available: your message will be sent again when it resets (around ${clock(line.resetsAt)}).`;
      return `Limit reached on ${line.from} and no other engine is available: your message will be sent again when it resets (around ${clock(line.resetsAt)}).`;
    case "waitingRoutine":
      return `Limit reached on ${line.from} and no other engine is available: this routine runs again when it resets (around ${clock(line.resetsAt)}).`;
  }
}
