// @vitest-environment happy-dom
// The bot panel's Coding section (the owner, 2026-11-06): a grey "Coding" label
// above one CodingSessionRow per session in the panel card. Each row is a
// state mark (dotted spinner while it runs), the title on one line
// (truncated) and a chevron; nothing else is visible. A click opens the
// session in the chat column, never a side panel.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotActivityItem, BotLaunchedAgentItem } from "@/lib/bot-activity";

const { setLocale } = await import("@/lib/i18n");
const { AgentRows } = await import("./AgentRows");
const { PanelSections } = await import("./ActivitySection");

const NOW = Date.UTC(2026, 11, 5, 15, 0);
const M = 60_000;
const item = (id: string, title: string, status: BotActivityItem["status"], extra: Partial<BotActivityItem> = {}): BotActivityItem => ({
  id: `thread:${id}`, kind: "session", botId: "pepper", botName: "Pepper", title, status,
  startedAt: NOW - 21 * M, updatedAt: NOW, threadId: id, coding: true, canStop: true, ...extra,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const rows = () => [...host.querySelectorAll<HTMLElement>("[data-agent-row]")];

describe("Coding section", () => {
  it("shows the grey Coding label above the rows", () => {
    const list = { items: [item("a1", "Fix the column order", "running")], subagents: [] };
    flushSync(() => root.render(createElement(PanelSections, {
      list, live: [], actions: { onOpen: vi.fn(), now: NOW }, onOpenHistory: vi.fn(),
    } as never)));
    const section = host.querySelector('[data-bot-settings-section="coding"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("Coding");
    expect(section!.querySelectorAll("[data-agent-row]")).toHaveLength(1);
  });
});

describe("CodingSessionRow (through AgentRows)", () => {
  it("draws a running session as a dotted spinner, the title and a chevron, nothing else", () => {
    const onOpen = vi.fn();
    const running = item("a1", "Recording tags, favorites API and stream merging", "running", { currentStep: "pnpm vitest run src/board" });
    flushSync(() => root.render(createElement(AgentRows, { items: [running], onOpen })));
    const row = rows()[0]!;
    expect(row.dataset.agentStatus).toBe("running");
    expect(row.querySelector("[data-coding-spinner]")).not.toBeNull();
    const title = row.querySelector("[data-agent-title]")!;
    expect(title.textContent).toBe("Recording tags, favorites API and stream merging");
    expect(title.className).toContain("truncate");
    expect(row.querySelector("[data-coding-chevron]")).not.toBeNull();
    // no tag, step line, duration, tokens or badge: the grey subtitle is the state alone
    expect(row.querySelector("[data-agent-tag],[data-agent-line],[data-agent-right],[data-agent-tokens]")).toBeNull();
    expect(row.textContent).toBe(`${title.textContent}Running`);
    expect(row.textContent).not.toContain("@Pepper");
    expect(row.textContent).not.toContain("21m");
    flushSync(() => row.querySelector<HTMLButtonElement>("[data-coding-open]")!.click());
    expect(onOpen).toHaveBeenCalledWith(running);
    expect(document.querySelector("[data-activity-detail]")).toBeNull();
  });

  it("uses a fixed state icon, not the spinner, once it is not running", () => {
    flushSync(() => root.render(createElement(AgentRows, {
      items: [item("a2", "Write the notes", "waiting"), item("a3", "Review the lexer", "finished", { endedAt: NOW - M }), item("a4", "Tidy the grid", "failed", { endedAt: NOW - M })],
      onOpen: vi.fn(),
    })));
    const [waiting, finished, failed] = rows();
    for (const row of rows()) expect(row.querySelector("[data-coding-spinner]")).toBeNull();
    expect(waiting!.querySelector('[data-activity-icon="waiting"]')).not.toBeNull();
    expect(finished!.querySelector('[data-activity-icon="finished"]')).not.toBeNull();
    expect(failed!.querySelector('[data-activity-icon="failed"]')).not.toBeNull();
  });

  it("keeps Stop for a live row and Ignore for a finished one, hidden until hover or focus", () => {
    const onStop = vi.fn();
    const onIgnore = vi.fn();
    const live = item("a1", "Fix the lexer", "running");
    flushSync(() => root.render(createElement(AgentRows, { items: [live, item("a2", "Split the parser", "finished", { endedAt: NOW - M })], onOpen: vi.fn(), onStop, onIgnore })));
    const stops = host.querySelectorAll<HTMLButtonElement>("[data-activity-stop]");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.className).toContain("opacity-0");
    flushSync(() => stops[0]!.click());
    expect(onStop).toHaveBeenCalledWith(live);
    const ignores = [...host.querySelectorAll<HTMLButtonElement>("[data-agent-ignore]")];
    expect(ignores.map((b) => b.dataset.agentIgnore)).toEqual(["thread:a2"]);
    expect(ignores[0]!.className).toContain("opacity-0");
    flushSync(() => ignores[0]!.click());
    expect(onIgnore).toHaveBeenCalledWith("thread:a2");
  });

  it("draws the rows in the panel card, in the UI font, never mono", () => {
    flushSync(() => root.render(createElement(AgentRows, { items: [item("p1", "Build the page", "finished", { endedAt: NOW - 2 * M })], onOpen: () => {} })));
    const list = host.querySelector("ul")!;
    expect(list.className).toContain("rounded-xl");
    expect(list.className).toContain("bg-[var(--bot-panel-card)]");
    expect(host.innerHTML).not.toContain("font-mono");
    expect(rows()[0]!.className).toContain("min-h-14");
    expect(rows()[0]!.className).toContain("hover:bg-hover");
  });

  it("shows five rows then ↓ N more, launched agents first, and a click opens the launched session", () => {
    const launched: BotLaunchedAgentItem[] = [
      { id: "l1", targetBotId: "marc", targetBotName: "Marc", title: "work", status: "running", startedAt: NOW - 4 * M, updatedAt: NOW, threadId: "l1" },
      { id: "l2", targetBotId: "marc", targetBotName: "Marc", title: "release", status: "failed", startedAt: NOW - 90 * M, updatedAt: NOW - 60 * M, pullRequest: { number: 200, url: "https://example.test/pr/200" } },
    ];
    const items = ["b1", "b2", "b3", "b4", "b5"].map((id) => item(id, `Task ${id}`, "finished", { endedAt: NOW - M }));
    const onOpenLaunched = vi.fn();
    flushSync(() => root.render(createElement(AgentRows, { items, launched, onOpen: vi.fn(), onOpenLaunched })));
    expect(rows()).toHaveLength(5);
    expect(rows()[0]!.dataset.launchedAgent).toBe("l1");
    const more = host.querySelector<HTMLButtonElement>("[data-agent-rows-more]")!;
    expect(more.textContent).toBe("↓ 2 more");
    flushSync(() => more.click());
    expect(rows()).toHaveLength(7);
    expect(host.querySelector("[data-agent-rows-more]")).toBeNull();
    flushSync(() => rows()[0]!.querySelector<HTMLButtonElement>("[data-coding-open]")!.click());
    expect(onOpenLaunched).toHaveBeenCalledWith(launched[0]);
  });

  it("renders nothing without rows", () => {
    flushSync(() => root.render(createElement(AgentRows, { items: [], onOpen: vi.fn() })));
    expect(host.querySelector("[data-agent-rows]")).toBeNull();
  });
});

describe("Coding row subtitle", () => {
  const pr = (number: number, action: "opened" | "merged") => ({ number, url: `https://github.com/acme/web/pull/${number}`, action, at: NOW });
  const code = (...pullRequests: ReturnType<typeof pr>[]) => ({ pullRequests, branches: [], commits: [] });

  it("says the state and links #N only when there is a pull request", () => {
    const items = [
      item("m1", "RVSQ S3: rebase PR #3 onto main", "finished", { code: code(pr(3, "merged")) }),
      item("p1", "Recording tags", "finished", { code: { ...code(pr(40, "opened")), branch: undefined } }),
      item("n1", "No pull request", "finished"),
    ];
    flushSync(() => root.render(createElement(AgentRows, { items, onOpen: vi.fn() } as never)));
    const sub = (id: string) => host.querySelector(`[data-activity-card="thread:${id}"] [data-coding-subtitle]`)!;
    expect(sub("m1").textContent).toBe("Merged·#3");
    expect(sub("m1").querySelector("[data-coding-pr]")!.getAttribute("data-coding-pr")).toBe("https://github.com/acme/web/pull/3");
    expect(sub("p1").textContent).toBe("Ready for review·#40");
    expect(sub("n1").textContent).toBe("Finished");
    expect(sub("n1").querySelector("[data-coding-pr]")).toBeNull();
  });
});
