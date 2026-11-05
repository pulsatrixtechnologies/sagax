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
  it("names an outside agent's conversation (a person's AI client over MCP) on the bot only, kind agent", () => {
    const withAgent: ConversationBot[] = [
      ...bots,
      { id: "d", name: "Delta", tasks: [{ threadId: "d-agent", updatedAt: 3, createdAt: 2, openedBy: { botId: "agent:voice-assistant-phone", name: "Voice assistant (phone)", kind: "agent" } }] },
    ];
    expect(interBotConversations("d", withAgent)).toEqual([{ threadId: "d-agent", otherBotId: "agent:voice-assistant-phone", otherName: "Voice assistant (phone)", direction: "in", kind: "agent", updatedAt: 3, startedAt: 2 }]);
    // no bot sees it as one it opened
    expect(interBotConversations("a", withAgent).some((row) => row.threadId === "d-agent")).toBe(false);
  });
  it("drops what the viewer may not read", () => {
    expect(interBotConversations("a", bots, () => false)).toEqual([]);
    expect(interBotConversations("b", bots, (_owner, task) => task.threadId === "work").map((row) => row.threadId)).toEqual(["work"]);
  });
  it("skips a thread nothing was written to, unless its turn is running (#1502)", () => {
    const empty = new Set(["work"]);
    const hasMessages = (_owner: string, threadId: string) => !empty.has(threadId);
    expect(interBotConversations("a", bots, undefined, undefined, hasMessages)).toEqual([]);
    expect(interBotConversations("b", bots, undefined, undefined, hasMessages).map((row) => row.threadId)).toEqual(["c-work"]);
    const running = interBotConversations("a", bots, undefined, (_owner, threadId) => threadId === "work", hasMessages);
    expect(running.map((row) => [row.threadId, row.running])).toEqual([["work", true]]);
  });
  it("keeps ten rows that hold messages when older empty ones sit among them", () => {
    const many: ConversationBot[] = [
      { id: "x", name: "Xray", tasks: [] },
      { id: "y", name: "Yankee", tasks: Array.from({ length: 14 }, (_, index) => ({ threadId: `t${index}`, updatedAt: index, openedBy: { botId: "x" } })) },
    ];
    const rows = interBotConversations("x", many, undefined, undefined, (_owner, threadId) => Number(threadId.slice(1)) % 2 === 0);
    expect(rows.map((row) => row.threadId)).toEqual(["t12", "t10", "t8", "t6", "t4", "t2", "t0"]);
    expect(interBotConversations("x", many)).toHaveLength(10);
  });
});
