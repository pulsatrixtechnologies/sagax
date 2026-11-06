// @ts-nocheck
/** withCreatorListed (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWithCreatorListed(getHost: () => Host): any {
function withCreatorListed(auth: RequestAuth, body: unknown) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || auth.kind !== "session") return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const principalId = auth.session.principalId?.trim();
  if (Object.prototype.hasOwnProperty.call(body, "humanIds")) {
    // A member naming coworkers stays in the room they create.
    const named = (body as { humanIds?: unknown }).humanIds;
    // A people-only group (no bot, #1150) always lists its creator too.
    const peopleOnly = Array.isArray((body as { memberIds?: unknown }).memberIds) && (body as { memberIds: unknown[] }).memberIds.length === 0;
    if ((host.channelActorRole(auth) !== "member" && !peopleOnly) || !principalId || !Array.isArray(named)) return body;
    const listed = named.some((id) => typeof id === "string" && id.trim().toLowerCase() === principalId.toLowerCase());
    return listed ? body : { ...(body as Record<string, unknown>), humanIds: [principalId, ...named] };
  }
  return principalId ? { ...(body as Record<string, unknown>), humanIds: [principalId] } : body;

}
  return withCreatorListed;
}
