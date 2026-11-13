import { describe, expect, it } from "vitest";

import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("conversation turn timing", () => {
  it("keeps the numbers on the conversation across a restart, not in a message", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Helper" }, { seedMessages: false });
    const threadId = bot.threadId;
    store.noteConversationTiming(threadId, { queueMs: 40 });
    store.noteConversationTiming(threadId, { queueMs: 40, firstResponseMs: 160 });
    const task = store.taskByThread(bot.id, threadId);
    expect(task?.turnTiming).toEqual({ queueMs: 40, firstResponseMs: 160 });
    expect(store.messagesFor(threadId).some((message) => JSON.stringify(message).includes("queueMs"))).toBe(false);
    const reloaded = new Store(selection);
    expect(reloaded.taskByThread(bot.id, threadId)?.turnTiming).toEqual({ queueMs: 40, firstResponseMs: 160 });
  });

  it("keeps the last turn's numbers only: a new turn's first note replaces the one before (#4215)", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Helper" }, { seedMessages: false });
    store.noteConversationTiming(bot.threadId, { queueMs: 40, firstResponseMs: 9_000, engineStartMs: 7_000, engineStart: "cold", firstWordMs: 9_040, totalMs: 9_500 });
    store.noteConversationTiming(bot.threadId, { queueMs: 12 });
    expect(store.taskByThread(bot.id, bot.threadId)?.turnTiming).toEqual({ queueMs: 12 });
  });
});
