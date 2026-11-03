// Who wrote each line of a group chat, as the viewer sees it. A group reads
// like any chat app: your own lines on the end side in your bubble, every
// other person on the start side with their avatar and name, bots on the
// start side with their mascot. Consecutive lines from one author a few
// minutes apart form a run that shows the name and avatar once.
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { otherAuthorName } from "@/lib/viewer";
import type { ConfigStatus, Message } from "@/state/store";

/** Lines further apart than this start a new run (name and avatar again). */
export const RUN_GAP_MS = 5 * 60_000;

export type RoomAuthor =
  | { kind: "self"; key: "self" }
  | { kind: "person"; key: string; name: string; initials: string; avatarUrl?: string; personId?: string }
  | { kind: "bot"; key: string }
  | { kind: "none"; key: string };

/** The part of an address before the @, or the value itself. */
export function emailLocalPart(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

/** Mirrors personDisplayName in server/people/viewer-identity.ts: the Perspicax
 * display name, else the address's local part, else the login. A name equal
 * to the login (the directory's own fallback) is not a display name. */
export function personDisplayName(person: { name?: string; email?: string; login?: string } | null | undefined): string {
  const name = person?.name?.trim() ?? "";
  const login = person?.login?.trim() ?? "";
  if (name && name !== login) return name;
  return emailLocalPart(person?.email) || login || name;
}

/** "Sam Taylor" gives "ST", "sam.t@x.ca" gives "ST", "" gives "?". */
export function personInitials(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("");
  return letters.toUpperCase() || "?";
}

/** Whether a line is the viewer's own: a person's line nobody else is named
 * on (older servers that send no viewer keep every person line as yours). */
export function isOwnMessage(message: Pick<Message, "role" | "sender">, config: ConfigStatus | null | undefined): boolean {
  return message.role === "user" && otherAuthorName(message, config) === null;
}

/** The author of one line, with the person's directory name and avatar. */
export function roomAuthor(
  message: Pick<Message, "role" | "sender" | "from">,
  config: ConfigStatus | null | undefined,
  people: ReadonlyMap<string, OrgDirectoryPerson>,
): RoomAuthor {
  if (message.role === "user") {
    const other = otherAuthorName(message, config);
    if (other === null) return { kind: "self", key: "self" };
    const sender = message.sender;
    if (!sender) {
      return { kind: "person", key: "person:operator", name: other, initials: personInitials(other) };
    }
    const id = sender.id?.trim().toLowerCase() ?? "";
    const person = id ? people.get(id) : undefined;
    const name = (person && personDisplayName(person)) || emailLocalPart(other) || other;
    const avatarUrl = personAvatarSrc(person?.avatarUrl);
    return {
      kind: "person",
      key: `person:${id || other.toLowerCase()}`,
      name,
      initials: personInitials(name),
      // a person of the directory: their name opens the person panel
      ...(person ? { personId: person.principalId } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }
  if (message.from?.botId) return { kind: "bot", key: `bot:${message.from.botId}` };
  return { kind: "none", key: `role:${message.role}` };
}

/** Whether `next` continues the run `prev` started: same author, same day,
 * within RUN_GAP_MS, and `prev` is an ordinary line (not a bot exchange). */
export function continuesRun(
  prev: { at: number; comm?: unknown; author: RoomAuthor } | undefined,
  next: { at: number; author: RoomAuthor },
): boolean {
  if (!prev || prev.comm) return false;
  if (prev.author.key !== next.author.key) return false;
  if (new Date(prev.at).toDateString() !== new Date(next.at).toDateString()) return false;
  return next.at - prev.at <= RUN_GAP_MS;
}

/** Bubble corners for a line in a run: the corner on the author's side
 * tightens where the run continues above or below. `end` is the viewer's
 * side; logical corners keep it right in RTL. */
export function runCorners(side: "start" | "end", joinsAbove: boolean, joinsBelow: boolean): string {
  const corners: string[] = [];
  if (joinsAbove) corners.push(side === "end" ? "rounded-se-[6px]" : "rounded-ss-[6px]");
  if (joinsBelow) corners.push(side === "end" ? "rounded-ee-[6px]" : "rounded-es-[6px]");
  return corners.join(" ");
}
