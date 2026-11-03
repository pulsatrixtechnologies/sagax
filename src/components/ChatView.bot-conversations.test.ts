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
  useShowThreads: () => true, useThreadsMode: () => "header" as "one" | "header" | "sidebar",
}));

const { ChatView } = await import("./ChatView");
const { conversationAnchors, EarlierConversationList, splitLeadingConversations, dedupeConversations } = await import("./BotConversations");
afterAll(() => vi.unstubAllGlobals());

const message = (id: string, text: string, at: number, role: "user" | "bot" = "user"): Message => ({ id, role, kind: "text", text, at }) as Message;
const ottoline = (messages: Message[], botConversations: Bot["botConversations"]): Bot => ({
  id: "kat", threadId: "kat-main", mainThreadId: "kat-main", name: "Ottoline", title: "", description: "", color: "green",
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
    const self = ottoline(messages, rows);
    fixture.bots = [self, melonie];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: self }));
    expect(markup).not.toContain("data-bot-conversations");
    expect(markup).not.toContain("Conversation with Melonie");
    const order = ["first question", 'data-thread-chip="w1"', "second question", 'data-thread-chip="w2"', "third question"].map((needle) => markup.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    // Two Melonie conversations sit at different times (between different
    // person lines), so each stays its own quiet line.
    expect(markup.match(/data-testid="bot-exchange-chip"/g)).toHaveLength(2);
    expect(markup).toContain("Go to conversation");
  });

  it("folds consecutive Go to conversation rows at the same place into one chip", () => {
    // Peer ids must differ from self (self is "kat"/Ottoline): otherwise the
    // store lookup for otherBotId resolves to the viewing bot's face/name.
    const stacked: NonNullable<Bot["botConversations"]> = [
      { threadId: "k1", otherBotId: "osprey", otherName: "Osprey", direction: "out", startedAt: T + MIN, updatedAt: T + 2 * MIN },
      { threadId: "k2", otherBotId: "osprey", otherName: "Osprey", direction: "in", startedAt: T + 2 * MIN, updatedAt: T + 3 * MIN },
      { threadId: "k3", otherBotId: "osprey", otherName: "Osprey", direction: "out", startedAt: T + 3 * MIN, updatedAt: T + 4 * MIN },
      { threadId: "e1", otherBotId: "emb", otherName: "Ember", direction: "out", startedAt: T + 4 * MIN, updatedAt: T + 5 * MIN },
    ];
    const self = ottoline([message("a", "hello", T), message("b", "thanks", T + 10 * MIN)], stacked);
    fixture.bots = [self, { id: "osprey", threadId: "osprey-main", name: "Osprey", color: "purple" }, { id: "emb", threadId: "emb-main", name: "Ember", color: "orange" }];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: self }));
    expect(markup.match(/data-testid="goto-group-chip"/g)).toHaveLength(1);
    expect(markup).toContain("3 conversations with Osprey");
    expect(markup).toContain("1 with Ember");
    expect(markup.match(/data-testid="bot-exchange-chip"/g) ?? []).toHaveLength(0);
    expect((markup.match(/Go to conversation/g) ?? []).length).toBe(0);
  });

  it("skips a conversation the transcript already links to, and shows nothing outside the main chat", () => {
    const linked = [...messages, { id: "r", role: "bot", kind: "activity", at: T + 6 * MIN, tool: { name: "Opened thread #x", ok: true }, threadRef: { botId: "mel", threadId: "w1", title: "x" } } as Message];
    const self = ottoline(linked, rows);
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

  describe("conversations older than the topic's first line", () => {
    const old: NonNullable<Bot["botConversations"]> = [
      { threadId: "o1", otherBotId: "mel", otherName: "Melonie", direction: "out", startedAt: T - 90 * MIN, updatedAt: T - 80 * MIN },
      { threadId: "o2", otherBotId: "mel", otherName: "Melonie", direction: "in", startedAt: T - 60 * MIN, updatedAt: T - 50 * MIN },
      { threadId: "o3", otherBotId: "bru", otherName: "Brunhilde", direction: "out", startedAt: T - 30 * MIN, updatedAt: T - 20 * MIN },
      { threadId: "o4", otherBotId: "mel", otherName: "Melonie", direction: "out", startedAt: T - 10 * MIN, updatedAt: T - 5 * MIN },
    ];
    const bru = { id: "bru", threadId: "bru-main", name: "Brunhilde", color: "orange" };

    it("folded: no link is drawn above the first message", () => {
      const self = ottoline([message("a", "hello", T)], old);
      fixture.bots = [self, melonie, bru];
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: self }));
      expect(markup).not.toContain("Go to conversation");
      expect(markup).not.toContain("data-thread-chip");
      expect(markup).toContain('data-previous-topics="closed"');
      expect(markup).toContain("Earlier topics");
    });

    it("splits what opens the topic from what sits inside it", () => {
      const { leading, inline } = splitLeadingConversations([...old, { threadId: "mid", otherBotId: "mel", otherName: "Melonie", direction: "out", startedAt: T + MIN }], T, false);
      expect(leading.map((row) => row.threadId)).toEqual(["o1", "o2", "o3", "o4"]);
      expect(inline.map((row) => row.threadId)).toEqual(["mid"]);
      expect(splitLeadingConversations(old, T, true).leading).toEqual([]);
      expect(splitLeadingConversations(old, undefined, false).leading).toHaveLength(4);
    });

    it("unfolded: one compact line per bot, the most recent, newest first", () => {
      expect(dedupeConversations(old).map((row) => row.threadId)).toEqual(["o4", "o3"]);
      const self = ottoline([], old);
      fixture.bots = [self, melonie, bru];
      const markup = renderToStaticMarkup(createElement(EarlierConversationList, { self, rows: old, bots: fixture.bots as Bot[] }));
      expect(markup.match(/data-thread-chip=/g)).toHaveLength(2);
      expect(markup.indexOf('data-thread-chip="o4"')).toBeLessThan(markup.indexOf('data-thread-chip="o3"'));
      expect(markup).toContain("justify-start");
      expect(markup).not.toContain("justify-center");
    });
  });
});
