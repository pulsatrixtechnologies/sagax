// @vitest-environment happy-dom
// #3462: when the person writes to a team bot in a step's coding chat, the
// orchestrator's chat shows one quiet line "You wrote to [face] <bot>": no
// bubble, a burst that still meets folds into one line, and the name opens
// that step's coding chat where the chat is.
import { createElement, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [lead, tester], instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
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
  useShowThreads: () => false, useThreadsMode: () => "one" as "one" | "header" | "sidebar",
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

const lead: Bot = {
  id: "lead", threadId: "main", name: "Lead", title: "Orchestrator", description: "", color: "orange",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: "main", title: "Main", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
};
const tester = { ...lead, id: "tester", threadId: "home", name: "Tester", title: "Test engineer", color: "green", tasks: [] } as Bot;

const { ChatView } = await import("./ChatView");
const { setLocale } = await import("@/lib/i18n");

const NOW = Date.UTC(2026, 10, 10, 15, 0);
const note = (id: string, at: number, extra: Partial<NonNullable<Message["teamNote"]>> = {}): Message => ({
  id, role: "bot", kind: "text", at, text: `You wrote to Tester: words ${id}`,
  teamNote: { botId: "tester", botName: "Tester", threadId: "tt", title: "Test", text: `words ${id}`, at, lastAt: at, count: 1, ...extra },
});

let host: HTMLDivElement;
let root: Root;
const render = (messages: Message[]) => flushSync(() => root.render(createElement(ChatView, { bot: { ...lead, messages } })));
const lines = () => [...host.querySelectorAll<HTMLElement>("[data-testid=team-note-line]")];

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockClear();
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

describe("the quiet line of a note to a team bot", () => {
  it("is one quiet line, no bubble", () => {
    render([
      { id: "ask", role: "user", kind: "text", at: NOW - 60_000, text: "Ship the release" },
      note("n1", NOW),
    ]);
    expect(lines()).toHaveLength(1);
    const line = lines()[0]!;
    expect(line.textContent).toContain("You wrote to");
    expect(line.textContent).toContain("Tester");
    expect(line.closest("[data-mid=n1]")).not.toBeNull();
    // no bubble of its own: the row is the line
    expect(host.querySelector("[data-mid=n1] [data-chat-bubble]")).toBeNull();
    expect(host.textContent).not.toContain("words n1");
  });

  it("a burst that still meets folds into one line that counts its writes", () => {
    render([note("n1", NOW - 90_000), note("n2", NOW - 60_000, { count: 2 }), note("n3", NOW - 10 * 60_000 + 20 * 60_000)]);
    // n1 and n2 are 30 s apart: one line; n3 comes 9.5 minutes later: its own line
    expect(lines()).toHaveLength(2);
    expect(lines()[0]!.textContent).toContain("3 messages");
    expect(lines()[1]!.textContent).not.toContain("messages");
  });

  it("the name opens that step's coding chat, the orchestrator staying selected", () => {
    render([note("n1", NOW)]);
    const name = host.querySelector<HTMLButtonElement>("[data-team-note-open=tt]")!;
    expect(name).not.toBeNull();
    expect(name.getAttribute("aria-label")).toBe("Open the chat of Tester for this step");
    flushSync(() => name.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "openCodingChat",
      target: expect.objectContaining({ botId: "tester", itemId: "thread:tt", threadId: "tt", step: expect.objectContaining({ orchestratorId: "lead", name: "Test" }) }),
    }));
  });

  it("in French", () => {
    setLocale("fr");
    render([note("n1", NOW)]);
    expect(lines()[0]!.textContent).toContain("Tu as écrit à");
  });
});
