// @ts-nocheck
/** dataIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDataIntegration(getHost: () => Host): any {
function dataIntegration(botId: string, turn: { threadId: string; generation: string }) {
  const host = getHost();
  const { dataEngine } = host;

  const unavailable = dataEngine.unavailable();
  if (unavailable !== null) {
    if (!host.dataUnavailableLogged) {
      host.dataUnavailableLogged = true;
      console.warn(`Data tools unavailable: ${unavailable}`);
    }
    return null;
  }
  const token = host.mintInternalCapability({ botId, ...turn, kind: "data", depth: 0, skillAuthoring: false, createdBots: 0, openedThreads: 0 });
  return {
    command: process.execPath, args: [host.SPAWNED_PROXIES.harnessMcp, "data"], env: {
      ...AGENTS_NODE_FLAG, SAGAX_MCP_TOKEN: token, SAGAX_HARNESS_URL: `http://127.0.0.1:${PORT}`
    }
  };

}
  return dataIntegration;
}
