// How often each conversation called each MCP tool, kept as the calls
// happen (#3679), for the compact prompt's pins (server/context/compact-prompt.ts).
//
// The pins used to be counted from the conversations' event logs on the
// turn's path, for every bot of the same owner: up to 40 x N logs, sealed
// blocks opened, the whole server stopped for seconds after a start. Now:
// - the bus (server/harness/bus.ts), the one writer of a conversation's
//   event log, moves the count forward after each append;
// - the count covers exactly what the log reader read (readToolRuns,
//   server/activity/activity.ts): the newest EVENTS_PER_THREAD events of the
//   log, no further back than MAX_TAIL_BYTES from its end, a tool started
//   twice counted once. Each kept start remembers where it is (its event's
//   ordinal and its line's byte offset), so it leaves the count when newer
//   events push it out of that window: a long-lived conversation pins its
//   recent use, never its lifetime total;
// - a log changed by anything else (the size cap, the at-rest migration, an
//   older build) no longer has the size the count expects: it is counted
//   again from the log itself;
// - each conversation's count is kept in its own small file, sealed at rest
//   under the conversation's key like the log (docs/content-encryption.md),
//   removed with the log (a deleted conversation, the retention sweep);
// - a conversation not counted yet (written before this count existed, or
//   not loaded since a start) is loaded or counted once in the background,
//   one conversation per slice, the event loop given back between them.
//   Until then a turn uses what is known.
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR, EVENTS_DIR } from "../config.ts";
import { contextFor, noteAtRestWrite, readAtRestTextSync, registerAtRestRoot, sealingKey, type ContentScope } from "../encryption/content-at-rest.ts";
import { BLOCK_PREFIX, sealBuffer } from "../encryption/content-file-crypto.ts";
import { yieldToEventLoop } from "../harness/http.ts";
import { isRuntimeEvent, MAX_TAIL_BYTES, readRecentLines } from "../threads/thread-events.ts";
import { threadLogsForgotten } from "../threads/forgotten-threads.ts";
import { EVENTS_PER_THREAD, toolLinesOnly, toolRunKey } from "./activity.ts";

const DIR_NAME = "tool-uses";
const THREAD_ID = /^[\w.-]{1,200}$/;
const THREAD_FILE = /^[\w.-]{1,200}\.json$/;
/** Conversations kept in memory; one that falls out is loaded again from its file. */
const KEPT = 8192;
const SAVE_MS = 5_000;
const LOAD_TRIES = 5;

export type ToolCounts = Readonly<Record<string, number>>;
interface Use { i: number; at: number; name: string; key: string }
interface Entry {
  /** valid events counted so far (ordinals are relative to the first one read) */
  n: number;
  /** the log's size this count stands for; -1: not readable now, never kept */
  size: number;
  /** the MCP tool starts inside the window, oldest first */
  uses: Use[];
  byKey: Map<string, Use>;
  counts: Record<string, number> | null;
}

export const toolUsesDir = (): string => join(DATA_DIR, DIR_NAME);
const fileOf = (threadId: string) => join(toolUsesDir(), `${threadId}.json`);
const logOf = (threadId: string) => join(EVENTS_DIR, `${threadId}.ndjson`);
const counted = (name: string) => name.startsWith("mcp__");

