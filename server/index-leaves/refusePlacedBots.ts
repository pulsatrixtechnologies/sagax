// @ts-nocheck
/** refusePlacedBots (#1388). Pure move from server/index.ts. */
import { canPlaceBot, ownerUserIdForPlacement } from "../rooms/channel-membership.ts";
export type Host = Record<string, any>;

export function createRefusePlacedBots(getHost: () => Host): any {
function refusePlacedBots(auth: RequestAuth, botIds: readonly unknown[], already: ReadonlySet<string>) {
  const host = getHost();

  const actorId = host.channelActorId(auth);
  for (const id of botIds) {
    if (typeof id !== "string" || already.has(id)) continue;
    const bot = typeof id === "string" ? host.store.bot(id) : undefined;
    const ownerUserId = bot
      ? host.effectiveBotOwner(bot)
      : ownerUserIdForPlacement({ localOperatorId: host.localPrincipalId() });
    if (!canPlaceBot({ actorId, ownerUserId })) {
      return "forbidden: only the bot owner can place it in a channel";
    }
  }
  return null;

}
  return refusePlacedBots;
}
