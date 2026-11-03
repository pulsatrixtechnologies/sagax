// Which people a room message tags with @: the same recognition as a bot
// tag (shared/mention-boundary.ts), against the display names of the
// people in the room. The server notifies them (server/rooms/room-mentions.ts);
// the composer offers them and the transcript highlights them
// (src/lib/person-mentions.ts).
//
// `@all` tags every person in the room only when the room allows it (its
// `mentionAll` setting, off by default): a busy room should not ring
// everyone's phone because one person typed four letters. Off, `@all` tags
// nobody, and a person whose name is "all" is never told apart from it.
import { isMentionBoundary, isMentionNameContinuation } from "./mention-boundary.ts";

/** The tag that reaches every person of a room that allows it. */
export const MENTION_ALL = "all";

export interface MentionablePerson {
  id: string;
  /** The names this person answers to (display name first); blank ones are skipped. */
  names: readonly string[];
}

/** The ids of the people `text` tags, in the order they are first tagged,
 * each once. `@` must start a word, the name must end on a word boundary,
 * names match case-insensitively and the longest name wins (so "@Ann Lee"
 * never stops at "Ann"). */
export function mentionedPeople(text: string, people: readonly MentionablePerson[], options: { allowAll?: boolean } = {}): string[] {
  const candidates = people
    .flatMap((person) => person.names.map((name) => ({ id: person.id, name: name.trim() })))
    .filter((candidate) => candidate.name && candidate.name.toLowerCase() !== MENTION_ALL)
    .sort((a, b) => b.name.length - a.name.length);
  const found: string[] = [];
  const add = (id: string) => {
    if (!found.includes(id)) found.push(id);
  };
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (!isMentionBoundary(text, at)) continue;
    const rest = text.slice(at + 1);
    const hit = candidates.find(({ name }) => rest.slice(0, name.length).toLowerCase() === name.toLowerCase()
      && !isMentionNameContinuation(rest.slice(name.length)));
    if (hit) {
      add(hit.id);
      continue;
    }
    if (options.allowAll && rest.slice(0, MENTION_ALL.length).toLowerCase() === MENTION_ALL && !isMentionNameContinuation(rest.slice(MENTION_ALL.length))) {
      for (const person of people) add(person.id);
    }
  }
  return found;
}
