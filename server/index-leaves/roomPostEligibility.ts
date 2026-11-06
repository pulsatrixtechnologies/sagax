// @ts-nocheck
/** roomPostEligibility (#1388). Pure move from server/index.ts. */
import { coordinatorSupervises } from "../peers/peer-roster.ts";
export type Host = Record<string, any>;

export function createRoomPostEligibility(getHost: () => Host): any {
function roomPostEligibility(
  bot: BotRecord,
  group: GroupRecord,
): { ok: true } | { ok: false; status: number; error: string } {
  const host = getHost();
  const { canAccessBot } = host;

  if (group.dm) {
    return {
      ok: false,
      status: 400,
      error: "that is a one-to-one bot channel, not a room — use coordinate_bots (or ask_bot or delegate_bot where you have them) to reach a single bot"
    };
  }
  if (!group.memberIds.includes(bot.id)) {
    return { ok: false, status: 403, error: "you are not a member of that room" };
  }
  // #1098 (2026-10-27): a room of one person's bots has no section
  // boundary inside it, so its own bots post there.
  const outsider = host.oneOwnerRoom(group, bot) ? undefined : group.memberIds
    .map((id) => host.store.bot(id))
    .find((member) => member && !canAccessBot(bot, member) && !coordinatorSupervises(member, bot, host.resolveManagedNameFor(member)));
  if (outsider) {
    return {
      ok: false,
      status: 403,
      error: `that room includes @${outsider.name}, who is outside your section — tell the user what you wanted to post there instead`
    };
  }
  return { ok: true };

}
  return roomPostEligibility;
}
