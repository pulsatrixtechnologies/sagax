// @vitest-environment happy-dom
// The coding chat (2026-11-03; terminal shape #2099, JC 2026-11-05): a coding
// task over the chat column, drawn the way Claude Code prints a session. One
// line per tool call (`● Bash(pnpm vitest run src/board …)` then `⎿` and the
// first lines of the result, "… +N lines" to unfold), edits folded behind
// `+A -R`, the human's line with "›", the bot's as plain text; the status
// once, in the head, with Stop beside it; the composer always there; no
// "Continue", no "Close Chat", no "Open thread", no side panel; and no server
// path or id on the screen. A coding window (#2149): the X of a page opened
// by Sagax closes it, the bot's real composer (+, micro, voice) is aimed at the
// task's thread, and the </> panel lives here, never in the normal chat.
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
// The window hands its own composer and pods the task's thread: what they draw
// is their own tests' business.
const composerProps = vi.fn();
const podsProps = vi.fn();
vi.mock("../Composer", () => ({
  Composer: (props: { bot: Bot }) => { composerProps(props); return createElement("div", { "data-test-composer": props.bot.threadId }); },
}));
vi.mock("../dev-pods/DevPods", () => ({
  DevPods: (props: { bot: Bot; forced?: boolean }) => { podsProps(props); return createElement("div", { "data-test-pods": props.bot.threadId }); },
  DevPodsToggle: (props: { bot?: Bot }) => createElement("button", { type: "button", "data-test-pods-toggle": props.bot?.threadId ?? "" }),
}));

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
  { id: "m5", role: "bot", kind: "activity", text: "", at: NOW - 180_000, tool: { name: "Bash", input: pretty({ command: `cd ${ROOT} && pnpm vitest run src/board` }), output: `FAIL ${ROOT}/src/board/column.test.ts\n      Tests  1 failed | 11 passed (12)\nbot ${UUID}\nline four\nline five`, ok: false, durationMs: 4_200 } },
  { id: "m6", role: "bot", kind: "activity", text: "", at: NOW - 150_000, tool: { name: "Bash", input: pretty({ command: `cd ${ROOT} && sleep 30; pgrep -f vite` }), output: "", ok: true, durationMs: 30_000 } },
  { id: "m7", role: "bot", kind: "activity", text: "", at: NOW - 120_000, tool: { name: "Write", input: pretty({ file_path: `${ROOT}/src/board/order.ts`, content: "export const byOrder = (a, b) => a.order - b.order;\n" }), ok: true } },
];

