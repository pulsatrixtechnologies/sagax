// @vitest-environment happy-dom
// 2026-10-28: a newer app against an older server. The server without the
// task list route answers "no route" (404), or refuses a member's session on
// the admin scope (403). The panel says the list comes with the server
// update, never the red error. The background brief does the same. A list
// that cannot be read at all is not shown (see the second block below).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setLocale } from "@/lib/i18n";
import { BOT_TASKS_EVENT } from "@/lib/bot-task-events";
import { createBotTaskStore } from "../../../server/bots/bot-task-list";
import { createBotTaskInternalRoutes } from "../../../server/routes/bot-task-list";
import type { BotTasksFrame } from "../../../shared/bot-task-list";
import { BackgroundBriefCard } from "./BackgroundBriefCard";
import { BotTaskSection, botTaskAnswerDraft, taskListRetryDelay } from "./BotTaskSection";
import { BotEditorStore } from "@/state/store";
import { getDraft } from "@/lib/drafts";
import type { BotTask } from "../../../shared/bot-task-list";

let host: HTMLDivElement;
let root: Root;

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("bot task list against an older server", () => {
  it("says the list comes with the server update on the older server's 404", async () => {
    vi.stubGlobal("fetch", answer(404, { error: "no route: GET /api/bots/bot-1/task-list" }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-tasks-needs-update]")?.textContent).toBe("Available after the server update.");
    expect(host.textContent).not.toContain("The task list could not be loaded.");
    expect(host.querySelector(".text-danger")).toBeNull();
  });

  it("says the same for a member's session the older server refuses on the admin scope", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "forbidden: this session lacks the admin scope" }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-tasks-needs-update]")).not.toBeNull();
    expect(host.querySelector(".text-danger")).toBeNull();
  });

  it("shows an empty list on the current server as nothing at all", async () => {
    vi.stubGlobal("fetch", answer(200, { tasks: [] }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-settings-section]")).toBeNull();
    expect(host.textContent).toBe("");
    expect(host.querySelector(".text-danger")).toBeNull();
  });
});

