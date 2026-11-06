// A bot writes to another person through a triad group chat (#2118):
// the bot's owner, the recipient, and the bot. Find an existing room with
// exactly those three, or create one, then post there. Unified chat: the
// group's main thread only. Approval (Always allow) lives on the peer gate.

const key = (id: string) => id.trim().toLowerCase();

/** The part of a group record these rules read. */
export interface MessagePersonGroupLike {
  id: string;
  name: string;
  threadId: string;
  memberIds: readonly string[];
  humanIds?: readonly string[];
  dm?: boolean;
  peopleDm?: boolean;
  archivedAt?: number;
}

/** Exact triad: owner + person as humans, this bot alone as member. */
export function isMessagePersonTriad(
  group: MessagePersonGroupLike,
  ownerId: string,
  personId: string,
  botId: string,
): boolean {
  if (group.dm || group.peopleDm || group.archivedAt) return false;
  const humans = new Set((group.humanIds ?? []).map(key).filter(Boolean));
  const bots = new Set(group.memberIds.map(key).filter(Boolean));
  const owner = key(ownerId);
  const person = key(personId);
  const bot = key(botId);
  if (!owner || !person || !bot || owner === person) return false;
  return humans.size === 2 && humans.has(owner) && humans.has(person)
    && bots.size === 1 && bots.has(bot);
}

/** The existing triad room for this owner, person and bot, if any. */
export function findMessagePersonGroup<T extends MessagePersonGroupLike>(
  groups: readonly T[],
  ownerId: string,
  personId: string,
  botId: string,
): T | undefined {
  return groups.find((group) => isMessagePersonTriad(group, ownerId, personId, botId));
}

export const MESSAGE_PERSON_MAX_CHARS = 4_000;
