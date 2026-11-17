// @ts-nocheck
/** attachmentSeenBy (#1388). Pure move from server/index.ts.
 *
 * Who reads a stored file on an organization server: its uploader, and
 * everyone who sees an object that uses it, exactly as wide as that object:
 *   - a conversation that uses it (a message or a room's thread);
 *   - a bot whose picture it is: the people who see that bot (its owner and
 *     those it is shared with), the members of a room it is in, and the
 *     organization when the bot is published to its catalogue;
 *   - the new-bot template's picture: every member, who opens New bot on it;
 *   - a routine's attached file: whoever sees that routine whole.
 * Nobody else, an administrator included: a file no such object uses is
 * its uploader's only. */
import { basename } from "node:path";

export type Host = Record<string, any>;

export function createAttachmentSeenBy(getHost: () => Host): any {
function attachmentSeenBy(name: string, viewerId: string) {
  const host = getHost();

  const url = `/api/attachments/${name}`;
  // the person who uploaded the bytes always reads them
  if (host.attachmentUploaders.uploadedBy(name, viewerId)) return true;
  // a bot's picture: whoever sees that bot
  for (const bot of host.store.bots) {
    if (bot.avatarUrl !== url) continue;
    if (host.listedBotVisible(bot, viewerId)) return true;
    if (bot.catalog?.published && !bot.archived && !bot.archivedAt) return true;
    if (host.store.groups.some((group) => group.memberIds?.includes(bot.id) && host.groupVisible(group, viewerId))) return true;
  }
  // the new-bot template's picture: every member opens New bot on it
  if (host.cfg?.newBotDefaults?.profile?.avatarUrl === url) return true;
  // a routine's attached file: whoever sees the routine with its attachments
  for (const routine of host.routines?.listRoutines() ?? []) {
    if (routine.attachments?.some((file) => typeof file?.path === "string" && basename(file.path) === name) && host.routineSeenBy(routine, viewerId)) return true;
  }
  for (const threadId of host.threadsUsingAttachment(name)) {
    const group = host.store.groupByThread(threadId);
    if (group) {
      if (host.groupVisible(group, viewerId)) return true;
      continue;
    }
    const bot = host.store.botByThread(threadId);
    if (!bot) continue;
    if (host.listedBotVisible(bot, viewerId) && host.botThreadReadable(bot, threadId, viewerId, "thread.attachments")) return true;
  }
  // a file no object of theirs uses, one no object uses yet included, is
  // never open: only its uploader reads it (above)
  return false;

}
  return attachmentSeenBy;
}
