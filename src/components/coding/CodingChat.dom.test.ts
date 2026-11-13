// @vitest-environment happy-dom
// The coding chat (2026-11-03; #2099; #3581 lot 5, the owner 2026-11-10: "the
// way it works, with the look of the reference product"): a coding task over
// the chat column, in the application's own look. One step row per tool call
// (the chat's StepRow: the step in words, a file or a program as the target,
// the test counts, the duration; opened, the command and its output in a code
// block, "… +N lines" to unfold), an edit's "+A -R" with its diff behind the
// row, the person's words in the right bubble, the bot's in a bot bubble; no
// terminal font, no dot, no `⎿`, no `Name(arg)` outside a code block; the
// status once, with Stop beside it; the composer always there; no
// "Continue", no "Close Chat", no "Open thread", no side panel; and no server
// path or id on the screen. A coding window (#2149): the X of a page opened
// by Sagax closes it, the bot's real composer (+, micro, voice) is aimed at the
// task's thread, and the </> panel lives here, never in the normal chat.
// #2285 (the owner 2026-11-06): the header's bot is the chat's own pill
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
    // The steps are this file's subject: Settings > Tool calls on (#4171,
    // tool-calls-everywhere.dom.test.ts covers it off).
    useStoreOptional: () => ({ state: { ...original.initialState, config: { features: { showToolCalls: true } } }, dispatch: dispatchMock }),
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
const labelOf = (row: HTMLElement) => [row.querySelector("[data-step-label]")?.firstChild?.textContent ?? "", row.querySelector("[data-step-target]")?.textContent ?? ""].filter(Boolean).join(" ");
const toggleOf = (row: HTMLElement) => row.querySelector<HTMLButtonElement>("[data-step-row] > button")!;

