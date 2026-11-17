// @vitest-environment happy-dom
// A listed command runs (#4450): /clear in a bot's chat was listed greyed,
// "Managed by Sagax", and could not be run. A command the app manages now
// runs the app's own action, picked or typed; one with no equivalent, and
// one only the engine's terminal runs, is not listed. A member on their own
// bot gets the same as an admin.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { HarnessCommand } from "../../shared/harness-commands";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), startNewTopic: vi.fn(), showThreads: false, ownerOrAdmin: false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    startNewTopic: fixture.startNewTopic,
    useStore: () => ({
      state: { ...original.initialState, bots: [bot], instances: [{
        instanceId: "fake", driverKind: "claudeAgent", displayName: "Fake",
        capabilities: { agentsMcp: true, queueing: true },
      }] },
      dispatch: fixture.dispatch,
    }),
  };
});
const engine: HarnessCommand[] = [
  { name: "clear", description: "Clear conversation history", argumentHint: "[name]", group: "engine", unavailable: "managed" },
  { name: "model", description: "Set the AI model", group: "engine", unavailable: "managed" },
  { name: "login", description: "Sign in", group: "engine", unavailable: "managed" },
  { name: "doctor", description: "Diagnose the install", group: "engine", unavailable: "interactive" },
  { name: "compact", description: "Free up context", group: "engine" },
];
vi.mock("@/lib/harness-commands", () => ({
  useHarnessCommands: () => ({ answer: { available: true, engine: "claude", commands: engine, at: 1 }, loading: false, refresh: () => {} }),
  useGroupHarnessCommands: () => ({ lists: [], loading: false, refresh: () => {} }),
}));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/thread-preferences")>()),
  useShowThreads: () => fixture.showThreads,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.ownerOrAdmin }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "own-bot", threadId: "own-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

describe("a command the app manages runs (#4450)", () => {
  let root: Root;
  let container: HTMLDivElement;

  const mount = () => flushSync(() => root.render(createElement(Composer, { bot })));
  const input = () => container.querySelector("textarea")!;
  const type = (text: string) => {
    const field = input();
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
      field.setSelectionRange(text.length, text.length);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const rows = () => [...container.querySelectorAll<HTMLButtonElement>("[role=option]")];
  const row = (label: string) => rows().find((candidate) => candidate.textContent?.includes(label));
  const sent = () => fixture.dispatch.mock.calls.some(([action]) => action.type === "send");

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    fixture.showThreads = false;
    fixture.ownerOrAdmin = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists /clear as a command that runs, and choosing it starts a new conversation (a member, their own bot)", () => {
    mount();
    type("/cl");
    const clear = row("/clear");
    expect(clear).toBeTruthy();
    expect(clear!.getAttribute("aria-disabled")).toBeNull();
    expect(clear!.className).not.toContain("opacity-55");
    expect(clear!.textContent).toContain("Start a new conversation with this bot");
    expect(clear!.textContent).not.toContain("Managed by");
    expect(clear!.textContent).not.toContain("[name]");
    flushSync(() => clear!.click());
    expect(fixture.startNewTopic).toHaveBeenCalledTimes(1);
    expect(fixture.startNewTopic.mock.calls[0]![1]).toMatchObject({ id: "own-bot" });
    expect(input().value).toBe("");
    expect(sent()).toBe(false);
  });

  it("the same for an admin", () => {
    fixture.ownerOrAdmin = true;
    mount();
    type("/clear");
    flushSync(() => row("/clear")!.click());
    expect(fixture.startNewTopic).toHaveBeenCalledTimes(1);
  });

  it("with threads shown, /clear opens a new thread with the bot", () => {
    fixture.showThreads = true;
    mount();
    type("/clear");
    flushSync(() => row("/clear")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: "own-bot" });
    expect(fixture.startNewTopic).not.toHaveBeenCalled();
  });

  it("runs /clear typed and sent, never as a message the engine refuses", () => {
    mount();
    type("/clear");
    flushSync(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    flushSync(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(fixture.startNewTopic).toHaveBeenCalledTimes(1);
    expect(sent()).toBe(false);
  });

  it("maps /model to the bot's Model settings", () => {
    mount();
    type("/mo");
    flushSync(() => row("/model")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, section: "model", botId: "own-bot" });
    expect(sent()).toBe(false);
  });

  it("lists no managed command without an equivalent and no terminal-only one", () => {
    mount();
    type("/");
    const labels = rows().map((candidate) => candidate.textContent ?? "");
    expect(labels.some((text) => text.includes("/clear"))).toBe(true);
    expect(labels.some((text) => text.includes("/compact"))).toBe(true);
    expect(labels.some((text) => text.includes("/login"))).toBe(false);
    expect(labels.some((text) => text.includes("/doctor"))).toBe(false);
    expect(rows().every((candidate) => candidate.getAttribute("aria-disabled") === null)).toBe(true);
  });
});
