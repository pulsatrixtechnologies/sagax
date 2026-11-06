// @ts-nocheck
/** delegatedLevel (#1388). Pure move from server/index.ts. */
import { delegatedApprovalMode } from "../approvals/auto-approve.ts";
export type Host = Record<string, any>;

export function createDelegatedLevel(getHost: () => Host): any {
function delegatedLevel(from: BotRecord, fromThreadId: string, target: BotRecord, recipientMode: ApprovalMode) {
  const host = getHost();

  return delegatedApprovalMode({
    senderIsChief: Boolean(from.chiefOfStaff),
    senderMode: host.sourceApprovalMode(from.id, fromThreadId),
    sameBot: from.id === target.id,
    recipientMode,
    recipientDriverKind: host.registry.cliTarget(target.modelSelection.instanceId)?.driverKind,
    // Organization server: only a bot whose owner allowed Full access (and
    // while the organization allows it) inherits a Primary Bot's Full.
    recipientMemberOwned: host.orgDeniesFull(target)
  });

}
  return delegatedLevel;
}
