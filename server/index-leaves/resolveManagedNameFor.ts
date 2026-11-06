// @ts-nocheck
/** resolveManagedNameFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveManagedNameFor(getHost: () => Host): any {
function resolveManagedNameFor(bot: { ownerUserId?: string } | null | undefined) {
  const host = getHost();

  if (!host.sectionChannels || !bot) return undefined;
  const owner = host.effectiveBotOwner(bot);
  if (!owner) return undefined;
  return (name: string) => host.sectionChannels.byNameForOwner(name, owner)?.id ?? null;

}
  return resolveManagedNameFor;
}
