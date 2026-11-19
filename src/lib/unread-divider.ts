// Where the New divider goes when a conversation opens unread.
//
// The flag (Task.unread, Group.unread) says that something arrived while the
// person was away. Where is the later of two points they certainly saw: the
// newest message on screen when they last read the conversation
// (lastReadMessageId), and their own newest line. The divider sits above the
// first message after it. With neither point there is no divider, and none
// when nothing came in after it.
import { peerLine } from "@/lib/peer-message";

/** The fields the divider reads. The full message stays in the store, so
 * this module does not import it (#1381). */
type Line = {
  id: string;
  role: "bot" | "user";
  text?: string;
  peerAsk?: { botId: string; name: string; unattended?: boolean };
};

/** A user-role line the person wrote, not one another bot delivered. */
const fromPerson = (message: Line) => message.role === "user" && !peerLine(message);

/** How many messages in this loaded conversation are still unread, or null
 * when the loaded lines do not show a boundary. A dot stays in that case:
 * a number would be a guess. */
export function unreadMessageCount(messages: readonly Line[], lastReadMessageId?: string): number | null {
  if (messages.length === 0) return null;
  const id = firstUnreadMessageId(messages, lastReadMessageId);
  if (!id) return null;
  const at = messages.findIndex((message) => message.id === id);
  if (at < 0) return null;
  const count = messages.length - at;
  return count > 0 ? count : null;
}

/** The first unread message of a conversation opened unread, or null. A
 * read cursor that is not among these messages (another branch, or older
 * than what is loaded) leaves only the person's own line to go by. */
export function firstUnreadMessageId(messages: readonly Line[], lastReadMessageId?: string): string | null {
  let seen = -1;
  for (let i = messages.length - 1; i >= 0 && seen < 0; i--) if (fromPerson(messages[i]!)) seen = i;
  if (lastReadMessageId) seen = Math.max(seen, messages.findIndex((message) => message.id === lastReadMessageId));
  return seen < 0 ? null : messages[seen + 1]?.id ?? null;
}

/** The read cursor of the conversation shown for this bot. */
/** The New divider of an open conversation. A short page can end below the
 * boundary: then the cursor is kept so a scrollback page can place it
 * (port of OpenMausBot #4842). */
export type UnreadDivider = { threadId: string; messageId: string | null; lastReadMessageId?: string };

export function unreadDividerFor(threadId: string, messages: readonly Line[], lastReadMessageId: string | undefined, hasMore?: boolean): UnreadDivider | null {
  const messageId = firstUnreadMessageId(messages, lastReadMessageId);
  if (messageId) return { threadId, messageId };
  return hasMore ? { threadId, messageId: null, lastReadMessageId } : null;
}

/** A divider still waiting for its boundary, placed once a page holds it. */
export function placeUnreadDivider(divider: UnreadDivider | null, threadId: string, messages: readonly Line[], hasMore: boolean): UnreadDivider | null {
  if (!divider || divider.threadId !== threadId || divider.messageId) return divider;
  return unreadDividerFor(threadId, messages, divider.lastReadMessageId, hasMore);
}

export function threadReadCursor(bot: {
  threadId: string;
  tasks?: ReadonlyArray<{ threadId: string; lastReadMessageId?: string }> | null;
}): string | undefined {
  return bot.tasks?.find((task) => task.threadId === bot.threadId)?.lastReadMessageId;
}

/** The divider's message and every one after it, or null when the mounted
 * rows do not hold it. A list puts the divider above the first row that
 * draws one of these, so a hidden row under it does not lose it. */
export function unreadMessageIds(messages: readonly Pick<Line, "id">[], messageId: string | null): ReadonlySet<string> | null {
  if (!messageId) return null;
  const at = messages.findIndex((message) => message.id === messageId);
  return at < 0 ? null : new Set(messages.slice(at).map((message) => message.id));
}

/** Whether the conversation shown for this bot opens unread. A hidden
 * routine run is not a conversation, so it never does (#2007). */
export function threadOpensUnread(bot: {
  threadId: string;
  unread?: boolean;
  tasks?: ReadonlyArray<{ threadId: string; unread?: boolean; routineRunId?: string }> | null;
}): boolean {
  const task = bot.tasks?.find((candidate) => candidate.threadId === bot.threadId);
  if (task?.routineRunId) return false;
  return Boolean(task?.unread ?? bot.unread);
}

/** How long the divider stays once the person has caught up, then how long
 * it takes to fade and fold away. */
export const UNREAD_DIVIDER_LINGER_MS = 1200;
export const UNREAD_DIVIDER_FADE_MS = 480;
