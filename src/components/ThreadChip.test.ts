import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), showThreads: true }));
const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [
    { threadId: "scout-main", title: "Main", createdAt: 1 },
    { threadId: "qa-245", title: "QA PR 245", createdAt: 2, openedBy: { botId: "ada", name: "Ada", at: 2 } },
  ],
};
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: [scout] }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
import { ThreadChip } from "./ThreadChip";

const receipt = (threadId = "qa-245"): Message => ({
  id: "receipt", role: "bot", kind: "activity", at: 3,
  tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
  threadRef: { botId: "scout", threadId, title: "QA PR 245" },
});

type ElementProps = { children?: ReactNode; onClick?: () => void; [key: string]: unknown };
function findElement(tree: ReactNode, attribute: string): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (attribute in child.props) return child;
    const attributes = child.props.attributes as Record<string, string> | undefined;
    if (attributes && attribute in attributes) return child;
    const found = findElement(child.props.children, attribute);
    if (found) return found;
  }
}

beforeEach(() => { fixture.dispatch.mockClear(); fixture.showThreads = true; });

describe("ThreadChip", () => {
  it("renders the receipt as the centered quiet line, not a pill, naming the bot", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }));
    expect(markup).toContain("<button");
    expect(markup).toContain("justify-center");
    expect(markup).not.toContain("justify-start");
    expect(markup).not.toContain("border-hairline");
    expect(markup).not.toContain("lucide-chevron-right");
    expect(markup).toContain("Open the chat");
    expect(markup).toContain("Scout");
    expect(markup).not.toContain("Opened thread #QA PR 245 on Scout");
    expect(markup).toContain('title="Open #QA PR 245"');
    expect(markup).toContain('data-thread-chip="qa-245"');
  });

  it("renders nothing without a thread reference", () => {
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: { ...receipt(), threadRef: undefined } }))).toBe("");
  });

  it("clicking shows that thread: select the bot, switch the view, reveal the row", () => {
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "switchTask", botId: "scout", threadId: "qa-245" },
      // a thread opened by name is shown, never a fresh topic over it (#763)
      { type: "freshTopic", botId: "scout", threadId: null },
      { type: "revealThread", threadId: "qa-245" },
    ]);
  });

  it("threads off: draws the receipt as a plain \"Messaged\" step with the cube and session title, never a link (#3157)", () => {
    // Owner 2026-10-22: threads off leaves no thread link in the chat. Owner
    // 2026-11-09: nothing invisible, so the bot messaging a coding session
    // still shows as "Messaged <session>", like before the regression.
    fixture.showThreads = false;
    const session = receipt();
    session.tool = { name: "Opened thread #Recording tags, favorites API and stream merging", ok: true };
    session.threadRef = { botId: "scout", threadId: "qa-245", title: "Recording tags, favorites API and stream merging" };
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: session }));
    expect(markup).toContain('data-testid="thread-receipt"');
    expect(markup).toContain("Messaged");
    expect(markup).toContain("Recording tags, favorites API and stream merging");
    expect(markup).toContain("lucide-box");
    expect(markup).not.toContain("Open the chat");
    expect(markup).not.toContain("Open #");
    expect(markup).not.toContain("data-thread-chip");
  });

  it("draws nothing when the thread was deleted", () => {
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: receipt("gone") }))).toBe("");
  });

  it("draws nothing for a bot the viewer cannot see once the server marked the thread gone", () => {
    const unseen = receipt("elsewhere");
    unseen.threadRef = { botId: "other-org-bot", threadId: "elsewhere", title: "Away", gone: true };
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: unseen }))).toBe("");
    unseen.threadRef = { botId: "other-org-bot", threadId: "elsewhere", title: "Away" };
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: unseen }))).toContain("Open the chat");
  });
});
