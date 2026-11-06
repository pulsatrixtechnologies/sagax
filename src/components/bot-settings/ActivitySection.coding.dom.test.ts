// @vitest-environment happy-dom
// 2026-11-03: a row of the bot panel's Coding list opens the coding chat
// where the chat is (AppState.codingChat), never the task sheet in the side
// panel; the panel stays open as it was.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotActivityItem, BotActivityList } from "../../../shared/bot-activity";

const dispatchMock = vi.fn();
const list: { value: BotActivityList } = { value: { items: [], subagents: [] } };
vi.mock("@/lib/use-bot-activity-feed", () => ({
  useBotActivityFeed: () => ({
    list: list.value, error: false, refresh: vi.fn(async () => {}), stop: vi.fn(), stopping: new Set(), now: NOW,
    live: { visible: () => true, fading: () => false }, deepLinked: null, clearDeepLink: vi.fn(),
  }),
}));
vi.mock("@/state/store-selector", () => ({ useStoreDispatch: () => dispatchMock, useStoreGetter: () => () => ({ routineRuns: [] }) }));
vi.mock("@/lib/code-branches", () => ({ loadArchivedBranches: vi.fn(async () => []), setBranchArchived: vi.fn(async () => []) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false }));

const NOW = Date.UTC(2026, 10, 3, 15, 0);
const coding: BotActivityItem = {
  id: "thread:th-9", kind: "session", botId: "osprey", botName: "Osprey", title: "Pour la colonne du board", status: "running",
  startedAt: NOW - 240_000, updatedAt: NOW, threadId: "th-9", coding: true, canStop: true, currentStep: "pnpm test",
  code: { folder: "/workspace/bots/osprey/dispatch-board", branch: "feat/column", pullRequests: [], branches: [], commits: [] },
};

const { setLocale } = await import("@/lib/i18n");
const { ActivitySection, opensAsCodingChat } = await import("./ActivitySection");
const { initialState, reducer } = await import("@/state/store");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  dispatchMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("Coding list rows", () => {
  it("open the coding chat, not the side panel's task sheet", () => {
    list.value = { items: [coding], subagents: [] };
    const bot = { id: "osprey", name: "Osprey", color: "blue", threadId: "main", tasks: [] } as never;
    flushSync(() => root.render(createElement(ActivitySection, { bot })));
    const card = host.querySelector<HTMLElement>('[data-activity-card="thread:th-9"]')!;
    expect(card).not.toBeNull();
    flushSync(() => card.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    expect(dispatchMock).toHaveBeenCalledWith({ type: "openCodingChat", target: { botId: "osprey", itemId: "thread:th-9", threadId: "th-9", seed: coding } });
    expect(document.querySelector("[data-activity-detail]")).toBeNull();
  });

  it("only for a coding conversation or cloud agent, never a routine run or a sub-agent", () => {
    expect(opensAsCodingChat(coding)).toBe(true);
    expect(opensAsCodingChat({ ...coding, id: "cloud:c1", kind: "session" })).toBe(true);
    expect(opensAsCodingChat({ ...coding, coding: undefined })).toBe(false);
    expect(opensAsCodingChat({ ...coding, id: "run:r1", kind: "routine" })).toBe(false);
    expect(opensAsCodingChat({ ...coding, kind: "subagent" })).toBe(false);
  });

  it("the chat opens over the chat column and leaves the bot panel open; a routine run or another bot closes it", () => {
    const panel = { ...initialState, settingsOpen: true, selectedId: "osprey", activeView: "chat" as const };
    const opened = reducer(panel, { type: "openCodingChat", target: { botId: "osprey", itemId: "thread:th-9", threadId: "th-9" } });
    expect(opened.codingChat).toMatchObject({ itemId: "thread:th-9" });
    expect(opened.settingsOpen).toBe(true);
    expect(opened.activeView).toBe("chat");
    expect(reducer(opened, { type: "closeCodingChat" }).codingChat).toBeNull();
    expect(reducer(opened, { type: "openRoutineRunInChat", runId: "r1" }).codingChat).toBeNull();
    expect(reducer(opened, { type: "select", id: "wren" }).codingChat).toBeNull();
  });
});
