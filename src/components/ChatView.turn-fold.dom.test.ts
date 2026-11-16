// @vitest-environment happy-dom
// #4437: in the person's chat every text the bot writes during a turn is its
// own bubble, in order, from its first word, while the turn runs and after;
// only the steps between two texts fold behind a row (#3581). Drawn through
// the real list (groupTranscript and the run branch of MessagesListItem),
// working line and live bubble, with Tool calls on and off.
import { createElement, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  showToolCalls: false,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: fixture.showToolCalls ? { features: { showToolCalls: true } } : null,
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true, useThreadsMode: () => "header" as "one" | "header" | "sidebar",
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./SidebarPopoverMenu", async (importOriginal) => ({
  ...await importOriginal<typeof import("./SidebarPopoverMenu")>(),
  SidebarPopoverMenu: (props: { renderTrigger: (state: { open: boolean }) => unknown }) => props.renderTrigger({ open: false }),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => null }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span"),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (_props: ComponentProps<typeof ApprovalModeSelector>) => createElement("span") }));

const { ChatView } = await import("./ChatView");
const { StreamingPreview } = await import("@/state/store");

const bot: Bot = {
  id: "bot", threadId: "selected", name: "Server", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "ask" }],
};

let host: HTMLDivElement;
let root: Root;
const render = (shown: Bot) => flushSync(() => root.render(createElement(ChatView, { bot: shown })));
const runs = () => host.querySelectorAll('[data-testid="activity-run"]');

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.showToolCalls = false;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const ask: Message = { id: "ask", role: "user", kind: "text", at: 1_000, text: "Summarize the ticket" };
const note = (id: string, at: number, text: string): Message => ({ id, role: "bot", kind: "text", at, text, turnId: "a" });
const step = (id: string, at: number, name: string): Message => ({ id, role: "bot", kind: "activity", at, turnId: "a", tool: { name, ok: true } });
const NOTES = ["Reading the ticket.", "The notes need another format.", "Writing the summary."];

describe("every text of a turn is its own bubble in the person's chat (#4437)", () => {
  const settled: Message[] = [
    ask,
    note("n0", 2_000, NOTES[0]!),
    step("s0", 3_000, "Read"),
    note("n1", 4_000, NOTES[1]!),
    step("s1", 5_000, "Grep"),
    note("n2", 6_000, NOTES[2]!),
    { id: "answer", role: "bot", kind: "text", at: 7_000, text: "Here is the summary.", turnId: "a", turnTerminal: true },
  ];
  const inBubble = (text: string) => [...host.querySelectorAll("[data-chat-bubble]")].some((el) => el.textContent?.includes(text));
  const order = (texts: readonly string[]) => texts.map((text) => host.textContent!.indexOf(text));

  it("with Tool calls off, draws every text and the answer as bubbles, in order, and no step", () => {
    render({ ...bot, messages: settled });
    for (const text of [...NOTES, "Here is the summary."]) expect(inBubble(text)).toBe(true);
    const at = order([...NOTES, "Here is the summary."]);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(host.querySelectorAll("[data-step-row]")).toHaveLength(0);
  });

  it("with Tool calls on, the steps between two texts fold behind a row of their own, the texts stay out of it", () => {
    fixture.showToolCalls = true;
    render({ ...bot, messages: settled });
    expect(runs()).toHaveLength(2);
    for (const run of runs()) {
      expect(run.querySelector("button")!.textContent).toMatch(/^Worked/);
      for (const text of NOTES) expect(run.textContent).not.toContain(text);
    }
    for (const text of NOTES) expect(inBubble(text)).toBe(true);
  });

  it("while the turn runs, a sentence it wrote is a bubble, never under Working; only the open stretch says Working", () => {
    fixture.showToolCalls = true;
    const task = bot.tasks![0]!;
    render({
      ...bot,
      busy: true,
      tasks: [{ ...task, busy: true, activity: "working", turnStartedAt: 1_500 }],
      messages: [
        ask,
        note("n0", 2_000, "I am checking these 4 tickets in this morning's pass."),
        step("s0", 3_000, "Read"),
        { id: "steer", role: "user", kind: "text", at: 3_500, text: "Keep it short" },
        note("n1", 4_000, NOTES[1]!),
        { id: "s1", role: "bot", kind: "activity", at: 5_000, turnId: "a", tool: { name: "Grep" } },
      ],
    });
    expect(inBubble("I am checking these 4 tickets in this morning's pass.")).toBe(true);
    expect(inBubble(NOTES[1]!)).toBe(true);
    expect(runs()).toHaveLength(2);
    expect(runs()[0]!.getAttribute("data-live")).toBeNull();
    expect(runs()[1]!.querySelector("[data-step-label]")?.textContent).toBe("Working");
    expect(runs()[1]!.getAttribute("data-live")).toBe("true");
  });
});

