// Ahead of scheduled Claude routines: if the person's Claude sign-in is
// already marked expired, notify once and list the bots whose due runs must
// wait for reconnect (Claude needs reconnecting) instead of starting.
import { CLAUDE_NEEDS_RECONNECTING, CLAUDE_SIGN_IN_EXPIRED } from "./drivers/claude-errors.ts";

/** How far ahead of a due run to warn that Claude needs reconnecting. */
export const CLAUDE_RECONNECT_AHEAD_MS = 6 * 60 * 60 * 1000;

export const CLAUDE_RECONNECT_AHEAD_DETAIL =
  `${CLAUDE_SIGN_IN_EXPIRED} Upcoming routines that use Claude will wait until you reconnect; they resume on their own after.`;

export interface ClaudeReconnectAheadRoutine {
  id: string;
  name: string;
  botId: string;
  enabled: boolean;
  suspended?: boolean;
  nextRunAt?: number | null;
  target?: string;
  runAs?: string;
}

export interface ClaudeReconnectAheadInput {
  now: number;
  routines: readonly ClaudeReconnectAheadRoutine[];
  /** True when this bot's engine is Claude (claudeAgent). */
  botUsesClaude: (botId: string) => boolean;
  /** Who pays for this bot's Claude turns (owner / runAs). */
  botPayer: (botId: string) => string | null | undefined;
  /** True when that person's Claude sign-in is marked expired. */
  claudeExpired: (principalId: string) => boolean;
  /** Principal ids already notified for this expired spell (dedupe). */
  alreadyNotified?: ReadonlySet<string>;
  /** Lead window; defaults to CLAUDE_RECONNECT_AHEAD_MS. */
  aheadMs?: number;
}

export interface ClaudeReconnectAheadResult {
  /** People to notify (once each), with the routine names that are due soon. */
  notify: Array<{ principalId: string; routineNames: string[] }>;
  /** Bot ids whose Claude is expired: their due runs must wait, not start. */
  pauseBotIds: Set<string>;
}

/** Pure scan: who to notify ahead of morning (and other) Claude routines, and
 * which bots must pause their next runs for reconnect. */
export function claudeReconnectAhead(input: ClaudeReconnectAheadInput): ClaudeReconnectAheadResult {
  const aheadMs = input.aheadMs ?? CLAUDE_RECONNECT_AHEAD_MS;
  const notified = input.alreadyNotified ?? new Set<string>();
  const byPerson = new Map<string, string[]>();
  const pauseBotIds = new Set<string>();

  for (const routine of input.routines) {
    if (!routine.enabled || routine.suspended) continue;
    if (routine.target != null && routine.target !== "bot") continue;
    const dueAt = routine.nextRunAt;
    if (dueAt == null || dueAt < input.now || dueAt - input.now > aheadMs) continue;
    if (!input.botUsesClaude(routine.botId)) continue;
    const payer = (routine.runAs?.trim() || input.botPayer(routine.botId)?.trim() || "");
    if (!payer || !input.claudeExpired(payer)) continue;
    pauseBotIds.add(routine.botId);
    const names = byPerson.get(payer) ?? [];
    names.push(routine.name);
    byPerson.set(payer, names);
  }

  const notify: ClaudeReconnectAheadResult["notify"] = [];
  for (const [principalId, routineNames] of byPerson) {
    if (notified.has(principalId)) continue;
    notify.push({ principalId, routineNames });
  }
  return { notify, pauseBotIds };
}

export { CLAUDE_NEEDS_RECONNECTING };
