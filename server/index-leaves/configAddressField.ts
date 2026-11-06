// @ts-nocheck
/** configAddressField (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConfigAddressField(getHost: () => Host): any {
function configAddressField(value: unknown, prefix = "", depth = 0): string | undefined {
  const host = getHost();
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "url" || key.endsWith("Url")) return path;
    const nested = configAddressField(child, path, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}
  return configAddressField;
}
