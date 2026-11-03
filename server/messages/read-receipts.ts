// Read receipts: who has seen a message, people and bots alike.
//
// Each thread keeps one read position per participant, `readUpTo[id] =
// { messageId, at }`, in its own small table beside the transcript
// (server/messages/message-db.ts `thread_reads`; a thread without rows has no
// receipts, so nothing to migrate). A position only moves forward.
//
// - A person's position moves when their app shows the message on screen
//   (POST /api/threads/<id>/read, sent by a focused window only). Their id
//   is their principal id.
// - A bot's position moves when its turn consumed the message: the message
//   was in the prompt or context its engine received, decided where the
//   server builds that prompt. A bot that only got a summary has not seen
//   it. Its id is `bot:<botId>`.
// - A peer bot reached through ask_bot keeps its delivery receipt
//   (server/peer-delivery.ts); this is separate.
//
// Privacy: in a conversation between two people (peopleDm), a person who
// turned off "Send read receipts" (preference `sagax.readReceipts.v1` =
// "off") shows nobody their position and sees nobody's, like iMessage.
// Rooms always show (their members chose to be there); bots always report.
// Positions are never written to the chat, the canonical event log or the
// admin audit.

export interface ReadPosition {
  messageId: string;
  at: number;
}

export type ReadMap = Record<string, ReadPosition>;

export const READ_RECEIPTS_PREFERENCE = "sagax.readReceipts.v1";
const BOT_PREFIX = "bot:";

export function botParticipant(botId: string): string {
  return `${BOT_PREFIX}${botId}`;
}

export function isBotParticipant(participantId: string): boolean {
  return participantId.startsWith(BOT_PREFIX);
}

/** A person's id as positions key it. */
export function personParticipant(principalId: string): string {
  return principalId.trim().toLowerCase();
}

/** Whether a person sends (and so sees) read receipts: on unless they
 * stored "off". */
export function sendsReadReceipts(preference: string | undefined): boolean {
  return preference !== "off";
}

/** Whether moving `current` to `messageId` is a move forward in the thread.
 * `order` gives a message's place in the stored thread (undefined: not in
 * it). An unknown message never moves anything. */
export function advancesPosition(
  current: ReadPosition | undefined,
  messageId: string,
  order: (messageId: string) => number | undefined,
): boolean {
  const next = order(messageId);
  if (next === undefined) return false;
  if (!current) return true;
  if (current.messageId === messageId) return false;
  const was = order(current.messageId);
  // A position on a message that is gone (a deleted branch) yields.
  return was === undefined || next > was;
}

/** The newest of `ids` in thread order, or null. */
export function newestOf(ids: Iterable<string>, order: (messageId: string) => number | undefined): string | null {
  let best: string | null = null;
  let bestAt = -1;
  for (const id of ids) {
    const at = order(id);
    if (at !== undefined && at > bestAt) {
      best = id;
      bestAt = at;
    }
  }
  return best;
}

/** What one viewer may see of a thread's positions. In a conversation
 * between two people both sides must send receipts for either to see the
 * other's: a viewer who turned them off sees none, and a person who turned
 * them off is shown to nobody. Elsewhere everything shows. */
export function readsVisibleTo(input: {
  reads: ReadMap;
  peopleDm: boolean;
  viewerId: string | undefined;
  sendsReceipts: (personId: string) => boolean;
}): ReadMap {
  if (!input.peopleDm) return input.reads;
  const viewer = input.viewerId ? personParticipant(input.viewerId) : "";
  if (!viewer || !input.sendsReceipts(viewer)) return {};
  const out: ReadMap = {};
  for (const [id, position] of Object.entries(input.reads)) {
    if (isBotParticipant(id) || id === viewer || input.sendsReceipts(id)) out[id] = position;
  }
  return out;
}

/** Whether a single position may reach a viewer's live stream (the
 * `thread.read` frame), by the same rule as readsVisibleTo. */
export function readVisibleTo(input: {
  participantId: string;
  peopleDm: boolean;
  viewerId: string | undefined;
  sendsReceipts: (personId: string) => boolean;
}): boolean {
  const shown = readsVisibleTo({
    reads: { [input.participantId]: { messageId: "", at: 0 } },
    peopleDm: input.peopleDm,
    viewerId: input.viewerId,
    sendsReceipts: input.sendsReceipts,
  });
  return Object.hasOwn(shown, input.participantId);
}

/** Who may move a position on a room: a person listed in it, or its owner
 * or creator. Anyone else who can open the room (an admin moderating) reads
 * it without leaving a receipt. */
export function roomReceiptMember(
  room: { humanIds?: string[]; ownerId?: string | null; createdBy?: string },
  viewerId: string,
): boolean {
  const viewer = personParticipant(viewerId);
  if (!viewer) return false;
  if ((room.humanIds ?? []).some((id) => personParticipant(id) === viewer)) return true;
  return [room.ownerId, room.createdBy].some((id) => typeof id === "string" && personParticipant(id) === viewer);
}
