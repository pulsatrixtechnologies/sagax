// Ahead of scheduled and proactive routine runs: if a login engine's sign-in
// is already marked expired (cheap file marker), notify the payer once and
// list the bots whose due runs must wait for reconnect instead of starting.
// Covers Claude, Codex, Grok and Kimi. Claude-only helpers stay exported for
// existing call sites and tests.

import {
  CLAUDE_NEEDS_RECONNECTING,
  CLAUDE_SIGN_IN_EXPIRED,
  isClaudeReconnectCondition,
} from "../drivers/claude-errors.ts";
import { CODEX_SIGN_IN_EXPIRED, codexNotSignedIn } from "../drivers/codex-errors.ts";
import type { LoginDriver } from "./principal-engine-logins.ts";

/** How far ahead of a due run to warn that the engine needs reconnecting. */
export const ENGINE_RECONNECT_AHEAD_MS = 6 * 60 * 60 * 1000;
/** @deprecated Use ENGINE_RECONNECT_AHEAD_MS. */
export const CLAUDE_RECONNECT_AHEAD_MS = ENGINE_RECONNECT_AHEAD_MS;

export const LOGIN_ENGINE_LABEL: Readonly<Record<LoginDriver, string>> = {
  claudeAgent: "Claude",
  codex: "Codex",
  grokAgent: "Grok",
  kimiAgent: "Kimi",
};

/** Waiting reason on a routine run that pauses until that engine reconnects. */
export function engineNeedsReconnecting(engineName: string): string {
  const name = engineName.trim() || "Engine";
  return `${name} needs reconnecting`;
}

export function engineReconnectAheadDetail(engineName: string): string {
  const name = engineName.trim() || "Engine";
  if (name === "Claude") {
    return `${CLAUDE_SIGN_IN_EXPIRED} Upcoming routines that use Claude will wait until you reconnect; they resume on their own after.`;
  }
  if (name === "Codex") {
    return `${CODEX_SIGN_IN_EXPIRED} Upcoming routines that use Codex will wait until you reconnect; they resume on their own after.`;
  }
  return `${name}'s sign-in has expired. Reconnect ${name} in Settings → Model providers and accounts. Upcoming routines that use ${name} will wait until you reconnect; they resume on their own after.`;
}

/** @deprecated Prefer engineReconnectAheadDetail("Claude"). */
export const CLAUDE_RECONNECT_AHEAD_DETAIL = engineReconnectAheadDetail("Claude");

export function isEngineReconnectAttention(attention: string | undefined): boolean {
  if (!attention) return false;
  return / needs reconnecting$/i.test(attention.trim());
}

/** Engine label inside a "X needs reconnecting" attention line, or null. */
export function engineNameFromReconnectAttention(attention: string | undefined): string | null {
  if (!attention) return null;
  const match = /^(.+?) needs reconnecting$/i.exec(attention.trim());
  return match?.[1]?.trim() || null;
}

