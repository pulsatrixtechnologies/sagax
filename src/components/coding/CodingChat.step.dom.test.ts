// @vitest-environment happy-dom
// #3462: a step of an orchestrator bot's work opens as today's coding chat,
// on the team bot, while the orchestrator stays the selected bot: one meta
// line under the bar ("<piece of work> · step 2 of 3 · last action …"), the
// composer aimed at the team bot's thread, the arrow and Escape close, and
// the session card goes to the orchestrator's panel, not the team bot's.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import type { BotActivityDetail } from "../../../shared/bot-activity";
import { buildTeamWork } from "../../../shared/team-work";
import { setExchangeColumnHost } from "@/lib/exchange-column-host";
import { setCodingPanelHost } from "@/lib/coding-panel-host";

const apiMock = vi.fn();
const dispatchMock = vi.fn();
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: (...args: unknown[]) => apiMock(...args),
    useStore: () => ({ state: { ...original.initialState, selectedId: "lead", bots: [lead, tester], groups: [], config: { viewer: { principalId: "person-1" } } }, dispatch: dispatchMock }),
  };
});
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));
const composerProps = vi.fn();
vi.mock("../Composer", () => ({
  Composer: (props: { bot: Bot }) => { composerProps(props); return createElement("div", { "data-test-composer": `${props.bot.id}:${props.bot.threadId}` }); },
}));
vi.mock("../dev-pods/DevPods", () => ({ DevPodsPanel: () => createElement("div", { "data-test-pods": "" }) }));

const NOW = Date.UTC(2026, 10, 10, 15, 0);
const lead = { id: "lead", threadId: "main", name: "Lead", title: "Orchestrator", color: "orange", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const tester = { id: "tester", threadId: "home", name: "Tester", title: "Test engineer", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;

const { setLocale } = await import("@/lib/i18n");
const { CodingChat } = await import("./CodingChat");
const { setTeamWorkRead } = await import("@/lib/use-team-work");
const { initialState, reducer } = await import("@/state/store");

const work = buildTeamWork({
  orchestratorId: "lead", now: NOW, since: 0,
  names: new Map([["builder", { name: "Builder" }], ["tester", { name: "Tester" }]]),
  steps: [
    { id: "h1", botId: "builder", requesterBotId: "lead", threadId: "tb", title: "Build", work: "Release", mode: "work", status: "completed", createdAt: NOW - 600_000, startedAt: NOW - 600_000, finishedAt: NOW - 300_000, coding: true },
    { id: "h2", botId: "tester", requesterBotId: "lead", threadId: "tt", title: "Test", work: "Release", mode: "work", status: "running", createdAt: NOW - 290_000, startedAt: NOW - 290_000, turn: { startedAt: NOW - 290_000, lastActionAt: NOW - 20_000 } },
    { id: "h3", botId: "builder", requesterBotId: "lead", threadId: "tb2", title: "Fix", work: "Release", mode: "work", status: "queued", createdAt: NOW - 10_000 },
  ],
});
const messages: Message[] = [
  { id: "m1", role: "user", kind: "text", text: "Run the tests of the release", at: NOW - 280_000 },
  { id: "m2", role: "bot", kind: "text", text: "Running them now.", at: NOW - 270_000, from: { botId: "tester", name: "Tester", color: "green" } },
];
const detail: BotActivityDetail = {
  id: "thread:tt", kind: "session", botId: "tester", botName: "Tester", title: "Run the tests of the release", status: "running", startedAt: NOW - 290_000, updatedAt: NOW,
  threadId: "tt", coding: true, canStop: true, steps: [], stepsTruncated: false, files: [], children: [],
};
const target = { botId: "tester", itemId: "thread:tt", threadId: "tt", step: { orchestratorId: "lead", name: "Test", work: "Release", index: 2, total: 3 } };

let host: HTMLDivElement;
let column: HTMLDivElement;
let root: Root;
let leadPanel: HTMLDivElement;
let testerPanel: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setLocale("en");
  apiMock.mockReset();
  apiMock.mockImplementation(async (url: string) => {
    if (url.includes("/activity/item")) return { item: detail };
    if (url.startsWith("/api/threads/tt/messages")) return { messages, hasMore: false };
    return {};
  });
  dispatchMock.mockReset();
  composerProps.mockReset();
  host = document.createElement("div");
  column = document.createElement("div");
  host.append(column);
  document.body.append(host);
  setExchangeColumnHost(column);
  leadPanel = document.createElement("div");
  testerPanel = document.createElement("div");
  document.body.append(leadPanel, testerPanel);
  setCodingPanelHost("lead", leadPanel);
  setCodingPanelHost("tester", testerPanel);
  setTeamWorkRead("lead", work);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  setExchangeColumnHost(null);
  setCodingPanelHost("lead", null);
  setCodingPanelHost("tester", null);
  setTeamWorkRead("lead", null);
  leadPanel.remove();
  testerPanel.remove();
  host.remove();
  vi.useRealTimers();
});

