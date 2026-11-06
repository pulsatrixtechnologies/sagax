// @ts-nocheck
/** cardAnswerRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCardAnswerRefusal(getHost: () => Host): any {
function cardAnswerRefusal(auth: RequestAuth, threadId: string, requestId: string, behavior: string) {
  const host = getHost();
  const { channelViewerId } = host;

  if (auth.kind === "loopback") {
    return auth.trust === "service" && behavior !== "deny"
      ? "A local service can only decline this request. Approve or answer it in Sagax while signed in."
      : null;
  }
  const teamMemoryCard = host.store.messagesFor(threadId).find((message) =>
    message.card?.requestId === requestId && message.card.teamMemoryRequest);
  if (teamMemoryCard?.card?.teamMemoryRequest) {
    return host.teamMemoryReviewRefusal({
      admin: auth.scopes.includes("admin"),
      shared: host.teamMemoryShared(),
      memberOfSection: host.personMayUseTeamSection(auth, teamMemoryCard.card.teamMemoryRequest.section)
        && host.teamMemoryContextAllows(threadId, teamMemoryCard.from?.botId, channelViewerId(auth))
    });
  }
  if (auth.scopes.includes("admin") || !host.sharedMembership()) return null;
  const known = [host.threadStarters.get(threadId), host.cardRequesterKey(threadId, requestId)].filter((person): person is string => Boolean(person));
  if (!known.length || known.includes(host.personKey(auth.session)) || known.includes(host.legacyPersonKey(auth.session))) return null;
  return "Only the person who started this conversation or sent this request, or a workspace admin, can answer this card.";

}
  return cardAnswerRefusal;
}
