// @ts-nocheck
/** userDesktopIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUserDesktopIntegration(getHost: () => Host): any {
function userDesktopIntegration(botId: string, threadId: string, generation: string, desktopPrincipalId: string) {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId, threadId, generation, depth: 0, kind: "desktop", skillAuthoring: false, createdBots: 0, openedThreads: 0, desktopPrincipalId
  });
  return {
    command: process.execPath,
    args: [host.SPAWNED_PROXIES.userSandbox],
    env: { ...host.AGENTS_NODE_FLAG, SAGAX_SANDBOX_TOKEN: token, SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`, SAGAX_TOOL_SERVER: host.DESKTOP_BRIDGE_MCP_NAME }
  };

}
  return userDesktopIntegration;
}
