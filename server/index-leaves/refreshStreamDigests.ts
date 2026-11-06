// @ts-nocheck
/** refreshStreamDigests (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRefreshStreamDigests(getHost: () => Host): any {
function refreshStreamDigests(botId: string, threadId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return;
  const stale = host.streamCandidates(bot, threadId)
    .filter((task) => !host.segmentDigestDrafts.has(task.threadId) && !(task.segmentDigest?.by === "model" && task.segmentDigest.at >= host.segmentStamp(task)))
    .sort((a, b) => host.segmentStamp(b) - host.segmentStamp(a))[0];
  if (!stale) return;
  const instance = host.streamDigestEngine(bot);
  const { entries, files, lastId } = host.segmentHistory(bot, stale.threadId);
  if (!instance || entries.length < 2 || !lastId) return;
  host.segmentDigestDrafts.add(stale.threadId);
  void draftSegmentDigest({ title: stale.title, history: entries, files, generateText: instance.generateText!.bind(instance) })
    .then((drafted) => {
      const current = host.store.taskByThread(botId, stale.threadId);
      // Deleted, made confidential or changed hands meanwhile: nothing kept.
      if (!current || !host.isStreamSegment(current) || current.ownerPrincipalId !== stale.ownerPrincipalId) return;
      const at = Date.now();
      host.store.patchTask(botId, stale.threadId, { segmentDigest: { text: host.redactSecretsInText(drafted.text), anchorId: lastId, at, by: drafted.by } });
      host.extractedSegmentDigests.delete(stale.threadId);
      console.info(`[stream] ${botId} ${stale.threadId}: ${drafted.by} digest, ${drafted.text.length} chars`);
    })
    .catch((error) => console.warn(`[stream] digest failed for ${stale.threadId}: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => host.segmentDigestDrafts.delete(stale.threadId));

}
  return refreshStreamDigests;
}
