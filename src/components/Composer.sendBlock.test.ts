// @vitest-environment happy-dom
// The maintainer, 2026-10-27: a bot that certainly cannot answer this person does not take
// the message. One line above the composer says why and what to do, the draft
// stays, and the composer comes back by itself once the cause is fixed; any
// doubt sends as before (src/lib/send-state.ts).
import { createElement, type ComponentProps, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  /** What GET /api/bots/<id>/send-state answers next; an Error rejects. */
  sendState: { block: null } as unknown,
  asked: 0,
  /** Bodies POSTed to /send-state/fix. */
  fixes: [] as string[],
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes("/send-state/fix")) {
      fixture.fixes.push(String(init?.body ?? ""));
      return { ok: true, block: null };
    }
    if (path.includes("/send-state")) {
      fixture.asked += 1;
      if (fixture.sendState instanceof Error) throw fixture.sendState;
      return fixture.sendState;
    }
    return {};
  }), useStore: () => ({ state: { ...original.initialState, instances: [] }, dispatch: fixture.dispatch }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span") }));
const modelWindow = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/model-window", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/model-window")>(), openModelWindow: modelWindow.open }));

const { Composer } = await import("./Composer");
const { setLocale } = await import("@/lib/i18n");
const { SEND_BLOCK_RECHECK_MS } = await import("@/lib/send-state");

const bot: Bot = {
  id: "bot", threadId: "selected", name: "Harrie", title: "", description: "", color: "teal",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "pi", model: "deskabc123::local-model" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "pi", model: "deskabc123::local-model" }, approvalMode: "ask" }],
};
const OFFLINE = { block: { reason: "local_server_offline", message: "The local model is not responding.", action: { kind: "retry" } } };
const CLAUDE = { block: { reason: "engine_not_connected", name: "Claude", message: "Claude is not connected for you.", action: { kind: "connect", instanceId: "claude", engine: "Claude" } } };

