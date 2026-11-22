// @ts-nocheck
/** withCreatorListed (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWithCreatorListed(getHost: () => Host): any {
function withCreatorListed(auth: RequestAuth, body: unknown) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return body;
  // #5152: on an organization server everyone sees their own rooms only, the
  // operator at this computer included (channelFilterViewer): whoever creates
  // a room stays in it, whatever their role (they may leave it after), or
  // nobody would see the room they just made
  const operatorAtComputer = auth.kind === "loopback" && auth.trust !== "service";
  if (auth.kind !== "session" && !operatorAtComputer) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : host.localPrincipalId();
  if (!principalId) return body;
  if (Object.prototype.hasOwnProperty.call(body, "humanIds")) {
    const named = (body as { humanIds?: unknown }).humanIds;
    if (!Array.isArray(named)) return body;
    const listed = named.some((id) => typeof id === "string" && id.trim().toLowerCase() === principalId.toLowerCase());
    return listed ? body : { ...(body as Record<string, unknown>), humanIds: [principalId, ...named] };
  }
  return { ...(body as Record<string, unknown>), humanIds: [principalId] };

}
  return withCreatorListed;
}
