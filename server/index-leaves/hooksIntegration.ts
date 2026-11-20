// @ts-nocheck
/** hooksIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHooksIntegration(getHost: () => Host): any {
function hooksIntegration(botId: string, threadId: string, generation: string): { url: string; token: string; connectorFiles?: boolean } {
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
  // #5140 (M-20261120-008): on an organization server the engine runs on
  // the Sagax server, so a file its own claude.ai connectors save there goes
  // to the person's place; a solo server is the person's own computer
  return { url: `http://127.0.0.1:${host.PORT}`, token, ...(host.IDENTITY.kind === "perspicax" ? { connectorFiles: true } : {}) };

}
  return hooksIntegration;
}
