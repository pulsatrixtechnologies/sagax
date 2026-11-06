// @ts-nocheck
/** latestCompaction (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLatestCompaction(getHost: () => Host): any {
function latestCompaction(messages: readonly Message[], task?: Pick<TaskRecord, "contextSummaries">) {
  void getHost();
  const at = new Map(messages.map((message, index) => [message.id, index]));
  let best: (CompactionRecord & { id: string }) | undefined;
  let bestAt = -1;
  const visible = messages.findLast(message => message.kind === "compaction" && message.compaction);
  if (visible?.compaction) { best = { ...visible.compaction, id: visible.id }; bestAt = at.get(visible.id)!; }
  for (const record of task?.contextSummaries ?? []) {
    const anchor = at.get(record.anchorId);
    if (anchor === undefined || anchor + 0.5 <= bestAt) continue;
    best = { summary: record.summary, firstKeptId: record.firstKeptId, foldedThroughId: record.foldedThroughId,
      tokensBefore: record.tokensBefore, by: "harness", anchorId: record.anchorId, id: record.id };
    bestAt = anchor + 0.5;
  }
  return best;
}
  return latestCompaction;
}
