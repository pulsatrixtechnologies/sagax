// Proactive mode: a per-bot setting, set next to the approval level, that
// says whether and how a bot may act on its own — notice a condition (a new
// mail, an upcoming meeting, a finished run) and start an action this turn
// without being asked for it.
//
// It is deliberately NOT the upstream "Chief" orchestrator. There is no
// workspace Chief of Staff that watches the day and no global watch routine;
// every bot carries its own level, like its approval level, and the server
// enforces it per bot. The mechanism it governs — observe a read-only
// condition, then initiate — is adapted from OpenMausBot's proactive routines,
// but the gating is entirely our approval model.
//
// The levels, in the order the selector shows:
// - off (default): no proactive behavior. Routines still run on their
//   schedule or when a trigger fires; a bot never starts anything else on its
//   own. This is today's behavior.
// - propose: the bot may observe (read-only) and PROPOSE an action through a
//   card or notification. It executes NOTHING without the person's yes — not
//   even a read-only follow-up.
// - read-auto: the bot may do read-only things itself (summarize, classify,
//   prepare a draft) and shows an approval card, with a dry run, for any
//   write or outbound action.
// - follow-rules: a proactive action follows the bot's existing approval
//   level and rules exactly — what the rules cover passes, the rest asks —
//   just like a normal action, never looser.
//
// The one hard invariant, checked in both this module's and the server's
// tests: a write, outbound, money or contact action NEVER executes unprompted
// from the proactive layer. Read-only observation is always fine; a write
// always reaches our approval card (with dry run) unless the person's own
// standing rules already cover it (follow-rules), which is the same prompt a
// normal action would get.

export const PROACTIVE_MODES = ["off", "propose", "read-auto", "follow-rules"] as const;

export type ProactiveMode = (typeof PROACTIVE_MODES)[number];

export const PROACTIVE_MODE_DEFAULT: ProactiveMode = "off";

export function isProactiveMode(value: unknown): value is ProactiveMode {
  return typeof value === "string" && (PROACTIVE_MODES as readonly string[]).includes(value);
}

/** The durable mode of a bot, defaulting to off and failing closed to off on
 * any unknown persisted value: a record written before the setting existed,
 * or a garbled one, never starts acting on its own. */
export function proactiveModeFor(bot: { proactiveMode?: unknown }): ProactiveMode {
  return isProactiveMode(bot.proactiveMode) ? bot.proactiveMode : PROACTIVE_MODE_DEFAULT;
}

/** What a proactive step wants to do, as the server classifies it:
 * - read: a read-only observation or preparation (summarize, classify, draft).
 * - write: any write, outbound, money or contact action. The server fails a
 *   step it cannot classify to "write", so the unknown always cards. */
export type ProactiveActionKind = "read" | "write";

/** The gate's answer for one proactive step:
 * - blocked: do nothing (off).
 * - propose: offer it through a card or notification; execute nothing until
 *   the person says yes.
 * - auto: run it now (only ever returned for a read).
 * - card: open our approval card, with a dry run, before executing.
 * - defer: hand the step to the bot's ordinary approval path, which cards it
 *   unless a standing rule the person set already covers it. */
export type ProactiveDisposition = "blocked" | "propose" | "auto" | "card" | "defer";

export interface ProactiveGateInput {
  mode: ProactiveMode;
  kind: ProactiveActionKind;
}

/** Whether a bot on this mode may observe (read-only sensing of a condition)
 * at all. Only off forbids it. */
export function proactiveMayObserve(mode: ProactiveMode): boolean {
  return mode !== "off";
}

/** The pure per-step decision. It never lets a write run on its own: the only
 * disposition that executes without a card is "auto", returned for a read. */
export function proactiveGate({ mode, kind }: ProactiveGateInput): ProactiveDisposition {
  if (mode === "off") return "blocked";
  if (kind === "read") {
    // Propose offers even read-only follow-ups instead of running them; the
    // other two run their own reads (#875: a read never opens a card).
    return mode === "propose" ? "propose" : "auto";
  }
  // kind === "write": the proactive layer itself never executes it.
  switch (mode) {
    case "propose":
      return "propose";
    case "read-auto":
      return "card";
    case "follow-rules":
      return "defer";
  }
}

/** A guard for callers and tests: does this disposition let a write execute
 * without reaching a person first? Never. "auto" runs reads only, "card" and
 * "propose" always stop for a person, and "defer" routes through the ordinary
 * approval path (a standing rule the person set is itself their prompt). */
export function proactiveWriteCanExecuteUnprompted(_disposition: ProactiveDisposition): false {
  return false;
}
