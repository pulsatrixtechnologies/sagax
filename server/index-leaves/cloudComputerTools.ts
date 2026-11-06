// @ts-nocheck
/** cloudComputerTools (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCloudComputerTools(getHost: () => Host): any {
function cloudComputerTools(botId: string, owner: TurnOwner, boxId: string | null) {
  const host = getHost();

  const control = host.controlIntegration(botId, owner.threadId, owner.generation, { boxId });
  return {
    command: process.execPath,
    args: [host.SPAWNED_PROXIES.harnessMcp, "computer"],
    env: { ...host.AGENTS_NODE_FLAG, SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`, SAGAX_MCP_TOKEN: control.token },
    platform: "linux"
  };

}
  return cloudComputerTools;
}
