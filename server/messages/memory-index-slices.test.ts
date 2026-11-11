// Memory recall and the queue of memory files to index (#3524): a recall at a
// turn's start flushed the keyed words of every bot's queued files in one
// transaction, and a sync after a start re-sealed and re-queued every memory
// file of the bot even when its text had not changed. A recall now writes
// only its own bot's rows; the rest goes in background slices that give the
// loop back; an unchanged file keeps its row and its index.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { closeMessageDb, closeMessageSearch, configureContentEncryption, indexMemoryFile, pendingMemoryIndexCount, recallMemory } from "./message-db.ts";

const file = () => join(DATA_DIR, "messages.db");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Rows with their keyed words written, read beside the server's handle. */
function indexedRows(): number {
  const db = new DatabaseSync(file(), { readOnly: true });
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM memory_sealed_fts").get() as { n: number }).n;
  } finally { db.close(); }
}

beforeEach(async () => {
  await closeMessageSearch();
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  configureContentEncryption({ mode: "on", autoMigrate: false });
});
afterEach(async () => {
  await closeMessageSearch();
  closeMessageDb();
});

describe("memory index queue (#3524)", () => {
  it("a recall writes only its own bot's queued rows, the others go in background slices", async () => {
    // many files of other bots re-indexed in the same tick as the recalling bot's one
    for (let bot = 0; bot < 4; bot++) {
      for (let n = 0; n < 50; n++) indexMemoryFile(`bot-${bot}`, `memory/topic-${n}.md`, `quarterly invoice review number ${n} for team ${bot}\n`, { mtimeMs: 1_000 + n, bytes: 40 });
    }
    indexMemoryFile("bot-recall", "memory/vendors.md", "the zebra vendor ships on fridays\n", { mtimeMs: 2_000, bytes: 34 });
    expect(recallMemory("zebra vendor", "bot-recall").map((hit) => hit.file)).toEqual(["memory/vendors.md"]);
    // the recall did not write the other bots' 200 rows in its transaction
    expect(indexedRows(), "the recall flushed every bot's queued rows").toBe(1);
    expect(pendingMemoryIndexCount("bot-recall")).toBe(0);
    expect(pendingMemoryIndexCount()).toBe(200);
    for (let i = 0; i < 100 && pendingMemoryIndexCount() > 0; i++) await wait(10);
    expect(pendingMemoryIndexCount()).toBe(0);
    expect(indexedRows()).toBe(201);
    expect(recallMemory("invoice review", "bot-2").length).toBeGreaterThan(0);
    expect(recallMemory("zebra", "bot-2")).toEqual([]);
  });

  it("an unchanged memory file keeps its sealed row and index: nothing to re-seal or queue after a start", () => {
    indexMemoryFile("bot-a", "memory/deploys.md", "deploys go out from the main branch\n", { mtimeMs: 1_000, bytes: 36 });
    expect(recallMemory("deploys main", "bot-a").map((hit) => hit.file)).toEqual(["memory/deploys.md"]);
    const sealedOf = () => {
      closeMessageDb();
      const db = new DatabaseSync(file(), { readOnly: true });
      try {
        return db.prepare("SELECT sealed, mtime_ms FROM memory_files WHERE bot_id = 'bot-a'").get() as { sealed: Uint8Array; mtime_ms: number };
      } finally { db.close(); }
    };
    const before = sealedOf();
    // the sync after a restart (or the daily refresh) reads the same text again
    indexMemoryFile("bot-a", "memory/deploys.md", "deploys go out from the main branch\n", { mtimeMs: 5_000, bytes: 36 });
    const after = sealedOf();
    expect(Buffer.from(after.sealed).equals(Buffer.from(before.sealed)), "an unchanged file was sealed again").toBe(true);
    expect(pendingMemoryIndexCount("bot-a"), "an unchanged file was queued for indexing again").toBe(0);
    expect(after.mtime_ms).toBe(5_000);
    expect(recallMemory("deploys main", "bot-a").map((hit) => hit.file)).toEqual(["memory/deploys.md"]);
    // a changed text is sealed and indexed as before
    indexMemoryFile("bot-a", "memory/deploys.md", "deploys go out from the release branch\n", { mtimeMs: 6_000, bytes: 39 });
    expect(pendingMemoryIndexCount("bot-a")).toBe(1);
    expect(recallMemory("release branch", "bot-a").map((hit) => hit.file)).toEqual(["memory/deploys.md"]);
    expect(recallMemory("main", "bot-a")).toEqual([]);
  });
});
