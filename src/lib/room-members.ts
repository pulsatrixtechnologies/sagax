// Turning a set of ticked bots back into a room's ordered roster. Existing
// members keep their order, so the room's lead does not move when someone new
// joins; additions land at the end, in the order the picker listed them.
export function nextMemberIds(current: string[], picked: Set<string>, order: string[]): string[] {
  return [...current.filter((id) => picked.has(id)), ...order.filter((id) => picked.has(id) && !current.includes(id))];
}

const norm = (id: string) => id.trim().toLowerCase();

// The same for a room's people: who stays keeps their place, additions land
// at the end. Ids compare lowercased (emails, principal ids), as the server
// stores them.
export function nextHumanIds(current: readonly string[], picked: ReadonlySet<string>, added: readonly string[]): string[] {
  const seen = new Set<string>();
  const keep = (id: string) => {
    const entry = norm(id);
    if (!entry || seen.has(entry) || !picked.has(entry)) return false;
    seen.add(entry);
    return true;
  };
  return [...current.map(norm).filter(keep), ...added.map(norm).filter(keep)];
}

// The bots one person may tick in a room's roster (#1240, #1260): the room's
// owner picks among every bot listed; anyone else only among their own
// (server/groups/group-ownership.ts). An archived bot stays listed while it is
// still a member, so it can still be taken out.
export function rosterBotChoices<T extends { id: string; hidden?: boolean; ownerUserId?: string }>(
  bots: readonly T[],
  input: { memberIds: readonly string[]; ownsRoom: boolean; actorId: string },
): T[] {
  const actor = norm(input.actorId);
  return bots.filter((bot) => {
    if (bot.hidden && !input.memberIds.includes(bot.id)) return false;
    return input.ownsRoom || (actor !== "" && norm(bot.ownerUserId ?? "") === actor);
  });
}

// Bots the room panel may still offer to add (#1240): the same set as
// rosterBotChoices, minus whoever is already in the room. A member therefore
// sees only their own bots that are not in yet; the owner sees every bot
// they may add that is not in yet.
export function addableRosterBots<T extends { id: string; hidden?: boolean; ownerUserId?: string }>(
  bots: readonly T[],
  input: { memberIds: readonly string[]; ownsRoom: boolean; actorId: string },
): T[] {
  const inRoom = new Set(input.memberIds);
  return rosterBotChoices(bots, input).filter((bot) => !inRoom.has(bot.id));
}
