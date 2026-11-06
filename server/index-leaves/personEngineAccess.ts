// @ts-nocheck
/** personEngineAccess (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersonEngineAccess(getHost: () => Host): any {
function personEngineAccess(principalId: string): Array<{ id: string; via: EngineVia; signedIn: boolean; key: boolean }> {
  const host = getHost();
  const { driverKeyBacked, isLoginDriver, providersOfInstance } = host;
  const person = host.principals.byId(principalId);
  const sub = host.IDENTITY.kind === "perspicax" && person?.subject?.iss === host.IDENTITY.issuer ? person.subject.sub : undefined;
  const held = sub ? host.perspicaxDirectory?.providerKeys(sub) ?? [] : [];
  return host.registry.entries().map((entry) => {
    const driver = entry.shadow?.driverKind ?? entry.live?.driverKind ?? "";
    // #1533: an API-key engine never runs on a subscription
    const signedIn = Boolean(host.engineLogins && isLoginDriver(driver) && !host.keyOnlyInstance(entry.instanceId) && host.engineLogins.signedIn(principalId, driver));
    const key = providersOfInstance(entry.instanceId, driver).some((provider) => held.includes(provider));
    const orgKey = driverKeyBacked(host.cfg, driver, entry.instanceId);
    const off = !host.engineInstalled(entry.instanceId) || person?.disabledAt !== undefined || Boolean(person?.consoleDisabled);
    const via: EngineVia = off ? "none" : signedIn ? "subscription" : key ? "key" : orgKey ? "org-key" : "none";
    return { id: entry.instanceId, via, signedIn, key };
  });

}
  return personEngineAccess;
}