function listThreadIds(): string[] {
  try {
    return readdirSync(toolUsesDir()).filter((name) => THREAD_FILE.test(name)).map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}

// sealed at rest under the conversation's key, like its log; the at-rest
// migration looks after a file written plain (encryption off, key not there yet)
registerAtRestRoot({
  id: DIR_NAME,
  dir: toolUsesDir(),
  context: (relativePath) => `${DIR_NAME}/${relativePath}`,
  files: () => listThreadIds().map((threadId) => ({ path: fileOf(threadId), scope: { thread: threadId } as ContentScope })),
});

const entries = new Map<string, Entry>();
const unsaved = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const loading = new Map<string, number>();
let loader: Promise<void> | null = null;
/** Bytes of conversation logs read to count (tests: none on a turn's path). */
let logBytesRead = 0;

const emptyEntry = (size: number): Entry => ({ n: 0, size, uses: [], byKey: new Map(), counts: null });

/** A start out of the reader's window leaves the count. */
function prune(entry: Entry): void {
  const minI = entry.n - EVENTS_PER_THREAD;
  const minAt = entry.size - MAX_TAIL_BYTES;
  let drop = 0;
  while (drop < entry.uses.length && (entry.uses[drop]!.i <= minI || entry.uses[drop]!.at <= minAt)) drop++;
  if (!drop) return;
  for (const use of entry.uses.splice(0, drop)) entry.byKey.delete(use.key);
  entry.counts = null;
}

/** One valid event of the log, as readToolRuns reads it: a tool start
 * written again for the same run replaces the first one. */
function addEvent(entry: Entry, event: Record<string, unknown>, at: number): void {
  entry.n++;
  if (event.type !== "item.started" || event.itemType !== "tool") return;
  const key = toolRunKey(event as { turnId?: string; itemId?: string; eventId: string });
  const name = typeof event.title === "string" ? event.title : "unknown";
  const before = entry.byKey.get(key);
  if (before) {
    entry.uses.splice(entry.uses.indexOf(before), 1);
    entry.byKey.delete(key);
    entry.counts = null;
  }
  if (!counted(name)) return;
  const use = { i: entry.n, at, name, key };
  entry.uses.push(use);
  entry.byKey.set(key, use);
  entry.counts = null;
}

function keep(threadId: string, entry: Entry, changed: boolean): void {
  entries.delete(threadId);
  entries.set(threadId, entry);
  if (changed && entry.size >= 0) {
    unsaved.add(threadId);
    if (!saveTimer) {
      saveTimer = setTimeout(saveToolUses, SAVE_MS);
      saveTimer.unref?.();
    }
  }
  // least recently used first: its file keeps it
  while (entries.size > KEPT) {
    const oldest = entries.keys().next().value!;
    if (unsaved.has(oldest)) saveOne(oldest);
    entries.delete(oldest);
  }
}

function saveOne(threadId: string): void {
  unsaved.delete(threadId);
  const entry = entries.get(threadId);
  if (!entry || entry.size < 0 || threadLogsForgotten(threadId)) return;
  const path = fileOf(threadId);
  try {
    const plain = Buffer.from(JSON.stringify({ v: 1, n: entry.n, size: entry.size, uses: entry.uses.map((use) => [use.i, use.at, use.name, use.key]) }), "utf8");
    const scope: ContentScope = { thread: threadId };
    const key = sealingKey(scope);
    mkdirSync(toolUsesDir(), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, key ? sealBuffer(key, contextFor(path), plain) : plain, { mode: 0o600, durable: false });
    if (!key) noteAtRestWrite(path, scope);
  } catch {
    /* not saved (a key locked on this launch, a disk error): counted again from the log */
  }
}

/** Writes the counts changed since the last save (on a timer, and at exit). */
export function saveToolUses(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  for (const threadId of unsaved) saveOne(threadId);
}
process.once("exit", saveToolUses);

function readStored(threadId: string): Entry | null {
  let stored: unknown;
  try {
    stored = JSON.parse(readAtRestTextSync(fileOf(threadId)));
  } catch {
    return null;
  }
  const value = stored as { v?: unknown; n?: unknown; size?: unknown; uses?: unknown } | null;
  if (!value || value.v !== 1 || typeof value.n !== "number" || typeof value.size !== "number" || !Array.isArray(value.uses)) return null;
  const entry = emptyEntry(value.size);
  entry.n = value.n;
  for (const row of value.uses) {
    if (!Array.isArray(row) || typeof row[0] !== "number" || typeof row[1] !== "number" || typeof row[2] !== "string" || typeof row[3] !== "string") return null;
    const use = { i: row[0], at: row[1], name: row[2], key: row[3] };
    entry.uses.push(use);
    entry.byKey.set(use.key, use);
  }
  return entry;
}

const logSize = (threadId: string): number | null => {
  try { return statSync(logOf(threadId)).size; } catch { return null; }
};

/** Loads or counts one conversation; false: its log changed during the read. */
function loadNow(threadId: string): boolean {
  if (entries.has(threadId) || threadLogsForgotten(threadId)) return true;
  const size = logSize(threadId);
  if (size === null) {
    // no log: nothing to count, and nothing kept on disk
    keep(threadId, emptyEntry(0), false);
    return true;
  }
  const stored = readStored(threadId);
  if (stored && stored.size === size) {
    keep(threadId, stored, false);
    return true;
  }
  const at = { size: 0, offsets: [] as number[] };
  let events: Record<string, unknown>[];
  try {
    events = readRecentLines(logOf(threadId), EVENTS_PER_THREAD, isRuntimeEvent, toolLinesOnly, at).lines as unknown as Record<string, unknown>[];
  } catch {
    // a key locked on this launch: nothing counted, as the log reader read
    // nothing, and counted again at the next append
    keep(threadId, emptyEntry(-1), false);
    return true;
  }
  logBytesRead += at.size;
  if (logSize(threadId) !== at.size) return false;
  const entry = emptyEntry(at.size);
  events.forEach((event, index) => addEvent(entry, event, at.offsets[index]!));
  prune(entry);
  keep(threadId, entry, true);
  return true;
}

function queueLoad(threadId: string): void {
  if (loading.has(threadId) || entries.has(threadId)) return;
  loading.set(threadId, 0);
  loader ??= (async () => {
    try {
      while (loading.size) {
        await yieldToEventLoop();
        const [threadId, tries] = loading.entries().next().value!;
        loading.delete(threadId);
        if (!loadNow(threadId) && tries + 1 < LOAD_TRIES) loading.set(threadId, tries + 1);
      }
    } finally {
      loader = null;
    }
  })();
}

/** The bus appended `lines` (one per record, as written) to a conversation's
 * log, and the size cap ran: each valid event moves its count forward. */
export function toolUsesAppended(threadId: string, records: readonly Record<string, unknown>[], lines: readonly string[]): void {
  if (!THREAD_ID.test(threadId) || threadLogsForgotten(threadId)) return;
  try {
    moveForward(threadId, records, lines);
  } catch {
    // never the append's failure: counted again from the log
    entries.delete(threadId);
    unsaved.delete(threadId);
  }
}

function moveForward(threadId: string, records: readonly Record<string, unknown>[], lines: readonly string[]): void {
  let bytes = 0;
  const lengths = lines.map((line) => {
    const length = Buffer.byteLength(line, "utf8") + 1;
    bytes += length;
    return length;
  });
  const size = logSize(threadId);
  let entry = entries.get(threadId);
  if (!entry) {
    const stored = readStored(threadId);
    if (stored && size !== null && stored.size + bytes === size) entry = stored;
    // a log this append started is counted from here
    else if (!stored && size === bytes) entry = emptyEntry(0);
  }
  if (!entry || size === null || entry.size + bytes !== size || records.length !== lines.length) {
    // the log is not what this count stands for: counted again from it
    entries.delete(threadId);
    unsaved.delete(threadId);
    queueLoad(threadId);
    return;
  }
  let at = entry.size;
  records.forEach((record, index) => {
    const line = lines[index]!;
    // a sealed line not opened by the reader counts by its clear fields
    const projected = line.startsWith(BLOCK_PREFIX) && toolLinesOnly({ type: record.type, itemType: record.itemType });
    if (projected || isRuntimeEvent(record)) addEvent(entry!, record, at);
    at += lengths[index]!;
  });
  entry.size = size;
  prune(entry);
  keep(threadId, entry, true);
}

/** The MCP tool calls counted in a conversation's window, or undefined while
 * its count is not known yet (then loaded or counted in the background).
 * Memory only: never a disk read. */
export function toolUsesOf(threadId: string): ToolCounts | undefined {
  const entry = entries.get(threadId);
  if (!entry) {
    if (THREAD_ID.test(threadId)) queueLoad(threadId);
    return undefined;
  }
  if (!entry.counts) {
    const counts: Record<string, number> = {};
    for (const use of entry.uses) counts[use.name] = (counts[use.name] ?? 0) + 1;
    entry.counts = counts;
  }
  return entry.counts;
}

/** A conversation's log is gone (deleted, swept): its count goes with it. */
export function forgetToolUses(threadId: string): void {
  if (!THREAD_ID.test(threadId)) return;
  entries.delete(threadId);
  unsaved.delete(threadId);
  loading.delete(threadId);
  try { rmSync(fileOf(threadId), { force: true }); } catch { /* left for the next delete */ }
}

/** Tests: bytes of conversation logs read so far to count tool use. */
export function toolUsesLogBytesRead(): number {
  return logBytesRead;
}

/** Tests: the background loading, settled. */
export async function toolUsesSettled(): Promise<void> {
  while (loader) await loader;
}

/** Tests: what a restart forgets (the stored counts stay on disk). */
export function forgetToolUsesInMemory(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  unsaved.clear();
  entries.clear();
  loading.clear();
}
