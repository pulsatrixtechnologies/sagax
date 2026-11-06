// @ts-nocheck
/** userSandboxIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUserSandboxIntegration(getHost: () => Host): any {
function userSandboxIntegration(botId: string, threadId: string, generation: string, sandboxPrincipalId: string) {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId, threadId, generation, depth: 0, kind: "sandbox", skillAuthoring: false, createdBots: 0, openedThreads: 0, sandboxPrincipalId
  });
  return {
    command: process.execPath,
    args: [host.SPAWNED_PROXIES.userSandbox],
    env: { ...host.AGENTS_NODE_FLAG, SAGAX_SANDBOX_TOKEN: token, SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}` }
  };

}
  return userSandboxIntegration;
}
