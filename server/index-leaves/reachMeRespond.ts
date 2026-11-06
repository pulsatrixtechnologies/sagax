// @ts-nocheck
/** reachMeRespond (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReachMeRespond(getHost: () => Host): any {
async function reachMeRespond(person: string, card: ReachCard, body: ReachRespondBody, channel: ReachChannelId): Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();

  let actor: PerformActor = { kind: "operator" };
  if (host.IDENTITY.kind === "perspicax") {
    const live = host.sessions.liveWhere((session) => host.personKey(session) === person);
    const picked = live.find((session) => session.scopes.includes("admin")) ?? live[0];
    if (!picked) return { status: 403, body: { error: "The person has no live session on this server: they answer in Sagax." } };
    actor = { kind: "person", sessionId: picked.id, personKey: person, scopes: picked.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client") };
  }
  const confirmed = { personKey: actor.kind === "person" ? actor.personKey : null, classes: [] as string[], reachMe: { channel } };
  const target = { kind: "route" as const, method: "POST", path: `/api/threads/${card.threadId}/respond`, body: { requestId: card.requestId, ...body } };
  const answer = host.store.isConfidentialThread(card.threadId)
    ? await host.performBotActRoute(actor, target, 8000, { onBehalf: true, continuation: card.threadId, continuationExact: true, confirmed })
    : await host.performBotActRouteOutsideConfidential(actor, target, confirmed);
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(answer.text) as Record<string, unknown>; } catch { parsed = {}; }
  return { status: answer.status, body: answer.status >= 400 ? { error: String(parsed.error ?? "The answer was refused.") } : parsed };

}
  return reachMeRespond;
}
