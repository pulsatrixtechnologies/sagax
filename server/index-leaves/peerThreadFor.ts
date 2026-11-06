// @ts-nocheck
/** peerThreadFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPeerThreadFor(getHost: () => Host): any {
function peerThreadFor(bot: BotRecord) {
  const host = getHost();

  // 2026-10-28: the bot's one conversation with its owner
  // (conversationThreadFor), never whatever thread happened to be selected
  // (a job, a run, a confidential thread), so a peer's ask shows up where
  // the person reads.
  const owner = host.effectiveBotOwner(bot);
  const conversation = host.conversationThreadFor(bot, host.privateThreads() ? owner : undefined);
  if (conversation) return conversation;
  // no conversation yet (every thread archived, confidential or a job):
  // one is started for the owner, never selected
  return host.store.createTask(bot.id, undefined, false, undefined, undefined, undefined, host.privateThreads() ? owner : undefined)?.threadId ?? bot.threadId;

}
  return peerThreadFor;
}
