import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { STOPPED_TURN_NAME } from "../../shared/client-cancel.ts";
import { DATA_DIR } from "../config.ts";
import { createStopDirectThreadByPerson } from "../index-leaves/stopDirectThreadByPerson.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import { Store } from "../store.ts";
import { createIdleThreads } from "./idle-threads.ts";

type Hold = "setup" | "dispatching" | "engine";

function fixture() {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const bot = store.createBot({ name: "Postie" });
  const thread = bot.threadId;
  const task = () => store.taskByThread(bot.id, thread)!;
  const claims = new Map<string, { phase: "setup" | "dispatching" }>();
  const engines = new Set<string>();
  const generations = new Map([[thread, "gen-1"]]);
  const holds = { set: (threadId: string, hold: Hold) => { if (hold === "engine") engines.add(threadId); else claims.set(threadId, { phase: hold }); } };
  const state = { newerTurnDuringInterrupt: false };
  const settled: string[] = [], released: string[] = [], noticed: string[] = [];
  let drains = 0;
  const idle = createIdleThreads({
    store, claims, generations,
    engineTurn: (threadId) => engines.has(threadId),
    settle: (_botId, threadId) => { settled.push(threadId); },
    releaseComputer: (_botId, threadId) => { released.push(threadId); },
    notice: (threadId) => {
      noticed.push(threadId);
      store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: STOPPED_TURN_NAME, ok: true } });
    },
    drain: () => { drains += 1; },
  });
  // As index.ts's stopDirectThread: the dispatch claim goes at once, while an engine's turn is only asked to end.
  const interrupt = async (_botId: string, threadId: string) => {
    claims.delete(threadId);
    if (state.newerTurnDuringInterrupt) generations.set(threadId, "gen-2");
  };
  const stop = createStopDirectThreadByPerson(() => ({
    store, idleThreads: idle,
    videoGenerations: { cancelThread: () => {} },
    threadBusy: (botId: string, threadId: string) => store.taskByThread(botId, threadId)?.busy === true || claims.has(threadId),
    finishUntilRuns: { rounds: () => 0, reset: () => {} },
    stopDirectThread: interrupt,
    stopOwnSubagents: async () => {},
  })) as (botId: string, threadId: string) => Promise<void>;
  const stoppedLines = () => store.messagesFor(thread).filter((row) => row.kind === "activity" && row.tool?.name === STOPPED_TURN_NAME);
  return { store, bot, thread, task, holds, state, settled, released, noticed, stoppedLines, drains: () => drains, idle, stop };
}

describe("a conversation shown working with nothing running for it (server/host/idle-threads.ts, #3300)", () => {
  afterEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("is freed by the person's Stop, though no turn ever started there, and says so in the chat", async () => {
    const { store, bot, thread, task, settled, released, stoppedLines, drains, stop } = fixture();
    store.setTaskActivity(bot.id, thread, "working");
    await stop(bot.id, thread);
    expect(task()).toMatchObject({ activity: "idle", busy: false });
    expect(store.bot(bot.id)).toMatchObject({ activity: "idle", busy: false });
    expect(settled).toEqual([thread]);
    expect(released).toEqual([thread]);
    expect(drains()).toBe(1);
    expect(stoppedLines()).toHaveLength(1);
  });

  it("is freed at once by a Stop during a setup that never returns, which lets go of its computer", async () => {
    const { store, bot, thread, task, holds, settled, released, drains, stop } = fixture();
    holds.set(thread, "setup");
    store.setTaskActivity(bot.id, thread, "working");
    await stop(bot.id, thread);
    expect(task()).toMatchObject({ activity: "idle", busy: false });
    expect(settled).toEqual([thread]);
    expect(released).toEqual([thread]);
    expect(drains()).toBe(1);
  });

  it.each(["dispatching", "engine"] as const)("a Stop leaves a turn an engine has (%s) to that turn's own end", async (hold) => {
    const { store, bot, thread, task, holds, settled, released, noticed, drains, stop } = fixture();
    holds.set(thread, hold);
    store.setTaskActivity(bot.id, thread, "working");
    await stop(bot.id, thread);
    expect(task()).toMatchObject({ activity: "working", busy: true });
    expect(settled).toEqual([]);
    expect(released).toEqual([]);
    expect(noticed).toEqual([]);
    expect(drains()).toBe(0);
  });

  it("a Stop never frees a newer turn that began while it interrupted, nor touches that turn's computer", async () => {
    const { store, bot, thread, task, holds, state, settled, released, stop } = fixture();
    holds.set(thread, "setup");
    state.newerTurnDuringInterrupt = true;
    store.setTaskActivity(bot.id, thread, "working");
    await stop(bot.id, thread);
    expect(task()).toMatchObject({ activity: "working", busy: true });
    expect(settled).toEqual([]);
    expect(released).toEqual([]);
  });

  it("a Stop on a conversation that is not working changes nothing and writes nothing", async () => {
    const { bot, thread, task, settled, noticed, stop } = fixture();
    await stop(bot.id, thread);
    expect(task()).toMatchObject({ busy: false });
    expect(settled).toEqual([]);
    expect(noticed).toEqual([]);
  });

  it("lists for the watchdog only what nothing holds, and frees only that", () => {
    const { store, bot, thread, task, holds, settled, released, noticed, idle } = fixture();
    const other = store.createTask(bot.id, "Other", false)!.threadId;
    const resting = store.createTask(bot.id, "Resting", false)!.threadId;
    store.setTaskActivity(bot.id, thread, "working");
    store.setTaskActivity(bot.id, other, "working");
    store.setTaskActivity(bot.id, resting, "waiting-on-you", { settledQuestion: true });
    holds.set(other, "setup");
    expect(idle.unheld()).toEqual([{ threadId: thread, botId: bot.id }]);
    idle.free(bot.id, other);
    idle.free(bot.id, resting);
    expect(store.taskByThread(bot.id, other)).toMatchObject({ activity: "working", busy: true });
    expect(store.taskByThread(bot.id, resting)).toMatchObject({ activity: "waiting-on-you", busy: false });
    idle.free(bot.id, thread);
    expect(task()).toMatchObject({ activity: "idle", busy: false });
    expect(settled).toEqual([thread]);
    expect(released).toEqual([thread]);
    expect(noticed).toEqual([thread]);
  });
});
