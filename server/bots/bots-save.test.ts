import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spied, not replaced: every call reaches the real filesystem, and a test fails a save where a real disk does, at the
// rename that publishes the new file (#3663).
vi.mock("node:fs", { spy: true });
vi.resetModules();
const fs = await import("node:fs");
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { flushOwnedFiles } = await import("../atomic.ts");
const { BotsSaveError } = await import("./bots-save.ts");
const { DATA_DIR } = await import("../config.ts");
const { Store } = await import("../store.ts");
type ModelSelection = import("../contracts.ts").ModelSelection;
type BotRecord = import("../store.ts").BotRecord;

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const locked = () => Object.assign(new Error("EPERM: operation not permitted, rename 'bots.json.tmp' -> 'bots.json'"), { code: "EPERM" });

/** The file whose renames fail with `failure`, while set. */
let failing: { file: string; failure: () => Error } | undefined;
vi.mocked(fs.renameSync).mockImplementation((from, to) => {
  if (failing && String(to).endsWith(`/${failing.file}`)) throw failing.failure();
  realFs.renameSync(from, to);
});

/** Every write of `file` made while `run` runs fails at its rename, as a held or read-only file does. */
function failingSaves<T>(run: () => T, file = "bots.json", failure: () => Error = locked): T {
  failing = { file, failure };
  try {
    return run();
  } finally {
    failing = undefined;
  }
}

/** The deferred (bookkeeping) writes of bots.json started while `run` runs fail at their rename. */
async function failingDeferredSaves(run: () => void): Promise<void> {
  failing = { file: "bots.json", failure: locked };
  try {
    run();
    await flushOwnedFiles();
  } finally {
    failing = undefined;
  }
}

const onDisk = (botId: string) => (JSON.parse(realFs.readFileSync(join(DATA_DIR, "bots.json"), "utf8")) as BotRecord[])
  .find((bot) => bot.id === botId);

function storeWithTwoThreads() {
  const store = new Store(selection);
  const bot = store.createBot();
  const first = store.activeTask(bot.id)!;
  store.setResumeCursor(bot.id, "claude", "session-one");
  store.patchTask(bot.id, first.threadId, { pinnedMessageId: "pin-one" });
  const second = store.createTask(bot.id)!;
  store.setResumeCursor(bot.id, "claude", "session-two");
  const changes = vi.fn();
  store.onChange(changes);
  return { store, bot, first, second, changes };
}