describe("a step's coding chat", () => {
  it("opens on the team bot while the orchestrator stays selected, the panel open as it was", () => {
    const panel = { ...initialState, settingsOpen: true, selectedId: "lead", activeView: "chat" as const };
    const opened = reducer(panel, { type: "openCodingChat", target });
    expect(opened.selectedId).toBe("lead");
    expect(opened.settingsOpen).toBe(true);
    expect(opened.codingChat).toMatchObject({ botId: "tester", step: { orchestratorId: "lead" } });
  });

  it("draws today's look with the step's name, the team bot's pill and the meta line", async () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(CodingChat, { target, onClose })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-line]")).not.toBeNull());
    const sheet = column.querySelector<HTMLElement>("[data-testid=coding-chat]")!;
    expect(sheet.querySelector("[data-coding-title]")?.textContent).toBe("Test");
    expect(sheet.querySelector("[data-coding-bot]")?.textContent).toContain("Tester");
    expect(sheet.querySelector("[data-coding-step-meta]")?.textContent).toBe("Release · step 2 of 3 · last action 20 s ago");
    expect(sheet.querySelector("[data-coding-back]")).not.toBeNull();
    // no thread panel, no Open thread
    expect(sheet.textContent).not.toMatch(/open thread/i);
  });

  it("the composer writes to the team bot's thread", async () => {
    flushSync(() => root.render(createElement(CodingChat, { target, onClose: vi.fn() })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-line]")).not.toBeNull());
    expect(column.querySelector('[data-coding-composer] [data-test-composer="tester:tt"]')).not.toBeNull();
    expect(composerProps).toHaveBeenLastCalledWith(expect.objectContaining({ bot: expect.objectContaining({ id: "tester", threadId: "tt", busy: true }) }));
  });

  it("the arrow and Escape close it", async () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(CodingChat, { target, onClose })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-back]")).not.toBeNull());
    flushSync(() => column.querySelector<HTMLButtonElement>("[data-coding-back]")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("the session card goes to the orchestrator's panel, never the team bot's", async () => {
    flushSync(() => root.render(createElement(CodingChat, { target, onClose: vi.fn() })));
    await vi.waitFor(() => expect(leadPanel.querySelector("[data-coding-session-card]")).not.toBeNull());
    expect(testerPanel.querySelector("[data-coding-session-card]")).toBeNull();
  });

  it("before the list is read, the meta line says the work and the place it was opened with", async () => {
    setTeamWorkRead("lead", null);
    flushSync(() => root.render(createElement(CodingChat, { target, onClose: vi.fn() })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-line]")).not.toBeNull());
    expect(column.querySelector("[data-coding-step-meta]")?.textContent).toBe("Release · step 2 of 3");
  });

  it("a task that is no step draws no meta line and keeps its own panel", async () => {
    flushSync(() => root.render(createElement(CodingChat, { target: { botId: "tester", itemId: "thread:tt", threadId: "tt" }, onClose: vi.fn() })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-line]")).not.toBeNull());
    expect(column.querySelector("[data-coding-step-meta]")).toBeNull();
    expect(testerPanel.querySelector("[data-coding-session-card]")).not.toBeNull();
    expect(leadPanel.querySelector("[data-coding-session-card]")).toBeNull();
  });
});
