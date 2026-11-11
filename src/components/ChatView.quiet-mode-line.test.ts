// @vitest-environment happy-dom
// #3480: when a bot's quiet mode goes off, its chat shows one quiet line
// like an answered card (how many runs were kept quiet, how many had
// problems), never a bubble, and its link opens those runs in the main area.
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
const summary = (id: string, runs: number, problems: number): Message => ({
  id, role: "bot", kind: "text", at: NOW, text: `server words ${id}`,
  from: { botId: "lead", name: "Lead", color: "orange" },
  quietSummary: { runs, problems },
});

let host: HTMLDivElement;
let root: Root;
const render = (messages: Message[]) => flushSync(() => root.render(createElement(ChatView, { bot: { ...lead, messages } })));
const lines = () => [...host.querySelectorAll<HTMLElement>("[data-quiet-mode-line]")];

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

describe("the quiet line when quiet mode goes off (#3480)", () => {
  it("is one quiet line like an answered card, no bubble", () => {
    render([
      { id: "ask", role: "user", kind: "text", at: NOW - 60_000, text: "Speak again" },
      summary("q1", 4, 1),
    ]);
    expect(lines()).toHaveLength(1);
    const line = lines()[0]!;
    expect(line.querySelector("[data-ask-card=settled]")).not.toBeNull();
    expect(line.textContent).toContain("Quiet mode is off: 4 runs kept quiet, 1 with problems");
    expect(line.closest("[data-mid=q1]")).not.toBeNull();
    expect(host.querySelector("[data-mid=q1] [data-chat-bubble]")).toBeNull();
    // the server's own words are only the fallback
    expect(host.textContent).not.toContain("server words q1");
  });

  it("its link opens the bot's runs in the main area", () => {
    render([summary("q1", 2, 0)]);
    const link = host.querySelector<HTMLButtonElement>("[data-quiet-mode-runs]")!;
    expect(link.textContent).toBe("See the runs");
    flushSync(() => link.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines", section: "logs", botId: "lead" });
  });

  it("with nothing kept, says so without a link", () => {
    render([summary("q1", 0, 0)]);
    expect(lines()[0]!.textContent).toContain("no run was kept quiet");
    expect(host.querySelector("[data-quiet-mode-runs]")).toBeNull();
  });

  it("in French", () => {
    setLocale("fr");
    render([summary("q1", 3, 2)]);
    expect(lines()[0]!.textContent).toContain("Mode silencieux terminé : 3 exécutions gardées en silence, dont 2 avec des problèmes");
    expect(host.querySelector("[data-quiet-mode-runs]")!.textContent).toBe("Voir les exécutions");
  });
});
