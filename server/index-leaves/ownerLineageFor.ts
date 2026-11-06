// @ts-nocheck
/** ownerLineageFor (#1388). Pure move from server/index.ts. */
import { ownerLineageOrigin } from "../approvals/owner-autonomy.ts";
export type Host = Record<string, any>;

export function createOwnerLineageFor(getHost: () => Host): any {
function ownerLineageFor(bot: BotRecord, threadId: string) {
  const host = getHost();

  const speaker = host.turnSpeakers.get(threadId);
  const automation = host.directRequestOwners.get(threadId)?.automation;
  return ownerLineageOrigin({
    speaker,
    ownerPrincipalId: host.effectiveBotOwner(bot),
    ...(speaker ? { peerFromOwner: host.peerOwnerPrincipal(speaker) } : {}),
    ...(automation !== undefined ? { automation } : {}),
    unattended: automation === "webhook",
    routineAuthorized: host.routineOwnerAuthorizationFor(bot, threadId) !== null
  });

}
  return ownerLineageFor;
}
