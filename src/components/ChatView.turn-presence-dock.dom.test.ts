// @vitest-environment happy-dom
// the owner 2026-11-06: the bot's working line ("Thinking it over 25s": dots or the
// mascot, the phrase, the timer) always sits at the bottom of the chat, just
// above the composer, on the message column, whatever the scroll. It lives in
// the composer dock, never in the transcript (role=log), and only once.
import { createElement, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
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
  id: "bot", threadId: "selected", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: true, messages: [
    { id: "ask", role: "user", kind: "text", at: Date.now() - 25_000, text: "Pull the open tickets" },
  ],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: true, activity: "working",
    modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "ask" }],
};

let host: HTMLDivElement;
let root: Root;
const render = (shown: Bot) => flushSync(() => root.render(createElement(ChatView, { bot: shown })));

beforeEach(() => {
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

describe("the working line", () => {
  it("renders once, in the composer dock just above the composer, not in the transcript", () => {
    render(bot);
    const lines = host.querySelectorAll(".turn-presence");
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.closest("[role=log]")).toBeNull();
    const dock = line.closest("[data-composer-dock]");
    expect(dock).not.toBeNull();
    const slot = line.closest("[data-turn-presence-slot]")!;
    expect(slot.parentElement).toBe(dock);
    // directly above the composer: nothing between the slot and the field
    const field = dock!.querySelector("textarea")!;
    expect(field).not.toBeNull();
    expect(slot.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.nextElementSibling?.contains(field)).toBe(true);
    // on the message column, as the transcript
    const column = host.querySelector("[role=log]")!.className.split(" ").filter((name) => name.startsWith("max-w") || name === "mx-auto");
    for (const name of column) expect(slot.firstElementChild!.classList.contains(name)).toBe(true);
  });

  it("leaves no slot behind once the bot is done", () => {
    render({ ...bot, busy: false, tasks: (bot.tasks ?? []).map((task) => ({ ...task, busy: false, activity: "idle" as const })) });
    expect(host.querySelector(".turn-presence")).toBeNull();
  });
});
