// Messages accepted into a running turn (steered) that the engine process
// still holds. Durable at acceptance so a crash or stop can resume them
// exactly once: either folded into the cut-turn resume prompt, or as one
// follow-up turn when no resume was scheduled (consistent with busy lines
// draining as one follow-up).
//
// Lives under DATA_DIR/held-steers/<threadId>.json and is sealed at rest
// under the thread's content key (docs/content-encryption.md; same pattern
// as video-jobs): write plain + noteAtRestWrite, read via readAtRestTextSync.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { noteAtRestWrite, readAtRestTextSync, registerAtRestRoot, type ContentScope } from "./content-at-rest.ts";

export interface HeldSteer {
  botId: string;
  threadId: string;
  messageId: string;
  /** The words as the person sent them (or the prompt form used at steer). */
  text: string;
  at: number;
}

const DIR_NAME = "held-steers";
const LEGACY_FILE = "held-steers.json";
const MAX = 200;
const THREAD_ID = /^[\w.-]{1,200}$/;
const THREAD_FILE = /^[\w.-]{1,200}\.json$/;

export function heldSteersDir(dataDir: string): string {
  return join(dataDir, DIR_NAME);
}

function assertThreadId(threadId: string): void {
  if (!THREAD_ID.test(threadId)) throw new Error("invalid thread id for held steers");
}

function pathOf(dataDir: string, threadId: string): string {
  assertThreadId(threadId);
  return join(heldSteersDir(dataDir), `${threadId}.json`);
}

function ensureDir(dataDir: string): void {
  mkdirSync(heldSteersDir(dataDir), { recursive: true, mode: 0o700 });
}

function parseSteers(parsed: unknown): HeldSteer[] {
  const rows = (parsed as { steers?: unknown } | null)?.steers;
  if (!Array.isArray(rows)) return [];
  const out: HeldSteer[] = [];
  const seen = new Set<string>();
  for (const raw of rows.slice(0, MAX)) {
    const row = raw as Partial<HeldSteer> | null;
    if (!row || typeof row.botId !== "string" || typeof row.threadId !== "string"
      || typeof row.messageId !== "string" || typeof row.text !== "string" || typeof row.at !== "number") continue;
    if (seen.has(row.messageId)) continue;
    seen.add(row.messageId);
    out.push({ botId: row.botId, threadId: row.threadId, messageId: row.messageId, text: row.text, at: row.at });
  }
  return out;
}

function readThreadFile(path: string): HeldSteer[] {
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readAtRestTextSync(path));
  } catch {
    return [];
  }
  return parseSteers(parsed);
}

