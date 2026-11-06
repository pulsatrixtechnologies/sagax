// @ts-nocheck
/** busyClassifyEngine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBusyClassifyEngine(getHost: () => Host): any {
function busyClassifyEngine(botId: string): ((prompt: string, options?: { signal?: AbortSignal }) => Promise<string>) | undefined {
  const host = getHost();

  const bot = host.store.bot(botId);
  const instance = bot ? host.streamDigestEngine(bot) : null;
  return instance?.generateText ? instance.generateText.bind(instance) : undefined;

}
  return busyClassifyEngine;
}
