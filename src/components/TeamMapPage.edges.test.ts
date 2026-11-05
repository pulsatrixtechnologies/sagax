// A hand-off on the team map opens the thread doing the work, the room it
// ran in, or else the bot it went to, the way that bot's row opens it: with
// threads hidden, at its main thread (openBot).
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), showThreads: true, bots: [] as Bot[] }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: fixture.dispatch }) };
});
const { EdgeRow } = await import("./TeamMapPage");

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-chat`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  messages: [], modelSelection: { instanceId: "fake", model: "test" }, tasks: [{ threadId: `${id}-chat`, title: "Chat", createdAt: 1 }], ...extra,
});

/** Click the edge's row; what it dispatched. */
function click(edge: Parameters<typeof EdgeRow>[0]["edge"]) {
  let tree: ReactNode;
  function Capture() { tree = EdgeRow({ edge, bots: fixture.bots }); return tree; }
  renderToStaticMarkup(createElement(Capture));
  (tree as ReactElement<{ onClick: () => void }>).props.onClick();
  return fixture.dispatch.mock.calls.map(([action]) => action);
}

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.showThreads = true;
  // Ada was left on the thread Clive handed her (outside her single stream);
  // the person last wrote in her main one.
  fixture.bots = [bot("clive"), bot("ada", { threadId: "ada-old", mainThreadId: "ada-chat",
    tasks: [{ threadId: "ada-chat", title: "Chat", createdAt: 1 }, { threadId: "ada-old", title: "Report", createdAt: 2, unread: true, openedBy: { botId: "clive", name: "Clive", at: 2 } }] })];
});

describe("a team map hand-off", () => {
  it("opens the bot it went to as its row would", () => {
    const edge = { sourceBotId: "clive", targetBotId: "ada", state: "connected" as const };
    // then no fresh topic over what it opens (#763, src/lib/fresh-topic.ts)
    expect(click(edge)).toEqual([{ type: "select", id: "ada" }, { type: "freshTopic", botId: "ada", threadId: null, keepAsked: true }]);
    fixture.dispatch.mockClear();
    fixture.showThreads = false;
    expect(click(edge)).toEqual([{ type: "switchTask", botId: "ada", threadId: "ada-chat" }, { type: "freshTopic", botId: "ada", threadId: null }, { type: "freshTopic", botId: "ada", threadId: null, keepAsked: true }]);
  });

  it("opens the thread doing the work, or the room it ran in", () => {
    fixture.showThreads = false;
    expect(click({ sourceBotId: "clive", targetBotId: "ada", state: "running", threadId: "ada-old" })).toEqual([
      { type: "select", id: "ada" },
      { type: "switchTask", botId: "ada", threadId: "ada-old" },
      // a thread opened by name is shown, never a fresh topic over it (#763)
      { type: "freshTopic", botId: "ada", threadId: null },
      { type: "revealThread", threadId: "ada-old" },
    ]);
    fixture.dispatch.mockClear();
    expect(click({ sourceBotId: "clive", targetBotId: "ada", state: "connected", groupId: "room" })).toEqual([{ type: "select", id: "room" }]);
  });
});
