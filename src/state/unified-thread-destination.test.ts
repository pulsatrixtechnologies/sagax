// One conversation per bot (Settings > Conversation threads > One
// conversation): no other thread is ever a destination nor a sidebar line.
// 2026-11-05 (#2081, owner: "there is a unified chat mode and you keep
// putting threads everywhere"): a parallel task's detail or a bot's job
// opens nothing beside the conversation either; what they hold for the
// person reaches the conversation on its own, so the conversation is shown
// and stays where it was. The conversation on screen reads the topics it
// holds, and a bot-opened job with no sidebar row (#1770) so the bot's
// unread dot cannot stick after the person has read.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, Bot } from "./store";

const prefs = vi.hoisted(() => ({ singleStream: true }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/thread-preferences")>();
  return { ...original, singleStreamTurnField: () => ({ singleStream: prefs.singleStream }) };
});

const { openThread, opensBesideStream, threadsReadOnScreen } = await import("./store");
const { closeSideThread, currentSideThread } = await import("@/lib/side-thread");
const { botShowsUnread } = await import("@/lib/bot-unread");
const { streamUnreadReadWith } = await import("@/lib/single-stream");

afterEach(() => { closeSideThread(); prefs.singleStream = true; });

const helper = (): Bot => ({
  id: "helper", threadId: "now", name: "Helper", title: "", description: "", notifications: true, unread: true,
  color: "green", modelSelection: { instanceId: "fake", model: "m" }, messages: [],
  tasks: [
    { threadId: "earlier", title: "hello", createdAt: 1, unread: true },
    { threadId: "now", title: "Now", createdAt: 2 },
    { threadId: "sub-a", title: "Sub-task A", createdAt: 3, unread: true, parallelOf: { threadId: "now", messageId: "m", at: 3 } },
    { threadId: "sub-b", title: "Sub-task B", createdAt: 4, parallelOf: { threadId: "now", messageId: "m", at: 4 } },
    { threadId: "job", title: "Job", createdAt: 5, unread: true, openedBy: { botId: "helper", name: "Helper", at: 5 } },
  ],
} as Bot);

describe("a sub-task's detail with threads hidden", () => {
  it("shows the conversation, opens no side column and never switches the conversation on screen (#2081)", () => {
    const bot = helper();
    const actions: Action[] = [];
    const opened = openThread((action) => actions.push(action), { botId: bot.id, threadId: "sub-b" }, { bots: [bot], groups: [] } as never, false);
    expect(opened).toBe(true);
    expect(actions.some((action) => action.type === "switchTask")).toBe(false);
    expect(actions).toContainEqual({ type: "select", id: "helper" });
    expect(currentSideThread()).toBeNull();
    // a bot-opened job: the same, the conversation and nothing beside it
    openThread((action) => actions.push(action), { botId: bot.id, threadId: "job" }, { bots: [bot], groups: [] } as never, false);
    expect(actions.some((action) => action.type === "switchTask")).toBe(false);
    expect(currentSideThread()).toBeNull();
  });

  it("switches to it with threads shown, as a thread is a destination there", () => {
    const bot = helper();
    const actions: Action[] = [];
    openThread((action) => actions.push(action), { botId: bot.id, threadId: "sub-b" }, { bots: [bot], groups: [] } as never, true);
    expect(actions).toContainEqual({ type: "switchTask", botId: "helper", threadId: "sub-b" });
    expect(currentSideThread()).toBeNull();
  });

  it("opens beside only what is outside the stream, never the thread on screen", () => {
    const bot = helper();
    expect(opensBesideStream(bot, "sub-a")).toBe(true);
    expect(opensBesideStream(bot, "job")).toBe(true);
    expect(opensBesideStream(bot, "earlier")).toBe(false);
    expect(opensBesideStream(bot, "now")).toBe(false);
  });
});

describe("unread with threads hidden", () => {
  it("shows the bot's row as unread, with no count", () => {
    const bot = helper();
    expect(botShowsUnread(bot)).toBe(true);
  });

  it("reads the topics, sub-tasks and bot-opened jobs the conversation on screen holds (#1770)", () => {
    const bot = helper();
    expect(streamUnreadReadWith(bot.tasks, "now")).toEqual(["earlier", "sub-a", "job"]);
    expect(threadsReadOnScreen(bot, "now")).toEqual(["now", "earlier", "sub-a", "job"]);
    // a bot-opened thread shown alone reads itself only (not the stream)
    expect(streamUnreadReadWith(bot.tasks, "job")).toEqual([]);
    prefs.singleStream = false;
    expect(threadsReadOnScreen(bot, "now")).toEqual(["now"]);
  });

  it("clears the bot's unread once those threads are read with the conversation", () => {
    const bot = helper();
    const read = new Set(threadsReadOnScreen(bot, "now"));
    const after = {
      ...bot,
      tasks: bot.tasks!.map((task) => read.has(task.threadId) ? { ...task, unread: false } : task),
    };
    expect(botShowsUnread(after)).toBe(false);
  });
});
