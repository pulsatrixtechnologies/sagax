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
   * was said. `cause: "credits"` (#3552): the engine in `tried` is out of credit (a
   * refusal whose cause is credit, server/routines/routine-recovery.ts) and
   * no other engine could take the message: credit never resets by itself,
   * so nothing is held and no time is promised. It stays an `exhausted` line
   * so apps released before it draw their own true sentence (#3577). */
  | { kind: "exhausted"; tried: string[]; resetsAt?: number; owner?: true; cause?: "credits" }
  /** #3315: `from` is known to be signed out for this turn's payer, so the
   * turn runs on `to`, a backup the person chose, for this turn only: the
   * conversation keeps its own model and is back on `from` once it is signed
   * in again. Quiet: a hidden row and a line in the Events lens. */
  | { kind: "signedOut"; from: string; to: string }
  /** #3315: the one line of a sign-out's stretch in the bot's chat: `from` is
   * signed out, `to` answers meanwhile, and signing in again ends it. */
  | { kind: "signedOutNotice"; from: string; to: string };

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

/** #3530: which `limitFailover.*` locale key says `line`, its words, and the
 * reset its `{time}` names (absent when it names none); null for a kind this
 * build does not know. The app
 * (src/lib/limit-failover.ts) and the server's plain line
 * (server/usage/limit-line.ts) both word a line through this one choice, each
 * in its reader's language and clock. */
export function limitFailoverWords(line: LimitFailoverLine): { key: string; vars: Record<string, string>; at?: number } | null {
  const at = "resetsAt" in line && typeof line.resetsAt === "number" ? line.resetsAt : undefined;
  const timed = (key: string, vars: Record<string, string>) => ({ key, vars, ...(at !== undefined ? { at } : {}) });
  switch (line.kind) {
    case "switched":
      if (line.reason === "model") return { key: line.to === "Auto" ? "limitFailover.modelSwitchedAuto" : "limitFailover.modelSwitched", vars: { from: line.from, to: line.to } };
      // A quick model Sagax picked for this turn: the conversation never goes
      // back to it, Sagax only skips it for quick turns until it resets.
      if (line.detour) return timed(line.estimated ? "limitFailover.detourNoReset" : "limitFailover.detour", { from: line.from });
      // A backup standing in for the conversation's own engine refused in
      // turn: the conversation goes back to its own engine, never to it.
      if (line.home) {
        const vars = { from: line.from, home: line.home, to: line.to };
        if (line.owner) return timed(line.estimated ? "limitFailover.ownerSwitchedStandInNoReset" : "limitFailover.ownerSwitchedStandIn", vars);
        return timed(line.estimated ? "limitFailover.switchedStandInNoReset" : "limitFailover.switchedStandIn", vars);
      }
      // The engine named no reset: the time is only when Sagax tries it again.
      if (line.estimated) return timed(line.owner ? "limitFailover.ownerSwitchedNoReset" : "limitFailover.switchedNoReset", { from: line.from, to: line.to });
      return timed(line.owner ? "limitFailover.ownerSwitched" : "limitFailover.switched", { from: line.from, to: line.to });
    case "back":
      if (line.refused) return { key: "limitFailover.backAfterLimit", vars: { refused: line.refused, engine: line.engine } };
      return { key: "limitFailover.back", vars: { engine: line.engine } };
    case "waiting":
      // A backup standing in for the conversation's own engine refused: the message waits for that engine.
      if (line.home) {
        const vars = { from: line.from, home: line.home };
        if (line.owner) return timed(line.estimated ? "limitFailover.ownerWaitingStandInNoReset" : "limitFailover.ownerWaitingStandIn", vars);
        return timed(line.estimated ? "limitFailover.waitingStandInNoReset" : "limitFailover.waitingStandIn", vars);
      }
      if (line.estimated) return timed(line.owner ? "limitFailover.ownerWaitingNoReset" : "limitFailover.waitingNoReset", { from: line.from });
      return timed(line.owner ? "limitFailover.ownerWaiting" : "limitFailover.waiting", { from: line.from });
    case "waitingRoutine":
      if (line.home) return timed(line.estimated ? "limitFailover.waitingRoutineStandInNoReset" : "limitFailover.waitingRoutineStandIn", { from: line.from, home: line.home });
      return timed(line.estimated ? "limitFailover.waitingRoutineNoReset" : "limitFailover.waitingRoutine", { from: line.from });
    case "exhausted": {
      // #3552: out of credit, nothing held and no reset promised.
      if (line.cause === "credits") return { key: line.owner ? "limitFailover.ownerCredits" : "limitFailover.credits", vars: { engine: line.tried.filter(Boolean).join(", ") } };
      const tried = line.tried.filter(Boolean).join(", ") || "the engines tried";
      if (at !== undefined) return timed(line.owner ? "limitFailover.ownerExhausted" : "limitFailover.exhausted", { tried });
      return { key: line.owner ? "limitFailover.ownerExhaustedNoTime" : "limitFailover.exhaustedNoTime", vars: { tried } };
    }
    case "signedOut":
      return { key: "limitFailover.signedOut", vars: { from: line.from, to: line.to } };
    case "signedOutNotice":
      return { key: "limitFailover.signedOutNotice", vars: { from: line.from, to: line.to } };
    default:
      // A kind a newer server wrote that this build does not know (#3577).
      return null;
  }
}

/** #3530: the line kinds that leave a turn unanswered for a usage limit or
 * credit: `held` when the server keeps the message and sends it again at the
 * reset, else nothing waits. Null for any other line. */
export function limitLineUnanswered(line: LimitFailoverLine | undefined): { held: boolean; reason: "usage_limit" | "credits"; resetsAt?: number } | null {
  if (!line) return null;
  if (line.kind === "waiting" || line.kind === "waitingRoutine") return { held: true, reason: "usage_limit", resetsAt: line.resetsAt };
  if (line.kind === "exhausted" && line.cause === "credits") return { held: false, reason: "credits" };
  if (line.kind === "exhausted") return { held: false, reason: "usage_limit", ...(line.resetsAt !== undefined ? { resetsAt: line.resetsAt } : {}) };
  return null;
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
      if (line.cause === "credits") {
        const engine = line.tried.filter(Boolean).join(", ");
        if (line.owner) return `This bot's owner is out of credit on ${engine}, so this message got no answer. Add credit with the provider, or switch engine from the model picker.`;
        return `${engine} is out of credit, so this message got no answer. Add credit with the provider, or switch engine from the model picker.`;
      }
      const tried = line.tried.filter(Boolean).join(", ") || "the engines tried";
      const when = line.resetsAt !== undefined ? ` Try again around ${clock(line.resetsAt)}, or pick another model / add credit.` : " Pick another model, add credit, or try again later.";
      if (line.owner) return `This bot's owner hit usage limits on ${tried}: no other engine could answer.${when}`;
      return `Limits were reached on ${tried}: no other engine could answer.${when}`;
    }
    case "signedOut":
      return `${line.from} is signed out, so ${line.to} took over this turn.`;
    case "signedOutNotice":
      return `${line.from} is signed out, so ${line.to} answers meanwhile. Sign in again in Settings → Model providers and accounts to keep using ${line.from}.`;
  }
}

