// #4456: a turn's queue held the server's main thread for 1.4 to 3.7 s on a
// hosted server (queueBusy about the queue: synchronous work, not a wait).
// The production-sized benchmark (server/first-text-latency.e2e.test.ts)
// counted about 1,350 synchronous file calls in one queue, most of them on
// the bot's memory files, several per file: recall listed the topic folder
// four times, the journal's turn boundary resolved every file through a
// realpath and stat'ed it again, and every unchanged plain file was opened
// and read again. On a network disk each call is a round trip. These tests
// count the calls a bot with many topic notes costs.
import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const counted = <K extends "statSync" | "lstatSync" | "realpathSync" | "readFileSync" | "openSync">(name: K) =>
    vi.fn((...args: unknown[]) => (real[name] as (...a: unknown[]) => unknown)(...args));
  const realpathSync = Object.assign(counted("realpathSync"), { native: real.realpathSync.native });
  const mocked = { ...real, statSync: counted("statSync"), lstatSync: counted("lstatSync"), realpathSync, readFileSync: counted("readFileSync"), openSync: counted("openSync") };
  return { ...mocked, default: mocked };
});

const { buildRecall } = await import("./recall.ts");
const { beginMemoryTurn, resetMemoryJournalState } = await import("../memory/memory-journal.ts");
const { readMemoryTopic, WORKSPACES_DIR } = await import("../workspace/workspace.ts");
const { closeMessageDb } = await import("../messages/message-db.ts");

const BOT = "bot-turn-file-calls";
const TOPICS = 30;
const topicDir = () => join(WORKSPACES_DIR, BOT, "memory");

/** Calls of the counted fs functions on one of the bot's topic files (a
 * realpath: on any path of the bot) since the last reset, by function. */
function topicCalls(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of ["statSync", "lstatSync", "realpathSync", "readFileSync", "openSync"] as const) {
    const calls = (fs[name] as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    // realpath: of the workspace or its folders, any path of the bot
    const prefix = name === "realpathSync" ? join(WORKSPACES_DIR, BOT) : `${topicDir()}/topic-`;
    out[name] = calls.filter(([path]) => typeof path === "string" && path.startsWith(prefix)).length;
  }
  return out;
}
const reset = () => {
  for (const name of ["statSync", "lstatSync", "realpathSync", "readFileSync", "openSync"] as const) (fs[name] as unknown as { mockClear: () => void }).mockClear();
};

beforeEach(() => {
  rmSync(join(WORKSPACES_DIR, BOT), { recursive: true, force: true });
  mkdirSync(topicDir(), { recursive: true });
  writeFileSync(join(WORKSPACES_DIR, BOT, "MEMORY.md"), "# Memory\n\n- 2026-10-01 · the firewall renewal is due in March\n");
  for (let i = 0; i < TOPICS; i += 1) {
    writeFileSync(join(topicDir(), `topic-${i}.md`), `---\nname: topic-${i}\ndescription: notes on the printer contract ${i}\n---\n\nThe printer contract ${i} renews with the vendor in spring; the backup budget covers it.\n`);
  }
  resetMemoryJournalState();
});

afterEach(() => {
  closeMessageDb();
  rmSync(join(WORKSPACES_DIR, BOT), { recursive: true, force: true });
});

describe("the file calls a turn's memory costs (#4456)", () => {
  it("recall lists the topic folder once and reads no unchanged topic again", () => {
    const input = { botId: BOT, message: "What about the printer contract renewal?", threadIds: [], label: () => "", author: () => "" };
    // the first recall reads the files; the next one, of the same files, is the measured one
    expect(buildRecall(input)?.text).toContain("printer contract");
    reset();
    expect(buildRecall(input)?.text).toContain("printer contract");
    const calls = topicCalls();
    // one listing stat per topic (before: four, one per reader of the folder)
    expect(calls.statSync).toBeLessThanOrEqual(2 * TOPICS);
    // nothing unchanged is opened or read again
    expect(calls.readFileSync).toBe(0);
    expect(calls.openSync).toBe(0);
  });

  it("an unchanged plain topic is read from the disk once, and again once it changes", () => {
    expect(readMemoryTopic(BOT, "topic-1.md")).toContain("printer contract 1");
    reset();
    expect(readMemoryTopic(BOT, "topic-1.md")).toContain("printer contract 1");
    expect(topicCalls().readFileSync).toBe(0);
    writeFileSync(join(topicDir(), "topic-1.md"), "---\nname: topic-1\n---\n\nThe contract moved to a new vendor.\n");
    expect(readMemoryTopic(BOT, "topic-1.md")).toContain("new vendor");
  });

  it("the journal's turn boundary looks at each topic once, with no realpath per file", () => {
    beginMemoryTurn(BOT, "thread-1");
    reset();
    beginMemoryTurn(BOT, "thread-2");
    const calls = topicCalls();
    // the listing's lstat alone (before: the listing's lstat, the link
    // check's lstat, a stat and a realpath of the folder, for each file)
    expect(calls.lstatSync + calls.statSync).toBeLessThanOrEqual(TOPICS);
    // the workspace's and each folder's real path, once per pass
    // (a few per pass, never one per file)
    expect(calls.realpathSync).toBeLessThanOrEqual(8);
    expect(calls.readFileSync).toBe(0);
  });
});
