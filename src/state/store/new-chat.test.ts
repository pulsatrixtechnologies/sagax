// New chat sticks (the owner 2026-11-02): an asked-for New chat stays the bot's
// current, empty conversation through a switch away and back, a return after
// a while, a live frame or a hydration, until the person sends, Back, or opens
// the covered topic by name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openBotConversationActions } from "@/components/thread-home";
import { resetFreshTopicMemory, setOnScreenBot, startedByNewChat } from "@/lib/fresh-topic";
import { initialState, landOnBot, openBot, openBotThread, startNewTopic, type Action, type AppState, type Bot } from "./model";
import { reducer } from "./reducer";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;

function bot(id: string, overrides: Partial<Bot> = {}): Bot {
  return {
    id, threadId: `${id}-now`, mainThreadId: `${id}-now`, name: id, title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, hasMore: false,
    messages: [{ id: `${id}-m1`, role: "bot", kind: "text", text: "old answer", at: NOW - 10 * HOUR } as Bot["messages"][number]],
    modelSelection: { instanceId: "x", model: "m" },
    tasks: [
      { threadId: `${id}-first`, title: "First", createdAt: NOW - 30 * HOUR, updatedAt: NOW - 29 * HOUR },
      // quiet for 10 h: a return lands on an automatic fresh topic
      { threadId: `${id}-now`, title: "Now", createdAt: NOW - 20 * HOUR, updatedAt: NOW - 10 * HOUR },
    ],
    ...overrides,
  } as Bot;
}

let state: AppState;
const dispatch = (action: Action) => {
  state = reducer(state, action);
};
const a = () => state.bots.find((candidate) => candidate.id === "a")!;
const b = () => state.bots.find((candidate) => candidate.id === "b")!;

beforeEach(() => {
  resetFreshTopicMemory();
  state = { ...initialState, hydrated: true, bots: [bot("a"), bot("b")], selectedId: "a", activeView: "chat" } as AppState;
});
afterEach(() => resetFreshTopicMemory());

describe("New chat sticks", () => {
  it("survives switching to another bot and back, by every way back", () => {
    startNewTopic(dispatch, a());
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });

    openBot(dispatch, b(), false);
    openBot(dispatch, a(), false);
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });

    // the sidebar row, the pinned grid, the catalog
    for (const action of openBotConversationActions(b(), false)) dispatch(action as Action);
    for (const action of openBotConversationActions(a(), false)) dispatch(action as Action);
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });

    // a bot-to-bot line opening the other bot, then back
    openBot(dispatch, b(), false, { landing: false });
    openBot(dispatch, a(), false, { landing: false });
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
    expect(state.selectedId).toBe("a");
  });

  it("is never turned into an invisible automatic topic by a return after a while", () => {
    startNewTopic(dispatch, a());
    setOnScreenBot(null);
    landOnBot(dispatch, a(), "a-now", { now: NOW });
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
    landOnBot(dispatch, a(), "a-now", { now: NOW, force: true });
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
    // the window coming back to the bot on screen
    dispatch({ type: "freshTopic", botId: "a", threadId: "a-now", auto: true });
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
  });

  it("survives a typing-time live frame, a hydration and a clear that keeps asked drafts", () => {
    startNewTopic(dispatch, a());
    // typing wakes the engine; the bot's announcement comes back busy-free
    dispatch({ type: "botPatched", bot: { ...a(), tasks: a().tasks!.map((task) => ({ ...task })) } } as Action);
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
    dispatch({ type: "hydrate", bots: [bot("a"), bot("b")], groups: [] } as unknown as Action);
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
    dispatch({ type: "freshTopic", botId: "a", threadId: null, keepAsked: true });
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
  });

  it("an automatic fresh topic still gives way when the bot is opened", () => {
    dispatch({ type: "freshTopic", botId: "a", threadId: "a-now", auto: true });
    dispatch({ type: "freshTopic", botId: "a", threadId: null, keepAsked: true });
    expect(state.freshTopic.a).toBeUndefined();
  });

  it("gives way to Back and to a link into the covered topic", () => {
    startNewTopic(dispatch, a());
    dispatch({ type: "freshTopic", botId: "a", threadId: null });
    expect(state.freshTopic.a).toBeUndefined();

    startNewTopic(dispatch, a());
    openBotThread(dispatch, a(), "a-now", false);
    expect(state.freshTopic.a).toBeUndefined();

    startNewTopic(dispatch, a());
    dispatch({ type: "focusMessage", threadId: "a-now", messageId: "a-m1" });
    expect(state.freshTopic.a).toBeUndefined();
  });

  it("repeated clicks reuse the one draft, and an empty newest topic is reused as it is", () => {
    startNewTopic(dispatch, a());
    const once = state.freshTopic;
    startNewTopic(dispatch, a());
    startNewTopic(dispatch, a());
    expect(state.freshTopic).toEqual(once);
    expect(Object.keys(state.freshTopic)).toEqual(["a"]);

    // a newest topic nobody wrote in: no draft over it, it opens on its own
    const empty = bot("c", { threadId: "c-empty", mainThreadId: "c-empty", messages: [], tasks: [
      { threadId: "c-first", title: "First", createdAt: 1, updatedAt: 2 },
      { threadId: "c-empty", title: "", createdAt: 3 },
    ] });
    state = { ...state, bots: [...state.bots, empty] };
    startNewTopic(dispatch, empty);
    expect(state.freshTopic.c).toBeUndefined();
    expect(startedByNewChat("c-empty")).toBe(true);
  });
});
