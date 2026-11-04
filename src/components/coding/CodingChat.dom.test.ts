// @vitest-environment happy-dom
// The coding chat (2026-11-03): a coding task over the chat column, drawn for
// development. Its terminal and diff blocks render, the Changes band sums the
// edits, Continue sends a follow-up to the task's thread, Stop shows while it
// runs, and no server path or id reaches the screen.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import type { BotActivityDetail, BotActivityItem } from "../../../shared/bot-activity";
import { setExchangeColumnHost } from "@/lib/exchange-column-host";

const apiMock = vi.fn();
const dispatchMock = vi.fn();
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: (...args: unknown[]) => apiMock(...args),
    useStore: () => ({ state: { ...original.initialState, bots: [bot], groups: [], config: { viewer: { principalId: "person-1" } } }, dispatch: dispatchMock }),
  };
});
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));

const { setLocale } = await import("@/lib/i18n");
const { CodingChat, CodingChatSheet } = await import("./CodingChat");

const ROOT = "/workspace/bots/wren/dispatch-board";
const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const NOW = Date.UTC(2026, 10, 3, 15, 0);
const bot = { id: "wren", threadId: "main", name: "Wren", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const messages: Message[] = [
  { id: "m1", role: "user", kind: "text", text: "Pour la colonne du board, garde l'ordre des cartes", at: NOW - 240_000 },
  { id: "m2", role: "bot", kind: "text", text: "I'll look at the column first.", at: NOW - 230_000, from: { botId: "wren", name: "Wren", color: "green" } },
  { id: "m3", role: "bot", kind: "activity", text: "", at: NOW - 220_000, tool: { name: "Read", input: pretty({ file_path: `${ROOT}/src/board/column.ts` }), ok: true } },
  { id: "m4", role: "bot", kind: "activity", text: "", at: NOW - 200_000, tool: { name: "Edit", input: pretty({ file_path: `${ROOT}/src/board/column.ts`, old_string: "cards.sort(byDate);\nreturn cards;", new_string: "cards.sort(byOrder);\nreturn cards;" }), ok: true } },
  { id: "m5", role: "bot", kind: "activity", text: "", at: NOW - 180_000, tool: { name: "Bash", input: pretty({ command: `cd ${ROOT} && pnpm vitest run src/board` }), output: `FAIL ${ROOT}/src/board/column.test.ts\n      Tests  1 failed | 11 passed (12)\nbot ${UUID}`, ok: false, durationMs: 4_200 } },
  { id: "m6", role: "bot", kind: "activity", text: "", at: NOW - 120_000, tool: { name: "Write", input: pretty({ file_path: `${ROOT}/src/board/order.ts`, content: "export const byOrder = (a, b) => a.order - b.order;\n" }), ok: true } },
];

const item = (status: BotActivityItem["status"]): BotActivityItem => ({
  id: "thread:th-1", kind: "session", botId: "wren", botName: "Wren", title: "Pour la colonne du board, garde l'ordre des cartes",
  status, startedAt: NOW - 250_000, ...(status === "running" ? {} : { endedAt: NOW - 60_000 }), updatedAt: NOW, threadId: "th-1", coding: true, canStop: status === "running",
  code: { folder: ROOT, branch: "feat/column-order", repo: "acme/board", pullRequests: [{ number: 41, url: "https://github.com/acme/board/pull/41", action: "opened", at: NOW }], branches: [], commits: [{ sha: "0badc0ffee12", pushed: true, at: NOW }] },
});
const detail = (status: BotActivityItem["status"]): BotActivityDetail => ({ ...item(status), steps: [], stepsTruncated: false, files: [], children: [], canStop: status === "running" });

let host: HTMLDivElement;
let column: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  apiMock.mockReset();
  dispatchMock.mockReset();
  host = document.createElement("div");
  column = document.createElement("div");
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

function mountSheet(status: BotActivityItem["status"], extra: Record<string, unknown> = {}) {
  const props = {
    item: item(status), detail: detail(status), messages, loaded: true, failed: false, now: NOW, bot, bots: [bot],
    onClose: vi.fn(), onStop: vi.fn(), onSend: vi.fn(async () => {}), ...extra,
  };
  flushSync(() => root.render(createElement(CodingChatSheet, props)));
  return props;
}

function typeInto(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CodingChatSheet", () => {
  it("opens over the chat column with the task's title, bot, folder, branch and live state", () => {
    mountSheet("running");
    const sheet = column.querySelector<HTMLElement>("[data-testid=coding-chat]")!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector("[data-coding-title]")?.textContent).toContain("Pour la colonne du board");
    expect(sheet.textContent).toContain("Wren");
    expect(sheet.querySelector("[data-coding-folder]")?.textContent).toBe("dispatch-board");
    expect(sheet.textContent).toContain("feat/column-order");
    expect(sheet.querySelector("[data-coding-state]")?.textContent).toMatch(/Running\s*·\s*4m/);
  });

  it("draws commands as terminal blocks and edits as diffs per file, with reads as chips", () => {
    mountSheet("running");
    const terminal = column.querySelector<HTMLElement>("[data-coding-terminal]")!;
    expect(terminal.dataset.codingTerminal).toBe("failed");
    expect(terminal.querySelector("[data-coding-command]")?.textContent).toBe("$ cd dispatch-board && pnpm vitest run src/board");
    // a failed command opens on its output, with the test counts in its head
    expect(terminal.querySelector("[data-coding-output]")?.textContent).toContain("FAIL src/board/column.test.ts");
    expect(terminal.querySelector("[data-coding-tests]")?.textContent).toMatch(/11 passed.*1 failed/);
    const diffs = [...column.querySelectorAll<HTMLElement>("[data-coding-diff]")];
    expect(diffs.map((diff) => diff.dataset.codingDiff)).toEqual(["src/board/column.ts", "src/board/order.ts"]);
    expect(diffs[0]!.querySelectorAll("[data-diff-line=del]")).toHaveLength(1);
    expect(diffs[0]!.querySelectorAll("[data-diff-line=add]")).toHaveLength(1);
    expect(diffs[0]!.querySelectorAll("[data-diff-line=ctx]")).toHaveLength(1);
    expect(diffs[1]!.querySelector("[data-coding-diff-status=added]")).not.toBeNull();
    // a diff folds and opens on its header
    const head = diffs[0]!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    flushSync(() => head.click());
    expect(diffs[0]!.querySelector("[data-coding-diff-body]")).toBeNull();
    expect(column.querySelector("[data-coding-file-chip]")?.textContent).toBe("column.ts");
  });

  it("sums the changes in the band, with the tests, branch, commit and pull request", () => {
    mountSheet("finished");
    const band = column.querySelector<HTMLElement>("[data-coding-changes]")!;
    expect(band.querySelector("[data-coding-changes-toggle]")?.textContent).toMatch(/2 files changed\s*\+2 -1/);
    expect(band.querySelector("[data-coding-tests]")).not.toBeNull();
    expect(band.querySelector("[data-coding-commit]")?.textContent).toBe("0badc0f");
    expect(band.querySelector("[data-coding-pull]")?.textContent).toBe("Pull request #41");
    flushSync(() => band.querySelector<HTMLButtonElement>("[data-coding-changes-toggle]")!.click());
    expect([...band.querySelectorAll<HTMLElement>("[data-coding-changed-file]")].map((row) => row.dataset.codingChangedFile)).toEqual(["src/board/column.ts", "src/board/order.ts"]);
  });

  it("shows Stop while live in the footer only (one place), and none once finished", () => {
    const props = mountSheet("running");
    const stop = column.querySelector<HTMLButtonElement>("[data-coding-stop]")!;
    expect(column.querySelector("[data-coding-stop-header]")).toBeNull();
    flushSync(() => stop.click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    mountSheet("finished");
    expect(column.querySelector("[data-coding-stop]")).toBeNull();
    expect(column.querySelector("[data-coding-stop-header]")).toBeNull();
    const footer = column.querySelector("[data-coding-actions]")!;
    expect(footer.lastElementChild?.textContent).toBe("Close Chat");
  });

  it("Continue opens an inline composer that sends the follow-up", async () => {
    const props = mountSheet("finished");
    flushSync(() => column.querySelector<HTMLButtonElement>("[data-coding-continue]")!.click());
    const field = column.querySelector<HTMLTextAreaElement>("[data-coding-followup] textarea")!;
    expect(field).not.toBeNull();
    typeInto(field, "Also add a test for the empty column");
    flushSync(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await vi.waitFor(() => expect(props.onSend).toHaveBeenCalledWith("Also add a test for the empty column"));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-followup]")).toBeNull());
  });

  it("shows no server path and no id", () => {
    mountSheet("running");
    const text = column.textContent ?? "";
    expect(text).not.toContain("/workspace");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toContain("th-1");
  });
});

