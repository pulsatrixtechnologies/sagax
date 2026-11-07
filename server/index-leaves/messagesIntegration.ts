// @ts-nocheck
/** messagesIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMessagesIntegration(getHost: () => Host): any {
/** `desktopPrincipalId` (organization server): the person whose Mac runs
 * the Apple app tools, through their desktop app (desktop bridge). */
function messagesIntegration(botId: string, threadId: string, generation: string, desktopPrincipalId?: string) {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId,
    threadId,
    generation,
    depth: 0,
    kind: "messages",
    skillAuthoring: false,
    createdBots: 0,
    openedThreads: 0,
    ...(desktopPrincipalId ? { desktopPrincipalId } : {})
  });
  return {
    command: process.execPath,
    args: [host.messagesProxyPath],
    env: {
      ...host.AGENTS_NODE_FLAG,
      SAGAX_MESSAGES_TOKEN: token,
      SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`
    }
  };

}
  return messagesIntegration;
}
