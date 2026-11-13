// @vitest-environment happy-dom
// #4171 (the owner, 2026-11-13, on a routine run's window: "it does not
// respect the setting: the tool call is off, we should not see the tool
// calls... here as much as elsewhere"). Settings > Tool calls is one rule
// (activityRowShown) read where the main chat reads it (showToolCallRows),
// and every window drawn over the chat follows it: a routine run, a
// bot-to-bot exchange, a teammate's request, a text message's request, a
// coding task. On: the steps show. Off: no step; the bot's words stay, and
// so does a failure the person must know about, as in the chat.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, initialState, type AppState, type Bot, type Message, type useStore } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { exchangeSheetRow, type ExchangeRun } from "@/lib/bot-exchange";
import { roomActivityVisible } from "@/lib/room-activity";
import { activityRowShown } from "@/lib/tool-activity-rows";
import type { BotActivityDetail, BotActivityItem } from "../../shared/bot-activity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const side = vi.hoisted(() => ({ messages: [] as Message[] }));
vi.mock("@/lib/use-side-transcript", () => ({
  useSideTranscript: () => ({ messages: side.messages, failed: false, activeLeafId: null, loaded: true, hasMore: false, loadingOlder: false, loadOlder: () => {} }),
}));
const runDetail = vi.hoisted(() => ({ steps: [] as { name: string; ok?: boolean; at: number }[] }));
vi.mock("@/components/routines/RunActivityState", () => ({
  RunActivityState: ({ children }: { children: (activity: unknown) => ReactNode }) =>
    children({ detail: { steps: runDetail.steps }, error: false, reload: async () => {}, waiting: [] }),
}));
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));

const { ExchangeSheet } = await import("./BotExchangeChip");
const { RoutineRunWindow } = await import("./routines/RoutineRunWindow");
const { default: TeammateExchangeSheet } = await import("./TeammateExchangeSheet");
const { IncomingLine } = await import("./HandoffRow");
const { CodingChatSheet } = await import("./coding/CodingChat");

beforeAll(() => setLocale("en"));

const AT = Date.UTC(2026, 10, 13, 14, 0);
const nova = { botId: "nova", name: "Nova" };
const pixel = { botId: "pixel", name: "Pixel" };
const bots = [
  { id: "nova", name: "Nova", color: "blue", threadId: "nova-main", messages: [], tasks: [] },
  { id: "pixel", name: "Pixel", color: "orange", threadId: "pixel-main", messages: [], tasks: [] },
] as unknown as Bot[];

const text = (id: string, from: typeof nova, words: string, role: "bot" | "user" = "bot"): Message =>
  ({ id, role, kind: "text", text: words, at: AT, from }) as Message;
const step = (id: string, name: string, input: Record<string, unknown>, ok = true): Message =>
  ({ id, role: "bot", kind: "activity", text: "", at: AT, from: pixel, tool: { name, ok, input: JSON.stringify(input) } }) as Message;

/** A transcript with the owner's rows: a command, a tool search, a hand-off
 * to a teammate that failed, then the bot's words. */
const transcript = (): Message[] => [
  text("ask", nova, "Which weekly reports are missing?", "user"),
  step("s1", "Bash", { command: "ls reports" }),
  step("s2", "ToolSearch", { query: "shared folder" }),
  step("s3", "ask_bot", { bot: "Atlas", message: "Who owns it?" }, false),
  text("answer", pixel, "Support is the only one missing."),
];