describe("CodingChat", () => {
  it("reads the task's thread and sends a follow-up to it, joining the turn while it runs", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/activity/item")) return { item: detail("running") };
      if (url.startsWith("/api/threads/th-1/messages")) return { messages, hasMore: false };
      return {};
    });
    flushSync(() => root.render(createElement(CodingChat, { target: { botId: "wren", itemId: "thread:th-1", threadId: "th-1", seed: item("running") }, onClose: vi.fn() })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-terminal]")).not.toBeNull());
    flushSync(() => column.querySelector<HTMLButtonElement>("[data-coding-continue]")!.click());
    const field = column.querySelector<HTMLTextAreaElement>("[data-coding-followup] textarea")!;
    typeInto(field, "Keep the order stable for ties");
    flushSync(() => column.querySelector<HTMLButtonElement>("[data-coding-send]")!.click());
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/bots/wren/messages", expect.objectContaining({ method: "POST" })));
    const call = apiMock.mock.calls.find(([url]) => url === "/api/bots/wren/messages")!;
    expect(JSON.parse(call[1].body)).toMatchObject({ text: "Keep the order stable for ties", threadId: "th-1", busyMode: "steer" });
  });

  it("Stop interrupts the task's turn", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/activity/item")) return { item: detail("running") };
      if (url.startsWith("/api/threads/")) return { messages, hasMore: false };
      return {};
    });
    flushSync(() => root.render(createElement(CodingChat, { target: { botId: "wren", itemId: "thread:th-1", threadId: "th-1", seed: item("running") }, onClose: vi.fn() })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-stop]")).not.toBeNull());
    flushSync(() => column.querySelector<HTMLButtonElement>("[data-coding-stop]")!.click());
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ type: "interrupt", botId: "wren", threadId: "th-1" }));
  });
});
