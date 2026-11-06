// @vitest-environment happy-dom
// The bot panel's Coding section as Claude Code's agent list (#2099, JC
// 2026-11-05): one row per task, `○` while it runs and `●` once done, the tag
// and title, the step in words (never the raw command), the elapsed time and
// the tokens at the right, Stop on a live row, "↓ N more" past five, and a
// click that opens the task where the chat is: never a side panel.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskUsage } from "@/state/store";
import type { BotActivityItem, BotLaunchedAgentItem } from "@/lib/bot-activity";

const { setLocale } = await import("@/lib/i18n");
const { AgentRows } = await import("./AgentRows");

const NOW = Date.UTC(2026, 11, 5, 15, 0);
const M = 60_000;
const item = (id: string, title: string, status: BotActivityItem["status"], extra: Partial<BotActivityItem> = {}): BotActivityItem => ({
  id: `thread:${id}`, kind: "session", botId: "pepper", botName: "Pepper", title, status,
  startedAt: NOW - 21 * M, updatedAt: NOW, threadId: id, coding: true, canStop: true, ...extra,
});
const usage: Record<string, TaskUsage> = { a1: { input: 95_300, output: 6_500, costUsd: null, turns: 12 } };

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

describe("AgentRows", () => {
  it("draws a running task as a row: tag, title, the step in words, elapsed and tokens, Stop", () => {
    const onOpen = vi.fn();
    const onStop = vi.fn();
    const running = item("a1", "Fix the column order", "running", { currentStep: "cd /srv/bots/pepper/board && pnpm vitest run src/board" });
    flushSync(() => root.render(createElement(AgentRows, { items: [running], onOpen, onStop, now: NOW, usageOf: (threadId: string) => usage[threadId] })));
    const row = rows()[0]!;
    expect(row.dataset.agentStatus).toBe("running");
    expect(row.textContent).toContain("○");
    expect(row.querySelector("[data-agent-tag]")?.textContent).toBe("@Pepper");
    expect(row.textContent).toContain("Fix the column order");
    expect(row.querySelector("[data-agent-line]")?.textContent).toBe("Running src/board tests");
    expect(row.textContent).not.toContain("/srv");
    expect(row.textContent).not.toContain("pnpm");
    expect(row.querySelector("[data-agent-right]")?.textContent).toMatch(/21m/);
    expect(row.querySelector("[data-agent-tokens]")?.textContent).toBe("↓ 102k tokens");
    flushSync(() => row.querySelector<HTMLButtonElement>("[data-activity-stop]")!.click());
    expect(onStop).toHaveBeenCalledWith(running);
    flushSync(() => row.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    expect(onOpen).toHaveBeenCalledWith(running);
    expect(document.querySelector("[data-activity-detail]")).toBeNull();
  });

  it("draws a finished task with ● and no Stop, a waiting command as Waiting", () => {
    flushSync(() => root.render(createElement(AgentRows, {
      items: [
        item("a2", "Write the notes", "waiting", { currentStep: "sleep 30; pgrep -f vite" }),
        item("a3", "Review the lexer", "finished", { endedAt: NOW - 50 * M }),
        item("a4", "Tidy the grid", "failed", { endedAt: NOW - 50 * M }),
      ],
      onOpen: vi.fn(), onStop: vi.fn(), now: NOW,
    })));
    const [waiting, finished, failed] = rows();
    expect(waiting!.querySelector("[data-agent-line]")?.textContent).toBe("Waiting");
    expect(finished!.textContent).toContain("●");
    expect(finished!.querySelector("[data-activity-stop]")).toBeNull();
    expect(failed!.dataset.agentStatus).toBe("failed");
    expect(host.querySelectorAll("[data-activity-stop]")).toHaveLength(1);
  });

  it("shows five rows then ↓ N more, launched agents first with their pull request", () => {
    const launched: BotLaunchedAgentItem[] = [
      { id: "l1", targetBotId: "marc", targetBotName: "Marc", title: "work", status: "running", startedAt: NOW - 4 * M, updatedAt: NOW, threadId: "l1" },
      { id: "l2", targetBotId: "marc", targetBotName: "Marc", title: "release", status: "failed", startedAt: NOW - 90 * M, updatedAt: NOW - 60 * M, pullRequest: { number: 200, url: "https://example.test/pr/200" } },
    ];
    const items = ["b1", "b2", "b3", "b4", "b5"].map((id) => item(id, `Task ${id}`, "finished", { endedAt: NOW - M }));
    const onOpenLaunched = vi.fn();
    flushSync(() => root.render(createElement(AgentRows, { items, launched, onOpen: vi.fn(), onOpenLaunched, now: NOW })));
    expect(rows()).toHaveLength(5);
    expect(rows()[0]!.dataset.launchedAgent).toBe("l1");
    expect(rows()[0]!.querySelector("[data-agent-tag]")?.textContent).toBe("@Marc");
    expect(rows()[1]!.querySelector("[data-launched-pr]")?.textContent).toBe("#200");
    expect(host.querySelector("[data-launched-agents]")).not.toBeNull();
    const more = host.querySelector<HTMLButtonElement>("[data-agent-rows-more]")!;
    expect(more.textContent).toBe("↓ 2 more");
    flushSync(() => more.click());
    expect(rows()).toHaveLength(7);
    expect(host.querySelector("[data-agent-rows-more]")).toBeNull();
    flushSync(() => rows()[0]!.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    expect(onOpenLaunched).toHaveBeenCalledWith(launched[0]);
  });

  it("renders nothing without rows", () => {
    flushSync(() => root.render(createElement(AgentRows, { items: [], onOpen: vi.fn() })));
    expect(host.querySelector("[data-agent-rows]")).toBeNull();
  });

  it("offers Ignore on a finished row only, without confirmation (#2148)", () => {
    const onIgnore = vi.fn();
    flushSync(() => root.render(createElement(AgentRows, { items: [item("a1", "Fix the lexer", "finished", { endedAt: NOW - M }), item("a2", "Split the parser", "running")], onOpen: vi.fn(), onIgnore, now: NOW })));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-agent-ignore]")];
    expect(buttons.map((b) => b.dataset.agentIgnore)).toEqual(["thread:a1"]);
    flushSync(() => buttons[0].click());
    expect(onIgnore).toHaveBeenCalledWith("thread:a1");
  });
});

describe("AgentRows parity with the panel's other sections (2026-11-06)", () => {
  it("draws the rows in the panel card, in the UI font, never mono", () => {
    flushSync(() => root.render(createElement(AgentRows, { items: [item("p1", "Build the page", "finished", { endedAt: NOW - 2 * M })], onOpen: () => {}, now: NOW })));
    const list = host.querySelector("ul")!;
    expect(list.className).toContain("rounded-xl");
    expect(list.className).toContain("bg-[var(--bot-panel-card)]");
    expect(host.innerHTML).not.toContain("font-mono");
    const row = rows()[0]!;
    expect(row.className).toContain("px-3 py-2");
    expect(row.className).toContain("hover:bg-hover");
  });

  it("a finished row shows how long it ran, never the time since it began", () => {
    const old = item("p2", "Old thread", "finished", { startedAt: NOW - 228 * 60 * M, endedAt: NOW - 228 * 60 * M + 3 * M });
    flushSync(() => root.render(createElement(AgentRows, { items: [old], onOpen: () => {}, now: NOW })));
    expect(rows()[0]!.querySelector("[data-agent-right]")?.textContent).toBe("3m");
  });

  it("a finished row without a known end shows no number", () => {
    const noEnd = item("p3", "No end", "finished", { startedAt: NOW - 228 * 60 * M });
    flushSync(() => root.render(createElement(AgentRows, { items: [noEnd], onOpen: () => {}, now: NOW })));
    expect(rows()[0]!.querySelector("[data-agent-right]")?.textContent).toBe("");
  });
});
