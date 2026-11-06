// @ts-nocheck
/** safetyReviewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSafetyReviewer(getHost: () => Host): any {
function safetyReviewer(botId: string) {
  const host = getHost();

  const selected = host.store.bot(botId)?.modelSelection.instanceId;
  if (!selected) return undefined;
  const instance = host.registry.get(selected);
  const review = instance?.reviewPermission;
  if (!review) return undefined;
  return (prompt, signal) => review.call(instance, prompt, signal);

}
  return safetyReviewer;
}
