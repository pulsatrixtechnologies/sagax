// Direct conversations between two people of an organization.
//
// A person-to-person conversation is a group record with `peopleDm: true`,
// exactly two `humanIds` (principal ids) and no bot. It reuses the group's
// thread, messages, live frames and unread flag, and nothing else:
//
// - Only its two people read it, list it, stream it, search it or export it.
//   No organization admin, no team, no section and not the operator at the
//   server's console (loopback): a private conversation stays private.
// - It stays people-only. No bot can be added, so nothing said there can
//   reach a bot's context, memory or its owner. Inviting a bot would need
//   both people to agree, and the first such bot would carry the transcript
//   to its own owner; a group chat already is the place for that.
// - Its people, name, section, folder and instructions never change, and it
//   has no shared memory (server/memory/group-memory.ts). Unread and the home pin
//   are display flags, the same ones a member already sets on a room.
// - A message is a person's message: it starts no turn, marks the
//   conversation unread and notifies the other person only.
// - Threads (2026-10-09): it has threads like a bot, through the room task
//   routes (create, switch, rename, pin, archive, snooze, folder, delete) and
//   the room folder routes. A thread belongs to the pair: both see the same
//   list, titles, pins, folders, archive and snooze. Which thread each one
//   has open is theirs (an in-memory selection, like a bot's on an
//   organization server), and so is unread, per thread (`unreadFor`).
//   The stored `threadId` stays the default thread, so a client from before
//   threads (0.4.16) keeps reading and writing that one conversation.
//   Only a request that says it knows threads (the header below) is answered
//   with its own selection; a live frame always carries the default thread,
//   and such a client keeps the thread it has open. The thread from before
//   threads is titled "General" by the migration (`general: true`).

/** The part of a group record these rules read. */
export interface PeopleDmLike {
  peopleDm?: boolean;
  humanIds?: string[];
}

const key = (id: string) => id.trim().toLowerCase();

/** One of the two people of this conversation. */
export function isPeopleDmParticipant(group: PeopleDmLike, viewerId: string | undefined): boolean {
  if (!viewerId || !group.peopleDm) return false;
  const viewer = key(viewerId);
  return (group.humanIds ?? []).some((id) => key(id) === viewer);
}

/** The conversation these two people already have, if any (order-free). */
export function findPeopleDm<T extends PeopleDmLike>(groups: readonly T[], a: string, b: string): T | undefined {
  const pair = new Set([key(a), key(b)]);
  return groups.find((group) => {
    if (!group.peopleDm) return false;
    const ids = new Set((group.humanIds ?? []).map(key));
    return ids.size === pair.size && [...pair].every((id) => ids.has(id));
  });
}

/** The other person of the conversation, for the one viewing it. */
export function otherPerson(group: PeopleDmLike, viewerId: string): string | undefined {
  const viewer = key(viewerId);
  return (group.humanIds ?? []).find((id) => key(id) !== viewer);
}

/** Mark the conversation unread (or read) for ONE of its two people. The
 * shared `unread` flag stays true while anyone still has it unread, for the
 * clients that read it as it was before. */
export function peopleDmUnreadPatch(
  group: { unreadFor?: readonly string[] },
  personId: string,
  unread: boolean,
): { unread: boolean; unreadFor: string[] } {
  const people = new Set((group.unreadFor ?? []).map(key).filter(Boolean));
  const person = key(personId);
  if (person) {
    if (unread) people.add(person);
    else people.delete(person);
  }
  const unreadFor = [...people].sort();
  return { unread: unreadFor.length > 0, unreadFor };
}

/** The part of a thread these rules read and project. */
export interface PeopleDmThreadLike {
  threadId: string;
  unread?: boolean;
  unreadFor?: string[];
}

/** The conversation as one person sees it: their own unread state, per
 * thread too, and not who else has read it. A conversation from before
 * `unreadFor` existed keeps its shared flag. `selectedThreadId` is the thread
 * this person has open, when their client knows threads and it still exists:
 * it replaces the default `threadId`. Anything else is returned as it is. */
