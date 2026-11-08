// @ts-nocheck
/** actTurnFacts (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

/** The person a routine or webhook turn acts for: the payer recorded for its
 * lineage, else the bot's owner. A routine always runs with its owner's
 * identity and credentials, so it never lands without someone to act for. */
export function routineOwnerFor(host: Host, threadId: string): string | null {
  const payer = host.turnRoutineLineage?.has(threadId) ? host.turnRoutinePayers?.get(threadId)?.trim() : "";
  if (payer) return payer;
  const bot = host.store?.botByThread?.(threadId);
  if (!bot) return null;
  const owner = typeof host.effectiveBotOwner === "function" ? String(host.effectiveBotOwner(bot) ?? "").trim() : "";
  return owner || null;
}

export function createActTurnFacts(getHost: () => Host): any {
function actTurnFacts(threadId: string, generation: string) {
  const host = getHost();
  const { provenRequestPerson } = host;

  const request = host.directRequestOwners.get(threadId);
  const message = request?.messageId
    ? host.store.messagesFor(threadId).find((row) => row.id === request.messageId)
    : undefined;
  const provenPerson = provenRequestPerson(request, generation, (messageId) =>
    host.linePersonKey(host.store.messagesFor(threadId).find((row) => row.id === messageId)));
  const rawSender = message?.role === "user" && typeof message.sender?.id === "string" && message.sender.id
    ? message.sender.id
    : undefined;
  return {
    automation: Boolean(request?.automation),
    guest: host.guestDrivenTurns.get(threadId) === generation,
    requestUsable: Boolean(request?.messageId) && request?.stopped !== true && Boolean(request?.generations.has(generation)),
    senderUnproven: Boolean(rawSender) && provenPerson === null,
    provenPerson,
    // #2701: a routine acts for the owner whose credentials it runs on
    routineOwner: request?.automation ? routineOwnerFor(host, threadId) : null,
    sharedServer: host.LOOPBACK.trust === "service" || host.IDENTITY.kind === "perspicax" || host.HOSTED_WORKSPACE
  };

}
  return actTurnFacts;
}
