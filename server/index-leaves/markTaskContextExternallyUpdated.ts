// @ts-nocheck
/** markTaskContextExternallyUpdated (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMarkTaskContextExternallyUpdated(getHost: () => Host): any {
function markTaskContextExternallyUpdated(bot: BotRecord, threadId: string, markUnread = true) {
  const host = getHost();

  const task = host.store.taskByThread(bot.id, threadId);
  if (!task) return;
  // An engine that records which messages its current session was handed
  // keeps that session: its next turn is sent what it has not seen. Without a
  // record for that exact session (another engine, one switched in since, a
  // replaced session, or a task from before records existed) the next turn
  // replays once, as before.
  const owner = task.lastInstanceId;
  const record = owner ? task.handedMessages?.[owner] : undefined;
  if (owner && record?.session !== undefined && record.session === task.resumeCursors[owner] &&
    (host.botForThread(bot.id, threadId) ?? bot).modelSelection.instanceId === owner &&
    host.registry.get(owner)?.adapter.capabilities.strictResume) {
    if (markUnread) host.store.patchTask(bot.id, threadId, { unread: true });
    return;
  }
  host.store.patchTask(bot.id, threadId, {
    resumeCursors: {},
    lastInstanceId: `${EXTERNAL_CONTEXT_MARKER_PREFIX}${randomUUID()}`,
    ...(markUnread ? { unread: true } : {})
  });

}
  return markTaskContextExternallyUpdated;
}
