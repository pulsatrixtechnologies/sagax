import { describe, expect, it } from "vitest";
import { interBotConversations, type ConversationBot } from "./inter-bot-conversations.ts";

const bots: ConversationBot[] = [
  { id: "a", name: "Alpha", tasks: [{ threadId: "a-main" }] },
  { id: "b", name: "Bravo", tasks: [
    { threadId: "b-main" },
    { threadId: "work", updatedAt: 5, openedBy: { botId: "a", name: "Alpha", kind: "work" } },
    { threadId: "run", routineRunId: "r", openedBy: { botId: "a" } },
    { threadId: "secret", confidential: true, openedBy: { botId: "a" } },
    { threadId: "own", openedBy: { botId: "b" } },
  ] },
  { id: "c", name: "Charlie", tasks: [{ threadId: "c-work", updatedAt: 9, openedBy: { botId: "b", kind: "pair" } }] },
];

describe("interBotConversations", () => {
  it("names the same thread on both ends, never a run, a confidential or a self-opened thread", () => {
    expect(interBotConversations("a", bots)).toEqual([{ threadId: "work", otherBotId: "b", otherName: "Bravo", direction: "out", kind: "work", updatedAt: 5 }]);
    expect(interBotConversations("b", bots).map((row) => [row.threadId, row.direction, row.otherName])).toEqual([["c-work", "out", "Charlie"], ["work", "in", "Alpha"]]);
    expect(interBotConversations("c", bots)).toEqual([{ threadId: "c-work", otherBotId: "b", otherName: "Bravo", direction: "in", kind: "pair", updatedAt: 9 }]);
  });
  it("drops what the viewer may not read", () => {
    expect(interBotConversations("a", bots, () => false)).toEqual([]);
    expect(interBotConversations("b", bots, (_owner, task) => task.threadId === "work").map((row) => row.threadId)).toEqual(["work"]);
  });
});
