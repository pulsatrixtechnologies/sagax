// @ts-nocheck
/** cloudComputerHolders (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCloudComputerHolders(getHost: () => Host): any {
async function cloudComputerHolders(botId: string) {
  const host = getHost();

  try {
    const listed = await host.boat.listManagedBoats(host.cfg, host.managedBoatOwners(), { adoptLegacy: false });
    return [...new Set(listed.instances
      .filter((instance) => instance.ownerBotId && instance.ownerBotId !== botId && instance.ownerName)
      .map((instance) => instance.ownerName!))];
  } catch {
    return [];
  }

}
  return cloudComputerHolders;
}
