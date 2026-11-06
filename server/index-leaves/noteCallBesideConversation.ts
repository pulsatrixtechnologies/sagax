// @ts-nocheck
/** noteCallBesideConversation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteCallBesideConversation(getHost: () => Host): any {
function noteCallBesideConversation(bot: BotRecord, threadId: string, beforeId: string | undefined) {
  const host = getHost();

  const task = host.store.taskByThread(bot.id, threadId);
  if (!task || !beforeId || host.callLinesSince.has(threadId)) return;
  const owner = task.lastInstanceId;
  const record = owner ? task.handedMessages?.[owner] : undefined;
  if (owner && record?.session !== undefined && record.session === task.resumeCursors[owner] &&
    host.registry.get(owner)?.adapter.capabilities.strictResume) return;
  host.callLinesSince.set(threadId, beforeId);

}
  return noteCallBesideConversation;
}
