// @ts-nocheck
/** autoRefusalsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAutoRefusalsFor(getHost: () => Host): any {
function autoRefusalsFor(payer: string) {
  const host = getHost();

  const now = Date.now();
  const out: AutoChainEntry[] = [];
  for (const [key, until] of host.autoRefusals) {
    if (until <= now) { host.autoRefusals.delete(key); continue; }
    const [who, instanceId, model] = key.split("\u0000");
    if (who === payer && instanceId && model) out.push({ instanceId, model });
  }
  return out;

}
  return autoRefusalsFor;
}
