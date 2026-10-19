// How full each bot's context is in a room, and when its next room turn
// should start from a fresh provider session instead.
//
// A room turn never resumes a stored session: every turn re-sends the room's
// bounded recent transcript (serializeRoomContext). What grows is a warm
// provider process the driver keeps between one bot's consecutive turns in
// the same room (Claude's idle session reuse), which re-reads that transcript
// on top of everything it already holds. Starting the turn with the existing
// `sessionReset` flag drops exactly that native backlog and nothing the room
// relies on, so it is a room's compaction: the transcript stays whole, and
// the fresh session gets the same bounded context every turn gets.
//
// Measurements live in memory on purpose. They describe a warm process, and
// warm processes do not outlive this server either.

import type { ModelCatalog } from "./contracts.ts";
import { contextWindowFor } from "./context-budget.ts";

/** Before a room turn, at or above this share of the window, start fresh. */
export const DEFAULT_ROOM_COMPACT_AT = 0.9;

export type RoomMemberContext = { tokens: number; window: number; compactRequested?: true };

/** The configured threshold as a token count for this window, or null when
 * automatic compaction is off. `roomCompactAt` reads like `compactAt`: a
 * fraction below 1, or a token count. */
export function roomCompactTokens(window: number, settings: { autoCompact?: boolean; roomCompactAt?: number } | undefined): number | null {
  if (settings?.autoCompact === false) return null;
  const at = settings?.roomCompactAt;
  const value = typeof at === "number" && Number.isFinite(at) && at > 0 ? at : DEFAULT_ROOM_COMPACT_AT;
  return value < 1 ? Math.floor(window * value) : Math.floor(value);
}

export class RoomContextTracker {
  private threads = new Map<string, Map<string, RoomMemberContext>>();

  /** A settled room turn's last model call, as the driver reported it. */
  record(threadId: string, botId: string, reading: { tokens?: number; window?: number } | undefined, model: string | undefined, catalog?: ModelCatalog): void {
    const tokens = reading?.tokens;
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return;
    const members = this.threads.get(threadId) ?? new Map<string, RoomMemberContext>();
    const previous = members.get(botId);
    members.set(botId, {
      tokens: Math.trunc(tokens),
      window: contextWindowFor(model, catalog, reading?.window),
      // A request made while the turn ran still applies to the next one.
      ...(previous?.compactRequested ? { compactRequested: true as const } : {}),
    });
    this.threads.set(threadId, members);
  }

  /** "Compact now": the bot's next turn in this room starts fresh. Returns
   * false when there is nothing measured to compact. */
  request(threadId: string, botId: string): boolean {
    const current = this.threads.get(threadId)?.get(botId);
    if (!current) return false;
    current.compactRequested = true;
    return true;
  }

  /** Every measured member of one room thread, for the wire. */
  forThread(threadId: string): Record<string, RoomMemberContext> | undefined {
    const members = this.threads.get(threadId);
    if (!members?.size) return undefined;
    return Object.fromEntries([...members].map(([botId, value]) => [botId, { ...value }]));
  }

  /** At dispatch: whether this turn starts a fresh session, and why. The
   * reading is consumed either way it fires, so one reset follows one
   * measurement; the turn records a new one when it settles. */
  takeReset(threadId: string, botId: string, settings: { autoCompact?: boolean; roomCompactAt?: number } | undefined):
    { reason: "requested" | "threshold"; percent: number } | null {
    const members = this.threads.get(threadId);
    const current = members?.get(botId);
    if (!members || !current) return null;
    const percent = Math.round((current.tokens / current.window) * 100);
    const limit = roomCompactTokens(current.window, settings);
    const reason = current.compactRequested ? "requested" : limit !== null && current.tokens >= limit ? "threshold" : null;
    if (!reason) return null;
    members.delete(botId);
    if (!members.size) this.threads.delete(threadId);
    return { reason, percent };
  }

  forget(threadId: string): void {
    this.threads.delete(threadId);
  }
}
