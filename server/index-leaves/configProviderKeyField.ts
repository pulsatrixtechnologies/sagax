// @ts-nocheck
/** configProviderKeyField (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConfigProviderKeyField(getHost: () => Host): any {
function configProviderKeyField(value: unknown, prefix = "", depth = 0) {
  void getHost();

  if (!value || typeof value !== "object" || depth > 4) return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (/(key|keys|token|secret|password)$/i.test(key)) return path;
    const nested = configProviderKeyField(child, path, depth + 1);
    if (nested) return nested;
  }
  return undefined;

}
  return configProviderKeyField;
}
