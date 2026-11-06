// @ts-nocheck
/** botForApproval (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotForApproval(getHost: () => Host): any {
function botForApproval(threadId: string, message: { from?: { botId?: string } }) {
  const host = getHost();

  const id = message.from?.botId
    || host.groupSpeakers.get(threadId)?.botId
    || host.store.groupByThread(threadId)?.busyBotId
    || host.store.botByThread(threadId)?.id
    || undefined;
  if (!id) return undefined;
  return host.store.bot(id) ?? undefined;

}
  return botForApproval;
}