/** The usage-limit lines a chat draws: a switch and a return are quiet rows
 * (2026-10-29), and a sign-out's lines are another state (#3315). */
const SHOWN_LIMIT_LINES = new Set<LimitFailoverLine["kind"]>(["waiting", "waitingRoutine", "exhausted"]);

/** The fields of a conversation row the limit line reads. */
export interface LimitLineRow {
  id: string;
  role: string;
  kind: string;
  turnSucceeded?: boolean;
  tool?: { name: string; limitFailover?: LimitFailoverLine };
}

/** #3552: the conversation's limit lines that still stand, oldest first:
 * drawn in the chat, with no answer from the bot since. A conversation keeps
 * one; a newer one retires the others (server/usage/limit-line.ts). */
export function standingLimitLines<Row extends LimitLineRow>(messages: readonly Row[]): Row[] {
  const standing: Row[] = [];
  for (const message of messages) {
    if (message.role === "bot" && message.kind === "text" && message.turnSucceeded !== false) {
      standing.length = 0;
      continue;
    }
    const line = message.kind === "activity" ? message.tool?.limitFailover : undefined;
    if (line && SHOWN_LIMIT_LINES.has(line.kind)) standing.push(message);
  }
  return standing;
}

/** #3552: whether the server holds this conversation's message and sends it
 * again at the reset (its standing line is a wait). Then nothing else offers
 * to resume it. */
export function limitMessageHeld(messages: readonly LimitLineRow[]): boolean {
  return standingLimitLines(messages).at(-1)?.tool?.limitFailover?.kind === "waiting";
}

/** #3577: a limit row's plain words: its name (limitFailoverText, written by
 * the server with every line) without the status prefix. An app draws them
 * for a line of a kind it does not know. */
export function limitLinePlainWords(name: string): string {
  return name.replace(/^(?:error|recovery|notice):\s*/, "");
}

/** A retired limit line: a quiet notice (shared/chat-notices.ts), kept for
 * the Events lens, never drawn. */
export function limitLineRetiredName(name: string): string {
  return `notice: ${limitLinePlainWords(name)}`;
}
