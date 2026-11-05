// The one status line a conversation keeps when its engine's usage limit
// sends a turn to another engine, and when it comes back (port of
// OpenMausBot #3074, "continue on the backup engine", adapted:
// server/usage/limit-failover.ts). The row is a `recovery:` activity whose
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
   * turns until it resets (2026-11-02). `home`: `from` was a backup standing
   * in for `home`, the conversation's own engine (an earlier takeover): the
   * conversation goes back to `home` at `resetsAt`, `home`'s own reset,
   * never to `from` (2026-11-02). */
  | { kind: "switched"; from: string; to: string; resetsAt: number; owner?: true; reason?: "model"; estimated?: true; detour?: true; home?: string }
  /** `engine`'s limit has reset: the conversation is back on it. `refused`:
   * a limit refused the backup that stood in for `engine`, so the
   * conversation went back to `engine` at once (2026-11-02). */
  | { kind: "back"; engine: string; refused?: string }
  /** No other engine this turn may use: the message is sent again on `from`
   * once it resets. `home`: `from` was a backup standing in for `home`, the
   * conversation's own engine (an earlier takeover): the message is sent
   * again when `home` resets (`resetsAt`, `home`'s own reset), and `from` is
   * the engine that refused, never `home` (2026-11-02, final review). */
  | { kind: "waiting"; from: string; resetsAt: number; owner?: true; estimated?: true; home?: string }
  /** Same, for a routine run: the routine runs again at the reset. */
  | { kind: "waitingRoutine"; from: string; resetsAt: number; estimated?: true; home?: string }
  /** #1942: primary and at least one backup hit their limits with nothing
   * left to try. The turn is failed (not silent done); `tried` names the
   * engines that refused. `resetsAt` is the soonest known reset when one
   * was said. */
  | { kind: "exhausted"; tried: string[]; resetsAt?: number; owner?: true };

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
      if (line.home) {
        if (line.owner) {
          if (line.estimated) return `This bot's owner has reached their usage limit on ${line.from}, which was standing in for ${line.home}: continuing on ${line.to}. ${line.home} gave no reset time: it is tried again around ${clock(line.resetsAt)}.`;
          return `This bot's owner has reached their usage limit on ${line.from}, which was standing in for ${line.home}: continuing on ${line.to}, back on ${line.home} when it resets (around ${clock(line.resetsAt)}).`;
        }
        if (line.estimated) return `Limit reached on ${line.from}, which was standing in for ${line.home}: continuing on ${line.to}. ${line.home} gave no reset time: it is tried again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which was standing in for ${line.home}: continuing on ${line.to}, back on ${line.home} when it resets (around ${clock(line.resetsAt)}).`;
      }
      if (line.estimated) {
        if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}, which gave no reset time: continuing on ${line.to}; ${line.from} is tried again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which gave no reset time: continuing on ${line.to}; ${line.from} is tried again around ${clock(line.resetsAt)}.`;
      }
      if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}: continuing on ${line.to} until it resets (around ${clock(line.resetsAt)}).`;
      return `Limit reached on ${line.from}: continuing on ${line.to} until it resets (around ${clock(line.resetsAt)}).`;
    case "back":
      if (line.refused) return `Limit reached on ${line.refused}, which was standing in for ${line.engine}: back on ${line.engine}, whose limit has reset.`;
      return `${line.engine}'s limit has reset: back on ${line.engine}.`;
    case "waiting":
      // A backup standing in for the conversation's own engine refused: the message waits for that engine.
      if (line.home) {
        if (line.owner) {
          if (line.estimated) return `This bot's owner has reached their usage limit on ${line.from}, which was standing in for ${line.home}, and no other engine is available. ${line.home} gave no reset time: your message will be sent again around ${clock(line.resetsAt)}.`;
          return `This bot's owner has reached their usage limit on ${line.from}, which was standing in for ${line.home}, and no other engine is available: your message will be sent again when ${line.home} resets (around ${clock(line.resetsAt)}).`;
        }
        if (line.estimated) return `Limit reached on ${line.from}, which was standing in for ${line.home}, and no other engine is available. ${line.home} gave no reset time: your message will be sent again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which was standing in for ${line.home}, and no other engine is available: your message will be sent again when ${line.home} resets (around ${clock(line.resetsAt)}).`;
      }
      if (line.estimated) {
        if (line.owner) return `This bot's owner has reached their usage limit on ${line.from}, which gave no reset time, and no other engine is available: your message will be sent again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which gave no reset time, and no other engine is available: your message will be sent again around ${clock(line.resetsAt)}.`;
      }
      if (line.owner) return `This bot's owner has reached their usage limit on ${line.from} and no other engine is available: your message will be sent again when it resets (around ${clock(line.resetsAt)}).`;
      return `Limit reached on ${line.from} and no other engine is available: your message will be sent again when it resets (around ${clock(line.resetsAt)}).`;
    case "waitingRoutine":
      if (line.home) {
        if (line.estimated) return `Limit reached on ${line.from}, which was standing in for ${line.home}, and no other engine is available. ${line.home} gave no reset time: this routine runs again around ${clock(line.resetsAt)}.`;
        return `Limit reached on ${line.from}, which was standing in for ${line.home}, and no other engine is available: this routine runs again when ${line.home} resets (around ${clock(line.resetsAt)}).`;
      }
      if (line.estimated) return `Limit reached on ${line.from}, which gave no reset time, and no other engine is available: this routine runs again around ${clock(line.resetsAt)}.`;
      return `Limit reached on ${line.from} and no other engine is available: this routine runs again when it resets (around ${clock(line.resetsAt)}).`;
    case "exhausted": {
      const tried = line.tried.filter(Boolean).join(", ") || "the engines tried";
      const when = line.resetsAt !== undefined ? ` Try again around ${clock(line.resetsAt)}, or pick another model / add credit.` : " Pick another model, add credit, or try again later.";
      if (line.owner) return `This bot's owner hit usage limits on ${tried}: no other engine could answer.${when}`;
      return `Limits were reached on ${tried}: no other engine could answer.${when}`;
    }
  }
}
