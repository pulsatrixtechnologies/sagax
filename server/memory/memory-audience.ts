// Who may be shown a captured fact. The person chooses nothing here and no
// admin is added: the server stamps the place the fact was learned, and a
// wider place does not receive it.
//
// A line with no stamp was already visible to whoever could read the file.
// It stays. A stamp only refuses a later exit.

import { parseMemoryEntries } from "./memory-entries.ts";

export const MEMORY_READER_KINDS = ["person", "group", "room"] as const;
export type MemoryReaderKind = (typeof MEMORY_READER_KINDS)[number];

/** The readers a captured fact names. `person` is the bot's own person. */
export interface MemoryReaders {
  kind: MemoryReaderKind;
  /** A group or room id. Absent for a person's own fact. */
  id?: string;
}

/** Where a fact would be shown. `public` is wider than a person, a group or a room. */
export type MemoryDestination =
  | { kind: "person" }
  | { kind: "group" | "room"; id?: string }
  | { kind: "public" };

const READER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const READERS_MARK = / · readers (person|group:([A-Za-z0-9_-]{1,64})|room:([A-Za-z0-9_-]{1,64}))(?= · |$)/;

export function cleanReaderId(id: string | undefined): string | undefined {
  const cleaned = (id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return READER_ID.test(cleaned) ? cleaned : undefined;
}

/** The mark written into an entry, before the fact. A group or room with no
 * safe id is stamped as the person, so it cannot leave by accident. */
export function readersToken(readers: MemoryReaders): string {
  if (readers.kind === "person") return "readers person";
  const id = cleanReaderId(readers.id);
  if (!id) return "readers person";
  return `readers ${readers.kind}:${id}`;
}

/** The stamp on one line, or null when the line has none. */
export function memoryReadersOf(line: string): MemoryReaders | null {
  const match = READERS_MARK.exec(line);
  if (!match) return null;
  if (match[1] === "person") return { kind: "person" };
  if (match[2]) return { kind: "group", id: match[2] };
  if (match[3]) return { kind: "room", id: match[3] };
  return null;
}

/** Whether this fact may be shown there. No stamp: it stays. The person's
 * own turn sees their file. A person stamp does not enter a group, a room
 * or a public copy. A group or room stamp stays in that same place, and
 * still with the person, and does not cross to another place or go public. */
export function memoryMayShow(readers: MemoryReaders | null, destination: MemoryDestination): boolean {
  if (!readers) return true;
  if (destination.kind === "person") return true;
  if (destination.kind === "public") return false;
  if (readers.kind === "person") return false;
  if (readers.kind !== destination.kind) return false;
  if (readers.id && destination.id && readers.id !== destination.id) return false;
  return true;
}

/** Whether a search hit may be shown. The snippet is a cut of the line, so
 * the file decides: a `readers person` line does not come out in a room or
 * a group, and a line with no stamp stays. */
export function memoryHitMayShow(snippet: string, fileText: string | null, audience: MemoryDestination): boolean {
  if (audience.kind === "person") return true;
  const fromSnippet = memoryReadersOf(snippet);
  if (fromSnippet && !memoryMayShow(fromSnippet, audience)) return false;
  if (fileText == null) return true;
  const visible = withoutWiderAudience(fileText, audience).text.replace(/\s+/g, " ");
  const head = snippet.replace(/…[\s\S]*$/, "").replace(/\[([^[\]]+)\]/g, "$1").replace(/\s+/g, " ").trim().slice(0, 80);
  if (head.length >= 8) return visible.includes(head);
  const plain = snippet.replace(/\[([^[\]]+)\]/g, "$1").replace(/…/g, "").trim();
  if (!plain) return true;
  return fileText.split("\n").some((row) => row.includes(plain) && memoryMayShow(memoryReadersOf(row), audience));
}

/** The text a turn or a wider copy may see. The file is not changed.
 * Held entries, and the lines under them, are left out. */
export function withoutWiderAudience(text: string, destination: MemoryDestination): { text: string; held: number } {
  if (destination.kind === "person") return { text, held: 0 };
  const hidden = new Set<number>();
  let held = 0;
  for (const entry of parseMemoryEntries(text)) {
    if (memoryMayShow(memoryReadersOf(entry.raw), destination)) continue;
    held += 1;
    for (let line = entry.line; line < entry.end; line += 1) hidden.add(line);
  }
  if (!hidden.size) return { text, held: 0 };
  return { text: text.split("\n").filter((_, index) => !hidden.has(index)).join("\n"), held };
}