// JC 2026-10-28: "if it cannot be loaded, do not show it." A list that cannot
// be read hides the section like an empty list, with no red line; the cause
// goes to the console; the section comes back when a read works.
describe("bot task list that cannot be loaded", () => {
  const failures: Array<[string, () => ReturnType<typeof vi.fn>]> = [
    ["a 5xx", () => answer(500, { error: "boom" })],
    ["a 502 from the proxy while the server restarts", () => answer(502, {})],
    ["a 403 that is not the older server", () => answer(403, { error: "forbidden" })],
    ["a network error", () => vi.fn(async () => { throw new TypeError("Failed to fetch"); })],
    ["an answer that is not a list", () => answer(200, { tasks: "nope" })],
  ];
  const waiting: BotTask = { id: "task_waiting01", botId: "bot-1", title: "Pick a meeting time", state: "waiting", createdAt: 1, updatedAt: 2 };
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  for (const [label, make] of failures) {
    it(`does not render the section on ${label}, and notes the error in the console`, async () => {
      vi.stubGlobal("fetch", make());
      await mount(createElement(BotTaskSection, { botId: "bot-1" }));
      expect(host.querySelector("[data-bot-settings-section]")).toBeNull();
      expect(host.textContent).toBe("");
      expect(host.querySelector(".text-danger")).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });
  }

  it("does not render the section on a 404 no such bot either", async () => {
    vi.stubGlobal("fetch", answer(404, { error: "no such bot", code: "not_found" }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-settings-section]")).toBeNull();
  });

  it("comes back by itself after a failure when a read works (live event, window focus)", async () => {
    let ok = false;
    vi.stubGlobal("fetch", vi.fn(async () => ok
      ? new Response(JSON.stringify({ tasks: [waiting] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } })));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-settings-section]")).toBeNull();

    ok = true;
    act(() => { window.dispatchEvent(new CustomEvent(BOT_TASKS_EVENT, { detail: { botId: "bot-1" } })); });
    await settle();
    expect(host.querySelector('[data-bot-task="waiting"]')?.textContent).toContain("Pick a meeting time");
  });

  it("reads again by itself with a backoff, with no event at all", async () => {
    vi.useFakeTimers();
    try {
      let ok = false;
      vi.stubGlobal("fetch", vi.fn(async () => ok
        ? new Response(JSON.stringify({ tasks: [waiting] }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("bad gateway", { status: 502 })));
      await act(async () => { root.render(createElement(BotTaskSection, { botId: "bot-1" })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(host.querySelector("[data-bot-settings-section]")).toBeNull();
      ok = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(taskListRetryDelay(0) + 10); });
      expect(host.querySelector('[data-bot-task="waiting"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last known list while a later read fails, then shows the new one", async () => {
    const next: BotTask = { ...waiting, id: "task_waiting02", title: "Renew the licence" };
    let mode: "ok" | "fail" | "ok2" = "ok";
    vi.stubGlobal("fetch", vi.fn(async () => mode === "fail"
      ? new Response(JSON.stringify({ error: "boom" }), { status: 503, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ tasks: [mode === "ok" ? waiting : next] }), { status: 200, headers: { "content-type": "application/json" } })));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector('[data-bot-task="waiting"]')?.textContent).toContain("Pick a meeting time");

    mode = "fail";
    act(() => { window.dispatchEvent(new CustomEvent(BOT_TASKS_EVENT, { detail: { botId: "bot-1" } })); });
    await settle();
    expect(console.warn).toHaveBeenCalled();
    expect(host.querySelector('[data-bot-task="waiting"]')?.textContent).toContain("Pick a meeting time");
    expect(host.querySelector(".text-danger")).toBeNull();

    mode = "ok2";
    act(() => { window.dispatchEvent(new CustomEvent(BOT_TASKS_EVENT, { detail: { botId: "bot-1" } })); });
    await settle();
    expect(host.querySelector('[data-bot-task="waiting"]')?.textContent).toContain("Renew the licence");
  });

  it("backs off: 2 s, doubling, never past 60 s", () => {
    expect([0, 1, 2, 3, 10].map(taskListRetryDelay)).toEqual([2_000, 4_000, 8_000, 16_000, 60_000]);
  });
});

describe("background brief against an older server", () => {
  it("says the brief comes with the server update, with no error line", async () => {
    vi.stubGlobal("fetch", answer(404, { error: "no route: GET /api/bots/bot-1/background-brief" }));
    await mount(createElement(BackgroundBriefCard, { botId: "bot-1" }));
    expect(host.querySelector("[data-brief-needs-update]")?.textContent).toBe("Available after the server update.");
    expect(host.querySelector("[role=alert]")).toBeNull();
  });
});

// Regression: the bot added tasks with its tool, read them back on the
// server, and the open panel still said "No tasks." It read the list once,
// when it opened, and nothing told it the list had changed.
describe("bot task list stays live", () => {
  it("shows a task the bot adds with its tool, without reopening the panel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-tasks-dom-"));
    try {
      // the server's store, with its frame relayed the way src/state/store.tsx does
      const frames: BotTasksFrame[] = [];
      const store = createBotTaskStore({
        file: join(dir, "bot-tasks.json"),
        onChange: (frame) => {
          frames.push(frame);
          window.dispatchEvent(new CustomEvent(BOT_TASKS_EVENT, { detail: { botId: frame.botId } }));
        },
      });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tasks: store.list("bot-1") }), { status: 200, headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", fetchMock);
      await mount(createElement(BotTaskSection, { botId: "bot-1" }));
      expect(host.querySelector("[data-bot-settings-section]")).toBeNull();

      // the bot's task_list tool: add one doing, one waiting, and finish a third
      const internal = createBotTaskInternalRoutes({ tasks: () => store, ownsThread: () => true, speaker: () => "pr_a" });
      const call = async (body: Record<string, unknown>) => {
        let answer: unknown;
        await internal({
          res: {} as never, path: "/api/internal/task-list", method: "POST",
          json: ((_res: unknown, _status: number, value: unknown) => { answer = value; }) as never,
          readBody: async () => body,
          capability: { botId: "bot-1", threadId: "t-1", generation: "g" },
        });
        return answer as { task: { id: string } };
      };
      await act(async () => {
        await call({ action: "add", title: "Draft the summary" });
        await call({ action: "add", title: "Pick a meeting time", state: "waiting" });
        const third = await call({ action: "add", title: "Renew the domain" });
        await call({ action: "complete", task_id: third.task.id });
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(frames.every((frame) => frame.kind === "bot.tasks" && frame.botId === "bot-1" && frame.audience === "pr_a")).toBe(true);
      expect(host.querySelector("[data-bot-settings-section]")).not.toBeNull();
      // one list: what waits for the person first, then in progress; the task done at once is not listed
      const order = Array.from(host.querySelectorAll("[data-bot-task]")).map((node) => node.getAttribute("data-bot-task"));
      expect(order).toEqual(["waiting", "doing"]);
      expect(host.querySelector('[data-bot-task="waiting"]')?.textContent).toContain("Pick a meeting time");
      expect(host.querySelector('[data-bot-task="doing"]')?.textContent).toContain("Draft the summary");
      expect(host.textContent).not.toContain("Renew the domain");
      expect(host.querySelector("[data-bot-task-group]")).toBeNull();
      expect(host.querySelector("[data-bot-tasks-done-toggle]")).toBeNull();
      // the panel read again on each change, never remounted
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// JC: "I cannot even interact with the task." A task opens in place, its
// menu moves or removes it, Answer opens the conversation with the task
// named in the composer, and all of it works from the keyboard.
describe("bot task interaction", () => {
  const H = 3_600_000;
  const now = Date.now();
  const tasks: BotTask[] = [
    { id: "task_waiting01", botId: "bot-1", threadId: "t-7", title: "Choose between the two meeting times for Thursday afternoon", state: "waiting", note: "Both rooms are free.\nThe second one has a screen.", history: [{ state: "doing", at: now - 3 * H, by: "bot" }, { state: "waiting", at: now - H, by: "bot" }], createdAt: now - 3 * H, updatedAt: now - H },
    { id: "task_doing0001", botId: "bot-1", title: "Draft the weekly summary", state: "doing", createdAt: now - 2 * H, updatedAt: now - 2 * H },
    { id: "task_done00001", botId: "bot-1", title: "Demo task: tasks panel works", state: "done", createdAt: now - 5 * H, updatedAt: now - 4 * H },
  ];
  function serve() {
    const calls: Array<{ method: string; path: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://x").pathname;
      calls.push({ method: init?.method ?? "GET", path });
      const body = path.endsWith("/task-list") ? { tasks } : { task: tasks[0] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    return calls;
  }
  const press = (target: Element, key: string, extra: KeyboardEventInit = {}) =>
    act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra })); });

  it("lists Needs you then In progress in one list, with no group, no count and no intro", async () => {
    serve();
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(Array.from(host.querySelectorAll("[data-bot-task]")).map((node) => node.getAttribute("data-bot-task"))).toEqual(["waiting", "doing"]);
    expect(host.querySelector('[data-bot-task="waiting"]')?.textContent).toContain("Choose between");
    expect(host.querySelector('[data-bot-task="doing"]')?.textContent).toContain("Draft the weekly summary");
    // a task already done is not shown, and there is no Done group, toggle or counter
    expect(host.textContent).not.toContain("Demo task");
    expect(host.querySelector("[data-bot-task-group]")).toBeNull();
    expect(host.querySelector("[data-bot-tasks-done-toggle]")).toBeNull();
    expect(host.querySelector("h3")).toBeNull();
    expect(host.textContent).not.toContain("What this bot is doing for you");
    expect(host.textContent).not.toMatch(/Needs you\d|In progress\d|Done\d/);
    expect(host.querySelector("h2")?.textContent).toBe("Tasks");
    // Needs you stands out: the accent tint on the row
    expect(host.querySelector('[data-bot-task="waiting"]')?.className).toContain("bg-accent");
    expect(host.querySelector('[data-bot-task="doing"]')?.className).not.toContain("bg-accent");
    // the full title stays readable: two lines and a tooltip
    const title = host.querySelector('[data-bot-task="waiting"] [title]');
    expect(title?.getAttribute("title")).toBe(tasks[0]!.title);
    expect(title?.className).toContain("line-clamp-2");
  });

  it("shows a green check on the task that moves to Done, then folds the row away", async () => {
    const live: BotTask[] = tasks.map((task) => ({ ...task }));
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://x").pathname;
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (init?.method === "POST") live.find((task) => path.includes(task.id))!.state = "done";
      return new Response(JSON.stringify(path.endsWith("/task-list") ? { tasks: live } : { task: live[0] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector('[data-bot-task-open="task_doing0001"]')).not.toBeNull();
    vi.useFakeTimers();
    try {
      await act(async () => { (host.querySelector('[data-bot-task-menu="task_doing0001"]') as HTMLButtonElement).click(); });
      await act(async () => { (document.querySelector('[data-bot-task-menu-open="task_doing0001"] [data-bot-task-action="complete"]') as HTMLButtonElement).click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(calls).toContain("POST /api/bots/bot-1/task-list/task_doing0001/complete");
      // the row is still there, with the green check in place of its icon
      const row = () => host.querySelector('[data-bot-task-open="task_doing0001"]')?.closest("li");
      expect(row()?.getAttribute("data-bot-task")).toBe("done");
      expect(row()?.getAttribute("data-bot-task-finishing")).toBe("check");
      expect(row()?.querySelector("[data-bot-task-check]")).not.toBeNull();
      expect(row()?.className).toContain("grid-rows-[1fr]");
      // after about 2.5 s it fades and folds its height
      await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
      expect(row()?.getAttribute("data-bot-task-finishing")).toBe("fold");
      expect(row()?.className).toContain("grid-rows-[0fr]");
      // then it is gone, with no Done group and no counter; the other rows stay
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(row() ?? null).toBeNull();
      expect(host.querySelector('[data-bot-task-open="task_waiting01"]')).not.toBeNull();
      expect(host.querySelector("[data-bot-task-group]")).toBeNull();
      expect(host.querySelector("[data-bot-tasks-done-toggle]")).toBeNull();
      expect(host.textContent).not.toContain("Draft the weekly summary");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the whole section, title included, when nothing is in progress", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tasks: [tasks[2]] }), { status: 200, headers: { "content-type": "application/json" } })));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-settings-section]")).toBeNull();
    expect(host.querySelector("[data-bot-task]")).toBeNull();
    expect(host.querySelector("h2")).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("opens a task in place with its note and history, and Escape gives the focus back", async () => {
    serve();
    await mount(createElement("div", { className: "relative" }, createElement(BotTaskSection, { botId: "bot-1" })));
    const row = host.querySelector('[data-bot-task-open="task_waiting01"]') as HTMLButtonElement;
    await act(async () => { row.click(); });
    const detail = host.querySelector('[data-bot-task-detail="task_waiting01"]')!;
    expect(detail.textContent).toContain(tasks[0]!.title);
    expect(detail.querySelector("[data-bot-task-note]")?.textContent).toBe("Both rooms are free.\nThe second one has a screen.");
    expect(Array.from(detail.querySelectorAll("[data-bot-task-history] li")).map((item) => item.textContent?.split(" · ")[0])).toEqual(["Needs you", "In progress"]);
    await press(detail, "Escape");
    expect(host.querySelector("[data-bot-task-detail]")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-bot-task-open="task_waiting01"]'));
  });

  it("moves and removes a task from its menu, opened with the keyboard", async () => {
    const calls = serve();
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    const row = host.querySelector('[data-bot-task-open="task_waiting01"]') as HTMLButtonElement;
    row.focus();
    await press(row, "F10", { shiftKey: true });
    const menu = document.querySelector('[data-bot-task-menu-open="task_waiting01"]')!;
    const items = Array.from(menu.querySelectorAll("[data-bot-task-action]")).map((item) => item.getAttribute("data-bot-task-action"));
    expect(items).toEqual(["open", "complete", "resume", "remove"]);
    expect(document.activeElement?.getAttribute("data-bot-task-action")).toBe("open");
    await press(menu, "ArrowDown");
    expect(document.activeElement?.getAttribute("data-bot-task-action")).toBe("complete");
    await act(async () => { (document.activeElement as HTMLButtonElement).click(); });
    expect(calls).toContainEqual({ method: "POST", path: "/api/bots/bot-1/task-list/task_waiting01/complete" });

    await act(async () => { (host.querySelector('[data-bot-task-menu="task_doing0001"]') as HTMLButtonElement).click(); });
    await act(async () => { (document.querySelector('[data-bot-task-menu-open="task_doing0001"] [data-bot-task-action="remove"]') as HTMLButtonElement).click(); });
    expect(calls).toContainEqual({ method: "DELETE", path: "/api/bots/bot-1/task-list/task_doing0001" });
  });

  it("Answer opens the conversation of the task with the task named in the composer", async () => {
    serve();
    const dispatch = vi.fn();
    const bot = { id: "bot-1", threadId: "t-main", name: "Bot", messages: [] };
    const value = { state: { bots: [bot] }, dispatch } as never;
    await mount(createElement(BotEditorStore, { value, children: createElement(BotTaskSection, { botId: "bot-1" }) }));
    await act(async () => { (host.querySelector('[data-bot-task="waiting"] [data-bot-task-answer]') as HTMLButtonElement).click(); });
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "bot-1", threadId: "t-7" });
    expect(getDraft(localStorage, "bot:bot-1:t-7")).toBe(botTaskAnswerDraft(tasks[0]!));
    expect(botTaskAnswerDraft(tasks[0]!)).toBe(`About the task \u201c${tasks[0]!.title}\u201d: `);
  });
});