let host: HTMLDivElement;
let root: Root;
const render = (element: ReactElement) => flushSync(() => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const textarea = () => $<HTMLTextAreaElement>("textarea")!;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); flushSync(() => {}); };
function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  flushSync(() => {
    setValue.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const pressEnter = () => flushSync(() => textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
const sent = () => fixture.dispatch.mock.calls.filter(([action]) => (action as { type: string }).type === "send");

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockClear();
  fixture.sendState = { block: null };
  fixture.asked = 0;
  fixture.fixes = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("composer while the bot cannot answer", () => {
  it("does not send, keeps the draft and shows one line with the reason and the action", async () => {
    fixture.sendState = OFFLINE;
    render(createElement(Composer, { bot }));
    await settle();
    const line = $("[data-composer-send-block]")!;
    expect(line.getAttribute("data-composer-send-block")).toBe("local_server_offline");
    expect(line.textContent).toContain("The local model is not responding: its server on that computer is stopped.");
    expect(host.querySelectorAll("[data-composer-send-block]")).toHaveLength(1);
    type("test");
    pressEnter();
    expect(sent()).toEqual([]);
    expect(textarea().value).toBe("test");
    expect($<HTMLButtonElement>("[data-composer-send]")?.disabled ?? true).toBe(true);
  });

  it("offers to connect the engine that is not connected for this person", async () => {
    fixture.sendState = CLAUDE;
    render(createElement(Composer, { bot }));
    await settle();
    expect($("[data-composer-send-block]")!.textContent).toContain("Claude is not connected for you.");
    flushSync(() => $<HTMLButtonElement>('[data-composer-send-block-action="connect"]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "providers" });
  });

  it("comes back by itself once the cause is fixed, without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    fixture.sendState = OFFLINE;
    render(createElement(Composer, { bot }));
    await settle();
    expect($("[data-composer-send-block]")).not.toBeNull();
    type("test");
    fixture.sendState = { block: null };
    vi.advanceTimersByTime(SEND_BLOCK_RECHECK_MS);
    await settle();
    expect($("[data-composer-send-block]")).toBeNull();
    expect(textarea().value).toBe("test");
    pressEnter();
    expect(sent()).toHaveLength(1);
  });

  it("sends as before when the state is unknown", async () => {
    fixture.sendState = new Error("offline");
    render(createElement(Composer, { bot }));
    await settle();
    expect($("[data-composer-send-block]")).toBeNull();
    type("hello");
    pressEnter();
    expect(sent()).toHaveLength(1);
    // an older server's answer, or a malformed one, is no block either
    fixture.sendState = { block: { reason: "engine_not_connected" } };
    render(createElement(Composer, { bot: { ...bot, modelSelection: { instanceId: "pi", model: "other" } } }));
    await settle();
    expect($("[data-composer-send-block]")).toBeNull();
  });

  // The maintainer, 2026-11-04: an engine at its limit or out of credit takes nothing:
  // no typing, no send, one line with the reset in local time and a switch.
  it("locks the whole composer while the engine is at its limit, and says when it is back", async () => {
    const resetsAt = Date.now() + 2 * 3_600_000;
    fixture.sendState = { block: { reason: "engine_limit", name: "Claude", message: "Claude limit reached.", action: { kind: "switch_engine" }, limit: { cause: "usage_limit", resetsAt } } };
    render(createElement(Composer, { bot }));
    await settle();
    const line = $("[data-composer-send-block]")!;
    expect(line.getAttribute("data-composer-send-block")).toBe("engine_limit");
    const local = new Date(resetsAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
    expect(line.textContent).toContain(`Claude limit reached, back at ${local}`);
    expect(line.textContent).not.toMatch(/UTC/);
    expect(textarea().disabled).toBe(true);
    pressEnter();
    expect(sent()).toEqual([]);
    expect($("[data-composer-send]")).toBeNull();
    expect($("[data-composer-cta]")).toBeNull();
    flushSync(() => $<HTMLButtonElement>('[data-composer-send-block-action="switch_engine"]')!.click());
    expect(modelWindow.open).toHaveBeenCalledWith("bot");
  });

  it("comes back once the bot moves to another engine", async () => {
    fixture.sendState = { block: { reason: "engine_limit", name: "Claude", message: "Claude is out of credit.", action: { kind: "switch_engine" }, limit: { cause: "credits" } } };
    render(createElement(Composer, { bot }));
    await settle();
    expect($("[data-composer-send-block]")!.textContent).toContain("Claude is out of credit");
    expect(textarea().disabled).toBe(true);
    fixture.sendState = { block: null };
    // the model window moves this conversation (and the bot) to another engine
    const grok = { instanceId: "grok", model: "grok-4" };
    render(createElement(Composer, { bot: { ...bot, modelSelection: grok, tasks: bot.tasks!.map((task) => ({ ...task, modelSelection: grok })) } }));
    await settle();
    expect($("[data-composer-send-block]")).toBeNull();
    expect(textarea().disabled).toBe(false);
  });

  // #2013: a refusal before any prompt went out is said here, never as a red
  // card; the line informs and the composer still sends.
  it("shows an engine's pre-send refusal as an advisory line that still sends, with Try again", async () => {
    fixture.sendState = { block: { reason: "engine_refused", name: "Codex", advisory: true, message: "Codex could not start this turn.", action: { kind: "resend" },
      refusal: { kind: "engine_not_ready", cause: "Codex could not confirm its shell environment policy. No prompt was sent." } } };
    const retryLast = vi.fn();
    render(createElement(Composer, { bot, onRetryLast: retryLast }));
    await settle();
    const line = $("[data-composer-send-block]")!;
    expect(line.getAttribute("data-composer-send-block")).toBe("engine_refused");
    expect(line.textContent).toContain("Codex could not start this turn. Nothing was sent.");
    expect(line.textContent).toContain("No prompt was sent");
    flushSync(() => $<HTMLButtonElement>('[data-composer-send-block-action="resend"]')!.click());
    expect(retryLast).toHaveBeenCalledTimes(1);
    type("again");
    pressEnter();
    expect(sent()).toHaveLength(1);
  });

  it("fixes a Codex configuration conflict in one click, then sends the last message again", async () => {
    fixture.sendState = { block: { reason: "engine_refused", name: "Codex", advisory: true, message: "Codex has its own settings.", action: { kind: "fix", fix: "codex_native_mcp" },
      refusal: { kind: "config_conflict", cause: "Codex has an MCP server outside the selected configuration." } } };
    const retryLast = vi.fn();
    render(createElement(Composer, { bot, onRetryLast: retryLast }));
    await settle();
    expect($("[data-composer-send-block]")!.textContent).toContain("Codex has its own settings that conflict with this bot's tools.");
    flushSync(() => $<HTMLButtonElement>('[data-composer-send-block-action="fix"]')!.click());
    await settle();
    expect(fixture.fixes).toEqual([JSON.stringify({ fix: "codex_native_mcp" })]);
    expect(retryLast).toHaveBeenCalledTimes(1);
  });
});
