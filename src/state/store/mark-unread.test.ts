import { describe, expect, it } from "vitest";
import { botShowsUnread } from "@/lib/bot-unread";
import { initialState, reducer, type AppState, type Bot } from "../store";

// Mark as Unread in the sidebar's bot menu (#4639): the dot reads the bot's
// threads once it has any, so the flag must land on the conversation it is on.
const bot = {
  id: "dumpling", threadId: "t1", name: "Dumpling", unread: false, messages: [],
  tasks: [{ threadId: "t1", title: "General", createdAt: 1, updatedAt: 1 }, { threadId: "t2", title: "Other", createdAt: 1, updatedAt: 1 }],
} as unknown as Bot;

describe("markUnread", () => {
  it("shows the unread dot until the bot is opened, on a bot that has threads", () => {
    const state = { ...initialState, bots: [bot], selectedId: "other" } as AppState;
    expect(botShowsUnread(state.bots[0]!)).toBe(false);
    const next = reducer(state, { type: "markUnread", botId: "dumpling" });
    const marked = next.bots[0]!;
    expect(botShowsUnread(marked)).toBe(true);
    expect(marked.tasks?.map((task) => Boolean(task.unread))).toEqual([true, false]);
  });

  it("still flags a bot with no thread list", () => {
    const plain = { ...bot, tasks: undefined } as unknown as Bot;
    const next = reducer({ ...initialState, bots: [plain] } as AppState, { type: "markUnread", botId: "dumpling" });
    expect(botShowsUnread(next.bots[0]!)).toBe(true);
  });
});