describe("bots.json save failures", () => {
  beforeEach(() => {
    realFs.rmSync(DATA_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    failing = undefined;
  });

  it("keeps a thread switch whose deferred save failed, says so in the log, and the next save writes it (#3663)", async () => {
    const { store, bot, first, second, changes } = storeWithTwoThreads();
    await flushOwnedFiles();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await failingDeferredSaves(() => {
      store.switchTask(bot.id, first.threadId);
      expect(bot).toMatchObject({ threadId: first.threadId, resumeCursors: { claude: "session-one" }, pinnedMessageId: "pin-one" });
      expect(changes).toHaveBeenCalledWith({ type: "bot", botId: bot.id });
    });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(onDisk(bot.id)?.threadId).toBe(second.threadId);

    store.setTaskAskedAt(bot.id, second.threadId, 1_234);
    await flushOwnedFiles();
    expect(onDisk(bot.id)?.threadId).toBe(first.threadId);
    expect(new Store(selection).bot(bot.id)?.threadId).toBe(first.threadId);
  });

  it("does not open a new thread that was never saved", () => {
    const { store, bot, second, changes } = storeWithTwoThreads();
    const tasks = bot.tasks;

    expect(() => failingSaves(() => store.createTask(bot.id, "Never saved"))).toThrow(BotsSaveError);
    expect(bot.tasks).toBe(tasks);
    expect(store.tasks(bot.id).map((task) => task.title)).not.toContain("Never saved");
    expect(bot.threadId).toBe(second.threadId);
    expect(changes).not.toHaveBeenCalled();
  });

  it("refuses a thread edit while bots.json could not be read, and changes nothing", () => {
    const { store, bot, first } = storeWithTwoThreads();
    (store as unknown as { botsUnreadable: boolean }).botsUnreadable = true;

    expect(() => store.patchTask(bot.id, first.threadId, { title: "Renamed", unread: true, archivedAt: 1 })).toThrow(BotsSaveError);
    expect(first).toMatchObject({ unread: false });
    expect(first.title).not.toBe("Renamed");
    expect(first.archivedAt).toBeUndefined();
    expect(bot.unread).toBeFalsy();
  });

  it("keeps a revoked approval live when its save fails, and never applies an unsaved widening", async () => {
    const { store, bot, second } = storeWithTwoThreads();
    store.patchTask(bot.id, second.threadId, { approvalMode: "full", autoApprove: false, alwaysAllow: ["tool-a"] });
    await flushOwnedFiles();

    expect(() => failingSaves(() => store.patchTask(bot.id, second.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: [] }))).toThrow(BotsSaveError);
    expect(second).toMatchObject({ approvalMode: "ask", alwaysAllow: [] });
    expect(new Store(selection).taskByThread(bot.id, second.threadId)).toMatchObject({ approvalMode: "full" });

    expect(() => failingSaves(() => store.patchTask(bot.id, second.threadId, { approvalMode: "full" }))).toThrow(BotsSaveError);
    expect(second.approvalMode).toBe("ask");
    expect(() => failingSaves(() => store.patchTask(bot.id, second.threadId, { alwaysAllow: ["tool-b"] }))).toThrow(BotsSaveError);
    expect(second.alwaysAllow).toEqual([]);
    // Nothing left in memory for a later bookkeeping write to carry to disk.
    store.setTaskAskedAt(bot.id, second.threadId, 1_234);
    await flushOwnedFiles();
    expect(onDisk(bot.id)?.tasks?.find((task) => task.threadId === second.threadId)).toMatchObject({ approvalMode: "ask", alwaysAllow: [] });
  });

  it("keeps a thread and its conversation when its deletion cannot be saved, and deletes both on retry", () => {
    const { store, bot, first, second, changes } = storeWithTwoThreads();
    store.appendMessage(second.threadId, { role: "user", kind: "text", text: "Keep this conversation" });
    changes.mockClear();

    expect(() => failingSaves(() => store.deleteTask(bot.id, second.threadId))).toThrow("Couldn't save the thread deletion");
    expect(store.tasks(bot.id).map((task) => task.threadId)).toEqual([second.threadId, first.threadId]);
    expect(new Store(selection).messagesFor(second.threadId).map((message) => message.text)).toEqual(["Keep this conversation"]);
    expect(bot.threadId).toBe(second.threadId);
    expect(changes).not.toHaveBeenCalled();
    expect(new Store(selection).tasks(bot.id)).toHaveLength(2);

    expect(store.deleteTask(bot.id, second.threadId)?.threadId).toBe(first.threadId);
    expect(bot.threadId).toBe(first.threadId);
    expect(changes).toHaveBeenCalledWith({ type: "thread.deleted", threadId: second.threadId });
    expect(new Store(selection).tasks(bot.id).map((task) => task.threadId)).toEqual([first.threadId]);
    expect(new Store(selection).messagesFor(second.threadId)).toEqual([]);
  });

  it("keeps a room, its threads and their transcripts when its deletion cannot be saved (#3663)", () => {
    const { store, bot } = storeWithTwoThreads();
    const room = store.createGroup("Launch", [bot.id], false);
    store.appendMessage(room.threadId, { role: "user", kind: "text", text: "Keep the room's conversation" });

    expect(() => failingSaves(() => store.deleteGroup(room.id), "groups.json")).toThrow(/EPERM/);
    expect(store.group(room.id)?.threadId).toBe(room.threadId);
    expect(store.messagesFor(room.threadId).map((message) => message.text)).toEqual(["Keep the room's conversation"]);
    const reopened = new Store(selection);
    expect(reopened.group(room.id)?.threadId).toBe(room.threadId);
    expect(reopened.messagesFor(room.threadId).map((message) => message.text)).toEqual(["Keep the room's conversation"]);

    expect(store.deleteGroup(room.id)).toBe(true);
    expect(new Store(selection).group(room.id)).toBeFalsy();
    expect(new Store(selection).messagesFor(room.threadId)).toEqual([]);
  });

  it("keeps what already happened in memory and saves it with the next write", async () => {
    const { store, bot, first, second } = storeWithTwoThreads();
    await flushOwnedFiles();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await failingDeferredSaves(() => {
      store.setResumeCursor(bot.id, "claude", "session-three");
      store.setHandedMessages(bot.id, second.threadId, "claude", { session: "session-three", ids: [] });
      store.setTaskAskedAt(bot.id, second.threadId, 1_234);
    });
    expect(second.resumeCursors.claude).toBe("session-three");
    expect(second.handedMessages?.claude).toEqual({ session: "session-three", ids: [] });
    expect(second.askedAt).toBe(1_234);
    // One line for the failure streak, not one per attempt.
    await failingDeferredSaves(() => store.setTaskAskedAt(bot.id, second.threadId, 1_235));
    await failingDeferredSaves(() => store.setTaskAskedAt(bot.id, second.threadId, 1_236));
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(onDisk(bot.id)?.tasks?.find((task) => task.threadId === second.threadId)?.askedAt).toBeUndefined();

    store.patchTask(bot.id, first.threadId, { title: "Next write" });
    await flushOwnedFiles();
    const reloaded = new Store(selection).taskByThread(bot.id, second.threadId);
    expect(reloaded?.resumeCursors.claude).toBe("session-three");
    expect(reloaded?.handedMessages?.claude).toEqual({ session: "session-three", ids: [] });
    expect(reloaded?.askedAt).toBe(1_236);
  });

  it("names the unsaved action and keeps the raw error as its cause", () => {
    const fullDisk = new BotsSaveError("the thread's usage", Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }));

    expect(fullDisk.message).toBe("Couldn't save the thread's usage: Sagax couldn't write bots.json.");
    expect(fullDisk.cause).toMatchObject({ code: "ENOSPC" });
  });
});
