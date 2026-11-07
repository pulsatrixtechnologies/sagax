// f9ddcfc437 keeps a scheduled continuation working on the wire; 9501572bf
// folds only the viewer's own activity. Exercise their actual composition,
// including hidden-thread selection and private-thread projection.
import { readFileSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { effectiveBotOwner as resolveBotOwner } from "../bots/bot-owner.ts";
import { DATA_DIR } from "../config.ts";
import { Store, toWireTask, type BotRecord, type TaskRecord } from "../store.ts";
import { transpileTs } from "../testing/transpile.ts";
import { createViewerBotActivity } from "../index-leaves/viewerBotActivity.ts";
import { narrowBotForViewer, ownsThread, viewerThread } from "./thread-privacy.ts";

const ALICE = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";
const model = { instanceId: "claude", model: "fixture" };

// Same source-execution pattern as managed-policy.test.ts and
// models/default-model-selection.test.ts: execute index.ts's real selector
// and task projection, without importing the server or copying their logic.
const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const extract = (signature: string, closing = "\n}\n") => {
  const start = source.indexOf(`\n${signature}`);
  const end = source.indexOf(closing, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start + 1, end + closing.trimEnd().length);
};
const line = (signature: string) => {
  const found = source.split("\n").find((value) => value.startsWith(signature));
  expect(found).toBeTruthy();
  return found!;
};
const code = transpileTs([
  line("const HELD_ACTIVITY ="), line("const selectionKey ="),
  // viewerBotActivity moved to index-leaves/ (#1388): built below on the same host.
  extract("function effectiveBotOwner("),
  extract("const wireTask =", "\n};\n"), extract("function listedTasks<"),
].join("\n"));

type Selectors = {
  viewerBotActivity(bot: BotRecord, viewerId: string): ReturnType<Store["activityOf"]>;
  selectionKey(botId: string, viewerId: string): string;
  wireTask: typeof toWireTask;
  listedTasks(selected: string, tasks: TaskRecord[]): TaskRecord[];
};

function fixture() {
  const store = new Store(() => model);
  const bot = store.createBot({ name: "Shared fixture", ownerUserId: ALICE }, { seedMessages: false });
  store.patchTask(bot.id, bot.threadId, { title: "Alice private conversation" });
  const alice = store.taskByThread(bot.id, bot.threadId)!;
  const bob = store.createTask(bot.id, "Bob private conversation", false, undefined, undefined, undefined, BOB)!;
  const selections = new Map<string, string>();
  const holds = new Set<string>();
  const hostSelectors = new Function(
    "store", "resolveBotOwner", "localPrincipalId", "viewerSelections", "ownsThread", "continuationHolds",
    "threadsWithActiveCoordination", "cacheKeepWarmStatus", "toWireTask",
    `${code}\nreturn { HELD_ACTIVITY, effectiveBotOwner, selectionKey, wireTask, listedTasks };`,
  )(store, resolveBotOwner, () => ALICE, selections, ownsThread, holds, () => new Set(), () => undefined, toWireTask) as Omit<Selectors, "viewerBotActivity"> & {
    HELD_ACTIVITY: unknown; effectiveBotOwner(bot: BotRecord): string;
  };
  const host = { store, viewerSelections: selections, continuationHolds: holds, ...hostSelectors };
  const selectors: Selectors = { ...hostSelectors, viewerBotActivity: createViewerBotActivity(() => host) };
  const activity = (person: string) => selectors.viewerBotActivity(bot, person);
  const select = (person: string, threadId: string) => selections.set(selectors.selectionKey(bot.id, person), threadId);
  const project = (person: string, fromFrame = false) => {
    const mine = viewerThread({ tasks: store.tasks(bot.id), viewerId: person, botOwnerPrincipalId: ALICE,
      current: bot.threadId, selected: selections.get(selectors.selectionKey(bot.id, person)) })!;
    const task = selectors.wireTask(store.taskByThread(bot.id, mine)!, model);
    // GET /api/bots projects the selected task first; SSE starts with the
    // bot's global selection. Both then use the same viewer activity.
    const record = fromFrame ? bot : store.projectBotForTask(bot.id, mine)!;
    return narrowBotForViewer({ ...record, mainThreadId: bot.threadId,
      messages: [{ id: "private-message", text: record.threadId === bob.threadId ? "Bob private text" : "Alice private text" }],
      tasks: selectors.listedTasks(record.threadId, store.tasks(bot.id)).map((entry) => selectors.wireTask(entry, model)),
    }, { viewerId: person, botOwnerPrincipalId: ALICE, mine, mineTask: { ...task }, mineWireTask: { ...task }, activity: activity(person) });
  };
  return { store, bot, alice, bob, holds, selectors, activity, select, project };
}

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

describe("a viewer's scheduled continuation", () => {
  it.each(["alice", "bob"] as const)("keeps %s working through the hold, without exposing it to the other person", (owner) => {
    const f = fixture();
    const own = owner === "alice" ? f.alice : f.bob;
    const person = owner === "alice" ? ALICE : BOB;
    const other = owner === "alice" ? BOB : ALICE;
    f.holds.add(own.threadId);
    // A hold is wire state, not a live turn in the store.
    expect(f.store.activityOf(f.bot.id, () => true)).toEqual({ activity: "idle", busy: false });
    expect(f.selectors.wireTask(own, model)).toMatchObject({ activity: "working", busy: true });
    expect(f.activity(person)).toEqual({ activity: "working", busy: true });
    expect(f.project(person)).toMatchObject({ activity: "working", busy: true });
    expect(f.project(person, true)).toMatchObject({ activity: "working", busy: true });
    expect(f.activity(other)).toEqual({ activity: "idle", busy: false });
    const privateView = f.project(other);
    expect(privateView).toMatchObject({ activity: "idle", busy: false });
    expect(f.project(other, true)).toMatchObject({ activity: "idle", busy: false });
    expect(privateView.tasks.map((task) => task.threadId)).not.toContain(own.threadId);
    expect(JSON.stringify(privateView)).not.toContain(owner === "alice" ? "Alice private" : "Bob private");
    f.holds.delete(own.threadId);
    expect(f.activity(person)).toEqual({ activity: "idle", busy: false });
    expect(f.project(person)).toMatchObject({ activity: "idle", busy: false });
  });

  it("counts another visible thread owned by the viewer while their selected conversation is idle", () => {
    const f = fixture();
    const sibling = f.store.createTask(f.bot.id, "Alice other work", false, undefined, undefined, undefined, ALICE)!;
    f.select(ALICE, f.alice.threadId);
    f.holds.add(sibling.threadId);
    expect(f.project(ALICE)).toMatchObject({ threadId: f.alice.threadId, activity: "working", busy: true });
    expect(f.project(BOB)).toMatchObject({ threadId: f.bob.threadId, activity: "idle", busy: false });
  });

  it("counts a hidden hold only for its owner who explicitly selected that thread", () => {
    const f = fixture();
    const hidden = f.store.createTask(f.bot.id, "Alice hidden work", false, undefined, undefined, undefined, ALICE, undefined, true)!;
    f.holds.add(hidden.threadId);
    expect(f.activity(ALICE)).toEqual({ activity: "idle", busy: false });
    f.select(BOB, hidden.threadId);
    expect(f.activity(BOB)).toEqual({ activity: "idle", busy: false });
    expect(f.project(BOB).tasks.map((task) => task.threadId)).not.toContain(hidden.threadId);
    f.select(ALICE, hidden.threadId);
    expect(f.project(ALICE)).toMatchObject({ threadId: hidden.threadId, activity: "working", busy: true });
    expect(f.project(ALICE).tasks.map((task) => task.threadId)).toContain(hidden.threadId);
    f.select(ALICE, f.alice.threadId);
    expect(f.project(ALICE)).toMatchObject({ activity: "idle", busy: false });
    expect(f.project(ALICE).tasks.map((task) => task.threadId)).not.toContain(hidden.threadId);
  });

  it("never counts a routine execution as bot-wide work, even when selected or held", () => {
    const f = fixture();
    for (const person of [ALICE, BOB]) {
      const run = f.store.createTask(f.bot.id, "Routine run", false, undefined, undefined, undefined, person)!;
      f.store.patchTask(f.bot.id, run.threadId, { routineRunId: "fixture-run" });
      f.store.setTaskActivity(f.bot.id, run.threadId, "working");
      f.holds.add(run.threadId);
      f.select(person, run.threadId);
      expect(f.activity(person)).toEqual({ activity: "idle", busy: false });
      expect(f.project(person)).toMatchObject({ activity: "idle", busy: false });
    }
  });

  it("keeps the viewer's real waiting activity ahead of a hold, never the other person's", () => {
    const f = fixture();
    f.store.setTaskActivity(f.bot.id, f.alice.threadId, "waiting-on-you");
    f.holds.add(f.alice.threadId);
    expect(f.activity(ALICE)).toEqual({ activity: "waiting-on-you", busy: true });
    expect(f.project(ALICE)).toMatchObject({ activity: "waiting-on-you", busy: true });
    expect(f.project(BOB)).toMatchObject({ activity: "idle", busy: false });
  });
});
