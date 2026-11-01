// Proactive mode: a per-bot on/off switch, set next to the approval level,
// that says whether a bot may notice a condition (a new mail, an upcoming
// meeting, a failed run, a bot's post, a webhook) and start work without
// being asked.
//
// One proactive behavior (2026-11-01). Off means no wakes. Proactive means
// the bot wakes on those events and acts at its usual approval level and
// rules, exactly like a normal turn: org Ask/Deny rules and the person's
// own rules still apply; the proactive layer adds no extra approval card.
// Before a write from a wake, the server records a dry run (what it would
// do) on the wake; then the write goes through the ordinary approval path.
//
// Legacy stored values "propose", "read-auto" and "follow-rules" all read
// as "proactive". "off" stays off. A garbled value fails closed to off.
// A bot that never stored a mode reads as the default (proactive).

export const PROACTIVE_MODES = ["off", "proactive"] as const;

export type ProactiveMode = (typeof PROACTIVE_MODES)[number];

export const PROACTIVE_MODE_DEFAULT: ProactiveMode = "proactive";

/** Older mode names that migrate to proactive. */
const LEGACY_PROACTIVE_MODES = ["propose", "read-auto", "follow-rules"] as const;

export function isProactiveMode(value: unknown): value is ProactiveMode {
  return typeof value === "string" && (PROACTIVE_MODES as readonly string[]).includes(value);
}

/** Map a stored or client value onto off | proactive. Legacy acting modes
 * become proactive; unknown values fail closed to off. */
export function normalizeProactiveMode(value: unknown): ProactiveMode {
  if (value === undefined || value === null) return PROACTIVE_MODE_DEFAULT;
  if (value === "off") return "off";
  if (value === "proactive") return "proactive";
  if (typeof value === "string" && (LEGACY_PROACTIVE_MODES as readonly string[]).includes(value)) {
    return "proactive";
  }
  return "off";
}

/** The durable mode of a bot. No stored mode reads as the default; a
 * garbled persisted value fails closed to off. Legacy propose / read-auto /
 * follow-rules read as proactive. */
export function proactiveModeFor(bot: { proactiveMode?: unknown }): ProactiveMode {
  if (bot.proactiveMode === undefined || bot.proactiveMode === null) return PROACTIVE_MODE_DEFAULT;
  return normalizeProactiveMode(bot.proactiveMode);
}

/** What a proactive step wants to do, as the server classifies it:
 * - read: a read-only observation or preparation (summarize, classify, draft).
 * - write: any write, outbound, money or contact action. The server fails a
 *   step it cannot classify to "write", so the unknown always goes through
 *   the ordinary approval path. */
export type ProactiveActionKind = "read" | "write";

/** The gate's answer for one proactive step:
 * - blocked: do nothing (off).
 * - auto: run it now (only ever returned for a read).
 * - defer: hand the step to the bot's ordinary approval path (Ask / Auto /
 *   Full and standing rules), with a dry run recorded for a write. */
export type ProactiveDisposition = "blocked" | "auto" | "defer";

export interface ProactiveGateInput {
  mode: ProactiveMode;
  kind: ProactiveActionKind;
  /** Kept for callers that still pass the turn's level; the gate no longer
   * branches on it (writes always defer to that ordinary path). */
  approvalLevel?: string;
}

/** Whether a bot on this mode may observe (read-only sensing of a condition)
 * at all. Only off forbids it. */
export function proactiveMayObserve(mode: ProactiveMode): boolean {
  return mode !== "off";
}

/** The pure per-step decision. It never lets a write run on its own from the
 * proactive layer: the only disposition that executes without the ordinary
 * approval path is "auto", returned for a read. */
export function proactiveGate({ mode, kind }: ProactiveGateInput): ProactiveDisposition {
  if (mode === "off") return "blocked";
  if (kind === "read") return "auto";
  return "defer";
}

/** A guard for callers and tests: does this disposition let a write execute
 * without reaching a person first from the proactive layer? Never. "auto"
 * runs reads only; "defer" routes through the ordinary approval path (a
 * standing rule the person set is itself their prompt). */
export function proactiveWriteCanExecuteUnprompted(_disposition: ProactiveDisposition): false {
  return false;
}
