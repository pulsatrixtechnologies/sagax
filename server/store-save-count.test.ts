// What one ordinary turn costs the bots and rooms files (#3663): which store
// changes take the immediate path and which the coalesced one, how many
// full-file writes and bytes a turn leaves, and that its bookkeeping never
// writes synchronously on the event loop. A change a person asked for (a new
// thread, access, a profile edit) is still written on the loop before the call
// returns, so a failed write refuses it.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as nextTick } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OwnedFile, flushOwnedFiles, flushOwnedFilesSync } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });

type Row = { file: string; caller: string; path: "immediate" | "coalesced" };

/** The store method that asked for the save: the first Store frame that is not a save helper. */
function callerOf(stack: string | undefined): string {
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const name = /at (?:Proxy\.|Store\.)?([A-Za-z]+) /.exec(line.trim())?.[1];
    if (!name || !line.includes("store.ts")) continue;
    if (/^(saveBots|saveGroups|saveBotsSoon|saveGroupsSoon|commitBotChange|botsText|groupsText)$/.test(name)) continue;
    return name;
  }
  return "?";
}

function instrument(store: Store) {
  const rows: Row[] = [];
  const writes = { sync: 0, offLoop: 0, bytes: 0 };
  const internals = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [method, file, path] of [
    ["saveBots", "bots", "immediate"], ["saveGroups", "groups", "immediate"],
    ["saveBotsSoon", "bots", "coalesced"], ["saveGroupsSoon", "groups", "coalesced"],
  ] as const) {
    if (typeof internals[method] !== "function") continue;
    const original = internals[method]!.bind(store);
    internals[method] = (...args: unknown[]) => {
      rows.push({ file, caller: callerOf(new Error().stack), path });
      return original(...args);
    };
  }
  const sync = vi.spyOn(OwnedFile.prototype, "write").mockImplementation(function (this: OwnedFile, text: string) {
    writes.sync += 1;
    writes.bytes += Buffer.byteLength(text);
    return Reflect.apply(originalWrite, this, [text]) as boolean;
  });
  const offLoop = (OwnedFile.prototype as unknown as { persist?: (text: string, generation: number) => Promise<void> }).persist;
  const spyOffLoop = offLoop
    ? vi.spyOn(OwnedFile.prototype as unknown as { persist(text: string, generation: number): Promise<void> }, "persist")
      .mockImplementation(function (this: OwnedFile, text: string, generation: number) {
        writes.offLoop += 1;
        writes.bytes += Buffer.byteLength(text);
        return Reflect.apply(offLoop, this, [text, generation]) as Promise<void>;
      })
    : undefined;
  return { rows, writes, restore: () => { sync.mockRestore(); spyOffLoop?.mockRestore(); } };
}

const originalWrite = OwnedFile.prototype.write;

function table(rows: Row[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.file} | ${row.path} | ${row.caller}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort().map(([key, count]) => `${key} | ${count}`).join("\n");
}

