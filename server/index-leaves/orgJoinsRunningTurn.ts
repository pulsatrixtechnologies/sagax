// @ts-nocheck
/** orgJoinsRunningTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgJoinsRunningTurn(getHost: () => Host): any {
function orgJoinsRunningTurn(bot: { ownerUserId?: unknown }, threadId: string, speaker: TurnSpeaker) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return true;
  const running = host.turnSpeakerPrincipals.get(threadId);
  const joining = host.orgSpeakerPrincipal(bot, speaker);
  // a routine's words never fold into a person's turn, nor theirs into a
  // routine's: each keeps the Perspicax access it was admitted with
  if (host.routineLineage(speaker) !== host.turnRoutineLineage.has(threadId)) return false;
  return Boolean(running) && running === joining;

}
  return orgJoinsRunningTurn;
}
