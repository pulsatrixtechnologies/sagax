// @ts-nocheck
/** segmentDigestText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSegmentDigestText(getHost: () => Host): any {
function segmentDigestText(bot: BotRecord, task: TaskRecord) {
  const host = getHost();

  if (task.segmentDigest && task.segmentDigest.at >= host.segmentStamp(task)) return task.segmentDigest.text;
  const cached = host.extractedSegmentDigests.get(task.threadId);
  if (cached && cached.at >= host.segmentStamp(task)) return cached.text;
  const { entries, files, lastId } = host.segmentHistory(bot, task.threadId);
  if (!entries.length || !lastId) return "";
  const digest: SegmentDigest = { text: host.redactSecretsInText(extractSegmentDigest(entries, files)), anchorId: lastId, at: Date.now(), by: "extract" };
  host.extractedSegmentDigests.set(task.threadId, digest);
  return digest.text;

}
  return segmentDigestText;
}
