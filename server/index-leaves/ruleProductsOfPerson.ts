// @ts-nocheck
/** ruleProductsOfPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRuleProductsOfPerson(getHost: () => Host): any {
function ruleProductsOfPerson(personId: string, botId: string | null) {
  const host = getHost();

  const seen = new Map<string, RuleProduct>();
  for (const id of botId ? [botId] : host.botsOwnedBy(personId).map((bot) => bot.id)) {
    for (const product of host.ruleProductsOf(id).products ?? []) {
      const key = product.id.toLowerCase();
      if (!seen.has(key) || (product.name && !seen.get(key)!.name)) seen.set(key, product);
    }
  }
  return [...seen.values()];

}
  return ruleProductsOfPerson;
}
