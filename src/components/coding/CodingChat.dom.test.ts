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
// #2285 (JC 2026-11-06): the header's bot is the chat's own pill
// (BotHeaderPill); status, duration and tokens leave the header for a "This
// session" card of the bot panel, and the dev pods move there too, as panel
// sections, instead of the </> popover.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import type { BotActivityDetail, BotActivityItem } from "../../../shared/bot-activity";
import { setExchangeColumnHost } from "@/lib/exchange-column-host";
import { setCodingPanelHost } from "@/lib/coding-panel-host";

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
  DevPodsPanel: (props: { bot: Bot }) => { podsProps(props); return createElement("div", { "data-test-pods": props.bot.threadId }); },
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

const item = (status: BotActivityItem["status"], extra: Partial<BotActivityItem> = {}): BotActivityItem => ({
  id: "thread:th-1", kind: "session", botId: "wren", botName: "Wren", title: "Pour la colonne du board, garde l'ordre des cartes",
  status, startedAt: NOW - 250_000, ...(status === "running" ? { currentStep: `cd ${ROOT} && pnpm vitest run src/board` } : { endedAt: NOW - 60_000 }), updatedAt: NOW, threadId: "th-1", coding: true, canStop: status === "running",
  code: { folder: ROOT, branch: "feat/column-order", repo: "acme/board", pullRequests: [{ number: 41, url: "https://github.com/acme/board/pull/41", action: "opened", at: NOW }], branches: [], commits: [{ sha: "0badc0ffee12", pushed: true, at: NOW }] },
  ...extra,
});
const detail = (status: BotActivityItem["status"], extra: Partial<BotActivityDetail> = {}): BotActivityDetail => ({ ...item(status), steps: [], stepsTruncated: false, files: [], children: [], canStop: status === "running", ...extra });

let host: HTMLDivElement;
let column: HTMLDivElement;
let root: Root;
let panel: HTMLDivElement;

