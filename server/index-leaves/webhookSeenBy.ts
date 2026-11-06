// @ts-nocheck
/** webhookSeenBy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWebhookSeenBy(getHost: () => Host): any {
function webhookSeenBy(botId: unknown, viewerId: string) {
  const host = getHost();
  const { atLeast, botFacts, botLevel } = host;
  if (typeof botId !== "string") return false;
  const bot = host.store.bot(botId);
  if (!bot) return false;
  const viewer = host.authzViewerFromId(viewerId);
  if (!viewer) return false;
  if (viewer.orgAdmin) return true;
  if (!host.listedBotVisible(bot, viewerId)) return false;
  const level = botLevel({ viewer, ...botFacts(bot) });
  return level === "owner" || atLeast(level, "run");

}
  return webhookSeenBy;
}