/** A failure or attention line that must pause routines and never wake the bot. */
export function isEngineReconnectCondition(message: string | undefined): boolean {
  if (!message) return false;
  if (isClaudeReconnectCondition(message) || isEngineReconnectAttention(message)) return true;
  if (message.includes(CODEX_SIGN_IN_EXPIRED) || message.includes(codexNotSignedIn())) return true;
  if (/Reconnect Grok|Grok is not signed in|Grok sign-in or xAI key|Grok account it runs on has no active subscription|Sign in to Grok again/i.test(message)) {
    return true;
  }
  if (/This bot's engine is signed out\. Sign in again/i.test(message)) return true;
  if (/Kimi.*sign-in|Reconnect Kimi|Kimi is not signed in/i.test(message)) return true;
  return false;
}

/** Best-effort engine label from a reconnect failure's own words. */
export function engineNameFromReconnectFailure(message: string | undefined): string {
  if (!message) return "Engine";
  if (isClaudeReconnectCondition(message) || /\bClaude\b/i.test(message)) return "Claude";
  if (message.includes(CODEX_SIGN_IN_EXPIRED) || /\bCodex\b|\bChatGPT\b/i.test(message)) return "Codex";
  if (/\bGrok\b/i.test(message)) return "Grok";
  if (/\bKimi\b/i.test(message)) return "Kimi";
  return "Engine";
}

export interface EngineReconnectAheadRoutine {
  id: string;
  name: string;
  botId: string;
  enabled: boolean;
  suspended?: boolean;
  nextRunAt?: number | null;
  target?: string;
  runAs?: string;
}

export interface EngineReconnectAheadInput {
  now: number;
  routines: readonly EngineReconnectAheadRoutine[];
  /** Login driver of this bot's engine, or null when it is not a login engine. */
  botDriver: (botId: string) => LoginDriver | string | null | undefined;
  /** Who pays for this bot's turns (owner / runAs). */
  botPayer: (botId: string) => string | null | undefined;
  /** Cheap: that person's sign-in for this driver is marked expired. */
  /** #2384: with `botId`, the account that bot runs on; without, any of
   * the person's accounts on this driver. */
  expired: (principalId: string, driver: string, botId?: string) => boolean;
  /** Already notified for this expired spell: `${principalId}\0${engineLabel}`. */
  alreadyNotified?: ReadonlySet<string>;
  aheadMs?: number;
}

export interface EngineReconnectAheadNotify {
  principalId: string;
  engineName: string;
  driver: string;
  routineNames: string[];
  /** #4233: the bots whose due routines wait, first due first: the card
   * names the engine instance they run on. */
  botIds: string[];
}

export interface EngineReconnectAheadResult {
  notify: EngineReconnectAheadNotify[];
  /** Bot ids whose login engine is expired: their due runs must wait. */
  pauseBotIds: Set<string>;
  /** Bot id → engine label for the wait attention line. */
  pauseEngineByBot: Map<string, string>;
}

function notifyKey(principalId: string, engineName: string): string {
  return `${principalId}\0${engineName}`;
}

/** Pure scan: who to notify ahead of due login-engine routines, and which
 * bots must pause their next runs for reconnect. */
export function engineReconnectAhead(input: EngineReconnectAheadInput): EngineReconnectAheadResult {
  const aheadMs = input.aheadMs ?? ENGINE_RECONNECT_AHEAD_MS;
  const notified = input.alreadyNotified ?? new Set<string>();
  const byPersonEngine = new Map<string, EngineReconnectAheadNotify>();
  const pauseBotIds = new Set<string>();
  const pauseEngineByBot = new Map<string, string>();

  for (const routine of input.routines) {
    if (!routine.enabled || routine.suspended) continue;
    if (routine.target != null && routine.target !== "bot") continue;
    const dueAt = routine.nextRunAt;
    if (dueAt == null || dueAt < input.now || dueAt - input.now > aheadMs) continue;
    const driver = input.botDriver(routine.botId);
    if (!driver || typeof driver !== "string") continue;
    const engineName = LOGIN_ENGINE_LABEL[driver as LoginDriver] ?? driver;
    const payer = (routine.runAs?.trim() || input.botPayer(routine.botId)?.trim() || "");
    if (!payer || !input.expired(payer, driver, routine.botId)) continue;
    pauseBotIds.add(routine.botId);
    pauseEngineByBot.set(routine.botId, engineName);
    const key = notifyKey(payer, engineName);
    const existing = byPersonEngine.get(key);
    if (existing) {
      existing.routineNames.push(routine.name);
      if (!existing.botIds.includes(routine.botId)) existing.botIds.push(routine.botId);
    } else {
      byPersonEngine.set(key, {
        principalId: payer,
        engineName,
        driver,
        routineNames: [routine.name],
        botIds: [routine.botId],
      });
    }
  }

  const notify: EngineReconnectAheadNotify[] = [];
  for (const entry of byPersonEngine.values()) {
    if (notified.has(notifyKey(entry.principalId, entry.engineName))) continue;
    notify.push(entry);
  }
  return { notify, pauseBotIds, pauseEngineByBot };
}

/** Claude-shaped wrapper kept for existing tests and call sites. */
export interface ClaudeReconnectAheadRoutine extends EngineReconnectAheadRoutine {}

export interface ClaudeReconnectAheadInput {
  now: number;
  routines: readonly ClaudeReconnectAheadRoutine[];
  botUsesClaude: (botId: string) => boolean;
  botPayer: (botId: string) => string | null | undefined;
  claudeExpired: (principalId: string) => boolean;
  alreadyNotified?: ReadonlySet<string>;
  aheadMs?: number;
}

export interface ClaudeReconnectAheadResult {
  notify: Array<{ principalId: string; routineNames: string[] }>;
  pauseBotIds: Set<string>;
}

export function claudeReconnectAhead(input: ClaudeReconnectAheadInput): ClaudeReconnectAheadResult {
  const already = new Set<string>();
  if (input.alreadyNotified) {
    for (const person of input.alreadyNotified) already.add(notifyKey(person, "Claude"));
  }
  const result = engineReconnectAhead({
    now: input.now,
    routines: input.routines,
    botDriver: (botId) => (input.botUsesClaude(botId) ? "claudeAgent" : null),
    botPayer: input.botPayer,
    expired: (principalId, driver) => driver === "claudeAgent" && input.claudeExpired(principalId),
    alreadyNotified: already,
    aheadMs: input.aheadMs,
  });
  return {
    pauseBotIds: result.pauseBotIds,
    notify: result.notify.map((entry) => ({
      principalId: entry.principalId,
      routineNames: entry.routineNames,
    })),
  };
}

export { CLAUDE_NEEDS_RECONNECTING, CLAUDE_SIGN_IN_EXPIRED };
