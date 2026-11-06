// @ts-nocheck
/** orgEngineInput (#1388). Pure move from server/index.ts. */
import { driverKeyBacked, DATA_DIR } from "../config.ts";
import { fileKeyConfigured } from "../engines/engine-api-keys.ts";
export type Host = Record<string, any>;

export function createOrgEngineInput(getHost: () => Host): any {
function orgEngineInput(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker, slot: LoginSlot = getHost().turnSlotFor(bot, instance)): EngineCredentialInput {
  const host = getHost();
  const ownerId = host.effectiveBotOwner(bot);
  const owner = host.principals.byId(ownerId);
  return {
    identity: host.IDENTITY.kind,
    speaker,
    peerOwnerPrincipalId: host.peerOwnerPrincipal(speaker),
    owner: { principalId: ownerId, ...host.orgPersonFacts(owner) },
    instance: { instanceId: instance.instanceId, driver: instance.driverKind, installed: host.engineInstalled(instance.instanceId), keyOnly: host.keyOnlyInstance(instance.instanceId),
      ...(host.personalProviderInstances.get(instance.instanceId) ? { keyProvider: host.personalProviderInstances.get(instance.instanceId)!.provider, personalOwner: host.personalProviderInstances.get(instance.instanceId)!.owner } : {}) },
    person: (principalId) => {
      const person = host.principals.byId(principalId);
      return person ? host.orgPersonFacts(person) : undefined;
    },
    subscriptionSignedIn: (principalId, driver, instanceId) => host.engineLogins?.signedIn(principalId, driver, slot, instanceId) ?? false,
    subscriptionExpired: (principalId, driver, instanceId) => host.engineLogins?.expired(principalId, driver, slot, instanceId) ?? false,
    hasKey: (sub, provider) => host.perspicaxDirectory?.providerKeys(sub).includes(provider) ?? false,
    keyBacked: driverKeyBacked(host.cfg, instance.driverKind, instance.instanceId),
    hasLocalKey: (principalId, driver) => fileKeyConfigured(DATA_DIR, { organization: true, principalId }, driver),
    serverEngineAllowed: host.serverEngineAllowedFor,
    payerMode: host.speakerPayerMode(bot, speaker),
    orgEngineAllowed: host.consoleEngineAllowed(instance.instanceId)
  };
}
  return orgEngineInput;
}