const item = (status: BotActivityItem["status"]): BotActivityItem => ({
  id: "thread:th-1", kind: "session", botId: "wren", botName: "Wren", title: "Pour la colonne du board, garde l'ordre des cartes",
  status, startedAt: NOW - 250_000, ...(status === "running" ? { currentStep: `cd ${ROOT} && pnpm vitest run src/board` } : { endedAt: NOW - 60_000 }), updatedAt: NOW, threadId: "th-1", coding: true, canStop: status === "running",
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

const lines = () => [...column.querySelectorAll<HTMLElement>("[data-coding-row]")];
const headOf = (row: HTMLElement) => `${row.querySelector("[data-tool-name]")?.textContent ?? ""}${row.querySelector("[data-tool-arg]")?.textContent ?? ""}`;

describe("CodingChatSheet", () => {
  it("opens over the chat column with the task's title, bot, folder, branch, and the state once with the step in words", () => {
    mountSheet("running");
    const sheet = column.querySelector<HTMLElement>("[data-testid=coding-chat]")!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector("[data-coding-title]")?.textContent).toContain("Pour la colonne du board");
    expect(sheet.textContent).toContain("Wren");
    expect(sheet.querySelector("[data-coding-folder]")?.textContent).toBe("dispatch-board");
    expect(sheet.textContent).toContain("feat/column-order");
    const state = sheet.querySelectorAll("[data-coding-state]");
    expect(state).toHaveLength(1);
    expect(state[0]!.textContent).toMatch(/Running\s*·\s*4m/);
    // the current step in words, never the raw command
    expect(sheet.querySelector("[data-coding-step-now]")?.textContent).toBe("Running src/board tests");
    expect(sheet.textContent).not.toContain("cd dispatch-board");
    // one status only: no "Working:" line, no branch repeated in the band
    expect(sheet.querySelector("[data-coding-working]")).toBeNull();
    expect(sheet.querySelector("[data-coding-branch]")).toBeNull();
  });

  it("draws each tool call as one terminal line: the dot, Name(arg), ⎿ the first lines, then … +N lines", () => {
    mountSheet("running");
    expect(lines().map(headOf)).toEqual([
      "Read(src/board/column.ts)",
      "Edit(src/board/column.ts)",
      "Bash(pnpm vitest run src/board)",
      "Bash(sleep 30; pgrep -f vite)",
      "Write(src/board/order.ts)",
    ]);
    const bash = lines()[2]!;
    expect(bash.querySelector("[data-tool-dot]")?.getAttribute("data-tool-dot")).toBe("failed");
    expect(bash.querySelector("[data-coding-tests]")?.textContent).toMatch(/11 passed.*1 failed/);
    const output = bash.querySelector<HTMLElement>("[data-tool-output]")!;
    expect(output.textContent).toContain("FAIL src/board/column.test.ts");
    expect(output.textContent).not.toContain("line five");
    const more = bash.querySelector<HTMLButtonElement>("[data-tool-more]")!;
    expect(more.textContent).toBe("… +3 lines");
    flushSync(() => more.click());
    expect(bash.querySelector("[data-tool-output]")?.textContent).toContain("line five");
    expect(more.textContent).toBe("Show less");
    // a command that only waits is a muted line with no result
    const wait = lines()[3]!;
    expect(wait.querySelector("[data-tool-result]")).toBeNull();
    // no card, no border around a line
    expect(column.querySelector("[data-coding-terminal]")).toBeNull();
    expect(column.querySelector("[data-coding-file-chip]")).toBeNull();
  });

  it("folds an edit behind +A -R, a jump from the Changes band opens its diff", () => {
    mountSheet("finished");
    const edit = lines()[1]!;
    const toggle = edit.querySelector<HTMLButtonElement>("[data-coding-diff-toggle]")!;
    expect(toggle.textContent).toMatch(/\+1 -1/);
    expect(edit.querySelector("[data-coding-diff]")).toBeNull();
    flushSync(() => toggle.click());
    const diff = edit.querySelector<HTMLElement>("[data-coding-diff]")!;
    expect(diff.dataset.codingDiff).toBe("src/board/column.ts");
    expect(diff.querySelectorAll("[data-diff-line=del]")).toHaveLength(1);
    expect(diff.querySelectorAll("[data-diff-line=add]")).toHaveLength(1);
    flushSync(() => toggle.click());
    expect(edit.querySelector("[data-coding-diff]")).toBeNull();
    // the band: files, tests, commit, pull request; a file opens its diff
    const band = column.querySelector<HTMLElement>("[data-coding-changes]")!;
    expect(band.querySelector("[data-coding-changes-toggle]")?.textContent).toMatch(/2 files changed\s*\+2 -1/);
    expect(band.querySelector("[data-coding-tests]")).not.toBeNull();
    expect(band.querySelector("[data-coding-commit]")?.textContent).toBe("0badc0f");
    expect(band.querySelector("[data-coding-pull]")?.textContent).toBe("Pull request #41");
    flushSync(() => band.querySelector<HTMLButtonElement>("[data-coding-changes-toggle]")!.click());
    flushSync(() => band.querySelector<HTMLButtonElement>('[data-coding-changed-file="src/board/order.ts"]')!.click());
    expect(lines()[4]!.querySelector("[data-coding-diff]")?.getAttribute("data-coding-diff")).toBe("src/board/order.ts");
  });

  it("draws the person's line with › and the bot's as plain text, no bubbles", () => {
    mountSheet("running");
    const user = column.querySelector<HTMLElement>('[data-coding-line="user"]')!;
    expect(user.textContent).toMatch(/^›/);
    expect(user.textContent).toContain("garde l'ordre des cartes");
    expect(column.querySelector('[data-coding-line="bot"]')?.textContent).toBe("I'll look at the column first.");
  });

  it("shows Stop once, in the head beside the state, while live; none once finished", () => {
    const props = mountSheet("running");
    const stops = column.querySelectorAll<HTMLButtonElement>("[data-coding-stop]");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.closest("[data-coding-meta]")).not.toBeNull();
    flushSync(() => stops[0]!.click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    mountSheet("finished");
    expect(column.querySelector("[data-coding-stop]")).toBeNull();
  });

  it("keeps the composer on screen and sends the follow-up; the way back is the X, no Continue, no Close Chat, no thread", async () => {
    const props = mountSheet("finished");
    expect(column.querySelector("[data-coding-continue]")).toBeNull();
    expect(column.textContent).not.toContain("Close Chat");
    expect(column.textContent).not.toMatch(/Open thread/i);
    expect(column.querySelector("[data-parallel-open]")).toBeNull();
    const field = column.querySelector<HTMLTextAreaElement>("[data-coding-followup] textarea")!;
    expect(field).not.toBeNull();
    typeInto(field, "Also add a test for the empty column");
    flushSync(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await vi.waitFor(() => expect(props.onSend).toHaveBeenCalledWith("Also add a test for the empty column"));
    expect(column.querySelector("[data-coding-followup]")).not.toBeNull();
    const close = column.querySelector<HTMLButtonElement>("[data-coding-close]")!;
    // the same X as a page opened by Sagax (the bot's profile page)
    expect(close.hasAttribute("data-window-close")).toBe(true);
    expect(close.getAttribute("aria-label")).toBe("Close");
    flushSync(() => close.click());
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("draws the composer, the pods and the header tools it is given", () => {
    mountSheet("finished", {
      composer: createElement("div", { "data-test-given-composer": "" }),
      pods: createElement("div", { "data-test-given-pods": "" }),
      headerTools: createElement("button", { type: "button", "data-test-given-tools": "" }),
    });
    expect(column.querySelector("[data-coding-composer] [data-test-given-composer]")).not.toBeNull();
    // the given composer replaces the fallback follow-up field
    expect(column.querySelector("[data-coding-followup]")).toBeNull();
    expect(column.querySelector("[data-coding-pane] [data-test-given-pods]")).not.toBeNull();
    expect(column.querySelector("[data-coding-tools] [data-test-given-tools]")).not.toBeNull();
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
  it("reads the task's thread, aims the bot's composer at it and opens the </> panel there", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/activity/item")) return { item: detail("running") };
      if (url.startsWith("/api/threads/th-1/messages")) return { messages, hasMore: false };
      return {};
    });
    composerProps.mockReset();
    podsProps.mockReset();
    flushSync(() => root.render(createElement(CodingChat, { target: { botId: "wren", itemId: "thread:th-1", threadId: "th-1", seed: item("running") }, onClose: vi.fn() })));
    await vi.waitFor(() => expect(column.querySelector("[data-coding-row]")).not.toBeNull());
    expect(column.querySelector('[data-coding-composer] [data-test-composer="th-1"]')).not.toBeNull();
    expect(composerProps).toHaveBeenLastCalledWith(expect.objectContaining({ bot: expect.objectContaining({ id: "wren", threadId: "th-1", busy: true }) }));
    expect(column.querySelector('[data-coding-pane] [data-test-pods="th-1"]')).not.toBeNull();
    expect(podsProps).toHaveBeenLastCalledWith(expect.objectContaining({ forced: true }));
    expect(column.querySelector('[data-coding-tools] [data-test-pods-toggle="th-1"]')).not.toBeNull();
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
