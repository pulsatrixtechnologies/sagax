// @ts-nocheck
/** directSendRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDirectSendRefusal(getHost: () => Host): any {
function directSendRefusal(botId: string, threadId: string) {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget } = host;
  // The send is acknowledged before the turn starts, so a workspace at its
  // spend limit is refused here, where the person can see it.
  try {
    assertWithinBudget(host.cfg, DATA_DIR);
  } catch (error) {
    return new host.DirectSendRefused(409, { error: error instanceof Error ? error.message : String(error), code: "spend_cap" });
  }
  if (!host.store.taskByThread(botId, threadId)) {
    return new host.DirectSendRefused(409, { error: "the bot switched tasks before it could receive the message" });
  }
  return null;

}
  return directSendRefusal;
}
