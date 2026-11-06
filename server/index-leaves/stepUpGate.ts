// @ts-nocheck
/** stepUpGate (#1388). Pure move from server/index.ts. */
import { approvalStepUp } from "../auth/step-up-gate.ts";
export type Host = Record<string, any>;

export function createStepUpGate(getHost: () => Host): any {
function stepUpGate(person: string | null, threadId: string, requestId: string, behavior: string, answer: StepUpAnswer, stepUp: unknown) {
  const host = getHost();
  const { cardRiskClasses } = host;

  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  const context = host.threadActionClassContext(host.botForApproval(threadId, message ?? {})?.id, threadId);
  const act = card?.botActRequest ? host.botActStepUpContent(requestId) : undefined;
  return approvalStepUp({
    keys: host.securityKeys, person, policyPerson: host.stepUpPolicyPerson(threadId, message),
    threadId, requestId, card, behavior, answer, risks: card ? cardRiskClasses(card, context) : [], stepUp,
    ...(act ? { extraClasses: act.classes, extraContent: act.content } : {})
  });

}
  return stepUpGate;
}
