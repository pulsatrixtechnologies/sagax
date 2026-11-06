// @ts-nocheck
/** personRunsEngine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersonRunsEngine(getHost: () => Host): any {
function personRunsEngine(principalId: string | null | undefined, instance: SelectableInstance) {
  const host = getHost();
  const { DATA_DIR, driverKeyBacked, isPrincipalId, orgPersonFacts, resolveEngineAccess } = host;
  if (host.IDENTITY.kind !== "perspicax") return true;
  const id = principalId?.trim().toLowerCase() ?? "";
  if (!id || !isPrincipalId(id)) return false;
  if (host.piLocalModel({ instanceId: instance.instanceId, model: instance.models.default })) return true;
  return resolveEngineAccess({
    identity: host.IDENTITY.kind,
    speaker: { origin: "person", principalId: id },
    owner: { principalId: id, ...orgPersonFacts(host.principals.byId(id)) },
    instance: { instanceId: instance.instanceId, driver: instance.driverKind, installed: host.engineInstalled(instance.instanceId), keyOnly: host.keyOnlyInstance(instance.instanceId),
      ...(host.personalProviderInstances.get(instance.instanceId) ? { keyProvider: host.personalProviderInstances.get(instance.instanceId)!.provider, personalOwner: host.personalProviderInstances.get(instance.instanceId)!.owner } : {}) },
    subscriptionSignedIn: (pid, driver) => host.engineLogins?.signedIn(pid, driver) ?? false,
    subscriptionExpired: (pid, driver) => host.engineLogins?.expired(pid, driver) ?? false,
    hasKey: (sub, provider) => host.perspicaxDirectory?.providerKeys(sub).includes(provider) ?? false,
    keyBacked: driverKeyBacked(host.cfg, instance.driverKind, instance.instanceId),
    hasLocalKey: (pid, driver) => host.fileKeyConfigured(DATA_DIR, { organization: true, principalId: pid }, driver),
    serverEngineAllowed: host.serverEngineAllowedFor,
    orgEngineAllowed: host.consoleEngineAllowed(instance.instanceId)
  }).ok;

}
  return personRunsEngine;
}
