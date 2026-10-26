// Threads off = one unified conversation (JC 2026-10-22): the chat shows no
// cross-thread chrome at the top. The "Other activity (N)" dropdown
// (BotActivityPicker), the "New activity on an earlier topic" pill
// (EarlierTopicActivity) and the "Back to conversation" links
// (ThreadsOffReturnLink / ThreadReturnLink) are gone while threads are off.
// The return link comes back while threads are on.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

const prefs = vi.hoisted(() => ({ showThreads: false }));
const store = vi.hoisted(() => ({ threadReturn: undefined as unknown }));

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

// a bot on its main conversation with a sibling thread that needs attention:
// before the fix this lit the "Other activity" dropdown while threads were off
const scout: Bot = {
  id: "scout", threadId: "main", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: true, busy: false,
  messages: [{ id: "m1", role: "user", kind: "text", text: "hello", at: 1 }],
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [
    { threadId: "main", title: "Scout", createdAt: 1, updatedAt: 5, unread: false },
    { threadId: "sibling", title: "Sibling work", createdAt: 2, updatedAt: 6, unread: true },
  ],
} as Bot;

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: {
      ...original.initialState,
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      bots: [scout],
      threadReturn: store.threadReturn,
    },
    dispatch: vi.fn(),
  }) };
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
  useShowThreads: () => prefs.showThreads,
}));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  prefs.showThreads = false;
  store.threadReturn = { ownerId: "other", threadId: "x" };
});

describe("threads off: no cross-thread chrome at the top of the chat", () => {
  it("draws no Other-activity dropdown, no earlier-topic pill and no Back-to-conversation links", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: scout }));
    expect(markup).not.toContain("data-background-activity");
    expect(markup).not.toContain("data-earlier-topic-activity");
    expect(markup).not.toContain("data-threads-off-return");
    expect(markup).not.toContain("data-thread-return");
  });

  it("keeps the Back-to-conversation return link while threads are on", () => {
    prefs.showThreads = true;
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: scout }));
    expect(markup).toContain("data-thread-return");
  });
});
