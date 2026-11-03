import { describe, expect, it } from "vitest";
import { interBotWaiting } from "./inter-bot-approvals.ts";

const work = (threadId: string, extra: Record<string, unknown> = {}) => ({
  threadId, activity: "waiting-on-you", updatedAt: 10, openedBy: { botId: "asker", name: "Asker", kind: "work" }, ...extra,
});

describe("interBotWaiting", () => {
  it("lists another bot's conversations waiting on the person, oldest first", () => {
    expect(interBotWaiting("bot", [
      work("late", { updatedAt: 30 }),
      work("hidden-ask", { updatedAt: 20, openedBy: { botId: "asker", name: " Asker " } }),
      work("early", { updatedAt: 5 }),
    ])).toEqual([
      { threadId: "early", openedByName: "Asker", kind: "work", updatedAt: 5 },
      { threadId: "hidden-ask", openedByName: "Asker", updatedAt: 20 },
      { threadId: "late", openedByName: "Asker", kind: "work", updatedAt: 30 },
    ]);
  });

  it("leaves out the person's own threads, the bot's own, routines and threads not waiting", () => {
    expect(interBotWaiting("bot", [
      { threadId: "mine", activity: "waiting-on-you" },
      work("own", { openedBy: { botId: "bot", name: "Self" } }),
      work("routine", { routineRunId: "r1" }),
      work("closed", { closedBy: { botId: "asker", at: 1 } }),
      work("working", { activity: "working" }),
      work("idle", { activity: undefined }),
    ])).toEqual([]);
    expect(interBotWaiting("bot", undefined)).toEqual([]);
  });

  it("keeps only the cards this viewer answers", () => {
    const tasks = [work("a"), work("b")];
    expect(interBotWaiting("bot", tasks, (task) => task.threadId === "b").map((row) => row.threadId)).toEqual(["b"]);
  });
});