export function peopleDmForViewer<T extends { peopleDm?: boolean; unread?: boolean; unreadFor?: string[]; threadId?: string; tasks?: PeopleDmThreadLike[] }>(
  group: T,
  viewerId: string | undefined,
  selectedThreadId?: string,
): T {
  const viewer = viewerId ? key(viewerId) : "";
  const unreadFor = (ids: readonly string[]) => Boolean(viewer) && ids.some((id) => key(id) === viewer);
  if (!group.peopleDm) {
    // A room: `unreadFor` holds the people tagged with @ who have not read
    // it yet (server/room-mentions.ts). Unread for them whatever the shared
    // flag says; nobody learns who else is on the list.
    if (!Array.isArray(group.unreadFor)) return group;
    const { unreadFor: ids, ...rest } = group;
    return { ...rest, unread: Boolean(group.unread) || unreadFor(ids) } as T;
  }
  let out: T = group;
  if (Array.isArray(group.unreadFor)) {
    const { unreadFor: ids, ...rest } = group;
    out = { ...rest, unread: unreadFor(ids) } as T;
  }
  // Every thread says whether it is unread for this person (false when
  // nobody has it unread), the same flag a bot thread carries.
  if (Array.isArray(group.tasks)) {
    out = {
      ...out,
      tasks: group.tasks.map((task) => {
        const { unreadFor: ids, ...rest } = task;
        return { ...rest, unread: unreadFor(ids ?? []) };
      }),
    };
  }
  if (selectedThreadId && selectedThreadId !== group.threadId && (group.tasks ?? []).some((task) => task.threadId === selectedThreadId)) {
    out = { ...out, threadId: selectedThreadId };
  }
  return out;
}

/** Mark ONE thread of a person conversation unread (or read) for one of its
 * two people. The conversation's own flag (`unreadFor` on the group) stays
 * set while that person has any thread unread, so a client from before
 * threads still shows the dot. `threadId` absent (read): every thread is
 * read for them, which is what the route from before threads meant. */
export function peopleDmThreadUnreadPatch<K extends PeopleDmThreadLike>(
  group: { unreadFor?: readonly string[]; tasks?: readonly K[] },
  personId: string,
  unread: boolean,
  threadId?: string,
): { unread: boolean; unreadFor: string[]; tasks: K[] } {
  const person = key(personId);
  const tasks = (group.tasks ?? []).map((task) => {
    if (threadId !== undefined && task.threadId !== threadId) return task;
    const people = new Set((task.unreadFor ?? []).map(key).filter(Boolean));
    if (person) {
      if (unread) people.add(person);
      else people.delete(person);
    }
    const { unreadFor: _old, ...rest } = task;
    return (people.size > 0 ? { ...rest, unreadFor: [...people].sort() } : rest) as K;
  });
  const stillUnread = tasks.some((task) => (task.unreadFor ?? []).some((id) => key(id) === person));
  // A conversation that never had per-thread state yet (a mark on the
  // whole conversation, or a record from before threads) keeps the
  // conversation's own flag for that person.
  const conversation = peopleDmUnreadPatch(group, personId, unread || stillUnread);
  return { ...conversation, tasks };
}

/** A person conversation's threads are a pair's: a selection per person,
 * kept in memory like a bot's per-viewer selection. A server restart opens
 * the default thread again, which is never wrong. */
export class PeopleDmSelections {
  private readonly selected = new Map<string, string>();

  private static id(groupId: string, personId: string) {
    return `${groupId}\0${key(personId)}`;
  }

  get(groupId: string, personId: string | undefined): string | undefined {
    return personId ? this.selected.get(PeopleDmSelections.id(groupId, personId)) : undefined;
  }

  set(groupId: string, personId: string | undefined, threadId: string): void {
    if (!personId) return;
    if (this.selected.size >= 50_000) this.selected.clear();
    this.selected.set(PeopleDmSelections.id(groupId, personId), threadId);
  }

