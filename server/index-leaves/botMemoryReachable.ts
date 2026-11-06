// @ts-nocheck
/** botMemoryReachable (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotMemoryReachable(getHost: () => Host): any {
function botMemoryReachable(auth: RequestAuth, botId: string) {
  const host = getHost();

  if (!host.store.bot(botId)) return false;
  const path = `/api/bots/${botId}/memory`;
  const subject: PathSubject = { kind: "bot", id: botId };
  const visible = host.visibleTo(host.viewerFor(auth, path));
  if (!visible.everything && !host.subjectVisible(subject, visible)) return false;
  const scopedViewerId = host.serviceThreadViewer(host.serviceViewerClosed(auth, path, host.privateThreads()), host.channelFilterViewerId(auth));
  if (scopedViewerId && !host.subjectSeesChannel(subject, scopedViewerId)) return false;
  return host.botMemoryMayEdit(auth, botId);

}
  return botMemoryReachable;
}
