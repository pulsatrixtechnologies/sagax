// The people a room's composer can tag with @, and which ones a draft tags:
// the rule the server notifies by (shared/person-mentions.ts,
// server/rooms/room-mentions.ts), against the names the room's People list shows.
import { MENTION_ALL, mentionedPeople } from "../../shared/person-mentions";
import { channelHumanRow, type OrgDirectoryPerson } from "./perspicax-org";
import type { MentionPeer } from "./mentions";

export { MENTION_ALL };

export interface RoomMentionPerson {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface MentionRoom {
  humanIds?: string[];
  dm?: boolean;
  peopleDm?: boolean;
  mentionAll?: boolean;
}

const key = (id: string) => id.trim().toLowerCase();

/** Whether @all reaches every person of this room: a room (not a direct
 * conversation) whose owner turned it on. */
export function roomAllowsMentionAll(room: MentionRoom): boolean {
  return !room.dm && !room.peopleDm && room.mentionAll === true;
}

/** Everyone in the room but the viewer, by the name the room shows them
 * under. A person without a name to show (the directory has not loaded)
 * is left out rather than offered as an id. */
export function roomMentionPeople(room: MentionRoom, people: ReadonlyMap<string, OrgDirectoryPerson>, viewerId: string | null | undefined): RoomMentionPerson[] {
  if (room.dm || room.peopleDm) return [];
  const viewer = viewerId ? key(viewerId) : "";
  const seen = new Set<string>();
  const out: RoomMentionPerson[] = [];
  for (const raw of room.humanIds ?? []) {
    const id = key(raw.replace(/^user:/, ""));
    if (!id || id === viewer || seen.has(id)) continue;
    seen.add(id);
    const row = channelHumanRow(id, people);
    if (!row.label || row.label === id) continue;
    out.push({ id, name: row.label, ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}) });
  }
  return out;
}

/** The ids of the people `text` tags in this room, as the server will
 * notify them: display names, and @all only when the room allows it. */
export function roomMentionedPeople(text: string, room: MentionRoom, people: ReadonlyMap<string, OrgDirectoryPerson>, viewerId: string | null | undefined): string[] {
  const candidates = roomMentionPeople(room, people, viewerId).map((person) => ({ id: person.id, names: [person.name] }));
  return mentionedPeople(text, candidates, { allowAll: roomAllowsMentionAll(room) });
}

/** The people of a room as mention peers for the transcript and the composer
 * (src/lib/mentions.ts): drawn as a chip, and the viewer's own as the one
 * that stands out. The viewer is part of the list so a tag of them shows. */
export function personMentionPeers(room: MentionRoomLike, people: ReadonlyMap<string, OrgDirectoryPerson>, viewerId: string | null | undefined): MentionPeer[] {
  const viewer = viewerId ? key(viewerId) : "";
  return roomMentionPeople(room, people, null).map((person) => ({ name: person.name, person: true, ...(viewer && key(person.id) === viewer ? { me: true } : {}) }));
}
type MentionRoomLike = Parameters<typeof roomMentionPeople>[0];
