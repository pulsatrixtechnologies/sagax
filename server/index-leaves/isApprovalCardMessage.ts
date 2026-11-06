// @ts-nocheck
/** isApprovalCardMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createIsApprovalCardMessage(getHost: () => Host): any {
function isApprovalCardMessage(message: { kind?: unknown; card?: unknown }): boolean {
  void getHost();
  if (message.kind !== "options" || !message.card || typeof message.card !== "object") return false;
  const card = message.card as Record<string, unknown>;
  // A linked question carries the same private source audience as a linked
  // permission, even when its initiating chat is a room.
  if (card.approvalOrigin) return true;
  if (card.questionRequest) return false;
  return Boolean(
    card.tool || card.allowKey || card.commandAllowlist || card.approvalScope
    || card.skillRequest || card.routineRequest || card.profileRequest
    || card.teamSetupRequest || card.modelRequest || card.tighteningRequest
    || card.terminalRequest || card.meetingRequest,
  );
}
  return isApprovalCardMessage;
}
