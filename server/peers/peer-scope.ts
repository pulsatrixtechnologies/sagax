// Which bots a bot may reach on an organization server, before sections and
// its own peer list are read (peer-roster.ts). Sections there are each
// person's own folders and the server never writes bot.section, so the
// section rule alone put every person's bots in one "General" team: a bot
// was told about, and could ask, bots its owner cannot see.
//
// The rule: a bot reaches the bots of its own owner and the bots shared with
// that owner (any level), the same bots the owner sees in the sidebar. A
// room keeps its own rule (its members were added by people), see
// roomHandoffProblem in index.ts.

export interface PeerScopeDeps<T> {
  /** The bot's owner, as index.ts decides it (effectiveBotOwner). */
  ownerOf(bot: T): string;
  /** Whether this person holds a level on the bot (owned or shared). */
  personSeesBot(principalId: string, bot: T): boolean;
}

const key = (value: string) => value.trim().toLowerCase();

export function orgPeerInScope<T>(from: T, target: T, deps: PeerScopeDeps<T>): boolean {
  const owner = key(deps.ownerOf(from));
  if (!owner) return false;
  if (owner === key(deps.ownerOf(target))) return true;
  return deps.personSeesBot(owner, target);
}
