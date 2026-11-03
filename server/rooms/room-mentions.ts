// A person tagged with @ in a room hears about it the way a direct message
// reaches them (server/index.ts sendPeopleDmMessage): one `notify` frame of
// kind "message" whose `audience` is the people tagged, with the room and
// the thread as its target. Everything after is the direct message's path:
// the stream delivers it to that audience only (scopeChannelApproval), the
// desktop shows it with the person's own Settings > Notifications (sound,
// sticky, Dock bounce; src/lib/attention.ts), a click opens the room's
// thread (src/state/store.tsx openNotificationTarget), and the phone gets an
// APNs push when no open client of theirs saw the room in time
// (server/push/decide.ts).
//
// A room message that tags nobody keeps the room's rules: no notification
// for the people in it. A conversation between two people is not handled
// here (it notifies the other person on every message).
import { mentionedPeople, type MentionablePerson } from "../../shared/person-mentions.ts";
import { summarize, type Notification } from "../notify.ts";

export interface MentionRoom {
  id: string;
  name: string;
  humanIds?: readonly string[];
  peopleDm?: boolean;
  dm?: boolean;
  mentionAll?: boolean;
}

const key = (id: string) => id.trim().toLowerCase();

/** The notification for the people a room message tags, or null when it
 * tags nobody (the sender never counts). `people` are the room's people
 * with the names they answer to. */
export function roomMentionNotification(input: {
  room: MentionRoom;
  threadId: string;
  text: string;
  sender: { principalId: string; name: string; avatarUrl?: string };
  people: readonly MentionablePerson[];
  /** A people-only group (no bot, #1150): every message reaches the other
   * people, as in a direct message, not only the ones tagged. */
  everyone?: boolean;
}): Notification | null {
  const { room, sender } = input;
  if (room.peopleDm || room.dm || !sender.principalId || !sender.name) return null;
  const inRoom = new Set((room.humanIds ?? []).map(key));
  const others = input.people.filter((person) => inRoom.has(key(person.id)) && key(person.id) !== key(sender.principalId));
  const audience = input.everyone
    ? [...new Set(others.map((person) => key(person.id)).filter((id) => !id.startsWith("team:")))]
    : mentionedPeople(input.text, others, { allowAll: room.mentionAll === true }).map(key);
  if (!audience.length) return null;
  return {
    kind: "message",
    botId: "",
    botName: sender.name,
    threadId: input.threadId,
    groupId: room.id,
    title: `${sender.name} in ${room.name}`,
    body: summarize(input.text),
    audience,
    ...(sender.avatarUrl ? { avatarUrl: sender.avatarUrl } : {}),
  };
}

/** A room read by one person: their tag is read too. The others tagged keep
 * theirs (the room's shared `unread` flag is anyone's, a tag is its person's). */
export function roomMentionReadPatch(room: { peopleDm?: boolean; unreadFor?: readonly string[] } | null | undefined, reader: string | undefined): { unreadFor?: string[] } {
  if (!room || room.peopleDm || !reader || !room.unreadFor?.length) return {};
  const left = room.unreadFor.filter((id) => key(id) !== key(reader));
  if (left.length === room.unreadFor.length) return {};
  return { unreadFor: left.length ? left : undefined } as { unreadFor?: string[] };
}
