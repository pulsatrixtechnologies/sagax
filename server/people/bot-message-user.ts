// message_user (#2118): a bot writes to one person through Sagax. The
// conversation is a group whose people are exactly the bot's owner and that
// person, with the bot in it: reused when it exists, created when it does
// not. Pure helpers; the route (server/routes/internal-message-user.ts)
// reads the store and posts.

/** A person the owner can reach, with every name they may be called by. */
export interface ReachablePerson {
  id: string;
  /** Display name first; then name, login, email. Empty entries are ignored. */
  names: readonly string[];
}

export type PersonResolution =
  | { ok: true; person: ReachablePerson }
  | { ok: false; code: "unknown_person" | "ambiguous_person" | "self"; error: string };

const key = (value: string): string => value.trim().toLocaleLowerCase();

function label(person: ReachablePerson): string {
  return person.names.find((name) => name.trim()) ?? "";
}

/** Find the person `ref` names among the reachable people: an exact id,
 * then an exact name (display name, name, login or email), then a unique
 * partial match on a name. The owner is never a target. */
export function resolveReachablePerson(ref: string, people: readonly ReachablePerson[], ownerId: string): PersonResolution {
  const wanted = key(ref);
  if (!wanted) return { ok: false, code: "unknown_person", error: "message_user needs user: the person's name." };
  const owner = key(ownerId);
  const byId = people.find((person) => key(person.id) === wanted);
  const exact = byId ? [byId] : people.filter((person) => person.names.some((name) => name.trim() && key(name) === wanted));
  const matches = exact.length ? exact : people.filter((person) => person.names.some((name) => name.trim() && key(name).includes(wanted)));
  const others = matches.filter((person) => key(person.id) !== owner);
  if (!others.length) {
    if (matches.length) return { ok: false, code: "self", error: "That is the person you work for: answer them in your reply instead." };
    return { ok: false, code: "unknown_person", error: `Nobody named "${ref.trim()}" is in your organization. Check the name with the user; do not retry with a guess.` };
  }
  if (others.length > 1) {
    const names = others.map(label).filter(Boolean).slice(0, 8).join(", ");
    return { ok: false, code: "ambiguous_person", error: `"${ref.trim()}" matches several people: ${names}. Call message_user again with the full name.` };
  }
  return { ok: true, person: others[0]! };
}

export interface BotPersonGroupCandidate {
  id: string;
  memberIds: readonly string[];
  humanIds?: readonly string[];
  dm?: boolean;
  peopleDm?: boolean;
  archivedAt?: number;
}

/** The group a bot uses to talk with one person on its owner's behalf: not
 * archived, not a direct conversation, the bot among its members, and its
 * people exactly {owner, target}. A group where this bot is the only bot
 * wins over one shared with other bots. */
export function findBotPersonGroup<G extends BotPersonGroupCandidate>(groups: readonly G[], botId: string, ownerId: string, targetId: string): G | undefined {
  const pair = new Set([key(ownerId), key(targetId)]);
  const fits = groups.filter((group) => {
    if (group.archivedAt !== undefined || group.dm || group.peopleDm) return false;
    if (!group.memberIds.includes(botId)) return false;
    const people = new Set((group.humanIds ?? []).map(key));
    return people.size === pair.size && [...pair].every((id) => people.has(id));
  });
  return fits.find((group) => group.memberIds.length === 1) ?? fits[0];
}

/** "<Owner>, <Target> et <Bot>", at most 100 characters (a group name's limit). */
export function botPersonGroupName(ownerName: string, targetName: string, botName: string): string {
  const name = `${ownerName.trim() || "Moi"}, ${targetName.trim()} et ${botName.trim()}`;
  return name.length > 100 ? `${name.slice(0, 99).trimEnd()}…` : name;
}
