// @ts-nocheck
/** viewerMayAnswerOnThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createViewerMayAnswerOnThread(getHost: () => Host): any {
function viewerMayAnswerOnThread(threadId: string, viewerId: string | undefined) {
  const host = getHost();

  if (!viewerId) return true;
  if (!host.subjectSeesChannel({ kind: "thread", id: threadId }, viewerId)) return false;
  if (!host.privateThreads()) return true;
  const owner = host.store.botByThread(threadId);
  if (owner && !host.botThreadReadable(owner, threadId, viewerId, "thread.post")) return false;
  const room = host.store.groupByThread(threadId);
  return !room || host.groupPostAllowed(room, viewerId);

}
  return viewerMayAnswerOnThread;
}
