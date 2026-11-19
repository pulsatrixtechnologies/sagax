// @ts-nocheck
/** awaitsPerson: the waiting line of a card only the person can settle in a
 * run's conversation, else null (server/routines/routines.ts). 2026-11-03: a
 * question card. #4528: a permission card too, so a routine run waiting on
 * one is still waiting after a restart and its answer resumes the run. */
export type Host = Record<string, any>;

export function createAwaitsPerson(getHost: () => Host): any {
function awaitsPerson(threadId: string): string | null {
  const host = getHost();
  const words = (card: { subtitle?: unknown }) => host.redactSecretsInText(typeof card.subtitle === "string" ? card.subtitle : "").replace(/\s+/g, " ").trim().slice(0, 300);
  const question = host.openQuestionCard(threadId);
  if (question) {
    const said = words(question);
    return said ? `Waiting for your answer: ${said}` : "Waiting for your answer";
  }
  const approval = host.openApprovalCard(threadId);
  if (approval) {
    const said = words(approval);
    return said ? `Waiting for your approval: ${said}` : "Waiting for your approval";
  }
  return null;
}
  return awaitsPerson;
}
