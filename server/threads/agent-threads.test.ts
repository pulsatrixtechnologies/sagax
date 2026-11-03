// An AI client's hidden conversations (#291): the store rules and the
// one-time plan that hides the threads a client opened before the rule
// (server/threads/agent-threads.ts, server/store.ts setTaskHidden).
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActionRow } from "../activity/admin-activity.ts";
import { parseHideList, planHiddenAgentThreads, planHiddenBotThreads } from "./agent-threads.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { isInterBotThread, Store, taskHiddenFromPerson, type BotRecord } from "../store.ts";
import { viewerThread } from "./thread-privacy.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const savedBots = (): BotRecord[] => JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
const OWNER = "pr_00000000-0000-4000-8000-000000000001";

describe("bot-to-bot threads are never shown to the person", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("an unread thread another bot opened never lights the bot's dot; the bot still finds it", () => {
    const store = new Store(selection);
    const quasar = store.createBot({}, { seedMessages: false });
    const agreements = store.createBot({}, { seedMessages: false });
    const task = store.createTask(agreements.id, "@Quasar · work", false, undefined, { botId: quasar.id, name: "Quasar", at: 1, kind: "work" })!;
    expect(isInterBotThread(agreements.id, task)).toBe(true);
    store.patchTask(agreements.id, task.threadId, { unread: true });
    expect(store.bot(agreements.id)!.unread).toBe(false);
    // bots keep using it: it is stored, not hidden
    expect(store.taskByThread(agreements.id, task.threadId)?.hidden).toBeUndefined();
    store.patchTask(agreements.id, agreements.threadId, { unread: true });
    expect(store.bot(agreements.id)!.unread).toBe(true);
  });

  it("a bot's own thread (opened by itself, e.g. incidents) is not bot-to-bot", () => {
    const store = new Store(selection);
    const chief = store.createBot({}, { seedMessages: false });
    const task = store.createTask(chief.id, "Incidents", false, undefined, { botId: chief.id, name: "Chief", at: 1 })!;
    expect(isInterBotThread(chief.id, task)).toBe(false);
    expect(isInterBotThread(chief.id, { title: "x" } as never)).toBe(false);
  });
});

describe("a hidden conversation in the store", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("is created beside the person's chat: never selected, stored hidden, never briefly shown", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const open = bot.threadId;
    const seen: Array<boolean | undefined> = [];
    store.onChange(() => seen.push(store.tasks(bot.id)[0]?.hidden));
    // activate=true is ignored for a hidden thread
    const task = store.createTask(bot.id, "AI client", true, undefined, undefined, undefined, OWNER, undefined, true)!;
    expect(task.hidden).toBe(true);
    expect(seen).toEqual([true]);
    expect(store.bot(bot.id)!.threadId).toBe(open);
    expect(savedBots()[0]!.tasks!.find((entry) => entry.threadId === task.threadId)?.hidden).toBe(true);
    expect(taskHiddenFromPerson(task)).toBe(true);
  });

  it("is never unread, so the bot's dot only answers to what the person can read", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const task = store.createTask(bot.id, "AI client", false, undefined, undefined, undefined, OWNER, undefined, true)!;
    store.patchTask(bot.id, task.threadId, { unread: true });
    expect(store.taskByThread(bot.id, task.threadId)?.unread).toBe(false);
    expect(store.bot(bot.id)!.unread).toBe(false);
    store.patchTask(bot.id, bot.threadId, { unread: true });
    expect(store.bot(bot.id)!.unread).toBe(true);
  });

  it("hiding the selected thread selects the newest visible one, clears its unread, and the fold leaves it out on request", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const older = bot.threadId;
    const leaked = store.createTask(bot.id, "Test de latence", true, undefined, undefined, undefined, OWNER)!;
    store.patchTask(bot.id, leaked.threadId, { unread: true });
    store.setTaskActivity(bot.id, leaked.threadId, "waiting-on-you");
    expect(store.bot(bot.id)!.threadId).toBe(leaked.threadId);
    expect(store.bot(bot.id)!.unread).toBe(true);

    store.setTaskHidden(bot.id, leaked.threadId, true);
    expect(store.bot(bot.id)!.threadId).toBe(older);
    expect(store.bot(bot.id)!.unread).toBe(false);
    expect(store.taskByThread(bot.id, leaked.threadId)).toMatchObject({ hidden: true, unread: false });
    // what a client shows (server/index.ts shownBotActivity): not waiting on a hidden thread
    expect(store.activityOf(bot.id, (task) => task.hidden !== true)).toEqual({ activity: "idle", busy: false });
  });

  it("is not where a person lands when they open the bot, unless they chose it", () => {
    const tasks = [
      { threadId: "chat", ownerPrincipalId: OWNER, createdAt: 1, updatedAt: 5 },
      { threadId: "agent", ownerPrincipalId: OWNER, createdAt: 2, updatedAt: 50, hidden: true },
    ];
    expect(viewerThread({ tasks, viewerId: OWNER, botOwnerPrincipalId: OWNER })).toBe("chat");
    expect(viewerThread({ tasks, viewerId: OWNER, botOwnerPrincipalId: OWNER, current: "agent" })).toBe("chat");
    expect(viewerThread({ tasks, viewerId: OWNER, botOwnerPrincipalId: OWNER, selected: "agent" })).toBe("agent");
    // only a hidden one: the person has no conversation yet (the server starts one)
    expect(viewerThread({ tasks: [tasks[1]!], viewerId: OWNER, botOwnerPrincipalId: OWNER })).toBeUndefined();
  });
});

