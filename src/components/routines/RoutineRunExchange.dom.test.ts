// @vitest-environment happy-dom
// Routine run exchange (2026-11-01): opens like Melonie <-> Katarina, Escape
// closes, footer keeps Run again / Continue / logs / configuration.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { setExchangeColumnHost } from "@/lib/exchange-column-host";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async () => ({})),
    useStore: () => ({
      state: {
        ...original.initialState,
        bots: [bot],
        routines: [routine],
        routineRuns: [run],
        groups: [],
        config: { viewer: { principalId: "person-1" } },
      },
      dispatch: vi.fn(),
    }),
  };
});

vi.mock("@/lib/bot-activity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/bot-activity")>(),
  loadBotActivityDetail: vi.fn(async () => ({
    id: "run:run-1", kind: "routine", botId: "atlas", title: "Morning brief", status: "finished",
    startedAt: run.startedAt, endedAt: run.finishedAt, updatedAt: run.finishedAt,
    steps: [{ id: "s1", name: "read_mail", ok: true, at: run.startedAt, summary: "Inbox checked" }],
    stepsTruncated: false, files: [], children: [], canStop: false,
  })),
}));

const { setLocale } = await import("@/lib/i18n");
const { RoutineRunExchange } = await import("./RoutineRunExchange");
const { ExchangeColumnProvider } = await import("../BotExchangeChip");

const bot = { id: "atlas", threadId: "main", name: "Atlas", color: "blue", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const routine = {
  id: "r1", botId: "atlas", name: "Morning brief", prompt: "Summarise overnight alerts.",
  target: "bot", runOn: "maus", durationMinutes: 30, enabled: true, canEdit: true, canRun: true, createdAt: 1, updatedAt: 1,
  schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" }, postResults: true,
} as Routine;
const run = {
  id: "run-1", routineId: "r1", routineName: "Morning brief", botId: "atlas", target: "bot",
  runOn: "maus", scheduledFor: Date.UTC(2026, 10, 1, 14, 0), createdAt: Date.UTC(2026, 10, 1, 14, 0),
  startedAt: Date.UTC(2026, 10, 1, 14, 0), finishedAt: Date.UTC(2026, 10, 1, 14, 2),
  status: "completed", manual: false, output: "Two alerts, both cleared.", cost: 0.02,
} as RoutineRun;

let host: HTMLDivElement;
let column: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  column = document.createElement("div");
  column.style.position = "relative";
  host.append(column);
  document.body.append(host);
  setExchangeColumnHost(column);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  setExchangeColumnHost(null);
  host.remove();
});

function mountExchange(props: { run?: RoutineRun; onClose?: () => void; onRunAgain?: () => void; onLogs?: () => void }) {
  const onClose = props.onClose ?? vi.fn();
  flushSync(() => root.render(createElement(ExchangeColumnProvider, {
    node: column,
    children: createElement(RoutineRunExchange, {
      run: props.run ?? run,
      routine,
      bots: [bot],
      onClose,
      ...(props.onRunAgain ? { onRunAgain: props.onRunAgain } : {}),
      ...(props.onLogs ? { onLogs: props.onLogs } : {}),
    }),
  })));
  return onClose;
}

describe("RoutineRunExchange", () => {
  it("portals into the exchange column with routine <-> bot header and Close Chat", async () => {
    mountExchange({ onClose: vi.fn(), onRunAgain: vi.fn(), onLogs: vi.fn() });
    await vi.waitFor(() => expect(column.querySelector("[data-testid=routine-run-exchange]")).not.toBeNull());
    const sheet = column.querySelector("[data-testid=routine-run-exchange]")!;
    expect(sheet.textContent).toContain("Morning brief");
    expect(sheet.textContent).toContain("Atlas");
    expect(sheet.querySelector("[data-routine-run-meta]")?.textContent).toMatch(/Completed/);
    expect(sheet.querySelector("[data-testid=bot-exchange-close]")?.textContent).toBe("Close Chat");
    expect(document.body.innerHTML).not.toMatch(/run-1|r1\b/);
  });

  it("Escape closes and restores focus intent via onClose", async () => {
    const onClose = mountExchange({});
    await vi.waitFor(() => expect(column.querySelector("[data-testid=routine-run-exchange]")).not.toBeNull());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it("exposes Run again, Continue, and a configuration menu", async () => {
    mountExchange({ onRunAgain: vi.fn(), onLogs: vi.fn() });
    await vi.waitFor(() => expect(column.querySelector("[data-run-again]")).not.toBeNull());
    expect(column.querySelector("[data-run-continue]")).not.toBeNull();
    flushSync(() => column.querySelector<HTMLButtonElement>("[data-run-more]")!.click());
    expect(column.querySelector("[data-run-logs]")).not.toBeNull();
    expect(column.querySelector("[data-run-configuration]")).not.toBeNull();
  });
});
