// @ts-nocheck
/** resolveAndSendRoutine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendRoutine(getHost: () => Host): any {
function resolveAndSendRoutine(   res: ServerResponse,   args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string; actorPrincipalId?: string },   _ownersAnswer = false,   revealKey = false, ) {
  const host = getHost();
  const { DATA_DIR, appendDecision } = host;

  if (args.behavior === "allow") safetyForgetArmed(args.requestId);
  else if (args.behavior === "deny") safetyRejectArmed(args.requestId);
  const card = host.store.messagesFor(args.threadId).find(
    (message) => message.card?.requestId === args.requestId && message.card.routineRequest,
  )?.card;
  const result = host.routineRequests.resolve(args);
  if (
    result.claimed &&
    (result.state === "applied" || result.state === "denied")
  ) {
    appendDecision(DATA_DIR, {
      threadId: args.threadId,
      requestId: args.requestId,
      botId: args.botId,
      botName: args.botName,
      tool: card?.tool,
      summary: card?.subtitle,
      decision: result.state === "applied" ? "user-approved" : "user-denied",
      source: "user"
    });
  }
  return host.sendRoutineResolution(res, result, revealKey);

}
  return resolveAndSendRoutine;
}
