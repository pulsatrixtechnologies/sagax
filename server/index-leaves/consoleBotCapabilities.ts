// @ts-nocheck
/** consoleBotCapabilities (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConsoleBotCapabilities(getHost: () => Host): any {
function consoleBotCapabilities(botId: string, viewer: { principalId: string; orgAdmin: boolean }) {
  const host = getHost();
  const { botFacts, botLevel } = host;
  return host.resolveConsoleBotCapabilities({
    bot: (id) => host.store.bot(id) ?? undefined,
    owner: (bot) => host.effectiveBotOwner(bot),
    level: (looking, orgAdmin, bot) => {
      const person = host.authzViewerFromId(looking);
      return person ? botLevel({ viewer: { ...person, orgAdmin: person.orgAdmin || orgAdmin }, ...botFacts(bot) }) : null;
    },
    name: (id) => host.pageThreadName(id),
    resolve: async (bot, as) => {
      const answer = await host.botCapabilitiesAs(bot, undefined, { principal: as.principal, mayChange: as.mayChange, marketplace: { principal: as.principal }, ...(as.computedFor ? { computedFor: as.computedFor } : {}) });
      return answer.ok ? answer.capabilities : null;
    }
  }, botId, viewer);

}
  return consoleBotCapabilities;
}
