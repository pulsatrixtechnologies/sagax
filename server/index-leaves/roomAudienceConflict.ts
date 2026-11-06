// @ts-nocheck
/** roomAudienceConflict (#1388). Pure move from server/index.ts. */
import { sameAudience } from "../bots/bot-visibility.ts";
export type Host = Record<string, any>;

export function createRoomAudienceConflict(getHost: () => Host): any {
function roomAudienceConflict(memberIds: readonly string[], existing: readonly string[] = []) {
  const host = getHost();

  const members = memberIds.flatMap((id) => {
    const bot = host.store.bot(id);
    return bot ? [bot] : [];
  });
  for (const added of members.filter((bot) => !existing.includes(bot.id))) {
    const other = members.find((bot) => bot.id !== added.id && !sameAudience(bot.visibility, added.visibility));
    if (other) {
      return `Bots in one room must be visible to the same people. ${added.name} and ${other.name} are not: give them the same visibility first, or use separate rooms.`;
    }
  }
  return null;

}
  return roomAudienceConflict;
}
