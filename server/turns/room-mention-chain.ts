import { canAccessBot, type RosterMember } from "../peers/peer-roster.ts";
import type { GroupDefaultResponder } from "../../shared/wire.ts";

type Responders = <T extends { id: string; name: string; hidden?: boolean }>(
  text: string,
  members: T[],
  defaultResponder: GroupDefaultResponder,
) => T[];

/** The room members a bot's reply summons with its @mentions (one hop).
 * A bot never starts a turn of another person's bot (#3263): a member the
 * speaker cannot access is skipped, even in a room that holds bots of two
 * people. Only the person check applies here, never the speaker's peer list.
 * A mention written by a person goes through roomResponders directly. */
export function chainedMentionResponders<T extends RosterMember>(
  replyText: string,
  members: T[],
  speaker: RosterMember,
  roomResponders: Responders,
): T[] {
  return roomResponders(replyText, members, { kind: "mentions" }).filter((next) => canAccessBot(speaker, next));
}
