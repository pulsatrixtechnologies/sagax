// @ts-nocheck
/** peerSpeaker (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPeerSpeaker(getHost: () => Host): any {
function peerSpeaker(fromBotId: string, fromThreadId?: string) {
  const host = getHost();

  const principalId = fromThreadId ? host.turnSpeakerPrincipals.get(fromThreadId) : undefined;
  const routine = fromThreadId ? host.turnRoutineLineage.has(fromThreadId) : false;
  const routinePayer = routine && fromThreadId ? host.turnRoutinePayers.get(fromThreadId) : undefined;
  const routineTrigger = routine && fromThreadId ? host.routineTriggerOf(fromThreadId) : undefined;
  const sourceBot = host.store.bot(fromBotId);
  const authorization = routine && sourceBot && fromThreadId ? host.routineOwnerAuthorizationFor(sourceBot, fromThreadId) : null;
  return { origin: "peer", fromBotId, ...(principalId !== undefined ? { principalId } : {}), ...(routine ? { routine: true as const } : {}), ...(routinePayer ? { routinePayer } : {}), ...(routineTrigger ? { routineTrigger } : {}), ...(authorization ? { routineOwnerAuthorization: authorization } : {}) };

}
  return peerSpeaker;
}
