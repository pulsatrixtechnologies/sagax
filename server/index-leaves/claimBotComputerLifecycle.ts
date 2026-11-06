// @ts-nocheck
/** claimBotComputerLifecycle (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaimBotComputerLifecycle(getHost: () => Host): any {
function claimBotComputerLifecycle(botId: string, allowPreview = false) {
  const host = getHost();

  if (host.boatLifecycleBusyBots.has(botId)) {
    throw Object.assign(new Error("this bot's cloud computer is being changed — wait for it to finish"), { status: 409 });
  }
  if (!allowPreview && host.vpsPreviewRequests.has(botId)) {
    throw Object.assign(new Error("a screen preview is still refreshing — wait before changing this computer"), { status: 409 });
  }
  host.boatLifecycleBusyBots.add(botId);
  return () => host.boatLifecycleBusyBots.delete(botId);

}
  return claimBotComputerLifecycle;
}
