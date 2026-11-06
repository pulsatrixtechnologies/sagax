// @ts-nocheck
/** callHandoffHistory (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCallHandoffHistory(getHost: () => Host): any {
function callHandoffHistory(bot: BotRecord, threadId: string, anchorId: string) {
  const host = getHost();
  const { DEFAULT_REBUILD_BYTES, selectReplay } = host;
  const messages = host.store.activePath(threadId);
  const task = host.store.taskByThread(bot.id, threadId);
  const record = host.latestCompaction(messages, task);
  const selection = selectReplay(host.directContext(bot, threadId, messages), {
    budgetBytes: host.cfg.context?.rebuildBytes ?? DEFAULT_REBUILD_BYTES, excludedIds: new Set([anchorId]), ...(record ? { compaction: record } : {})
  });
  return selection.transcript.map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}`).join("\n");

}
  return callHandoffHistory;
}
