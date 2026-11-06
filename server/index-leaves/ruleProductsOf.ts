// @ts-nocheck
/** ruleProductsOf (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRuleProductsOf(getHost: () => Host): any {
function ruleProductsOf(botId: string | undefined) {
  const host = getHost();

  if (!botId) return {};
  const declared = host.perspicaxMcp?.declaredApis(botId);
  const products: RuleProduct[] = (declared ?? []).map((api) => ({ id: api.id, name: api.name }));
  const bot = host.store.bot(botId);
  if (bot) {
    for (const name of Object.keys(host.cfg.mcpServers ?? {})) if (!bot.mcpServers || bot.mcpServers.includes(name)) products.push({ id: name });
    try {
      for (const name of Object.keys(host.personConnections.servers(host.effectiveBotOwner(bot)))) products.push({ id: name });
    } catch {
      // no connection of the person's own: the configured servers alone
    }
  }
  return { products, gatewayNamesUnknown: Boolean(host.perspicaxMcp) && !declared };

}
  return ruleProductsOf;
}
