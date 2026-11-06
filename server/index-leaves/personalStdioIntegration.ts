// @ts-nocheck
/** personalStdioIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersonalStdioIntegration(getHost: () => Host): any {
function personalStdioIntegration(botId: string, threadId: string, generation: string, principalId: string, server: string, pluginMcp?: InternalCapability["pluginMcp"]) {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId, threadId, generation, depth: 0, kind: "personal-mcp", skillAuthoring: false, createdBots: 0, openedThreads: 0,
    sandboxPrincipalId: principalId, personalMcpServer: server,
    ...(pluginMcp ? { pluginMcp } : {})
  });
  return {
    command: process.execPath,
    args: [host.SPAWNED_PROXIES.userSandbox],
    env: { ...AGENTS_NODE_FLAG, SAGAX_SANDBOX_TOKEN: token, SAGAX_HARNESS_URL: `http://127.0.0.1:${PORT}`, SAGAX_TOOL_SERVER: host.PERSONAL_STDIO_TOOL_SERVER }
  };

}
  return personalStdioIntegration;
}
