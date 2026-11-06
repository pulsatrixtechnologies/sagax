// Whether a room member can take its turn in a room thread now (#2382).
//
// "busy" means a turn of the bot is really at work somewhere else (another
// room turn, or one of its own conversations working), or another room
// thread holds it (room-member-lock.ts). A conversation waiting on a
// person's answer is not work: before #2382 the whole-bot `bot.busy` fold
// counted it, so a bot waiting on someone in one conversation said it was
// finishing another conversation in every room, then was skipped.

import type { RoomMemberLock } from "./room-member-lock.ts";

export type GroupMemberBotAvailability = "ready" | "busy" | "unavailable" | "cancelled" | "timed_out";

export interface RoomMemberAvailabilityStore {
  bot(botId: string): { hidden?: boolean } | null | undefined;
  busyForRoom(botId: string): boolean;
}

export interface RoomMemberOperation {
  threadId: string;
  cancelled?: boolean;
  cancellation: { signal: AbortSignal };
}

export function roomMemberAvailability(
  store: RoomMemberAvailabilityStore,
  lock: Pick<RoomMemberLock, "heldElsewhere">,
  botId: string,
  operation: RoomMemberOperation,
): GroupMemberBotAvailability {
  if (operation.cancelled || operation.cancellation.signal.aborted) return "cancelled";
  const bot = store.bot(botId);
  if (!bot || bot.hidden) return "unavailable";
  if (store.busyForRoom(botId) || lock.heldElsewhere(botId, operation.threadId)) return "busy";
  return "ready";
}