  /** A deleted thread is nobody's selection any more. */
  forgetThread(threadId: string): void {
    for (const [id, selected] of this.selected) if (selected === threadId) this.selected.delete(id);
  }
}

/** The title the migration gives the thread that was the whole conversation
 * before threads. Clients may show it localized while it is unchanged. */
export const PEOPLE_DM_GENERAL_TITLE = "General";

/** Migrate one person conversation to threads, once (`personThreads`): the
 * conversation it was becomes its first thread, titled "General", marked
 * `general`, with every message where it was (the thread id does not
 * change, so nothing moves on disk). The group keeps that thread as its
 * `threadId`. Returns whether anything changed. Idempotent. */
export function migratePeopleDmToThreads(group: {
  peopleDm?: boolean;
  personThreads?: 1;
  threadId: string;
  createdAt: number;
  tasks?: Array<{ threadId: string; title: string; createdAt: number; updatedAt?: number; general?: true }>;
}): boolean {
  if (!group.peopleDm || group.personThreads === 1) return false;
  const tasks = group.tasks ?? [];
  const first = tasks.find((task) => task.threadId === group.threadId);
  if (first) {
    first.title = PEOPLE_DM_GENERAL_TITLE;
    first.general = true;
  } else {
    tasks.unshift({ threadId: group.threadId, title: PEOPLE_DM_GENERAL_TITLE, createdAt: group.createdAt, updatedAt: group.createdAt, general: true });
  }
  group.tasks = tasks;
  group.personThreads = 1;
  return true;
}

/** A client that knows a person conversation has threads says so on its
 * requests, and only then is it answered with its own open thread instead
 * of the default one. */
export const PEOPLE_DM_THREADS_HEADER = "x-sagax-person-threads";

/** A PATCH on a person-to-person conversation may only mark it read or
 * unread, or set its home pin. Anything else is refused with the field's
 * name. */
export function peopleDmPatchRefusal(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const field = Object.keys(body).find((name) => name !== "unread" && name !== "pinned");
  return field ?? null;
}

/** Whether a directory entry may be written to: an active person, not a
 * service account, and not the one asking. */
export function peopleDmCandidate(entry: { principalId: string; disabled?: boolean; service?: boolean }, selfId: string): boolean {
  return !entry.disabled && !entry.service && key(entry.principalId) !== key(selfId);
}

/** The routes a person-to-person conversation answers besides reads: a
 * message, a read receipt (unread flag and read position), an emoji
 * reaction on one of its messages, a PATCH that only
 * marks it (checked by peopleDmPatchRefusal), and its threads and folders
 * like a bot's (create, switch, rename, pin, archive, snooze, move, delete;
 * folder create, edit, order, delete). Anything else (setup, members, queue,
 * interrupt, a generated title, deleting the conversation) is refused: a
 * generated title would send the pair's words to a model. */
export function peopleDmRouteRefusal(method: string, path: string): string | null {
  if (method === "GET" || method === "HEAD") return null;
  if (method === "POST" && /^\/api\/groups\/[\w-]+\/(?:messages|read)$/.test(path)) return null;
  if (method === "POST" && /^\/api\/threads\/[\w-]+\/read$/.test(path)) return null;
  if (method === "POST" && /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/reactions$/.test(path)) return null;
  // App Store 1.2: either person reports the other's message (routes/moderation.ts)
  if (method === "POST" && /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/report$/.test(path)) return null;
  if (method === "PATCH" && /^\/api\/groups\/[\w-]+$/.test(path)) return null;
  if (method === "POST" && /^\/api\/groups\/[\w-]+\/(?:tasks|projects)$/.test(path)) return null;
  if ((method === "POST" || method === "PATCH" || method === "DELETE") && /^\/api\/groups\/[\w-]+\/tasks\/[\w-]+$/.test(path)) return null;
  if ((method === "PATCH" || method === "DELETE") && /^\/api\/groups\/[\w-]+\/projects\/[\w-]+$/.test(path)) return null;
  return "A conversation between two people only takes messages and threads.";
}
