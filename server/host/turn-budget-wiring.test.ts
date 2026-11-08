import { describe, expect, it } from "vitest";

import type { ModelSelection, RuntimeEvent } from "../contracts.ts";
import { Store } from "../store.ts";
import { wireTurnBudget } from "./turn-budget-wiring.ts";

// #2764: the ceiling of #2737 as the server wires it, on a real store. The
// conversation an AI client opens through send_prompt is a task of the bot
// (agentConversationFor), hidden or not: the ceiling covers it like the chat.
const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const at = "2026-11-07T00:00:00.000Z";

function wired(store: Store, settings: { maxSteps?: number; maxMinutes?: number }) {
  let listener: ((event: RuntimeEvent) => void) | undefined;
  const busy = new Set<string>();
  const steers: { threadId: string; note: string }[] = [];
  const stops: { botId: string; threadId: string }[] = [];
  const budget = wireTurnBudget({
    config: () => ({ turnBudget: { maxSteps: settings.maxSteps ?? null, maxMinutes: settings.maxMinutes ?? null } }),
    env: {},
    botByThread: (threadId) => store.botByThread(threadId),
    threadBusy: (_botId, threadId) => busy.has(threadId),
    steerer: (instanceId) => instanceId === "claude" ? async (threadId, note) => { steers.push({ threadId, note }); return "steered"; } : undefined,
    stopDirectThread: async (botId, threadId) => { stops.push({ botId, threadId }); busy.delete(threadId); },
    appendMessage: (threadId, message) => store.appendMessage(threadId, message),
    language: () => "fr",
    subscribe: (next) => { listener = next; },
    ignore: (event) => (event as { ignored?: boolean }).ignored === true,
    log: () => {},
  });
  const emit = (threadId: string, event: object) => listener?.({ threadId, instanceId: "claude", driver: "d", createdAt: at, ...event } as unknown as RuntimeEvent);
  const tools = (threadId: string, turnId: string, from: number, count: number) => {
    for (let n = from; n < from + count; n += 1) emit(threadId, { type: "item.started", itemType: "tool", itemId: `tool-${n}`, title: "shell", turnId });
  };
  return { budget, busy, steers, stops, emit, tools };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("turn budget wiring (#2764)", () => {
  it("covers a hidden conversation an AI client opened (send_prompt): wrap-up note, stop, partial answer in that conversation", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Helper" }, { seedMessages: false });
    const task = store.createTask(bot.id, undefined, false, undefined, { botId: "agent:perspicax", name: "Perspicax", kind: "agent", at: Date.now() },
      undefined, undefined, undefined, true)!;
    expect(task.hidden).toBe(true);
    expect(store.botByThread(task.threadId)?.id).toBe(bot.id);

    const h = wired(store, { maxSteps: 8 });
    h.busy.add(task.threadId);
    h.emit(task.threadId, { type: "turn.started", turnId: "t1" });
    h.emit(task.threadId, { type: "item.completed", itemType: "assistant_text", text: "Trois sources lues, il reste l'agenda.", turnId: "t1" });
    h.tools(task.threadId, "t1", 0, 6);
    expect(h.steers.map((s) => s.threadId)).toEqual([task.threadId]);
    h.tools(task.threadId, "t1", 6, 2);
    await flush();
    expect(h.stops).toEqual([{ botId: bot.id, threadId: task.threadId }]);
    const last = store.messagesFor(task.threadId).at(-1);
    expect(last?.role).toBe("bot");
    expect(last?.text).toContain("Tour arrêté après");
    expect(last?.text).toContain("Trois sources lues");
    expect(last?.from?.botId).toBe(bot.id);
    // the person's own chat is untouched
    expect(store.messagesFor(bot.threadId).some((m) => m.text?.includes("Tour arrêté"))).toBe(false);
  });

  it("leaves an idle conversation and ignored provider events alone", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Helper" }, { seedMessages: false });
    const h = wired(store, { maxSteps: 5 });
    h.emit(bot.threadId, { type: "turn.started", turnId: "t1" });
    h.tools(bot.threadId, "t1", 0, 9);
    await flush();
    expect(h.stops).toEqual([]);
    h.busy.add(bot.threadId);
    h.emit(bot.threadId, { type: "turn.started", turnId: "t2" });
    for (let n = 0; n < 9; n += 1) h.emit(bot.threadId, { type: "item.started", itemType: "tool", itemId: `x-${n}`, turnId: "t2", ignored: true });
    await flush();
    expect(h.stops).toEqual([]);
  });

  it("carries the spent steps into the turn that continues the same request after a computer switch", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Helper" }, { seedMessages: false });
    const h = wired(store, { maxSteps: 10 });
    h.busy.add(bot.threadId);
    h.emit(bot.threadId, { type: "turn.started", turnId: "t1" });
    h.tools(bot.threadId, "t1", 0, 6);
    h.emit(bot.threadId, { type: "turn.completed", turnId: "t1" });
    h.budget.carryNext(bot.threadId);
    h.emit(bot.threadId, { type: "turn.started", turnId: "t2" });
    h.tools(bot.threadId, "t2", 0, 4);
    await flush();
    expect(h.stops).toHaveLength(1);
    expect(store.messagesFor(bot.threadId).at(-1)?.text).toContain("10 étapes");

    // a new request starts from zero
    h.busy.add(bot.threadId);
    h.emit(bot.threadId, { type: "turn.started", turnId: "t3" });
    h.tools(bot.threadId, "t3", 0, 9);
    await flush();
    expect(h.stops).toHaveLength(1);
  });
});