beforeEach(() => {
  setLocale("en");
  apiMock.mockReset();
  dispatchMock.mockReset();
  host = document.createElement("div");
  column = document.createElement("div");
  host.append(column);
  document.body.append(host);
  setExchangeColumnHost(column);
  panel = document.createElement("div");
  document.body.append(panel);
  setCodingPanelHost("wren", panel);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  setExchangeColumnHost(null);
  setCodingPanelHost("wren", null);
  panel.remove();
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
  it("opens over the chat column with the chat's floating bar: back and title at the left, the bot pill centered, folder and branch atop the transcript", () => {
    const props = mountSheet("running", { item: item("running", { currentStep: "Checking types" }), detail: detail("running", { currentStep: "Checking types" }) });
    const sheet = column.querySelector<HTMLElement>("[data-testid=coding-chat]")!;
    const header = sheet.querySelector<HTMLElement>("[data-coding-header]")!;
    expect(header).not.toBeNull();
    // the same bar as the bot chat (ChatHeaderBar): floating, the top fade, 40px pill centered
    expect(header.hasAttribute("data-chat-header-bar")).toBe(true);
    expect(header.className).toMatch(/absolute inset-x-0 top-0/);
    expect(header.querySelector('[data-chat-edge-fade="top"]')).not.toBeNull();
    expect(header.querySelector("[data-chat-header-center] [data-coding-bot] [data-chat-pill]")?.className).toMatch(/h-10/);
    expect(header.querySelector("[data-bot-header-chevron]")).toBeNull();
    expect(header.querySelector("[data-chat-header-start] [data-coding-back]")).not.toBeNull();
    expect(header.querySelector("[data-chat-header-start] [data-coding-title]")).not.toBeNull();
    expect(sheet.querySelector("[data-testid=coding-chat-scroll]")?.className).toMatch(/pt-\[52px\]/);
    expect(sheet.querySelector('[data-chat-bottom-edge] [data-chat-edge-fade="bottom"]')).not.toBeNull();
    expect(header.querySelector("[data-coding-bot]")?.textContent).toBe("Wren");
    // the same pill as the chat header (BotHeaderPill)
    expect(header.querySelector("[data-coding-bot] [data-bot-header-pill]")?.className).toMatch(/rounded-full/);
    expect(header.querySelector("[data-coding-title]")?.textContent).toContain("Pour la colonne du board");
    expect(header.querySelector("[data-coding-title]")?.className).toMatch(/truncate/);
    expect(sheet.querySelector("[data-testid=coding-chat-scroll] [data-coding-folder]")?.textContent).toBe("dispatch-board");
    expect(sheet.querySelector("[data-testid=coding-chat-scroll] [data-coding-branch]")?.textContent).toBe("feat/column-order");
    // #2285: no status, duration or tokens in the header; they are in the panel
    expect(header.querySelector("[data-coding-state]")).toBeNull();
    expect(header.querySelector("[data-coding-elapsed]")).toBeNull();
    expect(header.querySelector("[data-coding-tokens]")).toBeNull();
    expect(panel.querySelector("[data-coding-glyph]")?.textContent).toBe("○");
    expect(panel.querySelector("[data-coding-state]")?.textContent).toMatch(/Checking types/);
    expect(panel.querySelector("[data-coding-elapsed]")?.textContent).toBe("4m");
    expect(header.querySelector("[data-coding-stop-header]")).not.toBeNull();
    // one status only: no "Working:" line, no branch repeated in the band
    expect(sheet.querySelector("[data-coding-working]")).toBeNull();
    flushSync(() => header.querySelector<HTMLButtonElement>("[data-coding-back]")!.click());
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("expands the full task title inline from the header chevron", () => {
    mountSheet("running");
    const toggle = column.querySelector<HTMLButtonElement>("[data-coding-title-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(column.querySelector("[data-coding-title]")?.className).toMatch(/truncate/);
    flushSync(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(column.querySelector("[data-coding-title]")?.className).not.toMatch(/truncate/);
  });

  it("shows a finished status glyph and phrase in the panel card, without Stop and without Finished in the header", () => {
    mountSheet("finished");
    const header = column.querySelector<HTMLElement>("[data-coding-header]")!;
    expect(header.textContent).not.toContain("Finished");
    expect(panel.querySelector("[data-coding-session-card] h2")?.textContent).toBe("This session");
    expect(panel.querySelector("[data-coding-glyph]")?.textContent).toBe("●");
    expect(panel.querySelector("[data-coding-state]")?.textContent).toMatch(/Finished/);
    expect(panel.querySelector("[data-coding-elapsed]")?.textContent).toBe("3m");
    expect(header.querySelector("[data-coding-stop-header]")).toBeNull();
  });

  it("humanizes a live command step in the panel's session card", () => {
    mountSheet("running");
    const header = column.querySelector<HTMLElement>("[data-coding-header]")!;
    expect(panel.querySelector("[data-coding-state]")?.textContent).toMatch(/Running src\/board tests/);
    expect(header.textContent).not.toContain("cd dispatch-board");
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

  it("shows Stop in the header while live (one place), and none once finished", () => {
    const props = mountSheet("running");
    const stop = column.querySelector<HTMLButtonElement>("[data-coding-stop-header]")!;
    expect(stop).not.toBeNull();
    expect(column.querySelectorAll("[data-coding-stop]")).toHaveLength(1);
    flushSync(() => stop.click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    mountSheet("finished");
    expect(column.querySelector("[data-coding-stop]")).toBeNull();
  });

  it("keeps the composer on screen and sends the follow-up; the way back is the compact back control, no Continue, no Close Chat, no thread", async () => {
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
    // #2108 compact header: back arrow (also data-coding-back), not the page X
    expect(close.hasAttribute("data-coding-back")).toBe(true);
    expect(close.getAttribute("aria-label")).toBe("Back to the chat");
    flushSync(() => close.click());
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("draws the composer it is given, and the side content in the bot panel, not over the transcript", () => {
    mountSheet("finished", {
      composer: createElement("div", { "data-test-given-composer": "" }),
      side: createElement("div", { "data-test-given-pods": "" }),
    });
    expect(column.querySelector("[data-coding-composer] [data-test-given-composer]")).not.toBeNull();
    // the given composer replaces the fallback follow-up field
    expect(column.querySelector("[data-coding-followup]")).toBeNull();
    expect(column.querySelector("[data-test-given-pods]")).toBeNull();
    expect(panel.querySelector("[data-test-given-pods]")).not.toBeNull();
    // the session card comes first, the pods after it
    expect(panel.firstElementChild?.hasAttribute("data-coding-session-card")).toBe(true);
    expect(column.querySelector("[data-coding-tools]")).toBeNull();
  });

  it("puts the session and pods in the Coding tab's host and Connectors in Activity's (JC 2026-11-06)", () => {
    const activity = document.createElement("div");
    document.body.append(activity);
    setCodingPanelHost("wren", activity, "activity");
    try {
      mountSheet("finished", {
        side: createElement("div", { "data-test-given-pods": "" }),
        activitySide: createElement("div", { "data-test-connectors": "" }),
      });
      expect(panel.querySelector("[data-coding-session-card]")).not.toBeNull();
      expect(panel.querySelector("[data-test-given-pods]")).not.toBeNull();
      expect(panel.querySelector("[data-test-connectors]")).toBeNull();
      expect(activity.querySelector("[data-test-connectors]")).not.toBeNull();
      expect(activity.querySelector("[data-coding-session-card]")).toBeNull();
    } finally {
      flushSync(() => root.unmount());
      root = createRoot(host);
      setCodingPanelHost("wren", null, "activity");
      activity.remove();
    }
  });

  it("draws nothing in a panel when the bot panel is closed", () => {
    setCodingPanelHost("wren", null);
    mountSheet("finished", { side: createElement("div", { "data-test-given-pods": "" }) });
    expect(column.querySelector("[data-coding-header]")).not.toBeNull();
    expect(document.querySelector("[data-test-given-pods]")).toBeNull();
    expect(document.querySelector("[data-coding-session-card]")).toBeNull();
  });

  it("counts the tokens in the panel card, never in the header", () => {
    const counted = [...messages, { id: "m8", role: "bot", kind: "text", text: "Done.", at: NOW - 60_000, digest: { usage: { input: 9_000, output: 3_400 } } } as unknown as Message];
    mountSheet("finished", { messages: counted });
    expect(panel.querySelector("[data-coding-tokens]")?.textContent).toBe("12.4k");
    expect(column.querySelector("[data-coding-header] [data-coding-tokens]")).toBeNull();
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
  it("reads the task's thread, aims the bot's composer at it and puts the dev pods in the bot panel", async () => {
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
    expect(panel.querySelector('[data-test-pods="th-1"]')).not.toBeNull();
    expect(column.querySelector("[data-test-pods]")).toBeNull();
    expect(podsProps).toHaveBeenLastCalledWith(expect.objectContaining({ bot: expect.objectContaining({ id: "wren", threadId: "th-1" }) }));
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
