// @ts-nocheck
/** inboxDestination (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createInboxDestination(getHost: () => Host): any {
function inboxDestination(bot: BotRecord, card: NonNullable<Message["card"]>) {
  const host = getHost();

  if (card.adminApproval) return "server";
  if (card.approvalScope === "local-computer") return "computer";
  if (host.approvalHostOf(bot).kind === "machine") return "computer";
  if (host.IDENTITY.kind === "perspicax") return "sandbox";
  const where = (bot as { computer?: unknown }).computer;
  if (where === "vm") return "vm";
  if (where === "cloud") return "cloud";
  if (where === "browser") return "browser";
  return "computer";

}
  return inboxDestination;
}