describe("one turn's saves (#3663)", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("writes a turn's bookkeeping off the event loop and at most a few times, and only its new thread on the loop", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Count" }, { seedMessages: false });
    const peer = store.createBot({ name: "Peer" }, { seedMessages: false });
    const room = store.createGroup("Count room", [bot.id, peer.id], false);
    // Many bots with history make the file as large as a busy server's.
    for (let index = 0; index < 40; index += 1) {
      const filler = store.createBot({ name: `Filler ${index}` }, { seedMessages: false });
      for (let task = 0; task < 5; task += 1) store.createTask(filler.id, `Old work ${task}`, false);
    }
    await flushOwnedFiles();
    const thread = bot.threadId;
    const measure = instrument(store);
    const steps: Array<() => unknown> = [
      // A bot turn.
      () => store.setTaskActivity(bot.id, thread, "working"),
      () => store.setTaskAskedAt(bot.id, thread, Date.now()),
      () => store.markTaskDispatched(bot.id, thread, "claude"),
      () => store.pinTaskCwd(bot.id, thread, "/tmp/count"),
      () => store.setResumeCursor(bot.id, "claude", "session-1", thread),
      () => store.setHandedMessages(bot.id, thread, "claude", { session: "session-1" } as never),
      () => store.titleTaskFromFirstMessage(bot.id, "Plan the launch for next week", thread),
      () => store.noteConversationTiming(thread, { queueMs: 12, firstResponseMs: 340 }),
      () => store.addTaskUsage(bot.id, thread, { input: 1200, output: 300, costUsd: 0.01 }),
      () => store.patchTask(bot.id, thread, { unread: true }),
      () => store.patchTask(bot.id, thread, { pinned: true }),
      () => store.setTaskActivity(bot.id, thread, "idle"),
      // The turn hands work to a peer: a new thread, on the immediate path.
      () => store.createTask(peer.id, "Delegated work", false),
      // A room turn.
      () => store.patchGroup(room.id, { busyBotId: peer.id }),
      () => store.titleGroupTaskFromFirstMessage(room.id, "Room kickoff"),
      () => store.pinGroupCwd(room.id),
      () => store.noteConversationTiming(room.threadId, { queueMs: 5, firstResponseMs: 200 }),
      () => store.patchGroup(room.id, { unread: true }),
      () => store.patchGroup(room.id, { busyBotId: undefined }),
    ];
    let syncForBookkeeping = 0;
    for (const step of steps) {
      const before = measure.writes.sync;
      const immediate = measure.rows.filter((row) => row.path === "immediate").length;
      step();
      if (measure.rows.filter((row) => row.path === "immediate").length === immediate) syncForBookkeeping += measure.writes.sync - before;
      // A real turn spreads its changes over many loop turns.
      await nextTick();
    }
    await flushOwnedFiles();
    measure.restore();
    const report = [
      "file | path | caller | saves",
      table(measure.rows),
      `full-file writes: ${measure.writes.sync} synchronous on the loop, ${measure.writes.offLoop} off the loop; ${measure.writes.bytes} bytes`,
    ].join("\n");
    console.log(report);
    // Only the new thread takes the immediate path; the rest is bookkeeping.
    expect(measure.rows.filter((row) => row.path === "immediate").map((row) => row.caller)).toEqual(["createTask"]);
    // No bookkeeping change writes the whole file synchronously on the event loop; the new thread is the one write there.
    expect(syncForBookkeeping).toBe(0);
    expect(measure.writes.sync).toBe(1);
    // Bookkeeping writes are coalesced: the first change starts one, the rest wait for the next.
    expect(measure.writes.offLoop).toBeLessThanOrEqual(4);
    // And they all landed.
    const reloaded = new Store(selection);
    expect(reloaded.taskByThread(bot.id, thread)).toMatchObject({ title: "Plan the launch for next week", pinned: true, unread: true,
      lastInstanceId: "claude", cwd: "/tmp/count" });
    expect(reloaded.taskByThread(bot.id, thread)?.usage).toMatchObject({ input: 1200, output: 300, turns: 1 });
    expect(reloaded.group(room.id)).toMatchObject({ unread: true });
    expect(reloaded.tasks(peer.id).map((task) => task.title)).toContain("Delegated work");
  });

  it("has creating a bot, a new thread, a change of access and a room's membership on disk when the call returns", async () => {
    const store = new Store(selection);
    await flushOwnedFiles();
    const onDisk = (name: string) => JSON.parse(readFileSync(join(DATA_DIR, name), "utf8")) as Array<Record<string, unknown>>;
    const bot = store.createBot({ name: "Durable" }, { seedMessages: false });
    expect(onDisk("bots.json").map((saved) => saved.id)).toContain(bot.id);
    store.patchBot(bot.id, { toolScope: { allow: [] } });
    expect(onDisk("bots.json").find((saved) => saved.id === bot.id)?.toolScope).toEqual({ allow: [] });
    const other = store.createBot({ name: "Member" }, { seedMessages: false });
    const room = store.createGroup("Durable room", [bot.id], false);
    store.patchGroup(room.id, { memberIds: [bot.id, other.id] });
    expect(onDisk("groups.json").find((saved) => saved.id === room.id)?.memberIds).toEqual([bot.id, other.id]);
    const task = store.createTask(bot.id, "New thread", false)!;
    const tasks = (onDisk("bots.json").find((saved) => saved.id === bot.id)?.tasks ?? []) as Array<{ threadId: string }>;
    expect(tasks.map((saved) => saved.threadId)).toContain(task.threadId);
    // Deleting a bot is written before it returns: its data is erased only once its removal is on disk.
    store.deleteBot(other.id);
    expect(onDisk("bots.json").map((saved) => saved.id)).not.toContain(other.id);
  });

  it("ends with the second of two changes in a row, and shutdown writes what is still queued", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "First" }, { seedMessages: false });
    store.patchBot(bot.id, { name: "Second" });
    const onDisk = () => (JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")) as Array<{ id: string; name: string }>)
      .find((saved) => saved.id === bot.id)?.name;
    expect(onDisk()).toBe("Second");
    store.patchBot(bot.id, { name: "Third" });
    store.patchTask(bot.id, bot.threadId, { pinned: true });
    // The exit path (server/index.ts gracefulShutdown) writes what is still queued before the process ends.
    flushOwnedFilesSync();
    expect(onDisk()).toBe("Third");
    expect(new Store(selection).taskByThread(bot.id, bot.threadId)?.pinned).toBe(true);
  });
});
