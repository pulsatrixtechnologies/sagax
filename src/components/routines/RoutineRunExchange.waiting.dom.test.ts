// @vitest-environment happy-dom
// 2026-11-04 (a person: approval cards of a routine run only on the phone,
// none on the desktop). The run opens as an exchange sheet: what the run
// waits on is pinned in it, answerable there (the same card and answer as
// the conversation), for an approval while the turn holds the run running
// and for a question that leaves the run waiting.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { setExchangeColumnHost } from "@/lib/exchange-column-host";

const dispatch = vi.fn();
const threadMessages = new Map<string, Message[]>();
const fetched: string[] = [];

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async (path: string) => {
      fetched.push(path);
      const match = /^\/api\/threads\/([^/]+)\/messages/.exec(path);
      if (match) return { messages: threadMessages.get(decodeURIComponent(match[1]!)) ?? [] };
      return {};
    }),
    useStore: () => ({
      state: { ...original.initialState, bots: [bot], routines: [routine], routineRuns: [], groups: [], config: { viewer: { principalId: "person-1" } } },
      dispatch,
    }),
  };
});

vi.mock("@/lib/bot-activity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/bot-activity")>(),
  // the activity entry does not say the run waits yet (the turn holds it)
  loadBotActivityDetail: vi.fn(async () => ({
    id: "run:run-w", kind: "routine", botId: "scout", title: "Morning sweep", status: "running",
    startedAt: NOW - 60_000, updatedAt: NOW, threadId: "run-thread", steps: [], stepsTruncated: false, files: [], children: [], canStop: true,
  })),
}));

const { setLocale } = await import("@/lib/i18n");
const { RoutineRunExchange } = await import("./RoutineRunExchange");
const { ExchangeColumnProvider } = await import("../BotExchangeChip");

const NOW = Date.UTC(2026, 10, 4, 14, 0);
const bot = { id: "scout", threadId: "main", name: "Scout", color: "blue", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const routine = {
  id: "r1", botId: "scout", name: "Morning sweep", prompt: "Sweep the board.", target: "bot", runOn: "maus", durationMinutes: 30, enabled: true,
  canEdit: true, canRun: true, createdAt: 1, updatedAt: 1, schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
} as Routine;
const liveRun = (status: RoutineRun["status"]) => ({
  id: "run-w", routineId: "r1", routineName: "Morning sweep", botId: "scout", target: "bot", runOn: "maus", threadId: "run-thread",
  runAs: "person-1", scheduledFor: NOW - 60_000, createdAt: NOW - 60_000, startedAt: NOW - 60_000, status, manual: true,
} as RoutineRun);
const permissionCard = {
  id: "m-perm", role: "bot", kind: "options", at: NOW - 1_000,
  card: { requestId: "req-perm", requestType: "permission", tool: "WebFetch", title: "Approval needed", subtitle: "https://example.com/report", options: ["Allow", "Deny"] },
} as unknown as Message;
const questionCard = {
  id: "m-q", role: "bot", kind: "options", at: NOW - 1_000,
  card: { requestId: "ask-choice-1", requestType: "question", title: "Your bot has a question", subtitle: "Which batch do I write?", options: ["Batch A", "Batch B"],
    questionRequest: { questions: [{ question: "Which batch do I write?", options: [{ label: "Batch A" }, { label: "Batch B" }] }] } },
} as unknown as Message;

let host: HTMLDivElement;
let column: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  // the approval box's own side reads (rules, keys) never leave the test
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  dispatch.mockClear();
  threadMessages.clear();
  fetched.length = 0;
  host = document.createElement("div");
  column = document.createElement("div");
  column.style.position = "relative";
  host.append(column);
  document.body.append(host);
  setExchangeColumnHost(column);
  root = createRoot(host);
});

afterEach(() => {
  vi.unstubAllGlobals();
  flushSync(() => root.unmount());
  setExchangeColumnHost(null);
  host.remove();
});

function mount(run: RoutineRun) {
  flushSync(() => root.render(createElement(ExchangeColumnProvider, {
    node: column,
    children: createElement(RoutineRunExchange, { run, routine, bots: [bot], onClose: vi.fn(), onStop: vi.fn() }),
  })));
}

describe("a routine run's sheet shows what it waits on", () => {
  it("pins the run's open approval above the footer while its turn holds the run running, and Allow answers it in the run's thread", async () => {
    threadMessages.set("run-thread", [permissionCard]);
    mount(liveRun("running"));
    const pinned = await vi.waitFor(() => {
      const found = column.querySelector<HTMLElement>("[data-exchange-pinned] [data-run-waiting] [data-task-waiting-approvals]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(fetched).toContain("/api/threads/run-thread/messages?limit=60");
    const sheet = column.querySelector("[data-testid=routine-run-exchange]")!;
    // pinned between the transcript and the footer, never inside the scroll
    expect(sheet.querySelector("[data-testid=bot-exchange-scroll] [data-run-waiting]")).toBeNull();
    const allow = [...pinned.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Allow once");
    expect(allow, pinned.textContent ?? "").toBeDefined();
    flushSync(() => allow!.click());
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "run-thread", requestId: "req-perm", behavior: "allow" })));
  });

  it("shows a waiting run's question card, answerable in place", async () => {
    threadMessages.set("run-thread", [questionCard]);
    mount(liveRun("waiting"));
    const item = await vi.waitFor(() => {
      const found = column.querySelector<HTMLElement>("[data-run-waiting] [data-task-waiting-item=question]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(item.textContent).toContain("Which batch do I write?");
    expect(item.textContent).toContain("Batch A");
  });

  it("pins nothing for a finished run, and reads no thread for it", async () => {
    threadMessages.set("run-thread", [permissionCard]);
    mount({ ...liveRun("completed"), finishedAt: NOW } as RoutineRun);
    await vi.waitFor(() => expect(column.querySelector("[data-testid=routine-run-exchange]")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(column.querySelector("[data-exchange-pinned]")).toBeNull();
    expect(fetched.some((path) => path.startsWith("/api/threads/"))).toBe(false);
  });
});
