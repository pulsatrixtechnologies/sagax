import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, type Bot } from "@/state/store";

const prefs = vi.hoisted(() => ({ show: true, location: "header" as "header" | "sidebar", botThreads: false }));
vi.mock("@/lib/sidebar-bot-threads", () => ({ useSidebarBotThreads: () => prefs.botThreads }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", async (original) => ({ ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => prefs.show,
  useThreadsLocationChoice: () => prefs.location,
  useThreadsMode: () => ((prefs.show) ? prefs.location : "one") as "one" | "header" | "sidebar",
}));
import { BotListItem, BotThreadList } from "./Sidebar";
import { TaskPicker } from "./TaskPicker";

const bot: Bot = {
  id: "atlas", threadId: "current", name: "Atlas", title: "", description: "",
  notifications: true, color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" },
  messages: [{ id: "reply", role: "bot", kind: "text", text: "The latest reply", at: 1 }],
  projects: [{ id: "p1", name: "Research" }],
  tasks: [
    { threadId: "current", title: "Current", createdAt: 1 },
    { threadId: "older", title: "Earlier work", createdAt: 0, projectId: "p1" },
  ],
};

// The query opens the list on first render, so the static markup shows what an
// unfolded bot row holds in each mode.
const sidebar = () => renderToStaticMarkup(createElement(StoreProvider, null,
  createElement(BotListItem, { bot, density: "comfortable", query: "earl", onMenu: () => undefined })));
const header = () => renderToStaticMarkup(createElement(StoreProvider, null, createElement(TaskPicker, { bot })));

beforeEach(() => { prefs.show = true; prefs.location = "header"; prefs.botThreads = false; });

describe("threads location: one place at a time", () => {
  it("In the chat header: the header button is there and the sidebar lists nothing under the bot", () => {
    prefs.location = "header";
    const rail = sidebar();
    expect(rail).toContain('data-sidebar-bot-row="atlas"');
    expect(rail).not.toContain("data-sidebar-thread-row");
    expect(rail).not.toContain("data-sidebar-project");
    expect(rail).not.toContain("data-sidebar-thread-list-actions");
    expect(rail).not.toContain("Expand Atlas threads");
    expect(rail).not.toContain("Collapse Atlas threads");
    expect(header()).toContain('aria-label="All threads"');
  });

  // Settings > Conversation threads > In the sidebar: the bot folds open on
  // its threads under a chevron, and nothing about threads is in the chat
  // header (the icon there belongs to the In the chat header mode only).
  it("In the sidebar location, a bot's threads unfold under it and the header has no thread control", () => {
    prefs.location = "sidebar";
    const rail = sidebar();
    expect(rail).toContain('data-sidebar-bot-row="atlas"');
    expect(rail).toContain("data-sidebar-thread-row");
    expect(rail).toContain('data-sidebar-bot-threads-toggle="atlas"');
    expect(rail).toContain("Collapse Atlas threads");
    expect(header()).toBe("");
  });

  it("lists folders and chats straight, with no My conversations or Threads heading", () => {
    prefs.location = "sidebar";
    const html = renderToStaticMarkup(createElement(StoreProvider, null, createElement(BotThreadList, { bot, selected: true })));
    expect(html).toContain('data-sidebar-project="p1"');
    expect(html).toContain('data-sidebar-thread-row="current"');
    expect(html).not.toContain('data-sidebar-thread-row="older"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-sidebar-my-threads");
    expect(html).not.toContain("My conversations");
    expect(html).not.toMatch(/>Threads</);
    expect(html).not.toContain("No threads yet");
    expect(html).toContain('draggable="true"');
  });

  // #5289: a hand-off another bot opened and a thread the bot opened itself
  it("lists the threads bots opened under the bot only when Show Bot threads is on", () => {
    prefs.location = "sidebar";
    const busy: Bot = { ...bot, projects: [], tasks: [
      { threadId: "current", title: "Current", createdAt: 1 },
      { threadId: "ticket", title: "#1234 - Order script", createdAt: 2, openedBy: { botId: "nimbus", name: "Nimbus", kind: "work", at: 2 } },
      { threadId: "self", title: "Thread Test", createdAt: 3, openedBy: { botId: "atlas", name: "Atlas", at: 3 } },
      { threadId: "run", title: "Nightly", createdAt: 4, routineRunId: "run-1" },
      { threadId: "client", title: "From a client", createdAt: 5, openedBy: { botId: "agent:acme", name: "Acme", kind: "agent", at: 5 } },
    ] };
    const list = () => renderToStaticMarkup(createElement(StoreProvider, null, createElement(BotThreadList, { bot: busy, selected: true })));
    const off = list();
    expect(off).toContain('data-sidebar-thread-row="current"');
    for (const id of ["ticket", "self", "run", "client"]) expect(off).not.toContain(`data-sidebar-thread-row="${id}"`);
    prefs.botThreads = true;
    const on = list();
    for (const id of ["current", "ticket", "self"]) expect(on).toContain(`data-sidebar-thread-row="${id}"`);
    expect(on).toContain("#1234 - Order script");
    expect(on).toContain("Thread Test");
    expect(on).toContain("opened by Nimbus");
    for (const id of ["run", "client"]) expect(on).not.toContain(`data-sidebar-thread-row="${id}"`);
  });

  it("With threads off neither place shows threads", () => {
    prefs.show = false;
    for (const location of ["header", "sidebar"] as const) {
      prefs.location = location;
      expect(sidebar()).not.toContain("data-sidebar-thread-row");
      expect(header()).toBe("");
    }
  });
});
