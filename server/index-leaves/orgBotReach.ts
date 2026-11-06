// @ts-nocheck
/** orgBotReach (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgBotReach(getHost: () => Host): any {
function orgBotReach(bot: BotRecord) {
  const host = getHost();
  const { sectionKey } = host;

  const facts = host.botFacts(bot);
  const sectionName = sectionKey(bot.section);
  const record = sectionName && host.sectionChannels ? host.sectionChannels.byName(sectionName) : undefined;
  const shared = record && facts.sections?.length ? record : undefined;
  return {
    ownerPrincipalId: facts.ownerPrincipalId,
    grantTargets: facts.grants.map((grant) => grant.target),
    sectionMemberTargets: shared ? shared.members.map((member) => member.target) : []
  };

}
  return orgBotReach;
}
