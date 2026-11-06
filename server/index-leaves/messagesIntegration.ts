// @ts-nocheck
/** messagesIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMessagesIntegration(getHost: () => Host): any {
function messagesIntegration(botId: string, threadId: string, generation: string) {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId,
    threadId,
    generation,
    depth: 0,
    kind: "messages",
    skillAuthoring: false,
    createdBots: 0,
    openedThreads: 0
  });
  return {
    command: process.execPath,
    args: [host.messagesProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      SAGAX_MESSAGES_TOKEN: token,
      SAGAX_HARNESS_URL: `http://127.0.0.1:${PORT}`
    }
  };

}
  return messagesIntegration;
}
