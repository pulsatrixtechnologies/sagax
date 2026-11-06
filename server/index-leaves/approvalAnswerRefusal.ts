// @ts-nocheck
/** approvalAnswerRefusal (#1388). Pure move from server/index.ts. */
import { approvalAnswerStatus, approvalAudience } from "../approvals/approval-audience.ts";
export type Host = Record<string, any>;

export function createApprovalAnswerRefusal(getHost: () => Host): any {
function approvalAnswerRefusal(auth: RequestAuth, threadId: string, requestId: string) {
  const host = getHost();

  const refusal = "Only the bot owner can answer this approval.";
  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  if (!message) {
    // A request that is no longer open (or never was): the thread's bot owner
    // still gets the plain "unavailable" or 404 answer, anyone else the 403.
    const bot = host.botForApproval(threadId, {});
    const audience = bot ? approvalAudience({ ownerUserId: host.approvalOwnerId(bot, threadId), host: host.approvalHostOf(bot) }) : null;
    return approvalAnswerStatus({ question: false, audience, callerUserId: host.approvalCallerUserId(auth) }) === 403 ? refusal : null;
  }
  // a question (the questionRequest form, or a persistent ask card) stays on the ordinary answer path
  const question = Boolean(message.card && typeof message.card === "object" && (message.card.questionRequest || host.isPersistentQuestionCard(message.card)));
  if (question) return null;
  if (message.card && typeof message.card === "object" && message.card.terminalRequest) return null;
  // A team-memory card is the team's to confirm, not only the bot owner's:
  // cardAnswerRefusal (always asked next) decides it by section membership.
  // Every other approval stays with the owner.
  if (message.card && typeof message.card === "object" && message.card.teamMemoryRequest) return null;
  if (!host.isApprovalCardMessage(message)) return refusal;
  const bot = host.botForApproval(threadId, message);
  const audience = bot ? approvalAudience({ ownerUserId: host.cardAnswererId(bot, threadId, message.card), host: host.approvalHostOf(bot) }) : null;
  if (approvalAnswerStatus({ question: false, audience, callerUserId: host.approvalCallerUserId(auth) }) === 403) return refusal;
  return null;

}
  return approvalAnswerRefusal;
}
