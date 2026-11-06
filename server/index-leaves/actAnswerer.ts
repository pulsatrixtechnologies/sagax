// @ts-nocheck
/** actAnswerer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createActAnswerer(getHost: () => Host): any {
function actAnswerer(auth: RequestAuth) {
  const host = getHost();
  if (auth.kind === "session") {
    return {
      kind: "session",
      personKey: host.personKey(auth.session),
      sessionId: auth.session.id,
      scopes: auth.scopes,
      admin: auth.scopes.includes("admin")
    };
  }
  return auth.trust === "service" ? { kind: "service" } : { kind: "operator" };

}
  return actAnswerer;
}
