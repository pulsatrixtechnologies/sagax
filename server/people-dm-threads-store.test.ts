// A conversation between two people has threads like a bot (server/people/people-dms.ts).
// In the store: the migration of a conversation saved by 0.4.16 into its
// "General" thread (no data loss, same thread id, done once), new threads
// that do not move the default thread, and folders shared with bots.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { flushOwnedFilesSync } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store, type GroupRecord } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";
const GROUPS = () => join(DATA_DIR, "groups.json");
// What the store saved, its waiting bookkeeping saves included (server/atomic.ts).
const savedGroups = (): GroupRecord[] => {
  flushOwnedFilesSync();
  return JSON.parse(readFileSync(GROUPS(), "utf8"));
};

function newPersonConversation(store: Store): GroupRecord {
  return store.createGroup("Alice, Bob", [], false, undefined, { defaultResponder: { kind: "mentions" } }, [ALICE, BOB], { peopleDm: true, createdBy: ALICE });
}

/** Rewrite groups.json as 0.4.16 saved it: no migration marker, the one
 * task untitled (or, older still, no task list at all). */
function asSavedBy0416(mutate?: (group: Record<string, unknown>) => void) {
  const groups = savedGroups().map((group) => {
    const legacy = { ...group } as Record<string, unknown>;
    delete legacy.personThreads;
    legacy.tasks = (group.tasks ?? []).map(({ general: _general, ...task }) => ({ ...task, title: "New task" }));
    mutate?.(legacy);
    return legacy;
  });
  writeFileSync(GROUPS(), JSON.stringify(groups, null, 2));
}

describe("person conversation threads in the store", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("a new conversation starts on its General thread, already migrated", () => {
    const store = new Store(selection);
    const group = newPersonConversation(store);
    expect(group.tasks).toEqual([expect.objectContaining({ threadId: group.threadId, title: "General", general: true })]);
    expect(savedGroups()[0]).toMatchObject({ personThreads: 1 });
  });

  it("migrates a conversation saved by 0.4.16 into its General thread, with every message, once", () => {
    const first = new Store(selection);
    const group = newPersonConversation(first);
    first.appendMessage(group.threadId, { role: "user", kind: "text", text: "lunch at noon?", sender: { id: ALICE, name: "Alice" } });
    first.appendMessage(group.threadId, { role: "user", kind: "text", text: "sure", sender: { id: BOB, name: "Bob" } });
    first.patchGroup(group.id, { unread: true, unreadFor: [ALICE] });
    asSavedBy0416();

    const reopened = new Store(selection);
    const migrated = reopened.group(group.id)!;
    // the conversation is its first thread: same id, so the transcript did not move
    expect(migrated.threadId).toBe(group.threadId);
    expect(migrated.tasks).toEqual([expect.objectContaining({ threadId: group.threadId, title: "General", general: true })]);
    expect(reopened.messagesFor(group.threadId).map((message) => message.text)).toEqual(["lunch at noon?", "sure"]);
    // unread state and people are untouched
    expect(migrated).toMatchObject({ peopleDm: true, humanIds: [ALICE, BOB], unread: true, unreadFor: [ALICE] });
    expect(savedGroups()[0]).toMatchObject({ personThreads: 1 });

    // once: a General renamed later is never renamed back
    reopened.renameGroupTask(group.id, group.threadId, "Lunch plans");
    const again = new Store(selection);
    expect(again.group(group.id)!.tasks![0]!.title).toBe("Lunch plans");
  });

  it("migrates a conversation from before task lists existed", () => {
    const first = new Store(selection);
    const group = newPersonConversation(first);
    first.appendMessage(group.threadId, { role: "user", kind: "text", text: "hello", sender: { id: ALICE, name: "Alice" } });
    asSavedBy0416((legacy) => { delete legacy.tasks; });
    const reopened = new Store(selection);
    expect(reopened.group(group.id)!.tasks).toEqual([expect.objectContaining({ threadId: group.threadId, title: "General", general: true })]);
    expect(reopened.messagesFor(group.threadId).map((message) => message.text)).toEqual(["hello"]);
  });

  it("a new thread is filed and organized like a bot's, and never moves the default thread", () => {
    const store = new Store(selection);
    const group = newPersonConversation(store);
    const folder = store.createGroupProject(group.id, "Projects", "📁")!;
    const budget = store.createGroupTask(group.id, "Budget", false, folder.id)!;
    expect(store.group(group.id)!.threadId).toBe(group.threadId);
    expect(budget).toMatchObject({ title: "Budget", projectId: folder.id });
    // a folder that is not this conversation's is refused
    expect(store.patchGroupTask(group.id, budget.threadId, { projectId: "elsewhere" })).toBeNull();
    const organized = store.patchGroupTask(group.id, budget.threadId, { archivedAt: 10, snoozedUntil: 0, pinned: true })!;
    expect(organized).toMatchObject({ archivedAt: 10, snoozedUntil: 0, pinned: true, projectId: folder.id });
    // an until-activity snooze wakes on the next message
    store.appendMessage(budget.threadId, { role: "user", kind: "text", text: "numbers attached", sender: { id: BOB, name: "Bob" } });
    expect(store.groupTaskByThread(group.id, budget.threadId)?.snoozedUntil).toBeUndefined();
    // unarchive, unpin, unfile
    expect(store.patchGroupTask(group.id, budget.threadId, { archivedAt: undefined, pinned: undefined, projectId: undefined })).not.toHaveProperty("archivedAt");
    // folders reorder and delete like a bot's; deleting one keeps its threads
    store.patchGroupTask(group.id, budget.threadId, { projectId: folder.id });
    const second = store.createGroupProject(group.id, "Later")!;
    expect(store.reorderGroupProjects(group.id, [second.id, folder.id])?.map((project) => project.id)).toEqual([second.id, folder.id]);
    expect(store.reorderGroupProjects(group.id, [second.id])).toBeNull();
    expect(store.patchGroupProject(group.id, folder.id, { name: "Work", emoji: null })).toEqual({ id: folder.id, name: "Work" });
    store.deleteGroupProject(group.id, folder.id);
    expect(store.groupTaskByThread(group.id, budget.threadId)).not.toHaveProperty("projectId");
    expect(store.group(group.id)!.tasks).toHaveLength(2);
    // persisted
    expect(savedGroups()[0]!.projects).toEqual([{ id: second.id, name: "Later" }]);
  });

  it("a bot's folders still work through the shared implementation", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const project = store.createProject(bot.id, "Ops")!;
    const task = store.createTask(bot.id, "Deploy", false, project.id)!;
    expect(store.project(bot.id, project.id)?.name).toBe("Ops");
    expect(store.deleteProject(bot.id, project.id)?.id).toBe(bot.id);
    expect(store.taskByThread(bot.id, task.threadId)).not.toHaveProperty("projectId");
    // a group's folder id is never a bot's
    const group = newPersonConversation(store);
    const folder = store.createGroupProject(group.id, "Mine")!;
    expect(store.project(bot.id, folder.id)).toBeUndefined();
  });
});
