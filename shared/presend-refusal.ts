// A turn the engine refused before any prompt reached the model (#2013): the
// engine was not ready, its configuration conflicts with the bot's, its
// sign-in expired, or its account is at its limit or out of credit. The maintainer,
// 2026-11-05: none of these is a red card in the chat. The composer says it
// in one line with the one thing to do (shared/send-state.ts), and rows of
// these kinds already stored are not drawn. One copy for the server, which
// writes no card for them, and the clients, which hide the old ones.
import { isEngineLimitWords } from "./engine-limit-words.ts";

/** The Codex selection refusal's words (server/drivers/codex/finish.ts). */
export const CODEX_AMBIENT_MCP_REFUSAL = "Codex has an MCP server outside the selected configuration. Disable native MCP entries for this account before using tool selection.";

export type PreSendRefusalKind =
  /** Usage limit or credit: the conversation's one limit line says it
   * (#3552, shared/limit-failover.ts), never the composer. */
  | "engine_limit"
  /** The engine's sign-in expired or was refused. */
  | "signed_out"
  /** The engine's own configuration conflicts with the bot's selection. */
  | "config_conflict"
  /** The engine could not start or confirm its setup. */
  | "engine_not_ready";

/** Words an engine uses when no prompt went out. */
const NO_PROMPT_SENT = /\bNo prompt was sent\.?\s*$/i;
/** The native configuration and the bot's selection disagree. */
const CONFIG_CONFLICT = /\bMCP (?:server|connection)s? outside the (?:selected configuration|bot's selection)\b|\bnative MCP (?:entries|connections)\b/i;
/** An engine that could not read or apply its own configuration. */
const NOT_READY = /\brejected its configuration as invalid\b|\bCould not read Codex configuration\b|\bcould not turn its shell off\b|\bcould not confirm (?:its|the) selected (?:MCP configuration|MCP catalog|model)\b/i;
/** A sign-in that expired or was refused. */
const SIGNED_OUT = /\bsign(?:ed)?[- ]?(?:in|out)\b.*\b(?:expired|refused|again|required)\b|\b(?:log|sign) in again\b|\bnot (?:signed|logged) in\b|\bauthentication required\b|\b401\b|\bunauthorized\b|\bmissing bearer\b|\bre-?authenticate\b/i;

/** What kind of pre-send refusal a failed turn's cause is, or null when the
 * turn failed after the model started (that stays a row in the chat). */
export function preSendRefusalKind(
  cause: string,
  flags: { setup?: boolean; claudeUpdate?: boolean; limitResetsAt?: number } = {},
): PreSendRefusalKind | null {
  const words = cause.trim();
  if (!words) return null;
  if (flags.limitResetsAt !== undefined || isEngineLimitWords(words)) return "engine_limit";
  if (CONFIG_CONFLICT.test(words)) return "config_conflict";
  if (flags.setup && SIGNED_OUT.test(words)) return "signed_out";
  if (flags.setup || flags.claudeUpdate) return "engine_not_ready";
  if (NOT_READY.test(words) || NO_PROMPT_SENT.test(words)) return "engine_not_ready";
  return null;
}

/** Whether this config conflict is the Codex one Sagax can fix itself. */
export function isCodexAmbientMcpRefusal(cause: string): boolean {
  return cause.includes("Codex has an MCP server outside the selected configuration");
}
