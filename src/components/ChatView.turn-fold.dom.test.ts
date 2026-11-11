// @vitest-environment happy-dom
// #3581, lot 4: the person's chat folds a turn's notes behind its one row,
// drawn through the real list (groupTranscript and the run branch of
// MessagesListItem), with Tool calls on and off.
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

describe("a turn's notes in the person's chat (#3581)", () => {
  const settled: Message[] = [
    ask,
    note("n0", 2_000, NOTES[0]!),
    step("s0", 3_000, "Read"),
    note("n1", 4_000, NOTES[1]!),
    step("s1", 5_000, "Grep"),
    note("n2", 6_000, NOTES[2]!),
    { id: "answer", role: "bot", kind: "text", at: 7_000, text: "Here is the summary.", turnId: "a", turnTerminal: true },
  ];

  it("with Tool calls off, draws one Worked row and the answer; the row opens to the three notes and no step", () => {
    render({ ...bot, messages: settled });
    expect(runs()).toHaveLength(1);
    const row = runs()[0]!.querySelector("button")!;
    expect(row.textContent).toMatch(/^Worked/);
    for (const text of NOTES) expect(host.textContent).not.toContain(text);
    expect(host.textContent).toContain("Here is the summary.");
    flushSync(() => row.click());
    for (const text of NOTES) expect(host.textContent).toContain(text);
    expect(host.querySelectorAll("[data-step-detail] [data-step-row]")).toHaveLength(0);
  });

  it("with Tool calls on, draws the same one row and the answer", () => {
    fixture.showToolCalls = true;
    render({ ...bot, messages: settled });
    expect(runs()).toHaveLength(1);
    for (const text of NOTES) expect(host.textContent).not.toContain(text);
    expect(host.textContent).toContain("Here is the summary.");
  });

  it("says Working on the row while the turn runs, also after the person writes during it (a steer)", () => {
    fixture.showToolCalls = true;
    const task = bot.tasks![0]!;
    render({
      ...bot,
      busy: true,
      tasks: [{ ...task, busy: true, activity: "working", turnStartedAt: 1_500 }],
      messages: [
        ask,
        note("n0", 2_000, NOTES[0]!),
        step("s0", 3_000, "Read"),
        { id: "steer", role: "user", kind: "text", at: 3_500, text: "Keep it short" },
        note("n1", 4_000, NOTES[1]!),
      ],
    });
    expect(runs()).toHaveLength(1);
    expect(runs()[0]!.querySelector("[data-step-label]")?.textContent).toBe("Working");
    expect(runs()[0]!.getAttribute("data-live")).toBe("true");
    expect(host.textContent).not.toContain(NOTES[0]!);
    expect(host.textContent).toContain(NOTES[1]!);
  });
});
