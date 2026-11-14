// #4200: one approval level per bot. A bot set to Full access still asked
// for approval because one of its conversations held a level of its own
// ("This conversation runs at Approve for me"), which the bot's setting never
// reached. A conversation now runs at its bot's level, always: no writer can
// leave one off it, and the start drops every stored conversation level that
// differs from its bot's.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { approvalModeFor, threadApprovalFields } from "../shared/approval-mode.ts";
import { flushOwnedFilesSync } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store, type BotRecord } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const level = (store: Store, botId: string, threadId: string) => approvalModeFor(store.projectBotForTask(botId, threadId)!);

describe("one approval level per bot (#4200)", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("drops at start a conversation level that differs from its bot's", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchBot(bot.id, { approvalMode: "full", autoApprove: false });
    const delegatedUp = store.createTask(bot.id, "handed down")!;
    const asked = new Store(selection).bot(bot.id)!;
    expect(asked.approvalMode).toBe("full");
    // What older builds stored: the bot's own chat on Approve for me as the
    // person's "choice", an engine change's Ask, an unfinished grant's Ask,
    // and a Primary Bot's hand-off below the bot's level.
    flushOwnedFilesSync();
    const bots = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")) as BotRecord[];
    const saved = bots.find((row) => row.id === bot.id)!;
    const engine = { threadId: "thread-engine", title: "engine", createdAt: 1, resumeCursors: {}, approvalMode: "ask", autoApprove: false, approvalOwn: "engine" };
    const safety = { threadId: "thread-safety", title: "safety", createdAt: 2, resumeCursors: {}, approvalMode: "ask", autoApprove: false, approvalOwn: "safety" };
    saved.tasks = saved.tasks!.map((task) => task.threadId === bot.threadId
      ? { ...task, approvalMode: "auto", autoApprove: true, alwaysAllow: [], approvalOwn: "thread" as never }
      : task.threadId === delegatedUp.threadId ? { ...task, approvalMode: "auto", autoApprove: false, approvalOwn: "delegated" } : task);
    saved.tasks!.push(engine as never, safety as never);
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(bots));

    const restarted = new Store(selection);
    for (const task of restarted.tasks(bot.id)) {
      expect(task.approvalOwn).toBeUndefined();
      expect(task.approvalMode).toBeUndefined();
      expect(level(restarted, bot.id, task.threadId)).toBe("full");
    }
  });

  it("keeps a Primary Bot's hand-off only while it lifts the conversation above its bot", () => {
    const bot = { approvalMode: "ask" as const, autoApprove: false };
    expect(threadApprovalFields(bot, { approvalOwn: "delegated", approvalMode: "full" }).approvalMode).toBe("full");
    // the bot went to Full: the hand-off below it is not a limit
    expect(threadApprovalFields({ approvalMode: "full" as const, autoApprove: false }, { approvalOwn: "delegated", approvalMode: "auto" }).approvalMode).toBe("full");
    // an older exception never holds a conversation off its bot
    for (const own of ["thread", "engine", "safety"]) {
      expect(threadApprovalFields({ approvalMode: "full" as const, autoApprove: false }, { approvalOwn: own, approvalMode: "auto", autoApprove: true }).approvalMode).toBe("full");
    }
  });

  it("never stores a level a writer puts on one conversation (the auto-review default wrote Approve for me)", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchBot(bot.id, { approvalMode: "full", autoApprove: false });
    const topic = store.createTask(bot.id, "New topic")!;
    // what the auto-review default did to every new conversation of a Full bot
    store.patchTask(bot.id, topic.threadId, { approvalMode: "auto", autoApprove: true });
    // what a model switch to another engine did
    store.switchTaskModel(bot.id, bot.threadId, { instanceId: "codex", model: "default" }, false, { approvalMode: "ask", autoApprove: false });
    // a new conversation opened with a level of its own (a read-only peer thread)
    const peer = store.createTask(bot.id, "peer", false, undefined, undefined, "ask")!;
    for (const threadId of [topic.threadId, bot.threadId, peer.threadId]) {
      expect(store.taskByThread(bot.id, threadId)?.approvalOwn).toBeUndefined();
      expect(level(store, bot.id, threadId)).toBe("full");
    }
  });

  it("applies the bot's level to every conversation, one another principal opened included", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchBot(bot.id, { approvalMode: "auto", autoApprove: true });
    const theirs = store.createTask(bot.id, "opened by a text message", false, undefined, undefined, undefined, "pr_other")!;
    store.patchTask(bot.id, theirs.threadId, { approvalMode: "auto", autoApprove: true });
    store.patchBot(bot.id, { approvalMode: "full", autoApprove: false }, { actorPrincipalId: "pr_owner" });
    expect(level(store, bot.id, theirs.threadId)).toBe("full");
    expect(level(store, bot.id, bot.threadId)).toBe("full");
  });
});
