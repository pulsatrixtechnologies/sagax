// @ts-nocheck
/** workplaceIntegration (#1388). Pure move from server/index.ts. */
import { AUTO_COMPUTER_MCP_NAME } from "../computer/auto-computer.ts";
export type Host = Record<string, any>;

export function createWorkplaceIntegration(getHost: () => Host): any {
function workplaceIntegration(botId: string, threadId: string, generation: string) {
  const host = getHost();

  const token = host.mintInternalCapability({
    botId, threadId, generation, depth: 0, kind: "workplace", skillAuthoring: false, createdBots: 0, openedThreads: 0
  });
  return {
    command: process.execPath,
    args: [host.SPAWNED_PROXIES.userSandbox],
    env: { ...host.AGENTS_NODE_FLAG, SAGAX_SANDBOX_TOKEN: token, SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`, SAGAX_TOOL_SERVER: AUTO_COMPUTER_MCP_NAME }
  };

}
  return workplaceIntegration;
}
