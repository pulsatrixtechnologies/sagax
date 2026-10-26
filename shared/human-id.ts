// JC 2026-10-19: "N'affiche JAMAIS des GUID, on ne comprend rien." Nothing
// the app draws as text shows a UUID/GUID or another opaque identifier: a
// person reads a human label (a name, a place, a folder, a kind of thing),
// and the identifier lives only in a tooltip or a Copy action for support.
// These helpers recognise such identifiers so a label can be chosen instead,
// and back the test guard that fails when one reaches visible text.

/** A UUID/GUID, whole or cut short by an ellipsis or a slice (its first
 * three groups are enough to be unreadable). */
export const UUID_FRAGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,12})?)?/i;

const WHOLE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Long hex (an object id, a digest) or a prefixed random id. */
const LONG_HEX = /^[0-9a-f]{20,}$/i;
const PREFIXED_ID = /^[a-z]{1,12}[-_](?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|(?=[0-9a-z]*\d)[0-9a-z]{20,})$/i;
/** A random token with no separator: digits and both cases mixed
 * ("21m00Tcm4TlvDq8ikWAM"), which no name looks like. */
const RANDOM_TOKEN = /^(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{16,}$/;

/** Whether `value` is an identifier a person cannot read (a UUID, a long
 * hex id, "draft-<uuid>"), as opposed to a name. */
export function isOpaqueId(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return WHOLE_UUID.test(text) || LONG_HEX.test(text) || PREFIXED_ID.test(text) || RANDOM_TOKEN.test(text);
}

/** Whether `text` shows a UUID/GUID anywhere, whole or truncated. */
export function containsUuid(text: string): boolean {
  return UUID_FRAGMENT.test(text);
}

/** `value` when it is a readable name, otherwise `fallback`: for a name
 * field that may hold an id (an unnamed record named after its id). */
export function readableOr(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  return text && !isOpaqueId(text) && !containsUuid(text) ? text : fallback;
}

/** The folders Sagax makes and names after ids: a conversation's own folder
 * (task-workspaces/<bot>/<thread>), a parallel task's worktree
 * (parallel-worktrees/<bot>/<thread>) and a bot's own folder
 * (workspaces/<bot>). */
export type SagaxFolderKind = "conversation" | "parallel" | "bot";

/** Which Sagax-made folder `path` is in, and the path below it; null for
 * any other folder. */
export function sagaxFolder(path: string): { kind: SagaxFolderKind; rest: string[] } | null {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if ((part === "task-workspaces" || part === "parallel-worktrees") && parts[index + 2] !== undefined && isOpaqueId(parts[index + 2]!)) {
      return { kind: part === "task-workspaces" ? "conversation" : "parallel", rest: parts.slice(index + 3) };
    }
    if (part === "workspaces" && parts[index + 1] !== undefined && isOpaqueId(parts[index + 1]!)) {
      return { kind: "bot", rest: parts.slice(index + 2) };
    }
  }
  return null;
}

/** For server text a person may read (an error in the chat, a toast): an id
 * that is a readable name stays, quoted; an opaque one gives way to
 * `phrase` ("the selected engine"). */
export function quotedIdOr(id: string, phrase: string): string {
  return isOpaqueId(id) || containsUuid(id) ? phrase : `"${id}"`;
}
