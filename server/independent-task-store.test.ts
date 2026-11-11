import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { approvalModeFor } from "../shared/approval-mode.ts";
import { flushOwnedFilesSync } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { isProjectEmoji, Store, type BotRecord, type GroupRecord, type TaskPatch } from "./store.ts";
import { ensureTaskWorkspace } from "./workspace/workspace.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
// What the store saved, its waiting bookkeeping saves included (server/atomic.ts).
const readSaved = <T>(name: string): T => {
  flushOwnedFilesSync();
  return JSON.parse(readFileSync(join(DATA_DIR, name), "utf8"));
};
const savedBots = (): BotRecord[] => readSaved("bots.json");
const savedGroups = (): GroupRecord[] => readSaved("groups.json");

describe("independent bot task state", () => {
  // The shared Vitest setup gives this file its own disposable home.
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("applies an explicit bot-wide approval mode without changing history or provider choices", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const other = store.createBot({}, { seedMessages: false });
    const first = bot.threadId;
    store.appendMessage(first, { role: "user", kind: "text", text: "Keep this conversation" });
    const archived = store.createTask(bot.id, "Archived")!;
    store.patchTask(bot.id, archived.threadId, { archivedAt: Date.now(), modelSelection: { instanceId: "codex", model: "different" } });
    store.setResumeCursor(bot.id, "codex", "keep-session", archived.threadId);
    const history = store.messagesFor(first);
    store.setAllThreadApprovalMode(bot.id, "full");
    // #1207: every thread reads the bot's level live; none keeps a copy.
    const level = (s: Store, threadId: string) => s.projectBotForTask(bot.id, threadId)?.approvalMode;
    expect(store.tasks(bot.id).every(task => task.approvalMode === undefined && task.approvalOwn === undefined)).toBe(true);
    expect(store.tasks(bot.id).every(task => level(store, task.threadId) === "full")).toBe(true);
    const restarted = new Store(selection);
    expect(restarted.bot(bot.id)?.approvalMode).toBe("full");
    expect(restarted.tasks(bot.id).every(task => level(restarted, task.threadId) === "full")).toBe(true);
    expect(restarted.taskByThread(bot.id, archived.threadId)).toMatchObject({
      archivedAt: archived.archivedAt, modelSelection: { instanceId: "codex", model: "different" }, resumeCursors: { codex: "keep-session" },
    });
    expect(restarted.messagesFor(first)).toEqual(history);
    expect(level(restarted, restarted.createTask(bot.id)!.threadId)).toBe("full");
    expect(approvalModeFor(restarted.bot(other.id)!)).toBe("full");
    restarted.setAllThreadApprovalMode(bot.id, "ask");
    const asked = new Store(selection);
    expect(asked.tasks(bot.id).every(task => level(asked, task.threadId) === "ask")).toBe(true);
  });

  it("refreshes one thread's permissions from the bot default and leaves the rest", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const first = bot.threadId;
    store.patchBot(bot.id, { approvalMode: "ask", autoApprove: false });
    const model = store.projectBotForTask(bot.id, first)?.modelSelection;
    store.appendMessage(first, { role: "user", kind: "text", text: "Keep this conversation" });
    const history = store.messagesFor(first);
    const sibling = store.createTask(bot.id, "Sibling", false)!;
    store.patchBot(bot.id, { approvalMode: "auto", autoApprove: true, alwaysAllow: ["Read", "Bash"] });
    // #1207: the level belongs to the bot. A thread keeps its own only as a
    // stated exception, chosen in that thread after the bot's level was set.
    store.patchTask(bot.id, first, { approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read"] });
    store.patchTask(bot.id, sibling.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: [] });
    expect(store.taskByThread(bot.id, first)?.approvalOwn).toBe("thread");
    expect(store.projectBotForTask(bot.id, first)).toMatchObject({ approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read"] });
    expect(store.projectBotForTask(bot.id, first)?.modelSelection).toEqual(model);
    expect(store.projectBotForTask(bot.id, sibling.threadId)).toMatchObject({ approvalMode: "ask", alwaysAllow: [] });

    const refreshed = store.refreshTaskPermissions(bot.id, first);
    // caught up: no exception left, the thread follows its bot
    expect(refreshed?.approvalOwn).toBeUndefined();
    expect(refreshed?.approvalMode).toBeUndefined();
    expect(store.projectBotForTask(bot.id, first)).toMatchObject({ approvalMode: "auto", autoApprove: true, alwaysAllow: ["Read", "Bash"] });
    expect(store.projectBotForTask(bot.id, first)?.modelSelection).toEqual(model);
    expect(store.projectBotForTask(bot.id, sibling.threadId)).toMatchObject({ approvalMode: "ask", autoApprove: false, alwaysAllow: [] });
    expect(store.bot(bot.id)).toMatchObject({ approvalMode: "auto", autoApprove: true, alwaysAllow: ["Read", "Bash"] });
    expect(store.messagesFor(first)).toEqual(history);
    expect(store.refreshTaskPermissions(bot.id, "missing")).toBeNull();

    const reloaded = new Store(selection);
    expect(reloaded.projectBotForTask(bot.id, first)).toMatchObject({ approvalMode: "auto", autoApprove: true, alwaysAllow: ["Read", "Bash"] });
    expect(reloaded.projectBotForTask(bot.id, sibling.threadId)).toMatchObject({ approvalMode: "ask", alwaysAllow: [] });
    expect(reloaded.messagesFor(first)).toEqual(history);

    // Setting the bot's level reaches every thread and ends each exception.
    reloaded.patchBot(bot.id, {
      approvalMode: "full",
      approvalGrant: { requestId: "grant-1", mode: "full", phase: "prepared", threadId: first, threadOnly: true, refreshPermissions: true },
    });
    expect(approvalModeFor(reloaded.bot(bot.id)!)).toBe("ask");
    expect(reloaded.taskByThread(bot.id, sibling.threadId)?.approvalOwn).toBeUndefined();
    const caughtUp = reloaded.refreshTaskPermissions(bot.id, sibling.threadId);
    expect(caughtUp?.approvalOwn).toBeUndefined();
    expect(reloaded.projectBotForTask(bot.id, sibling.threadId)).toMatchObject({ approvalMode: "full", autoApprove: true, alwaysAllow: ["Read", "Bash"] });
    expect(reloaded.bot(bot.id)?.approvalMode).toBe("full");
  });

  it("does not partially elevate any thread when saving the all-threads change fails", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.createTask(bot.id, "Second thread");
    const before = JSON.stringify(bot);
    const save = vi.spyOn(store as unknown as { saveBots(): void }, "saveBots").mockImplementation(() => { throw new Error("fixture disk full"); });
    try {
      expect(() => store.setAllThreadApprovalMode(bot.id, "full")).toThrow("fixture disk full");
      expect(JSON.stringify(bot)).toBe(before);
      const restarted = new Store(selection);
      expect(restarted.tasks(bot.id).every(task => approvalModeFor(restarted.projectBotForTask(bot.id, task.threadId)!) === "full")).toBe(true);
    } finally { save.mockRestore(); }
  });

  it("does not let a hidden routine execution hold the bot unread", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const visible = bot.threadId;
    const execution = store.createTask(bot.id, "Execution", false)!;
    store.patchTask(bot.id, execution.threadId, { routineRunId: "run-1", unread: true });
    expect(store.taskByThread(bot.id, execution.threadId)).toMatchObject({ routineRunId: "run-1", unread: false });
    expect(store.taskByThread(bot.id, visible)?.unread).toBe(false);
    expect(bot.unread).toBe(false);

    store.patchTask(bot.id, execution.threadId, { routineRunId: undefined, unread: true });
    expect(store.taskByThread(bot.id, execution.threadId)?.routineRunId).toBeUndefined();
    expect(store.taskByThread(bot.id, execution.threadId)?.unread).toBe(true);
    expect(bot.unread).toBe(true);
  });

  it("heals a saved hidden routine execution that was left unread", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const execution = store.createTask(bot.id, "Execution", false)!;
    store.patchTask(bot.id, execution.threadId, { routineRunId: "run-1" });
    const raw = savedBots();
    const saved = raw.find((row) => row.id === bot.id)!;
    const hidden = saved.tasks!.find((task) => task.threadId === execution.threadId)!;
    hidden.unread = true;
    saved.unread = true;
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(raw));
    const reloaded = new Store(selection);
    expect(reloaded.taskByThread(bot.id, execution.threadId)).toMatchObject({ routineRunId: "run-1", unread: false });
    expect(reloaded.bot(bot.id)?.unread).toBe(false);
    const persisted = savedBots().find((row) => row.id === bot.id)!;
    expect(persisted.unread).toBe(false);
    expect(persisted.tasks!.find((task) => task.threadId === execution.threadId)?.unread).toBe(false);
  });

  it("persists routine execution identity without sharing context or approval settings", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const first = store.createTask(bot.id, "First run", false)!;
    const second = store.createTask(bot.id, "Second run", false)!;
    store.patchTask(bot.id, first.threadId, { routineRunId: "run-1" });
    store.patchTask(bot.id, second.threadId, { routineRunId: "run-2" });
    store.setResumeCursor(bot.id, "claude", "first-session", first.threadId);
    const reloaded = new Store(selection);
    expect(reloaded.taskByThread(bot.id, first.threadId)).toMatchObject({ routineRunId: "run-1", resumeCursors: { claude: "first-session" } });
    expect(reloaded.taskByThread(bot.id, second.threadId)).toMatchObject({ routineRunId: "run-2", resumeCursors: {} });
    // #1207: a run keeps no copy of the level; it runs at the bot's
    expect(reloaded.taskByThread(bot.id, second.threadId)?.approvalMode).toBeUndefined();
    expect(reloaded.projectBotForTask(bot.id, second.threadId)).toMatchObject({ approvalMode: "full", autoApprove: false });
    reloaded.patchTask(bot.id, first.threadId, { routineRunId: undefined });
    expect(new Store(selection).taskByThread(bot.id, first.threadId)?.routineRunId).toBeUndefined();
  });

  it("never silently switches into an internal run when deleting a visible task", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const original = bot.threadId;
    const results = store.createTask(bot.id, "Results")!;
    const execution = store.createTask(bot.id, "Execution", false)!;
    store.patchTask(bot.id, execution.threadId, { routineRunId: "run-1" });
    expect(store.deleteTask(bot.id, results.threadId)?.threadId).toBe(original);
    expect(store.deleteTask(bot.id, original)).not.toBeNull();
    expect(bot.threadId).not.toBe(execution.threadId);
    expect(store.activeTask(bot.id)?.routineRunId).toBeUndefined();
    expect(store.tasks(bot.id).filter((task) => !task.routineRunId)).toHaveLength(1);
    expect(new Store(selection).bot(bot.id)?.threadId).toBe(bot.threadId);
  });

  it("leaves an opened internal run when a different visible task is deleted", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const original = bot.threadId;
    const results = store.createTask(bot.id, "Results", false)!;
    const execution = store.createTask(bot.id, "Execution", false)!;
    store.patchTask(bot.id, execution.threadId, { routineRunId: "run-1" });
    store.switchTask(bot.id, execution.threadId);

    expect(store.deleteTask(bot.id, results.threadId)?.threadId).toBe(original);
    expect(store.activeTask(bot.id)?.routineRunId).toBeUndefined();
    expect(store.taskByThread(bot.id, execution.threadId)?.routineRunId).toBe("run-1");
    expect(new Store(selection).bot(bot.id)?.threadId).toBe(original);
  });

  it("caps new task titles before persistence and preserves the blank-title fallback", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const task = store.createTask(bot.id, `  ${"t".repeat(120)}  `)!;
    expect(task.title).toBe("t".repeat(80));
    expect(new Store(selection).taskByThread(bot.id, task.threadId)?.title).toBe(task.title);
    expect(store.createTask(bot.id, "  ")?.title).toBe("New thread");
  });

  it("retains generated and user-selected project files when conversations are deleted", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const first = ensureTaskWorkspace(bot.id, bot.threadId);
    const secondTask = store.createTask(bot.id)!;
    const second = ensureTaskWorkspace(bot.id, secondTask.threadId);
    const chosen = join(DATA_DIR, "user-selected-project");
    mkdirSync(chosen);
    for (const folder of [first, second, chosen]) writeFileSync(join(folder, "result.txt"), "Keep my project");
    store.patchBot(bot.id, { cwd: chosen });
    expect(store.deleteTask(bot.id, secondTask.threadId)).not.toBeNull();
    expect(existsSync(join(second, "result.txt"))).toBe(true);
    expect(store.deleteBot(bot.id)).toBe(true);
    for (const folder of [first, second, chosen]) expect(readFileSync(join(folder, "result.txt"), "utf8")).toBe("Keep my project");
  });

  it("applies the bot's model to every thread while preserving each thread's approvals, cursor, rewind and pins across navigation, deletion and reload", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const first = bot.threadId;
    store.patchTask(bot.id, first, {
      modelSelection: { instanceId: "codex", model: "first", effort: "high" },
      rewound: true,
      pinnedMessageId: "first-pin",
    });
    store.setResumeCursor(bot.id, "codex", { session: "first-session" }, first);
    store.appendMessage(first, { role: "user", kind: "text", text: "First conversation" });
    expect(store.projectBotForTask(bot.id, first)?.modelSelection).toEqual({ instanceId: "codex", model: "first", effort: "high" });
    store.patchBot(bot.id, {
      modelSelection: { instanceId: "claude", model: "second-default" },
      approvalMode: "ask",
      alwaysAllow: ["Read"],
    });
    // a9872c8a9 (#1810): a new bot model clears earlier thread picks;
    // permissions and native conversation state remain independent.
    expect(store.taskByThread(bot.id, first)?.modelSelection).toBeUndefined();
    expect(store.projectBotForTask(bot.id, first)?.modelSelection).toEqual({ instanceId: "claude", model: "second-default" });
    // #1207: a level chosen in one thread after the bot's is its own
    // exception (setting the bot's level ends every exception).
    store.patchTask(bot.id, first, { approvalMode: "auto", autoApprove: true, alwaysAllow: ["Bash:git"] });
    const second = store.createTask(bot.id)!;
    expect(second).toMatchObject({ resumeCursors: {} });
    expect(second.approvalMode).toBeUndefined();
    expect(store.projectBotForTask(bot.id, second.threadId)).toMatchObject({ approvalMode: "ask", alwaysAllow: ["Read"] });
    expect(second.modelSelection).toBeUndefined();
    expect(store.projectBotForTask(bot.id, second.threadId)?.modelSelection).toEqual({ instanceId: "claude", model: "second-default" });
    expect(bot.rewound).toBeUndefined();
    expect(bot.pinnedMessageId).toBeUndefined();
    store.setResumeCursor(bot.id, "claude", "second-session");
    store.patchTask(bot.id, second.threadId, { pinnedMessageId: "second-pin" });
    store.patchBot(bot.id, { modelSelection: selection(), alwaysAllow: ["Other"] });
    expect(store.tasks(bot.id).every((task) => task.modelSelection === undefined)).toBe(true);
    const detached = store.createTask(bot.id, "Background", false)!;
    expect(bot.threadId).toBe(second.threadId);

    store.switchTask(bot.id, first);
    expect(bot).toMatchObject({
      modelSelection: selection(),
      resumeCursors: { codex: { session: "first-session" } },
      rewound: true,
      pinnedMessageId: "first-pin",
    });
    expect(store.projectBotForTask(bot.id, first)).toMatchObject({
      modelSelection: selection(),
      approvalMode: "auto",
      alwaysAllow: ["Bash:git"],
    });
    // No model or level of its own: it moved with the bot's.
    expect(store.projectBotForTask(bot.id, second.threadId)).toMatchObject({
      modelSelection: selection(),
      approvalMode: "ask",
      alwaysAllow: ["Other"],
    });
    store.deleteTask(bot.id, detached.threadId);
    store.deleteTask(bot.id, first);
    expect(bot).toMatchObject({ threadId: second.threadId, pinnedMessageId: "second-pin", resumeCursors: { claude: "second-session" } });
    expect(bot.rewound).toBeUndefined();
    const reloaded = new Store(selection);
    expect(reloaded.projectBotForTask(bot.id, second.threadId)).toMatchObject({
      modelSelection: selection(),
      approvalMode: "ask",
      alwaysAllow: ["Other"],
      resumeCursors: { claude: "second-session" },
      pinnedMessageId: "second-pin",
    });
    expect(reloaded.bot(bot.id)?.modelSelection).toEqual(selection());
  });

  it("projects cloned dispatch settings and permits only constrained task fields", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const task = store.activeTask(bot.id)!;
    const modelSelection: ModelSelection = { instanceId: "codex", model: "task" };
    const alwaysAllow = ["Read"];
    store.patchTask(bot.id, task.threadId, {
      modelSelection, alwaysAllow, resumeCursors: { codex: { session: "original" } },
      threadId: "replacement", activity: "working", busy: true,
    } as TaskPatch);
    modelSelection.model = "caller-mutated";
    alwaysAllow.push("Bash");
    expect(task.modelSelection?.model).toBe("task");
    expect(task.alwaysAllow).toEqual(["Read"]);
    expect(task.threadId).toBe(bot.threadId);
    expect(task.busy).toBe(false);
    const projected = store.projectBotForTask(bot.id, task.threadId)!;
    projected.modelSelection.model = "snapshot-mutated";
    projected.alwaysAllow!.push("Write");
    (projected.resumeCursors.codex as { session: string }).session = "snapshot-mutated";
    expect(task.modelSelection?.model).toBe("task");
    expect(task.alwaysAllow).toEqual(["Read"]);
    expect(task.resumeCursors).toEqual({ codex: { session: "original" } });
    expect(store.projectBotForTask(bot.id, "missing")).toBeNull();
    expect(store.patchTask(bot.id, "missing", { unread: true })).toBeNull();
  });

  it("aggregates independent task activity without persisting it or clearing another task", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const first = bot.threadId;
    const second = store.createTask(bot.id, undefined, false)!;
    const seen: string[] = [];
    store.onChange((change) => seen.push(change.type));
    store.setTaskActivity(bot.id, first, "working");
    const firstTurnStarted = store.tasks(bot.id).find((task) => task.threadId === first)?.turnStartedAt;
    expect(firstTurnStarted).toBeGreaterThan(0);
    store.setTaskActivity(bot.id, second.threadId, "waiting-on-you");
    const secondTurnStarted = store.tasks(bot.id).find((task) => task.threadId === second.threadId)?.turnStartedAt;
    expect(secondTurnStarted).toBeGreaterThan(0);
    store.setTaskActivity(bot.id, second.threadId, "waiting-on-you");
    expect(store.tasks(bot.id).find((task) => task.threadId === second.threadId)?.turnStartedAt).toBe(secondTurnStarted);
    expect(seen).toEqual(["bot", "bot"]);
    expect(bot).toMatchObject({ activity: "waiting-on-you", busy: true });
    store.setActivity(bot.id, "working");
    store.setActivity(bot.id, "idle");
    expect(bot).toMatchObject({ activity: "waiting-on-you", busy: true });
    store.setTaskActivity(bot.id, first, "idle");
    expect(store.tasks(bot.id).find((task) => task.threadId === first)?.turnStartedAt).toBeUndefined();
    expect(bot.busy).toBe(true);
    expect(store.projectBotForTask(bot.id, first)).toMatchObject({ activity: "idle", busy: false });
    store.switchTask(bot.id, second.threadId);
    store.patchBot(bot.id, { name: "Saved while working" });
    expect(savedBots()[0]).not.toHaveProperty("busy");
    expect(savedBots()[0]).not.toHaveProperty("activity");
    for (const task of savedBots()[0]!.tasks!) {
      expect(task).not.toHaveProperty("busy");
      expect(task).not.toHaveProperty("activity");
      expect(task).not.toHaveProperty("turnStartedAt");
    }
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)).toMatchObject({ activity: "idle", busy: false });
    expect(reloaded.tasks(bot.id).every((task) => task.activity === "idle" && !task.busy && task.turnStartedAt === undefined)).toBe(true);
    store.deleteTask(bot.id, second.threadId);
    expect(bot).toMatchObject({ activity: "idle", busy: false });
  });

  it("stamps a group's busy member turn without persisting it", async () => {
    const store = new Store(selection);
    const lead = store.createBot({}, { seedMessages: false });
    const other = store.createBot({}, { seedMessages: false });
    const group = store.createGroup("Timer group", [lead.id, other.id], false);
    expect(group.busyBotId).toBeNull();
    expect(group.turnStartedAt).toBeUndefined();
    // Patches that never touch the speaker leave the stamp alone.
    store.patchGroup(group.id, { unread: true });
    expect(group.turnStartedAt).toBeUndefined();
    store.patchGroup(group.id, { busyBotId: lead.id });
    const started = group.turnStartedAt!;
    expect(started).toBeGreaterThan(0);
    // An unrelated patch mid-turn, or re-claiming the same member, is the
    // same turn: the stamp must not move.
    store.patchGroup(group.id, { bulletin: "changed" });
    store.patchGroup(group.id, { busyBotId: lead.id });
    expect(group.turnStartedAt).toBe(started);
    // A different speaker is a new turn: the count restarts.
    await new Promise((done) => setTimeout(done, 3));
    store.patchGroup(group.id, { busyBotId: other.id });
    expect(group.turnStartedAt!).toBeGreaterThan(started);
    store.patchGroup(group.id, { busyBotId: null });
    expect(group.turnStartedAt).toBeUndefined();
    // Neither the speaker nor the stamp survives persistence or a reload.
    const saved = savedGroups().find((row) => row.id === group.id)!;
    expect(saved).not.toHaveProperty("busyBotId");
    expect(saved).not.toHaveProperty("turnStartedAt");
    const reloaded = new Store(selection);
    const restored = reloaded.group(group.id)!;
    expect(restored.busyBotId).toBeNull();
    expect(restored.turnStartedAt).toBeUndefined();
  });

  it("keeps background unread after reading the selected task, including across restart", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const first = bot.threadId;
    const second = store.createTask(bot.id, undefined, false)!;
    store.patchTask(bot.id, first, { unread: true });
    store.patchTask(bot.id, second.threadId, { unread: true });
    store.patchBot(bot.id, { unread: false });
    expect(store.taskByThread(bot.id, first)?.unread).toBe(false);
    expect(second.unread).toBe(true);
    expect(bot.unread).toBe(true);
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.unread).toBe(true);
    reloaded.switchTask(bot.id, second.threadId);
    reloaded.patchBot(bot.id, { unread: false });
    expect(reloaded.bot(bot.id)?.unread).toBe(false);
  });

  it("migrates legacy model, cursor, pin and unread without losing transcripts or stale active pointers", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const first = bot.threadId;
    store.appendMessage(first, { role: "user", kind: "text", text: "Original conversation" });
    const second = store.createTask(bot.id)!;
    store.appendMessage(second.threadId, { role: "user", kind: "text", text: "Second conversation" });
    const legacy = savedBots();
    const raw = legacy[0]!;
    raw.threadId = first;
    raw.tasks = raw.tasks!.filter((task) => task.threadId !== first);
    delete raw.tasks[0]!.modelSelection;
    raw.tasks[0]!.activity = "working";
    raw.tasks[0]!.busy = true;
    raw.modelSelection = { instanceId: "legacy-engine", model: "legacy-model" };
    raw.resumeCursors = { "legacy-engine": "old-session" };
    raw.rewound = true;
    raw.pinnedMessageId = "legacy-pin";
    raw.unread = true;
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(legacy));
    const migrated = new Store(selection);
    expect(migrated.tasks(bot.id)).toHaveLength(2);
    expect(migrated.projectBotForTask(bot.id, first)).toMatchObject({
      modelSelection: raw.modelSelection,
      resumeCursors: { "legacy-engine": "old-session" },
      rewound: true,
      pinnedMessageId: "legacy-pin",
      unread: true,
    });
    // A thread without a model of its own follows the bot; none is filled in.
    expect(migrated.taskByThread(bot.id, second.threadId)).toMatchObject({ activity: "idle", busy: false });
    expect(migrated.projectBotForTask(bot.id, second.threadId)?.modelSelection).toEqual(raw.modelSelection);
    expect(migrated.messagesFor(first).at(-1)?.text).toBe("Original conversation");
    expect(migrated.messagesFor(second.threadId).at(-1)?.text).toBe("Second conversation");
    expect(savedBots()[0]!.tasks).toHaveLength(2);
    expect(savedBots()[0]!.tasks!.every((task) => task.modelSelection === undefined)).toBe(true);
  });

  it("moves Ask bots and threads to Approve for me once, and leaves a later Ask choice", () => {
    // The Ask→Auto migration only runs when new bots still start on Auto
    // (org New-bot policy). Solo servers now start on Full (omb #2808).
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify([
      { id: "ask-bot", name: "Ask", threadId: "t1", soul: "", computer: "cloud", approvalMode: "ask", autoApprove: false,
        tasks: [{ threadId: "t1", title: "One", approvalMode: "ask", autoApprove: false }, { threadId: "t2", title: "Two" }] },
      { id: "plain-bot", name: "Plain", threadId: "p1", soul: "", tasks: [{ threadId: "p1", title: "Plain" }] },
      { id: "full-bot", name: "Full", threadId: "f1", soul: "", approvalMode: "full",
        tasks: [{ threadId: "f1", title: "Full", approvalMode: "full" }, { threadId: "f2", title: "Ask thread", approvalMode: "ask" }] },
      { id: "local-bot", name: "Local", threadId: "l1", soul: "", computer: "local", approvalMode: "ask",
        tasks: [{ threadId: "l1", title: "Local", approvalMode: "ask" }] },
      { id: "edits-bot", name: "Edits", threadId: "e1", soul: "", approvalMode: "edits",
        tasks: [{ threadId: "e1", title: "Edits", approvalMode: "edits" }] },
      { id: "revoked-bot", name: "Revoked", threadId: "r1", soul: "", approvalMode: "full",
        approvalGrant: { requestId: "123e4567-e89b-42d3-a456-426614174000", mode: "full", phase: "confirmed" },
        tasks: [
          { threadId: "r1", title: "Was full", approvalMode: "full" },
          { threadId: "r2", title: "Already ask", approvalMode: "ask" },
        ] },
    ]));
    const store = new Store(selection, (s) => s, () => "auto");
    // #1207: a thread's stored copy of the level (no stated exception) is
    // dropped at startup, and the thread reads its bot's level live.
    const level = (s: Store, botId: string, threadId: string) => s.projectBotForTask(botId, threadId);
    expect(store.tasks("ask-bot").every(task => task.approvalMode === undefined && task.autoApprove === undefined)).toBe(true);
    expect(store.bot("ask-bot")).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(level(store, "ask-bot", "t1")).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(level(store, "ask-bot", "t2")).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(store.bot("plain-bot")).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(level(store, "plain-bot", "p1")).toMatchObject({ approvalMode: "auto" });
    expect(store.bot("full-bot")?.approvalMode).toBe("full");
    expect(level(store, "full-bot", "f1")?.approvalMode).toBe("full");
    // an Ask copy with no exception was a copy: it follows the Full bot now
    expect(level(store, "full-bot", "f2")?.approvalMode).toBe("full");
    expect(store.bot("local-bot")).toMatchObject({ approvalMode: "ask" });
    expect(level(store, "local-bot", "l1")?.approvalMode).toBe("ask");
    expect(store.bot("edits-bot")?.approvalMode).toBe("edits");
    expect(level(store, "edits-bot", "e1")?.approvalMode).toBe("edits");
    expect(store.bot("revoked-bot")).toMatchObject({ approvalMode: "ask", autoApprove: false });
    expect(store.bot("revoked-bot")).not.toHaveProperty("approvalGrant");
    expect(level(store, "revoked-bot", "r1")?.approvalMode).toBe("ask");
    expect(level(store, "revoked-bot", "r2")?.approvalMode).toBe("ask");
    store.patchBot("ask-bot", { approvalMode: "ask", autoApprove: false });
    store.patchTask("ask-bot", "t1", { approvalMode: "ask", autoApprove: false });
    const again = new Store(selection, (s) => s, () => "auto");
    expect(again.bot("ask-bot")?.approvalMode).toBe("ask");
    expect(again.taskByThread("ask-bot", "t1")).toMatchObject({ approvalMode: "ask", approvalOwn: "thread" });
    expect(level(again, "ask-bot", "t1")?.approvalMode).toBe("ask");
    expect(level(again, "ask-bot", "t2")?.approvalMode).toBe("ask");
    expect(again.bot("plain-bot")?.approvalMode).toBe("auto");
    const created = again.createBot({}, { seedMessages: false });
    expect(created).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(level(again, created.id, created.threadId)).toMatchObject({ approvalMode: "auto", autoApprove: true });
  });

  it("revokes elevated task snapshots along with a stale bot elevation grant", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    store.patchBot(bot.id, { approvalMode: "full", autoApprove: true });
    const task = store.createTask(bot.id)!;
    expect(approvalModeFor(store.projectBotForTask(bot.id, task.threadId)!)).toBe("full");
    store.patchBot(bot.id, {
      approvalGrant: { requestId: "uncommitted", mode: "full", phase: "prepared" },
    });
    expect(approvalModeFor(store.projectBotForTask(bot.id, task.threadId)!)).toBe("ask");
    const reloaded = new Store(selection);
    // #1207: the thread keeps no elevated copy; it follows the revoked bot
    expect(reloaded.taskByThread(bot.id, task.threadId)?.approvalMode).toBeUndefined();
    expect(reloaded.bot(bot.id)).toMatchObject({ approvalMode: "ask", autoApprove: false });
    expect(reloaded.projectBotForTask(bot.id, task.threadId)).toMatchObject({ approvalMode: "ask", autoApprove: false });
    expect(approvalModeFor(reloaded.projectBotForTask(bot.id, task.threadId)!)).toBe("ask");
  });

  it("groups threads in folders without changing models or running state", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const legacyThread = bot.threadId;
    expect(bot.projects ?? []).toEqual([]);
    const project = store.createProject(bot.id, "  Website  ")!;
    const other = store.createProject(bot.id, "Research")!;
    const task = store.createTask(bot.id, "Landing page", true, project.id)!;
    expect(task).toMatchObject({ projectId: project.id });
    expect(store.projectBotForTask(bot.id, task.threadId)?.modelSelection).toEqual(selection());
    store.patchTask(bot.id, task.threadId, { modelSelection: { instanceId: "codex", model: "thread-specific" } });
    store.setResumeCursor(bot.id, "codex", "project-session", task.threadId);
    store.appendMessage(task.threadId, { role: "user", kind: "text", text: "Keep this conversation" });
    store.pinTaskCwd(bot.id, task.threadId, "/task-specific-folder");
    store.setTaskActivity(bot.id, task.threadId, "working");
    const running = store.projectBotForTask(bot.id, task.threadId)!;
    store.patchProject(bot.id, project.id, { name: "Site" });
    store.patchTask(bot.id, task.threadId, { projectId: other.id });
    expect(task).toMatchObject({ projectId: other.id, modelSelection: running.modelSelection, busy: true, resumeCursors: { codex: "project-session" }, cwd: null });
    const next = store.createTask(bot.id, "Next project thread", false, project.id)!;
    expect(next.modelSelection).toBeUndefined();
    expect(store.activeTask(bot.id)?.threadId).toBe(task.threadId);
    store.deleteProject(bot.id, other.id);
    expect(task.projectId).toBeUndefined();
    expect(task.busy).toBe(true);
    expect(store.messagesFor(task.threadId).at(-1)?.text).toBe("Keep this conversation");
    expect(store.taskByThread(bot.id, legacyThread)).toBeTruthy();
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.projects).toEqual([{ id: project.id, name: "Site" }]);
    expect(reloaded.taskByThread(bot.id, next.threadId)?.projectId).toBe(project.id);
    expect(reloaded.taskByThread(bot.id, task.threadId)?.projectId).toBeUndefined();
    expect(reloaded.projectBotForTask(bot.id, task.threadId)?.modelSelection).toEqual(running.modelSelection);
  });

  it("persists folder order and emoji without creating threads or changing their settings", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const originalThread = bot.threadId;
    const originalTasks = structuredClone(store.tasks(bot.id));
    const first = store.createProject(bot.id, "Website", "👩🏽‍💻")!;
    const second = store.createProject(bot.id, "Research", "🇮🇳")!;
    const legacy = store.createProject(bot.id, "No emoji")!;
    expect(bot.threadId).toBe(originalThread);
    expect(store.tasks(bot.id)).toEqual(originalTasks);
    expect(legacy).toEqual({ id: legacy.id, name: "No emoji" });
    const changes: unknown[] = [];
    store.onChange((change) => changes.push(change));
    expect(store.reorderProjects(bot.id, [legacy.id, second.id, first.id])).toEqual([legacy, second, first]);
    expect(changes).toEqual([{ type: "bot", botId: bot.id }]);
    let reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.projects).toEqual([legacy, second, first]);
    expect(reloaded.tasks(bot.id)).toEqual(originalTasks);
    expect(reloaded.patchProject(bot.id, first.id, { name: "Site", emoji: "❤️" })).toMatchObject({ name: "Site", emoji: "❤️" });
    reloaded = new Store(selection);
    expect(reloaded.project(bot.id, first.id)?.emoji).toBe("❤️");
    expect(reloaded.patchProject(bot.id, first.id, { emoji: null })).not.toHaveProperty("emoji");
    reloaded = new Store(selection);
    expect(reloaded.project(bot.id, first.id)).toEqual({ id: first.id, name: "Site" });
    expect(reloaded.bot(bot.id)?.projects?.map((project) => project.id)).toEqual([legacy.id, second.id, first.id]);
    expect(reloaded.project(bot.id, second.id)?.emoji).toBe("🇮🇳");
    expect(reloaded.tasks(bot.id)).toEqual(originalTasks);
  });

  it("rejects invalid folder order and emoji without partially changing saved state", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const sibling = store.createBot();
    const first = store.createProject(bot.id, "One", "📁")!;
    const second = store.createProject(bot.id, "Two", "🔬")!;
    const foreign = store.createProject(sibling.id, "Sibling")!;
    for (const ids of [[], [first.id], [first.id, first.id], [first.id, "missing"], [first.id, foreign.id], [first.id, second.id, foreign.id]]) {
      expect(store.reorderProjects(bot.id, ids)).toBeNull();
    }
    expect(store.reorderProjects("missing-bot", [])).toBeNull();
    expect(store.createProject(bot.id, "Invalid", "two words")).toBeNull();
    expect(store.patchProject(bot.id, first.id, { name: "Should not change", emoji: "📁📁" })).toBeNull();
    expect(store.patchProject(sibling.id, first.id, { emoji: "⭐" })).toBeNull();
    expect(new Store(selection).bot(bot.id)?.projects).toEqual([first, second]);
    const task = store.createTask(bot.id, "Keep thread", true, first.id)!;
    store.appendMessage(task.threadId, { role: "user", kind: "text", text: "Keep history" });
    store.deleteProject(bot.id, first.id);
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.projects).toEqual([second]);
    expect(reloaded.taskByThread(bot.id, task.threadId)?.projectId).toBeUndefined();
    expect(reloaded.messagesFor(task.threadId).at(-1)?.text).toBe("Keep history");
  });

  it("accepts one Unicode emoji, including composed forms, but not text or incomplete components", () => {
    for (const emoji of ["📁", "🗂️", "👩🏽‍💻", "👩‍👩‍👦", "🇮🇳", "👍🏽", "❤️", "♥", "1️⃣"]) {
      expect(isProjectEmoji(emoji), emoji).toBe(true);
    }
    for (const emoji of ["", "folder", "📁📁", "📁x", "📁\n", " 📁", "1", "🇮", "🏽", "📁\u200d", "☕🏽", "a".repeat(65), null, 1, {}]) {
      expect(isProjectEmoji(emoji), JSON.stringify(emoji)).toBe(false);
    }
  });

  it("discards unshipped folder model defaults without changing saved thread models", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const sibling = store.createBot();
    const project = store.createProject(bot.id, "General", "⭐")!;
    store.patchTask(bot.id, bot.threadId, { modelSelection: { instanceId: "codex", model: "existing-thread" } });
    // A thread a folder holds follows the bot's model.
    expect(store.createTask(bot.id, undefined, false, project.id)?.modelSelection).toBeUndefined();
    expect(store.createTask(sibling.id, undefined, false, project.id)).toBeNull();
    expect(store.patchTask(sibling.id, sibling.threadId, { projectId: project.id })).toBeNull();
    expect(store.deleteProject(sibling.id, project.id)).toBeNull();
    expect(store.patchProject(sibling.id, project.id, { name: "Wrong owner" })).toBeNull();
    const saved = savedBots();
    Object.assign(saved.find((entry) => entry.id === bot.id)!.projects![0], { modelSelection: { instanceId: "codex", model: "removed-folder-default" } });
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(saved));
    const reloaded = new Store(selection);
    expect(reloaded.project(bot.id, project.id)).toEqual({ id: project.id, name: "General", emoji: "⭐" });
    expect(reloaded.taskByThread(bot.id, bot.threadId)?.modelSelection).toEqual({ instanceId: "codex", model: "existing-thread" });
    expect(reloaded.createTask(bot.id, undefined, false, project.id)?.modelSelection).toBeUndefined();
  });

  it("pins a thread without storing false, and advances updatedAt from a message without rewriting bots.json", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const task = store.createTask(bot.id, "Pinned later")!;
    flushOwnedFilesSync();
    const before = readFileSync(join(DATA_DIR, "bots.json"));
    const message = store.appendMessage(task.threadId, { role: "user", kind: "text", text: "still here" });
    expect(store.taskByThread(bot.id, task.threadId)?.updatedAt).toBe(message.at);
    expect(readFileSync(join(DATA_DIR, "bots.json"))).toEqual(before);
    expect(store.patchTask(bot.id, task.threadId, { pinned: true })?.pinned).toBe(true);
    expect(savedBots().find((entry) => entry.id === bot.id)!.tasks!.find((entry) => entry.threadId === task.threadId)!.pinned).toBe(true);
    expect(store.patchTask(bot.id, task.threadId, { pinned: false })?.pinned).toBeUndefined();
    expect("pinned" in savedBots().find((entry) => entry.id === bot.id)!.tasks!.find((entry) => entry.threadId === task.threadId)!).toBe(false);
    const group = store.createGroup("Channel", [bot.id], false);
    const channel = store.createGroupTask(group.id, "Side")!;
    expect(store.setGroupTaskPinned(group.id, channel.threadId, true)?.pinned).toBe(true);
    expect(savedGroups().find((entry) => entry.id === group.id)!.tasks!.find((entry) => entry.threadId === channel.threadId)!.pinned).toBe(true);
    store.setGroupTaskPinned(group.id, channel.threadId, false);
    expect("pinned" in savedGroups().find((entry) => entry.id === group.id)!.tasks!.find((entry) => entry.threadId === channel.threadId)!).toBe(false);
    const restarted = new Store(selection);
    expect(restarted.taskByThread(bot.id, task.threadId)?.updatedAt).toBe(message.at);
  });
});
