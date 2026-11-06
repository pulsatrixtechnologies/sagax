// @ts-nocheck
/** roomTurnApprovalMode (#1388). Pure move from server/index.ts. */
import { memberRoomTurnLevel } from "../approvals/member-auto-approval.ts";
export type Host = Record<string, any>;

export function createRoomTurnApprovalMode(getHost: () => Host): any {
function roomTurnApprovalMode(bot: BotRecord, threadId: string, orchestration?: GroupTurnOrchestration) {
  const host = getHost();
  const { memberAutoApprovalAllowed } = host;

  // On a Cloud home a room turn a guest drives runs in Ask (cloudGuestDriven).
  if (host.cloudGuestDriven(threadId)) return "ask";
  const handoff = orchestration?.roomHandoffId ? host.coordinator.node(orchestration.roomHandoffId) : undefined;
  const source = handoff?.parentId ? host.coordinator.node(handoff.parentId) : undefined;
  const from = source ? host.store.bot(source.botId) : undefined;
  // On an organization server a bot runs Full, even for a Primary Bot's
  // handoff, only when its owner allowed it and the organization does.
  if (host.memberOwnedInOrg(bot) && host.orgDeniesFull(bot)) return "ask";
  const own = host.approvalModeForTurn(bot, Boolean(orchestration?.roomHandoffId), threadId);
  const level = (from && source && host.delegatedLevel(from, source.threadId, bot, own)) || own;
  // A member's bot: a Primary Bot's handoff never lifts it past what the
  // organization allows members' bots (member-auto-approval.ts): Custom
  // stays Ask, and Auto or Auto-accept edits run as Ask while an admin has
  // turned organization.memberAutoApproval off (2026-10-17, review of #688).
  if (host.memberOwnedInOrg(bot)) return memberRoomTurnLevel(level, memberAutoApprovalAllowed(host.cfg.organization));
  return level;

}
  return roomTurnApprovalMode;
}
