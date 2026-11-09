// A bot-to-bot hand-off in the unified chat (threads off, 2026-11-09): the
// sender's chat and the teammate's chat each draw a visible row, and a
// failure shows on it. Neutral names only (term-guard).
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ showThreads: false, bots: [] as Bot[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: vi.fn() }) };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
import { ThreadChip } from "./ThreadChip";
import { ChatRowsContext, type ChatRows } from "./ChatView.tsx-parts/types";

const bot = (id: string, name: string, messages: Message[] = []): Bot => ({
  id, threadId: `${id}-main`, name, title: "", description: "", notifications: true, color: "green",
  unread: false, messages, modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: `${id}-main`, title: "Main", createdAt: 1 }],
});

const work = { botId: "olive", threadId: "olive-work", title: "@Wren · work" };
const sent: Message = {
  id: "sent", at: 1, role: "bot", kind: "activity", threadRef: work,
  from: { botId: "wren", name: "Wren", color: "blue" },
  tool: { name: "Sent to Olive", ok: true, input: "Check the build on staging and report PASS or FAIL.", handoffId: "req-1" },
};
const replied = (ok = true): Message => ({
  id: "replied", at: 2, role: "bot", kind: "activity", threadRef: work,
  roomRequest: { id: "req-1", phase: "result" },
  from: { botId: "olive", name: "Olive", color: "green" },
  tool: ok ? { name: "Olive replied", ok, output: "FAIL: the login page returns 500." } : { name: "Olive — failed: engine stopped", ok },
});
const incoming: Message = {
  id: "asked", at: 1, role: "bot", kind: "activity", threadRef: work,
  from: { botId: "wren", name: "Wren", color: "blue" },
  tool: { name: "Asked by Wren", ok: true, input: "Check the build on staging and report PASS or FAIL.", handoffId: "req-1" },
};

function render(message: Message, botId: string): string {
  const rows = { bots: fixture.bots, botId, threadId: `${botId}-main` } as unknown as ChatRows;
  return renderToStaticMarkup(createElement(ChatRowsContext.Provider, { value: rows }, createElement(ThreadChip, { message }) as ReactNode));
}

beforeEach(() => { fixture.showThreads = false; });

describe("hand-off row (threads off)", () => {
  it("the sender's chat shows Asked <teammate> with the brief while the teammate works", () => {
    fixture.bots = [bot("wren", "Wren", [sent]), bot("olive", "Olive")];
    const markup = render(sent, "wren");
    expect(markup).toContain('data-testid="handoff-row"');
    expect(markup).toContain('data-handoff-phase="running"');
    expect(markup).toContain("Olive");
    expect(markup).toContain("Check the build on staging");
    expect(markup).not.toContain("Open the chat");
  });

  it("the teammate's verdict joins the same row, live, and its result row draws nothing more", () => {
    fixture.bots = [bot("wren", "Wren", [sent, replied()]), bot("olive", "Olive")];
    const markup = render(sent, "wren");
    expect(markup).toContain('data-handoff-phase="done"');
    expect(markup).toContain('data-verdict="FAIL"');
    expect(render(replied(), "wren")).toBe("");
  });

  it("a failure is visible on the row", () => {
    fixture.bots = [bot("wren", "Wren", [sent, replied(false)]), bot("olive", "Olive")];
    expect(render(sent, "wren")).toContain('data-handoff-phase="failed"');
    const refused = { ...sent, tool: { ...sent.tool!, ok: false, output: "message of 1-16000 characters" } };
    fixture.bots = [bot("wren", "Wren", [refused]), bot("olive", "Olive")];
    const markup = render(refused, "wren");
    expect(markup).toContain('data-handoff-phase="failed"');
    expect(markup).toContain("text-danger");
  });

  it("the teammate's chat shows who asked, with their name", () => {
    fixture.bots = [bot("wren", "Wren"), bot("olive", "Olive", [incoming])];
    const markup = render(incoming, "olive");
    expect(markup).toContain('data-handoff-side="incoming"');
    expect(markup).toContain("Asked by Wren");
    expect(markup).toContain("Check the build on staging");
  });

  it("a result whose receipt is not on this page still shows on its own", () => {
    fixture.bots = [bot("wren", "Wren", [replied()]), bot("olive", "Olive")];
    const markup = render(replied(), "wren");
    expect(markup).toContain('data-handoff-side="result"');
    expect(markup).toContain("Olive replied");
  });
});
