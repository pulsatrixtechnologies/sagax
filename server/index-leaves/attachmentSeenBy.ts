// @ts-nocheck
/** attachmentSeenBy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttachmentSeenBy(getHost: () => Host): any {
function attachmentSeenBy(name: string, viewerId: string) {
  const host = getHost();

  const url = `/api/attachments/${name}`;
  if (host.store.bots.some((bot) => bot.avatarUrl === url)) return true;
  let referenced = false;
  for (const threadId of host.threadsUsingAttachment(name)) {
    const group = host.store.groupByThread(threadId);
    if (group) {
      if (host.groupVisible(group, viewerId)) return true;
      referenced = true;
      continue;
    }
    const bot = host.store.botByThread(threadId);
    if (!bot) continue;
    if (host.listedBotVisible(bot, viewerId) && host.botThreadReadable(bot, threadId, viewerId, "thread.attachments")) return true;
    referenced = true;
  }
  return !referenced;

}
  return attachmentSeenBy;
}
