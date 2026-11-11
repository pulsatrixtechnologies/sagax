// Private threads in the store: a thread's owner is set with the thread and
// the one-time migration writes owners once (server/threads/thread-privacy.ts).
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store, type BotRecord, type TaskPatch } from "./store.ts";
import { flushOwnedFilesSync } from "./atomic.ts";
import { planThreadOwners } from "./threads/thread-privacy.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
// What the store saved, its writes still running off the event loop included (server/atomic.ts).
const savedBots = (): BotRecord[] => {
  flushOwnedFilesSync();
  return JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
};
const ALICE = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";

describe("thread owners in the store", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("a thread is created with its owner, never briefly without one", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const seen: Array<string | undefined> = [];
    store.onChange(() => seen.push(store.tasks(bot.id)[0]?.ownerPrincipalId));
    const task = store.createTask(bot.id, "Bob's", false, undefined, undefined, undefined, ` ${BOB.toUpperCase()} `)!;
    expect(task.ownerPrincipalId).toBe(BOB);
    expect(seen).toEqual([BOB]);
    // not the selected thread: the bot's selection stays its owner's
    expect(store.bot(bot.id)!.threadId).not.toBe(task.threadId);
    expect(savedBots()[0]!.tasks!.find((entry) => entry.threadId === task.threadId)?.ownerPrincipalId).toBe(BOB);
  });

  it("the bot's activity folds over the threads asked for: a viewer's own, never someone else's", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const alices = store.createTask(bot.id, "Alice's routine", false, undefined, undefined, undefined, ALICE)!;
    const bobs = store.createTask(bot.id, "Bob's", false, undefined, undefined, undefined, BOB)!;
    store.setTaskActivity(bot.id, alices.threadId, "working");
    expect(store.bot(bot.id)!.busy).toBe(true);
    expect(store.activityOf(bot.id, (task) => task.ownerPrincipalId === ALICE)).toEqual({ activity: "working", busy: true });
    expect(store.activityOf(bot.id, (task) => task.threadId === bobs.threadId)).toEqual({ activity: "idle", busy: false });
    store.setTaskActivity(bot.id, alices.threadId, "idle");
    expect(store.activityOf(bot.id, () => true)).toEqual({ activity: "idle", busy: false });
    expect(store.bot(bot.id)!.busy).toBe(false);
  });

  it("no client patch can change an owner", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const task = store.createTask(bot.id, "Bob's", false, undefined, undefined, undefined, BOB)!;
    store.patchTask(bot.id, task.threadId, { ownerPrincipalId: ALICE } as unknown as TaskPatch);
    expect(store.taskByThread(bot.id, task.threadId)?.ownerPrincipalId).toBe(BOB);
  });

  it("the migration gives a mixed thread to its creator, an empty one to the bot owner, and runs once", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchBot(bot.id, { ownerUserId: ALICE } as never);
    const first = bot.threadId;
    store.appendMessage(first, { role: "user", kind: "text", text: "bob first", sender: { name: "Bob", id: BOB } });
    store.appendMessage(first, { role: "user", kind: "text", text: "alice later", sender: { name: "Alice", id: ALICE } });
    const empty = store.createTask(bot.id, "Empty", false)!;
    const senders = (threadId: string) => store.messagesFor(threadId).flatMap((message) => (message.role === "user" && message.sender?.id ? [message.sender.id] : []));
    const plan = planThreadOwners(store.bots.map((entry) => ({ id: entry.id, ownerPrincipalId: ALICE, tasks: store.tasks(entry.id) })), senders, (id) => id.startsWith("pr_"));
    expect(plan.report).toMatchObject({ threads: 2, toCreator: 1, toBotOwner: 1, mixed: 1 });
    expect(store.assignTaskOwners(plan.assignments)).toBe(1);
    expect(store.taskByThread(bot.id, first)?.ownerPrincipalId).toBe(BOB);
    expect(store.taskByThread(bot.id, empty.threadId)?.ownerPrincipalId).toBe(ALICE);
    // after a restart, from disk
    const reloaded = new Store(selection);
    expect(reloaded.taskByThread(bot.id, first)?.ownerPrincipalId).toBe(BOB);
    const again = planThreadOwners(reloaded.bots.map((entry) => ({ id: entry.id, ownerPrincipalId: ALICE, tasks: reloaded.tasks(entry.id) })), senders, (id) => id.startsWith("pr_"));
    expect(again.assignments).toEqual([]);
    expect(reloaded.assignTaskOwners(again.assignments)).toBe(0);
  });
});
