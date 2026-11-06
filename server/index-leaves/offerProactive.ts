// @ts-nocheck
/** offerProactive (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOfferProactive(getHost: () => Host): any {
function offerProactive(event: ProactiveEvent) {
  const host = getHost();

  try {
    return host.proactiveWaker.offer(event);
  } catch (error) {
    console.warn(`[proactive] offer failed: ${error instanceof Error ? error.name : "error"}`);
    return undefined;
  }

}
  return offerProactive;
}