// #4437: each frame of a live turn rendered in order through the real list,
// working line and live bubble: a text is a bubble from its first word,
// short or long, never drawn in the working line, and still a bubble in
// every later frame of the turn and once it ends.
describe("a live turn's texts in the person's chat (#4437)", () => {
  const SHORT = "Yes, I will check the request.";
  const LONG = "Ticket 1042: the printer on the second floor failed three times since Monday, and two of its notes repeat ticket 1040, which is still open.";
  const task = bot.tasks![0]!;
  const liveBot = (messages: Message[]): Bot => ({
    ...bot, busy: true, tasks: [{ ...task, busy: true, activity: "working", turnStartedAt: 1_500 }], messages,
  });
  const endedBot = (messages: Message[]): Bot => ({ ...bot, messages });
  const frame = (shown: Bot, streaming = "") => flushSync(() => root.render(
    createElement(StreamingPreview, { streaming: streaming ? { selected: streaming } : {} }, createElement(ChatView, { bot: shown })),
  ));
  const inBubble = (text: string) => [...host.querySelectorAll("[data-chat-bubble]")].some((el) => el.textContent?.includes(text));
  const inLine = (text: string) => [...host.querySelectorAll("[data-presence-phrase]")].some((el) => el.textContent?.includes(text));
  const running = (id: string, at: number, name: string): Message => ({ id, role: "bot", kind: "activity", at, turnId: "a", tool: { name } });

  it("a short text is a bubble from its first word and stays one when steps and more texts follow", () => {
    frame(liveBot([ask]), "Yes, I will");
    expect(inBubble("Yes, I will")).toBe(true);
    expect(inLine("Yes, I will")).toBe(false);
    frame(liveBot([ask, note("n0", 2_000, SHORT)]));
    expect(inBubble(SHORT)).toBe(true);
    expect(inLine(SHORT)).toBe(false);
    frame(liveBot([ask, note("n0", 2_000, SHORT), running("s0", 3_000, "Read")]));
    expect(inBubble(SHORT)).toBe(true);
    frame(liveBot([ask, note("n0", 2_000, SHORT), step("s0", 3_000, "Read")]), LONG);
    expect(inBubble(SHORT)).toBe(true);
    expect(inBubble(LONG)).toBe(true);
    frame(liveBot([ask, note("n0", 2_000, SHORT), step("s0", 3_000, "Read"), note("n1", 4_000, LONG)]));
    expect(inBubble(SHORT)).toBe(true);
    expect(inBubble(LONG)).toBe(true);
  });

  it("the texts stay bubbles once the turn ends, the answer after them", () => {
    frame(endedBot([ask, note("n0", 2_000, SHORT), step("s0", 3_000, "Read"), note("n1", 4_000, "Checking 1040."),
      { ...note("n2", 5_000, "Yes."), turnTerminal: true }]));
    for (const text of [SHORT, "Checking 1040.", "Yes."]) expect(inBubble(text)).toBe(true);
  });
});
