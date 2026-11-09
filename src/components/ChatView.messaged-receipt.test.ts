// Regression (#3157): in the unified chat (threads off), the receipt a bot
// leaves when it messages one of its coding sessions or work threads
// vanished: ThreadChip drew nothing and MessagesList dropped every thread
// receipt. It shows again as "Messaged" + cube + the session title, with
// Tool calls off and on, and never as an "Open thread" or "Open the chat" link.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), showToolCalls: false }));

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/thread-preferences")>()),
  useShowThreads: () => false,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: {
      ...original.initialState,
      config: { features: { showToolCalls: fixture.showToolCalls } },
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      bots: [{ id: "bot", threadId: "t1", name: "Pepper", color: "green", tasks: [
        { threadId: "t1", title: "Main", createdAt: 1 },
        { threadId: "code-1", title: SESSION, createdAt: 2 },
        { threadId: "code-2", title: "Fix the sidebar", createdAt: 3 },
      ] }],
    },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));

const SESSION = "Recording tags, favorites API and stream merging";
const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const at = new Date(2026, 10, 9, 10, 0).getTime();
const receipt = (id: string, threadId: string, title: string): Message => ({
  id, role: "bot", kind: "activity", at,
  tool: { name: `Opened thread #${title}`, ok: true },
  threadRef: { botId: "bot", threadId, title },
});
const bot = (messages: Message[]): Bot => ({
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages,
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "t1", title: "Main", createdAt: 1 }, { threadId: "code-1", title: SESSION, createdAt: 2 }, { threadId: "code-2", title: "Fix the sidebar", createdAt: 3 }],
});
const render = (messages: Message[]) => renderToStaticMarkup(createElement(ChatView, { bot: bot(messages) }));
const rows = (markup: string) => markup.match(/data-testid="thread-receipt"/g)?.length ?? 0;

beforeEach(() => { fixture.showToolCalls = false; });

describe.each([false, true])("Messaged receipt, threads off, tool calls %s", (toolCalls) => {
  beforeEach(() => { fixture.showToolCalls = toolCalls; });

  it("shows Messaged + cube + the coding session title, never a link", () => {
    const markup = render([
      { id: "u", role: "user", kind: "text", text: "add stream merging", at } as Message,
      receipt("r1", "code-1", SESSION),
      { id: "b", role: "bot", kind: "text", text: "Sent it to the coding session.", at } as Message,
    ]);
    expect(rows(markup)).toBe(1);
    expect(markup).toContain("Messaged");
    expect(markup).toContain(SESSION);
    expect(markup).toContain("lucide-box");
    expect(markup).not.toMatch(/Open the chat|Go to conversation|Open #/);
  });

  it("keeps two receipts in a row as two rows, not an invisible go-to group", () => {
    const markup = render([
      { id: "u", role: "user", kind: "text", text: "two jobs", at } as Message,
      receipt("r1", "code-1", SESSION),
      receipt("r2", "code-2", "Fix the sidebar"),
    ]);
    expect(rows(markup)).toBe(2);
    expect(markup).toContain(SESSION);
    expect(markup).toContain("Fix the sidebar");
  });
});
