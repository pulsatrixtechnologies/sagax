// Collapsed bot-to-bot runs, date-time separators, and Messaged chips that
// stay in this conversation.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, Group, InstanceInfo, Message } from "@/state/store";
import { formatTime } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
// Thread mode on: these cases cover the Go to conversation chip, which the
// unified chat (the default) never draws (the owner 2026-11-06, unified-chat.guard.test.ts).
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/thread-preferences")>()),
  useShowThreads: () => true,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const dm = {
    id: "dm", threadId: "dm-t", name: "Quasar", dm: true, memberIds: ["bot", "cry"],
    defaultResponder: { kind: "member", botId: "cry" }, bulletin: "", unread: false,
    createdAt: 1, messages: [],
  } as Group;
  return { ...original, useStore: () => ({
    state: {
      ...original.initialState,
      // a comm chip is verbose detail: shown with tool calls (the details
      // toggle) on, so this layout case can see the quiet receipt
      config: { features: { showToolCalls: true } },
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      groups: [dm],
      bots: [
        { id: "bot", threadId: "t1", name: "Pepper", color: "green" },
        { id: "cry", threadId: "cry-t", name: "Quasar", color: "blue" },
      ],
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

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const at = new Date(2026, 9, 5, 5, 17).getTime();
const NOTE = "[Message from @Quasar, another bot in this Sagax workspace. Reply to them.]\n\nWhich database?";
const message = (id: string, text: string, extra: Record<string, unknown> = {}): Message =>
  ({ id, role: "user", kind: "text", text, at, ...extra }) as Message;

const bot = (messages: Message[]): Bot => ({
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages,
  modelSelection: { instanceId: "test", model: "m" },
});

describe("chat bot-to-bot collapse and dates", () => {
  it("folds a peer run into a chip and keeps the person's lines", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, {
      bot: bot([
        message("u", "hello"),
        message("p", NOTE, { peerAsk: { botId: "cry", name: "Quasar" } }),
        message("r", "on it", { role: "bot", requestMessageId: "p" }),
        message("s", "Quasar finished the check", { role: "bot" }),
      ]),
    }));
    expect(markup).toContain("Open the chat");
    expect(markup).toContain("Quasar");
    expect(markup).toContain('data-testid="bot-exchange-chip"');
    expect(markup).not.toContain("Which database?");
    expect(markup).not.toContain("on it");
    expect(markup).toContain("hello");
    expect(markup).toContain("Quasar finished the check");
    expect(markup).not.toContain("bot-exchange-sheet");
  });

  it("stamps Today with the time, and again after a 30 minute gap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0));
    try {
      const later = at + 31 * 60_000;
      const markup = renderToStaticMarkup(createElement(ChatView, {
        bot: bot([
          message("u", "morning"),
          message("v", "after the pause", { at: later }),
        ]),
      }));
      const stamps = [...markup.matchAll(/data-testid="transcript-date"[^>]*>([^<]+)</g)].map((match) => match[1]);
      expect(stamps).toEqual([`Today ${formatTime(at)}`, `Today ${formatTime(later)}`]);
      expect(markup).toContain("morning");
      expect(markup).toContain("after the pause");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stamps Aujourd'hui when the app language is French", () => {
    setLocale("fr");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0));
    try {
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: bot([message("u", "bonjour")]) }));
      expect(markup).toMatch(new RegExp(`Aujourd(&#x27;|')hui ${formatTime(at)}`));
    } finally {
      vi.useRealTimers();
      setLocale("en");
    }
  });

  it("draws a Messaged chip to a bot-to-bot DM as the quiet Messaged line (#3270)", () => {
    fixture.dispatch.mockClear();
    const markup = renderToStaticMarkup(createElement(ChatView, {
      bot: bot([
        message("u", "ask Quasar"),
        {
          id: "c",
          role: "bot",
          kind: "activity",
          at: at + 1000,
          tool: { name: "Messaged @Quasar", ok: true },
          comm: { groupId: "dm", withBotId: "cry", withName: "Quasar", withColor: "blue" },
        } as Message,
      ]),
    }));
    // one centered line naming the bot, no "@", no row that selects the channel
    expect(markup).toContain('data-testid="messaged-line"');
    expect(markup).not.toContain('data-testid="bot-comm-chip"');
    expect(markup).not.toContain("@Quasar");
    expect(markup).toContain("Quasar");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
});
