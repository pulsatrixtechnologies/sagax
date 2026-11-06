// @ts-nocheck
/** personPaysEngine (#1388). Pure move from server/index.ts. */
import { paidByPerson } from "../engines/engine-credentials.ts";
export type Host = Record<string, any>;

export function createPersonPaysEngine(getHost: () => Host): any {
function personPaysEngine(principalId: string, instanceId: string) {
  const host = getHost();
  const { DATA_DIR, isPrincipalId, orgPersonFacts, resolveEngineAccess } = host;
  if (host.IDENTITY.kind !== "perspicax") return false;
  const id = principalId.trim().toLowerCase();
  if (!id || !isPrincipalId(id)) return false;
  const entry = host.registry.entries().find((candidate) => candidate.instanceId === instanceId);
  const driverKind = entry?.shadow?.driverKind ?? entry?.live?.driverKind ?? "";
  if (!driverKind) return false;
  const person = host.principals.byId(id);
  return paidByPerson(resolveEngineAccess({
    identity: host.IDENTITY.kind,
    speaker: { origin: "person", principalId: id },
    owner: { principalId: id, ...orgPersonFacts(person) },
    instance: { instanceId, driver: driverKind, installed: host.engineInstalled(instanceId),
      ...(host.personalProviderInstances.get(instanceId) ? { keyOnly: true, keyProvider: host.personalProviderInstances.get(instanceId)!.provider, personalOwner: host.personalProviderInstances.get(instanceId)!.owner } : {}) },
    subscriptionSignedIn: (pid, driver) => host.engineLogins?.signedIn(pid, driver) ?? false,
    subscriptionExpired: (pid, driver) => host.engineLogins?.expired(pid, driver) ?? false,
    hasKey: (sub, provider) => host.perspicaxDirectory?.providerKeys(sub).includes(provider) ?? false,
    keyBacked: false,
    hasLocalKey: (pid, driver) => host.fileKeyConfigured(DATA_DIR, { organization: true, principalId: pid }, driver)
  }));

}
  return personPaysEngine;
}
