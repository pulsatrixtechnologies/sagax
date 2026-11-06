// @ts-nocheck
/** resolveAndSendMeeting (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendMeeting(getHost: () => Host): any {
async function resolveAndSendMeeting(res: ServerResponse, auth: RequestAuth, threadId: string, requestId: string, behavior: "allow" | "deny" | "answer") {
  const host = getHost();
  const { DATA_DIR, appendDecision, isPrincipalId, json } = host;
  if (!host.meetingService.isMeetingCard(threadId, requestId)) return false;
  const principalId = host.actorPrincipalId(auth) || (host.IDENTITY.kind === "solo" ? host.localPrincipalId() : "");
  const person = principalId && isPrincipalId(principalId) ? host.principals.byId(principalId) : null;
  const result = await host.meetingService.resolve({
    threadId, requestId, behavior, principalId,
    speaker: host.voiceModeDeps.speaker(auth),
    ...(person?.name ? { personName: person.name } : {})
  });
  if (!result.claimed) return false;
  if ("status" in result) { json(res, result.status, { error: result.error, ...(result.code ? { code: result.code } : {}) }); return true; }
  if (!result.alreadySettled) {
    const bot = host.store.botByThread(threadId);
    appendDecision(DATA_DIR, {
      threadId, requestId, botId: bot?.id ?? "", botName: bot?.name, tool: "join_meeting", summary: "join a meeting as a notetaker",
      decision: result.outcome === "allowed-once" ? "user-approved" : "user-denied", source: "user"
    });
  }
  json(res, 200, { ok: true, outcome: result.outcome, alreadySettled: result.alreadySettled === true });
  return true;

}
  return resolveAndSendMeeting;
}
