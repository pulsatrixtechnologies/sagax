// @ts-nocheck
/** instancesForViewer (#1388). Pure move from server/index.ts. */
import { isCompatServerId } from "../config.ts";
import { withoutRefusedModels } from "../models/model-access-refusals.ts";
import { filterPiCatalogByProviders } from "../drivers/pi-key-filter.ts";
export type Host = Record<string, any>;

export function createInstancesForViewer(getHost: () => Host): any {
async function instancesForViewer(person: string | null) {
  const host = getHost();

  const owner = host.providerAccountOwner(person);
  if (owner !== null) await host.syncPersonalProviders(owner).catch(host.reportBackgroundError);
  // #1450: a model the paying account turned off is not offered again for a while
  const compatViewer = host.IDENTITY.kind === "perspicax"
    ? { principalId: person, admin: false }
    : undefined;
  const instances = withoutRefusedModels(await host.describeInstances(), (instanceId) => host.refusedModelsFor(person, instanceId))
    .filter((instance) => host.personalProviderInstances.visible(instance.instanceId, host.IDENTITY.kind === "perspicax" ? person ?? "" : "solo"))
    // #2054: a named OpenAI-compatible server owned by someone else stays out
    // of this viewer's picker (org-wide servers have no owner and stay).
    .filter((instance) => {
      if (!compatViewer || !isCompatServerId(instance.instanceId)) return true;
      return host.compatServerVisible(host.compatServerOwner(host.cfg.openaiCompatServers, instance.instanceId), compatViewer);
    })
    .map((instance) => {
      const account = host.personalProviderInstances.get(instance.instanceId);
      return account ? { ...instance, access: "api" as const, providerAccount: { provider: account.provider, serverId: account.serverId } } : instance;
    });
  // #2983: solo, pi lists the server's own model servers
  if (host.IDENTITY.kind !== "perspicax") return host.overlayModelServers(instances, await host.piModelServersForViewer(null).catch(() => []));
  // #2024: pi lists the viewer's Perspicax model servers with their thinking levels
  // #3085: pi offers only the providers the viewer's keys (or the
  // organization's, when org-key serves them) really pay for
  const keyed = host.orgOfferedEngines(instances, person).map((instance) => instance.driverKind === "piAgent"
    ? { ...instance, models: filterPiCatalogByProviders(instance.models, host.piKeyProviders.forViewer(person, instance)) }
    : instance);
  const served = host.overlayModelServers(keyed, await host.piModelServersForViewer(person).catch(() => []));
  return host.desktopLocalModels.overlay(served, person);

}
  return instancesForViewer;
}
