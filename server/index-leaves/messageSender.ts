// @ts-nocheck
/** messageSender (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMessageSender(getHost: () => Host): any {
function messageSender(auth: RequestAuth) {
  const host = getHost();
  const { personDisplayName } = host;

  if (auth.kind !== "session") return undefined;
  // Organization mode shows no email: the person reads as their provider
  // display name, then their login.
  if (host.IDENTITY.kind === "perspicax") {
    const person = auth.session.principalId ? host.principals.byId(auth.session.principalId) : null;
    const orgName = (personDisplayName(person) || auth.session.label?.trim() || "");
    return orgName ? { name: orgName, id: host.personKey(auth.session) } : undefined;
  }
  const name = (auth.session.email ?? auth.session.label ?? "").trim();
  return name ? { name, id: host.actorKey(auth) } : undefined;

}
  return messageSender;
}
