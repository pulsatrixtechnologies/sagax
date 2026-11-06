// @ts-nocheck
/** rulesHoldTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRulesHoldTurn(getHost: () => Host): any {
function rulesHoldTurn(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { isPrincipalId } = host;

  const people = new Set<string>([host.approvalOwnerId(bot, threadId)]);
  const speaker = host.turnSpeakerPrincipals.get(threadId);
  if (speaker && isPrincipalId(speaker)) people.add(speaker);
  for (const person of people) {
    if (!person) continue;
    if (host.ownerApprovals.rulesOf(person, bot.id).some((rule) => rule.behavior !== "allow")) return true;
    if (host.customRules.rulesOf(person, bot.id).some((rule) => rule.enabled && rule.behavior !== "allow")) return true;
  }
  return false;

}
  return rulesHoldTurn;
}
