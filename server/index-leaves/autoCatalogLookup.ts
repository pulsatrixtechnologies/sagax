// @ts-nocheck
/** autoCatalogLookup (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAutoCatalogLookup(getHost: () => Host): any {
function autoCatalogLookup(driverKind: string, modelId: string) {
  const host = getHost();

  const memoKey = `${driverKind}\u0000${modelId}`;
  const memo = host.autoCatalogMemo.get(memoKey);
  if (memo !== undefined) return memo ?? undefined;
  const providers = host.autoModelCatalog.get().providers;
  const bare = bareModelId(modelId);
  const ids = [bare, `kimi-${bare}`];
  const family = familyOfModel(driverKind, modelId);
  const order = [...(family ? host.AUTO_CATALOG_PROVIDERS[family] ?? [] : []), ...Object.keys(providers).sort()];
  let facts: CatalogFacts | null = null;
  outer: for (const providerId of order) {
    const models = providers[providerId]?.models;
    if (!models) continue;
    for (const id of ids) {
      const row = models[id];
      if (!row) continue;
      facts = {
        name: row.name,
        reasoning: row.reasoning,
        vision: row.modalities.input.includes("image"),
        ...(row.limit?.context ? { context: row.limit.context } : {}),
        ...(row.cost?.input !== undefined ? { costInput: row.cost.input } : {}),
        ...(row.cost?.output !== undefined ? { costOutput: row.cost.output } : {}),
        ...(row.release_date ? { releaseDate: row.release_date } : {})
      };
      break outer;
    }
  }
  host.autoCatalogMemo.set(memoKey, facts);
  return facts ?? undefined;

}
  return autoCatalogLookup;
}
