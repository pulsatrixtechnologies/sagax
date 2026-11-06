// @ts-nocheck
/** usageTriggerFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUsageTriggerFor(getHost: () => Host): any {
function usageTriggerFor(auth: RequestAuth) {
  const host = getHost();

  // Slice 7: an organization session names its person by principal id (it
  // carries no email), so the admin usage can attribute the turn.
  const principalId = auth.kind === "session" && host.IDENTITY.kind === "perspicax" ? auth.session.principalId?.trim() : undefined;
  return auth.kind === "session"
    ? { kind: "user", ...(auth.session.email ? { email: auth.session.email } : {}), label: auth.session.label, ...(principalId ? { principalId } : {}) }
    : { kind: "owner" };

}
  return usageTriggerFor;
}
