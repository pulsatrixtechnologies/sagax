import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true, useThreadsLocationChoice: () => "header" }));

import { BotListItem } from "./Sidebar";

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [], ...overrides,
});

const render = (candidate: Bot, selection?: { active: boolean; selected: boolean }) => renderToStaticMarkup(createElement(
  StoreProvider, null,
  createElement(BotListItem, { bot: candidate, density: "comfortable", onMenu: vi.fn(),
    ...(selection ? { selection: { ...selection, onToggle: vi.fn() } } : {}) }),
));

describe("sidebar multi-select row", () => {
  it("marks an unread row for the more-unread pills", () => {
    expect(render(bot({ unread: true }))).toContain("data-sidebar-unread");
    expect(render(bot())).not.toContain("data-sidebar-unread");
  });
  it("shows a pressed check and drops the row buttons while selecting", () => {
    const markup = render(bot(), { active: true, selected: true });
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("data-sidebar-select-mark");
    expect(markup).not.toContain("data-sidebar-bot-new-thread");
    expect(render(bot(), { active: true, selected: false })).toContain('aria-pressed="false"');
  });
  it("is unchanged outside selection", () => {
    const markup = render(bot());
    expect(markup).not.toContain("aria-pressed");
    expect(markup).toContain("data-sidebar-bot-new-thread");
  });
});
