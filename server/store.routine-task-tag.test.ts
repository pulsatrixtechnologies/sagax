// A routine run's task is tagged in the frame that announces it (2026-11-03).
// Untagged for one frame it was the bot's newest plain thread, so the one
// conversation rule named it the main thread and the chat on screen followed
// it, then came back: a flicker on every run.
import { describe, expect, it } from "vitest";
import { conversationThread } from "../shared/single-stream.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";

describe("a routine run's task at creation", () => {
  it("is tagged before the store announces it", () => {
    const store = new Store((): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" }));
    const bot = store.createBot({});
    const main = bot.threadId;
    const seen: Array<{ tagged: boolean; conversation: string | undefined }> = [];
    store.onChange((change) => {
      if (change.type !== "bot" || change.botId !== bot.id) return;
      const tasks = store.tasks(bot.id);
      const run = tasks.find((task) => task.threadId !== main);
      if (run) seen.push({ tagged: run.routineRunId === "run-1", conversation: conversationThread(tasks)?.threadId });
    });
    const task = store.createTask(bot.id, "Brief", false, undefined, undefined, undefined, undefined, undefined, false, undefined, false, undefined, "run-1");
    expect(task?.routineRunId).toBe("run-1");
    expect(seen.length).toBeGreaterThan(0);
    // every frame that carries the run's task carries its tag, and the
    // person's conversation stays theirs
    expect(seen.every((frame) => frame.tagged && frame.conversation === main)).toBe(true);
    expect(store.bot(bot.id)?.threadId).toBe(main);
  });
});
