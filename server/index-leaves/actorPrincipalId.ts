// @ts-nocheck
/** actorPrincipalId (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createActorPrincipalId(getHost: () => Host): any {
function actorPrincipalId(auth: RequestAuth) {
  const host = getHost();
  const { channelViewerId } = host;

  if (auth.kind === "session") {
    const viewerId = channelViewerId(auth) ?? "";
    return viewerId.startsWith("anon:") ? "" : viewerId;
  }
  if (auth.kind === "loopback" && auth.trust === "service") return "";
  return host.localPrincipalId();

}
  return actorPrincipalId;
}
