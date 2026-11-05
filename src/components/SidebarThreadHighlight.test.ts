// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  state: { activeView: "chat", selectedId: "atlas", deletingBots: {}, pendingQueued: {}, instances: [], revealThread: null as null | { threadId: string; nonce: number } },
}));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return { ...actual, useStore: () => ({ state: { ...actual.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", async (original) => ({ ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
  useThreadsLocationChoice: () => "sidebar" as const,
  useThreadsMode: () => "sidebar" as "one" | "header" | "sidebar",
}));
vi.mock("@/lib/live-call-media", async (original) => {
  const actual = await original<typeof import("@/lib/live-call-media")>();
  return { ...actual, useLiveMedia: actual.liveMedia };
});
import { BotListItem } from "./Sidebar";

const bot: Bot = {
  id: "atlas", threadId: "current", name: "Atlas", title: "", description: "",
  notifications: true, color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" },
  messages: [{ id: "reply", role: "bot", kind: "text", text: "The latest reply", at: 1 }],
  tasks: [{ threadId: "current", title: "Current", createdAt: 1 }],
};
let host: HTMLDivElement;
let root: Root;
async function render(candidate = bot) {
  await act(async () => { root.render(createElement(BotListItem, { bot: candidate, density: "comfortable", onMenu: vi.fn() })); });
  return host.innerHTML;
}
beforeEach(() => {
  fixture.state.revealThread = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

// Owner (2026-10-12): bot row + its selected thread made two stacked rounded
// blocks. In the sidebar mode the bot folds open on its threads: the thread
// on screen carries the one highlight, never the bot row as well.
describe("sidebar threads: one highlight for the selected conversation", () => {
  it("draws the selected fill on the thread on screen only, under the unfolded bot", async () => {
    const multiple = { ...bot, tasks: [...bot.tasks!, { threadId: "older", title: "Earlier", createdAt: 0 }] };
    fixture.state.revealThread = { threadId: "current", nonce: 1 };
    const markup = await render(multiple);
    expect(markup).toContain('data-sidebar-thread-row="current"');
    expect(markup.match(/bg-sidebar-selected/g)).toHaveLength(1);
    expect(markup).not.toMatch(/data-sidebar-bot-row="atlas"[^>]*class="[^"]*bg-sidebar-selected/);
  });
});
