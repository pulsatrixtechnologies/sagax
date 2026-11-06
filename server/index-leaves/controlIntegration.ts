// @ts-nocheck
/** controlIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createControlIntegration(getHost: () => Host): any {
function controlIntegration(   botId: string,   threadId: string,   generation: string,   machine: "this computer" | { localVmTarget?: LocalVmTarget; boxId?: string | null } = {}, ) {
  const host = getHost();

  const { localVmTarget, boxId } = machine === "this computer" ? {} : machine;
  return {
    url: `http://127.0.0.1:${host.PORT}/api/internal/computer-control?botId=${encodeURIComponent(botId)}`,
    token: host.mintInternalCapability({
      botId,
      threadId,
      generation,
      depth: 0,
      kind: "computer",
      ...(localVmTarget ? { localVmTarget } : {}),
      ...(boxId !== undefined ? { boxId } : {}),
      ...(host.teamComputerTurns.get(threadId) ? { teamComputerId: host.teamComputerTurns.get(threadId)!.computerId } : {}),
      skillAuthoring: false,
      createdBots: 0,
      openedThreads: 0
    }, { perTurn: machine !== "this computer" })
  };

}
  return controlIntegration;
}
