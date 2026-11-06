// @ts-nocheck
/** serverEngineAllowedFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createServerEngineAllowedFor(getHost: () => Host): any {
function serverEngineAllowedFor(principalId: string, instanceId: string) {
  const host = getHost();
  const { isPrincipalId } = host;

  if (host.IDENTITY.kind !== "perspicax") return true;
  if (!principalId || !isPrincipalId(principalId)) return false;
  const person = host.principals.byId(principalId);
  if (!person) return false;
  if (person.local === true) return true;
  const sub = person.subject?.iss === host.IDENTITY.issuer ? person.subject.sub : undefined;
  const list = sub ? host.perspicaxDirectory?.serverEngines(sub) ?? null : null;
  if (list === null) {
    if (!host.serverEnginesUnknownLogged.has(principalId)) {
      host.serverEnginesUnknownLogged.add(principalId);
      console.warn(`[perspicax] no sagax_server_engines for ${principalId}: no engine on the organization's accounts until Perspicax sends the list`);
    }
    return false;
  }
  return list.includes("*") || list.includes(instanceId);

}
  return serverEngineAllowedFor;
}
