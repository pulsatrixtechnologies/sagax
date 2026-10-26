// A bot-to-bot conversation named on both ends is a quiet line at its place
// in time, never a stack of cards above the chat (regression of #793).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

const T = new Date(2026, 9, 19, 9, 0).getTime();
const MIN = 60_000;
const fixture = vi.hoisted(() => ({ bots: [] as unknown[] }));

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const state = () => ({
    ...original.initialState,
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
    bots: fixture.bots,
  });
  return {
    ...original,
    useStore: () => ({ state: state(), dispatch: vi.fn() }),
    useStoreSelector: (select: (value: unknown) => unknown) => select(state()),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  // These cases exercise threads-on chip grouping (ThreadChip now hides
  // receipts when threads are off; see ThreadChip.test.ts).
  useShowThreads: () => true,
}));

const { ChatView } = await import("./ChatView");
const { conversationAnchors } = await import("./BotConversations");
afterAll(() => vi.unstubAllGlobals());

const message = (id: string, text: string, at: number, role: "user" | "bot" = "user"): Message => ({ id, role, kind: "text", text, at }) as Message;
const katarina = (messages: Message[], botConversations: Bot["botConversations"]): Bot => ({
  id: "kat", threadId: "kat-main", mainThreadId: "kat-main", name: "Katarina", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, botConversations,
  modelSelection: { instanceId: "test", model: "m" },
});
const melonie = { id: "mel", threadId: "mel-main", name: "Melonie", color: "blue" };

describe("bot-to-bot conversations in the chat", () => {
  const rows: NonNullable<Bot["botConversations"]> = [
    { threadId: "w2", otherBotId: "mel", otherName: "Melonie", direction: "in", startedAt: T + 25 * MIN, updatedAt: T + 26 * MIN },
    { threadId: "w1", otherBotId: "mel", otherName: "Melonie", direction: "out", startedAt: T + 5 * MIN, updatedAt: T + 90 * MIN },
  ];
  const messages = [message("a", "first question", T), message("b", "second question", T + 10 * MIN), message("c", "third question", T + 40 * MIN)];

  it("draws no card above the chat, only quiet lines placed by time", () => {
    const self = katarina(messages, rows);
    fixture.bots = [self, melonie];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: self }));
    expect(markup).not.toContain("data-bot-conversations");
    expect(markup).not.toContain("Conversation with Melonie");
    const order = ["first question", 'data-thread-chip="w1"', "second question", 'data-thread-chip="w2"', "third question"].map((needle) => markup.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(markup.match(/data-testid="bot-exchange-chip"/g)).toHaveLength(2);
    expect(markup).toContain("Go to conversation");
  });

  it("skips a conversation the transcript already links to, and shows nothing outside the main chat", () => {
    const linked = [...messages, { id: "r", role: "bot", kind: "activity", at: T + 6 * MIN, tool: { name: "Opened thread #x", ok: true }, threadRef: { botId: "mel", threadId: "w1", title: "x" } } as Message];
    const self = katarina(linked, rows);
    fixture.bots = [self, melonie];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: self }));
    expect(markup.match(/data-thread-chip="w1"/g)).toHaveLength(1);
    const side = { ...self, threadId: "kat-task" };
    fixture.bots = [side, melonie];
    expect(renderToStaticMarkup(createElement(ChatView, { bot: side }))).not.toContain('data-bot-conversation="');
  });

  it("anchors by start time and leaves out lines older than a partial window", () => {
    const { before, after } = conversationAnchors(rows, [T, T + 10 * MIN, T + 40 * MIN], false);
    expect(before.get(1)?.map((row) => row.threadId)).toEqual(["w1"]);
    expect(before.get(2)?.map((row) => row.threadId)).toEqual(["w2"]);
    expect(after).toEqual([]);
    expect(conversationAnchors(rows, [T + 50 * MIN], true).before.size).toBe(0);
    expect(conversationAnchors(rows, [T - MIN], false).after.map((row) => row.threadId)).toEqual(["w1", "w2"]);
  });
});