function writeThreadFile(dataDir: string, threadId: string, steers: readonly HeldSteer[]): void {
  ensureDir(dataDir);
  const path = pathOf(dataDir, threadId);
  if (steers.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  writeFileAtomic(path, JSON.stringify({ version: 1, steers: steers.slice(-MAX) }), { mode: 0o600 });
  noteAtRestWrite(path, { thread: threadId });
}

function listThreadIds(dataDir: string): string[] {
  const dir = heldSteersDir(dataDir);
  if (!existsSync(dir)) return [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((name) => THREAD_FILE.test(name)).map((name) => name.slice(0, -".json".length));
}

function readAll(dataDir: string): HeldSteer[] {
  const out: HeldSteer[] = [];
  for (const threadId of listThreadIds(dataDir)) out.push(...readThreadFile(pathOf(dataDir, threadId)));
  return out;
}

/** Files the at-rest migration seals, scoped to each thread's content key. */
export function heldSteersAtRestFiles(dataDir: string): Array<{ path: string; scope: ContentScope }> {
  return listThreadIds(dataDir).map((threadId) => ({ path: pathOf(dataDir, threadId), scope: { thread: threadId } }));
}

/**
 * One-shot: a pre-at-rest journal at DATA_DIR/held-steers.json becomes
 * per-thread files under DATA_DIR/held-steers/. Called once on boot before
 * any resume takes rows.
 */
export function migrateLegacyHeldSteers(dataDir: string): void {
  const legacy = join(dataDir, LEGACY_FILE);
  if (!existsSync(legacy)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(legacy, "utf8"));
  } catch {
    rmSync(legacy, { force: true });
    return;
  }
  const rows = parseSteers(parsed);
  const byThread = new Map<string, HeldSteer[]>();
  for (const row of rows) {
    if (!THREAD_ID.test(row.threadId)) continue;
    const list = byThread.get(row.threadId) ?? [];
    list.push(row);
    byThread.set(row.threadId, list);
  }
  for (const [threadId, steers] of byThread) {
    // Merge with any file already under the new dir (idempotent re-run).
    const existing = readThreadFile(pathOf(dataDir, threadId));
    const seen = new Set(existing.map((row) => row.messageId));
    const merged = existing.slice();
    for (const row of steers) {
      if (seen.has(row.messageId)) continue;
      seen.add(row.messageId);
      merged.push(row);
    }
    writeThreadFile(dataDir, threadId, merged);
  }
  rmSync(legacy, { force: true });
}

// Register before any sealed journal from an earlier run is opened (same
// order as video-jobs in server/index.ts).
registerAtRestRoot({
  id: "held-steers",
  dir: heldSteersDir(DATA_DIR),
  context: (relativePath) => `held-steers/${relativePath}`,
  files: () => heldSteersAtRestFiles(DATA_DIR),
});

/** Durable record at acceptance: the running engine holds these words. */
export function recordHeldSteer(dataDir: string, entry: HeldSteer): void {
  assertThreadId(entry.threadId);
  const steers = readThreadFile(pathOf(dataDir, entry.threadId)).filter((row) => row.messageId !== entry.messageId);
  steers.push(entry);
  writeThreadFile(dataDir, entry.threadId, steers);
}

/** Drop held rows by message id (confirmed, withdrawn, or already resumed). */
export function clearHeldSteers(dataDir: string, messageIds: readonly string[]): void {
  if (messageIds.length === 0) return;
  const drop = new Set(messageIds);
  for (const threadId of listThreadIds(dataDir)) {
    const kept = readThreadFile(pathOf(dataDir, threadId)).filter((row) => !drop.has(row.messageId));
    writeThreadFile(dataDir, threadId, kept);
  }
}

/** Drop every held row for a thread (turn completed or person stopped). */
export function clearHeldSteersForThread(dataDir: string, threadId: string): void {
  assertThreadId(threadId);
  writeThreadFile(dataDir, threadId, []);
}

/** Take (and remove) the held rows for one thread, oldest first. */
export function takeHeldSteersForThread(dataDir: string, threadId: string): HeldSteer[] {
  assertThreadId(threadId);
  const taken = readThreadFile(pathOf(dataDir, threadId))
    .sort((a, b) => a.at - b.at || a.messageId.localeCompare(b.messageId));
  if (taken.length === 0) return [];
  writeThreadFile(dataDir, threadId, []);
  return taken;
}

/** Every held row left after cut-turn resumes were scheduled, grouped by thread. */
export function takeRemainingHeldSteers(dataDir: string): Map<string, HeldSteer[]> {
  const byThread = new Map<string, HeldSteer[]>();
  for (const threadId of listThreadIds(dataDir)) {
    const rows = readThreadFile(pathOf(dataDir, threadId))
      .sort((a, b) => a.at - b.at || a.messageId.localeCompare(b.messageId));
    writeThreadFile(dataDir, threadId, []);
    if (rows.length > 0) byThread.set(threadId, rows);
  }
  return byThread;
}

/** Peek without removing (tests and diagnostics). */
export function listHeldSteers(dataDir: string, threadId?: string): HeldSteer[] {
  if (threadId !== undefined) {
    assertThreadId(threadId);
    return readThreadFile(pathOf(dataDir, threadId));
  }
  return readAll(dataDir);
}

/** Join held texts the way busy-line drain joins one follow-up prompt. */
export function joinHeldSteerTexts(held: readonly HeldSteer[]): string {
  return held.map((row) => row.text).filter((text) => text.trim().length > 0).join("\n\n");
}

/** Cut-turn resume prompt that also carries messages sent behind that turn. */
export function resumePromptWithHeld(base: string, held: readonly HeldSteer[]): string {
  const body = joinHeldSteerTexts(held);
  if (!body) return base;
  return `${base}\n\nMessages sent while that turn was running:\n\n${body}`;
}
