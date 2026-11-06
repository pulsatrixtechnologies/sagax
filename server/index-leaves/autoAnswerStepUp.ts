// @ts-nocheck
/** autoAnswerStepUp (#1388). Pure move from server/index.ts. */
import { callStepUpClasses } from "../auth/step-up-gate.ts";
export type Host = Record<string, any>;

export function createAutoAnswerStepUp(getHost: () => Host): any {
function autoAnswerStepUp(bot: BotRecord, threadId: string, call: Parameters<typeof callStepUpClasses>[0]) {
  const host = getHost();

  const classes = callStepUpClasses(call, host.threadActionClassContext(bot.id, threadId));
  if (!classes.length) return [];
  // the person who answers this thread's cards (a confidential thread's
  // owner, ownerDecision's owner too), not only the bot's owner
  const owner = host.approvalOwnerId(bot, threadId) || null;
  const out = new Set<StepUpClass>(host.securityKeys.required(owner, classes, owner));
  const speaker = host.turnSpeakerPrincipals.get(threadId);
  if (speaker && speaker !== owner) for (const name of host.securityKeys.required(speaker, classes, owner)) out.add(name);
  return [...out];

}
  return autoAnswerStepUp;
}
