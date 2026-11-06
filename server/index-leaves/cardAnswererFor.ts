// @ts-nocheck
/** cardAnswererFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCardAnswererFor(getHost: () => Host): any {
function cardAnswererFor(auth: RequestAuth) {
  const host = getHost();

  if (auth.kind === "loopback") return auth.trust === "service" ? { kind: "worker" } : { kind: "loopback" };
  // A person is named as the organization knows them, never by email: other
  // viewers of a settled card see this name (slice 7).
  if (host.IDENTITY.kind === "perspicax") {
    const principalId = auth.session.principalId?.trim();
    const person = principalId ? host.principals.byId(principalId) : null;
    return { kind: "session", name: person?.name?.trim() || person?.login?.trim() || "Signed-in user" };
  }
  return { kind: "session", name: (auth.session.email ?? auth.session.label ?? "").trim() || "Signed-in user" };

}
  return cardAnswererFor;
}
