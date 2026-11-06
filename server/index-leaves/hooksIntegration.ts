// @ts-nocheck
/** hooksIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHooksIntegration(getHost: () => Host): any {
function hooksIntegration(botId: string, threadId: string, generation: string): { url: string; token: string } {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId,
    threadId,
    generation,
    depth: 0,
    kind: "hooks",
    skillAuthoring: false,
    createdBots: 0,
    openedThreads: 0
  });
  return { url: `http://127.0.0.1:${host.PORT}`, token };

}
  return hooksIntegration;
}
