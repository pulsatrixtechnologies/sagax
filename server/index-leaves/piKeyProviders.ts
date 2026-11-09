// @ts-nocheck
/** #3085: the providers whose pi models a payer can really run (their own
 * Perspicax keys, else the organization's pi keys when org-key serves them).
 * Names only, never a key value. */
import { piOrgKeyProviders } from "../config.ts";
import { piPayerProviders } from "../engines/engine-credentials.ts";
export type Host = Record<string, any>;

export function createPiKeyProviders(getHost: () => Host): any {
  /** The viewer as payer: what the picker offers them on the pi engine. */
  function forViewer(principalId: string | null | undefined, instance: { instanceId: string; driverKind: string }) {
    const host = getHost();
    if (host.IDENTITY.kind !== "perspicax") return null;
    const id = principalId?.trim().toLowerCase() ?? "";
    if (!id || !host.isPrincipalId(id)) return new Set();
    return piPayerProviders({
      identity: host.IDENTITY.kind,
      speaker: { origin: "person", principalId: id },
      owner: { principalId: id, ...host.orgPersonFacts(host.principals.byId(id)) },
      instance: { instanceId: instance.instanceId, driver: instance.driverKind, installed: host.engineInstalled(instance.instanceId), keyOnly: host.keyOnlyInstance(instance.instanceId) },
      subscriptionSignedIn: () => false,
      hasKey: (sub, provider) => host.perspicaxDirectory?.providerKeys(sub).includes(provider) ?? false,
      keyBacked: host.driverKeyBacked(host.cfg, instance.driverKind, instance.instanceId),
      hasLocalKey: (pid, driver) => host.fileKeyConfigured(host.DATA_DIR, { organization: true, principalId: pid }, driver),
      serverEngineAllowed: host.serverEngineAllowedFor,
      orgEngineAllowed: host.consoleEngineAllowed(instance.instanceId),
    }, piOrgKeyProviders(host.cfg));
  }

  /** A bot's turn payer for this speaker (its owner for a routine or when the
   * owner pays, else the speaker), resolved like a turn. */
  function forBot(bot, instance: { instanceId: string; driverKind: string }, speaker) {
    const host = getHost();
    if (host.IDENTITY.kind !== "perspicax") return null;
    return piPayerProviders(host.orgEngineInput(bot, instance, speaker), piOrgKeyProviders(host.cfg));
  }

  return { forViewer, forBot };
}
