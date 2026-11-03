/**
 * Who reaches a scheduled call (#1482). A call is a room session with some
 * bots: a member sees, changes, opens or deletes a call when they may run
 * every bot in it (the same right as scheduling a routine for that bot), and
 * creates one with such bots only. A call on a bot they can see but not run
 * is someone else's: it answers like a missing call, its words never shown
 * (authorization matrix, 2026-10-29). An admin reaches everything.
 */
import type { CalendarCall } from "./calendar-calls.ts";

export interface CalendarCallAccess {
  /** An admin, or the owner at this computer. Not VisibleSet.everything,
   * which is also true for a member when no bot is restricted. */
  everything: boolean;
  /** The caller can see this bot. */
  botVisible: (botId: string) => boolean;
  /** The caller lacks the right to run this bot's routines. */
  needsRun: (botId: string) => boolean;
}

export type CalendarCallRefusal =
  | { status: 404; body: { error: string } }
  | { status: 403; body: { error: string; code: string } };

/** The calls this caller may see: every bot in the call visible to them,
 * and theirs to run. */
export function visibleCalendarCalls(calls: readonly CalendarCall[], access: CalendarCallAccess): CalendarCall[] {
  if (access.everything) return [...calls];
  return calls.filter((call) => call.botIds.every((botId) => access.botVisible(botId) && !access.needsRun(botId)));
}

function botIdsOf(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const botIds = (body as { botIds?: unknown }).botIds;
  return Array.isArray(botIds) ? botIds.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Why this caller may not write a call with these bots: the bots of the
 * existing call (an edit, a delete, opening its room) and those the body
 * asks for. A hidden bot answers like a missing call; a visible bot the
 * caller may not run answers 403.
 */
export function calendarCallRefusal(
  access: CalendarCallAccess,
  existing: Pick<CalendarCall, "botIds"> | null,
  body?: unknown,
): CalendarCallRefusal | null {
  if (access.everything) return null;
  const existingIds = existing?.botIds ?? [];
  if (existingIds.some((botId) => !access.botVisible(botId) || access.needsRun(botId))) {
    return { status: 404, body: { error: "no such scheduled call" } };
  }
  const requested = botIdsOf(body);
  if (requested.some((botId) => !access.botVisible(botId))) {
    return { status: 404, body: { error: "no such bot" } };
  }
  if (requested.some((botId) => access.needsRun(botId))) {
    return { status: 403, body: { error: "you need the right to run every bot in this call", code: "needs_run" } };
  }
  return null;
}