describe("hiding the threads an AI client opened before #291", () => {
  const row = (after: Record<string, unknown>, extra: Partial<AdminActionRow> = {}): AdminActionRow => ({
    at: "2026-10-11T23:00:00.000Z", category: "client", action: "client.message", target: { kind: "bot", id: "b1" },
    after, actor: { kind: "person", principalId: OWNER, via: "perspicax-mcp" }, ...extra,
  });

  it("hides each thread the client opened with newThread, once; never the person's own chat it wrote into", () => {
    const stored = new Map<string, { hidden?: true }>([["t-new", {}], ["t-chat", {}], ["t-done", { hidden: true }]]);
    const plan = planHiddenAgentThreads([
      row({ threadId: "t-new", waited: true, newThread: true }),
      row({ threadId: "t-new", waited: true, newThread: true }),
      row({ threadId: "t-chat", waited: true }),
      row({ threadId: "t-done", newThread: true }),
      row({ threadId: "t-gone", newThread: true }),
      row({ threadId: "t-console", newThread: true }, { actor: { kind: "person", principalId: OWNER, via: "console" } }),
      row({ runId: "r1" }, { action: "client.routine_run", target: { kind: "routine", id: "r1" } }),
    ], (_botId, threadId) => stored.get(threadId));
    expect(plan).toEqual([{ botId: "b1", threadId: "t-new" }]);
  });
});

describe("the second sweep (agent-threads-hidden.v2)", () => {
  it("hides bot-to-bot threads and the listed AI-client threads, nothing else", () => {
    const plan = planHiddenBotThreads(
      [
        { id: "agreements", threadId: "own", tasks: [
          { threadId: "own" },
          { threadId: "work", openedBy: { botId: "quasar" } },
          { threadId: "self", openedBy: { botId: "agreements" } },
          { threadId: "done", hidden: true, openedBy: { botId: "quasar" } },
          { threadId: "grok" },
          { threadId: "person" },
        ] },
      ],
      parseHideList("# fan-out 2026-10-11\nagreements grok\n\n"),
    );
    expect(plan).toEqual([{ botId: "agreements", threadId: "work" }, { botId: "agreements", threadId: "grok" }]);
  });

  it("keeps the bot's current thread even when another bot opened it", () => {
    expect(planHiddenBotThreads([{ id: "a", threadId: "t", tasks: [{ threadId: "t", openedBy: { botId: "b" } }] }])).toEqual([]);
  });
});
