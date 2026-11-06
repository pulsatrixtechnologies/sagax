// @ts-nocheck
/** reactionPersonFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReactionPersonFor(getHost: () => Host): any {
function reactionPersonFor(auth: RequestAuth) {
  const host = getHost();
  const { personDisplayName, personParticipant } = host;

  const sender = host.messageSender(auth);
  const id = personParticipant(host.actorPrincipalId(auth) || sender?.id || "");
  if (!id) return null;
  const local = auth.kind !== "session";
  const name = sender?.name || (local ? host.cfg.profile?.name?.trim() : "") || personDisplayName(host.principals.byId(id)) || "";
  return { id, kind: "person", name };

}
  return reactionPersonFor;
}
