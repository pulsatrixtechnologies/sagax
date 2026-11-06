// @ts-nocheck
/** connectorThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConnectorThread(getHost: () => Host): any {
function connectorThread(botId: string, threadId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return null;
  // Organization server: a bot thread's cards are its owner's only.
  if ((bot.threadId === threadId || host.store.taskByThread(botId, threadId)) && !host.botThreadReadable(bot, threadId, host.scopedThreadViewer(), "thread.answer")) return null;
  if (bot.threadId === threadId) return { bot, group: undefined }; // a bot's own main chat
  if (host.store.taskByThread(botId, threadId)) return { bot, group: undefined };
  const group = host.store.groupByThread(threadId);
  if (group?.memberIds.includes(botId)) return { bot, group };
  return null;

}
  return connectorThread;
}