function storeWith(showToolCalls: boolean, extra: Partial<AppState> = {}) {
  return {
    state: { ...initialState, bots, config: { features: { showToolCalls } } as AppState["config"], ...extra },
    dispatch: () => {},
    flushBotPatches: () => {},
    refreshInstances: async () => {},
    refreshModels: async () => {},
  } as unknown as ReturnType<typeof useStore>;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  side.messages = [];
  runDetail.steps = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function draw(showToolCalls: boolean, node: ReactNode, extra: Partial<AppState> = {}) {
  await act(async () => { root.render(createElement(BotEditorStore, { value: storeWith(showToolCalls, extra), children: node })); });
  for (let i = 0; i < 30 && !document.querySelector("[role=dialog], [data-coding-chat], [data-testid=coding-chat]"); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  await act(async () => { await Promise.resolve(); });
}

const toolRows = () => document.querySelectorAll('[data-testid="tool-activity"]').length;
const words = () => document.body.textContent ?? "";

describe("Settings > Tool calls in every window over the chat (#4171)", () => {
  it("one rule: off keeps a failed hand-off, drops plain steps; on keeps every step", () => {
    const [, bash, search, failed] = transcript();
    expect(exchangeSheetRow(bash!, false, false)).toBeNull();
    expect(exchangeSheetRow(search!, false, false)).toBeNull();
    expect(exchangeSheetRow(failed!, false, false)).toBe("tool");
    expect(exchangeSheetRow(bash!, true, false)).toBe("tool");
    const question = { ...bash!, inputRequest: { id: "q" } } as unknown as Message;
    expect(exchangeSheetRow(question, false, false)).toBe("tool");
  });

  const run: ExchangeRun = { id: "exchange:ask", messages: transcript(), party: { id: "pixel", name: "Pixel" }, ends: [{ id: "nova", name: "Nova" }, { id: "pixel", name: "Pixel" }] };

  it.each([true, false])("a bot-to-bot exchange follows the setting (%s)", async (on) => {
    await draw(on, createElement(ExchangeSheet, { run, bots, onClose: () => {} }));
    expect(words()).toContain("Support is the only one missing.");
    expect(toolRows()).toBe(on ? 3 : 1);
  });

  it.each([true, false])("a routine run's window follows the setting (%s)", async (on) => {
    runDetail.steps = [{ name: "Bash", ok: true, at: AT }, { name: "ToolSearch", ok: true, at: AT }];
    const routineRun = { id: "run-1", botId: "pixel", routineId: "r-1", routineName: "Weekly reports", status: "completed", target: "bot", scheduledFor: AT, output: "All reports are in." };
    await draw(on, createElement(RoutineRunWindow, { target: { runId: "run-1" }, bots, onClose: () => {}, onStop: () => {} }), {
      routineRuns: [routineRun] as unknown as AppState["routineRuns"],
      routines: [{ id: "r-1", name: "Weekly reports", bot: { id: "pixel", name: "Pixel" } }] as unknown as AppState["routines"],
    });
    expect(document.querySelector('[data-testid="routine-run-window"]')).not.toBeNull();
    expect(words()).toContain("All reports are in.");
    expect(toolRows()).toBe(on ? 2 : 0);
  });

  it.each([true, false])("a teammate's request window follows the setting (%s)", async (on) => {
    side.messages = transcript();
    await draw(on, createElement(TeammateExchangeSheet, { owner: { id: "nova", name: "Nova", color: "blue" }, teammate: { id: "pixel", name: "Pixel" }, threadId: "t-1", bots, onClose: () => {} }));
    expect(words()).toContain("Support is the only one missing.");
    expect(toolRows()).toBe(on ? 3 : 1);
  });

  it.each([true, false])("a text message's request window follows the setting (%s)", async (on) => {
    side.messages = transcript();
    const entry = { verb: "askedBy", key: "phone:sms:555 010-0142", name: "555 010-0142", phone: "sms", request: "Which reports?", threadId: "t-2", message: { id: "l1", role: "bot", kind: "text", at: AT, text: "" } };
    await draw(on, createElement(IncomingLine, { line: { verb: "askedBy", entries: [entry] } as never, self: { id: "pixel", name: "Pixel", color: "orange" }, bots }));
    await act(async () => { (document.querySelector('[data-testid="incoming-line-recipient"]') as HTMLButtonElement).click(); });
    for (let i = 0; i < 30 && !document.querySelector("[role=dialog]"); i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    expect(words()).toContain("Support is the only one missing.");
    expect(toolRows()).toBe(on ? 3 : 1);
  });

  // a group chat draws its steps through the room's gate (Transcript.tsx and
  // RoomMessageItem.tsx), which is the chat's rule plus room layout only
  it.each([true, false])("a group chat follows the setting (%s)", (on) => {
    const rows = transcript().filter((message) => message.kind === "activity");
    const shown = rows.filter((message) => roomActivityVisible(message, on, false));
    expect(shown.map((message) => message.id)).toEqual(on ? ["s1", "s2", "s3"] : ["s3"]);
    for (const message of rows) expect(roomActivityVisible(message, on, false)).toBe(activityRowShown(message, on, false));
    // a plain failed step goes too with the setting off, as in the chat
    const failedStep = step("s4", "Bash", { command: "ls" }, false);
    expect(roomActivityVisible(failedStep, on, false)).toBe(on);
  });

  it.each([true, false])("a coding task's chat follows the setting (%s)", async (on) => {
    const item = { id: "thread:c-1", kind: "session", botId: "pixel", botName: "Pixel", title: "Fix the report", status: "completed", startedAt: AT - 60_000, endedAt: AT, updatedAt: AT, threadId: "c-1", coding: true } as unknown as BotActivityItem;
    const detail = { ...item, steps: [], stepsTruncated: false, files: [], children: [] } as BotActivityDetail;
    const coding = [
      text("c-ask", nova, "Fix the report", "user"),
      step("c1", "Bash", { command: "pnpm test" }),
      step("c2", "Read", { file_path: "/srv/report.ts" }),
      text("c-done", pixel, "The report is fixed."),
    ];
    await draw(on, createElement(CodingChatSheet, { item, detail, messages: coding, loaded: true, failed: false, now: AT, bot: bots[1], bots, onClose: () => {} }));
    expect(words()).toContain("The report is fixed.");
    expect(document.querySelectorAll("[data-coding-row]").length).toBe(on ? 2 : 0);
  });
});