describe("CodingChatSheet", () => {
  it("opens over the chat column with the chat's floating bar: back and title at the left, the bot pill centered, folder and branch atop the transcript", () => {
    const props = mountSheet("running", { item: item("running", { currentStep: "Checking types" }), detail: detail("running", { currentStep: "Checking types" }) });
    const sheet = column.querySelector<HTMLElement>("[data-testid=coding-chat]")!;
    const header = sheet.querySelector<HTMLElement>("[data-coding-header]")!;
    expect(header).not.toBeNull();
    // the same bar as the bot chat (ChatHeaderBar): floating, the top fade, the one
    // chat pill centered: 40px, the reference's measure in the owner's
    // configuration (a 24px mascot, 7.5px around it, a 0.5px ring; #4163)
    expect(header.hasAttribute("data-chat-header-bar")).toBe(true);
    expect(header.className).toMatch(/absolute inset-x-0 top-0/);
    expect(header.querySelector('[data-chat-edge-fade="top"]')).not.toBeNull();
    expect(header.querySelector("[data-chat-header-center] [data-coding-bot] [data-chat-pill]")?.className).toMatch(/\bh-10\b/);
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
    // the marks of the Coding rows, never a text glyph
    expect(panel.querySelector("[data-coding-glyph] [data-coding-spinner]")).not.toBeNull();
    expect(panel.querySelector("[data-coding-glyph]")?.textContent).toBe("");
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
    expect(panel.querySelector("[data-coding-glyph] [data-activity-icon=finished]")).not.toBeNull();
    expect(panel.querySelector("[data-coding-glyph]")?.textContent).toBe("");
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

  it("draws each tool call as the chat's step row: words, a target, the counts, the duration; the command and output in a code block once opened", () => {
    mountSheet("running");
    expect(lines().map(labelOf)).toEqual([
      "Read a file column.ts",
      "Edited a file column.ts",
      "Ran src/board tests",
      "Waited",
      "Wrote a file order.ts",
    ]);
    for (const row of lines()) expect(row.querySelector("[data-step-row]")).not.toBeNull();
    const bash = lines()[2]!;
    expect(bash.querySelector("[data-step-row]")?.getAttribute("data-phase")).toBe("failed");
    expect(bash.querySelector("[data-coding-tests]")?.textContent).toMatch(/11 passed.*1 failed/);
    expect(bash.querySelector("[data-step-duration]")?.textContent).toBe("4s");
    // folded: nothing of the command or its output on the row
    expect(bash.querySelector("[data-tool-output]")).toBeNull();
    flushSync(() => toggleOf(bash).click());
    const command = bash.querySelector<HTMLElement>("[data-step-detail] [data-tool-command]")!;
    expect(command.textContent).toBe("cd dispatch-board && pnpm vitest run src/board");
    const output = bash.querySelector<HTMLElement>("[data-step-detail] [data-tool-output]")!;
    expect(output.textContent).toContain("FAIL src/board/column.test.ts");
    expect(output.textContent).not.toContain("line five");
    const more = bash.querySelector<HTMLButtonElement>("[data-tool-more]")!;
    expect(more.textContent).toBe("… +2 lines");
    flushSync(() => more.click());
    expect(bash.querySelector("[data-tool-output]")?.textContent).toContain("line five");
    expect(more.textContent).toBe("Show less");
    // a command that only waits is a quiet row with nothing to open
    const wait = lines()[3]!;
    expect(wait.querySelector("[data-step-row] > button")).toBeNull();
    expect(wait.querySelector("[data-coding-wait]")).not.toBeNull();
    // no card, no border around a row
    expect(column.querySelector("[data-coding-terminal]")).toBeNull();
    expect(column.querySelector("[data-coding-file-chip]")).toBeNull();
  });

  it("draws nothing that looks like a terminal outside a code block, a diff, a path, a branch or a commit id", () => {
    mountSheet("finished");
    for (const row of lines()) flushSync(() => toggleOf(row)?.click());
    const scroll = column.querySelector<HTMLElement>("[data-testid=coding-chat-scroll]")!;
    const allowed = "pre, [data-coding-diff], [data-coding-branch]";
    for (const node of scroll.querySelectorAll<HTMLElement>("[class*='font-mono']")) {
      expect(node.closest(allowed), node.outerHTML.slice(0, 120)).not.toBeNull();
    }
    expect(scroll.querySelector("[data-tool-dot], [data-tool-name], [data-tool-arg], [data-tool-result]")).toBeNull();
    const words = [...scroll.querySelectorAll<HTMLElement>("[data-step-row] > button, [data-step-row] > div, [data-coding-line]")].map((node) => node.textContent ?? "").join("\n");
    expect(words).not.toMatch(/[⎿●›]/);
    expect(words).not.toMatch(/\b(?:Bash|Edit|Write|Read)\(/);
  });

  it("an edit says +A -R on its row and opens its diff; a jump from the Changes band still opens it", () => {
    mountSheet("finished");
    const edit = lines()[1]!;
    const counts = edit.querySelector<HTMLElement>("[data-coding-diff-counts]")!;
    expect(counts.textContent).toBe("+1 -1");
    expect(counts.className).not.toMatch(/font-mono/);
    expect(edit.querySelector("[data-coding-diff]")).toBeNull();
    flushSync(() => toggleOf(edit).click());
    const diff = edit.querySelector<HTMLElement>("[data-step-detail] [data-coding-diff]")!;
    expect(diff.dataset.codingDiff).toBe("src/board/column.ts");
    expect(diff.querySelectorAll("[data-diff-line=del]")).toHaveLength(1);
    expect(diff.querySelectorAll("[data-diff-line=add]")).toHaveLength(1);
    flushSync(() => toggleOf(edit).click());
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
    // closed by hand, a second jump to the same file opens it again
    flushSync(() => toggleOf(lines()[4]!).click());
    expect(lines()[4]!.querySelector("[data-coding-diff]")).toBeNull();
    flushSync(() => band.querySelector<HTMLButtonElement>('[data-coding-changed-file="src/board/order.ts"]')!.click());
    expect(lines()[4]!.querySelector("[data-coding-diff]")).not.toBeNull();
  });

  it("draws the person's words in the right bubble and the bot's in a bot bubble", () => {
    mountSheet("running");
    const user = column.querySelector<HTMLElement>('[data-coding-line="user"]')!;
    expect(user.className).toMatch(/items-end/);
    const mine = user.querySelector<HTMLElement>("[data-chat-bubble]")!;
    expect(mine.className).toMatch(/bg-bubble-user/);
    expect(mine.textContent).toContain("garde l'ordre des cartes");
    expect(user.textContent).not.toMatch(/›/);
    const bot = column.querySelector<HTMLElement>('[data-coding-line="bot"]')!;
    expect(bot.className).toMatch(/items-start/);
    const theirs = bot.querySelector<HTMLElement>("[data-chat-bubble]")!;
    expect(theirs.className).toMatch(/bg-bubble-bot/);
    expect(theirs.textContent).toBe("I'll look at the column first.");
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

  it("puts the session and every pod, Connectors included, in the Coding tab's host (#2599, the owner 2026-11-07)", () => {
    mountSheet("finished", {
      side: createElement("div", { "data-test-given-pods": "" }, createElement("section", { "data-dev-pod": "connectors" })),
    });
    expect(panel.querySelector("[data-coding-session-card]")).not.toBeNull();
    expect(panel.querySelector("[data-test-given-pods] [data-dev-pod='connectors']")).not.toBeNull();
    expect(document.querySelectorAll("[data-dev-pod='connectors']")).toHaveLength(1);
  });

  it("puts the working line just above the composer while the task runs, never in the transcript (the owner 2026-11-06)", () => {
    mountSheet("running", { composer: createElement("div", { "data-test-given-composer": "" }) });
    const lines = column.querySelectorAll(".turn-presence");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.closest("[role=log]")).toBeNull();
    const slot = lines[0]!.closest("[data-turn-presence-slot]")!;
    expect(slot.nextElementSibling?.hasAttribute("data-coding-composer")).toBe(true);
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
