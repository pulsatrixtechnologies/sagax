// @ts-nocheck
/** closeSessionStreams (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCloseSessionStreams(getHost: () => Host): any {
function closeSessionStreams(sessionId: string) {
  const host = getHost();

  host.browserLive.closeForOwner(sessionId);
  host.browserNetworkDebug.clearOwner(sessionId);
  host.desktopViewer.closeForOwner(sessionId);
  for (const client of host.sseClients) {
    if (client.sessionId === sessionId) client.close();
  }

}
  return closeSessionStreams;
}
