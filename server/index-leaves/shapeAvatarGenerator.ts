// @ts-nocheck
/** shapeAvatarGenerator (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createShapeAvatarGenerator(getHost: () => Host): any {
function shapeAvatarGenerator(botId: string) {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget } = host;
  const bot = host.store.bot(botId);
  if (!bot) return null;
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (!instance?.generateText || host.policyModelRefusal(instance)) return null;
  try { assertWithinBudget(host.cfg, DATA_DIR); } catch { return null; }
  return instance.generateText.bind(instance);

}
  return shapeAvatarGenerator;
}
